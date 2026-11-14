import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import * as maplibregl from "maplibre-gl";
import ElevationProfile from "../components/ElevationProfile";
import MapView from "../components/MapView";
import { TYPE_LABEL, duration, estimateSeconds, km, pace, useRoutes } from "../data";

export default function RouteDetail() {
  const { id } = useParams();
  const routes = useRoutes();
  const route = routes?.find((r) => r.id === id);
  const [map, setMap] = useState<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!map || !route || route.line.length < 2) return;
    const line = route.line.map(([lon, lat]) => [lon, lat]);
    map.addSource("track", {
      type: "geojson",
      data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line } },
    });
    const round = { "line-cap": "round", "line-join": "round" } as const;
    // White casing keeps the line readable over any base map.
    map.addLayer({ id: "track-casing", type: "line", source: "track", layout: round, paint: { "line-color": "#fff", "line-width": 7 } });
    map.addLayer({ id: "track", type: "line", source: "track", layout: round, paint: { "line-color": "#1d4ed8", "line-width": 4 } });
    map.addSource("ends", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [line[0], line.at(-1)!].map((coordinates, i) => ({
          type: "Feature",
          properties: { end: i === 1 },
          geometry: { type: "Point", coordinates },
        })),
      },
    });
    map.addLayer({
      id: "ends",
      type: "circle",
      source: "ends",
      paint: {
        "circle-radius": 6,
        "circle-color": ["case", ["get", "end"], "#0f172a", "#22c55e"],
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 2,
      },
    });
    map.addSource("cursor", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({
      id: "cursor",
      type: "circle",
      source: "cursor",
      paint: { "circle-radius": 7, "circle-color": "#fbbf24", "circle-stroke-color": "#0f172a", "circle-stroke-width": 2 },
    });

    const bounds = new maplibregl.LngLatBounds(line[0] as [number, number], line[0] as [number, number]);
    for (const p of line) bounds.extend(p as [number, number]);
    map.fitBounds(bounds, { padding: 50, maxZoom: 15, animate: false });
  }, [map, route]);

  // Marks on the map the point the pointer is over in the profile.
  const showCursor = useCallback(
    (p: number[] | null) =>
      (map?.getSource("cursor") as maplibregl.GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: p ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [p[0], p[1]] } }] : [],
      }),
    [map],
  );

  if (!routes) return null;
  if (!route)
    return (
      <p className="p-6">
        Route not found.{" "}
        <Link to="/routes" className="text-sky-300 underline">
          Back to routes
        </Link>
      </p>
    );

  const planned = route.kind === "planned";
  const time = planned ? estimateSeconds(route) : { seconds: route.totalS, personalised: false };
  const stats = [
    ["Distance", km(route.distanceM)],
    [planned ? "Estimated duration" : "Duration", time.seconds ? duration(time.seconds) : "–"],
    ["Ascent", route.ascentM == null ? "–" : `${route.ascentM} m`],
    ["Descent", route.descentM == null ? "–" : `${route.descentM} m`],
    ["Average pace", time.seconds ? pace(time.seconds, route.distanceM) : "–"],
    ["Category", TYPE_LABEL[route.type]],
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
        <header>
          <Link to="/routes" className="text-sm text-slate-400 hover:text-slate-100">
            ← Routes
          </Link>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-balance">{route.name}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-400">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                planned ? "bg-sky-400/15 text-sky-300" : "bg-emerald-400/15 text-emerald-300"
              }`}
            >
              {planned ? "Planned" : "Completed"}
            </span>
            {route.date && (
              <span>{new Date(route.date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</span>
            )}
            {route.author && <span>by {route.author}</span>}
            {route.location && <span>{route.location}</span>}
            {route.source && <span>{route.source === "drawn" ? "Drawn in the planner" : "Uploaded file"}</span>}
            <span>{route.difficulty ? route.difficulty[0].toUpperCase() + route.difficulty.slice(1) : "Not rated"}</span>
          </p>
        </header>

        <dl className="grid grid-cols-2 gap-4 border-y border-slate-800 py-4 text-center sm:grid-cols-3 lg:grid-cols-6">
          {stats.map(([label, value]) => (
            <div key={label}>
              <dt className="text-sm font-semibold">{label}</dt>
              <dd className="text-slate-300">{value}</dd>
            </div>
          ))}
        </dl>
        {planned && time.seconds && !time.personalised && (
          <p className="-mt-3 text-xs text-slate-500">Duration is a generic walking estimate (Tobler), not yet based on your pace.</p>
        )}

        <div className="h-[26rem] overflow-hidden rounded-2xl border border-slate-800">
          <MapView onMap={setMap} />
        </div>

        {(route.description || route.tags?.length) && (
          <section aria-labelledby="description-title">
            <h2 id="description-title" className="mb-2 text-lg font-bold">
              Description
            </h2>
            {route.description && <p className="whitespace-pre-line text-slate-300">{route.description}</p>}
            {route.tags && route.tags.length > 0 && (
              <ul aria-label="Tags" className="mt-3 flex flex-wrap gap-2 text-xs">
                {route.tags.map((t) => (
                  <li key={t} className="rounded-full bg-slate-800 px-2 py-0.5">
                    {t}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section aria-labelledby="profile-title">
          <h2 id="profile-title" className="mb-3 text-lg font-bold">
            Elevation profile
          </h2>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <ElevationProfile line={route.line} totalM={route.distanceM} onHover={showCursor} />
          </div>
        </section>
      </div>
    </div>
  );
}
