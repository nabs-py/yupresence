import assert from "node:assert/strict";
import test from "node:test";

import { calculateAttendanceWarning, isVisibleAttendanceWarning } from "./warnings.js";

const statusForAbsences = (absenceCount: number) => calculateAttendanceWarning(absenceCount, 0).status;

test("absence warning tiers use university-aligned boundaries", () => {
  assert.equal(statusForAbsences(0), "excellent");
  assert.equal(statusForAbsences(3), "excellent");
  assert.equal(statusForAbsences(4), "safe");
  assert.equal(statusForAbsences(6), "safe");
  assert.equal(statusForAbsences(7), "warning");
  assert.equal(statusForAbsences(9), "warning");
  assert.equal(statusForAbsences(10), "critical");
  assert.equal(statusForAbsences(25), "critical");
});

test("only Warning and Critical / DN tiers are visible in watchlists and banners", () => {
  assert.equal(isVisibleAttendanceWarning(statusForAbsences(6)), false);
  assert.equal(isVisibleAttendanceWarning(statusForAbsences(7)), true);
  assert.equal(isVisibleAttendanceWarning(statusForAbsences(9)), true);
  assert.equal(isVisibleAttendanceWarning(statusForAbsences(10)), true);
});
