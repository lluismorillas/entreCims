# entreCims

**A local, open-source logbook for your hikes and runs.** Import GPX, FIT and TCX tracks and photos, see them on a map with their elevation profile, find out which summits you reached, and get walking times predicted from your own pace. Your data never leaves your machine.

> **En català.** entreCims és un aplicació local i de codi obert d'excursions i curses. Permet importar tracks GPX, FIT i TCX i fotos, mostra-les en un mapa amb el perfil d'elevació, detecta els cims assolits i preveu el temps d'una ruta segons el teu ritme real. Les dades no surten mai de la teva màquina. Per instal·lar-la, n'hi ha prou amb `docker compose up --build` i obrir <http://localhost:8000>. La resta del document és en anglès per facilitar les contribucions.

![The route page: map, elevation profile, reached peaks and time prediction](docs/screenshots/route.png)

## Features

- **Logbook.** Import tracks one by one or in bulk (duplicates are refused), with distance, ascent, descent, total and moving time. Search by name, filter by date, edit details, delete with confirmation.
- **Map and profile.** 2D map or 3D terrain, with adjustable relief shading; the elevation profile is linked to the map.
- **Photos.** Placed on the track by their GPS position or, without one, by the time they were taken.
- **Peak detection.** Every recorded outing is checked against OpenStreetMap peaks. You can confirm or reject each result, and see why it was accepted or rejected. A global list shows every peak with its visits.
- **Time prediction.** Planned routes get a predicted moving time with a 90 % range, and a total time with your usual stops. A *Time model* page shows how your pace has changed outing by outing, and each recorded track can be coloured by where you were faster or slower than predicted.
- **Route planner.** Click to draw a route that follows paths, drag the line to change it, and save it.

| | |
|---|---|
| ![Home map with every route](docs/screenshots/home.png) | ![Peaks page](docs/screenshots/peaks.png) |
| ![Time model page](docs/screenshots/time-model.png) | ![Route planner](docs/screenshots/planner.png) |

## Install

