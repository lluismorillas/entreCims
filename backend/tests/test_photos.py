import io
from datetime import UTC, datetime

import pytest
from conftest import upload
from PIL import Image
from test_importers import GPX

from photos import interpolate


# El GPX de prova va de 42.0 a 42.001 de latitud entre les 10:00 i les 10:01 UTC.
def photo(time=None, offset=None, gps=None, image_format="JPEG"):
    exif = Image.Exif()
    if time:
        exif.get_ifd(0x8769)[0x9003] = time
    if offset:
        exif.get_ifd(0x8769)[0x9011] = offset
    if gps:
        exif.get_ifd(0x8825).update(gps)
    data = io.BytesIO()
    Image.new("RGB", (4, 4)).save(data, image_format, exif=exif)
    return data.getvalue()

@pytest.fixture
def url(client):
    [result] = upload(client, ("run.gpx", GPX.encode()))
    return f"/api/activities/{result['activity']['id']}"

def post(client, url, data, **form):
    return client.post(f"{url}/photos", files=[("files", ("a.jpg", data))], data=form)

def add(client, url, data, **form):
    response = post(client, url, data, **form)
    assert response.status_code == 200
    [result] = response.json()
    return result

def test_exif_gps_wins_over_the_time(client, url):
    gps = {1: "N", 2: (42.0, 30.0, 0.0), 3: "W", 4: (2.0, 0.0, 36.0)}
    result = add(client, url, photo("2026:01:01 10:00:30", gps=gps))["photo"]
    assert (result["lat"], result["lon"]) == pytest.approx((42.5, -2.01))
    assert result["position_source"] == "exif"

def test_time_inside_the_activity_is_interpolated(client, url, tmp_path):
    data = photo("2026:01:01 10:00:30")
    result = add(client, url, data)["photo"]
    assert (result["lat"], result["lon"]) == pytest.approx((42.0005, 2.0))
    assert result["position_source"] == "interpolated"
    assert result["taken_at"] == "2026-01-01T10:00:30+00:00"

    assert client.get(f"/api/photos/{result['id']}").content == data
    assert client.get(url).json()["photos"] == [result]
    assert (tmp_path / "photos" / f"{result['id']}.jpg").exists()

def test_exif_time_is_local_time(client, url):
    # A Madrid, al gener, les 11:00:30 són les 10:00:30 UTC.
    local = photo("2026:01:01 11:00:30")
    in_madrid = add(client, url, local, tz="Europe/Madrid")["photo"]
    assert in_madrid["position_source"] == "interpolated"
    assert add(client, url, local)["photo"]["position_source"] is None
    # La zona que porta la foto passa davant de la de l'usuari.
    own = photo("2026:01:01 12:00:30", offset="+02:00")
    with_offset = add(client, url, own, tz="Europe/Madrid")["photo"]
    assert with_offset["position_source"] == "interpolated"

def test_photo_that_cannot_be_placed_is_kept_for_the_gallery(client, url):
    outside = add(client, url, photo("2026:01:01 12:00:00"))["photo"]
    assert (outside["lat"], outside["position_source"]) == (None, None)
    bare = add(client, url, photo(image_format="PNG"))["photo"]
    assert (bare["taken_at"], bare["lat"]) == (None, None)
    assert len(client.get(url).json()["photos"]) == 2

def test_rejects_what_is_not_a_photo(client, url):
    assert "not a valid image" in add(client, url, b"<gpx/>")["error"]
    assert "Only JPEG" in add(client, url, photo(image_format="GIF"))["error"]
    assert client.get(url).json()["photos"] == []
    assert post(client, url, photo(), tz="Mars/Base").status_code == 422
    assert post(client, "/api/activities/nope", photo()).status_code == 404
    assert client.get("/api/photos/nope").status_code == 404

def test_deleting_the_activity_deletes_its_photos(client, url, tmp_path):
    result = add(client, url, photo())["photo"]
    assert client.delete(url).status_code == 204
    assert list((tmp_path / "photos").iterdir()) == []
    assert client.get(f"/api/photos/{result['id']}").status_code == 404

def test_interpolate():
    def at(second):
        return datetime(2026, 1, 1, 10, 0, second, tzinfo=UTC)
    track = [
        (at(0), 0.0, 0.0),
        (at(10), 1.0, 2.0),
        (at(10), 5.0, 5.0),
        (at(20), 5.0, 6.0),
    ]
    assert interpolate(at(0), track) == (0.0, 0.0)
    assert interpolate(at(5), track) == (0.5, 1.0)
    assert interpolate(at(15), track) == (5.0, 5.5)
    assert interpolate(at(20), track) == (5.0, 6.0)
    assert interpolate(at(21), track) is None
    assert interpolate(at(5), []) is None
