import { useEffect, useState } from "react";

export type RouteInfo = {
  id: string;
  name: string;
  author: string | null;
  type: "hike" | "run" | "trail" | "bike";
  kind: "planned" | "recorded";
  difficulty: "easy" | "moderate" | "hard" | null;
  start: [lon: number, lat: number];
  date: string | null;
  distanceM: number;
  ascentM: number | null;
  descentM: number | null;
  totalS: number | null;
  /** Recorded time without the stops */
  movingS?: number | null;
  /** A hike faster than the server's threshold: probably a run */
  fastForHike?: boolean;
  /** Stored by the API, so it can be edited, deleted and given photos. Drawn routes are not. */
  fromApi?: boolean;
  /** Only in the detail of an API route. */
  photos?: Photo[];
  /** Only in the detail of an API route: peaks within 300 m and why each was reached or not. */
  peaks?: PeakCandidate[];
  peaksStatus?: PeaksStatus;
  /** Where the track came from: an imported file, or drawn in the planner. */
  source?: "uploaded" | "drawn";
  location?: string;
  description?: string;
  tags?: string[];
  /** Simplified track as [lon, lat, ele?]. */
  line: number[][];
};

// Base map tiles, shared by the main map and the card thumbnails (NFR-4: configurable).
export const TILES_URL: string =
  import.meta.env?.VITE_MAP_TILES_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TILES_ATTRIBUTION: string =
  import.meta.env?.VITE_MAP_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export type Photo = {
  id: string;
  taken_at: string | null;
  lat: number | null;
  lon: number | null;
  /** "exif": GPS of the photo. "interpolated": its time placed on the track. null: gallery only. */
  position_source: "exif" | "interpolated" | null;
};

/** A peak within 300 m of an activity, with the reasons of the detection (FR-209). */
export type PeakCandidate = {
  id: number;
  name: string | null;
  lat: number;
  lon: number;
  ele_m: number | null;
  detected: boolean;
  /** "low": the peak has no elevation in OpenStreetMap, so only distance and local high point count. */
  confidence: "high" | "low";
  min_dist_m: number;
  /** Peak elevation minus the highest track point near it. */
  ele_gap_m: number | null;
  /** null: the track never came within the distance limit. */
  is_local_max: boolean | null;
  first_passed_at: string | null;
  /** The user's correction, which wins over the detection. null: none. */
  manual_label: boolean | null;
  reached: boolean;
  /** Distance along the track of the first pass. */
  dist_m: number | null;
};
/** "planned": routes are not analysed. "no_peaks": none downloaded yet. */
export type PeaksStatus = "ok" | "no_peaks" | "no_elevation" | "planned";

export type ReachedPeak = {
  id: number;
  name: string | null;
  lat: number;
  lon: number;
  ele_m: number | null;
  visits: { activity_id: string; activity_name: string; first_passed_at: string | null }[];
};

/** An activity as the API returns it (backend/src/activities.py). */
type Activity = {
  id: string;
  name: string;
  kind: "activity" | "planned";
  type: "hike" | "trail_run" | "run";
  started_at: string | null;
  distance_m: number;
  ascent_m: number | null;
  descent_m: number | null;
  total_s: number | null;
  moving_s: number | null;
  fast_for_hike: boolean;
  author: string | null;
  location: string | null;
  description: string | null;
  tags: string[];
  /** List: about 400 [lon, lat, ele?] points. */
  line?: number[][];
  /** Detail: every point as [lon, lat, ele, dist, time]. */
  points?: [number, number, number | null, number, string | null][];
  photos?: Photo[];
  peaks?: PeakCandidate[];
  peaks_status?: PeaksStatus;
};

export type ImportResult = { filename: string; activity?: Activity; error?: string };
export type PhotoResult = { filename: string; photo?: Photo; error?: string };

export type RouteList = { id: string; name: string; routeIds: string[] };

export const TYPE_LABEL = { hike: "Hiking", run: "Running", trail: "Trail", bike: "Bike" };

// shortcut: drawn routes and lists live only in this browser, because the API schema has no
// place for them (spec.md leaves route drawing out of scope). Move both keys if that changes.
function load<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]");
  } catch {
    return [];
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or full storage: the change lives until reload.
  }
}

/** Keeps about 400 points: enough for the map and the profile, small enough for localStorage. */
export function simplify(points: number[][]) {
  const step = Math.ceil(points.length / 400);
  return points
    .filter((_, i) => i % step === 0 || i === points.length - 1)
    .map(([lon, lat, ele]) => [+lon.toFixed(5), +lat.toFixed(5), ...(ele == null ? [] : [Math.round(ele)])]);
}

/** crypto.randomUUID only exists over HTTPS or localhost; opened by LAN IP it is undefined. */
export const newId = (): string =>
  crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);

