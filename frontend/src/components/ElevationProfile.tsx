import { useMemo, useState } from "react";
import { distance } from "../data";

const W = 800;
const H = 200;
const PAD = { left: 48, right: 10, top: 14, bottom: 24 };

/** Elevation against distance. Hovering reports the track position so the map can mark it (FR-109). */
type Props = {
  line: number[][];
  /** Real length of the route: a simplified line cuts corners and measures shorter. */
  totalM: number;
  onHover: (position: number[] | null) => void;
  /** Points to label on the profile, such as the reached peaks. */
  marks?: { distM: number; label: string }[];
};

export default function ElevationProfile({ line, totalM, onHover, marks = [] }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const dist = useMemo(() => {
    const cumulative = [0];
    for (let i = 1; i < line.length; i++) cumulative.push(cumulative[i - 1] + distance(line[i - 1], line[i]));
    const scale = totalM / (cumulative.at(-1) || 1);
    return cumulative.map((d) => d * scale);
  }, [line, totalM]);

  if (line.length < 2 || line.some((p) => typeof p[2] !== "number"))
    return <p className="text-sm text-slate-400">This route has no elevation data.</p>;

  const total = dist.at(-1)!;
  const eles = line.map((p) => p[2]);
  const [min, max] = [Math.min(...eles), Math.max(...eles)];
  // Axis limits on round hundreds, so a flat route is not drawn as a mountain.
  const lo = Math.floor(min / 100) * 100;
  const hi = Math.max(Math.ceil(max / 100) * 100, lo + 100);
  const x = (d: number) => PAD.left + (d / total) * (W - PAD.left - PAD.right);
  const y = (e: number) => PAD.top + ((hi - e) / (hi - lo)) * (H - PAD.top - PAD.bottom);

  const eleStep = hi - lo <= 400 ? 100 : hi - lo <= 1000 ? 200 : 500;
  const kmStep = [0.5, 1, 2, 5, 10, 20, 50].find((s) => total / 1000 / s <= 10) ?? 100;
  const path = line.map((p, i) => `${i ? "L" : "M"}${x(dist[i]).toFixed(1)},${y(p[2]).toFixed(1)}`).join("");

  const hover = (clientX: number, svg: SVGSVGElement) => {
    const box = svg.getBoundingClientRect();
    const d = ((((clientX - box.left) / box.width) * W - PAD.left) / (W - PAD.left - PAD.right)) * total;
    const i = dist.findIndex((v) => v >= d);
    const index = i < 0 ? line.length - 1 : i;
    setActive(index);
    onHover(line[index]);
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Elevation profile over ${(total / 1000).toFixed(1)} km: starts at ${Math.round(eles[0])} m, lowest ${Math.round(min)} m, highest ${Math.round(max)} m.`}
      className="w-full touch-none text-[11px]"
      onPointerMove={(e) => hover(e.clientX, e.currentTarget)}
      onPointerLeave={() => {
        setActive(null);
        onHover(null);
      }}
    >
      {Array.from({ length: Math.floor((hi - lo) / eleStep) + 1 }, (_, i) => lo + i * eleStep).map((e) => (
        <g key={e}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(e)} y2={y(e)} className="stroke-slate-800" />
          <text x={PAD.left - 6} y={y(e) + 4} textAnchor="end" className="fill-slate-400">
            {e} m
          </text>
        </g>
      ))}
      {Array.from({ length: Math.floor(total / 1000 / kmStep) + 1 }, (_, i) => i * kmStep).map((k) => (
        <text key={k} x={x(k * 1000)} y={H - 6} textAnchor="middle" className="fill-slate-400">
          {k} km
        </text>
      ))}
      <path d={`${path}L${x(total)},${y(lo)}L${x(0)},${y(lo)}Z`} className="fill-sky-400/15" />
      <path d={path} className="fill-none stroke-sky-400 stroke-2 [stroke-linejoin:round]" />
      {marks.map((m) => {
        const i = Math.max(0, dist.findIndex((v) => v >= m.distM));
        const [mx, my] = [x(dist[i]), y(eles[i])];
        return (
          <g key={`${m.label}${m.distM}`}>
            <path d={`M${mx},${my - 4}l-5,-9h10z`} className="fill-rose-500 stroke-slate-950" />
            <text x={mx} y={Math.max(my - 16, 10)} textAnchor="middle" className="fill-slate-100">
              {m.label}
            </text>
          </g>
        );
      })}
      {active != null && (
        <g>
          <line x1={x(dist[active])} x2={x(dist[active])} y1={PAD.top} y2={y(lo)} className="stroke-slate-400" />
          <circle cx={x(dist[active])} cy={y(eles[active])} r="4" className="fill-amber-400 stroke-slate-950 stroke-2" />
          <text
            x={x(dist[active]) + (x(dist[active]) > W - 130 ? -8 : 8)}
            y={PAD.top + 10}
            textAnchor={x(dist[active]) > W - 130 ? "end" : "start"}
            className="fill-slate-100 font-medium"
          >
            {(dist[active] / 1000).toFixed(1)} km · {Math.round(eles[active])} m
          </text>
        </g>
      )}
    </svg>
  );
}
