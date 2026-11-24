"""Model de temps personalitzat: trams, ajust, referències i predicció.

La velocitat té la forma de Tobler amb la pujada i la baixada separades:
    v(s) = v0 · exp(-ku · (s - s0))  si s >= s0
    v(s) = v0 · exp(-kd · (s0 - s))  si s <  s0
Amb s0 fix, log v és lineal en (log v0, ku, kd): l'ajust són mínims quadrats ponderats.
"""

import json
import math
import os
import statistics
import threading
from datetime import datetime
from typing import Literal, NamedTuple, get_args

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

import db
from analysis import analyse, moving
from importers import Point

router = APIRouter(prefix="/api")

SEGMENT_M = 100  # longitud dels trams, en metres
S0 = -0.05  # pendent de velocitat màxima, fix com a Tobler
# Un model per tipus d'activitat a peu. La bici queda fora: la forma de Tobler no hi encaixa.
Kind = Literal["hike", "trail_run", "run"]
KINDS: tuple[Kind, ...] = get_args(Kind)
# Criteri d'exclusió de l'ajust: pendents de més del 50 % són errors d'altitud o grimpades, i
# per sobre d'aquestes velocitats és un salt del GPS o un tram d'un altre tipus.
MAX_SLOPE = 0.5
MAX_KMH: dict[str, float] = {"hike": 12, "trail_run": 20, "run": 25}
# Mètode amb què prediu cada tipus: el que guanya a l'avaluació (docs/evaluation.md). En les
# curses, el soroll de l'altitud en trams curts i el canvi entre córrer i caminar fan que el
# model propi perdi davant de Naismith calibrat amb les curses de l'usuari.
METHOD: dict[str, str] = {"hike": "model", "trail_run": "naismith", "run": "naismith"}
NAISMITH = (
    3600 / 5000,
    3600 / 600,
)  # segons per metre recorreguts i per metre de pujada
HALF_LIFE_DAYS = float(
    os.environ.get("ENTRECIMS_HALF_LIFE_DAYS", "180")
)  # pes de les sortides antigues
N0 = 5  # amb N0 sortides, el model propi i Tobler pesen igual
Z90 = 1.645  # interval del 90 %
DEFAULT_SIGMA = 0.25  # dispersió quan hi ha massa poques sortides per mesurar-la


class Model(NamedTuple):
    v0: float  # km/h
    ku: float
    kd: float
    s0: float = S0


TOBLER = Model(6.0, 3.5, 3.5)


def speed(m: Model, s: float) -> float:
    """Velocitat en km/h amb pendent `s` (0,1 = 10 %)."""
    k = m.ku * (s - m.s0) if s >= m.s0 else m.kd * (m.s0 - s)
    return m.v0 * math.exp(-k)


def naismith(distance_m: float, ascent_m: float) -> float:
    """Segons: 5 km/h més 1 hora per cada 600 m de pujada."""
    return distance_m / 5000 * 3600 + ascent_m / 600 * 3600


class Segment(NamedTuple):
    length: float  # m
    slope: float
    moving_s: float | None  # None en una ruta planificada
    start: int = 0  # índexs del primer i l'últim punt, per dibuixar-lo
    end: int = 0


def segments(dist, ele, times=None, flags=None, length=SEGMENT_M) -> list[Segment]:
    """Trams d'uns `length` metres de recorregut. Les parades no compten al temps.

    L'últim tram, més curt, també hi és: la predicció ha de cobrir tota la ruta.
    """
    out, start = [], 0
    for i in range(1, len(dist)):
        if dist[i] - dist[start] < length and i < len(dist) - 1:
            continue
        d = dist[i] - dist[start]
        if d > 0:
            t = None
            if times:
                t = sum(
                    (times[j] - times[j - 1]).total_seconds()
                    for j in range(start + 1, i + 1)
                    if flags[j]
                )
            out.append(Segment(d, (ele[i] - ele[start]) / d, t, start, i))
        start = i
    return out


