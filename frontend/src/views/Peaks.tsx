import { useEffect, useState } from "react";
import { Link } from "react-router";
import * as maplibregl from "maplibre-gl";
import MapView from "../components/MapView";
import {
  type DownloadProgress,
  downloadPeaks,
  downloadPeaksArea,
  rerunAnalysis,
  usePeakAreas,
  useReachedPeaks,
} from "../data";

function describe(p: DownloadProgress) {
  switch (p.stage) {
    case "download":
      return "Downloading peaks from OpenStreetMap…";
    case "saved":
      return `Saved ${p.peaks} peaks (${p.merged} duplicates merged). Analysing your activities…`;
    case "analyse":
      return `Analysing your activities: ${p.done} of ${p.total}`;
    case "done":
      return "Done. Your activities have been analysed again.";
  }
}

const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "No date";

/** Global list of reached peaks (FR-207) and the download of the peaks of a region (FR-201). */
export default function Peaks() {
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const [peaks, reload] = useReachedPeaks();
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [area, setArea] = useState("");
  const areas = usePeakAreas();
  // Index of areas by kind, each sorted as a Catalan reader expects (accents included).
  const kinds = [...new Set(areas.map((a) => a.kind))].map(
    (kind) =>
      [
        kind,
        areas
          .filter((a) => a.kind === kind)
          .map((a) => a.name)
          .sort((x, y) => x.localeCompare(y, "ca")),
      ] as const,
  );

  useEffect(() => {
    if (!map || !peaks?.length) return;
    const markers = peaks.map((p) =>
      new maplibregl.Marker({ color: "#e11d48" })
        .setLngLat([p.lon, p.lat])
        .setPopup(new maplibregl.Popup({ offset: 30 }).setText(`${p.name ?? "Unnamed peak"} · ${p.visits.length}×`))
        .addTo(map),
    );
    const bounds = new maplibregl.LngLatBounds([peaks[0].lon, peaks[0].lat], [peaks[0].lon, peaks[0].lat]);
    for (const p of peaks) bounds.extend([p.lon, p.lat]);
    map.fitBounds(bounds, { padding: 80, maxZoom: 13 });
    return () => markers.forEach((m) => m.remove());
  }, [map, peaks]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The server could not be reached.");
    }
    setBusy(false);
  };

  return (
    <div className="flex h-full flex-col md:flex-row">
      <section aria-labelledby="peaks-title" className="max-h-[50%] shrink-0 overflow-y-auto border-slate-800 bg-slate-900 p-3 text-sm md:max-h-none md:w-96 md:border-r">
        <h1 id="peaks-title" className="text-lg font-bold">
          Peaks
        </h1>
        <p className="mt-1 text-slate-400">
          Move the map to your region and download its peaks from OpenStreetMap. Your activities are then checked for
          reached summits.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            disabled={!map || busy}
            className="btn btn-primary"
            onClick={() =>
              run(async () => {
                const b = map!.getBounds();
                const clamp = (lon: number) => Math.min(180, Math.max(-180, lon));
                const region = { south: b.getSouth(), west: clamp(b.getWest()), north: b.getNorth(), east: clamp(b.getEast()) };
                await downloadPeaks(region, (p) => setStatus(describe(p)));
              })
            }
          >
            Download peaks in this view
          </button>
          <button
            disabled={busy}
            className="btn"
            onClick={() =>
              run(async () => {
                setStatus("Analysing your activities…");
                const { activities } = await rerunAnalysis();
                setStatus(`Done. ${activities} activities analysed again.`);
              })
            }
          >
            Analyse all again
          </button>
        </div>
        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            const name = area.trim();
            if (name) run(() => downloadPeaksArea(name, (p) => setStatus(describe(p))));
          }}
        >
          <label htmlFor="area" className="mb-1 block text-xs font-semibold">
            Or download an area by its name
          </label>
          <div className="flex gap-2">
            <input
              id="area"
              list="area-index"
              required
              pattern=".*\S.*"
              placeholder="e.g. Catalunya, Andorra, Suïssa"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              className="min-w-0 flex-1"
            />
            <button disabled={busy} className="btn btn-primary">
              Download
            </button>
          </div>
          <datalist id="area-index">
            {areas.map((a) => (
              <option key={a.relation} value={a.name} label={a.kind} />
            ))}
          </datalist>
        </form>
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-100">Index of areas</summary>
          {kinds.map(([kind, names]) => (
            <div key={kind} className="mt-2">
              <h3 className="text-xs font-semibold text-slate-300">{kind}</h3>
              <ul className="mt-1 flex flex-wrap gap-1 text-xs">
                {names.map((name) => (
                  <li key={name}>
                    <button
                      type="button"
                      onClick={() => setArea(name)}
                      className="rounded-full bg-slate-800 px-2 py-0.5 hover:bg-slate-700"
                    >
                      {name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="mt-2 text-xs text-slate-500">
            Other names also work if they match an administrative area of OpenStreetMap exactly.
          </p>
        </details>

        <p role="status" className="mt-2 text-slate-300">
          {status}
        </p>
        {error && (
          <p role="alert" className="mt-2 text-red-400">
            {error}
          </p>
        )}

        <h2 className="mt-5 font-semibold">Reached peaks</h2>
        {peaks?.length === 0 && <p className="mt-1 text-slate-400">No reached peaks yet.</p>}
        <ul className="mt-2 space-y-3">
          {peaks?.map((p) => (
            <li key={p.id}>
              <button
                className="flex w-full justify-between gap-2 text-left font-medium hover:text-sky-300"
                onClick={() => map?.flyTo({ center: [p.lon, p.lat], zoom: 14 })}
              >
                <span>
                  {p.name ?? "Unnamed peak"}
                  {p.ele_m != null && <span className="font-normal text-slate-400"> · {Math.round(p.ele_m)} m</span>}
                </span>
                <span className="shrink-0 text-slate-400">{p.visits.length}×</span>
              </button>
              <ul className="mt-0.5 text-xs text-slate-400">
                {p.visits.map((v) => (
                  <li key={v.activity_id}>
                    {date(v.first_passed_at)} ·{" "}
                    <Link to={`/routes/${encodeURIComponent(v.activity_id)}`} className="underline hover:text-slate-100">
                      {v.activity_name}
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
      <div className="min-h-0 flex-1">
        <MapView onMap={setMap} />
      </div>
    </div>
  );
}
