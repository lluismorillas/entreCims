"""Avaluació del model de temps (spec.md F3: T046 i T047).

    uv run --project backend python eval/timing.py eval/private

Escriu la secció de temps de `docs/evaluation.md`. Només conté mètriques agregades.
"""

import itertools
import random
import statistics
import sys
from math import inf
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend" / "src"))

import timing
from importers import TrackError, parse
from timing import TOBLER, calibrate, naismith

SEED = 2026
BOOTSTRAP = 1000
# Com a l'aplicació: més de pressa no és caminar (spec.md, qüestió oberta 1). Les curses es
# separen en `trail_run` i `run` per l'esport que desa el fitxer.
HIKE_MAX_KMH = 6
TITLES = {"hike": "Excursions", "trail_run": "Curses de muntanya", "run": "Curses"}
N0_GRID = (2, 5, 10)
HALF_LIFE_GRID = (180, inf)
INNER_FOLDS = 4
MIN_PRIOR = 3  # validació temporal: sortides anteriors mínimes per predir
START, END = "<!-- timing:start -->", "<!-- timing:end -->"


class Cached(timing.Hike):
    """Hike que recorda els seus trams: l'avaluació n'entrena centenars de models."""

    def segments(self, length=timing.SEGMENT_M):
        cache = self.__dict__.setdefault("_segments", {})
        if length not in cache:
            cache[length] = super().segments(length)
        return cache[length]


def activities(folder: Path) -> dict[str, list[Cached]]:
    """Sortides amb hores i altitud, per tipus i per data."""
    out = {kind: [] for kind in timing.KINDS}
    for path in sorted(folder.iterdir()):
        if path.suffix.lower() not in (".gpx", ".fit", ".tcx"):
            continue
        try:
            track = parse(path.name, path.read_bytes())
        except TrackError:
            continue
        if track.kind != "activity" or any(p.ele is None for p in track.points):
            continue
        h = Cached(*timing.hike(track.points))
        if not h.moving_s:
            continue
        if h.distance_m / h.moving_s * 3.6 <= HIKE_MAX_KMH:
            out["hike"].append(h)
        else:
            out["trail_run" if track.type == "trail_run" else "run"].append(h)
    return {kind: sorted(hs, key=lambda h: h.date) for kind, hs in out.items()}


# ── Mètodes ─────────────────────────────────────────────────────────────────


def choose(train, length, max_kmh):
    """N0 i semivida per validació creuada interna, només amb les dades d'entrenament."""
    if len(train) < INNER_FOLDS:
        return timing.N0, timing.HALF_LIFE_DAYS

    def error(n0, half_life):
        total = 0.0
        for k in range(INNER_FOLDS):
            fit_on = [h for i, h in enumerate(train) if i % INNER_FOLDS != k]
            m = timing.train(fit_on, n0, half_life, length, max_kmh)
            total += sum(
                abs(timing.predict(m, h.segments(length)) / h.moving_s - 1)
                for i, h in enumerate(train)
                if i % INNER_FOLDS == k
            )
        return total

    return min(itertools.product(N0_GRID, HALF_LIFE_GRID), key=lambda p: error(*p))


def predictions(train, test, max_kmh, length=timing.SEGMENT_M):
    """Temps en moviment previst per cada mètode, i el total del model amb les parades."""
    n0, half_life = choose(train, length, max_kmh)
    m = timing.train(train, n0, half_life, length, max_kmh)
    stop_rate = timing.stop_rate(train)
    a, b = calibrate(train)
    model = timing.predict(m, test.segments(length))
    return {
        "Model propi": model,
        "Tobler": timing.predict(TOBLER, test.segments(length)),
        "Naismith": naismith(test.distance_m, test.ascent_m),
        "Naismith calibrat": a * test.distance_m + b * test.ascent_m,
    }, model * (1 + stop_rate)


def run(folds, max_kmh):
    """`folds`: (entrenament, sortida). Retorna errors relatius per mètode i del temps total."""
    errors, totals, minutes = {}, [], {}
    for train, test in folds:
        moving, total = predictions(train, test, max_kmh)
        for name, value in moving.items():
            errors.setdefault(name, []).append(value / test.moving_s - 1)
            minutes.setdefault(name, []).append(abs(value - test.moving_s) / 60)
        totals.append(total / test.total_s - 1)
    return errors, minutes, totals


def mape(errors) -> float:
    return 100 * statistics.mean(abs(e) for e in errors)


def paired(own, other):
    """Diferència d'error absolut (punts percentuals) per sortida, amb interval de bootstrap."""
    diffs = [100 * (abs(a) - abs(b)) for a, b in zip(own, other)]
    rng = random.Random(SEED)
    means = sorted(
        statistics.mean(rng.choices(diffs, k=len(diffs))) for _ in range(BOOTSTRAP)
    )
    lo, hi = means[int(0.025 * BOOTSTRAP)], means[int(0.975 * BOOTSTRAP) - 1]
    return statistics.mean(diffs), lo, hi, sum(d < 0 for d in diffs)


