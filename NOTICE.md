# Third-party notices

## Data and services

| Source | Used for | Licence | Attribution |
|---|---|---|---|
| OpenStreetMap | Base map and peaks | ODbL | © OpenStreetMap contributors, shown on the map |
| Overpass API (public server of FOSSGIS) | Downloading OpenStreetMap peaks | Software AGPL-3.0; data ODbL | © OpenStreetMap contributors |
| Valhalla (public server of FOSSGIS) | Paths and elevation in the route planner, from OpenStreetMap data | Software MIT; data ODbL | © OpenStreetMap contributors |
| Mapterhorn | 3D terrain and relief shading | Several open sources, listed at <https://mapterhorn.com/attribution> | © Mapterhorn, shown on the map |

OpenStreetMap data is not distributed with this repository: each installation downloads it.

## Requests to outside services

The app contacts outside services only to get:

- **Map tiles**, from the server in `VITE_MAP_TILES_URL` (OpenStreetMap by default). Follow its [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) or point it to your own server.
- **3D terrain**, from Mapterhorn. Leave `VITE_TERRAIN_TILEJSON_URL` empty to turn it off.
- **Peaks**, from Overpass. On the first start the server downloads those of Catalonia and keeps them locally; change the area with `ENTRECIMS_PEAKS_REGION`, or leave it empty for none. Afterwards it only connects when you ask for the peaks of another area: the map view, the surroundings of a route, or an area by name. The known areas (countries, Spanish autonomous communities and the French Pyrenean départements) are listed in `backend/src/areas.json` with their OpenStreetMap relation id. Overpass receives the box or area name, never your tracks.
- **Paths and elevation for the route planner**, from Valhalla, which receives the points you click. Point `VITE_VALHALLA_URL` to your own Valhalla so they go nowhere, or leave it empty to draw straight lines without any request.

Your tracks, photos and database are never sent anywhere.

## Software dependencies

### Interface

| Dependency | Licence |
|---|---|
| MapLibre GL JS | BSD-3-Clause |
| React and React DOM | MIT |
| React Router | MIT |
| Tailwind CSS | MIT |
| Vite and @vitejs/plugin-react | MIT |
| TypeScript | Apache-2.0 |
| oxlint | MIT |

### Server

| Dependency | Licence |
|---|---|
| FastAPI | MIT |
| Uvicorn | BSD-3-Clause |
| python-multipart | Apache-2.0 |
| gpxpy | Apache-2.0 |
| fitdecode | MIT |
| defusedxml | PSF-2.0 |
| Pillow | MIT-CMU |
| tzdata | Apache-2.0 |

### Development only

| Dependency | Licence |
|---|---|
| pytest | MIT |
| HTTPX | BSD-3-Clause |
| Ruff | MIT |
| uv | MIT or Apache-2.0 |

Add a row here whenever a dependency is added.
