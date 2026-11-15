from datetime import UTC, datetime, timedelta

import pytest

from analysis import analyse
from importers import Point

T0 = datetime(2026, 1, 1, 10, tzinfo=UTC)
M = 1 / 111195  # metre de latitud, en graus


def walk(seconds_and_speeds, ele=None):
    """Punts cada segon cap al nord, a la velocitat (m/s) de cada tram."""
    points = [Point(0, 0, ele, T0)]
    for seconds, speed in seconds_and_speeds:
        for _ in range(seconds):
            last = points[-1]
            points.append(
                Point(last.lat + speed * M, 0, ele, last.time + timedelta(seconds=1))
            )
    return points


def test_known_distance_and_climb():
    # 1 km al +10 % i 1 km al -10 %, sense hores: una ruta planificada.
    stats = analyse(
        [
            Point(0, 0, 100, None),
            Point(1000 * M, 0, 200, None),
            Point(2000 * M, 0, 100, None),
        ]
    )
    assert stats.distance_m == pytest.approx(2000, abs=1)
    assert (stats.ascent_m, stats.descent_m) == pytest.approx((100, 100))
    assert stats.dist_m == pytest.approx([0, 1000, 2000], abs=1)
    assert (stats.total_s, stats.moving_s) == (None, None)


def test_smoothing_removes_altitude_noise():
    points = [p._replace(ele=500 + (i % 2)) for i, p in enumerate(walk([(600, 1)]))]
    stats = analyse(points)
    assert stats.ascent_m < 10  # sense suavitzar serien 300 m
    assert stats.ele_smooth_m[300] == pytest.approx(500.5, abs=0.02)


def test_without_elevation_there_is_no_climb():
    stats = analyse(walk([(10, 1)]))
    assert (stats.ascent_m, stats.descent_m, stats.ele_smooth_m) == (None, None, None)
    assert stats.distance_m == pytest.approx(10, abs=0.01)


def test_a_stop_does_not_count_as_moving_time():
    stats = analyse(walk([(300, 1), (600, 0), (300, 1)]))
    assert stats.total_s == 1200
    assert stats.moving_s == pytest.approx(600, abs=STOP_LAG_S)


def test_a_recording_pause_does_not_count_as_moving_time():
    points = walk([(300, 1)])
    resumed = [
        p._replace(time=p.time + timedelta(hours=1), lat=p.lat + 300 * M)
        for p in walk([(300, 1)])
    ]
    stats = analyse(points + resumed)
    assert stats.total_s == 3900
    assert stats.moving_s == pytest.approx(600, abs=1)


def test_an_isolated_gps_jump_is_dropped():
    points = walk([(20, 1)])
    points[10] = points[10]._replace(lat=points[10].lat + 5000 * M)
    stats = analyse(points)
    assert len(stats.points) == 20
    assert stats.distance_m == pytest.approx(20, abs=0.01)


STOP_LAG_S = 30  # triga a notar que la parada comença i que s'acaba
