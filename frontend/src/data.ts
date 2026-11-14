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
  /** Where the track came from: a GPX/TCX file, or drawn in the planner. */
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

export type RouteList = { id: string; name: string; routeIds: string[] };

export const TYPE_LABEL = { hike: "Hiking", run: "Running", trail: "Trail", bike: "Bike" };

// shortcut: browser-only persistence, move both keys to the API when the backend exists.
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

export function saveDrawnRoute(route: RouteInfo) {
  save("entrecims.drawn", [...load<RouteInfo>("entrecims.drawn"), route]);
}

/** Single data entry point: swap the fetch for GET /api/activities later. */
export function useRoutes() {
  const [routes, setRoutes] = useState<RouteInfo[] | null>(null);
  useEffect(() => {
    fetch("/routes.json")
      // Without the generated file the dev server answers with index.html.
      .then((r) => (r.ok && r.headers.get("content-type")?.includes("json") ? r.json() : []))
      .catch(() => [])
      .then((sample: RouteInfo[]) => setRoutes([...sample, ...load<RouteInfo>("entrecims.drawn")]));
  }, []);
  return routes;
}

export function useLists() {
  const [lists, setLists] = useState(() => load<RouteList>("entrecims.lists"));
  const update = (next: RouteList[]) => {
    setLists(next);
    save("entrecims.lists", next);
  };
  return [lists, update] as const;
}

/**
 * Personalised time for a planned route (task 3.3).
 * shortcut: returns the generic Tobler estimate computed at import, because the
 * user's performance model (spec F3) does not exist yet. Replace the body with
 * POST /api/predictions; `personalised` then becomes true.
 */
export function estimateSeconds(route: RouteInfo) {
  return { seconds: route.totalS, personalised: false };
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
  // Effort-km: distance plus 1 km per 100 m climbed. The thresholds are arbitrary.
  const effort = distanceM / 1000 + ascentM / 100;
  const difficulty: RouteInfo["difficulty"] = !hasEle ? null : effort < 12 ? "easy" : effort < 25 ? "moderate" : "hard";
  return {
    distanceM: Math.round(distanceM),
    ascentM: hasEle ? Math.round(ascentM) : null,
    descentM: hasEle ? Math.round(descentM) : null,
    totalS: hasEle && toblerS ? Math.round(toblerS) : null,
    difficulty,
  };
}
