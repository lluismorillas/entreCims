import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router";
import { createRoot } from "react-dom/client";
import * as maplibregl from "maplibre-gl";
import type { RouteInfo } from "../data";
import RouteCard from "./RouteCard";

/** Animates the camera to the start points, or back to the world if there are none. */
export function fitTo(map: maplibregl.Map, routes: RouteInfo[]) {
  if (routes.length === 0) {
    map.flyTo({ center: [0, 20], zoom: 1 });
    return;
  }
  const bounds = new maplibregl.LngLatBounds(routes[0].start, routes[0].start);
  for (const r of routes) bounds.extend(r.start);
  map.fitBounds(bounds, { padding: 80, maxZoom: 13 });
}

/** One marker per route at its start: hover shows its card, click opens it. The camera is fitted to them. */
export function useRouteMarkers(map: maplibregl.Map | null, routes: RouteInfo[]) {
  const current = useRef(routes);
  const navigate = useNavigate();

  useEffect(() => {
    if (!map) return;
    map.addSource("routes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({
      id: "routes",
      type: "circle",
      source: "routes",
      paint: {
        "circle-radius": 7,
        "circle-color": ["case", ["get", "planned"], "#0284c7", "#059669"],
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 2,
      },
    });

    const el = document.createElement("div");
    const root = createRoot(el);
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: "300px", offset: 10 });
    popup.setDOMContent(el);
    const show = (feature: maplibregl.MapGeoJSONFeature) => {
      const route = current.current[feature.id as number];
      if (!route) return;
      // Rendered synchronously so the popup can measure the card and stay inside the map.
      flushSync(() => root.render(<RouteCard route={route} compact />));
      popup.setLngLat([route.start[0], route.start[1]]).addTo(map);
    };
    const move = (e: maplibregl.MapLayerMouseEvent) => {
      map.getCanvas().style.cursor = "pointer";
      if (e.features?.[0]) show(e.features[0]);
    };
    const leave = () => {
      map.getCanvas().style.cursor = "";
      popup.remove();
    };
    const click = (e: maplibregl.MapLayerMouseEvent) => {
      const route = current.current[e.features?.[0]?.id as number];
      if (route) navigate(`/routes/${encodeURIComponent(route.id)}`);
    };
    map.on("mousemove", "routes", move);
    map.on("mouseleave", "routes", leave);
    map.on("click", "routes", click);

    return () => {
      map.off("mousemove", "routes", move);
      map.off("mouseleave", "routes", leave);
      map.off("click", "routes", click);
      popup.remove();
      // React refuses to unmount a root synchronously from inside its own commit.
      setTimeout(() => root.unmount());
    };
  }, [map, navigate]);

  useEffect(() => {
    if (!map) return;
    current.current = routes;
    (map.getSource("routes") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: routes.map((r, i) => ({
        type: "Feature",
        id: i,
        properties: { planned: r.kind === "planned" },
        geometry: { type: "Point", coordinates: r.start },
      })),
    });
    fitTo(map, routes);
  }, [map, routes]);
}
