"""Avaluació de la detecció de cims.

1. Etiquetatge cec. Escriu els parells (activitat, cim a menys de 300 m) sense cap predicció:

       uv run --project backend python eval/peaks.py label eval/private

   A `eval/private/peak_labels.csv`, posa 1 si vas fer el cim, 0 si no, i ? si dubtes.

2. Informe. Ajusta els paràmetres amb una part dels cims, prova amb l'altra i escriu
   la secció de cims de `docs/evaluation.md`:

       uv run --project backend python eval/peaks.py report eval/private

Els cims es descarreguen d'Overpass la primera vegada i es desen a `<carpeta>/.peaks/`.
"""

import csv
import hashlib
import itertools
import random
import sys
from math import inf, isnan
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend" / "src"))

import db
import peaks
from analysis import analyse
from importers import TrackError, parse
from peaks import Params

SEED = 2026
BOOTSTRAP = 1000
GRID = {
    "r": (30, 50, 70, 100),
    "m": (10, 20, 30),
    "w": (100, 200, 300),
    "p": (3, 5, 10),
    # 0: sempre cal el màxim local, com a la primera versió de l'algorisme.
    "c": (0, 10, 20, 30),
}
REFERENCES = {
    "Summit Bag: 70 m": Params(70, inf, 0, 0, local=False),
    "intervals-summits: 100 m i 80 m": Params(100, 80, 0, 0, local=False),
    "trailscan: 50 m i 30 m": Params(50, 30, 0, 0, local=False),
}
LABELS = "peak_labels.csv"
FIELDS = ["file", "date", "activity", "osm_id", "peak", "peak_ele", "label"]
START, END = "<!-- peaks:start -->", "<!-- peaks:end -->"


def tracks(folder: Path):
    """(fitxer, data, nom, Track o None si no té altitud) de cada activitat de la carpeta."""
    for path in sorted(folder.iterdir()):
        if path.suffix.lower() not in (".gpx", ".fit", ".tcx"):
            continue
        try:
            track = parse(path.name, path.read_bytes())
        except TrackError as exc:
            print(f"  {path.name}: {exc}")
            continue
        if track.kind != "activity":
            continue
        # El mateix processament que en importar-la a l'aplicació.
        stats = analyse(track.points)
        rows = [
            (p.lat, p.lon, p.ele, d, p.time.isoformat())
            for p, d in zip(stats.points, stats.dist_m)
        ]
        yield (
            path.name,
            stats.points[0].time.date().isoformat(),
            track.name,
            peaks.track(rows),
        )


def open_peaks(folder: Path, found: list) -> dict[int, tuple]:
    """Base de cims pròpia de l'avaluació. Retorna {id intern: (osm_id, nom, altitud)}."""
    db.DATA = folder / ".peaks"
    db.init()
    with db.session() as con:
        empty = not con.execute("SELECT 1 FROM peaks").fetchone()
    if empty:
        boxes = [peaks.box(t) for *_, t in found if t]
        print(f"Downloading peaks around {len(boxes)} tracks from Overpass...")
        kept, merged = peaks.store(peaks._overpass(boxes))
        print(f"  {kept} peaks, {merged} duplicates merged")
    with db.session() as con:
        return {
            r["id"]: (r["osm_id"], r["name"], r["ele_m"])
            for r in con.execute("SELECT id, osm_id, name, ele_m FROM peaks")
        }


def pairs(folder: Path):
    """Tots els candidats: (fila del CSV sense etiqueta, track, cim, distàncies)."""
    found = list(tracks(folder))
    info = open_peaks(folder, found)
    with db.session() as con:
        for file, date, name, t in found:
            if t is None:
                continue
            for peak, point_d, seg_d in peaks.candidates(con, t):
                osm_id, peak_name, ele = info[peak.id]
                row = {
                    "file": file,
                    "date": date,
                    "activity": name,
                    "osm_id": str(osm_id),
                    "peak": peak_name or "",
                    "peak_ele": "" if ele is None else f"{ele:.0f}",
                }
                yield row, t, peak, point_d, seg_d
    print(
        f"{len(found)} activities, {sum(t is None for *_, t in found)} without elevation (excluded)."
    )


