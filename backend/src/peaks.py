"""descarrega OpenStreetMap, fusió de duplicats i detecció dels assolits"""

import itertools
import json
import os
import re
import statistics
import urllib.parse
import urllib.request
from math import cos, hypot, radians
from pathlib import Path
from typing import NamedTuple

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, model_validator

import db

router = APIRouter(prefix="/api")

OVERPASS_URL = os.environ.get(
    "ENTRECIMS_OVERPASS_URL", "https://overpass-api.de/api/interpreter"
)
# Regió que es descarrega sola el primer cop que arrenca el servidor. Buida: cap.
DEFAULT_REGION = os.environ.get("ENTRECIMS_PEAKS_REGION", "Catalunya")
MERGE_M = 50  # distancia per detectar que dos cims son el mateix cim
CANDIDATE_M = 300  # cims a menys d'aquesta distància del track
MAX_REGION_DEG = 2  # costat màxim d'una regió, perquè Overpass no la rebutgi
M_PER_DEG = 6371000 * radians(1)


class Params(NamedTuple):
    r: float  # R: distància màxima del cim al track
    m: float  # M: marge altitud; si es inferior no aplica la condició
    w: float  # W: mitja finestra del màxim local, en metres de recorregut
    p: float  # P: baixada mínima a banda i banda del màxim
    # C: més a prop que això, el cim compta sense ser màxim local. Cims plans, punts d'una
    # carena que baixa i agulles al costat del camí no fan cap màxim al perfil.
    c: float = 0
    local: bool = True  # False: referències que només miren distància i altitud


# Triats segons resultats del test `eval/peaks.py report`
PARAMS = Params(r=50, m=20, w=100, p=10, c=30)


class Peak(NamedTuple):
    id: int
    lat: float
    lon: float
    ele: float | None


class Track(NamedTuple):
    lat: list[float]
    lon: list[float]
    ele: list[float]
    dist: list[float]
    time: list[str | None]


class Result(NamedTuple):
    detected: bool
    confidence: str
    min_dist_m: float
    ele_gap_m: float | None  # altitud del cim menys la màxima del track a prop
    is_local_max: (
        bool | None
    )  # None si no s'ha comprovat: massa lluny, o prou a prop (C)
    index: int


def track(rows) -> Track | None:
    """(lat, lon, ele, dist, time) del track. None si algun punt no té altitud."""
    lat, lon, ele, dist, time = (list(c) for c in zip(*rows))
    if None in ele:
        return None
    ele = [statistics.median(ele[max(0, i - 2) : i + 3]) for i in range(len(ele))]
    return Track(lat, lon, ele, dist, time)


def distances(t: Track, peak: Peak) -> tuple[list[float], list[float]]:
    """Distancia del cim a cada punt i a cada segment (en pla local centrat al cim)"""
    kx = M_PER_DEG * cos(radians(peak.lat))
    xy = [
        ((lon - peak.lon) * kx, (lat - peak.lat) * M_PER_DEG)
        for lat, lon in zip(t.lat, t.lon)
    ]
    seg = []
    for (ax, ay), (bx, by) in itertools.pairwise(xy):
        dx, dy = bx - ax, by - ay
        length = dx * dx + dy * dy
        k = 0 if length == 0 else max(0, min(1, -(ax * dx + ay * dy) / length))
        seg.append(hypot(ax + k * dx, ay + k * dy))
    return [hypot(x, y) for x, y in xy], seg


def _drops(t: Track, top: int, step: int, prm: Params) -> bool:
    """Si el perfil baixa P metres des de `top` cap a un costat, dins de W i sense passar-lo d'alçada.

    No exigeix que `top` sigui el més alt de tota la finestra: en una aresta, el cim veí més alt
    a menys de W faria fallar el més baix, i cada cim s'ha d'avaluar per separat.
    """
    j = top + step
    while 0 <= j < len(t.ele) and abs(t.dist[j] - t.dist[top]) <= prm.w:
        if t.ele[j] > t.ele[top]:
            return False
        if t.ele[top] - t.ele[j] >= prm.p:
            return True
        j += step
    return False