export function saveDrawnRoute(route: RouteInfo) {
  save("entrecims.drawn", [...load<RouteInfo>("entrecims.drawn"), route]);
}

/** The part of a route the user can change after importing it, and what follows from it. */
function editable(a: Activity) {
  return {
    name: a.name,
    type: a.type === "trail_run" ? ("trail" as const) : a.type,
    fastForHike: a.fast_for_hike,
    author: a.author,
    location: a.location ?? undefined,
    description: a.description ?? undefined,
    tags: a.tags,
  };
}

function toRoute(a: Activity, line: number[][]): RouteInfo {
  const planned = a.kind === "planned";
  const ascentM = a.ascent_m == null ? null : Math.round(a.ascent_m);
  return {
    id: a.id,
    ...editable(a),
    kind: planned ? "planned" : "recorded",
    difficulty: difficultyOf(a.distance_m, ascentM),
    start: [line[0][0], line[0][1]],
    date: a.started_at?.slice(0, 10) ?? null,
    distanceM: Math.round(a.distance_m),
    ascentM,
    descentM: a.descent_m == null ? null : Math.round(a.descent_m),
    // A planned route has no time of its own: the generic estimate stands in (see estimateSeconds).
    totalS: planned ? trackStats(line).totalS : a.total_s,
    movingS: a.moving_s,
    fromApi: true,
    photos: a.photos,
    peaks: a.peaks,
    peaksStatus: a.peaks_status,
    source: "uploaded",
    line,
  };
}

/** The server's own message when it gives one, such as a validation error. */
async function failure(response: Response) {
  const detail = await response.json().then((b) => b.detail, () => null);
  const message = typeof detail === "string" ? detail : detail?.[0]?.msg?.replace(/^Value error, /, "");
  return new Error(message || `The server answered ${response.status}.`);
}

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`/api/${path}`, init);
  if (!response.ok) throw await failure(response);
  return response.status === 204 ? null : response.json();
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** Every route: the activities of the API, then the ones drawn in this browser. */
export function useRoutes() {
  const [routes, setRoutes] = useState<RouteInfo[] | null>(null);
  useEffect(() => {
    api("activities")
      // Without the server the drawn routes still show.
      .catch(() => [])
      .then((activities: Activity[]) =>
        setRoutes([...activities.map((a) => toRoute(a, a.line!)), ...load<RouteInfo>("entrecims.drawn")]),
      );
  }, []);
  return routes;
}

/** One route with its full track and photos. undefined while loading, null if there is none. */
export function useRoute(id: string) {
  const [route, setRoute] = useState<RouteInfo | null>();
  useEffect(() => {
    let stale = false;
    const drawn = load<RouteInfo>("entrecims.drawn").find((r) => r.id === id);
    const found = drawn
      ? Promise.resolve(drawn)
      : api(`activities/${encodeURIComponent(id)}`).then(
          (a: Activity) => toRoute(a, a.points!.map(([lon, lat, ele]) => (ele == null ? [lon, lat] : [lon, lat, ele]))),
          () => null,
        );
    found.then((r) => !stale && setRoute(r));
    return () => {
      stale = true;
    };
  }, [id]);
  return [route, setRoute] as const;
}

function upload(path: string, files: Iterable<File>, fields: Record<string, string> = {}) {
  const body = new FormData();
  for (const file of files) body.append("files", file);
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  return api(path, { method: "POST", body });
}

/** Imports GPX, FIT and TCX files (FR-101). Each file gets its own result: imported, duplicate or invalid. */
export const importFiles = (files: Iterable<File>): Promise<ImportResult[]> => upload("activities", files);

/** Adds photos to a route (FR-110). The time zone is for photos that do not carry their own. */
export const addPhotos = (id: string, files: Iterable<File>): Promise<PhotoResult[]> =>
  upload(`activities/${encodeURIComponent(id)}/photos`, files, { tz: Intl.DateTimeFormat().resolvedOptions().timeZone });

export type RouteEdit = {
  name?: string;
  type?: RouteInfo["type"];
  author?: string;
  location?: string;
  description?: string;
  tags?: string[];
};

/** Changes the given fields of an API route and returns them as the server stored them. */
export async function updateRoute(id: string, edit: RouteEdit) {
  const a: Activity = await api(
    `activities/${encodeURIComponent(id)}`,
    json("PATCH", { ...edit, type: edit.type === "trail" ? "trail_run" : edit.type }),
  );
  return editable(a);
}

export const deleteRoute = (id: string) => api(`activities/${encodeURIComponent(id)}`, { method: "DELETE" });

