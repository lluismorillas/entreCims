import type { ReactNode } from "react";
import { Link } from "react-router";
import Icon, { type IconName } from "./Icon";
import { type RouteInfo, TILES_ATTRIBUTION, TILES_URL, TYPE_LABEL, duration, estimateSeconds, km, pace } from "../data";

const W = 320;
const H = 140;
/** Web Mercator position at zoom 0, in 256 px tiles. */
function project([lon, lat]: number[]) {
  const sin = Math.sin((lat * Math.PI) / 180);
  return [((lon + 180) / 360) * 256, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * 256];
}

/** Static map of the track: plain tile images with the line drawn on top, so a list of cards needs no WebGL. */
function Thumbnail({ line }: { line: number[][] }) {
  const pts = line.map(project);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // Deepest zoom at which the whole track fits with a 16 px margin.
  const fit = Math.min((W - 32) / (maxX - minX), (H - 32) / (maxY - minY));
  const z = Math.max(0, Math.min(16, Math.floor(Math.log2(fit))));
  const scale = 2 ** z;
  const left = ((minX + maxX) / 2) * scale - W / 2;
  const top = ((minY + maxY) / 2) * scale - H / 2;

  const tiles = [];
  for (let x = Math.floor(left / 256); x * 256 < left + W; x++)
    for (let y = Math.floor(top / 256); y * 256 < top + H; y++)
      if (y >= 0 && y < scale)
        tiles.push(
          <img
            key={`${x}/${y}`}
            src={TILES_URL.replace("{z}", `${z}`).replace("{x}", `${((x % scale) + scale) % scale}`).replace("{y}", `${y}`)}
            alt=""
            loading="lazy"
            className="absolute max-w-none"
            style={{
              left: `${((x * 256 - left) / W) * 100}%`,
              top: `${((y * 256 - top) / H) * 100}%`,
              width: `${(256 / W) * 100}%`,
              height: `${(256 / H) * 100}%`,
            }}
          />,
        );

  return (
    <div className="relative overflow-hidden bg-slate-800" style={{ aspectRatio: `${W} / ${H}` }}>
      {tiles}
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true" className="absolute inset-0 size-full">
        <polyline
          points={pts.map(([x, y]) => `${(x * scale - left).toFixed(1)},${(y * scale - top).toFixed(1)}`).join(" ")}
          className="fill-none stroke-blue-700 stroke-[2.5] [stroke-linecap:round] [stroke-linejoin:round]"
        />
      </svg>
      {/* Build-time configuration, the same string MapLibre shows on the main map. */}
      <span
        className="absolute right-0 bottom-0 bg-white/70 px-1 text-[10px] text-slate-900 [&_a]:underline"
        dangerouslySetInnerHTML={{ __html: TILES_ATTRIBUTION }}
      />
    </div>
  );
}

function Stat({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon name={icon} />
      <dt className="sr-only">{label}</dt>
      <dd title={label}>{value}</dd>
    </div>
  );
}

type Props = {
  route: RouteInfo;
  /** Drops the thumbnail: on the map the track's surroundings are already visible. */
  compact?: boolean;
  /** Makes the whole card a link. Needs a router above it, which the map popup does not have. */
  to?: string;
  children?: ReactNode;
};

export default function RouteCard({ route, compact, to, children }: Props) {
  const planned = route.kind === "planned";
  const time = planned ? estimateSeconds(route) : { seconds: route.totalS, personalised: false };
  const metres = (v: number | null | undefined) => (v == null ? "–" : `${v} m`);
  return (
    <article
      className={`relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 text-sm text-slate-100 ${
        to ? "transition-colors hover:border-sky-400/60" : ""
      }`}
    >
      {!compact && route.line?.length > 0 && <Thumbnail line={route.line} />}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-base font-bold">
            {/* The stretched ::after makes the card clickable while controls inside stay usable. */}
            {to ? (
              <Link to={to} className="after:absolute after:inset-0">
                {route.name}
              </Link>
            ) : (
              route.name
            )}
          </h3>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
              planned ? "bg-sky-400/15 text-sky-300" : "bg-emerald-400/15 text-emerald-300"
            }`}
          >
            {planned ? "Planned" : "Completed"}
          </span>
        </div>
        {route.source && <p className="mt-0.5 text-xs text-slate-500">{route.source === "drawn" ? "Drawn in the planner" : "Uploaded file"}</p>}
        {route.date && (
          <p className="mt-0.5 text-xs text-slate-400">
            {new Date(route.date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
          </p>
        )}
        {route.author && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
            by
            <span aria-hidden="true" className="grid size-5 place-items-center rounded-full bg-indigo-600 text-[10px] font-semibold text-white">
              {route.author.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
            </span>
            {route.author}
          </p>
        )}

        <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          <Stat icon="type" label="Type" value={TYPE_LABEL[route.type]} />
          <Stat
            icon="difficulty"
            label="Difficulty"
            value={route.difficulty ? route.difficulty[0].toUpperCase() + route.difficulty.slice(1) : "Not rated"}
          />
        </dl>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-slate-400">
          <Stat icon="distance" label="Distance" value={km(route.distanceM)} />
          <Stat
            icon="time"
            label={planned ? "Estimated time" : "Total time"}
            value={time.seconds ? `${planned && !time.personalised ? "~" : ""}${duration(time.seconds)}` : "–"}
          />
          <Stat icon="ascent" label="Ascent" value={metres(route.ascentM)} />
          <Stat icon="descent" label="Descent" value={metres(route.descentM)} />
          <Stat icon="pace" label="Average pace" value={time.seconds ? pace(time.seconds, route.distanceM) : "–"} />
        </dl>
        {planned && !!time.seconds && !time.personalised && (
          <p className="mt-2 text-xs text-slate-500">~ Generic walking estimate (Tobler), not yet based on your pace.</p>
        )}
        {children}
      </div>
    </article>
  );
}