class Hike(NamedTuple):
    """Una sortida a peu preparada per entrenar o avaluar."""

    date: datetime
    dist: list[float]
    ele: list[float]  # amb el suavitzat fort, el mateix que el desnivell
    times: list[datetime]
    flags: list[bool]  # en moviment
    distance_m: float
    ascent_m: float
    moving_s: float
    total_s: float

    def segments(self, length=SEGMENT_M) -> list[Segment]:
        return segments(self.dist, self.ele, self.times, self.flags, length)


def hike(points: list[Point]) -> Hike:
    """Un track amb hores i altitud, analitzat igual que en importar-lo."""
    stats = analyse(points)
    kept = stats.points
    return Hike(
        kept[0].time,
        stats.dist_m,
        stats.ele_smooth_m,
        [p.time for p in kept],
        moving(kept),
        stats.distance_m,
        stats.ascent_m,
        stats.moving_s,
        stats.total_s,
    )


def samples(h: Hike, weight: float, length=SEGMENT_M, max_kmh=MAX_KMH["hike"]):
    """(pendent, km/h, pes) dels trams vàlids per a l'ajust."""
    for seg in h.segments(length):
        if seg.length < length / 2 or not seg.moving_s or abs(seg.slope) > MAX_SLOPE:
            continue
        kmh = seg.length / seg.moving_s * 3.6
        if kmh <= max_kmh:
            yield seg.slope, kmh, seg.length * weight


def _solve(a: list[list[float]], b: list[float]) -> list[float]:
    """Eliminació de Gauss amb pivot, per a un sistema petit."""
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(m[r][c]))
        m[c], m[p] = m[p], m[c]
        for r in range(n):
            if r != c:
                f = m[r][c] / m[c][c]
                m[r] = [x - f * y for x, y in zip(m[r], m[c])]
    return [m[i][n] / m[i][i] for i in range(n)]


def fit(data: list[tuple[float, float, float]], s0=S0) -> Model:
    """Mínims quadrats robustos (Huber) sobre log v. `data`: (pendent, km/h, pes)."""
    prior = [math.log(TOBLER.v0), TOBLER.ku, TOBLER.kd]
    if not data:
        return TOBLER
    rows = [
        ([1.0, -max(s - s0, 0), -max(s0 - s, 0)], math.log(v), w) for s, v, w in data
    ]
    # Una mica d'atracció cap a Tobler: sense trams de baixada, kd no queda indeterminat.
    ridge = 1e-6 * sum(w for *_, w in rows)
    robust = [1.0] * len(rows)
    beta = prior
    for _ in range(15):
        a = [[ridge * (i == j) for j in range(3)] for i in range(3)]
        b = [ridge * p for p in prior]
        for (x, y, w), r in zip(rows, robust):
            for i in range(3):
                b[i] += w * r * x[i] * y
                for j in range(3):
                    a[i][j] += w * r * x[i] * x[j]
        beta = _solve(a, b)
        res = [y - sum(bi * xi for bi, xi in zip(beta, x)) for x, y, _ in rows]
        k = 1.345 * 1.4826 * (statistics.median(abs(e) for e in res) or 1e-9)
        robust = [1.0 if abs(e) <= k else k / abs(e) for e in res]
    return Model(math.exp(beta[0]), max(beta[1], 0.0), max(beta[2], 0.0), s0)


def train(
    hikes: list[Hike],
    n0=N0,
    half_life=HALF_LIFE_DAYS,
    length=SEGMENT_M,
    max_kmh=MAX_KMH["hike"],
) -> Model:
    """Ajust amb pes per longitud i recència, combinat amb Tobler segons el nombre de sortides."""
    if not hikes:
        return TOBLER
    latest = max(h.date for h in hikes)
    data = [
        x
        for h in hikes
        for x in samples(
            h, 0.5 ** ((latest - h.date).days / half_life), length, max_kmh
        )
    ]
    own = fit(data)
    # Només la forma tendeix a Tobler. La velocitat és sempre la pròpia: fins i tot una sola
    # sortida la mesura bé, i Tobler camina, cosa que alentiria els models de cursa.
    w = len(hikes) / (len(hikes) + n0)
    return Model(
        own.v0,
        w * own.ku + (1 - w) * TOBLER.ku,
        w * own.kd + (1 - w) * TOBLER.kd,
    )


