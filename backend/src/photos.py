"""Fotos d'una sortida, situades per l'EXIF GPS o per l'hora del track."""

import io
from bisect import bisect_left
from datetime import UTC, datetime, tzinfo
from typing import Annotated
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image

import db
from activities import find

router = APIRouter(prefix="/api")

MAX_BYTES = 30 * 1024 * 1024
# Només formats que el navegador sap mostrar.
EXTENSIONS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}

class PhotoError(ValueError):
    """La foto no es pot afegir. El missatge es mostra a l'usuari."""

def _taken_at(exif: Image.Exif, zone: tzinfo) -> datetime | None:
    details = exif.get_ifd(0x8769)
    # DateTimeOriginal o, si no hi és, DateTime.
    text = details.get(0x9003) or exif.get(0x0132)
    try:
        when = datetime.strptime(str(text).strip("\x00 "), "%Y:%m:%d %H:%M:%S")
    except ValueError:
        return None
    # L'EXIF desa l'hora local. OffsetTimeOriginal diu de quina zona; si falta, val la de l'usuari.
    try:
        zone = datetime.strptime(str(details.get(0x9011)).strip("\x00 "), "%z").tzinfo
    except ValueError:
        pass
    return when.replace(tzinfo=zone).astimezone(UTC)

def _gps(exif: Image.Exif) -> tuple[float, float] | None:
    gps = exif.get_ifd(0x8825)

    def degrees(value, ref, negative) -> float:
        d, m, s = (float(x) for x in value)
        return (d + m / 60 + s / 3600) * (-1 if ref == negative else 1)

    try:
        lat = degrees(gps[2], gps.get(1), "S")
        lon = degrees(gps[4], gps.get(3), "W")
    except (KeyError, TypeError, ValueError, ZeroDivisionError):
        return None
    # Algunes càmeres sense senyal escriuen 0, 0.
    valid = abs(lat) <= 90 and abs(lon) <= 180 and (lat, lon) != (0, 0)
    return (lat, lon) if valid else None

def read(data: bytes, zone: tzinfo) -> tuple[str, datetime | None, tuple | None]:
    """Extensió, hora (UTC) i posició GPS d'una foto."""
    if len(data) > MAX_BYTES:
        raise PhotoError("The photo is larger than 30 MB.")
    try:
        # verify() ha d'anar just després d'obrir i deixa la imatge inservible: s'obre dues vegades.
        with Image.open(io.BytesIO(data)) as image:
            image.verify()
        with Image.open(io.BytesIO(data)) as image:
            image_format = image.format
            exif = image.getexif()
    except Exception as exc:  # Una imatge malformada no ha d'aturar el servidor.
        raise PhotoError("The file is not a valid image.") from exc
    if image_format not in EXTENSIONS:
        raise PhotoError("Only JPEG, PNG and WebP photos can be added.")
    try:
        return EXTENSIONS[image_format], _taken_at(exif, zone), _gps(exif)
    except Exception:  # noqa: BLE001 - EXIF malformat: la foto es desa, sense situar.
        return EXTENSIONS[image_format], None, None

def interpolate(when: datetime, track: list[tuple]) -> tuple[float, float] | None:
    """Posició en un instant, sobre un track de (hora, lat, lon). None si cau fora de la sortida."""
    if not track or not track[0][0] <= when <= track[-1][0]:
        return None
    i = bisect_left(track, when, key=lambda p: p[0])
    if i == 0:
        return track[0][1:]
    (t0, lat0, lon0), (t1, lat1, lon1) = track[i - 1], track[i]
    f = (when - t0) / (t1 - t0) if t1 > t0 else 0
    return lat0 + f * (lat1 - lat0), lon0 + f * (lon1 - lon0)

@router.post("/activities/{activity_id}/photos")
def add_photos(
    activity_id: str,
    files: list[UploadFile],
    tz: Annotated[str, Form()] = "UTC",
) -> list[dict]:
    """Afegeix fotos. `tz` és la zona horària de l'usuari, per a les fotos que no porten la seva."""
    try:
        zone = ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise HTTPException(422, "Unknown time zone.") from exc

    results = []
    with db.session() as con:
        find(con, activity_id)
        track = [
            (datetime.fromisoformat(time), lat, lon)
            for time, lat, lon in con.execute(
                "SELECT time, lat, lon FROM points"
                " WHERE activity_id = ? AND time IS NOT NULL ORDER BY seq",
                (activity_id,),
            )
        ]
        (db.DATA / "photos").mkdir(exist_ok=True)
        for file in files:
            name = file.filename or ""
            data = file.file.read(MAX_BYTES + 1)
            try:
                extension, taken_at, position = read(data, zone)
            except PhotoError as exc:
                results.append({"filename": name, "error": str(exc)})
                continue
            source = "exif" if position else None
            if not position and taken_at:
                position = interpolate(taken_at, track)
                source = "interpolated" if position else None
            photo = {
                "id": uuid4().hex,
                "taken_at": taken_at and taken_at.isoformat(),
                "lat": position and position[0],
                "lon": position and position[1],
                "position_source": source,
            }
            path = f"photos/{photo['id']}.{extension}"
            (db.DATA / path).write_bytes(data)
            con.execute(
                "INSERT INTO photos VALUES (:id, :activity_id, :path, :taken_at, :lat, :lon, :position_source)",
                {**photo, "activity_id": activity_id, "path": path},
            )
            results.append({"filename": name, "photo": photo})
    return results

@router.get("/photos/{photo_id}")
def get_photo(photo_id: str) -> FileResponse:
    with db.session() as con:
        row = con.execute(
            "SELECT path FROM photos WHERE id = ?", (photo_id,)
        ).fetchone()
    if row is None:
        raise HTTPException(404, "Photo not found.")
    return FileResponse(db.DATA / row["path"])
