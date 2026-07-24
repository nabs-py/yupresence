import assert from "node:assert/strict";
import test from "node:test";

import { haversineDistanceMeters } from "./geofence.js";

test("identical coordinates are zero meters apart", () => {
  const location = { latitude: 24.69214332437712, longitude: 46.72137917669129 };

  assert.equal(haversineDistanceMeters(location, location), 0);
});

test("coordinates approximately 100 meters apart return a sane meter distance", () => {
  const first = { latitude: 0, longitude: 0 };
  const second = { latitude: 0, longitude: 0.00089932 };
  const distance = haversineDistanceMeters(first, second);

  assert.ok(Math.abs(distance - 100) < 0.1, `expected about 100m, received ${distance}m`);
});

test("the reported session and scan coordinates reproduce the recorded distance", () => {
  const session = { latitude: 24.7136, longitude: 46.6753 };
  const scan = { latitude: 24.69214332437712, longitude: 46.72137917669129 };
  const distance = haversineDistanceMeters(session, scan);

  assert.ok(Math.abs(distance - 5230.707567202958) < 0.001);
});
