import { NavLink, Route, Routes } from "react-router";
import Icon from "./components/Icon";
import Home from "./views/Home";
import Lists from "./views/Lists";
import NewRoute from "./views/NewRoute";
import Peaks from "./views/Peaks";
import RouteDetail from "./views/RouteDetail";
import TimeModel from "./views/TimeModel";
import RoutesView from "./views/Routes";

const LINKS = [
  ["/", "Home", "home"],
  ["/routes", "Routes", "map"],
  ["/peaks", "Peaks", "flag"],
  ["/model", "Time model", "time"],
  ["/lists", "Lists", "list"],
] as const;

function App() {
  return (
    <div className="flex h-dvh flex-col md:flex-row">
      <nav
        aria-label="Main"
        className="flex shrink-0 flex-wrap items-center gap-1 border-slate-800 bg-slate-900 p-2 text-sm max-md:border-b md:w-56 md:flex-col md:items-stretch md:border-r md:p-3">
        <span className="flex items-center gap-2 px-2 text-lg font-bold tracking-tight md:pt-1 md:pb-4">
          {/* Decorative: the name next to it already says what it is. */}
          <img src="/logo.jpg" alt="" className="size-8 rounded-lg" />
          <span>
            entre<span className="text-sky-400">Cims</span>
          </span>
        </span>
        {LINKS.map(([to, label, icon]) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 ${isActive ? "bg-sky-400/15 font-medium text-sky-300" : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"}`
            }
          >
            <Icon name={icon} className="size-[18px]" />
            {label}
          </NavLink>
        ))}
        {/* The one action of the app, so it gets the button treatment instead of a link row. */}
        <NavLink to="/new" className="btn btn-primary flex items-center justify-center gap-2 max-md:ml-auto md:mt-4">
          <Icon name="plus" />
          Import or draw a route
        </NavLink>
        <p className="mt-auto px-2 pt-4 text-xs text-slate-500 max-md:hidden">wabisabi</p>
      </nav>
      <main className="min-h-0 min-w-0 flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/new" element={<NewRoute />} />
          <Route path="/routes" element={<RoutesView />} />
          <Route path="/routes/:id" element={<RouteDetail />} />
          <Route path="/peaks" element={<Peaks />} />
          <Route path="/model" element={<TimeModel />} />
          <Route path="/lists" element={<Lists />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
