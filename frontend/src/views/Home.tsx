import { useState } from "react";
import type { Map } from "maplibre-gl";
import MapView from "../components/MapView";
import { useRouteMarkers } from "../components/useRouteMarkers";
import { type RouteInfo, useRoutes } from "../data";

const NONE: RouteInfo[] = [];

export default function Home() {
  const [map, setMap] = useState<Map | null>(null);
  const routes = useRoutes();
  useRouteMarkers(map, routes ?? NONE);

  return (
    <div className="relative h-full">
      <MapView onMap={setMap} />
      {routes?.length === 0 && (
        <p role="status" className="absolute top-3 left-3 rounded-xl border border-slate-800 bg-slate-900 p-3 text-sm shadow-lg">
          No routes yet. Run <code>npm run sample-data</code> in <code>frontend/</code> or create one.
        </p>
      )}
    </div>
  );
}
