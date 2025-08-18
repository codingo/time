// --- tiny utility: query by id
const $ = (id) => document.getElementById(id);

// --- state from URL (zones as IANA IDs, time as ISO)
const url = new URL(location.href);
const initialZones = (url.searchParams.get("zones") || "Australia/Brisbane,America/Los_Angeles,UTC")
  .split(",")
  .filter(Boolean);
let when = url.searchParams.get("time") ? new Date(url.searchParams.get("time")) : new Date();
let zones = Array.from(new Set(initialZones));

// --- wire inputs
$("when").value = toLocalInputValue(when);
$("nowBtn").onclick = () => { when = new Date(); $("when").value = toLocalInputValue(when); render(); syncQuery(); };
$("when").oninput = (e) => { when = new Date(e.target.value); render(); syncQuery(); };

// --- build time zone index from browser (self-hosted, no CDN)
const allTz = (Intl.supportedValuesOf && Intl.supportedValuesOf("timeZone")) || fallbackTz();
const items = allTz.map(zone => ({
  zone,
  city: zone.split("/").pop().replace(/_/g, " "),
  region: zone.split("/")[0],
}));

// --- human aliases (so "San Francisco" finds LA/PT)
const ALIAS = {
  "America/Los_Angeles": ["San Francisco", "SF", "Bay Area", "Los Angeles", "LA", "Pacific", "PT", "PST", "PDT"],
  "America/New_York": ["New York", "NYC", "ET", "Eastern"],
  "Europe/London": ["London", "UK", "GMT", "BST"],
  "Australia/Brisbane": ["Brisbane", "QLD", "AEST (no DST)"],
  "Australia/Sydney": ["Sydney", "NSW", "AEST", "AEDT"],
  "Europe/Paris": ["Paris", "CET", "CEST"],
  "Asia/Tokyo": ["Tokyo", "JST"],
  "Asia/Singapore": ["Singapore", "SGT"],
  "Pacific/Auckland": ["Auckland", "NZ", "NZT"],
};

// --- simple fuzzy search (no external libs)
function search(q, limit = 10) {
  if (!q) return [];
  q = q.toLowerCase().trim();

  const score = (it) => {
    const hay = [
      it.city,
      it.zone,
      it.region,
      ...(ALIAS[it.zone] || [])
    ].join(" ").toLowerCase();

    // scoring: startsWith > includes > split-token match
    if (hay.startsWith(q)) return 0;
    if (hay.includes(q)) return 1;
    // token proximity
    const tokenHit = hay.split(/[/\s,_-]+/).some(t => t.startsWith(q));
    return tokenHit ? 2 : 999;
  };

  return items
    .map(it => ({ it, s: score(it) }))
    .filter(x => x.s < 999)
    .sort((a, b) => a.s - b.s || a.it.city.localeCompare(b.it.city))
    .slice(0, limit)
    .map(x => x.it);
}

// --- picker UI
const searchEl = $("tzSearch");
const resultsEl = $("results");
searchEl.addEventListener("input", () => {
  const hits = search(searchEl.value);
  resultsEl.innerHTML = "";
  for (const it of hits) {
    const li = document.createElement("li");
    li.className = "menu-item";
    li.title = it.zone;
    li.textContent = labelFor(it.zone);
    li.onclick = () => addZone(it.zone);
    resultsEl.appendChild(li);
  }
});
$("addBtn").onclick = () => {
  const hits = search(searchEl.value, 1);
  if (hits[0]) addZone(hits[0].zone);
};
$("removeAllBtn").onclick = () => { zones = []; render(); syncQuery(); };

function addZone(zone) {
  if (!zones.includes(zone)) zones.push(zone);
  searchEl.value = "";
  resultsEl.innerHTML = "";
  render();
  syncQuery();
}
function removeZone(zone) {
  zones = zones.filter(z => z !== zone);
  render();
  syncQuery();
}

// --- render selected zones
const listEl = $("list");
function render() {
  listEl.innerHTML = "";
  for (const z of zones) {
    const li = document.createElement("li");
    li.className = "zone";
    li.innerHTML = `
      <div class="meta">
        <div class="name">${displayCity(z)}</div>
        <div class="sub">${z} • ${offsetStr(z)} • ${isBusinessHours(when, z) ? "🙂" : "☹"}</div>
      </div>
      <div class="time">${formatAt(when, z)}</div>
      <button class="kill" title="Remove">×</button>
    `;
    li.querySelector(".kill").onclick = () => removeZone(z);
    listEl.appendChild(li);
  }
}
render();
syncQuery();

// --- helpers
function syncQuery() {
  const p = new URLSearchParams();
  if (zones.length) p.set("zones", zones.join(","));
  p.set("time", when.toISOString());
  history.replaceState(null, "", `${location.pathname}?${p.toString()}`);
}
function displayCity(zone) { return zone.split("/").pop().replace(/_/g, " "); }

function toLocalInputValue(d) {
  const pad = (x) => String(x).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  return `${y}-${m}-${dd}T${hh}:${mm}`;
}
function formatAt(date, timeZone) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}
function offsetMinutesAt(date, timeZone) {
  // extract "GMT±HH:MM" from parts
  const parts = new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "shortOffset" }).formatToParts(date);
  const off = parts.find(p => p.type === "timeZoneName")?.value || "UTC+00:00";
  const m = off.match(/([+-])(\d{2}):?(\d{2})/);
  if (!m) return 0;
  const sign = m[1] === "+" ? 1 : -1;
  return sign * (parseInt(m[2]) * 60 + parseInt(m[3]));
}
function offsetStr(timeZone) {
  const mins = offsetMinutesAt(when, timeZone);
  const sign = mins >= 0 ? "+" : "-";
  const abs = Math.abs(mins);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `UTC${sign}${hh}:${mm}`;
}
function isBusinessHours(date, timeZone) {
  const local = new Date(date.toLocaleString("en-US", { timeZone }));
  const h = local.getHours() + local.getMinutes() / 60;
  return h >= 8 && h < 16; // 08:00–15:59
}

// minimal fallback if Intl.supportedValuesOf is missing
function fallbackTz() {
  return [
    "UTC",
    "Australia/Brisbane","Australia/Sydney","Australia/Melbourne","Australia/Perth","Australia/Adelaide",
    "Pacific/Auckland",
    "Asia/Tokyo","Asia/Singapore","Asia/Hong_Kong","Asia/Kolkata","Asia/Dubai",
    "Europe/London","Europe/Paris","Europe/Berlin","Europe/Madrid",
    "America/Los_Angeles","America/Denver","America/Chicago","America/New_York"
  ];
}
