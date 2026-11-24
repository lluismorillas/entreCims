"""Model de temps (F3): trams, referències, ajust i API, amb tracks sintètics."""

import math
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from conftest import upload

import timing
from importers import Point
from timing import TOBLER, Model, naismith, speed

START = datetime(2026, 6, 1, 8, tzinfo=UTC)
TRUE = Model(5.0, 4.0, 2.0)  # el ritme amb què caminen els tracks sintètics
LEGS = ((600, 0.12), (400, 0.0), (600, -0.12), (300, -0.25), (300, 0.25))


def walk(model=TRUE, start=START, legs=LEGS, stop_s=0) -> list[Point]:
    """Un punt cada 10 m cap al nord, amb l'hora que marca `model`. `stop_s`: parada a mig camí."""
    points, x, ele, t = [], 0.0, 1000.0, start
    for metres, slope in legs:
        for _ in range(int(metres / 10)):
            points.append(Point(42 + x / 111195, 2.0, ele, t))
            if stop_s and len(points) == 50:
                for k in range(1, stop_s // 10 + 1):
                    points.append(
                        Point(42 + x / 111195, 2.0, ele, t + timedelta(seconds=10 * k))
                    )
                t += timedelta(seconds=stop_s)
            x += 10
            ele += 10 * slope
            t += timedelta(seconds=10 / (speed(model, slope) / 3.6))
    points.append(Point(42 + x / 111195, 2.0, ele, t))
    return points


def gpx(points: list[Point], name="Hike") -> bytes:
    rows = "".join(
        f'<trkpt lat="{p.lat}" lon="{p.lon}"><ele>{p.ele}</ele><time>{p.time.isoformat()}</time></trkpt>'
        for p in points
    )
    return (
        '<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">'
        f"<trk><name>{name}</name><type>hiking</type><trkseg>{rows}</trkseg></trk></gpx>"
    ).encode()


def test_tobler_and_naismith_known_values():
    assert speed(TOBLER, -0.05) == pytest.approx(6.0)
    assert speed(TOBLER, 0) == pytest.approx(6 * math.exp(-0.175))
    assert speed(TOBLER, 0.1) == pytest.approx(3.549, abs=0.001)
    assert speed(TOBLER, -0.15) == pytest.approx(
        speed(TOBLER, 0.05)
    )  # simètric al voltant de s0
    assert naismith(10_000, 600) == pytest.approx(3 * 3600)


def test_segments_split_by_distance_and_leave_stops_out():
    dist = [10.0 * i for i in range(101)]
    ele = [0.1 * d for d in dist]
    times = [START + timedelta(seconds=10 * i) for i in range(101)]
    flags = [i % 10 != 5 for i in range(101)]  # un pas aturat a cada tram
    segs = timing.segments(dist, ele, times, flags)
    assert [round(s.length) for s in segs] == [100] * 10
    assert all(s.slope == pytest.approx(0.1) for s in segs)
    assert all(s.moving_s == 90 for s in segs)
    # Ruta planificada: sense hores, i l'últim tram curt també hi és.
    planned = timing.segments(dist[:16], ele[:16])
    assert [round(s.length) for s in planned] == [100, 50]
    assert planned[0].moving_s is None


def test_fit_recovers_the_parameters_despite_outliers():
    data = [(s / 100, speed(TRUE, s / 100), 100.0) for s in range(-30, 31)]
    data += [
        (s / 100, speed(TRUE, s / 100) * 3, 100.0) for s in range(-30, 31, 10)
    ]  # salts del GPS
    m = timing.fit(data)
    assert (m.v0, m.ku, m.kd) == pytest.approx(TRUE[:3], rel=0.02)


def test_training_recovers_the_walker_and_shrinks_to_tobler_with_few_hikes():
    h = timing.hike(walk())
    own = timing.train([h], n0=0)
    assert (own.v0, own.ku, own.kd) == pytest.approx(TRUE[:3], rel=0.1)
    # Amb una sola sortida i N0 molt gran, gairebé tot és Tobler (FR-304).
    shrunk = timing.train([h], n0=1000)
    assert (shrunk.ku, shrunk.kd) == pytest.approx(TOBLER[1:3], rel=0.01)
    # La velocitat és sempre la pròpia: Tobler camina, i alentiria els models de cursa.
    assert shrunk.v0 == own.v0
    # Amb N0 = 1, a mig camí.
    half = timing.train([h], n0=1)
    assert half.ku == pytest.approx((own.ku + TOBLER.ku) / 2, rel=0.01)


def test_recent_hikes_weigh_more():
    old = timing.hike(walk(Model(3.0, 4.0, 2.0), START - timedelta(days=720)))
    new = timing.hike(walk(Model(6.0, 4.0, 2.0), START))
    m = timing.train([old, new], n0=0, half_life=180)
    assert m.v0 == pytest.approx(6.0, rel=0.1)
    # Sense pes per recència, queda entre tots dos.
    assert 3.5 < timing.train([old, new], n0=0, half_life=math.inf).v0 < 5.5


def test_prediction_and_stops_of_a_known_walk():
    h = timing.hike(walk(stop_s=600))
    assert timing.stop_rate([h]) == pytest.approx(600 / h.moving_s, rel=0.1)
    assert timing.stop_rate([]) is None
    # Sense valls en V: un tram que en creua una té el pendent mitjà, però costa molt més.
    smooth = timing.hike(walk(legs=((600, 0.12), (400, 0.0), (600, -0.12))))
    assert timing.predict(TRUE, smooth.segments()) == pytest.approx(
        smooth.moving_s, rel=0.02
    )
    # Amb menys de 3 sortides la dispersió no es pot mesurar.
    assert timing.sigma([h], [h.moving_s]) == timing.DEFAULT_SIGMA


def outing(distance_m, ascent_m, moving_s):
    return SimpleNamespace(distance_m=distance_m, ascent_m=ascent_m, moving_s=moving_s)


def test_calibrate_recovers_coefficients_and_never_goes_negative():
    exact = [
        outing(d, a, 0.8 * d + 5 * a)
        for d, a in [(5000, 200), (10000, 900), (8000, 100)]
    ]
    assert timing.calibrate(exact) == pytest.approx((0.8, 5.0))
    # La pujada fa anar més de pressa en aquestes dades: b seria negatiu i queda a 0.
    odd = [outing(5000, 1000, 3000), outing(10000, 0, 9000), outing(8000, 500, 6000)]
    a, b = timing.calibrate(odd)
    assert a > 0 and b == 0


def test_calibrate_without_outings_is_classic_naismith():
    assert timing.calibrate([]) == timing.NAISMITH


# ── API ─────────────────────────────────────────────────────────────────────


def test_each_type_has_its_own_model_and_versions(client):
    def model(kind):
        return client.get("/api/model", params={"type": kind}).json()

    assert model("hike")["version"] is None  # encara Tobler
    [result] = upload(client, ("a.gpx", gpx(walk(stop_s=600))))
    hike = model("hike")
    assert (hike["type"], hike["n_activities"]) == ("hike", 1)
    assert hike["v0"] != TOBLER.v0 and hike["stop_rate"] > 0
    assert len(hike["curve"]) == 41 and hike["curve"][20][0] == 0
    assert (model("run")["version"], model("run")["n_activities"]) == (None, 0)

    # Canviar el tipus la passa d'un model a l'altre, i cadascun en desa una versió nova.
    activity_id = result["activity"]["id"]
    client.patch(f"/api/activities/{activity_id}", json={"type": "run"})
    assert (model("hike")["n_activities"], model("run")["n_activities"]) == (0, 1)
    assert model("run")["v0"] == hike["v0"]  # el mateix track, el mateix ajust
    client.patch(f"/api/activities/{activity_id}", json={"type": "hike"})
    assert (model("hike")["n_activities"], model("run")["n_activities"]) == (1, 0)

    versions = model("hike")["version"]
    client.delete(f"/api/activities/{activity_id}")
    after = model("hike")
    assert after["version"] > versions
    assert (after["n_activities"], after["v0"]) == (0, TOBLER.v0)
    assert client.get("/api/model", params={"type": "bike"}).status_code == 422


def test_prediction_endpoint(client):
    route = [[p.lon, p.lat, p.ele] for p in walk()]
    tobler = client.post("/api/predictions", json={"points": route}).json()
    assert (
        tobler["n_activities"] == 0 and tobler["total_s"] is None
    )  # parades desconegudes
    assert tobler["moving_low_s"] < tobler["moving_s"] < tobler["moving_high_s"]

    upload(client, ("a.gpx", gpx(walk(stop_s=600))))
    own = client.post("/api/predictions", json={"points": route}).json()
    assert own["n_activities"] == 1 and own["total_s"] > own["moving_s"]
    assert own["moving_s"] != pytest.approx(tobler["moving_s"])

    # Les curses prediuen amb Naismith calibrat; sense cap cursa, és el Naismith clàssic.
    run = client.post("/api/predictions", json={"points": route, "type": "run"}).json()
    assert (run["type"], run["method"], run["n_activities"]) == ("run", "naismith", 0)
    stats = timing.analyse([Point(lat, lon, ele, None) for lon, lat, ele in route])
    assert run["moving_s"] == pytest.approx(naismith(stats.distance_m, stats.ascent_m))

    no_elevation = client.post(
        "/api/predictions", json={"points": [[2, 42], [2, 42.01]]}
    )
    assert (
        no_elevation.status_code == 422
        and "no elevation" in no_elevation.json()["detail"]
    )


def test_history_rebuilds_the_model_outing_by_outing(client):
    slow = walk(Model(3.0, 4.0, 2.0), START - timedelta(days=30))
    fast = walk(Model(6.0, 4.0, 2.0), START)
    upload(client, ("slow.gpx", gpx(slow, "Slow")), ("fast.gpx", gpx(fast, "Fast")))
    h = client.get("/api/model/history", params={"type": "hike"}).json()
    first, second = h["outings"]
    assert (first["name"], second["name"], h["method"]) == ("Slow", "Fast", "model")
    # La primera no tenia res abans per predir-la; la segona, el model fet amb la primera.
    assert first["predicted_s"] is None
    assert second["predicted_s"] > second["moving_s"]  # el model lent preveia més temps
    assert (
        first["flat_kmh"] < second["flat_kmh"]
    )  # i després de la ràpida, va més de pressa
    assert [v["n_activities"] for v in h["versions"]] == [2]


def test_deviations_colour_each_segment_against_the_model(client):
    [result] = upload(client, ("a.gpx", gpx(walk(stop_s=600))))
    d = client.get(f"/api/activities/{result['activity']['id']}/deviations").json()
    assert (d["type"], d["method"]) == ("hike", "model")
    values = [s["deviation"] for s in d["segments"]]
    assert len(values) >= 15 and all(len(s["coordinates"]) >= 2 for s in d["segments"])
    # El model està fet amb aquesta mateixa sortida: la majoria de trams, a prop del previst.
    near = [v for v in values if v is not None and abs(v) < 0.1]
    assert len(near) > len(values) / 2
    assert client.get("/api/activities/nope/deviations").status_code == 404