You need [Docker](https://docs.docker.com/get-docker/) with Compose.

```sh
git clone https://github.com/lluismorillas/entreCims.git
cd entreCims
docker compose up --build
```

Open <http://localhost:8000>. The port is published on `127.0.0.1` only: the app has no accounts, so it must not be reachable from other machines.

On the first start the server downloads the peaks of Catalonia from OpenStreetMap in the background (about a minute). Every later start works offline, except for the base map and the 3D relief, which come from online tile servers.

All your data (database, original files and photos) lives in the `data` Docker volume. To make a backup you need to copy the volume.

### Configuration

Server (environment variables of the `app` service in `compose.yaml`):

| Variable | Default | What it does |
|---|---|---|
| `ENTRECIMS_PEAKS_REGION` | `Catalunya` | OpenStreetMap area whose peaks are downloaded on the first start. Empty: none. |
| `ENTRECIMS_OVERPASS_URL` | `https://overpass-api.de/api/interpreter` | Overpass server for the peaks. |
| `ENTRECIMS_HIKE_MAX_KMH` | `6` | A hike faster than this gets a "probably a run" warning. |
| `ENTRECIMS_HALF_LIFE_DAYS` | `180` | How fast old outings lose weight in the time model. |
| `ENTRECIMS_DATA` | `/data` | Data directory. |

Interface (read when the frontend is **built**, so rebuild after changing them; see `frontend/.env.example`):

| Variable | Default | What it does |
|---|---|---|
| `VITE_MAP_TILES_URL` | OpenStreetMap tiles | Base map tiles. |
| `VITE_MAP_ATTRIBUTION` | © OpenStreetMap contributors | Base map attribution. |
| `VITE_TERRAIN_TILEJSON_URL` | Mapterhorn | 3D terrain and shading. Empty: 2D only. |
| `VITE_VALHALLA_URL` | `https://valhalla1.openstreetmap.de` | Path and elevation server for the planner. Empty: straight lines. |

### Development

Install the dependencies once, and again whenever `uv.lock` or `package-lock.json` change:

```sh
cd backend && uv sync      # Python 3.12, with uv
cd frontend && npm ci      # Node 24
```

Run the app in two terminals. Each part reloads by itself when you save a file, so there is nothing to rebuild:

```sh
cd backend && uv run uvicorn main:app --app-dir src --reload   # API on port 8000
cd frontend && npm run dev                                     # open http://localhost:5173
```

- The development backend and the Docker container both use port 8000: stop the container first with `docker compose stop`.
- In development, the data goes to `backend/data/`, not to the Docker volume: they are two separate databases.

Before opening a pull request, run the same checks as continuous integration:

```sh
cd backend && uv run pytest && uv run ruff check . && uv run ruff format --check .
cd frontend && npm test && npm run lint && npm run build
```

## How it works

### Peak detection

A peak counts as reached when the track **passes close** to it (measured against the track's segments, not just its points), **reaches its altitude** (within a margin, using a light median filter, because strong smoothing lowers summits), and the peak is a **local high point** of the profile. Very close passes skip the last test, so flat summits, ridge points and pinnacles beside the path still count; farther passes need it, which rules out paths that skirt a summit.

Tested on 152 hand-labelled (outing, peak) pairs, tuned on one half of the peaks and evaluated on the other: **precision 0.92, recall 0.71, F1 0.80**, against 0.79 for `trailscan`'s rule, 0.74 for Summit Bag's and 0.71 for `intervals-summits`'s. See [`docs/evaluation.md`](docs/evaluation.md).

### Time models

Each type of outing has a model of its own, trained only on your outings of that type, and each one predicts with the method that won in the evaluation:

| Type | Method | Moving-time error (leave-one-out MAPE) |
|---|---|---|
| Hike | **Own model**: speed by slope, fitted to your hikes | **10.2 %**, against 13.7 % for calibrated Naismith |
| Trail run | **Calibrated Naismith**: a·distance + b·climb, fitted to your trail runs | 8.6 %, against 14.3 % for the own model |
| Run | **Calibrated Naismith** | 12.1 %, against 11.1 % for the own model (no clear difference) |
| Bike | None | — |

The **own model** has the shape of Tobler's hiking function, with separate brakes for uphill and steep downhill:
`v(s) = v0·exp(−ku·(s − s0))` uphill and `v0·exp(−kd·(s0 − s))` downhill, with `s0 = −5 %`. It is fitted on 100 m segments, without stops, with a robust loss (Huber) on the logarithm of speed, weighting each segment by its length and recency (half-life 180 days). With few outings, the curve's shape leans towards Tobler's, but the speed `v0` is always your own: Tobler walks, and a walking speed would slow down a runner's model.

**Why runs use calibrated Naismith.** The own model loses or ties on runs, for reasons the evaluation points to:

- Running covers 100 m in about 30 seconds, so GPS altitude noise weighs much more than when walking, and the curved (exponential) model turns that noise into too-slow predictions (+13 % on trail runs).
- Trail runs switch between running and power-hiking on steep climbs, which one curve cannot follow.
- A run's pace depends more on the day's plan (easy run, tempo) than on the slope.
- There are fewer of them (14 trail runs).

**Bikes** have no model: descents, inertia and braking do not fit a walking curve.

The total time adds your usual proportion of stops; it is much less accurate (MAPE 37 % for hikes), because stops vary a lot from one outing to the next.

### Running the evaluation

Your tracks are private and never go in the repository, so these commands run on a folder of your own (`eval/private/` is git-ignored):

```sh
uv run --project backend python eval/peaks.py label eval/private    # writes peak_labels.csv to fill in, blind
uv run --project backend python eval/peaks.py report eval/private   # peaks section of docs/evaluation.md
uv run --project backend python eval/timing.py eval/private         # time section of docs/evaluation.md
```

The report holds aggregate figures only, never coordinates or names.

## Your own Valhalla (optional)

The planner asks the public [Valhalla](https://github.com/valhalla/valhalla) server of FOSSGIS for paths and elevation. It is free and has no guarantee: when it does not answer, the planner shows a warning and draws straight lines. To run your own, add a service with the official image `ghcr.io/valhalla/valhalla-scripted` and an OpenStreetMap extract, for example Catalonia from Geofabrik:

```yaml
  valhalla:
    image: ghcr.io/valhalla/valhalla-scripted:latest
    ports:
      - "127.0.0.1:8002:8002"
    volumes:
      - valhalla:/custom_files
    environment:
      tile_urls: https://download.geofabrik.de/europe/spain/cataluna-latest.osm.pbf
      build_elevation: "True"
```

The first start builds the routing graph (15 minutes to over an hour, several GB of disk, 2–4 GB of RAM while building); later starts take seconds. Check the image's README for the current variable names. Then build the interface with `VITE_VALHALLA_URL=http://localhost:8002`: it is read at build time, not at run time.

## Limitations

- One user, no accounts and no access control: run it on your own machine only.
- The base map and the 3D relief need an internet connection; tracks, peaks and predictions do not.
- Peaks outside the downloaded region need a download (by map view, around a route, or by area name).
- Detection and time models were evaluated on one person's 58 outings; your results may differ. The time models only cover walking and running.
- Tracks without elevation get no peak detection and no prediction.
- The planner depends on a Valhalla server, public or your own.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Please follow the [code of conduct](CODE_OF_CONDUCT.md), and report security issues as described in [SECURITY.md](SECURITY.md).

## Licence

Code under the [MIT licence](LICENSE). Data and services from third parties have their own terms, listed in [NOTICE.md](NOTICE.md): map data © OpenStreetMap contributors (ODbL), terrain © Mapterhorn.
