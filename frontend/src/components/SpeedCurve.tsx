import { useState } from "react";
import AxisTitles from "./AxisTitles";
import Icon from "./Icon";

const W = 800;
const H = 236;
// Room on the left and below for the axis titles.
const PAD = { left: 74, right: 70, top: 14, bottom: 44 };

/**
 * Walking speed against slope: the user's model and Tobler as a dashed reference.
 * `curve` rows are [slope %, model km/h, Tobler km/h].
 */
export default function SpeedCurve({ curve }: { curve: [number, number, number][] }) {
  const [active, setActive] = useState<number | null>(null);
  const slopes = curve.map((r) => r[0]);
  const [lo, hi] = [slopes[0], slopes.at(-1)!];
  const top = Math.ceil(Math.max(...curve.flatMap((r) => [r[1], r[2]]))) + 1;
  const x = (s: number) => PAD.left + ((s - lo) / (hi - lo)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - v / top) * (H - PAD.top - PAD.bottom);
  const path = (i: 1 | 2) => curve.map((r, k) => `${k ? "L" : "M"}${x(r[0]).toFixed(1)},${y(r[i]).toFixed(1)}`).join("");
  const last = curve.at(-1)!;
  const row = active == null ? null : curve[active];

  return (
    <figure>
      <div className="mb-2 flex gap-4 text-xs text-slate-300" aria-hidden="true">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-sky-400" /> Your pace
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 border-t-2 border-dashed border-slate-400" /> Tobler
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Walking speed by slope. On flat ground: ${curve.find((r) => r[0] === 0)?.[1]} km/h for you, ${curve.find((r) => r[0] === 0)?.[2]} km/h for Tobler.`}
        className="w-full touch-none text-[11px]"
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const s = lo + ((((e.clientX - box.left) / box.width) * W - PAD.left) / (W - PAD.left - PAD.right)) * (hi - lo);
          setActive(Math.max(0, Math.min(curve.length - 1, Math.round((s - lo) / (slopes[1] - lo)))));
        }}
        onPointerLeave={() => setActive(null)}
      >
        {Array.from({ length: Math.floor(top / 2) + 1 }, (_, i) => i * 2).map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="stroke-slate-800" />
            <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" className="fill-slate-400">
              {v} km/h
            </text>
          </g>
        ))}
        {slopes.filter((s) => s % 10 === 0).map((s) => (
          <text key={s} x={x(s)} y={H - 24} textAnchor="middle" className="fill-slate-400">
            {s > 0 ? `+${s}` : s} %
          </text>
        ))}
        <path d={path(2)} className="fill-none stroke-slate-400 stroke-2 [stroke-dasharray:6_4]" />
        <path d={path(1)} className="fill-none stroke-sky-400 stroke-2 [stroke-linejoin:round]" />
        {/* Direct labels at the right end: identity never relies on colour alone. */}
        <text x={W - PAD.right + 6} y={y(last[1]) + 4} className="fill-slate-300">
          You
        </text>
        <text x={W - PAD.right + 6} y={y(last[2]) + 4} className="fill-slate-400">
          Tobler
        </text>
        {row && (
          <g>
            <line x1={x(row[0])} x2={x(row[0])} y1={PAD.top} y2={y(0)} className="stroke-slate-500" />
            <circle cx={x(row[0])} cy={y(row[2])} r="4" className="fill-slate-400 stroke-slate-950 stroke-2" />
            <circle cx={x(row[0])} cy={y(row[1])} r="4" className="fill-sky-400 stroke-slate-950 stroke-2" />
            <text
              x={x(row[0]) + (x(row[0]) > W - 220 ? -8 : 8)}
              y={PAD.top + 10}
              textAnchor={x(row[0]) > W - 220 ? "end" : "start"}
              className="fill-slate-100 font-medium"
            >
              {row[0] > 0 ? "+" : ""}
              {row[0]} % · you {row[1]} km/h · Tobler {row[2]} km/h
            </text>
          </g>
        )}
        <AxisTitles x="Slope (+ uphill, − downhill)" y="Speed" width={W} height={H} pad={PAD} />
      </svg>
      <details className="group mt-3">
        <summary className="btn inline-flex cursor-pointer list-none items-center gap-2 text-sm [&::-webkit-details-marker]:hidden">
          <Icon name="chevron" className="size-4 transition-transform group-open:rotate-90" />
          <span className="group-open:hidden">Show as a table</span>
          <span className="hidden group-open:inline">Hide the table</span>
        </summary>
        <div className="mt-2 max-w-sm overflow-x-auto rounded-xl border border-slate-800">
          <table className="data-table">
            <thead>
              <tr>
                <th>Slope</th>
                <th className="text-right">You</th>
                <th className="text-right">Tobler</th>
              </tr>
            </thead>
            <tbody>
              {curve
                .filter((r) => r[0] % 10 === 0)
                .map(([s, own, tobler]) => (
                  <tr key={s} className={s === 0 ? "font-semibold" : ""}>
                    <td>{s > 0 ? `+${s}` : s} %</td>
                    <td className="text-right text-sky-300">{own} km/h</td>
                    <td className="text-right text-slate-400">{tobler} km/h</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
