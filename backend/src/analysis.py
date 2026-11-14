"""Estadístiques d'un track: distància, desnivell, temps total i temps en moviment (FR-105)."""

import itertools
from math import asin, cos, radians, sin, sqrt
from typing import NamedTuple

from importers import Point

# Paràmetres configurables
SMOOTH_M = 15 #mitja finestra del suavitzat de l'altitud, en metres de recorregut
STOP_SPEED_MS = 0.3 #per sota d'aquesta velocitat, el punt és una parada
STOP_WINDOW_S = 30 # finestra on es mesura la velocitat
MAX_SPEED_MS = 12 # un punt que hi arriba i en surt més de pressa és un salt del GPS

class Stats(NamedTuple):
    points: list[Point] #sense els salts impossibles
    dist_m: list[float] #distància acumulada de cada punt
    ele_smooth_m: list[float] | None #None si algun punt no té altitud
    distance_m: float
    ascent_m: float | None
    descent_m: float | None
    total_s: float | None  #None si algun punt no té hora
    moving_s: float | None

def distance(a: Point, b: Point) -> float:
    """Distància del cercle màxim, en metres."""
    h = (
        sin(radians(b.lat - a.lat) / 2) ** 2
        + cos(radians(a.lat))
        * cos(radians(b.lat))
        * sin(radians(b.lon - a.lon) / 2) ** 2
    )
    return 2 * 6371000 * asin(sqrt(h))

def _drop_spikes(points: list[Point]) -> list[Point]:
    def fast(a: Point, b: Point) -> bool:
        dt = (b.time - a.time).total_seconds()
        return dt > 0 and distance(a, b) / dt > MAX_SPEED_MS
    #Només punts aïllats: mirar els dos veïns evita descartar la resta del track en cadena.
    return [
        p
        for i, p in enumerate(points)
        if not (
            0 < i < len(points) - 1
            and fast(points[i - 1], p)
            and fast(p, points[i + 1])
        )
    ]

def _smooth(dist: list[float], ele: list[float]) -> list[float]:
    """Mitjana dels punts a menys de SMOOTH_M de recorregut. Rebaixa els màxims: no serveix per als cims."""
    prefix = [0.0]
    for e in ele:
        prefix.append(prefix[-1] + e)
    out = []
    lo = hi = 0
    for d in dist:
        while dist[lo] < d - SMOOTH_M:
            lo += 1
        while hi + 1 < len(dist) and dist[hi + 1] <= d + SMOOTH_M:
            hi += 1
        out.append((prefix[hi + 1] - prefix[lo]) / (hi + 1 - lo))
    return out

def moving(points: list[Point]) -> list[bool]:
    """Per a cada punt, si s'hi arriba en moviment. El primer sempre és False."""
    flags = [False]
    lo = 0
    for i in range(1, len(points)):
        # Desplaçament en línia recta dins la finestra: el tremolor del GPS d'una parada no suma.
        while (lo < i - 1 and (points[i].time - points[lo].time).total_seconds() > STOP_WINDOW_S):
            lo += 1
        dt = (points[i].time - points[lo].time).total_seconds()
        flags.append(dt > 0 and distance(points[lo], points[i]) / dt > STOP_SPEED_MS)
    return flags

def analyse(points: list[Point]) -> Stats:
    timed = all(p.time for p in points)
    if timed:
        points = _drop_spikes(points)

    dist = [0.0]
    for a, b in itertools.pairwise(points):
        dist.append(dist[-1] + distance(a, b))

    smooth = ascent = descent = None
    if all(p.ele is not None for p in points):
        smooth = _smooth(dist, [p.ele for p in points])
        steps = [b - a for a, b in itertools.pairwise(smooth)]
        ascent = sum(s for s in steps if s > 0)
        descent = -sum(s for s in steps if s < 0)
    total = moving_s = None

    if timed:
        total = (points[-1].time - points[0].time).total_seconds()
        moving_s = sum(
            (b.time - a.time).total_seconds()
            for a, b, is_moving in zip(points, points[1:], moving(points)[1:])
            if is_moving
        )
    return Stats(points, dist, smooth, dist[-1], ascent, descent, total, moving_s)
