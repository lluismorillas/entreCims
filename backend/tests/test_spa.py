from fastapi import FastAPI
from fastapi.testclient import TestClient

from main import SPA


def test_spa_fallback(tmp_path):
    (tmp_path / "index.html").write_text("app")
    (tmp_path / "a.js").write_text("js")
    app = FastAPI()
    app.mount("/", SPA(directory=tmp_path, html=True))
    client = TestClient(app)

    assert client.get("/a.js").text == "js"
    assert client.get("/routes/3").text == "app"
    assert client.get("/api/nope").status_code == 404
