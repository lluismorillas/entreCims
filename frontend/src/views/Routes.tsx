import { useState } from "react";
import RouteCard from "../components/RouteCard";
import { type RouteInfo, TYPE_LABEL, useLists, useRoutes } from "../data";

const EMPTY = {
  place: "",
  kind: "",
  difficulty: "",
  author: "",
  type: "",
  minKm: "",
  maxKm: "",
  minAscent: "",
  maxAscent: "",
  from: "",
  to: "",
};

function matches(r: RouteInfo, f: typeof EMPTY) {
  return (
    // shortcut: "place" searches the name and the typed location, there is no offline geocoder yet.
    `${r.name} ${r.location ?? ""}`.toLowerCase().includes(f.place.trim().toLowerCase()) &&
    (!f.kind || r.kind === f.kind) &&
    (!f.difficulty || r.difficulty === f.difficulty) &&
    (!f.author || r.author === f.author) &&
    (!f.type || r.type === f.type) &&
    (!f.minKm || r.distanceM >= +f.minKm * 1000) &&
    (!f.maxKm || r.distanceM <= +f.maxKm * 1000) &&
    (!f.minAscent || (r.ascentM ?? -1) >= +f.minAscent) &&
    (!f.maxAscent || (r.ascentM ?? Infinity) <= +f.maxAscent) &&
    // Planned routes have no date, so a date filter leaves them out.
    (!f.from || (r.date ?? "") >= f.from) &&
    (!f.to || (r.date ?? "9999") <= f.to)
  );
}

export default function RoutesView() {
  const routes = useRoutes();
  const [lists, setLists] = useLists();
  const [f, setF] = useState(EMPTY);
  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) =>
    setF({ ...f, [key]: e.target.value });

  if (!routes) return null;
  const authors = [...new Set(routes.flatMap((r) => r.author ?? []))].sort();
  const shown = routes.filter((r) => matches(r, f));
  const number = (key: keyof typeof EMPTY, label: string) => (
    <input type="number" min="0" aria-label={label} placeholder={label} value={f[key]} onChange={set(key)} className="w-36" />
  );

  return (
    <div className="flex h-full flex-col">
      <form
        aria-label="Route filters"
        onSubmit={(e) => e.preventDefault()}
        className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900 p-3 text-sm"
      >
        <input type="search" aria-label="Place or name" placeholder="Place or name" value={f.place} onChange={set("place")} />
        <select aria-label="Kind" value={f.kind} onChange={set("kind")}>
          <option value="">Planned and completed</option>
          <option value="planned">Planned</option>
          <option value="recorded">Completed</option>
        </select>
        <select aria-label="Difficulty" value={f.difficulty} onChange={set("difficulty")}>
          <option value="">Any difficulty</option>
          <option value="easy">Easy</option>
          <option value="moderate">Moderate</option>
          <option value="hard">Hard</option>
        </select>
        <select aria-label="Author" value={f.author} onChange={set("author")}>
          <option value="">Any author</option>
          {authors.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <select aria-label="Route type" value={f.type} onChange={set("type")}>
          <option value="">Any type</option>
          {Object.entries(TYPE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {number("minKm", "Min km")}
        {number("maxKm", "Max km")}
        {number("minAscent", "Min ascent m")}
        {number("maxAscent", "Max ascent m")}
        <label className="flex items-center gap-1.5 text-slate-400">
          From <input type="date" value={f.from} onChange={set("from")} />
        </label>
        <label className="flex items-center gap-1.5 text-slate-400">
          To <input type="date" value={f.to} onChange={set("to")} />
        </label>
        <button type="button" onClick={() => setF(EMPTY)} className="btn">
          Clear
        </button>
      </form>

      <p role="status" className="px-4 pt-3 text-sm text-slate-400">
        {shown.length} of {routes.length} routes
      </p>
      <ul className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] content-start gap-4 overflow-y-auto p-4">
        {shown.map((r) => (
          <li key={r.id}>
            <RouteCard route={r} to={`/routes/${encodeURIComponent(r.id)}`}>
              <select
                aria-label={`Add ${r.name} to a list`}
                value=""
                disabled={lists.length === 0}
                onChange={(e) =>
                  setLists(
                    lists.map((l) =>
                      l.id === e.target.value && !l.routeIds.includes(r.id)
                        ? { ...l, routeIds: [...l.routeIds, r.id] }
                        : l,
                    ),
                  )
                }
                className="relative mt-3 w-full text-xs"
              >
                <option value="">{lists.length ? "Add to list…" : "No lists yet"}</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.routeIds.includes(r.id) ? "✓ " : ""}
                    {l.name}
                  </option>
                ))}
              </select>
            </RouteCard>
          </li>
        ))}
      </ul>
    </div>
  );
}