/** Confirms (true) or rejects (false) a peak of a route, or goes back to the detection (null). FR-208. */
export const labelPeak = (routeId: string, peakId: number, reached: boolean | null): Promise<PeakCandidate> =>
  api(`activities/${encodeURIComponent(routeId)}/peaks/${peakId}`, json("PUT", { reached }));

/** Every reached peak with its visits (FR-207). `reload` fetches them again. */
export function useReachedPeaks() {
  const [peaks, setPeaks] = useState<ReachedPeak[] | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    api("peaks/reached").then(setPeaks, () => setPeaks([]));
  }, [version]);
  return [peaks, () => setVersion((v) => v + 1)] as const;
}

export type DownloadProgress =
  | { stage: "download" }
  | { stage: "saved"; peaks: number; merged: number }
  | { stage: "analyse"; done: number; total: number }
  | { stage: "done" };

/** Downloads the peaks of a box and re-analyses every activity, reporting each step (FR-201). */
export const downloadPeaks = (
  region: { south: number; west: number; north: number; east: number },
  onProgress: (p: DownloadProgress) => void,
) => streamPeaks("peaks/download", region, onProgress);

/** The same, for an administrative area by its name, such as a comarca. */
export const downloadPeaksArea = (name: string, onProgress: (p: DownloadProgress) => void) =>
  streamPeaks("peaks/download-area", { name }, onProgress);

/** Areas whose peaks can be downloaded by name (backend/src/areas.json). */
export type PeakArea = { name: string; kind: string; relation: number };
export function usePeakAreas() {
  const [areas, setAreas] = useState<PeakArea[]>([]);
  useEffect(() => {
    api("peaks/areas").then(setAreas, () => setAreas([]));
  }, []);
  return areas;
}

async function streamPeaks(path: string, body: unknown, onProgress: (p: DownloadProgress) => void) {
  const response = await fetch(`/api/${path}`, json("POST", body));
  if (!response.ok) throw await failure(response);
  // One JSON object per line, sent as each step finishes.
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    const lines = (buffer + value).split("\n");
    buffer = lines.pop()!;
    for (const line of lines.filter(Boolean)) {
      const step = JSON.parse(line);
      if (step.error) throw new Error(step.error);
      onProgress(step);
    }
  }
}

/** The peaks of a route as the server has them now, e.g. after downloading the peaks around it. */
export async function routePeaks(id: string) {
  const a: Activity = await api(`activities/${encodeURIComponent(id)}`);
  return { peaks: a.peaks, peaksStatus: a.peaks_status };
}

export const rerunAnalysis =(): Promise<{ activities: number }> => api("analysis/rerun", { method: "POST" });

export function useLists() {
  const [lists, setLists] = useState(() => load<RouteList>("entrecims.lists"));
  const update = (next: RouteList[]) => {
    setLists(next);
    save("entrecims.lists", next);
  };
  return [lists, update] as const;
}

/**
 * Quick time for a planned route, for cards and the planner.
 * shortcut: the generic Tobler estimate computed in the browser; only the route page asks the
 * server for the personalised one (usePrediction). Use it here too if cards should show it.
 */
export function estimateSeconds(route: RouteInfo) {
  return { seconds: route.totalS, personalised: false };
}

/** Activity types with a time model of their own; bikes have none (the Tobler shape does not fit). */
export const MODEL_KIND = { hike: "hike", trail: "trail_run", run: "run", bike: null } as const;

/** The user's speed model (backend/src/timing.py): curve rows are [slope %, km/h, Tobler km/h]. */
export type TimeModel = {
  version: number | null;
  /** "model": the slope curve predicts. "naismith": a·distance + b·climb, calibrated (runs). */
  method: "model" | "naismith";
  /** Seconds per metre walked and per metre climbed, for "naismith". */
  a: number;
  b: number;
  n_activities: number;
  stop_rate: number | null;
  curve: [number, number, number][];
};

/** The model rebuilt outing by outing (GET /api/model/history). */
export type ModelHistory = {
  type: string;
  method: TimeModel["method"];
  outings: {
    activity_id: string;
    name: string;
    date: string;
    moving_s: number;
    /** What the model trained on the earlier outings predicted; null for the first. */
    predicted_s: number | null;
    flat_kmh: number;
    up_kmh: number;
    down_kmh: number;
  }[];
  versions: { version: number; created_at: string; n_activities: number; flat_kmh: number }[];
};

/** Each 100 m of a recorded outing against the current model: real / predicted − 1 (FR-403). */
export type Deviations = {
  method: TimeModel["method"];
  segments: { coordinates: number[][]; deviation: number | null }[];
};

/** Asked for only once the user turns the colouring on. */
export function useDeviations(id: string, on: boolean) {
  const [result, setResult] = useState<{ id: string; deviations?: Deviations; error?: string } | null>(null);
  useEffect(() => {
    if (!on) return;
    api(`activities/${encodeURIComponent(id)}/deviations`).then(
      (deviations: Deviations) => setResult({ id, deviations }),
      (e: Error) => setResult({ id, error: e.message }),
    );
  }, [id, on]);
  return on && result?.id === id ? result : null;
}