def predict(m: Model, segs: list[Segment]) -> float:
    """Temps en moviment previst, en segons."""
    return sum(
        s.length / (speed(m, max(-MAX_SLOPE, min(MAX_SLOPE, s.slope))) / 3.6)
        for s in segs
    )


def calibrate(hikes) -> tuple[float, float]:
    """Naismith calibrat: temps = a·distància + b·pujada, amb a i b no negatius."""
    if not hikes:
        return NAISMITH
    xs = [(h.distance_m, h.ascent_m, h.moving_s) for h in hikes]
    sdd = sum(d * d for d, _, _ in xs)
    saa = sum(a * a for _, a, _ in xs)
    sda = sum(d * a for d, a, _ in xs)
    sdt = sum(d * t for d, _, t in xs)
    sat = sum(a * t for _, a, t in xs)
    det = sdd * saa - sda * sda
    if det:
        a, b = (sdt * saa - sat * sda) / det, (sat * sdd - sdt * sda) / det
        if a >= 0 and b >= 0:
            return a, b
    # Un coeficient negatiu no té sentit: s'ajusta només l'altre.
    options = [(sdt / sdd, 0.0)] + ([(0.0, sat / saa)] if saa else [])

    def sse(ab):
        return sum((t - ab[0] * d - ab[1] * a) ** 2 for d, a, t in xs)

    return min(options, key=sse)


def stop_rate(hikes) -> float | None:
    """Temps aturat per cada segon en moviment. None sense sortides."""
    if not hikes:
        return None
    return sum(h.total_s - h.moving_s for h in hikes) / sum(h.moving_s for h in hikes)


def sigma(hikes, predicted: list[float]) -> float:
    """Dispersió del log de l'error per sortida, per a l'interval de la predicció."""
    if len(hikes) < 3:
        return DEFAULT_SIGMA
    return statistics.pstdev(math.log(h.moving_s / p) for h, p in zip(hikes, predicted))


# ── Persistència ────────────────────────────────────────────────────────────


def _outings(con, kind: Kind):
    """Les activitats del tipus `kind` que entrenen el model: amb altitud i temps en moviment."""
    return con.execute(
        "SELECT id, name, started_at FROM activities WHERE kind = 'activity' AND type = ?"
        " AND moving_s > 0 AND ascent_m IS NOT NULL ORDER BY started_at",
        (kind,),
    ).fetchall()


def load_hikes(kind: Kind = "hike") -> list[Hike]:
    """Les activitats del tipus `kind` amb altitud i temps en moviment, per data."""
    out = []
    with db.session() as con:
        for activity_id, *_ in _outings(con, kind):
            rows = con.execute(
                "SELECT lat, lon, ele_m, time FROM points WHERE activity_id = ? ORDER BY seq",
                (activity_id,),
            )
            out.append(
                hike(
                    [
                        Point(lat, lon, ele, datetime.fromisoformat(time))
                        for lat, lon, ele, time in rows
                    ]
                )
            )
    return out


_refitting = threading.Lock()


def refit() -> None:
    """Torna a ajustar el model de cada tipus i en desa una versió nova si ha canviat."""
    # L'arrencada i les peticions poden reajustar alhora: sense el lock desarien dues versions iguals.
    with _refitting:
        for kind in KINDS:
            _refit(kind)