def judge(t: Track, peak: Peak, point_d, seg_d, prm: Params) -> Result:
    # Un pas és una tirada de segments seguits a menys de R. Anar i tornar en fa dos (FR-205).
    passes: list[list[int]] = []
    for i, d in enumerate(seg_d):
        if d < prm.r:
            if passes and passes[-1][-1] == i - 1:
                passes[-1].append(i)
            else:
                passes.append([i])
    confidence = "low" if peak.ele is None else "high"
    shown = None
    for segs in passes:
        near = range(segs[0], segs[-1] + 2)
        index = min(near, key=point_d.__getitem__)
        top = max(near, key=t.ele.__getitem__)
        gap = None if peak.ele is None else peak.ele - t.ele[top]
        local = True
        checked = prm.local and min(seg_d[i] for i in segs) >= prm.c
        if checked:
            left, right = _drops(t, top, -1, prm), _drops(t, top, 1, prm)
            # Si el track comença o acaba al cim, n'hi ha prou amb un costat.
            starts = t.dist[top] - t.dist[0] < prm.r
            ends = t.dist[-1] - t.dist[top] < prm.r
            local = (left or starts) and (right or ends) and (left or right)
        result = Result(
            (gap is None or gap <= prm.m) and local,
            confidence,
            min(seg_d),
            gap,
            local if checked else None,
            index,
        )
        if result.detected:
            return result
        # Sense cap pas vàlid, s'explica el més proper.
        if shown is None or point_d[index] < point_d[shown.index]:
            shown = result
    closest = min(range(len(point_d)), key=point_d.__getitem__)
    return shown or Result(False, confidence, min(seg_d), None, None, closest)


# ── Descàrrega ──────────────────────────────────────────────────────────────


def _ele(tags: dict) -> float | None:
    match = re.match(r"\s*(-?\d+(?:\.\d+)?)", tags.get("ele", ""))
    return float(match[1]) if match else None


def _overpass(boxes) -> list[dict]:
    """Nodes natural=peak de cada caixa (sud, oest, nord, est), en una sola consulta."""
    union = "".join(f"node[natural=peak]({s},{w},{n},{e});" for s, w, n, e in boxes)
    return _query(f"({union});")


# Zones que es poden descarregar pel nom: països, comunitats autònomes i departaments del
# Pirineu. Amb l'id de la relació d'OSM, perquè hi ha noms repetits arreu del món.
AREAS: list[dict] = json.loads(
    (Path(__file__).parent / "areas.json").read_text(encoding="utf-8")
)


def _region(name: str) -> list[dict]:
    """Nodes natural=peak dins d'una àrea administrativa d'OSM: la de l'índex o, si no hi és, pel nom."""
    name = name.strip()
    known = next((a for a in AREAS if a["name"].lower() == name.lower()), None)
    if known:
        # Overpass numera les àrees de les relacions a partir de 3.600.000.000.
        area = f"area(id:{3_600_000_000 + known['relation']})->.a;"
    else:
        area = f'area["boundary"="administrative"]["name"={json.dumps(name)}]->.a;'
    return _query(f"{area}node[natural=peak](area.a);")


def _query(body: str) -> list[dict]:
    data = urllib.parse.urlencode({"data": f"[out:json][timeout:180];{body}out;"})
    request = urllib.request.Request(
        OVERPASS_URL, data=data.encode(), headers={"User-Agent": "entreCims"}
    )
    with urllib.request.urlopen(request, timeout=200) as response:
        answer = json.load(response)
    # Una zona massa gran esgota el temps d'Overpass: la resposta és parcial i porta un avís.
    if "error" in answer.get("remark", ""):
        raise ValueError(answer["remark"])
    return answer["elements"]


