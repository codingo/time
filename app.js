const $ = (id) => document.getElementById(id);

// --- state
const url = new URL(location.href);
const initialZones = (url.searchParams.get("zones") || "Australia/Brisbane,America/Los_Angeles,UTC")
  .split(",")
  .filter(Boolean);
let when = url.searchParams.get("time") ? new Date(url.searchParams.get("time")) : new Date();
let zones = Array.from(new Set(initialZones));

// --- base timezone (first in list)
const baseZoneLabelEl = document.getElementById("baseZoneLabel");
const baseZone = () => zones[0] || "UTC";
const updateBaseLabel = () => baseZoneLabelEl.textContent = baseZone();
updateBaseLabel();

// --- all tz from browser
const allTz = (Intl.supportedValuesOf && Intl.supportedValuesOf("timeZone")) || fallbackTz();
const items = allTz.map(zone => ({
  zone,
  city: zone.split("/").pop().replace(/_/g, " "),
  region: zone.split("/")[0],
}));

// --- alias search
const ALIAS = (window.ALIASES) || {};
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

    if (hay.startsWith(q)) return 0;
    if (hay.includes(q)) return 1;
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

// --- datetime-local helpers
function toInputForZone(dUTC, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(dUTC).reduce((a,p)=> (a[p.type]=p.value,a),{});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
function fromInputForZone(inputValue, tz) {
  const [y,m,dTh] = inputValue.split("-");
  const [d,hm] = dTh.split("T");
  const [H,Min] = hm.split(":");
  const approxUTC = new Date(Date.UTC(+y, +m-1, +d, +H, +Min));
  const off = offsetMinutesAt(new Date(approxUTC), tz);
  return new Date(approxUTC.getTime() - off*60*1000);
}

// --- wire datetime picker
$("when").value = toInputForZone(when, baseZone());
$("nowBtn").onclick = () => {
  when = new Date();
  $("when").value = toInputForZone(when, baseZone());
  render(); syncQuery();
};
$("when").oninput = (e) => {
  when = fromInputForZone(e.target.value, baseZone());
  render(); syncQuery();
};

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

// --- add/remove
function addZone(zone) {
  if (!zones.includes(zone)) zones.push(zone);
  searchEl.value = "";
  resultsEl.innerHTML = "";
  render();
  updateBaseLabel();
  $("when").value = toInputForZone(when, baseZone());
  syncQuery();
}
function removeZone(zone) {
  zones = zones.filter(z => z !== zone);
  render();
  updateBaseLabel();
  $("when").value = toInputForZone(when, baseZone());
  syncQuery();
}

// --- render
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

// --- query sync
function syncQuery() {
  const p = new URLSearchParams();
  if (zones.length) p.set("zones", zones.join(","));
  p.set("time", when.toISOString());
  history.replaceState(null, "", `${location.pathname}?${p.toString()}`);
}

// --- helpers
function displayCity(zone) { return zone.split("/").pop().replace(/_/g, " "); }
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
function isBusinessHours(dateUTC, timeZone) {
  const local = new Date(dateUTC.toLocaleString("en-US", { timeZone }));
  const day = local.getDay();
  if (day === 0 || day === 6) return false;
  const h = local.getHours() + local.getMinutes() / 60;
  return h >= 8 && h < 16;
}
function labelFor(zone) {
  return `${displayCity(zone)} (${zone})`;
}
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