def table(errors, minutes) -> str:
    rows = [
        f"| {name} | {mape(e):.1f} % | {statistics.mean(minutes[name]):.0f} min"
        f" | {100 * statistics.median(e):+.1f} % |"
        for name, e in errors.items()
    ]
    return (
        "| Mètode | MAPE | Error absolut mitjà | Mediana de l'error |\n|---|---|---|---|\n"
        + "\n".join(rows)
    )


def verdict(own, nc) -> str:
    mean, lo, hi, wins = paired(own, nc)
    line = (
        f"Diferència d'error absolut per sortida (model propi menys Naismith calibrat): "
        f"{mean:+.1f} punts (IC 95 %: {lo:+.1f} a {hi:+.1f}). El model propi encerta més en "
        f"{wins} de {len(own)} sortides."
    )
    if hi < 0:
        return line + "\n\n**El model propi supera Naismith calibrat.**"
    if lo > 0:
        return line + "\n\n**El model propi no supera Naismith calibrat: és pitjor.**"
    return (
        line + "\n\n**El model propi no supera Naismith calibrat de manera concloent.**"
    )


def evaluate(kind: str, data: list[Cached]) -> str:
    """La subsecció d'un tipus d'activitat."""
    title = f"### {TITLES[kind]} (`{kind}`)"
    if len(data) < MIN_PRIOR + 2:
        return (
            f"{title}\n\nNomés {len(data)} sortides: massa poques per avaluar el model."
        )
    max_kmh = timing.MAX_KMH[kind]
    loo = [([h for h in data if h is not test], test) for test in data]
    temporal = [(data[:i], data[i]) for i in range(MIN_PRIOR, len(data))]
    loo_errors, loo_minutes, loo_totals = run(loo, max_kmh)
    tmp_errors, tmp_minutes, tmp_totals = run(temporal, max_kmh)
    half = [
        predictions(train, test, max_kmh, 50)[0]["Model propi"] / test.moving_s - 1
        for train, test in loo
    ]
    return f"""{title}

{len(data)} sortides, del {data[0].date:%Y-%m} al {data[-1].date:%Y-%m}. S'exclouen de l'ajust els
trams de més de {max_kmh} km/h. L'aplicació hi prediu amb
**{"el model propi" if timing.METHOD[kind] == "model" else "Naismith calibrat"}**.

#### Validació 1: *leave-one-out*

{table(loo_errors, loo_minutes)}

{verdict(loo_errors["Model propi"], loo_errors["Naismith calibrat"])}

#### Validació 2: temporal

Cada sortida es prediu només amb les anteriors (a partir de la {MIN_PRIOR + 1}a, {len(temporal)} prediccions).

{table(tmp_errors, tmp_minutes)}

{verdict(tmp_errors["Model propi"], tmp_errors["Naismith calibrat"])}

#### Temps total

Amb les parades estimades a partir de les sortides d'entrenament: MAPE {mape(loo_totals):.1f} %
(*leave-one-out*) i {mape(tmp_totals):.1f} % (temporal).

#### Sensibilitat a la longitud dels trams

MAPE del model propi amb trams de 50 m (*leave-one-out*): {mape(half):.1f} %, davant de
{mape(loo_errors["Model propi"]):.1f} % amb trams de {timing.SEGMENT_M} m."""


def report(folder: Path) -> None:
    data = activities(folder)
    parts = "\n\n".join(evaluate(kind, hs) for kind, hs in data.items())
    section = f"""{START}
## Temps

Generat per `eval/timing.py`. Llavor {SEED}, {BOOTSTRAP} rèpliques de bootstrap.

Un model per tipus d'activitat a peu, entrenat només amb les sortides d'aquell tipus. Una sortida és
excursió si la seva velocitat mitjana en moviment és de {HIKE_MAX_KMH} km/h o menys; si no, és cursa de
muntanya o cursa segons l'esport que desa el fitxer.

- Objectiu: temps en moviment. Trams de {timing.SEGMENT_M} m; s'exclouen els pendents de més del
  {timing.MAX_SLOPE * 100:.0f} %.
- N0 i la semivida es trien a cada iteració, amb validació creuada de {INNER_FOLDS} blocs sobre les
  dades d'entrenament, entre N0 = {N0_GRID} i semivida = {HALF_LIFE_GRID} dies.
  Naismith calibrat també s'ajusta a cada iteració.

{parts}
{END}"""

    path = ROOT / "docs" / "evaluation.md"
    doc = path.read_text(encoding="utf-8")
    if START in doc:
        doc = doc[: doc.index(START)] + section + doc[doc.index(END) + len(END) :]
    else:
        doc = doc.rstrip() + "\n\n" + section + "\n"
    path.write_text(doc, encoding="utf-8")
    print(f"Written to {path}.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    report(Path(sys.argv[1]))
