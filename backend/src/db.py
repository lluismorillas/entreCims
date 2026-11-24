"""Esquema SQLite. Tot viu dins d'un sol directori de dades, que es pot copiar com a còpia de seguretat."""

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DATA = Path(os.environ.get("ENTRECIMS_DATA", "data"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS activities(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('activity', 'planned')),
    type TEXT NOT NULL CHECK (type IN ('hike', 'trail_run', 'run')),
    file_hash TEXT NOT NULL UNIQUE,
    source_format TEXT NOT NULL,
    original_path TEXT NOT NULL,  -- relatiu al directori de dades
    started_at TEXT,
    distance_m REAL NOT NULL,
    ascent_m REAL,
    descent_m REAL,
    total_s REAL,
    moving_s REAL,
    altitude_source TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Dades que escriu l'usuari després d'importar. `tags` és una llista en JSON.
    author TEXT,
    location TEXT,
    description TEXT,
    tags TEXT
);
CREATE TABLE IF NOT EXISTS points(
    activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    ele_m REAL,
    time TEXT,
    dist_m REAL NOT NULL,
    ele_smooth_m REAL,
    PRIMARY KEY (activity_id, seq)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS peaks(
    id INTEGER PRIMARY KEY,
    osm_id INTEGER UNIQUE,
    name TEXT,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    ele_m REAL,
    merged_into INTEGER REFERENCES peaks(id)
);
CREATE TABLE IF NOT EXISTS activity_peaks(
    activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    peak_id INTEGER NOT NULL REFERENCES peaks(id),
    detected INTEGER NOT NULL,
    confidence TEXT,
    min_dist_m REAL,
    ele_gap_m REAL,
    is_local_max INTEGER,
    first_passed_at TEXT,
    manual_label INTEGER,
    PRIMARY KEY (activity_id, peak_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS photos(
    id TEXT PRIMARY KEY,
    activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    taken_at TEXT,
    lat REAL,
    lon REAL,
    position_source TEXT
);
CREATE TABLE IF NOT EXISTS time_models(
    id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Un model per tipus d'activitat a peu, cadascun amb les seves versions.
    type TEXT NOT NULL DEFAULT 'hike' CHECK (type IN ('hike', 'trail_run', 'run')),
    v0 REAL NOT NULL,
    ku REAL NOT NULL,
    kd REAL NOT NULL,
    s0 REAL NOT NULL,
    n_activities INTEGER NOT NULL,
    stop_rate REAL,
    config_json TEXT
);
"""


def init() -> None:
    """Crea el directori de dades i les taules. Es crida un cop, en arrencar el servidor."""
    DATA.mkdir(parents=True, exist_ok=True)
    with session() as con:
        con.executescript(SCHEMA)
        # Bases de dades creades abans que `activities` tingués aquestes columnes.
        existing = {row["name"] for row in con.execute("PRAGMA table_info(activities)")}
        for column in {"author", "location", "description", "tags"} - existing:
            con.execute(f"ALTER TABLE activities ADD COLUMN {column} TEXT")
        # Models desats quan només n'hi havia un, el de les excursions.
        if "type" not in {
            row["name"] for row in con.execute("PRAGMA table_info(time_models)")
        }:
            con.execute(
                "ALTER TABLE time_models ADD COLUMN type TEXT NOT NULL DEFAULT 'hike'"
            )


@contextmanager
def session():
    """Una connexió per petició: desa els canvis en sortir, o els desfà si hi ha un error."""
    con = sqlite3.connect(DATA / "entrecims.db")
    try:
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA foreign_keys = ON")
        with con:
            yield con
    finally:
        con.close()
