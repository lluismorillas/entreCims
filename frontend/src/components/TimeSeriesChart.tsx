import { useState } from "react";
import AxisTitles from "./AxisTitles";

const W = 800;
const H = 236;
// Room on the left and below for the axis titles.
const PAD = { left: 84, right: 80, top: 24, bottom: 44 };

type Series = { label: string; color: string; values: (number | null)[] };

/**
 * Values per outing over time. Lines for a trend, or dots (with a zero line) for errors.
 * Hovering shows every series at the nearest outing, named by `names`.
 */
export default function TimeSeriesChart({
  dates,
  names,
  series,
  format,
  dots = false,
  description,
  yTitle,
}: {
  dates: string[];
  names: string[];
  series: Series[];
  format: (v: number) => string;
  dots?: boolean;
  description: string;
  /** What the vertical axis measures. */
  yTitle: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const times = dates.map((d) => new Date(d).getTime());
  const values = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  if (times.length < 2 || !values.length) return <p className="text-sm text-slate-400">Not enough outings yet.</p>;

  const [t0, t1] = [times[0], times.at(-1)!];
  // Dots are errors around zero: the axis keeps zero in view and symmetric.
  const span = Math.max(...values.map(Math.abs));
  const [lo, hi] = dots ? [-span, span] : [Math.floor(Math.min(...values)), Math.ceil(Math.max(...values))];
  const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0 || 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + ((hi - v) / (hi - lo || 1)) * (H - PAD.top - PAD.bottom);
  const ticks = [lo, (lo + hi) / 2, hi];
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
  const step = Math.ceil(months.length / 6);

  return (
    <figure>
      {series.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-4 text-xs text-slate-300" aria-hidden="true">
          {series.map((s) => (
            <span key={s.label} className="flex items-center gap-1.5">
              <span className="h-0.5 w-4" style={{ background: s.color }} /> {s.label}
            </span>
          ))}
        </div>
      )}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={description}
        className="w-full touch-none text-[11px]"
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const t = t0 + ((((e.clientX - box.left) / box.width) * W - PAD.left) / (W - PAD.left - PAD.right)) * (t1 - t0);
          setActive(times.reduce((best, ti, i) => (Math.abs(ti - t) < Math.abs(times[best] - t) ? i : best), 0));
        }}
        onPointerLeave={() => setActive(null)}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className={dots && v === 0 ? "stroke-slate-500" : "stroke-slate-800"} />
            <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" className="fill-slate-400">
              {format(v)}
            </text>
          </g>
        ))}
        {months
          .filter((_, i) => i % step === 0)
          .map((m) => (
            <text key={m} x={x(new Date(`${m}-01`).getTime())} y={H - 24} textAnchor="middle" className="fill-slate-400">
              {new Date(`${m}-01`).toLocaleDateString("en-GB", { month: "short", year: "2-digit" })}
            </text>
          ))}
        {series.map((s) => {
          const points = s.values.flatMap((v, i) => (v == null ? [] : [[x(times[i]), y(v)]]));
          const last = points.at(-1);
          return (
            <g key={s.label}>
              {dots ? (
                points.map(([px, py], i) => <circle key={i} cx={px} cy={py} r="4" fill={s.color} className="stroke-slate-900 stroke-2" />)
              ) : (
                <path d={points.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("")} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
              )}
              {/* Direct label at the end of each line: identity never relies on colour alone. */}
              {!dots && last && (
                <text x={last[0] + 6} y={last[1] + 4} className="fill-slate-300">
                  {s.label}
                </text>
              )}
            </g>
          );
        })}
        {active != null && (
          <g>
            <line x1={x(times[active])} x2={x(times[active])} y1={PAD.top} y2={H - PAD.bottom} className="stroke-slate-500" />
            <text
              x={x(times[active]) + (x(times[active]) > W / 2 ? -8 : 8)}
              y={12}
              textAnchor={x(times[active]) > W / 2 ? "end" : "start"}
              className="fill-slate-100 font-medium"
            >
              {new Date(dates[active]).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · {names[active]} ·{" "}
              {series
                .filter((s) => s.values[active] != null)
                .map((s) => `${series.length > 1 ? `${s.label} ` : ""}${format(s.values[active]!)}`)
                .join(" · ") || "no prediction"}
            </text>
          </g>
        )}
        <AxisTitles x="Date of track" y={yTitle} width={W} height={H} pad={PAD} />
      </svg>
    </figure>
  );
}
