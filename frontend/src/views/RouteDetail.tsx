import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import * as maplibregl from "maplibre-gl";
import ConfirmButton from "../components/ConfirmButton";
import ElevationProfile from "../components/ElevationProfile";
import MapView from "../components/MapView";
import {
  type PeakCandidate,
  type RouteInfo,
  TYPE_LABEL,
  addPhotos,
  deleteRoute,
  downloadPeaks,
  duration,
  estimateSeconds,
  km,
  labelPeak,
  pace,
  routePeaks,
  updateRoute,
  useLists,
  useRoute,
} from "../data";

const label = "mb-1 block text-xs font-semibold";

const PEAKS_STATUS = {
  no_elevation: "This track has no elevation, so reached summits cannot be detected.",
  no_peaks: "No peaks yet. The app downloads those of Catalonia the first time it starts, which takes about a minute.",
};

/** The box of a track plus about 1 km around it. */
function around(line: number[][]) {
  const lons = line.map((p) => p[0]);
  const lats = line.map((p) => p[1]);
  const pad = 0.01;
  return {
    south: Math.min(...lats) - pad,
    west: Math.max(-180, Math.min(...lons) - pad),
    north: Math.max(...lats) + pad,
    east: Math.min(180, Math.max(...lons) + pad),
  };
}

const peakName = (p: { name: string | null; ele_m: number | null }) =>
  `${p.name ?? "Unnamed peak"}${p.ele_m == null ? "" : ` (${Math.round(p.ele_m)} m)`}`;

/** Why the detection accepted or rejected a peak, in the order of the three conditions (FR-209). */
function reasons(p: PeakCandidate) {
  const gap = p.ele_gap_m;
  return [
    `${Math.round(p.min_dist_m)} m from the track`,
    gap == null
      ? "peak has no elevation: low confidence"
      : gap > 0
        ? `track ${Math.round(gap)} m below the summit`
        : `track ${Math.round(-gap)} m above the summit`,
    p.is_local_max == null ? null : p.is_local_max ? "high point of the track" : "not a high point of the track",
  ]
    .filter(Boolean)
    .join(" · ");
}

const PHOTO_PLACE = {
  exif: "On the map, from its GPS position",
  interpolated: "On the map, from the time it was taken",
  none: "Not on the map: no GPS position, and no time within the outing",
};

