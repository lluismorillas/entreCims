"""Llegeix un fitxer GPX, FIT o TCX i en retorna els punts unificats."""

import io
from datetime import UTC, datetime
from functools import partial
from pathlib import PurePath
from typing import NamedTuple

import fitdecode
import gpxpy
from defusedxml import ElementTree

MAX_BYTES = 20 * 1024 * 1024


class TrackError(ValueError):
    """El fitxer no es pot importar. El missatge es mostra a l'usuari."""


class Point(NamedTuple):
    lat: float
    lon: float
    ele: float | None
    time: datetime | None


class Track(NamedTuple):
    name: str
    kind: str  # "activity" o "planned"
    type: str  # "hike", "trail_run" o "run"
    source_format: str
    points: list[Point]


def _gpx(data: bytes):
    # defusedxml rebutja l'XML maliciós abans que gpxpy llegeixi el fitxer.
    ElementTree.fromstring(data)
    gpx = gpxpy.parse(data)
    found = [p for t in gpx.tracks for s in t.segments for p in s.points]
    # Una ruta planificada sovint només té punts de ruta (<rte>).
    found = found or [p for r in gpx.routes for p in r.points]
    points = [(p.latitude, p.longitude, p.elevation, p.time) for p in found]
    first = (gpx.tracks or gpx.routes or [None])[0]
    return points, first and first.name, first and first.type


def _tcx(data: bytes):
    root = ElementTree.fromstring(data)

    def number(el, path):
        text = el.findtext(path)
        return float(text) if text and text.strip() else None

    def time(el):
        try:
            return datetime.fromisoformat(el.findtext("{*}Time", "").strip())
        except ValueError:
            return None

    points = [
        (
            number(el, "{*}Position/{*}LatitudeDegrees"),
            number(el, "{*}Position/{*}LongitudeDegrees"),
            number(el, "{*}AltitudeMeters"),
            time(el),
        )
        for el in root.findall(".//{*}Trackpoint")
    ]
    activity = root.find(".//{*}Activity")
    sport = activity.get("Sport") if activity is not None else None
    return points, root.findtext(".//{*}Course/{*}Name"), sport


def _fit(data: bytes):
    points = []
    sport = ""
    with fitdecode.FitReader(io.BytesIO(data)) as fit:
        for frame in fit:
            if not isinstance(frame, fitdecode.FitDataMessage):
                continue
            value = partial(frame.get_value, fallback=None)
            if frame.name == "record":
                lat, lon = value("position_lat"), value("position_long")
                ele = value("enhanced_altitude")
                points.append(
                    (
                        # FIT desa les coordenades en semicercles.
                        None if lat is None else lat * 180 / 2**31,
                        None if lon is None else lon * 180 / 2**31,
                        value("altitude") if ele is None else ele,
                        value("timestamp"),
                    )
                )
            elif frame.name in ("sport", "session") and not sport:
                sport = f"{value('sport') or ''} {value('sub_sport') or ''}"
    return points, None, sport


_READERS = {"gpx": _gpx, "tcx": _tcx, "fit": _fit}


def parse(filename: str, data: bytes) -> Track:
    path = PurePath(filename)
    fmt = path.suffix[1:].lower()
    if fmt not in _READERS:
        raise TrackError("Only GPX, FIT and TCX files can be imported.")
    if len(data) > MAX_BYTES:
        raise TrackError("The file is larger than 20 MB.")
    try:
        raw, name, sport = _READERS[fmt](data)
    except Exception as exc:  # Un fitxer malformat no ha d'aturar el servidor
        raise TrackError(f"The file is not a valid {fmt.upper()} file.") from exc
    # Neteja els punts sense coordenades o amb coordenades impossibles.
    points = [
        # Hores en UTC; una hora sense zona es considera UTC.
        Point(
            lat,
            lon,
            ele,
            time
            and (
                time.replace(tzinfo=UTC)
                if time.tzinfo is None
                else time.astimezone(UTC)
            ),
        )
        for lat, lon, ele, time in raw
        if lat is not None and lon is not None and abs(lat) <= 90 and abs(lon) <= 180
    ]
    if len(points) < 2:
        raise TrackError("The file has no track with at least two points.")

    sport = (sport or "").lower()
    return Track(
        name=(name or path.stem).strip().removesuffix(" - Wikiloc"),
        kind="activity" if all(p.time for p in points) else "planned",
        type="trail_run" if "trail" in sport else "run" if "run" in sport else "hike",
        source_format=fmt,
        points=points,
    )
