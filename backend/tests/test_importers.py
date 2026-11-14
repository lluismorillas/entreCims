import struct
from datetime import UTC, datetime

import pytest

from importers import MAX_BYTES, TrackError, parse

# conjunt de proves automatitzades (tests amb Pytest) per comprovar que el teu mòdul importers funciona correctament.
# comprova que la funció parse() és capaç de llegir fitxers de rutes i activitats de muntanya en diferents formats (GPX, TCX i FIT),
# extreure'n les dades i rebutjar fitxers incorrectes o potencialment maliciosos.

GPX = """<?xml version="1.0"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
 <trk><name>Synthetic run</name><type>trail_running</type><trkseg>
  <trkpt lat="42.0" lon="2.0"><ele>1000</ele><time>2026-01-01T10:00:00Z</time></trkpt>
  <trkpt lat="42.001" lon="2.0"><ele>1010.5</ele><time>2026-01-01T10:01:00Z</time></trkpt>
 </trkseg></trk>
</gpx>"""

TCX = """<?xml version="1.0"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
 <Courses><Course><Name>Synthetic hike - Wikiloc</Name><Track>
  <Trackpoint><Time>2026-01-01T10:00:00Z</Time>
   <Position><LatitudeDegrees>42.0</LatitudeDegrees><LongitudeDegrees>2.0</LongitudeDegrees></Position>
   <AltitudeMeters>1000</AltitudeMeters></Trackpoint>
  <Trackpoint><Time>2026-01-01T10:01:00Z</Time></Trackpoint>
  <Trackpoint><Time>2026-01-01T10:02:00Z</Time>
   <Position><LatitudeDegrees>42.001</LatitudeDegrees><LongitudeDegrees>2.0</LongitudeDegrees></Position>
   <AltitudeMeters>1010.5</AltitudeMeters></Trackpoint>
 </Track></Course></Courses>
</TrainingCenterDatabase>"""

BOMB = """<?xml version="1.0"?>
<!DOCTYPE gpx [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]>
<gpx><trk><name>&b;</name></trk></gpx>"""

# calcula el CRC (Cyclic Redundancy Check) d'un conjunt de bytes. Per si saber si estan corrompudes
def fit_crc(data: bytes) -> int:
    table = [0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
             0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400]  # fmt: skip
    crc = 0
    for byte in data:
        for nibble in (byte & 0xF, byte >> 4):
            crc = (crc >> 4) ^ table[crc & 0xF] ^ table[nibble]
    return crc

# crea un exemple de fitxer fit
def make_fit() -> bytes:
    """Un FIT sintètic mínim: esport (running/trail) i dos punts."""
    semi = lambda deg: round(deg * 2**31 / 180)
    t0 = int(
        (
            datetime(2026, 1, 1, 10, tzinfo=UTC) - datetime(1989, 12, 31, tzinfo=UTC)
        ).total_seconds()
    )
    body = (
        # Definició local 0: missatge 12 (sport) amb sport i sub_sport.
        struct.pack("<BBBHB", 0x40, 0, 0, 12, 2) + bytes([0, 1, 0x00, 1, 1, 0x00])
        + bytes([0x00, 1, 3])
        # Definició local 1: missatge 20 (record) amb timestamp, lat, lon i altitud.
        + struct.pack("<BBBHB", 0x41, 0, 0, 20, 4)
        + bytes([253, 4, 0x86, 0, 4, 0x85, 1, 4, 0x85, 2, 2, 0x84])
        # L'altitud es desa com (metres + 500) * 5.
        + struct.pack("<BIiiH", 0x01, t0, semi(42.0), semi(2.0), (1000 + 500) * 5)
        + struct.pack("<BIiiH", 0x01, t0 + 60, semi(42.001), semi(2.0), (1010 + 500) * 5)
    )  # fmt: skip
    header = struct.pack("<BBHI4sH", 14, 0x10, 2132, len(body), b".FIT", 0)
    return header + body + struct.pack("<H", fit_crc(header + body))

# comprova que el resultat de la importació sigui correcte.
def check_points(track):
    assert len(track.points) == 2
    first, last = track.points
    assert (first.lat, first.lon, first.ele) == pytest.approx((42.0, 2.0, 1000))
    assert (last.lat, last.ele) == pytest.approx((42.001, 1010.5), abs=0.6)
    assert first.time == datetime(2026, 1, 1, 10, tzinfo=UTC)
    assert track.kind == "activity"

def test_gpx():
    track = parse("run.GPX", GPX.encode())
    check_points(track)
    assert (track.name, track.type, track.source_format) == (
        "Synthetic run",
        "trail_run",
        "gpx",
    )

def test_tcx_skips_points_without_position():
    track = parse("hike.tcx", TCX.encode())
    check_points(track)
    assert (track.name, track.type, track.source_format) == (
        "Synthetic hike",
        "hike",
        "tcx",
    )

def test_fit():
    track = parse("Morning.fit", make_fit())
    check_points(track)
    assert (track.name, track.type, track.source_format) == (
        "Morning",
        "trail_run",
        "fit",
    )

def test_without_times_is_a_planned_route():
    track = parse(
        "plan.gpx", GPX.replace("<time>2026-01-01T10:01:00Z</time>", "").encode()
    )
    assert track.kind == "planned"

def test_gpx_route_points():
    gpx = '<gpx><rte><name>R</name><rtept lat="1" lon="2"/><rtept lat="1.1" lon="2"/></rte></gpx>'
    track = parse("r.gpx", gpx.encode())
    assert (track.name, track.kind, len(track.points)) == ("R", "planned", 2)

@pytest.mark.parametrize(
    ("filename", "data", "message"),
    [
        ("a.gpx", b"<gpx><trk>", "not a valid GPX"),
        ("a.gpx", BOMB.encode(), "not a valid GPX"),
        ("a.tcx", b"not xml", "not a valid TCX"),
        ("a.tcx", BOMB.encode(), "not a valid TCX"),
        ("a.fit", b"not a fit file", "not a valid FIT"),
        ("a.fit", make_fit()[:-10], "not a valid FIT"),
        ("a.gpx", b"<gpx></gpx>", "at least two points"),
        (
            "a.gpx",
            GPX.replace('lat="42.0"', 'lat="420"').encode(),
            "at least two points",
        ),
        ("a.kml", b"", "Only GPX, FIT and TCX"),
        ("a.gpx", b" " * (MAX_BYTES + 1), "larger than 20 MB"),
    ],
)
def test_rejects_bad_files(filename, data, message):
    with pytest.raises(TrackError, match=message):
        parse(filename, data)
