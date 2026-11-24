import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from starlette.exceptions import HTTPException
from starlette.staticfiles import StaticFiles

import db
import peaks as peak_data
import timing
from activities import router as activities
from peaks import router as peaks
from photos import router as photos


@asynccontextmanager
async def lifespan(app: FastAPI):
    # La base de dades existeix des que el servidor arrenca, abans de cap petició.
    db.init()
    # En segon pla: el servidor respon mentre es descarreguen els cims de la regió per defecte.
    threading.Thread(target=peak_data.download_default, daemon=True).start()
    # Bases de dades amb sortides d'abans que existís el model: en tenen un des de l'arrencada.
    refit = threading.Thread(target=timing.refit, daemon=True)
    refit.start()
    yield
    # Uns segons com a molt: un reajust tallat a mitges no escriuria en una base de dades ja tancada.
    refit.join()


app = FastAPI(title="entreCims", lifespan=lifespan)
app.include_router(activities)
app.include_router(photos)
app.include_router(peaks)
app.include_router(timing.router)


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
