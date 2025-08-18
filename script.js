// Timezone support
const DEFAULT_ZONES = ["Australia/Brisbane", "America/Los_Angeles", "America/New_York"];
const zoneContainer = document.getElementById("zones");
let zones = [];

// Init
window.onload = () => {
  const params = new URLSearchParams(window.location.search);
  const paramZones = params.get("zones")?.split(",") || DEFAULT_ZONES;
  const baseTime = params.get("time") ? new Date(params.get("time")) : new Date();

  paramZones.forEach((z, i) => addZone(z, new Date(baseTime)));

  document.getElementById("add-zone").addEventListener("click", () => {
    addZone("UTC", new Date());
    updateURL();
  });
};

function addZone(zoneName, dateObj) {
  const row = document.createElement("div");
  row.className = "zone-row";

  const label = document.createElement("input");
  label.className = "zone-label";
  label.placeholder = "Enter a city/timezone...";
  label.value = zoneName;

  const datetime = document.createElement("input");
  datetime.type = "datetime-local";
  datetime.className = "datetime";
  datetime.value = formatLocalInput(dateObj, zoneName);

  row.appendChild(label);
  row.appendChild(datetime);
  zoneContainer.appendChild(row);

  zones.push({ row, label, datetime, zoneName });

  label.addEventListener("change", () => {
    zones.forEach(z => {
      if (z === zones.find(q => q.row === row)) {
        z.zoneName = label.value;
        z.datetime.value = formatLocalInput(new Date(), z.zoneName);
      }
    });
    syncAllFrom(row);
  });

  datetime.addEventListener("change", () => {
    syncAllFrom(row);
  });

  syncRow(row, new Date(datetime.value));
}

function syncAllFrom(sourceRow) {
  const source = zones.find(z => z.row === sourceRow);
  const sourceDate = new Date(source.datetime.value);
  zones.forEach(z => {
    if (z !== source) {
      z.datetime.value = formatLocalInput(sourceDate, z.zoneName);
      syncRow(z.row, sourceDate);
    }
  });
  updateURL();
}

function syncRow(row, refDate) {
  const z = zones.find(q => q.row === row);
  const dateInZone = toTimeZone(refDate, z.zoneName);
  z.datetime.value = formatLocalInput(dateInZone, z.zoneName);

  const hour = dateInZone.getHours();
  const day = dateInZone.getDay();
  const isWorkHours = day > 0 && day < 6 && hour >= 8 && hour < 16;

  row.classList.remove("good", "bad");
  row.classList.add(isWorkHours ? "good" : "bad");
}

function toTimeZone(date, zone) {
  return new Date(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).formatToParts(date).reduce((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {})
    .let(d => `${d.year}-${d.month}-${d.day}T${d.hour}:${d.minute}`)
  );
}

function formatLocalInput(date, zone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function updateURL() {
  const params = new URLSearchParams();
  const firstZone = zones[0];
  if (firstZone) params.set("time", firstZone.datetime.value);
  params.set("zones", zones.map(z => z.zoneName).join(","));
  history.replaceState({}, "", "?" + params.toString());
}

// Polyfill hack
Object.prototype.let = function(fn) { return fn(this); };
