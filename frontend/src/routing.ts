// Path finding for the route planner, the way Wanderer does it: Valhalla's /route gives
// the path over OpenStreetMap ways and /height the elevation of each of its points.
// shortcut: the browser calls Valhalla directly, so the clicked coordinates go to this
// server. Move both calls behind a backend proxy (/api/valhalla/*) once the API exists.
const VALHALLA_URL: string = import.meta.env?.VITE_VALHALLA_URL ?? "https://valhalla1.openstreetmap.de";

/** Decodes Valhalla's encoded polyline (6 decimals) into [lon, lat] positions. */
export function decodePolyline(encoded: string, factor = 1e6) {
  const coords: number[][] = [];
  let i = 0;
  let lat = 0;
  let lon = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = encoded.charCodeAt(i++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && i < encoded.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < encoded.length) {
    lat += next();
    lon += next();
    coords.push([lon / factor, lat / factor]);
  }
  return coords;
}

/** Straight line from a to b with a point about every 30 m, so it can get a profile too. */
export function straightLine(a: number[], b: number[], metres: number) {
  const steps = Math.max(1, Math.ceil(metres / 30));
  return Array.from({ length: steps + 1 }, (_, i) => [
    a[0] + ((b[0] - a[0]) * i) / steps,
    a[1] + ((b[1] - a[1]) * i) / steps,
  ]);
}

/** Whether a path starts and ends within 50 m of the clicked points, instead of stopping short. */
export function reaches(line: number[][], from: number[], to: number[]) {
  const metres = ([lon1, lat1]: number[], [lon2, lat2]: number[]) =>
    6371000 * Math.hypot(((lon2 - lon1) * Math.PI * Math.cos((lat1 * Math.PI) / 180)) / 180, ((lat2 - lat1) * Math.PI) / 180);
  return metres(line[0], from) <= 50 && metres(line.at(-1)!, to) <= 50;
}

async function valhalla(path: string, body: unknown) {
  // No Content-Type header: a plain-text POST needs no CORS preflight.
  const res = await fetch(VALHALLA_URL + path, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Valhalla ${path}: ${res.status}`);
  return res.json();
}

/**
 * One leg of a planned route as [lon, lat, ele?] positions.
 * `failed` means a path was wanted but could not be found, so the leg is a straight line.
 */
export async function routeLeg(
  from: number[],
  to: number[],
  metres: number,
  costing: "pedestrian" | "bicycle",
  followPaths: boolean,
) {
  let line: number[][] | null = null;
  let shape: object = {};
  // Valhalla's default (1) refuses anything harder than a marked hiking path. T4 (alpine hiking)
  // comes first so an easy path wins; if it cannot reach the clicked points, as on Pica d'Estats,
  // whose last stretch is T5, T6 is tried.
  for (const difficulty of followPaths && VALHALLA_URL ? [4, 6] : []) {
    try {
      const data = await valhalla("/route", {
        directions_type: "none",
        locations: [from, to].map(([lon, lat]) => ({ lon, lat })),
        costing,
        costing_options: { pedestrian: { max_hiking_difficulty: difficulty } },
      });
      const encoded = data?.trip?.legs?.[0]?.shape;
      const decoded = typeof encoded === "string" ? decodePolyline(encoded) : [];
      if (decoded.length > 1) {
        line = decoded;
        shape = { encoded_polyline: encoded, shape_format: "polyline6" };
        if (reaches(decoded, from, to)) break;
      }
    } catch {
      // Tries the next difficulty, then falls back to the straight line below.
    }
  }
  const failed = followPaths && !line;
  if (!line) {
    line = straightLine(from, to, metres);
    shape = { shape: line.map(([lon, lat]) => ({ lon, lat })) };
  }
  if (VALHALLA_URL) {
    try {
      const heights = (await valhalla("/height", { ...shape, range: false }))?.height;
      if (Array.isArray(heights) && heights.length === line.length && heights.every(Number.isFinite))
        line = line.map((p, i) => [...p, heights[i]]);
    } catch {
      // No elevation: the route keeps its distance but loses climb and time.
    }
  }
  return { coords: line, failed };
}
