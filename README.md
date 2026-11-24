# entreCims

**Open-source logbook for your hikes and runs.** Import GPX, FIT and TCX tracks and photos, see them on a map with their elevation profile, find out which summits you reached, and get walking times predicted from your own pace. Your data never leaves your machine.

> **En català.** entreCims és un aplicació de codi obert d'excursions i curses. Permet importar tracks GPX, FIT i TCX i fotos, mostrar-los en un mapa juntament amb el perfil d'elevació. A més a mñes detecta els cims assolits i preveu el temps d'una ruta segons el teu ritme real. Les dades no surten mai de la teva màquina. Per instal·lar-la, n'hi ha prou amb `docker compose up --build` i obrir <http://localhost:8000>. La resta del document és en anglès per facilitar-n'he les contribucions.

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

Open <http://localhost:8000>. The port is published on `127.0.0.1`.

On the first start the server downloads the peaks of Catalonia from OpenStreetMap in the background (about a minute). Every later start works offline, except for the base map and the 3D relief, which come from online tile servers.

All your data (database, original files and photos) lives in the `data` Docker volume. To make a backup just copy the volume.

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

> **Windows PowerShell:** each line above starts from the project folder. Windows PowerShell 5.1, the one that comes with Windows, does not accept `&&` and stops with *"The token '&&' is not a valid statement separator"*. Use `;` instead, one command per terminal:
>
> ```powershell
> cd backend; uv run uvicorn main:app --app-dir src --reload
> cd frontend; npm run dev
> ```
>
> The same goes for the install commands (`cd backend; uv sync`). With `;` the second command runs even if the first one fails, so check that the `cd` worked. [PowerShell 7](https://learn.microsoft.com/powershell/scripting/install/installing-powershell-on-windows) accepts `&&`, and so do Git Bash and WSL: there the commands work as written.

- The development backend and the Docker container both use port 8000: stop the container first with `docker compose stop`.
- In development, the data goes to `backend/data/`, not to the Docker volume: they are two separate databases.

Before opening a pull request, run the same checks as continuous integration:

```sh
cd backend && uv run pytest && uv run ruff check . && uv run ruff format --check .
cd frontend && npm test && npm run lint && npm run build
```

In Windows PowerShell 5.1, run these checks from PowerShell 7, Git Bash or WSL, or run them one by one: with `;` a failing check would not stop the ones after it.

## How it works

### What it is built with

entreCims runs on your computer, but some of its data comes from open online services, all based on [OpenStreetMap](https://www.openstreetmap.org/) (OSM), the free map of the world made by volunteers.

| Part | Technology | What it does |
|---|---|---|
| Map | [MapLibre GL JS](https://maplibre.org/) with [OpenStreetMap tiles](https://tile.openstreetmap.org/) | Draws the map in the browser, with your tracks and peaks on top. The map itself is a set of small images (*tiles*) downloaded as you move. |
| 3D relief and shading | [Mapterhorn](https://mapterhorn.com/) elevation tiles | Tiles that hold altitudes instead of pictures. MapLibre uses them to lift the map into 3D terrain and to shade the slopes. |
| Reading tracks | [gpxpy](https://github.com/tkrajina/gpxpy), [fitdecode](https://github.com/polyvertex/fitdecode), [defusedxml](https://github.com/tiran/defusedxml) | Read GPX, FIT (Garmin and others) and TCX files. defusedxml protects against malicious files. |
| Peaks | OSM peaks (`natural=peak`) downloaded with the [Overpass API](https://overpass-api.de/) | Overpass is a search service for OSM data: it returns every peak with its name and altitude in an area. They are saved in the local database, so it is only used for downloads. The decision whether you reached a peak is entreCims' own code (see below). |
| Route planner | [Valhalla](https://github.com/valhalla/valhalla), public FOSSGIS server | A routing engine, like the one behind a car GPS but for walking (`pedestrian`) or cycling on OSM paths. You place points on the map, and Valhalla returns the path that joins them along real trails (`/route`), plus the altitude of each point (`/height`) for the elevation profile and the time estimate. Without it, the planner can only draw straight lines. |
| Photos | [Pillow](https://python-pillow.org/) | Reads each photo's position and time (EXIF) to place it on the track. |
| Time prediction | Own code, based on [Tobler's hiking function](https://en.wikipedia.org/wiki/Tobler%27s_hiking_function) and [Naismith's rule](https://en.wikipedia.org/wiki/Naismith%27s_rule) | Learns your speed from your outings (see below). |
| Server | Python, [FastAPI](https://fastapi.tiangolo.com/), SQLite | The API and the database, a single file. |
| Interface | [React](https://react.dev/), [Vite](https://vite.dev/), [Tailwind CSS](https://tailwindcss.com/) | The web pages. |
| Packaging | Docker and Compose | The whole app in one container. |

Each online service can be replaced by your own or turned off (see [Configuration](#configuration)), and the planner can use your own Valhalla (see [below](#your-own-valhalla-optional)).

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

### The evaluation

The figures above come from `eval/`, two scripts that check each method does what this README says. They answer two questions: does peak detection works correctly, and which time-prediction method is closest to the real time for each type of outing. The app's choices (the detection parameters and the method per type track) are taken from these results, and the scripts let anyone repeat the check with their own tracks.

**What they use**

- Your own GPX, FIT or TCX files, read with the same code as the app (`backend/src`).
- Peaks: the OpenStreetMap peaks near each track, downloaded once from Overpass and cached in `<folder>/.peaks/`.
- Peaks ground truth: your own labels. `label` lists every (outing, peak within 300 m) pair *without* the app's verdict, so the labelling is blind; you write 1 (reached), 0 (not reached) or ? (unsure, left out).
- Time ground truth: the moving time and total time recorded in each file.
- A fixed random seed (2026) and 1000 bootstrap resamples, so a rerun on the same data gives the same report.

**How peaks are evaluated.** The labelled peaks are split in two halves. The detection parameters are chosen on one half (by F1, over a grid of 432 combinations) and measured on the other, so the score is not flattered by tuning. The same test half is scored with the rules of other tools (`trailscan`, Summit Bag, `intervals-summits`) for comparison, and every remaining mistake is listed with its distance, altitude difference and whether the peak was a local high point.

**What F1 is, with an example.** A detector can go wrong in two ways: it can mark a peak you did not climb, or miss one you did. Two figures measure each mistake separately:

- **Precision**: of the peaks the app marks, how many you really reached. It drops when the app marks false summits.
- **Recall**: of the peaks you really reached, how many the app finds. It drops when the app misses summits.

Say you reached 20 peaks, and the app marks 15, of which 12 are right:

- Precision = 12 right / 15 marked = **0.80**
- Recall = 12 right / 20 reached = **0.60**

To choose between two sets of parameters, you need one number, not two. F1 gives it: `F1 = 2 × precision × recall / (precision + recall)`. Here that is `2 × 0.80 × 0.60 / (0.80 + 0.60)` = **0.69**.

Why not just take the plain average? Because it can be fooled. A lazy rule that marks *all* 100 peaks near your tracks finds the 20 you climbed (recall 1.00), but only 20 of its 100 marks are right (precision 0.20). The plain average gives it a respectable 0.60, but F1 gives it **0.33**. F1 is always pulled towards the worse of the two figures, so a method only scores well if it is good at both. It goes from 0 (useless) to 1 (no mistakes). The app's parameters are the ones with the highest F1 on the tuning half.

**How time is evaluated.** For each type of outing, the own model is compared with Tobler, plain Naismith and calibrated Naismith in two ways:

- *Leave-one-out*: each outing is predicted by a model trained on all the others.
- *Temporal*: each outing is predicted only from the earlier ones, as the app would have done at the time. This is the more realistic test.

The model settings are chosen again inside each round, with only the training outings, so the outing being predicted never helps.

**How to read the report**

| Figure | Meaning | Good value |
|---|---|---|
| Precision | Of the peaks the app marks as reached, the share you really reached. Low precision means false summits. | Close to 1 |
| Recall | Of the peaks you reached, the share the app finds. Low recall means missed summits. | Close to 1 |
| F1 | One number that balances precision and recall. | Close to 1 |
| MAPE | Average error of the predicted moving time, as a percentage of the real one, ignoring the sign. | Low |
| Mean absolute error | The same error in minutes. | Low |
| Median error | The typical error *with* its sign: **positive means the prediction is too slow** (longer than the real time), negative too fast. Far from 0 means a systematic bias. | Close to 0 |

- **Ranges in brackets** are 95 % confidence intervals. With a few dozen outings they are wide: when two methods' ranges overlap a lot, the data cannot tell them apart.
- **The verdict per type** compares the own model with calibrated Naismith outing by outing. If the whole interval of the difference is below 0, the own model wins. If it is entirely above 0, it loses. Otherwise, the result is inconclusive. This verdict decides the method in the table above.
- **Total time** (with stops) has a much larger error than moving time, because stops change a lot from one outing to the next. Read it as a rough guide.
- The results describe *your* outings. Someone else's tracks may lead to other numbers, or even another method per type. That is why the scripts are there.

#### Running eval

Your tracks are private and never go in the repository, so these commands run on a folder of your own (`eval/private/` is git-ignored):

```sh
uv run --project backend python eval/peaks.py label eval/private    # writes peak_labels.csv to fill in, blind
uv run --project backend python eval/peaks.py report eval/private   # peaks section of docs/evaluation.md
uv run --project backend python eval/timing.py eval/private         # time section of docs/evaluation.md
```

The report holds aggregate figures only, never coordinates or names.

## Your own Valhalla (optional)

[Valhalla](https://github.com/valhalla/valhalla) is the engine that turns the points you place in the planner into a path along real trails, with its altitude profile. By default the planner asks the public server of FOSSGIS for it. It is free and has no guarantee: when it does not answer, the planner shows a warning and draws straight lines.

Running your own Valhalla is worth it if:

- **The public server is down or slow.** It is run by volunteers, with no uptime promise, and it can be unreachable from some networks. With your own, the planner works whenever your computer does, even without internet once the graph is built.
- **You want to keep your plans private.** Every point you draw is sent to the public server. With your own, they stay on your machine, like everything else in entreCims.
- **You plan a lot.** The public server is shared and meant for light use. Your own has no limits.
- **You want to choose the data.** You pick the region and when to update it, for example adding the French and Andorran extracts for the Pyrenees.

The cost is disk, memory and a long first build, so the default install does not include it.

To run your own, add a service with the official image `ghcr.io/valhalla/valhalla-scripted` and an OpenStreetMap extract, for example Catalonia from Geofabrik:

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
