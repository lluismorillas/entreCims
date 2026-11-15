"""Endpoints d'activitats: importar, llistar, detall, editar i eliminar."""

import json
import os
from datetime import date
from hashlib import sha256
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, HTTPException, UploadFile
from pydantic import BaseModel, StringConstraints

import db
from analysis import analyse
from importers import MAX_BYTES, TrackError, parse

router = APIRouter(prefix="/api/activities")

# avisa si una sortida 'hike' va més de pressa que això.
HIKE_MAX_KMH = float(os.environ.get("ENTRECIMS_HIKE_MAX_KMH", "6"))


def _public(row) -> dict:
    activity = dict(row)
    del activity["file_hash"], activity["original_path"]
    activity["tags"] = json.loads(activity["tags"] or "[]")
    seconds = activity["moving_s"]
    activity["fast_for_hike"] = bool(
        activity["type"] == "hike"
        and seconds
        and activity["distance_m"] / seconds * 3.6 > HIKE_MAX_KMH
    )
    return activity


def find(con, activity_id: str):
    row = con.execute(
        "SELECT * FROM activities WHERE id = ?", (activity_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(404, "Activity not found.")
    return row


def _import(filename: str, data: bytes) -> dict:
    file_hash = sha256(data).hexdigest()
    with db.session() as con:
        same = con.execute(
            "SELECT name FROM activities WHERE file_hash = ?", (file_hash,)
        ).fetchone()
        if same:
            raise TrackError(f"This file was already imported as “{same['name']}”.")
        track = parse(filename, data)
        stats = analyse(track.points)
        # identificador generat pel servidor: el nom del fitxer mai forma part d'una ruta de disc.
        activity_id = uuid4().hex
        original = f"originals/{activity_id}.{track.source_format}"
        con.execute(
            "INSERT INTO activities(id, name, kind, type, file_hash, source_format, original_path,"
            " started_at, distance_m, ascent_m, descent_m, total_s, moving_s)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                activity_id,
                track.name,
                track.kind,
                track.type,
                file_hash,
                track.source_format,
                original,
                stats.points[0].time.isoformat() if track.kind == "activity" else None,
                stats.distance_m,
                stats.ascent_m,
                stats.descent_m,
                stats.total_s,
                stats.moving_s,
            ),
        )
        con.executemany(
            "INSERT INTO points VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                (
                    activity_id,
                    seq,
                    p.lat,
                    p.lon,
                    p.ele,
                    p.time and p.time.isoformat(),
                    stats.dist_m[seq],
                    stats.ele_smooth_m and stats.ele_smooth_m[seq],
                )
                for seq, p in enumerate(stats.points)
            ),
        )
        # original es conserva sense modificar. Si no es pot desar, la sessió es desfà.
        (db.DATA / "originals").mkdir(exist_ok=True)
        (db.DATA / original).write_bytes(data)
        return _public(find(con, activity_id))


@router.post("")
def import_files(files: list[UploadFile]) -> list[dict]:
    """Importa un o més fitxers. Cada fitxer rep el seu resultat: `activity` o `error`."""
    results = []
    for file in files:
        name = file.filename or ""
        try:
            # llegeix un byte de més per detectar els fitxers massa grans sense carregar-los sencers.
            results.append(
                {
                    "filename": name,
                    "activity": _import(name, file.file.read(MAX_BYTES + 1)),
                }
            )
        except TrackError as exc:
            results.append({"filename": name, "error": str(exc)})
    return results


@router.get("")
def list_activities(
    q: str = "", date_from: date | None = None, date_to: date | None = None
) -> list[dict]:
    """Llista de sortides, amb cerca per nom i filtre per data (FR-107)."""
    sql = "SELECT * FROM activities WHERE instr(lower(name), lower(?)) > 0"
    args: list = [q.strip()]
    # rutes planificades no tenen data: filtre data les deixa fora.
    if date_from:
        sql += " AND substr(started_at, 1, 10) >= ?"
        args.append(date_from.isoformat())
    if date_to:
        sql += " AND substr(started_at, 1, 10) <= ?"
        args.append(date_to.isoformat())
    with db.session() as con:
        rows = con.execute(
            sql + " ORDER BY coalesce(started_at, created_at) DESC", args
        )
        activities = [_public(row) for row in rows]
        # ~400 punts per sortida, per miniatura i marcador HomePage.
        lines: dict[str, list] = {}
        for activity_id, lon, lat, ele in con.execute(
            "SELECT activity_id, lon, lat, ele_m FROM"
            " (SELECT *, count(*) OVER (PARTITION BY activity_id) AS n FROM points)"
            " WHERE seq % ((n + 399) / 400) = 0 OR seq = n - 1"
            " ORDER BY activity_id, seq"
        ):
            point = [round(lon, 5), round(lat, 5)]
            lines.setdefault(activity_id, []).append(
                point if ele is None else [*point, round(ele)]
            )
        for activity in activities:
            activity["line"] = lines[activity["id"]]
        return activities


@router.get("/{activity_id}")
def get_activity(activity_id: str) -> dict:
    """Detall amb tots els punts, com a [lon, lat, ele_m, dist_m, time], i les fotos."""
    with db.session() as con:
        activity = _public(find(con, activity_id))
        activity["points"] = [
            tuple(row)
            for row in con.execute(
                "SELECT lon, lat, ele_m, dist_m, time FROM points WHERE activity_id = ? ORDER BY seq",
                (activity_id,),
            )
        ]
        activity["photos"] = [
            dict(row)
            for row in con.execute(
                "SELECT id, taken_at, lat, lon, position_source FROM photos"
                " WHERE activity_id = ? ORDER BY taken_at IS NULL, taken_at, rowid",
                (activity_id,),
            )
        ]
        return activity


Text = Annotated[str, StringConstraints(strip_whitespace=True, max_length=10_000)]
Word = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]


class ActivityPatch(BaseModel):
    name: Word | None = None
    type: Literal["hike", "trail_run", "run"] | None = None
    author: Text | None = None
    location: Text | None = None
    description: Text | None = None
    tags: list[Word] | None = None


@router.patch("/{activity_id}")
def patch_activity(activity_id: str, patch: ActivityPatch) -> dict:
    """Canvia només els camps enviats."""
    changes = patch.model_dump(exclude_unset=True)
    changes = {
        key: value or None
        for key, value in changes.items()
        if value is not None or key not in ("name", "type")
    }
    if changes.get("tags"):
        changes["tags"] = json.dumps(changes["tags"])
    with db.session() as con:
        find(con, activity_id)
        if changes:
            # Les claus són noms de camp d'ActivityPatch, mai text de l'usuari.
            columns = ", ".join(f"{key} = :{key}" for key in changes)
            con.execute(
                f"UPDATE activities SET {columns} WHERE id = :id",
                {**changes, "id": activity_id},
            )
        return _public(find(con, activity_id))


@router.delete("/{activity_id}", status_code=204)
def delete_activity(activity_id: str) -> None:
    """Elimina la sortida i tot el que en depèn (FR-111). La confirmació és cosa de la interfície."""
    with db.session() as con:
        files = [find(con, activity_id)["original_path"]]
        files += [
            row["path"]
            for row in con.execute(
                "SELECT path FROM photos WHERE activity_id = ?", (activity_id,)
            )
        ]
        # Els punts, els cims assolits i les fotos cauen per ON DELETE CASCADE.
        con.execute("DELETE FROM activities WHERE id = ?", (activity_id,))
    for path in files:
        (db.DATA / path).unlink(missing_ok=True)