export function useModelHistory(type: RouteInfo["type"]) {
  const [history, setHistory] = useState<ModelHistory | null>(null);
  const kind = MODEL_KIND[type];
  useEffect(() => {
    if (kind) api(`model/history?type=${kind}`).then(setHistory, () => setHistory(null));
  }, [kind]);
  // Until the new type arrives, the previous one's history is not shown under the wrong name.
  return history?.type === kind ? history : null;
}

export function useTimeModel(type: RouteInfo["type"] | undefined) {
  const [model, setModel] = useState<TimeModel | null>(null);
  const kind = type && MODEL_KIND[type];
  useEffect(() => {
    if (kind) api(`model?type=${kind}`).then(setModel, () => setModel(null));
  }, [kind]);
  return kind ? model : null;
}

/** Predicted moving time with a 90 % interval, and total time with stops when they are known. */
export type Prediction = {
  moving_s: number;
  moving_low_s: number;
  moving_high_s: number;
  total_s: number | null;
  method: TimeModel["method"];
  n_activities: number;
  version: number | null;
};

/** Asks the server for the time of a planned route (FR-305). `error` explains a refusal (FR-307). */
export function usePrediction(route: RouteInfo | null | undefined) {
  const [result, setResult] = useState<{ prediction?: Prediction; error?: string }>({});
  const line = route?.kind === "planned" ? route.line : null;
  const kind = route && MODEL_KIND[route.type];
  useEffect(() => {
    if (!line || !kind) return;
    let stale = false;
    api("predictions", json("POST", { points: line, type: kind })).then(
      (prediction: Prediction) => !stale && setResult({ prediction }),
      (e: Error) => !stale && setResult({ error: e.message }),
    );
    return () => {
      stale = true;
    };
  }, [line, kind]);
  if (line && !kind) return { error: "Time prediction is only available for hiking, trail running and running." };
  return result;
}

export const km = (m: number) => `${(m / 1000).toFixed(1)} km`;
export function duration(s: number) {
  const min = Math.round(s / 60);
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;
}
export function pace(s: number, m: number) {
  const secPerKm = Math.round(s / (m / 1000));
  return `${Math.floor(secPerKm / 60)}:${String(secPerKm % 60).padStart(2, "0")} /km`;
}

/** Great-circle distance in metres between two [lon, lat] points. */
export function distance([lon1, lat1]: number[], [lon2, lat2]: number[]) {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

/**
 * Distance, climb and generic walking time of a track of [lon, lat, ele?] points.
 * Climb and time are null unless every point has an elevation.
 */
export function trackStats(points: number[][]) {
  const hasEle = points.every((p) => typeof p[2] === "number");
  let distanceM = 0;
  let ascentM = 0;
  let descentM = 0;
  let toblerS = 0;
  // 100 m segments (spec F3) so point-to-point noise does not become absurd slopes.
  let segStart = points[0];
  let segDist = 0;
  // 5 m hysteresis: smaller steps are mostly elevation noise.
  let lastEle = points[0]?.[2];
  for (let i = 1; i < points.length; i++) {
    const d = distance(points[i - 1], points[i]);
    distanceM += d;
    if (!hasEle) continue;
    segDist += d;
    if (segDist >= 100 || i === points.length - 1) {
      // Tobler's hiking function, m/s (plan.md §7).
      const speed = (6 * Math.exp(-3.5 * Math.abs((points[i][2] - segStart[2]) / segDist + 0.05))) / 3.6;
      if (segDist > 0) toblerS += segDist / speed;
      segStart = points[i];
      segDist = 0;
    }
    const gain = points[i][2] - lastEle;
    if (gain >= 5) ascentM += gain;
    if (gain <= -5) descentM -= gain;
    if (Math.abs(gain) >= 5) lastEle = points[i][2];
  }
  return {
    distanceM: Math.round(distanceM),
    ascentM: hasEle ? Math.round(ascentM) : null,
    descentM: hasEle ? Math.round(descentM) : null,
    totalS: hasEle && toblerS ? Math.round(toblerS) : null,
    difficulty: difficultyOf(distanceM, hasEle ? ascentM : null),
  };
}

/** Effort-km: distance plus 1 km per 100 m climbed. The thresholds are arbitrary. */
function difficultyOf(distanceM: number, ascentM: number | null): RouteInfo["difficulty"] {
  if (ascentM == null) return null;
  const effort = distanceM / 1000 + ascentM / 100;
  return effort < 12 ? "easy" : effort < 25 ? "moderate" : "hard";
}
