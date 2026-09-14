import { test } from "node:test";
import assert from "node:assert/strict";
import { operation, type Schedule } from "../src/schedule";

const store: Schedule = {
  open: false, scheduleEnabled: true, opensAt: "17:00", closesAt: "03:00",
  overrideOpen: null, overrideUntil: null,
};
for (const [at, open, next] of [
  ["2026-09-14T16:59:59-03:00", false, "2026-09-14T20:00:00.000Z"],
  ["2026-09-14T17:00:00-03:00", true, "2026-09-15T20:00:00.000Z"],
  ["2026-09-15T00:00:00-03:00", true, "2026-09-15T20:00:00.000Z"],
  ["2026-09-15T02:59:59-03:00", true, "2026-09-15T20:00:00.000Z"],
  ["2026-09-15T03:00:00-03:00", false, "2026-09-15T20:00:00.000Z"],
] as const) {
  test(`daily overnight shift at ${at}`, () => {
    const state = operation(store, new Date(at));
    assert.equal(state.open, open);
    assert.equal(state.nextOpening, next);
    assert.equal(state.timeZone, "America/Sao_Paulo");
  });
}
test("daytime shift and midnight/month/year rollover", () => {
  assert.equal(operation({ ...store, opensAt: "09:00", closesAt: "18:00" },
    new Date("2026-09-14T12:00:00-03:00")).open, true);
  assert.equal(operation(store, new Date("2026-12-31T23:59:00-03:00")).nextOpening,
    "2027-01-01T20:00:00.000Z");
  assert.equal(operation({ ...store, opensAt: "00:00", closesAt: "04:00" },
    new Date("2026-09-14T03:59:00-03:00")).open, true);
});
test("temporary override expires exactly at the scheduled boundary", () => {
  const early = { ...store, overrideOpen: true, overrideUntil: new Date("2026-09-14T17:00:00-03:00") };
  assert.equal(operation(early, new Date("2026-09-14T15:00:00-03:00")).open, true);
  const automatic = operation(early, new Date("2026-09-14T17:00:00-03:00"));
  assert.equal(automatic.open, true);
  assert.equal(automatic.overrideOpen, null);
  assert.equal(operation(early, new Date("2026-09-15T03:00:00-03:00")).open, false);
});
test("manual pause does not permanently override tomorrow's opening", () => {
  const paused = { ...store, overrideOpen: false, overrideUntil: new Date("2026-09-15T03:00:00-03:00") };
  assert.equal(operation(paused, new Date("2026-09-14T20:00:00-03:00")).open, false);
  assert.equal(operation(paused, new Date("2026-09-15T17:00:00-03:00")).open, true);
});
test("legacy manual mode does not promise reservations without a schedule", () => {
  const state = operation({ ...store, scheduleEnabled: false }, new Date("2026-09-14T20:00:00-03:00"));
  assert.equal(state.open, false);
  assert.equal(state.reservationsAvailable, false);
  assert.equal(state.nextOpening, null);
});