def _refit(kind: Kind) -> None:
    hikes = load_hikes(kind)
    # La corba es desa sempre, també quan prediu Naismith: la vista del model la mostra.
    m = train(hikes, max_kmh=MAX_KMH[kind])
    a, b = calibrate(hikes)
    info = {"method": METHOD[kind], "v0": m.v0, "ku": m.ku, "kd": m.kd, "a": a, "b": b}
    predicted = [estimate(info, h.distance_m, h.ascent_m, h.segments()) for h in hikes]
    row = (*(round(x, 4) for x in (m.v0, m.ku, m.kd, a, b)), len(hikes))
    with db.session() as con:
        last = con.execute(
            "SELECT * FROM time_models WHERE type = ? ORDER BY id DESC LIMIT 1", (kind,)
        ).fetchone()
        if last:
            config = json.loads(last["config_json"] or "{}")
            # Versions d'abans de Naismith calibrat: la de Naismith clàssic.
            saved = (last["v0"], last["ku"], last["kd"], *config.get("ab", NAISMITH))
            same = (*(round(x, 4) for x in saved), last["n_activities"]) == row
        else:
            # Sense cap versió desada, el model vigent és Tobler sense sortides.
            same = row == (*(round(x, 4) for x in (*TOBLER[:3], *NAISMITH)), 0)
        if same:
            return
        config = {
            "method": METHOD[kind],
            "ab": [row[3], row[4]],
            "segment_m": SEGMENT_M,
            "half_life_days": HALF_LIFE_DAYS,
            "n0": N0,
            "sigma": sigma(hikes, predicted),
        }
        con.execute(
            "INSERT INTO time_models(type, v0, ku, kd, s0, n_activities, stop_rate,"
            " config_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (kind, *row[:3], m.s0, len(hikes), stop_rate(hikes), json.dumps(config)),
        )


def estimate(info: dict, distance_m: float, ascent_m: float, segs) -> float:
    """Temps en moviment amb el mètode del tipus: el model propi o Naismith calibrat."""
    if info["method"] == "naismith":
        return info["a"] * distance_m + info["b"] * ascent_m
    return predict(Model(info["v0"], info["ku"], info["kd"]), segs)


def current(kind: Kind = "hike") -> dict:
    """La darrera versió desada del tipus o, si no n'hi ha cap, Tobler."""
    with db.session() as con:
        row = con.execute(
            "SELECT * FROM time_models WHERE type = ? ORDER BY id DESC LIMIT 1", (kind,)
        ).fetchone()
    if row is None:
        return {
            "type": kind,
            "method": METHOD[kind],
            "version": None,
            "created_at": None,
            **TOBLER._asdict(),
            "a": NAISMITH[0],
            "b": NAISMITH[1],
            "n_activities": 0,
            "stop_rate": None,
            "sigma": DEFAULT_SIGMA,
        }
    config = json.loads(row["config_json"] or "{}")
    a, b = config.get("ab", NAISMITH)
    return {
        "type": kind,
        "method": config.get("method", "model"),
        "a": a,
        "b": b,
        "version": row["id"],
        "created_at": row["created_at"],
        "v0": row["v0"],
        "ku": row["ku"],
        "kd": row["kd"],
        "s0": row["s0"],
        "n_activities": row["n_activities"],
        "stop_rate": row["stop_rate"],
        "sigma": config.get("sigma", DEFAULT_SIGMA),
    }


# ── Endpoints ───────────────────────────────────────────────────────────────


@router.get("/model")
def model(type: Kind = "hike") -> dict:
    """Model actual d'un tipus i la seva corba de velocitat segons el pendent."""
    info = current(type)
    m = Model(info["v0"], info["ku"], info["kd"], info["s0"])
    info["curve"] = [
        [pct, round(speed(m, pct / 100), 2), round(speed(TOBLER, pct / 100), 2)]
        for pct in range(-40, 41, 2)
    ]
    return info


def segment_time(info: dict, seg: Segment) -> float:
    """Temps previst d'un sol tram amb el mètode del tipus."""
    if info["method"] == "naismith":
        return info["a"] * seg.length + info["b"] * max(0.0, seg.slope * seg.length)
    return predict(Model(info["v0"], info["ku"], info["kd"]), [seg])


