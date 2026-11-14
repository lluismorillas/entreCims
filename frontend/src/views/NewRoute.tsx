import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import * as maplibregl from "maplibre-gl";
import MapView from "../components/MapView";
import { fitTo } from "../components/useRouteMarkers";
import {
  type ImportResult,
  type RouteInfo,
  TYPE_LABEL,
  distance,
  duration,
  importFiles,
  km,
  newId,
  saveDrawnRoute,
  simplify,
  trackStats,
  useLists,
  useRoutes,
} from "../data";
import { routeLeg } from "../routing";

type Leg = Awaited<ReturnType<typeof routeLeg>>;

// Legs are cached by their two ends, so moving one point only re-asks for the legs that touch it.
const legCache = new Map<string, Promise<Leg>>();
function getLeg(a: number[], b: number[], costing: "pedestrian" | "bicycle", followPaths: boolean) {
  const key = [a, b, costing, followPaths].join("|");
  let leg = legCache.get(key);
  if (!leg) {
    leg = routeLeg(a, b, distance(a, b), costing, followPaths);
    legCache.set(key, leg);
    // A failure may be a network blip: do not remember it.
    leg.then((l) => l.failed && legCache.delete(key));
  }
  return leg;
}

const EMPTY = {
  name: "",
  author: "",
  location: "",
  date: "",
  description: "",
  tags: "",
  difficulty: "" as "" | NonNullable<RouteInfo["difficulty"]>,
  type: "hike" as RouteInfo["type"],
  completed: false,
  listIds: [] as string[],
};

const label = "mb-1 block text-xs font-semibold";

