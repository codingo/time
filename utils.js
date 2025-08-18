// Time/format helpers
export function toTimeZone(date, zone) {
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

// Search helpers
export function normalize(s){
  return s.toLowerCase().replace(/[_/,-]/g," ").replace(/\s+/g," ").trim();
}
export function tokensOrderedMatch(qTokens, hay){
  let lastIdx = 0;
  for (const t of qTokens){
    const idx = hay.indexOf(t, lastIdx);
    if (idx === -1) return false;
    lastIdx = idx + t.length;
  }
  return true;
}

// Validation for datetime-local during typing
export function isValidDateTimeLocal(v){
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v);
}