def read_labels(folder: Path) -> dict[tuple[str, str], str]:
    path = folder / LABELS
    if not path.exists():
        return {}
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        labels = {}
        for r in reader:
            # Una coma de més o de menys desplaça l'etiqueta a una altra columna.
            if None in r or r["label"] is None:
                sys.exit(
                    f"{path}, line {reader.line_num}: expected {len(FIELDS)} columns. Check the commas."
                )
            labels[r["file"], r["osm_id"]] = r["label"].strip()
        return labels


def label(folder: Path) -> None:
    """Escriu els candidats sense predicció. Les etiquetes ja posades es conserven."""
    old = read_labels(folder)
    rows = [row for row, *_ in pairs(folder)]
    for row in rows:
        row["label"] = old.get((row["file"], row["osm_id"]), "")
    with (folder / LABELS).open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    todo = sum(not r["label"] for r in rows)
    print(
        f"{len(rows)} candidates written to {folder / LABELS}, {todo} still to label."
    )
    print(
        "Label: 1 = you reached the summit, 0 = you did not, ? = doubtful (excluded)."
    )


# ── Mètriques ───────────────────────────────────────────────────────────────


def in_test(osm_id: str) -> bool:
    """Partició per cim: totes les aparicions d'un cim cauen a la mateixa part."""
    return hashlib.sha256(f"{SEED}:{osm_id}".encode()).digest()[0] % 2 == 1


def scores(truth: list[int], predicted: list[bool]) -> tuple[float, float, float]:
    """Precisió, exhaustivitat i F1. NaN si no es poden calcular."""
    tp = sum(t and p for t, p in zip(truth, predicted))
    fp = sum(p and not t for t, p in zip(truth, predicted))
    fn = sum(t and not p for t, p in zip(truth, predicted))
    precision = tp / (tp + fp) if tp + fp else float("nan")
    recall = tp / (tp + fn) if tp + fn else float("nan")
    f1 = 2 * tp / (2 * tp + fp + fn) if tp + fp + fn else float("nan")
    return precision, recall, f1


def bootstrap(groups: list[str], truth, predicted) -> list[tuple[float, float]]:
    """Interval del 95 % de cada mètrica, remostrejant cims sencers i no parells."""
    by_peak: dict[str, list[int]] = {}
    for i, g in enumerate(groups):
        by_peak.setdefault(g, []).append(i)
    keys = list(by_peak)
    rng = random.Random(SEED)
    samples = []
    for _ in range(BOOTSTRAP):
        idx = [i for k in rng.choices(keys, k=len(keys)) for i in by_peak[k]]
        samples.append(scores([truth[i] for i in idx], [predicted[i] for i in idx]))
    out = []
    for values in zip(*samples):
        ok = sorted(v for v in values if not isnan(v))
        out.append(
            (ok[int(0.025 * len(ok))], ok[int(0.975 * len(ok)) - 1])
            if ok
            else (float("nan"),) * 2
        )
    return out


def fmt(value: float) -> str:
    return "–" if isnan(value) else f"{value:.2f}"


