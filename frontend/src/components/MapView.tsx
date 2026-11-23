import { useEffect, useRef, useState } from "react";
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
    // Algo de contraste para que el texto de las teselas se lea mejor.
    layers: [{ id: "base", type: "raster", source: "base", paint: { "raster-contrast": 0.15 } }],
  };

  if (TERRAIN_TILEJSON_URL) {
    // Dues fonts separades per millorar la qualitat del relleu i de l'ombrejat.
    style.sources.terrain = { type: "raster-dem", url: TERRAIN_TILEJSON_URL };
    style.sources.hillshade = { type: "raster-dem", url: TERRAIN_TILEJSON_URL };
    style.layers.push({
      id: "hills",
      type: "hillshade",
      source: "hillshade",
      // Va encima del mapa base y tapa su texto: un sombreado suave lo deja leer.
      paint: { "hillshade-shadow-color": "#473B24", "hillshade-exaggeration": 0.25 },
    });
    style.terrain = { source: "terrain", exaggeration: 1 };
    style.sky = {};
  }

  return style;
}

// Per-viewer preferences: the page works the same without storage.
function read<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or blocked storage: the choice lasts until reload.
  }
}

/** Calls `onMap` with the map once its style is loaded, and with null when it goes away. */
export default function MapView({ onMap }: { onMap: (map: maplibregl.Map | null) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  // 0 hides the relief shading, which sits over the base map and dims its labels.
  const [shade, setShade] = useState(() => read("entrecims.map.shade", 0.25));
  const [is3d, setIs3d] = useState(() => read("entrecims.map.3d", true));
  const hasTerrain = Boolean(TERRAIN_TILEJSON_URL);

  useEffect(() => {
    if (!container.current) return;

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

    // Not "load": that waits for every tile, and never fires if a terrain tile fails.
    map.once("style.load", () => {
      setMap(map);
      onMap(map);
    });

    return () => {
      setMap(null);
      onMap(null);
      map.remove();
    };
  }, [onMap]);

  useEffect(() => {
    write("entrecims.map.shade", shade);
    if (!map?.getLayer("hills")) return;
    map.setLayoutProperty("hills", "visibility", shade > 0 ? "visible" : "none");
    map.setPaintProperty("hills", "hillshade-exaggeration", shade);
  }, [map, shade]);

  useEffect(() => {
    write("entrecims.map.3d", is3d);
    if (!map || !hasTerrain) return;
    // 2D: flat terrain, seen from above, and no tilting.
    map.setTerrain(is3d ? { source: "terrain", exaggeration: 1 } : null);
    for (const handler of [map.dragRotate, map.touchPitch]) {
      if (is3d) handler.enable();
      else handler.disable();
    }
    if (!is3d) map.easeTo({ pitch: 0, bearing: 0 });
  }, [map, is3d, hasTerrain]);

  return (
    <div className="relative h-full w-full">
      <div ref={container} className="h-full w-full" />
      {hasTerrain && (
        <div className="absolute bottom-2 left-2 z-10 flex items-center gap-3 rounded-lg bg-slate-900/90 px-3 py-2 text-xs text-slate-100 shadow">
          <div role="group" aria-label="Map view" className="flex overflow-hidden rounded-md border border-slate-700">
            {([false, true] as const).map((mode) => (
              <button
                key={String(mode)}
                aria-pressed={is3d === mode}
                onClick={() => setIs3d(mode)}
                className={`px-2 py-1 ${is3d === mode ? "bg-sky-400 font-semibold text-slate-950" : "hover:bg-slate-800"}`}
              >
                {mode ? "3D" : "2D"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2">
            Relief shading
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={shade}
              onChange={(e) => setShade(Number(e.target.value))}
              className="w-24 accent-sky-400"
            />
          </label>
        </div>
      )}
    </div>
  );
}
