// Stand-in for the backend importer: summarises sample-data/*.{gpx,tcx} into
// public/routes.json (git-ignored: it contains real start coordinates).
// shortcut: regex XML parsing and no FIT support, delete this script once
// GET /api/activities exists (tasks T021-T025).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const dir = new URL("../../sample-data/", import.meta.url);
const out = new URL("../public/routes.json", import.meta.url);

const rad = (d) => (d * Math.PI) / 180;
function haversine([lon1, lat1], [lon2, lat2]) {
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}
// Tobler's hiking function, m/s. Same baseline as plan.md §7.
const tobler = (slope) => (6 * Math.exp(-3.5 * Math.abs(slope + 0.05))) / 3.6;

assert.ok(Math.abs(haversine([0, 0], [0, 1]) - 111195) < 10);
assert.ok(Math.abs(tobler(-0.05) * 3.6 - 6) < 1e-9);

const tag = (xml, name) => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1];
const text = (s) =>
  s
    ?.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[e])
    .trim();

function parsePoints(xml, isTcx) {
  const re = isTcx
    ? /<Trackpoint>([\s\S]*?)<\/Trackpoint>/g
    : /<trkpt\s([^>]*)>([\s\S]*?)<\/trkpt>/g;
  const points = [];
  for (const m of xml.matchAll(re)) {
    const lat = isTcx ? tag(m[1], "LatitudeDegrees") : m[1].match(/lat="([^"]+)"/)?.[1];
    const lon = isTcx ? tag(m[1], "LongitudeDegrees") : m[1].match(/lon="([^"]+)"/)?.[1];
    if (lat == null || lon == null) continue;
    const ele = tag(isTcx ? m[1] : m[2], isTcx ? "AltitudeMeters" : "ele");
    const time = tag(isTcx ? m[1] : m[2], isTcx ? "Time" : "time");
    points.push({ pos: [+lon, +lat], ele: ele == null ? null : +ele, time });
  }
  return points;
}

function summarise(file) {
  const xml = readFileSync(new URL(file, dir), "utf8");
  const isTcx = file.endsWith(".tcx");
  const points = parsePoints(xml, isTcx);
  if (points.length < 2) return null;

  let distanceM = 0;
  let ascentM = 0;
  let descentM = 0;
  let toblerS = 0;
  // 100 m segments (spec F3) so GPS noise does not turn into absurd slopes.
  let segStart = points[0];
  let segDist = 0;
  // 5 m hysteresis: smaller climbs are mostly altitude noise.
  let lastEle = points[0].ele;
  const hasEle = points.every((p) => p.ele != null);
  for (let i = 1; i < points.length; i++) {
    const d = haversine(points[i - 1].pos, points[i].pos);
    distanceM += d;
    if (!hasEle) continue;
    segDist += d;
    if (segDist >= 100 || i === points.length - 1) {
      if (segDist > 0) toblerS += segDist / tobler((points[i].ele - segStart.ele) / segDist);
      segStart = points[i];
      segDist = 0;
    }
    const gain = points[i].ele - lastEle;
    if (gain >= 5) ascentM += gain;
    if (gain <= -5) descentM -= gain;
    if (Math.abs(gain) >= 5) lastEle = points[i].ele;
  }

  // A TCX <Course> is a route to follow; a track with times is something done (FR-102).
  const recorded = !isTcx && points.every((p) => p.time);
  const t0 = Date.parse(points[0].time);
  const t1 = Date.parse(points.at(-1).time);
  const name = (text(isTcx ? tag(xml, "Name") : tag(xml.slice(xml.indexOf("<trk>")), "name")) || file)
    .replace(/ - Wikiloc$/, "");
  const hint = `${tag(xml, "type") ?? ""} ${name}`.toLowerCase();
  // Same rule as trackStats() in src/data.ts.
  // Effort-km (distance + 1 km per 100 m climbed), a common hiking rule of thumb.
  // The thresholds are arbitrary: replace with a user-set field when the backend exists.
  const effort = distanceM / 1000 + ascentM / 100;

  return {
    id: file,
    name,
    author: text(xml.match(/<author>\s*<name>([^<]*)<\/name>/)?.[1]) || null,
    type: /trail/.test(hint) ? "trail" : /run/.test(hint) ? "run" : /rid|bik|cycl/.test(hint) ? "bike" : "hike",
    kind: recorded ? "recorded" : "planned",
    source: "uploaded",
    difficulty: !hasEle ? null : effort < 12 ? "easy" : effort < 25 ? "moderate" : "hard",
    start: points[0].pos,
    date: recorded ? points[0].time.slice(0, 10) : null,
    distanceM: Math.round(distanceM),
    ascentM: hasEle ? Math.round(ascentM) : null,
    descentM: hasEle ? Math.round(descentM) : null,
    // Recorded: elapsed time. Planned: Tobler estimate (see estimateSeconds in data.ts).
    // shortcut: about 400 [lon, lat, ele] points serve the thumbnail, the route map and the
    // profile; the real detail endpoint (GET /api/activities/{id}) should return every point.
    line: points
      .filter((_, i) => i % Math.ceil(points.length / 400) === 0 || i === points.length - 1)
      .map((p) => [+p.pos[0].toFixed(5), +p.pos[1].toFixed(5), ...(hasEle ? [Math.round(p.ele)] : [])]),
    totalS: recorded ? Math.round((t1 - t0) / 1000) : hasEle ? Math.round(toblerS) : null,
  };
}

const routes = readdirSync(dir)
  .filter((f) => /\.(gpx|tcx)$/i.test(f))
  .map(summarise)
  .filter(Boolean);
writeFileSync(out, JSON.stringify(routes));
console.log(`${routes.length} routes -> ${out.pathname}`);
