import { useState } from "react";
import { Link } from "react-router";
import SpeedCurve from "../components/SpeedCurve";
import TimeSeriesChart from "../components/TimeSeriesChart";
import { type RouteInfo, TYPE_LABEL, duration, useModelHistory, useTimeModel } from "../data";

const TYPES = ["hike", "trail", "run"] as const;
const OUTINGS = { hike: "hikes", trail: "trail runs", run: "runs" };
// Validated for the dark chart surface (dataviz validator): flat, uphill, downhill.
const COLORS = { flat: "#0284c7", up: "#d97706", down: "#db2777" };

const minutes = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** How the time model sees the user, per activity type, and how that changed outing by outing. */
export default function TimeModel() {
  const [type, setType] = useState<(typeof TYPES)[number]>("hike");
  const model = useTimeModel(type);
  const history = useModelHistory(type);
  const outings = history?.outings ?? [];
  const label = OUTINGS[type];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
        <header>
          <h1 className="text-3xl font-bold tracking-tight">Time model</h1>
          <p className="mt-2 text-slate-400">
            What the app has learnt about your pace, and how it changed with each outing. Each type of activity has a model of its own.
          </p>
          <div role="group" aria-label="Activity type" className="mt-4 inline-flex overflow-hidden rounded-lg border border-slate-700 text-sm">
            {TYPES.map((t) => (
              <button
                key={t}
                aria-pressed={type === t}
                onClick={() => setType(t)}
                className={`px-3 py-1.5 ${type === t ? "bg-sky-400 font-semibold text-slate-950" : "hover:bg-slate-800"}`}
              >
                {TYPE_LABEL[t as RouteInfo["type"]]}
              </button>
            ))}
          </div>
        </header>

        {model && (
          <section aria-labelledby="method-title" className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-sm">
            <h2 id="method-title" className="font-semibold">
              How times are predicted
            </h2>
            <p className="mt-1 text-slate-300">
              {model.method === "model"
                ? `With your own pace model: a speed-by-slope curve fitted to your ${label}, with recent ones weighing more.`
                : `With Naismith's rule calibrated on your ${label}: ${minutes(model.a * 1000)} min per km plus ${minutes(model.b * 100)} min per 100 m of climb. For runs it predicted better than the slope curve in the evaluation, which is still shown below for reference.`}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {model.n_activities
                ? `Model version ${model.version}, learnt from ${model.n_activities} ${label}.`
                : `No ${label} recorded yet: predictions use the generic formulas.`}
              {model.stop_rate != null && ` You usually stop ${Math.round(model.stop_rate * 100)} % as long as you move.`}
            </p>
          </section>
        )}

        {model && (
          <section aria-labelledby="curve-title">
            <h2 id="curve-title" className="mb-3 text-lg font-bold">
              Your speed by slope, today
            </h2>
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <SpeedCurve curve={model.curve} />
            </div>
          </section>
        )}

        {history && outings.length > 1 && (
          <>
            <section aria-labelledby="trend-title">
              <h2 id="trend-title" className="text-lg font-bold">
                Your pace evolution
              </h2>
              <p className="mb-3 text-sm text-slate-400">The model rebuilt after each outing, with only that outing and the earlier ones.</p>
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <TimeSeriesChart
                  dates={outings.map((o) => o.date)}
                  names={outings.map((o) => o.name)}
                  series={[
                    { label: "Flat", color: COLORS.flat, values: outings.map((o) => o.flat_kmh) },
                    { label: "Uphill 20 %", color: COLORS.up, values: outings.map((o) => o.up_kmh) },
                    { label: "Downhill 20 %", color: COLORS.down, values: outings.map((o) => o.down_kmh) },
                  ]}
                  format={(v) => `${v.toFixed(1)} km/h`}
                  yTitle="Speed"
                  description={`Speed on the flat went from ${outings[0].flat_kmh} to ${outings.at(-1)!.flat_kmh} km/h, and uphill at 20 % from ${outings[0].up_kmh} to ${outings.at(-1)!.up_kmh} km/h.`}
                />
              </div>
            </section>

            <section aria-labelledby="error-title">
              <h2 id="error-title" className="text-lg font-bold">
                Each outing against its prediction
              </h2>
              <p className="mb-3 text-sm text-slate-400">
                What the model, trained only on earlier {label}, predicted for each one. Above zero you were faster than predicted.
              </p>
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <TimeSeriesChart
                  dots
                  dates={outings.map((o) => o.date)}
                  names={outings.map((o) => o.name)}
                  series={[
                    {
                      label: "Faster than predicted",
                      color: COLORS.flat,
                      values: outings.map((o) => (o.predicted_s ? Math.round((1 - o.moving_s / o.predicted_s) * 100) : null)),
                    },
                  ]}
                  format={(v) => `${v > 0 ? "+" : ""}${Math.round(v)} %`}
                  yTitle="Faster than predicted"
                  description={`Moving time of each of your ${label} against the time predicted from the earlier ones.`}
                />
              </div>
              <details className="mt-2 text-sm text-slate-400">
                <summary className="cursor-pointer hover:text-slate-100">Show the outings as a table</summary>
                <div className="mt-2 overflow-x-auto rounded-xl border border-slate-800">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="font-semibold">Date</th>
                      <th className="font-semibold">Outing</th>
                      <th className="text-right font-semibold">Moving time</th>
                      <th className="text-right font-semibold">Predicted before</th>
                      <th className="text-right font-semibold">Flat speed after</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outings.map((o) => (
                      <tr key={o.activity_id}>
                        <td>{date(o.date)}</td>
                        <td>
                          <Link to={`/routes/${encodeURIComponent(o.activity_id)}`} className="underline hover:text-slate-100">
                            {o.name}
                          </Link>
                        </td>
                        <td className="text-right">{duration(o.moving_s)}</td>
                        <td className="text-right">{o.predicted_s ? duration(o.predicted_s) : "–"}</td>
                        <td className="text-right">{o.flat_kmh} km/h</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </details>
            </section>
          </>
        )}
        {history && outings.length < 2 && (
          <p className="text-sm text-slate-400">Record at least two {label} to see how your pace changes.</p>
        )}

        {history && history.versions.length > 0 && (
          <details className="text-sm text-slate-400">
            <summary className="cursor-pointer hover:text-slate-100">Saved versions of the model ({history.versions.length})</summary>
            <div className="mt-2 max-w-lg overflow-x-auto rounded-xl border border-slate-800">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="font-semibold">Version</th>
                  <th className="font-semibold">Saved</th>
                  <th className="text-right font-semibold">Outings</th>
                  <th className="text-right font-semibold">Flat speed</th>
                </tr>
              </thead>
              <tbody>
                {history.versions.map((v) => (
                  <tr key={v.version}>
                    <td>{v.version}</td>
                    <td>{date(`${v.created_at.replace(" ", "T")}Z`)}</td>
                    <td className="text-right">{v.n_activities}</td>
                    <td className="text-right">{v.flat_kmh} km/h</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
