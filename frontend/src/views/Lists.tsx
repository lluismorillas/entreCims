import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { Map } from "maplibre-gl";
import ConfirmButton from "../components/ConfirmButton";
import Icon from "../components/Icon";
import MapView from "../components/MapView";
import { useRouteMarkers } from "../components/useRouteMarkers";
import { newId, useLists, useRoutes } from "../data";

export default function Lists() {
  const [map, setMap] = useState<Map | null>(null);
  const routes = useRoutes();
  const [lists, setLists] = useLists();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState(false);

  const selected = lists.find((l) => l.id === selectedId);
  // No list selected: no markers, and the camera stays on (or returns to) the world.
  const inList = useMemo(
    () => (routes ?? []).filter((r) => selected?.routeIds.includes(r.id)),
    [routes, selected],
  );
  useRouteMarkers(map, inList);

  return (
    <div className="flex h-full flex-col md:flex-row">
      <section aria-label="Lists" className="max-h-[45%] shrink-0 overflow-y-auto border-slate-800 bg-slate-900 p-3 text-sm md:max-h-none md:w-80 md:border-r">
        {/* noValidate: our own message under the field instead of the browser's bubble, in the app's language. */}
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) {
              setNameError(true);
              e.currentTarget.querySelector("input")?.focus();
              return;
            }
            const list = { id: newId(), name: name.trim(), routeIds: [] };
            setLists([...lists, list]);
            setSelectedId(list.id);
            setName("");
          }}
        >
          <div className="flex gap-2">
            <input
              aria-label="New list"
              placeholder="New list"
              required
              aria-invalid={nameError}
              aria-describedby={nameError ? "list-name-error" : undefined}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameError(false);
              }}
              className={`min-w-0 flex-1 ${nameError ? "border-red-400" : ""}`}
            />
            <button className="btn btn-primary">Create</button>
          </div>
          {nameError && (
            <p id="list-name-error" role="alert" className="mt-1.5 flex items-center gap-1.5 text-xs text-red-300">
              <Icon name="warning" className="size-3.5" />
              Give the list a name.
            </p>
          )}
        </form>

        {lists.length === 0 && <p className="mt-3 text-slate-400">No lists yet.</p>}
        <ul className="mt-3 space-y-2">
          {lists.map((l) => (
            <li
              key={l.id}
              className={`rounded-xl border bg-slate-950 ${l === selected ? "border-sky-400/50" : "border-slate-800 hover:border-slate-700"}`}
            >
              <button
                aria-expanded={l === selected}
                aria-controls={`list-${l.id}`}
                onClick={() => setSelectedId(l === selected ? null : l.id)}
                className={`flex w-full items-center gap-2 px-3 py-2.5 text-left font-medium ${l === selected ? "text-sky-300" : ""}`}
              >
                <Icon name="chevron" className={`size-4 transition-transform ${l === selected ? "rotate-90" : ""}`} />
                <span className="flex-1">{l.name}</span>
                <span className="font-normal text-slate-400">{l.routeIds.length}</span>
              </button>
              {l === selected && (
              <div id={`list-${l.id}`} className="border-t border-slate-800 px-3 pt-2 pb-3">
                {inList.length === 0 && (
                  <p className="mt-1 text-slate-400">Empty. Add routes from the Routes page.</p>
                )}
                <ul className="mt-1">
                  {inList.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 py-1">
                      <Link to={`/routes/${encodeURIComponent(r.id)}`} className="min-w-0 truncate hover:text-sky-300 hover:underline">
                        {r.name}
                      </Link>
                      <button
                        aria-label={`Remove ${r.name} from ${selected.name}`}
                        onClick={() =>
                          setLists(
                            lists.map((l) =>
                              l === selected ? { ...l, routeIds: l.routeIds.filter((id) => id !== r.id) } : l,
                            ),
                          )
                        }
                        title="Remove from the list"
                        className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-red-400"
                      >
                        <Icon name="trash" />
                      </button>
                    </li>
                  ))}
                </ul>
                <ConfirmButton
                  key={selected.id}
                  label="Delete list"
                  question={`Delete the list "${selected.name}"? Its routes are kept.`}
                  className="mt-3"
                  onConfirm={() => {
                    setLists(lists.filter((l) => l !== selected));
                    setSelectedId(null);
                  }}
                />
              </div>
              )}
            </li>
          ))}
        </ul>
      </section>
      <div className="min-h-0 flex-1">
        <MapView onMap={setMap} />
      </div>
    </div>
  );
}
