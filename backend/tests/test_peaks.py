"""Casos límit de la detecció de cims amb tracks sintètics, i els endpoints de cims."""

from datetime import UTC, datetime, timedelta
from math import cos, hypot, radians

import pytest
from conftest import upload

import peaks
from peaks import PARAMS, Peak

LAT, LON = 42.0, 2.0
START = datetime(2026, 6, 1, 10, tzinfo=UTC)


def at(x: float, y: float) -> tuple[float, float]:
    """Latitud i longitud d'un punt a x metres a l'est i y al nord del cim de referència."""
    return LAT + y / peaks.M_PER_DEG, LON + x / (peaks.M_PER_DEG * cos(radians(LAT)))


def make(points: list[tuple[float, float, float | None]]):
    """Track amb un punt cada 10 s a partir de (x, y, altitud)."""
    rows, dist = [], 0.0
    for i, (x, y, ele) in enumerate(points):
        if i:
            px, py, _ = points[i - 1]
            dist += hypot(x - px, y - py)
        rows.append(
            (*at(x, y), ele, dist, (START + timedelta(seconds=10 * i)).isoformat())
        )
    return peaks.track(rows)


def judge(t, x=0.0, ele: float | None = 1500.0, prm=PARAMS):
    peak = Peak(1, *at(x, 0), ele)
    return peaks.judge(t, peak, *peaks.distances(t, peak), prm)


def summit(x: float) -> float:
    return 1500 - 0.2 * abs(x)


XS = range(-500, 501, 10)


def test_crossing_the_summit_is_reached_with_high_confidence():
    t = make([(x, 0, summit(x)) for x in XS])
    r = judge(t)
    # Passa per sobre del cim (menys de C): el màxim local no cal comprovar-lo.
    assert (r.detected, r.confidence, r.is_local_max) == (True, "high", None)
    assert judge(t, prm=PARAMS._replace(c=0)).is_local_max
    assert r.min_dist_m == pytest.approx(0, abs=0.01)
    # La mediana de 5 punts retalla la punta d'un cim agut: per això existeix el marge M.
    assert 0 <= r.ele_gap_m <= 2


def test_distance_is_measured_to_segments_not_points():
    # Punts cada 200 m: cap punt és a menys de 50 m del cim, però el segment hi passa per sobre.
    t = make([(x, 0, summit(x)) for x in range(-500, 501, 200)])
    assert judge(t).min_dist_m == pytest.approx(0, abs=0.01)


def test_passing_below_the_summit_is_not_reached():
    # Flanqueig a 40 m en planta, 60 m per sota i pujant suau: ni altitud ni màxim local.
    t = make([(x, 40, 1440 + 0.05 * x) for x in XS])
    r = judge(t)
    assert not r.detected
    assert r.min_dist_m == pytest.approx(40, abs=0.1)
    assert r.ele_gap_m > PARAMS.m and r.is_local_max is False
    # Sense `ele` al cim només queda el màxim local, i també el descarta.
    assert not judge(t, ele=None).detected


def test_out_and_back_is_one_achievement_at_the_first_pass():
    there = [(x, 0, summit(x)) for x in range(-500, 1, 10)]
    t = make(there + there[-2::-1])
    r = judge(t)
    assert r.detected
    assert t.time[r.index] == (START + timedelta(seconds=500)).isoformat()


def test_ridge_with_two_close_peaks_evaluates_each_one():
    # Dos cims a 150 m, separats per un coll 15 m més baix que el més alt.
    def ridge(x):
        return max(1500 - 0.2 * abs(x), 1495 - 0.2 * abs(x - 150))

    t = make([(x, 0, ridge(x)) for x in XS])
    assert judge(t, x=0).detected
    assert judge(t, x=150, ele=1495).detected
    # El track fa el primer i flanqueja el segon 40 m per sota: només compta el primer.
    t = make(
        [(x, 0, summit(x)) for x in range(-500, 1, 10)]
        + [(x, 0, 1500 - 0.3 * x) for x in range(10, 501, 10)]
    )
    assert judge(t, x=0).detected
    assert not judge(t, x=150, ele=1495).detected


def test_stopping_the_recording_at_the_summit_is_reached():
    t = make([(x, 0, summit(x)) for x in range(-500, 1, 10)])
    assert judge(t).detected
    # També com a màxim local: n'hi ha prou amb el costat de pujada.
    assert judge(t, prm=PARAMS._replace(c=0)).is_local_max


def test_starting_the_recording_at_the_summit_is_reached():
    assert judge(make([(x, 0, summit(x)) for x in range(0, 501, 10)])).detected


def test_peak_without_ele_uses_proximity_and_local_max_with_low_confidence():
    r = judge(make([(x, 0, summit(x)) for x in XS]), ele=None)
    assert (r.detected, r.confidence, r.ele_gap_m) == (True, "low", None)


