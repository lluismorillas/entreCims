import pytest
from conftest import upload
from test_importers import GPX, TCX, make_fit

import db

def test_import_stores_stats_points_and_the_original(client, tmp_path):
    [result] = upload(client, ("run.gpx", GPX.encode()))
    activity = result["activity"]
    assert (activity["name"], activity["kind"], activity["type"]) == (
        "Synthetic run",
        "activity",
        "trail_run",
    )
    assert activity["started_at"] == "2026-01-01T10:00:00+00:00"
    assert activity["distance_m"] == pytest.approx(111.2, abs=0.1)
    assert (activity["total_s"], activity["moving_s"]) == (60, 60)
    assert activity["ascent_m"] == pytest.approx(10.5)

    detail = client.get(f"/api/activities/{activity['id']}").json()
    assert detail["points"][0] == [2.0, 42.0, 1000.0, 0.0, "2026-01-01T10:00:00+00:00"]
    assert len(detail["points"]) == 2
    assert (
        tmp_path / "originals" / f"{activity['id']}.gpx"
    ).read_bytes() == GPX.encode()

def test_duplicate_is_rejected(client):
    upload(client, ("run.gpx", GPX.encode()))
    [again] = upload(client, ("other-name.gpx", GPX.encode()))
    assert "already imported as “Synthetic run”" in again["error"]
    assert len(client.get("/api/activities").json()) == 1

def test_batch_with_a_corrupt_file_keeps_working(client, tmp_path):
    results = upload(
        client, ("a.gpx", b"<gpx><trk>"), ("b.tcx", TCX.encode()), ("c.fit", make_fit())
    )
    assert "not a valid GPX" in results[0]["error"]
    assert [r["activity"]["source_format"] for r in results[1:]] == ["tcx", "fit"]
    assert len(list((tmp_path / "originals").iterdir())) == 2
    assert client.get("/api/health").status_code == 200

def test_list_search_and_date_filter(client):
    planned = GPX.replace("<time>2026-01-01T10:01:00Z</time>", "").replace(
        "Synthetic run", "Plan"
    )
    upload(client, ("run.gpx", GPX.encode()), ("plan.gpx", planned.encode()))

    def names(**params):
        return [a["name"] for a in client.get("/api/activities", params=params).json()]

    assert sorted(names()) == ["Plan", "Synthetic run"]
    assert names(q="SYNTH") == ["Synthetic run"]
    [listed] = client.get("/api/activities", params={"q": "synth"}).json()
    assert listed["line"] == [[2.0, 42.0, 1000], [2.0, 42.001, 1010]]
    assert names(q="%") == []
    assert names(date_from="2026-01-01", date_to="2026-01-01") == ["Synthetic run"]
    assert names(date_from="2026-01-02") == []
    assert (
        client.get("/api/activities", params={"date_from": "yesterday"}).status_code
        == 422
    )

def test_patch_name_and_type(client):
    [result] = upload(client, ("run.gpx", GPX.encode()))
    url = f"/api/activities/{result['activity']['id']}"
    assert client.patch(url, json={"type": "hike"}).json()["type"] == "hike"
    patched = client.patch(url, json={"name": "  Renamed "}).json()
    assert (patched["name"], patched["type"]) == ("Renamed", "hike")
    assert client.patch(url, json={"type": "bike"}).status_code == 422
    assert client.patch(url, json={"name": " "}).status_code == 422

def test_details_written_after_the_import(client):
    [result] = upload(client, ("run.gpx", GPX.encode()))
    assert (result["activity"]["author"], result["activity"]["tags"]) == (None, [])
    url = f"/api/activities/{result['activity']['id']}"
    details = {
        "author": " Me ",
        "location": "Setcases",
        "description": "Windy.\nCold.",
        "tags": ["ridge", " snow "],
    }
    assert client.patch(url, json=details).status_code == 200
    [listed] = client.get("/api/activities").json()
    assert {k: listed[k] for k in details} == {
        **details,
        "author": "Me",
        "tags": ["ridge", "snow"],
    }
    # Un altre canvi no toca aquests camps, i un text buit o una llista buida els esborra.
    assert client.patch(url, json={"type": "run"}).json()["location"] == "Setcases"
    cleared = client.patch(url, json={"author": "", "tags": []}).json()
    assert (cleared["author"], cleared["tags"]) == (None, [])
    assert cleared["description"] == "Windy.\nCold."
    assert client.patch(url, json={"name": None}).json()["name"] == "Synthetic run"
    assert client.patch(url, json={"tags": [" "]}).status_code == 422

def test_init_upgrades_an_older_database(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DATA", tmp_path / "data")
    db.init()
    with db.session() as con:
        con.execute("ALTER TABLE activities DROP COLUMN tags")
    db.init()
    with db.session() as con:
        assert con.execute("SELECT tags, author FROM activities").fetchall() == []

def test_fast_hike_is_flagged(client):
    # 111 m en 10 s són 40 km/h: massa per a una excursió (FR-106).
    fast = GPX.replace("10:01:00Z", "10:00:10Z").replace(
        "<type>trail_running</type>", ""
    )
    [result] = upload(client, ("fast.gpx", fast.encode()))
    assert result["activity"]["fast_for_hike"] is True
    url = f"/api/activities/{result['activity']['id']}"
    assert client.patch(url, json={"type": "run"}).json()["fast_for_hike"] is False

def test_delete_removes_everything(client, tmp_path):
    [result] = upload(client, ("run.gpx", GPX.encode()))
    url = f"/api/activities/{result['activity']['id']}"
    assert client.delete(url).status_code == 204
    assert client.get(url).status_code == 404
    assert client.delete(url).status_code == 404
    assert list((tmp_path / "originals").iterdir()) == []
    with db.session() as con:
        assert con.execute("SELECT count(*) FROM points").fetchone()[0] == 0
    # Un cop eliminada, es pot tornar a importar.
    assert "activity" in upload(client, ("run.gpx", GPX.encode()))[0]

def test_unknown_activity(client):
    assert client.get("/api/activities/nope").status_code == 404
    assert client.patch("/api/activities/nope", json={}).status_code == 404
