import { useMemo, useState } from "react";
import type { Map } from "maplibre-gl";
import ConfirmButton from "../components/ConfirmButton";
import MapView from "../components/MapView";
import { useRouteMarkers } from "../components/useRouteMarkers";
import { newId, useLists, useRoutes } from "../data";

export default function Lists() {
  const [map, setMap] = useState<Map | null>(null);
  const routes = useRoutes();
  const [lists, setLists] = useLists();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");

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
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            const list = { id: newId(), name: name.trim(), routeIds: [] };
            setLists([...lists, list]);
            setSelectedId(list.id);
            setName("");
          }}
        >
          <input
            aria-label="New list name"
            placeholder="New list name"
            // An empty name gets the browser's own message instead of a click that does nothing.
            required
            pattern=".*\S.*"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-w-0 flex-1"
          />
          <button className="btn btn-primary">Create</button>
        </form>

        {lists.length === 0 && <p className="mt-3 text-slate-400">No lists yet.</p>}
        <ul className="mt-3 space-y-1">
          {lists.map((l) => (
            <li key={l.id}>
              <button
                aria-pressed={l.id === selectedId}
                onClick={() => setSelectedId(l.id === selectedId ? null : l.id)}
                className={`flex w-full justify-between rounded-lg px-3 py-2 text-left ${
                  l.id === selectedId ? "bg-sky-400/15 font-medium text-sky-300" : "hover:bg-slate-800"
                }`}
              >
                {l.name} <span className="text-slate-400">{l.routeIds.length}</span>
              </button>
            </li>
          ))}
        </ul>

        {selected && (
          <div className="mt-4 border-t border-slate-800 pt-3">
            <h2 className="font-semibold">{selected.name}</h2>
            {inList.length === 0 && (
              <p className="mt-1 text-slate-400">Empty. Add routes from the Routes page.</p>
            )}
            <ul className="mt-1">
              {inList.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-1">
                  {r.name}
                  <button
                    aria-label={`Remove ${r.name} from ${selected.name}`}
                    onClick={() =>
                      setLists(
                        lists.map((l) =>
                          l === selected ? { ...l, routeIds: l.routeIds.filter((id) => id !== r.id) } : l,
                        ),
                      )
                    }
                    className="shrink-0 text-slate-400 underline hover:text-slate-100"
                  >
                    Remove
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
      </section>
      <div className="min-h-0 flex-1">
        <MapView onMap={setMap} />
      </div>
    </div>
  );
}