def store(elements: list[dict]) -> tuple[int, int]:
    """Desa els cims i torna a fusionar els duplicats. Retorna (cims, fusionats)."""
    with db.session() as con:
        con.executemany(
            "INSERT INTO peaks(osm_id, name, lat, lon, ele_m) VALUES (?, ?, ?, ?, ?)"
            " ON CONFLICT(osm_id) DO UPDATE SET name = excluded.name, lat = excluded.lat,"
            " lon = excluded.lon, ele_m = excluded.ele_m",
            (
                (e["id"], e.get("tags", {}).get("name"), e["lat"], e["lon"])
                + (_ele(e.get("tags", {})),)
                for e in elements
            ),
        )
        con.execute("UPDATE peaks SET merged_into = NULL")
        # Es queda el node més complet: amb altitud, amb nom i, si no, el més antic.
        rows = con.execute(
            "SELECT id, lat, lon FROM peaks"
            " ORDER BY ele_m IS NULL, name IS NULL, osm_id"
        ).fetchall()
        kept: dict[
            tuple[int, int], list
        ] = {}  # cel·les de ~110 m per no comparar-los tots
        merged = []
        for row in rows:
            cell = (int(row["lat"] * 1000), int(row["lon"] * 1000))
            twin = next(
                (
                    k
                    for di in (-1, 0, 1)
                    for dj in (-1, 0, 1)
                    for k in kept.get((cell[0] + di, cell[1] + dj), [])
                    if hypot(
                        (k["lon"] - row["lon"]) * cos(radians(row["lat"])),
                        k["lat"] - row["lat"],
                    )
                    * M_PER_DEG
                    < MERGE_M
                ),
                None,
            )
            if twin:
                merged.append((twin["id"], row["id"]))
            else:
                kept.setdefault(cell, []).append(row)
        con.executemany("UPDATE peaks SET merged_into = ? WHERE id = ?", merged)
        return len(rows) - len(merged), len(merged)


# ── Detecció i persistència ─────────────────────────────────────────────────


def box(t: Track) -> tuple[float, float, float, float]:
    """Caixa (sud, oest, nord, est) del track, ampliada CANDIDATE_M."""
    dlat = CANDIDATE_M / M_PER_DEG
    dlon = dlat / cos(radians(max(map(abs, t.lat))))
    return min(t.lat) - dlat, min(t.lon) - dlon, max(t.lat) + dlat, max(t.lon) + dlon


def candidates(con, t: Track):
    """Cims a menys de CANDIDATE_M del track, amb les seves distàncies (unitat d'avaluació)."""
    s, w, n, e = box(t)
    rows = con.execute(
        "SELECT id, lat, lon, ele_m FROM peaks WHERE merged_into IS NULL"
        " AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?",
        (s, n, w, e),
    )
    for peak in map(Peak._make, rows.fetchall()):
        point_d, seg_d = distances(t, peak)
        if min(seg_d) < CANDIDATE_M:
            yield peak, point_d, seg_d


def detect(con, activity_id: str) -> None:
    """Torna a avaluar els cims a menys de 300 m d'una activitat. Les correccions manuals es conserven (FR-208)."""
    t = track(
        con.execute(
            "SELECT lat, lon, ele_m, dist_m, time FROM points WHERE activity_id = ? ORDER BY seq",
            (activity_id,),
        )
    )
    con.execute(
        "DELETE FROM activity_peaks WHERE activity_id = ? AND manual_label IS NULL",
        (activity_id,),
    )
    if t is None:
        return
    for peak, point_d, seg_d in candidates(con, t):
        r = judge(t, peak, point_d, seg_d, PARAMS)
        con.execute(
            "INSERT INTO activity_peaks(activity_id, peak_id, detected, confidence, min_dist_m,"
            " ele_gap_m, is_local_max, first_passed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            " ON CONFLICT DO UPDATE SET detected = excluded.detected,"
            " confidence = excluded.confidence, min_dist_m = excluded.min_dist_m,"
            " ele_gap_m = excluded.ele_gap_m, is_local_max = excluded.is_local_max,"
            " first_passed_at = excluded.first_passed_at",
            (
                activity_id,
                peak.id,
                r.detected,
                r.confidence,
                r.min_dist_m,
                r.ele_gap_m,
                r.is_local_max,
                t.time[r.index],
            ),
        )


