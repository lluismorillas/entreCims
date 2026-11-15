import pytest
from fastapi.testclient import TestClient

import db
from main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DATA", tmp_path)
    # Com a gestor de context, el client arrenca l'aplicació i això crea la base de dades.
    with TestClient(app) as client:
        yield client

def upload(client, *files):
    response = client.post("/api/activities", files=[("files", f) for f in files])
    assert response.status_code == 200
    return response.json()
