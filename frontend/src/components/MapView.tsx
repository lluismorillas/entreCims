import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { TILES_ATTRIBUTION, TILES_URL } from "../data";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

// Vite no copia el worker quan empaqueta MapLibre: cal indicar-li on és.
maplibregl.setWorkerUrl(workerUrl);

const env = import.meta.env;
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

/** Calls `onMap` with the map once its style is loaded, and with null when it goes away. */
export default function MapView({ onMap }: { onMap: (map: maplibregl.Map | null) => void }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;

    const hasTerrain = Boolean(TERRAIN_TILEJSON_URL);
    const map = new maplibregl.Map({
      container: container.current,
      style: buildStyle(),
      // World view: each screen then moves the camera to its own routes.
      center: [0, 20],
      zoom: 1,
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

    // Not "load": that waits for every tile, and never fires if a terrain tile fails.
    map.once("style.load", () => onMap(map));

    return () => {
      onMap(null);
      map.remove();
    };
  }, [onMap]);

  return <div ref={container} className="h-full w-full" />;
}