@router.get("/activities/{activity_id}/deviations")
def deviations(activity_id: str) -> dict:
    """Cada tram d'una sortida i quant s'ha desviat del temps previst pel model actual.

    `deviation` és el temps real entre el previst menys 1: positiu, més lent del previst.
    None en els trams on no hi ha temps en moviment (una parada).
    """
    with db.session() as con:
        activity = con.execute(
            "SELECT kind, type FROM activities WHERE id = ?", (activity_id,)
        ).fetchone()
        if activity is None:
            raise HTTPException(404, "Activity not found.")
        rows = con.execute(
            "SELECT lat, lon, ele_m, time FROM points WHERE activity_id = ? ORDER BY seq",
            (activity_id,),
        ).fetchall()
    if activity["kind"] != "activity" or any(r["ele_m"] is None for r in rows):
        raise HTTPException(
            422, "Only recorded outings with elevation can be compared with the model."
        )
    stats = analyse(
        [
            Point(r["lat"], r["lon"], r["ele_m"], datetime.fromisoformat(r["time"]))
            for r in rows
        ]
    )
    kept = stats.points
    segs = segments(
        stats.dist_m, stats.ele_smooth_m, [p.time for p in kept], moving(kept)
    )
    info = current(activity["type"])
    return {
        "type": activity["type"],
        "method": info["method"],
        "segments": [
            {
                "coordinates": [[p.lon, p.lat] for p in kept[s.start : s.end + 1]],
                "deviation": round(s.moving_s / segment_time(info, s) - 1, 3)
                if s.moving_s
                else None,
            }
            for s in segs
        ],
    }


@router.get("/model/history")
def history(type: Kind = "hike") -> dict:
    """El model refet sortida a sortida, el que preveia de cada una abans de fer-la i les versions desades."""
    hikes = load_hikes(type)
    with db.session() as con:
        rows = _outings(con, type)
        versions = [
            {
                "version": v["id"],
                "created_at": v["created_at"],
                "n_activities": v["n_activities"],
                "flat_kmh": round(speed(Model(v["v0"], v["ku"], v["kd"]), 0), 2),
            }
            for v in con.execute(
                "SELECT * FROM time_models WHERE type = ? ORDER BY id", (type,)
            )
        ]
    outings, before = [], None
    for i, (h, row) in enumerate(zip(hikes, rows)):
        # Entrenat amb les anteriors: el que l'usuari hauria vist abans de sortir.
        predicted = (
            estimate(before, h.distance_m, h.ascent_m, h.segments()) if before else None
        )
        m = train(hikes[: i + 1], max_kmh=MAX_KMH[type])
        a, b = calibrate(hikes[: i + 1])
        before = {
            "method": METHOD[type],
            "v0": m.v0,
            "ku": m.ku,
            "kd": m.kd,
            "a": a,
            "b": b,
        }
        outings.append(
            {
                "activity_id": row["id"],
                "name": row["name"],
                "date": row["started_at"],
                "moving_s": h.moving_s,
                "predicted_s": predicted,
                # Velocitat en pla, pujant i baixant un 20 %, segons el model fins a aquesta sortida.
                "flat_kmh": round(speed(m, 0), 2),
                "up_kmh": round(speed(m, 0.2), 2),
                "down_kmh": round(speed(m, -0.2), 2),
            }
        )
    return {
        "type": type,
        "method": METHOD[type],
        "outings": outings,
        "versions": versions,
    }


class Route(BaseModel):
    points: list[list[float]] = Field(
        min_length=2, max_length=100_000
    )  # [lon, lat, ele]
    type: Kind = "hike"


@router.post("/predictions")
def prediction(route: Route) -> dict:
    """Temps en moviment previst amb un interval, i temps total amb les parades."""
    if any(len(p) < 3 for p in route.points):
        # Sense model d'elevació propi, una ruta sense altitud no es pot predir.
        raise HTTPException(
            422, "This route has no elevation, so its time cannot be predicted yet."
        )
    if any(not (-90 <= p[1] <= 90 and -180 <= p[0] <= 180) for p in route.points):
        raise HTTPException(422, "The route has invalid coordinates.")
    # El mateix processament que un track importat.
    stats = analyse([Point(p[1], p[0], p[2], None) for p in route.points])
    info = current(route.type)
    segs = segments(stats.dist_m, stats.ele_smooth_m)
    moving_s = estimate(info, stats.distance_m, stats.ascent_m, segs)
    stops = info["stop_rate"]
    return {
        "moving_s": moving_s,
        "moving_low_s": moving_s * math.exp(-Z90 * info["sigma"]),
        "moving_high_s": moving_s * math.exp(Z90 * info["sigma"]),
        "total_s": None if stops is None else moving_s * (1 + stops),
        "type": route.type,
        "method": info["method"],
        "n_activities": info["n_activities"],
        "version": info["version"],
    }