export default function RouteDetail() {
  const { id } = useParams();
  const [route, setRoute] = useRoute(id!);
  const [lists, setLists] = useLists();
  const navigate = useNavigate();
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [peaksProgress, setPeaksProgress] = useState("");

  // The track and the photos keep their identity when the category changes, so the map is not redrawn.
  const track = route?.line;
  const photos = route?.photos;
  const candidates = route?.peaks;

  useEffect(() => {
    if (!map || !track || track.length < 2) return;
    const line = track.map(([lon, lat]) => [lon, lat]);
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
  }, [map, track]);

  // One marker per photo that could be placed; its popup shows the photo (FR-110).
  useEffect(() => {
    if (!map || !photos) return;
    const markers = photos
      .filter((p) => p.lat != null && p.lon != null)
      .map((p) => {
        const img = document.createElement("img");
        img.src = `/api/photos/${p.id}`;
        img.alt = "Photo taken at this point";
        img.className = "max-h-48 max-w-48 rounded";
        return new maplibregl.Marker({ color: "#f59e0b" })
          .setLngLat([p.lon!, p.lat!])
          .setPopup(new maplibregl.Popup({ offset: 30, maxWidth: "none" }).setDOMContent(img))
          .addTo(map);
      });
    return () => markers.forEach((m) => m.remove());
  }, [map, photos]);

  // One marker per reached peak (FR-206).
  useEffect(() => {
    if (!map || !candidates) return;
    const markers = candidates
      .filter((p) => p.reached)
      .map((p) =>
        new maplibregl.Marker({ color: "#e11d48" })
          .setLngLat([p.lon, p.lat])
          .setPopup(new maplibregl.Popup({ offset: 30 }).setText(peakName(p)))
          .addTo(map),
      );
    return () => markers.forEach((m) => m.remove());
  }, [map, candidates]);

  // Marks on the map the point the pointer is over in the profile.
  const showCursor = useCallback(
    (p: number[] | null) =>
      (map?.getSource("cursor") as maplibregl.GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: p ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [p[0], p[1]] } }] : [],
      }),
    [map],
  );

  if (route === undefined) return null;
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
  // Runs `action` and shows its failure instead of leaving the click without an answer.
  const attempt = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The server could not be reached.");
    }
    setBusy(false);
  };

  const stats: [string, ReactNode][] = [
    ["Distance", km(route.distanceM)],
    [planned ? "Estimated duration" : "Duration", time.seconds ? duration(time.seconds) : "–"],
    ...(route.movingS != null ? ([["Moving time", duration(route.movingS)]] as [string, ReactNode][]) : []),
    ["Ascent", route.ascentM == null ? "–" : `${route.ascentM} m`],
    ["Descent", route.descentM == null ? "–" : `${route.descentM} m`],
    ["Average pace", time.seconds ? pace(time.seconds, route.distanceM) : "–"],
    [
      "Category",
      // The type comes from the file and can always be corrected (FR-106).
      route.fromApi ? (
        <select
          key="category"
          aria-label="Category"
          value={route.type}
          disabled={busy}
          onChange={(e) =>
            attempt(async () => setRoute({ ...route, ...(await updateRoute(route.id, { type: e.target.value as RouteInfo["type"] })) }))
          }
        >
          {(["hike", "trail", "run"] as const).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      ) : (
        TYPE_LABEL[route.type]
      ),
    ],
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
          {route.fromApi && !editing && (
            <button onClick={() => setEditing(true)} className="btn mt-3 mr-2 text-sm">
              Edit details
            </button>
          )}
          {route.fromApi && editing && (
            // What a file cannot say: filled in once the track is imported.
            <form
              aria-label="Edit details"
              className="mt-4 grid gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-sm sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                const text = (key: string) => String(form.get(key) ?? "").trim();
                attempt(async () => {
                  const saved = await updateRoute(route.id, {
                    name: text("name"),
                    author: text("author"),
                    location: text("location"),
                    description: text("description"),
                    tags: text("tags").split(",").map((t) => t.trim()).filter(Boolean),
                  });
                  setRoute({ ...route, ...saved });
                  setEditing(false);
                });
              }}
            >
              <label className="block">
                <span className={label}>Name</span>
                <input name="name" required pattern=".*\S.*" defaultValue={route.name} className="w-full" />
              </label>
              <label className="block">
                <span className={label}>Author (optional)</span>
                <input name="author" defaultValue={route.author ?? ""} className="w-full" />
              </label>
              <label className="block">
                <span className={label}>Location</span>
                <input name="location" defaultValue={route.location ?? ""} placeholder="e.g. Setcases, Ripollès" className="w-full" />
              </label>
              <label className="block">
                <span className={label}>Tags (comma separated)</span>
                <input name="tags" defaultValue={route.tags?.join(", ") ?? ""} className="w-full" />
              </label>
              <label className="block sm:col-span-2">
                <span className={label}>Describe your route</span>
                <textarea name="description" rows={4} defaultValue={route.description ?? ""} className="w-full" />
              </label>
              <div className="flex gap-2 sm:col-span-2">
                <button disabled={busy} className="btn btn-primary">
                  Save
                </button>
                <button type="button" onClick={() => setEditing(false)} className="btn">
                  Cancel
                </button>
              </div>
            </form>
          )}
          {route.fromApi && (
            <ConfirmButton
              label="Delete route"
              question={`Delete "${route.name}", its track and its photos? This cannot be undone.`}
              disabled={busy}
              className="mt-3 text-sm"
              onConfirm={() =>
                attempt(async () => {
                  await deleteRoute(route.id);
                  setLists(lists.map((l) => ({ ...l, routeIds: l.routeIds.filter((r) => r !== route.id) })));
                  navigate("/routes");
                })
              }
            />
          )}
          {error && (
            <p role="alert" className="mt-2 text-sm text-red-400">
              {error}
            </p>
          )}
        </header>

        <dl className="grid grid-cols-2 gap-4 border-y border-slate-800 py-4 text-center sm:grid-cols-3 lg:grid-cols-4">
          {stats.map(([label, value]) => (
            <div key={label}>
              <dt className="text-sm font-semibold">{label}</dt>
              <dd className="text-slate-300">{value}</dd>
            </div>
          ))}
        </dl>
        {route.fastForHike && (
          <p role="status" className="-mt-3 text-sm text-amber-300">
            This is faster than a usual hike. If it was a run, change its category.
          </p>
        )}
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
            <ElevationProfile
              line={route.line}
              totalM={route.distanceM}
              onHover={showCursor}
              marks={candidates
                ?.filter((p) => p.reached && p.dist_m != null)
                .map((p) => ({ distM: p.dist_m!, label: p.name ?? "Peak" }))}
            />
          </div>
        </section>

        {route.peaksStatus && route.peaksStatus !== "planned" && candidates && (
          <section aria-labelledby="peaks-title">
            <h2 id="peaks-title" className="mb-3 text-lg font-bold">
              Peaks
            </h2>
            {route.peaksStatus === "no_elevation" ? (
              <p className="text-sm text-slate-400">{PEAKS_STATUS.no_elevation}</p>
            ) : candidates.length === 0 ? (
              <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400">
                <p>{route.peaksStatus === "no_peaks" ? PEAKS_STATUS.no_peaks : "No known peak within 300 m of the track."}</p>
                {/* Peaks of another region may be downloaded already: this one may still be missing. */}
                <button
                  disabled={busy}
                  className="btn text-sm"
                  onClick={() =>
                    attempt(async () => {
                      setPeaksProgress("Downloading peaks from OpenStreetMap…");
                      try {
                        await downloadPeaks(around(route.line), (p) =>
                          setPeaksProgress(p.stage === "analyse" ? `Analysing activities: ${p.done} of ${p.total}` : "Downloading peaks from OpenStreetMap…"),
                        );
                      } finally {
                        setPeaksProgress("");
                      }
                      setRoute({ ...route, ...(await routePeaks(route.id)) });
                    })
                  }
                >
                  Download peaks around this route
                </button>
                {peaksProgress && <p role="status">{peaksProgress}</p>}
              </div>
            ) : (
              <ul className="divide-y divide-slate-800 rounded-2xl border border-slate-800 bg-slate-900 text-sm">
                {[...candidates]
                  .sort((a, b) => Number(b.reached) - Number(a.reached))
                  .map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {peakName(p)}{" "}
                          <span
                            className={`ml-1 rounded-full px-2 py-0.5 text-xs ${
                              p.reached ? "bg-emerald-400/15 text-emerald-300" : "bg-slate-800 text-slate-400"
                            }`}
                          >
                            {p.reached ? "Reached" : "Not reached"}
                            {p.manual_label != null && " · set by you"}
                          </span>
                        </p>
                        <p className="mt-0.5 text-xs text-slate-400">Detection: {reasons(p)}</p>
                      </div>
                      {/* A correction is kept when the activities are analysed again (FR-208). */}
                      <button
                        disabled={busy}
                        className="btn text-xs"
                        onClick={() =>
                          attempt(async () => {
                            const next = p.manual_label != null ? null : !p.reached;
                            const saved = await labelPeak(route.id, p.id, next);
                            setRoute({ ...route, peaks: candidates.map((c) => (c.id === p.id ? saved : c)) });
                          })
                        }
                      >
                        {p.manual_label != null ? "Undo correction" : p.reached ? "I did not reach it" : "I reached it"}
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        )}

        {photos && (
          <section aria-labelledby="photos-title">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 id="photos-title" className="text-lg font-bold">
                Photos
              </h2>
              <label className="btn cursor-pointer text-sm focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-sky-400">
                {busy ? "Working…" : "Add photos"}
                <input
                  type="file"
                  multiple
                  disabled={busy}
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(e) => {
                    const files = [...(e.target.files ?? [])];
                    e.target.value = ""; // so the same photo can be chosen again
                    if (!files.length) return;
                    attempt(async () => {
                      const results = await addPhotos(route.id, files);
                      setRoute({ ...route, photos: [...photos, ...results.flatMap((r) => r.photo ?? [])] });
                      const failed = results.filter((r) => r.error);
                      if (failed.length) setError(failed.map((r) => `${r.filename}: ${r.error}`).join(" "));
                    });
                  }}
                />
              </label>
            </div>
            {photos.length === 0 ? (
              <p className="text-sm text-slate-400">
                No photos yet. A photo is placed on the map by its GPS position or, without one, by the time it was taken.
              </p>
            ) : (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
                {photos.map((p, i) => (
                  <li key={p.id}>
                    <figure>
                      <a href={`/api/photos/${p.id}`} target="_blank" rel="noreferrer">
                        <img
                          src={`/api/photos/${p.id}`}
                          alt={`Photo ${i + 1} of ${photos.length}`}
                          loading="lazy"
                          className="aspect-square w-full rounded-xl object-cover"
                        />
                      </a>
                      <figcaption className="mt-1 text-xs text-slate-400">{PHOTO_PLACE[p.position_source ?? "none"]}</figcaption>
                    </figure>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
