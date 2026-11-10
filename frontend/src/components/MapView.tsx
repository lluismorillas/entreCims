import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

// Vite no copia el worker quan empaqueta MapLibre: cal indicar-li on és.
maplibregl.setWorkerUrl(workerUrl);

const env = import.meta.env;
const TILES_URL =
  env.VITE_MAP_TILES_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILES_ATTRIBUTION =
  env.VITE_MAP_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
// Amb una cadena buida, el mapa és 2D i no es demana cap dada d'elevació.
const TERRAIN_TILEJSON_URL: string =
  env.VITE_TERRAIN_TILEJSON_URL ?? "https://tiles.mapterhorn.com/tilejson.json";

function buildStyle(): StyleSpecification {
  const style: StyleSpecification = {
    version: 8,
    sources: {
      base: {
        type: "raster",
        tiles: [TILES_URL],
        tileSize: 256,
        maxzoom: 19,
        attribution: TILES_ATTRIBUTION,
      },
    },
    layers: [{ id: "base", type: "raster", source: "base" }],
  };

  if (TERRAIN_TILEJSON_URL) {
    // Dues fonts separades per millorar la qualitat del relleu i de l'ombrejat.
    style.sources.terrain = { type: "raster-dem", url: TERRAIN_TILEJSON_URL };
    style.sources.hillshade = { type: "raster-dem", url: TERRAIN_TILEJSON_URL };
    style.layers.push({
      id: "hills",
      type: "hillshade",
      source: "hillshade",
      paint: { "hillshade-shadow-color": "#473B24" },
    });
    style.terrain = { source: "terrain", exaggeration: 1 };
    style.sky = {};
  }

  return style;
}

export default function MapView() {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;

    const hasTerrain = Boolean(TERRAIN_TILEJSON_URL);
    const map = new maplibregl.Map({
      container: container.current,
      style: buildStyle(),
      center: [1.95, 42.4],
      zoom: hasTerrain ? 12 : 8,
      pitch: hasTerrain ? 70 : 0,
      maxZoom: 18,
      maxPitch: 85,
      attributionControl: { compact: false },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }));
    if (hasTerrain) {
      map.addControl(
        new maplibregl.TerrainControl({ source: "terrain", exaggeration: 1 }),
      );
    }

    return () => map.remove();
  }, []);

  return <div ref={container} className="h-full w-full" />;
}