def for_activity(con, activity) -> dict:
    """Estat de la detecció i candidats d'una sortida, amb els motius (FR-206, FR-209)."""
    if activity["kind"] != "activity":
        status = "planned"
    elif con.execute(
        "SELECT 1 FROM points WHERE activity_id = ? AND ele_m IS NULL",
        (activity["id"],),
    ).fetchone():
        status = "no_elevation"
    elif not con.execute("SELECT 1 FROM peaks").fetchone():
        status = "no_peaks"
    else:
        status = "ok"
    rows = con.execute(
        "SELECT p.id, p.name, p.lat, p.lon, p.ele_m, ap.detected, ap.confidence,"
        " ap.min_dist_m, ap.ele_gap_m, ap.is_local_max, ap.first_passed_at, ap.manual_label,"
        " (SELECT min(dist_m) FROM points pt WHERE pt.activity_id = ap.activity_id"
        "  AND pt.time = ap.first_passed_at) AS dist_m"
        " FROM activity_peaks ap JOIN peaks p ON p.id = ap.peak_id"
        " WHERE ap.activity_id = ? ORDER BY dist_m",
        (activity["id"],),
    )
    return {"peaks_status": status, "peaks": [_candidate(row) for row in rows]}


def _candidate(row) -> dict:
    c = dict(row)
    for key in ("detected", "is_local_max", "manual_label"):
        c[key] = None if c[key] is None else bool(c[key])
    c["reached"] = c["detected"] if c["manual_label"] is None else c["manual_label"]
    return c


def rerun():
    """Torna a analitzar totes les activitats. Retorna (fetes, total) després de cadascuna."""
    with db.session() as con:
        ids = [
            r["id"]
            for r in con.execute("SELECT id FROM activities WHERE kind = 'activity'")
        ]
    for done, activity_id in enumerate(ids, 1):
        # Una sessió per activitat: un error només desfà la seva.
        with db.session() as con:
            detect(con, activity_id)
        yield done, len(ids)


def download_default() -> None:
    """Desa els cims de DEFAULT_REGION un sol cop, encara que ja n'hi hagi d'altres zones, i analitza les activitats."""
    # Recorda quina regió s'ha descarregat: si es canvia DEFAULT_REGION, es baixa la nova.
    done = db.DATA / "peaks-region.txt"
    if not DEFAULT_REGION or (
        done.exists() and done.read_text("utf-8") == DEFAULT_REGION
    ):
        return
    try:
        elements = _region(DEFAULT_REGION)
    except (OSError, ValueError, KeyError):
        return  # sense connexió: es torna a provar a la propera arrencada
    store(elements)
    for _ in rerun():
        pass
    done.write_text(DEFAULT_REGION, "utf-8")


# ── Endpoints ───────────────────────────────────────────────────────────────


class Region(BaseModel):
    south: float
    west: float
    north: float
    east: float

    @model_validator(mode="after")
    def check(self):
        if not (
            -90 <= self.south < self.north <= 90
            and -180 <= self.west < self.east <= 180
        ):
            raise ValueError("The region is not a valid box.")
        if (
            self.north - self.south > MAX_REGION_DEG
            or self.east - self.west > MAX_REGION_DEG
        ):
            raise ValueError(
                f"The region is too large: zoom in to at most {MAX_REGION_DEG}° per side."
            )
        return self


