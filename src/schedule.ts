import type { Store } from "@prisma/client";

// One daily shift, interpreted in the restaurant's zone, never the device zone.
export const STORE_TIME_ZONE = "America/Sao_Paulo";
export type Schedule = Pick<
  Store,
  | "open"
  | "scheduleEnabled"
  | "opensAt"
  | "closesAt"
  | "overrideOpen"
  | "overrideUntil"
>;
const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: STORE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
function localParts(date: Date) {
  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .map((part) => [part.type, Number(part.value)]),
  );
}
function localInstant(day: Date, time: string) {
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(
    day.getUTCFullYear(),
    day.getUTCMonth(),
    day.getUTCDate(),
    hour,
    minute,
  );
  let result = target;
  // Resolve the civil time with IANA timezone data (no fixed UTC-3 offset).
  for (let i = 0; i < 3; i++) {
    const p = localParts(new Date(result));
    result +=
      target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  }
  return new Date(result);
}
export function operation(store: Schedule, now = new Date()) {
  const p = localParts(now);
  const minute = p.hour * 60 + p.minute;
  const toMinute = (time: string) => {
    const [hour, minute] = time.split(":").map(Number);
    return hour * 60 + minute;
  };
  const start = toMinute(store.opensAt);
  const end = toMinute(store.closesAt);
  const scheduledOpen =
    start < end
      ? minute >= start && minute < end
      : minute >= start || minute < end;
  const dates = [0, 1, 2].map(
    (offset) => new Date(Date.UTC(p.year, p.month - 1, p.day + offset)),
  );
  const openings = dates.map((day) => localInstant(day, store.opensAt));
  const closings = dates.map((day) => localInstant(day, store.closesAt));
  const nextOpening = openings.find((date) => +date > +now)!;
  const nextBoundary = [...openings, ...closings]
    .filter((date) => +date > +now)
    .sort((a, b) => +a - +b)[0];
  const overridden =
    store.scheduleEnabled &&
    store.overrideOpen !== null &&
    store.overrideUntil !== null &&
    +store.overrideUntil > +now;
  const open = store.scheduleEnabled
    ? overridden
      ? store.overrideOpen!
      : scheduledOpen
    : store.open;
  return {
    open,
    scheduleEnabled: store.scheduleEnabled,
    opensAt: store.opensAt,
    closesAt: store.closesAt,
    timeZone: STORE_TIME_ZONE,
    scheduledOpen,
    reservationsAvailable: store.scheduleEnabled,
    nextOpening: store.scheduleEnabled ? nextOpening.toISOString() : null,
    overrideOpen: overridden ? store.overrideOpen : null,
    overrideUntil: overridden ? store.overrideUntil!.toISOString() : null,
    nextBoundary,
  };
}
export function operationDto(store: Schedule, now = new Date()) {
  const { nextBoundary: _boundary, ...dto } = operation(store, now);
  return dto;
}