def report(folder: Path) -> None:
    labels = read_labels(folder)
    if not labels:
        sys.exit(f"No labels. Run `label {folder}` first and fill in {LABELS}.")
    items, doubtful, missing = [], 0, 0
    for row, t, peak, point_d, seg_d in pairs(folder):
        value = labels.get((row["file"], row["osm_id"]), "")
        if value == "?":
            doubtful += 1
        elif value in ("0", "1"):
            items.append((row["osm_id"], int(value), t, peak, point_d, seg_d))
        else:
            missing += 1
    if missing:
        sys.exit(
            f"{missing} candidates have no label. Run `label` again and fill them in."
        )

    train = [x for x in items if not in_test(x[0])]
    test = [x for x in items if in_test(x[0])]

    def run(part, prm):
        return [peaks.judge(t, peak, pd, sd, prm) for _, _, t, peak, pd, sd in part]

    def truth(part):
        return [y for _, y, *_ in part]

    # Graella sobre la part d'ajust. En cas d'empat, guanya la primera combinació.
    grid = [Params(*values) for values in itertools.product(*GRID.values())]
    best = max(
        grid,
        key=lambda prm: _f1(
            scores(truth(train), [r.detected for r in run(train, prm)])
        ),
    )

    rows = []
    methods = {
        "entreCims, ajustat": best,
        "entreCims, valors de l'aplicació": peaks.PARAMS,
    } | REFERENCES
    for name, prm in methods.items():
        predicted = [r.detected for r in run(test, prm)]
        metric = scores(truth(test), predicted)
        ci = bootstrap([x[0] for x in test], truth(test), predicted)
        rows.append(
            f"| {name} | "
            + " | ".join(
                f"{fmt(m)} ({fmt(lo)}–{fmt(hi)})" for m, (lo, hi) in zip(metric, ci)
            )
            + " |"
        )
    train_f1 = scores(truth(train), [r.detected for r in run(train, best)])[2]

    errors = []
    for (_, y, _, peak, *_), r in zip(test, run(test, best)):
        if r.detected != bool(y):
            errors.append(
                f"| {'Fals positiu' if r.detected else 'Fals negatiu'} | {r.min_dist_m:.0f} m"
                f" | {'–' if r.ele_gap_m is None else f'{r.ele_gap_m:.0f} m'}"
                f" | {({True: 'sí', False: 'no', None: '–'})[r.is_local_max]}"
                f" | {'–' if peak.ele is None else f'{peak.ele:.0f} m'} | {r.confidence} |"
            )

    positives = sum(y for _, y, *_ in items)
    section = f"""{START}
## Cims

Generat per `eval/peaks.py report`. Llavor {SEED}, {BOOTSTRAP} rèpliques de bootstrap per cim.

### Mostra

- Parells (activitat, cim a menys de {peaks.CANDIDATE_M} m) etiquetats: {len(items)}, dels quals {positives} assolits.
- Parells dubtosos, exclosos: {doubtful}.
- Part d'ajust: {len(train)} parells de {len({x[0] for x in train})} cims.
- Part de prova: {len(test)} parells de {len({x[0] for x in test})} cims.

### Paràmetres

Escollits per F1 a la part d'ajust, entre {len(grid)} combinacions de {GRID}:
`R = {best.r} m`, `M = {best.m} m`, `W = {best.w} m`, `P = {best.p} m`, `C = {best.c} m`. F1 a la part d'ajust: {fmt(train_f1)}.

### Resultats a la part de prova

Entre parèntesis, l'interval de confiança del 95 %.

| Mètode | Precisió | Exhaustivitat | F1 |
|---|---|---|---|
{chr(10).join(rows)}

### Errors de la part de prova

Sense noms ni coordenades. L'altitud és la del cim a OpenStreetMap; la diferència és la del cim menys
la màxima del track a prop.

| Error | Distància | Diferència d'altitud | Màxim local | Altitud del cim | Confiança |
|---|---|---|---|---|---|
{chr(10).join(errors) or "| Cap | | | | | |"}
{END}"""

    path = ROOT / "docs" / "evaluation.md"
    doc = path.read_text(encoding="utf-8")
    if START in doc:
        doc = doc[: doc.index(START)] + section + doc[doc.index(END) + len(END) :]
    else:
        doc = f"# Avaluació\n\n{section}\n"
    path.write_text(doc, encoding="utf-8")
    print(f"Written to {path}.")
    print(f"Use them in the app: PARAMS = {best!r} in backend/src/peaks.py")


def _f1(metric) -> float:
    f1 = metric[2]
    return -1 if isnan(f1) else f1


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in ("label", "report"):
        sys.exit(__doc__)
    {"label": label, "report": report}[sys.argv[1]](Path(sys.argv[2]))
