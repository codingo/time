import { toTimeZone, formatLocalInput, isBusinessHours } from "./utils.js";

// Defaults: Gold Coast (Brisbane), San Francisco (LA), New Hampshire (NY)
const DEFAULT_ZONES = ["Australia/Brisbane", "America/Los_Angeles", "America/New_York"];
const zoneContainer = document.getElementById("zones");
let zones = []; // [{ row, label, datetime, zoneName }]

// --- init
const params = new URLSearchParams(location.search);
const startupZones = (params.get("zones")?.split(",").filter(Boolean)) || DEFAULT_ZONES;
const initialTime = params.get("time") ? new Date(params.get("time")) : new Date();

startupZones.forEach(z => addZone(z, new Date(initialTime)));

document.getElementById("add-zone").addEventListener("click", () => {
  addZone("UTC", new Date());
  updateURL();
});

// --- add / sync
function addZone(zoneName, dateObj) {
  const row = document.createElement("div");
  row.className = "zone-row";

  const label = document.createElement("input");
  label.className = "zone-label";
  label.placeholder = "Enter a city/timezone (e.g., Brisbane, San Francisco, America/Los_Angeles)";
  label.value = zoneName;

  const datetime = document.createElement("input");
  datetime.type = "datetime-local";
  datetime.className = "datetime";
  datetime.value = formatLocalInput(dateObj, zoneName);

  row.appendChild(label);
  row.appendChild(datetime);
  zoneContainer.appendChild(row);

  const rec = { row, label, datetime, zoneName };
  zones.push(rec);

  label.addEventListener("change", () => {
    rec.zoneName = label.value;
    // on zone change, keep the same UTC instant but update display
    syncRow(row, getSharedInstant());
    updateURL();
  });

  datetime.addEventListener("input", () => {
    // Interpret edited value as wall time in this row’s zone,
    // derive new shared UTC instant, then propagate to others.
    const newInstant = fromInputAsInstant(datetime.value, rec.zoneName);
    setSharedInstant(newInstant, row);
    updateURL();
  });

  // Initial paint
  syncRow(row, getSharedInstant());
  updateURL();
}

function setSharedInstant(instant, sourceRow) {
  // Update all rows to reflect this instant
  zones.forEach(z => {
    const zDate = toTimeZone(instant, z.zoneName);
    z.datetime.value = formatLocalInput(zDate, z.zoneName);
    paintRow(z.row, instant);
  });
}

function getSharedInstant() {
  // Use the first row as the canonical instant
  const first = zones[0];
  if (!first) return new Date();
  return fromInputAsInstant(first.datetime.value, first.zoneName);
}

function fromInputAsInstant(inputValue, zone) {
  // input is yyyy-MM-ddTHH:mm; treat as wall time in zone, convert to UTC instant
  const [datePart, timePart] = inputValue.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [H, Min] = timePart.split(":").map(Number);
  // Build a UTC date from the wall time, then subtract the zone offset at that wall time
  const approxUTC = new Date(Date.UTC(y, m - 1, d, H, Min));
  const offsetMins = getOffsetMinutes(approxUTC, zone);
  return new Date(approxUTC.getTime() - offsetMins * 60 * 1000);
}

function getOffsetMinutes(dateUTC, zone) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(dateUTC);
  const off = parts.find(p => p.type === "timeZoneName")?.value || "UTC+00:00";
  const m = off.match(/([+-])(\d{2}):?(\d{2})/);
  if (!m) return 0;
  const sign = m[1] === "+" ? 1 : -1;
  return sign * (parseInt(m[2]) * 60 + parseInt(m[3]));
}

function paintRow(row, instant) {
  const rec = zones.find(z => z.row === row);
  if (!rec) return;
  const ok = isBusinessHours(instant, rec.zoneName);
  row.classList.toggle("good", ok);
  row.classList.toggle("bad", !ok);
}

function syncRow(row, instant) {
  const rec = zones.find(z => z.row === row);
  if (!rec) return;
  const local = toTimeZone(instant, rec.zoneName);
  rec.datetime.value = formatLocalInput(local, rec.zoneName);
  paintRow(row, instant);
}

function updateURL() {
  const p = new URLSearchParams();
  const first = zones[0];
  if (first) p.set("time", first.datetime.value); // wall time of first zone; fine for sharable permalinks
  p.set("zones", zones.map(z => z.zoneName).join(","));
  history.replaceState(null, "", `?${p.toString()}`);
}
