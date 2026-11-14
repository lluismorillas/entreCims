from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from starlette.exceptions import HTTPException
from starlette.staticfiles import StaticFiles

import db
from activities import router as activities
from photos import router as photos

@asynccontextmanager
async def lifespan(app: FastAPI):
    # La base de dades existeix des que el servidor arrenca, abans de cap petició.
    db.init()
    yield

app = FastAPI(title="entreCims", lifespan=lifespan)
app.include_router(activities)
app.include_router(photos)

@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}

class SPA(StaticFiles):
    # React Router resol les rutes al navegador, qualsevol ruta desconeguda rep index.html.
    async def get_response(self, path, scope):
        try:
            return await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404 or path.startswith("api"):
                raise
            return await super().get_response("index.html", scope)

# El Dockerfile hi copia la interfície compilada; en desenvolupament no existeix.
static = Path(__file__).parent.parent / "static"
if static.is_dir():
    app.mount("/", SPA(directory=static, html=True))
