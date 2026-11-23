// Run with `npm test` (Node >= 22.18 runs TypeScript directly).
import assert from "node:assert/strict";
import test from "node:test";
import { distance, trackStats } from "../src/data.ts";
import { reaches } from "../src/routing.ts";

test("distance: one degree of latitude", () => {
  assert.ok(Math.abs(distance([0, 0], [0, 1]) - 111195) < 10);
});

test("trackStats: 1 km at +10 % then 1 km at -10 %", () => {
  const dLat = 1000 / 111195;
  const s = trackStats([[0, 0, 100], [0, dLat, 200], [0, 2 * dLat, 100]]);
  assert.equal(s.distanceM, 2000);
  assert.equal(s.ascentM, 100);
  assert.equal(s.descentM, 100);
  // Tobler: 6·exp(-3.5·0.15) km/h up, 6·exp(-3.5·0.05) km/h down.
  const expected = 3600 / (6 * Math.exp(-0.525)) + 3600 / (6 * Math.exp(-0.175));
  assert.ok(Math.abs(s.totalS! - expected) < 2);
  assert.equal(s.difficulty, "easy");
});

test("trackStats: no elevation means no climb, time or difficulty", () => {
  const s = trackStats([[0, 0], [0, 0.01]]);
  assert.deepEqual([s.ascentM, s.totalS, s.difficulty], [null, null, null]);
});

import { decodePolyline, straightLine } from "../src/routing.ts";

test("decodePolyline: reference vector of the polyline format (5 decimals)", () => {
  assert.deepEqual(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 1e5), [
    [-120.2, 38.5],
    [-120.95, 40.7],
    [-126.453, 43.252],
  ]);
});

test("straightLine: keeps both ends and adds a point about every 30 m", () => {
  const line = straightLine([0, 0], [0, 0.001], 111);
  assert.equal(line.length, 5);
  assert.deepEqual([line[0], line.at(-1)], [[0, 0], [0, 0.001]]);
});

test("reaches: a path that stops short of the clicked summit does not count", () => {
  const dLat = 100 / 111195;
  const from = [1.4, 42.6];
  const summit = [1.4, 42.6 + 10 * dLat];
  assert.ok(reaches([from, [1.4, 42.6 + 9.7 * dLat]], from, summit)); // 30 m short
  assert.ok(!reaches([from, [1.4, 42.6 + 8.6 * dLat]], from, summit)); // 140 m short, as T4 on Pica d'Estats
});
