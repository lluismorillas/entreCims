import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { valhallaUp } from "../routing";
import Icon from "./Icon";

const DOWN = {
  valhalla: "Valhalla is not answering: paths and elevation are unavailable, so segments are drawn as straight lines.",
  overpass: "Overpass is not answering: peaks cannot be downloaded right now.",
};

async function overpassUp() {
  try {
    const status = await fetch("/api/status/overpass");
    return status.ok ? (await status.json()).up : true;
  } catch {
    return true; // our own server is down: nothing to say about Overpass
  }
}

/** A warning icon, shown only while an external service is down; its note says which. Checked every minute. */
export default function ServiceStatus() {
  const [down, setDown] = useState<(keyof typeof DOWN)[]>([]);
  // Where the icon is while the note is open; null when closed.
  const [at, setAt] = useState<DOMRect | null>(null);
  useEffect(() => {
    const check = () =>
      Promise.all([valhallaUp(), overpassUp()]).then(([valhalla, overpass]) =>
        setDown([...(valhalla ? [] : ["valhalla" as const]), ...(overpass ? [] : ["overpass" as const])]),
      );
    check();
    const timer = setInterval(check, 60_000);
    return () => clearInterval(timer);
  }, []);
  if (!down.length) return null;

  const open = (e: { currentTarget: HTMLElement }) => setAt(e.currentTarget.getBoundingClientRect());
  const close = () => setAt(null);
  return (
    <>
      <button
        type="button"
        aria-describedby={at ? "service-status" : undefined}
        aria-label="External service warning"
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        className="inline-flex rounded align-middle text-amber-300"
      >
        <Icon name="warning" className="size-5" />
      </button>
      {/* Drawn on the page itself: inside the scrolling side panel it would be cut off at its edge. */}
      {at &&
        createPortal(
          <div
            id="service-status"
            role="tooltip"
            style={{ top: at.bottom + 6, left: Math.min(at.left, window.innerWidth - 300) }}
            className="fixed z-50 w-72 space-y-1 rounded-lg border border-amber-300/40 bg-slate-900 p-3 text-xs text-slate-200 shadow-lg"
          >
            {down.map((service) => (
              <p key={service}>{DOWN[service]}</p>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