def test_gps_altitude_offset_within_the_margin_is_reached_and_beyond_it_is_not():
    t = make([(x, 0, summit(x) - 15) for x in XS])
    assert judge(t).detected
    # Error documentat: amb el GPS 30 m per sota, el marge M de 20 m no n'hi ha prou.
    t = make([(x, 0, summit(x) - 30) for x in XS])
    assert not judge(t).detected


def test_a_single_altitude_spike_does_not_make_a_summit():
    # La mediana curta treu un pic aïllat que faria creure que s'ha arribat a dalt.
    t = make([(x, 40, 1440 + (60 if x == 0 else 0)) for x in XS])
    assert not judge(t).detected


def test_track_without_altitude_is_not_analysed():
    assert make([(0, 0, None), (10, 0, None)]) is None


def test_flat_summit_crossed_close_is_reached_without_a_local_max():
    # Cim pla: el perfil no baixa P metres en tota la finestra.
    t = make([(x, 5, 1495 + 0.001 * x) for x in XS])
    assert judge(t).detected
    # Sense el nivell de prop (C = 0), el màxim local el rebutjaria.
    assert not judge(t, prm=PARAMS._replace(c=0)).detected


def test_point_on_a_descending_ridge_is_reached_when_crossed():
    t = make([(x, 10, 1500 - 0.1 * x) for x in XS])
    assert judge(t).detected


def test_passing_beside_at_the_summit_altitude_needs_a_local_max():
    # A 40 m (més que C) i a l'altitud del cim, però el camí continua pujant: flanqueig.
    t = make([(x, 40, 1495 + 0.1 * x) for x in XS])
    r = judge(t)
    assert r.ele_gap_m <= PARAMS.m and r.is_local_max is False and not r.detected


def test_references_ignore_the_local_max():
    t = make([(x, 40, 1490 + 0.05 * x) for x in XS])
    assert not judge(t).detected
    assert judge(t, prm=peaks.Params(r=100, m=80, w=0, p=0, local=False)).detected


# ── API ─────────────────────────────────────────────────────────────────────


def gpx(points, name="Summit day", timed=True) -> bytes:
    rows = "".join(
        f'<trkpt lat="{lat}" lon="{lon}">'
        + ("" if ele is None else f"<ele>{ele}</ele>")
        + (
            f"<time>{(START + timedelta(seconds=10 * i)).isoformat()}</time>"
            if timed
            else ""
        )
        + "</trkpt>"
        for i, (x, y, ele) in enumerate(points)
        for lat, lon in [at(x, y)]
    )
    return (
        '<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">'
        f"<trk><name>{name}</name><type>hiking</type><trkseg>{rows}</trkseg></trk></gpx>"
    ).encode()


def element(osm_id, x, y, ele="1500", name="Puig"):
    lat, lon = at(x, y)
    tags = {"natural": "peak", "name": name} | ({"ele": ele} if ele else {})
    return {"type": "node", "id": osm_id, "lat": lat, "lon": lon, "tags": tags}


@pytest.fixture
def overpass(monkeypatch):
    found = [
        element(1, 0, 0),
        element(2, 20, 0, ele=None),  # duplicat sense altitud: es fusiona amb l'1
        element(3, 0, 1000, name="Lluny"),
    ]
    monkeypatch.setattr(peaks, "_overpass", lambda boxes: found)
    return found


def download(client, south=41.9, west=1.9, north=42.1, east=2.1):
    response = client.post(
        "/api/peaks/download",
        json={"south": south, "west": west, "north": north, "east": east},
    )
    return response


def lines(response):
    import json

    return [json.loads(line) for line in response.text.splitlines()]


def test_download_merges_duplicates_and_detects_existing_activities(client, overpass):
    [result] = upload(client, ("a.gpx", gpx([(x, 0, summit(x)) for x in XS])))
    activity_id = result["activity"]["id"]
    assert (
        client.get(f"/api/activities/{activity_id}").json()["peaks_status"]
        == "no_peaks"
    )

    progress = lines(download(client))
    assert progress[1] == {"stage": "saved", "peaks": 2, "merged": 1}
    assert progress[-2:] == [
        {"stage": "analyse", "done": 1, "total": 1},
        {"stage": "done"},
    ]

    detail = client.get(f"/api/activities/{activity_id}").json()
    assert detail["peaks_status"] == "ok"
    [candidate] = detail["peaks"]
    assert (candidate["name"], candidate["reached"], candidate["confidence"]) == (
        "Puig",
        True,
        "high",
    )
    assert candidate["first_passed_at"] == (START + timedelta(seconds=500)).isoformat()
    assert candidate["dist_m"] == pytest.approx(500, abs=1)

    # Tornar a descarregar no duplica res.
    assert lines(download(client))[1]["peaks"] == 2


