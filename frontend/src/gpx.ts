// Reads an uploaded GPX or TCX file in the browser.
// shortcut: stand-in for the backend importer (T021/T022), which will also read FIT.
// DOMParser does not load external entities, so hostile XML cannot reach the network (NFR-6).
const MAX_BYTES = 20 * 1024 * 1024;

export async function readTrackFile(file: File) {
  if (!/\.(gpx|tcx)$/i.test(file.name)) throw new Error("Only GPX and TCX files can be uploaded for now.");
  if (file.size > MAX_BYTES) throw new Error("The file is larger than 20 MB.");
  const doc = new DOMParser().parseFromString(await file.text(), "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("The file is not valid XML.");

  const all = (parent: Document | Element, tag: string) => [...parent.getElementsByTagNameNS("*", tag)];
  const text = (parent: Document | Element, tag: string) => all(parent, tag)[0]?.textContent?.trim() || undefined;
  const isTcx = /\.tcx$/i.test(file.name);

  const points: number[][] = [];
  const times: number[] = [];
  for (const el of all(doc, isTcx ? "Trackpoint" : "trkpt")) {
    const lon = Number(isTcx ? text(el, "LongitudeDegrees") : el.getAttribute("lon"));
    const lat = Number(isTcx ? text(el, "LatitudeDegrees") : el.getAttribute("lat"));
    // Number(null) is 0, so a point without coordinates must be rejected explicitly.
    if ((isTcx ? !text(el, "LatitudeDegrees") : !el.hasAttribute("lat")) || !(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) continue;
    const ele = Number(text(el, isTcx ? "AltitudeMeters" : "ele") ?? NaN);
    points.push(Number.isFinite(ele) ? [lon, lat, ele] : [lon, lat]);
    const time = Date.parse(text(el, isTcx ? "Time" : "time") ?? "");
    if (Number.isFinite(time)) times.push(time);
  }
  if (points.length < 2) throw new Error("The file has no track with at least two points.");

  // A TCX course carries the times of whoever recorded it: it is a route to follow, not a done activity.
  const recorded = times.length === points.length && all(doc, "Course").length === 0;
  return {
    points,
    name: (text(isTcx ? doc : (all(doc, "trk")[0] ?? doc), isTcx ? "Name" : "name") ?? file.name.replace(/\.\w+$/, "")).replace(/ - Wikiloc$/, ""),
    author: all(doc, "author")[0] ? text(all(doc, "author")[0], "name") : undefined,
    date: recorded ? new Date(times[0]).toISOString().slice(0, 10) : undefined,
    elapsedS: recorded ? Math.round((times.at(-1)! - times[0]) / 1000) : undefined,
  };
}
