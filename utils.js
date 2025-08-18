// Utility helpers kept separate for clarity

export function toTimeZone(date, zone) {
  // Create a Date that represents the same wall time in the given zone
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  }).formatToParts(date).reduce((a, p) => (p.type !== "literal" && (a[p.type] = p.value), a), {});
  return new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00`);
}

export function formatLocalInput(date, zone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  }).formatToParts(date).reduce((a, p) => (p.type !== "literal" && (a[p.type] = p.value), a), {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function isBusinessHours(date, zone) {
  const inZone = toTimeZone(date, zone);
  const d = inZone.getDay(); // 0 Sun, 6 Sat
  if (d === 0 || d === 6) return false;
  const h = inZone.getHours() + inZone.getMinutes() / 60;
  return h >= 8 && h < 16;
}
