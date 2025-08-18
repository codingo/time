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
  const h = inZone.getHours() + inZone.getMinutes() / 60;
  // 08:00–16:00 weekdays; add a 'neutral' band (7–8, 16–18)
  if (d === 0 || d === 6) return "bad";
  if (h >= 8 && h < 16) return "good";
  if ((h >= 7 && h < 8) || (h >= 16 && h < 18)) return "neutral";
  return "bad";
}

// human bits
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
export function isValidDateTimeLocal(v){
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v);
}

export function zoneOffsetLabel(dateUTC, zone){
  const parts = new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(dateUTC);
  return parts.find(p => p.type === "timeZoneName")?.value || "UTC+00:00";
}
