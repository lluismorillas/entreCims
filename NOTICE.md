# Avisos i llicències de tercers

## Dades

| Font | Ús | Llicència | Atribució |
|---|---|---|---|
| OpenStreetMap | Cims i mapa base | ODbL | © OpenStreetMap contributors, visible al mapa |
| Valhalla (servidor públic de FOSSGIS) | Camí i altitud del planificador de rutes, sobre dades d'OpenStreetMap | Programari MIT; dades ODbL | © OpenStreetMap contributors |
| Mapterhorn | Terreny 3D i ombrejat del mapa | Diverses fonts obertes, llistades a <https://mapterhorn.com/attribution> | © Mapterhorn, visible al mapa |

Les dades d'OpenStreetMap no es distribueixen amb aquest repositori. Cada instal·lació les descarrega.

## Peticions externes

L'aplicació només es connecta a l'exterior per obtenir:

- Les rajoles del mapa.
- Els cims de la regió triada, a través d'Overpass.
- El model d'elevació del terreny 3D, a Mapterhorn. Es pot desactivar deixant buida `VITE_TERRAIN_TILEJSON_URL`.
- El camí i l'altitud entre dos punts del planificador de rutes, al servidor públic de Valhalla (<https://valhalla1.openstreetmap.de>), que rep les coordenades clicades. Es pot apuntar a un Valhalla propi o desactivar deixant buida `VITE_VALHALLA_URL`.

## Dependències

| Dependència | Llicència |
|---|---|
| MapLibre GL JS | BSD-3-Clause |
| React i React DOM | MIT |
| React Router | MIT |
| Tailwind CSS | MIT |
| Vite | MIT |
| TypeScript | Apache-2.0 |
| oxlint | MIT |
| gpxpy | Apache-2.0 |
| defusedxml | PSF |
| fitdecode | MIT |

Aquesta llista s'ha d'ampliar a mesura que s'instal·lin dependències.