export default function NewRoute() {
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const routes = useRoutes();
  const [lists, setLists] = useLists();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  // Drawing: the clicked points, and the path between each consecutive pair.
  const [anchors, setAnchors] = useState<number[][]>([]);
  const [routed, setRouted] = useState({ key: "", legs: [] as Leg[] });
  const [followPaths, setFollowPaths] = useState(true);
  // Importing files is separate from drawing: the server reads them and answers one result per file.
  const [imported, setImported] = useState<ImportResult[]>([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

  // What the current legs were computed for. While it differs from the request, the old
  // line stays on screen and the route counts as busy.
  const request = JSON.stringify([anchors, form.type, followPaths]);
  const busy = anchors.length > 1 && routed.key !== request;
  const legs = anchors.length > 1 ? routed.legs : [];
  useEffect(() => {
    let stale = false;
    const costing = form.type === "bike" ? "bicycle" : "pedestrian";
    const pairs = anchors.slice(1).map((to, i) => [anchors[i], to]);
    Promise.all(pairs.map(([from, to]) => getLeg(from, to, costing, followPaths))).then((result) => {
      if (!stale) setRouted({ key: request, legs: result });
    });
    return () => {
      stale = true;
    };
  }, [anchors, form.type, followPaths, request]);

  useEffect(() => {
    if (!map) return;
    map.addSource("draft", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({
      id: "draft-casing",
      type: "line",
      source: "draft",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#fff", "line-width": 7 },
    });
    map.addLayer({
      id: "draft-line",
      type: "line",
      source: "draft",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#1d4ed8", "line-width": 4 },
    });
    map.getCanvas().style.cursor = "crosshair";

    const click = (e: maplibregl.MapMouseEvent) => {
      // Clicks on a point belong to the point (drag, double-click), not to the map.
      if ((e.originalEvent.target as Element).closest?.(".maplibregl-marker")) return;
      const position = [e.lngLat.lng, e.lngLat.lat];
      // A click on the line adds a point inside that leg; anywhere else extends the route.
      const hit = map.queryRenderedFeatures(
        [
          [e.point.x - 6, e.point.y - 6],
          [e.point.x + 6, e.point.y + 6],
        ],
        { layers: ["draft-line"] },
      )[0];
      const at: number | undefined = hit?.properties.leg;
      setAnchors((a) => (at == null ? [...a, position] : [...a.slice(0, at + 1), position, ...a.slice(at + 1)]));
    };
    map.on("click", click);
    return () => void map.off("click", click);
  }, [map]);

  // Start where the user's other routes are rather than on a world map.
  useEffect(() => {
    if (map && routes?.length) fitTo(map, routes);
  }, [map, routes]);

  // One draggable handle per point.
  useEffect(() => {
    if (!map) return;
    const markers = anchors.map((position, i) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = `size-4 cursor-grab rounded-full border-2 border-blue-700 ${i === 0 ? "bg-green-400" : "bg-white"}`;
      el.setAttribute("aria-label", `Point ${i + 1} of ${anchors.length}. Drag to move, press Delete to remove.`);
      const remove = () => setAnchors((a) => a.filter((_, j) => j !== i));
      el.addEventListener("dblclick", (e) => {
        e.stopPropagation(); // or the map would also zoom in
        remove();
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Delete" || e.key === "Backspace") remove();
      });
      const marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([position[0], position[1]]).addTo(map);
      marker.on("dragend", () => {
        const { lng, lat } = marker.getLngLat();
        setAnchors((a) => a.map((p, j) => (j === i ? [lng, lat] : p)));
      });
      return marker;
    });
    return () => markers.forEach((m) => m.remove());
  }, [map, anchors]);

  useEffect(() => {
    const lines = anchors.length > 1 ? routed.legs.map((l) => l.coords) : [];
    (map?.getSource("draft") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: lines.map((coordinates, leg) => ({
        type: "Feature",
        properties: { leg },
        geometry: { type: "LineString", coordinates },
      })),
    });
  }, [map, routed, anchors.length]);

  const track = legs.flatMap((l) => l.coords);
  const stats = track.length > 1 ? trackStats(track) : null;
  const straight = legs.filter((l) => l.failed).length;
  // A drawn route marked as done has no recorded time, and an estimate would not be honest.
  const totalS = form.completed ? null : (stats?.totalS ?? null);

  async function importAll(files: File[]) {
    if (!files.length) return;
    setImporting(true);
    setError("");
    try {
      const results = await importFiles(files);
      // A single good file goes straight to its page; a batch stays here with its report.
      if (results.length === 1 && results[0].activity) navigate(`/routes/${results[0].activity.id}`);
      else setImported(results);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The files could not be imported.");
    }
    setImporting(false);
  }

  return (
    <div className="flex h-full flex-col md:flex-row">
      <form
        aria-label="New route"
        className="max-h-[55%] shrink-0 space-y-4 overflow-y-auto border-slate-800 bg-slate-900 p-4 text-sm md:max-h-none md:w-80 md:border-r"
        onSubmit={(e) => {
          e.preventDefault();
          if (!stats || busy) return;
          const id = newId();
          saveDrawnRoute({
            id,
            name: form.name.trim(),
            author: form.author.trim() || null,
            type: form.type,
            kind: form.completed ? "recorded" : "planned",
            source: "drawn",
            location: form.location.trim() || undefined,
            description: form.description.trim() || undefined,
            tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
            start: [track[0][0], track[0][1]],
            date: form.date || null,
            ...stats,
            difficulty: form.difficulty || stats.difficulty,
            totalS,
            line: simplify(track),
          });
          setLists(lists.map((l) => (form.listIds.includes(l.id) ? { ...l, routeIds: [...l.routeIds, id] } : l)));
          navigate(`/routes/${id}`);
        }}
      >
        <section aria-labelledby="import" className="space-y-2">
          <h2 id="import" className="font-bold">
            Import your outings
          </h2>
          <label className="btn block cursor-pointer text-center focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-sky-400">
            {importing ? "Importing…" : "Choose GPX, FIT or TCX files"}
            <input
              type="file"
              multiple
              disabled={importing}
              accept=".gpx,.fit,.tcx"
              className="sr-only"
              onChange={(e) => {
                importAll([...(e.target.files ?? [])]);
                e.target.value = ""; // so the same file can be chosen again
              }}
            />
          </label>
          {error && (
            <p role="alert" className="text-red-400">
              {error}
            </p>
          )}
          {imported.length > 0 && (
            <ul role="status" aria-label="Import results" className="space-y-1">
              {imported.map((r, i) => (
                <li key={i} className={r.activity ? "" : "text-red-400"}>
                  {r.activity ? (
                    <>
                      Imported{" "}
                      <Link to={`/routes/${r.activity.id}`} className="text-sky-300 underline">
                        {r.activity.name}
                      </Link>
                    </>
                  ) : (
                    `${r.filename}: ${r.error}`
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="choose" className="space-y-2 border-t border-slate-800 pt-4">
          <h2 id="choose" className="font-bold">
            Or draw a route
          </h2>
          <p className="text-slate-400">
            Click the map to add points. Drag a point to move it, click the line to add one in between, double-click a point to remove
            it.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="mr-auto flex items-center gap-1.5" title="Off: join the points with straight lines">
              <input type="checkbox" checked={followPaths} onChange={(e) => setFollowPaths(e.target.checked)} className="size-4 accent-sky-400" />
              Follow paths
            </label>
            <button type="button" disabled={!anchors.length} onClick={() => setAnchors(anchors.slice(0, -1))} className="btn">
              Undo
            </button>
            <button type="button" disabled={!anchors.length} onClick={() => setAnchors([])} className="btn">
              Clear
            </button>
          </div>
          {straight > 0 && !busy && (
            <p role="alert" className="text-amber-300">
              No path found for {straight} segment{straight > 1 ? "s" : ""}: drawn as {straight > 1 ? "straight lines" : "a straight line"}.
            </p>
          )}
        </section>

        <section aria-labelledby="basic" className="border-t border-slate-800 pt-4">
          <h2 id="basic" className="font-bold">
            Basic information
          </h2>
          <dl role="status" className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 [&_dt]:text-xs [&_dt]:font-semibold">
            <div>
              <dt>Distance</dt>
              <dd>{busy ? "…" : km(stats?.distanceM ?? 0)}</dd>
            </div>
            <div>
              <dt>{form.completed ? "Duration" : "Estimated duration"}</dt>
              <dd>{busy ? "…" : totalS ? duration(totalS) : "–"}</dd>
            </div>
            <div>
              <dt>Ascent</dt>
              <dd>{busy ? "…" : stats?.ascentM == null ? "–" : `${stats.ascentM} m`}</dd>
            </div>
            <div>
              <dt>Descent</dt>
              <dd>{busy ? "…" : stats?.descentM == null ? "–" : `${stats.descentM} m`}</dd>
            </div>
          </dl>
        </section>

        <div className="space-y-3">
          <label className="block">
            <span className={label}>Name</span>
            <input required value={form.name} onChange={set("name")} className="w-full" />
          </label>
          <label className="block">
            <span className={label}>Author (optional)</span>
            <input value={form.author} onChange={set("author")} className="w-full" />
          </label>
          <label className="block">
            <span className={label}>Location</span>
            <input value={form.location} onChange={set("location")} placeholder="e.g. Setcases, Ripollès" className="w-full" />
          </label>
          <label className="block">
            <span className={label}>Date</span>
            <input type="date" value={form.date} onChange={set("date")} className="w-full" />
          </label>
          <label className="block">
            <span className={label}>Describe your route</span>
            <textarea rows={4} value={form.description} onChange={set("description")} className="w-full" />
          </label>
          <label className="block">
            <span className={label}>Tags (comma separated)</span>
            <input value={form.tags} onChange={set("tags")} className="w-full" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={label}>Difficulty</span>
              <select value={form.difficulty} onChange={set("difficulty")} className="w-full">
                <option value="">Auto{stats?.difficulty ? ` (${stats.difficulty})` : ""}</option>
                <option value="easy">Easy</option>
                <option value="moderate">Moderate</option>
                <option value="hard">Hard</option>
              </select>
            </label>
            <label className="block">
              <span className={label}>Category</span>
              <select value={form.type} onChange={set("type")} className="w-full">
                {Object.entries(TYPE_LABEL).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.completed} onChange={(e) => setForm({ ...form, completed: e.target.checked })} className="size-4 accent-sky-400" />
            Completed (leave off for a planned route)
          </label>
        </div>

        {lists.length > 0 && (
          <fieldset className="border-t border-slate-800 pt-4">
            <legend className="float-left mb-2 font-bold">Lists</legend>
            <div className="clear-both space-y-1">
              {lists.map((l) => (
                <label key={l.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.listIds.includes(l.id)}
                    onChange={(e) =>
                      setForm({ ...form, listIds: e.target.checked ? [...form.listIds, l.id] : form.listIds.filter((id) => id !== l.id) })
                    }
                    className="size-4 accent-sky-400"
                  />
                  {l.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <button disabled={!stats || busy || !form.name.trim()} className="btn btn-primary w-full">
          Save route
        </button>
      </form>
      <div className="min-h-0 flex-1">
        <MapView onMap={setMap} />
      </div>
    </div>
  );
}