@router.post("/peaks/download")
def download(region: Region) -> StreamingResponse:
    """Descarrega els cims d'una caixa i torna a analitzar les activitats (FR-201)."""
    box = (region.south, region.west, region.north, region.east)
    return _download(lambda: _overpass([box]))


class Area(BaseModel):
    name: str = Field(min_length=1, max_length=200)


@router.get("/peaks/areas")
def areas() -> list[dict]:
    """Índex de zones per triar-ne una pel nom."""
    return AREAS


@router.post("/peaks/download-area")
def download_area(area: Area) -> StreamingResponse:
    """Descarrega els cims d'una zona administrativa pel seu nom i torna a analitzar les activitats."""
    return _download(lambda: _region(area.name))


def _download(fetch) -> StreamingResponse:
    """Descarrega amb `fetch`, desa i analitza. El progrés arriba línia a línia."""

    def progress():
        yield json.dumps({"stage": "download"}) + "\n"
        try:
            elements = fetch()
        except (
            OSError,
            ValueError,
            KeyError,
        ):  # xarxa, límit d'Overpass o resposta no JSON
            yield (
                json.dumps(
                    {
                        "error": "OpenStreetMap could not answer. Try again later, or a smaller area."
                    }
                )
                + "\n"
            )
            return
        if not elements:
            message = "No peaks found there. Check the name of the area."
            yield json.dumps({"error": message}) + "\n"
            return
        peaks, merged = store(elements)
        yield json.dumps({"stage": "saved", "peaks": peaks, "merged": merged}) + "\n"
        for done, total in rerun():
            yield json.dumps({"stage": "analyse", "done": done, "total": total}) + "\n"
        yield json.dumps({"stage": "done"}) + "\n"

    return StreamingResponse(progress(), media_type="application/x-ndjson")


@router.post("/analysis/rerun")
def rerun_all() -> dict:
    return {"activities": sum(1 for _ in rerun())}


@router.get("/peaks/reached")
def reached() -> list[dict]:
    """Cims assolits amb el nombre de vegades i les dates (FR-207). Mana la correcció manual."""
    peaks: dict[int, dict] = {}
    with db.session() as con:
        for row in con.execute(
            "SELECT p.id, p.name, p.lat, p.lon, p.ele_m, a.id AS activity_id,"
            " a.name AS activity_name, ap.first_passed_at"
            " FROM activity_peaks ap JOIN peaks p ON p.id = ap.peak_id"
            " JOIN activities a ON a.id = ap.activity_id"
            " WHERE coalesce(ap.manual_label, ap.detected) = 1 AND p.merged_into IS NULL"
            " ORDER BY ap.first_passed_at"
        ):
            peak = peaks.setdefault(
                row["id"],
                {k: row[k] for k in ("id", "name", "lat", "lon", "ele_m")}
                | {"visits": []},
            )
            peak["visits"].append(
                {k: row[k] for k in ("activity_id", "activity_name", "first_passed_at")}
            )
    return sorted(peaks.values(), key=lambda p: (-len(p["visits"]), p["name"] or ""))


class Label(BaseModel):
    reached: bool | None  # None torna a la detecció automàtica


@router.put("/activities/{activity_id}/peaks/{peak_id}")
def label(activity_id: str, peak_id: int, body: Label) -> dict:
    """Confirma o rebutja un cim. La correcció sobreviu a les noves anàlisis (FR-208)."""
    with db.session() as con:
        updated = con.execute(
            "UPDATE activity_peaks SET manual_label = ? WHERE activity_id = ? AND peak_id = ?",
            (body.reached, activity_id, peak_id),
        ).rowcount
        if not updated:
            raise HTTPException(404, "This peak is not a candidate of this activity.")
        activity = con.execute(
            "SELECT id, kind FROM activities WHERE id = ?", (activity_id,)
        ).fetchone()
        return next(
            c for c in for_activity(con, activity)["peaks"] if c["id"] == peak_id
        )
