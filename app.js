const $ = (id) => document.getElementById(id);

// ---------- State (from URL) ----------
const url = new URL(location.href);
const initialZones = (url.searchParams.get("zones")
  || "Australia/Brisbane,America/Los_Angeles,America/New_York" // Gold Coast, San Francisco, New Hampshire
).split(",").filter(Boolean);

let when = url.searchParams.get("time") ? new Date(url.searchParams.get("time")) : new Date(); // shared UTC instant
let zones = Array.from(new Set(initialZones));

// ---------- Time zone catalogue ----------
const allTz = (Intl.supportedValuesOf && Intl.supportedValuesOf("timeZone")) || fallbackTz();
const items = allTz.map(zone => ({
  zone,
  city: zone.split("/").pop().replace(/_/g, " "),
  region: zone.split("/")[0],
}));

// ---------- Alias-backed instant search ----------
const ALIAS = (window.ALIASES) || {};
function search(q, limit = 12) {
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

// ---------- Picker UI ----------
const searchEl = $("tzSearch");
const resultsEl = $("results");
searchEl.addEventListener("input", () => {
  const hits = search(searchEl.value);
  resultsEl.innerHTML = "";
  for (const it of hits) {
    const li = document.createElement("li");
    li.className = "menu-item";
    li.title = it.zone;
    li.textContent = `${it.city} (${it.zone})`;
    li.onclick = () => addZone(it.zone);
    resultsEl.appendChild(li);
  }
});
$("addBtn").onclick = () => {
  const hit = search(searchEl.value, 1)[0];
  if (hit) addZone(hit.zone);
};
$("removeAllBtn").onclick = () => { zones = []; render(); syncQuery(); };

function addZone(zone) {
  if (!zones.includes(zone)) zones.push(zone);
  searchEl.value = "";
  resultsEl.innerHTML = "";
  render(); syncQuery();
}
function removeZone(zone) {
  zones = zones.filter(z => z !== zone);
  render(); syncQuery();
}

// ---------- Render list (each row editable & coloured) ----------
const listEl = $("list");
function render() {
  listEl.innerHTML = "";
  for (const z of zones) {
    const good = isBusinessHours(when, z);

    const li = document.createElement("li");
    li.className = `zone card ${good ? "ok" : "bad"}`;

    const city = displayCity(z);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = `
      <div class="name">${city}</div>
      <div class="sub">${z} • ${offsetStr(z)}</div>
    `;

    // datetime-local showing wall-time in this zone
    const dt = document.createElement("input");
    dt.type = "datetime-local";
    dt.className = "row-when";
    dt.value = toInputForZone(when, z);
    dt.addEventListener("input", (e) => {
      when = fromInputForZone(e.target.value, z); // new shared instant
      render();
      syncQuery();
    });

    // Clickable time text mirrors dt (click focuses picker)
    const timeTxt = document.createElement("div");
    timeTxt.className = "time linklike";
    timeTxt.textContent = formatAt(when, z);
    timeTxt.title = "Click to edit time";
    timeTxt.addEventListener("click", () => dt.showPicker ? dt.showPicker() : dt.focus());

    const kill = document.createElement("button");
    kill.className = "kill btn tiny";
    kill.title = "Remove";
    kill.textContent = "×";
    kill.onclick = () => removeZone(z);

    const row = document.createElement("div");
    row.className = "zone-row";
    row.appendChild(meta);
    row.appendChild(timeTxt);
    row.appendChild(dt);
    row.appendChild(kill);

    li.appendChild(row);
    listEl.appendChild(li);
  }
}
render();
syncQuery();

// ---------- URL sync ----------
function syncQuery() {
  const p = new URLSearchParams();
  if (zones.length) p.set("zones", zones.join(","));
  p.set("time", when.toISOString());
  history.replaceState(null, "", `${location.pathname}?${p.toString()}`);
}

// ---------- Time helpers ----------
function displayCity(zone) { return zone.split("/").pop().replace(/_/g, " "); }

function toInputForZone(dUTC, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(dUTC).reduce((a,p)=> (a[p.type]=p.value,a),{});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function fromInputForZone(inputValue, tz) {
  const [datePart, timePart] = inputValue.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [H, Min] = timePart.split(":").map(Number);
  const approxUTC = new Date(Date.UTC(y, m - 1, d, H, Min));
  const offMins = offsetMinutesAt(approxUTC, tz);
  return new Date(approxUTC.getTime() - offMins * 60 * 1000);
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
  const day = local.getDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;
  const h = local.getHours() + local.getMinutes() / 60;
  return h >= 8 && h < 16;
}

// ---------- Fallback tz list ----------
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