def test_import_detects_peaks_and_the_global_list_counts_visits(client, overpass):
    download(client)
    upload(client, ("a.gpx", gpx([(x, 0, summit(x)) for x in XS], "First")))
    upload(
        client,
        ("b.gpx", gpx([(x, 0, summit(x)) for x in range(-500, 1, 10)], "Second")),
    )
    [peak] = client.get("/api/peaks/reached").json()
    assert peak["name"] == "Puig"
    assert sorted(v["activity_name"] for v in peak["visits"]) == ["First", "Second"]


def test_manual_label_survives_a_rerun(client, overpass):
    download(client)
    [result] = upload(client, ("a.gpx", gpx([(x, 0, summit(x)) for x in XS])))
    activity_id = result["activity"]["id"]
    peak_id = client.get(f"/api/activities/{activity_id}").json()["peaks"][0]["id"]

    url = f"/api/activities/{activity_id}/peaks/{peak_id}"
    rejected = client.put(url, json={"reached": False}).json()
    assert (rejected["detected"], rejected["manual_label"], rejected["reached"]) == (
        True,
        False,
        False,
    )
    assert client.post("/api/analysis/rerun").json() == {"activities": 1}
    assert (
        client.get(f"/api/activities/{activity_id}").json()["peaks"][0]["reached"]
        is False
    )
    assert client.get("/api/peaks/reached").json() == []

    assert client.put(url, json={"reached": None}).json()["reached"] is True
    assert (
        client.put(
            f"/api/activities/{activity_id}/peaks/999", json={"reached": True}
        ).status_code
        == 404
    )


def test_track_without_altitude_reports_it(client, overpass):
    download(client)
    [result] = upload(client, ("a.gpx", gpx([(x, 0, None) for x in XS])))
    detail = client.get(f"/api/activities/{result['activity']['id']}").json()
    assert (detail["peaks_status"], detail["peaks"]) == ("no_elevation", [])


def test_region_too_large_or_unreachable(client, monkeypatch):
    assert download(client, north=45).status_code == 422

    def fail(boxes):
        raise OSError("offline")

    monkeypatch.setattr(peaks, "_overpass", fail)
    assert "could not answer" in lines(download(client))[-1]["error"]


def test_first_start_downloads_the_default_region_once(client, monkeypatch):
    calls = []

    def region(name):
        calls.append(name)
        return [element(1, 0, 0)]

    monkeypatch.setattr(peaks, "_region", region)
    monkeypatch.setattr(peaks, "DEFAULT_REGION", "Catalunya")
    [result] = upload(client, ("a.gpx", gpx([(x, 0, summit(x)) for x in XS])))
    peaks.store([element(9, 0, 1000, name="Already here")])  # cims d'una altra zona
    peaks.download_default()
    peaks.download_default()  # ja descarregada: no hi torna
    assert calls == ["Catalunya"]
    monkeypatch.setattr(peaks, "DEFAULT_REGION", "Andorra")
    peaks.download_default()
    assert calls == ["Catalunya", "Andorra"]
    detail = client.get(f"/api/activities/{result['activity']['id']}").json()
    assert [p["reached"] for p in detail["peaks"]] == [True]


def test_first_start_offline_leaves_it_for_the_next_start(client, monkeypatch):
    def offline(name):
        raise OSError("offline")

    monkeypatch.setattr(peaks, "_region", offline)
    monkeypatch.setattr(peaks, "DEFAULT_REGION", "Catalunya")
    peaks.download_default()
    assert client.get("/api/peaks/reached").json() == []


def test_areas_index_and_download_by_name(client, monkeypatch):
    names = {a["name"]: a for a in client.get("/api/peaks/areas").json()}
    assert names["Catalunya"]["relation"] == 349053
    assert names["Suïssa"]["kind"] == "País"

    queries = []

    def query(body):
        queries.append(body)
        return [element(1, 0, 0)] if "349053" in body else []

    monkeypatch.setattr(peaks, "_query", query)
    # De l'índex, sense distingir majúscules: per l'id de la relació.
    progress = lines(
        client.post("/api/peaks/download-area", json={"name": " catalunya "})
    )
    assert queries[-1].startswith("area(id:3600349053)")
    assert progress[1] == {"stage": "saved", "peaks": 1, "merged": 0}
    # Fora de l'índex: pel nom. Si no hi ha cap cim, s'avisa.
    progress = lines(client.post("/api/peaks/download-area", json={"name": "Nowhere"}))
    assert '["name"="Nowhere"]' in queries[-1]
    assert "No peaks found" in progress[-1]["error"]
    assert client.post("/api/peaks/download-area", json={"name": ""}).status_code == 422


def test_overpass_status(client, monkeypatch):
    import urllib.error

    def answers(request, timeout):
        raise urllib.error.HTTPError(request.full_url, 400, "no query", {}, None)

    def silent(request, timeout):
        raise TimeoutError("timed out")

    monkeypatch.setattr(peaks.urllib.request, "urlopen", answers)
    assert client.get("/api/status/overpass").json() == {"up": True}
    monkeypatch.setattr(peaks.urllib.request, "urlopen", silent)
    assert client.get("/api/status/overpass").json() == {"up": False}
