// List of city/timezone options (name -> IANA timezone ID)
const timeZones = [
  { name: "Gold Coast, Australia", tz: "Australia/Brisbane" },
  { name: "Pacific Time (PT)", tz: "America/Los_Angeles" },
  { name: "San Francisco, CA, USA", tz: "America/Los_Angeles" },
  { name: "New York, NY, USA", tz: "America/New_York" },
  { name: "London, UK", tz: "Europe/London" },
  { name: "Tokyo, Japan", tz: "Asia/Tokyo" },
  { name: "UTC", tz: "UTC" }
];

// State: selected zones (each an object with name & tz). Initialize with defaults.
let selectedZones = [
  timeZones[0], // Gold Coast
  timeZones[1], // Pacific Time
  timeZones[2]  // San Francisco
];
let baseZone = selectedZones[0]; // default base is Gold Coast

// DOM elements
const baseZoneSelect = document.getElementById("baseZone");
const baseDateInput = document.getElementById("baseDate");
const baseTimeInput = document.getElementById("baseTime");
const zonesListEl = document.getElementById("zonesList");
const newZoneInput = document.getElementById("newZoneInput");
const zoneOptionsDataList = document.getElementById("zoneOptions");
const addZoneBtn = document.getElementById("addZoneBtn");

// Populate baseZone select and datalist options
function populateZoneOptions() {
  timeZones.forEach((opt, idx) => {
    // Add to baseZone dropdown
    const option = document.createElement("option");
    option.value = opt.tz;
    option.textContent = opt.name;
    baseZoneSelect.appendChild(option);
    // Add to datalist for adding cities
    const dataOpt = document.createElement("option");
    dataOpt.value = opt.name;
    zoneOptionsDataList.appendChild(dataOpt);
  });
}
populateZoneOptions();

// Select default base zone in dropdown
baseZoneSelect.value = baseZone.tz;

// Helper: format Date `dt` to a string in timezone `tzID`
function formatDateInZone(dt, tzID) {
  // Format as "Thu, 21 Aug 2025, 4:00 PM"
  const options = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
                    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tzID };
  return new Intl.DateTimeFormat('en-US', options).format(dt);
}

// Helper: get smiley/sad SVG use element based on hour
function getFaceIcon(hour) {
  const useElem = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  useElem.setAttribute("class", "zone-face");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", hour >= 8 && hour < 16 ? "#icon-smile" : "#icon-sad");
  useElem.appendChild(use);
  return useElem;
}

// Render the list of zone entries in the DOM
function renderZoneList(refDate) {
  zonesListEl.innerHTML = ""; // clear current list
  selectedZones.forEach((loc, index) => {
    const zoneTime = new Date(refDate.toISOString()); // clone the Date
    // Format in that zone and also extract hour for friendly check
    // (to extract hour properly, we use toLocaleString with timeZone or Intl parts)
    const localeString = formatDateInZone(zoneTime, loc.tz);
    // We can get the hour by formatting separately or by parsing localeString. Simpler:
    const hour = Number(zoneTime.toLocaleString('en-US', { hour12: false, hour: '2-digit', timeZone: loc.tz }));
    // Build DOM elements
    const entryDiv = document.createElement("div");
    entryDiv.className = "zone-entry";
    const cityDiv = document.createElement("div");
    cityDiv.className = "zone-city";
    cityDiv.textContent = loc.name;
    const timeDiv = document.createElement("div");
    timeDiv.className = "zone-time";
    timeDiv.textContent = localeString;
    // Append friendly/unfriendly face
    timeDiv.appendChild(getFaceIcon(hour));
    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-btn";
    removeBtn.textContent = "×";
    removeBtn.title = "Remove";
    removeBtn.onclick = () => {
      removeZone(index);
    };
    entryDiv.appendChild(cityDiv);
    entryDiv.appendChild(timeDiv);
    // Only show remove button for non-base entries
    if (loc.tz !== baseZone.tz) {
      entryDiv.appendChild(removeBtn);
    }
    zonesListEl.appendChild(entryDiv);
  });
}

// Function to recalculate times based on current base time selection
function updateTimes() {
  // Parse base date and time input values
  const dateStr = baseDateInput.value;
  const timeStr = baseTimeInput.value;
  if (!dateStr || !timeStr) return; // if either is not set, do nothing
  // Combine into a naive Date string (treating as if in base zone)
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hours, minutes] = timeStr.split(":").map(Number);
  // We need to interpret this as baseZone local time. Compute the actual UTC time for it.
  const baseTz = baseZone.tz;
  // Create a Date object for the given time *as if UTC* then adjust by base offset:
  // We find base zone offset by testing around the given time.
  const baseLocal = { year, month, day, hours, minutes };
  let utcTimestamp = Date.UTC(year, month - 1, day, hours, minutes); // initial guess assuming input as UTC
  let dateUTC = new Date(utcTimestamp);
  // Check if formatting that date to base zone gives the intended time; if not, adjust offset
  let guessed = new Intl.DateTimeFormat('en-US', { timeZone: baseTz, 
               hour12: false, hour: 'numeric', minute: 'numeric', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(dateUTC);
  // Extract parts for comparison:
  function partsToObj(parts) {
    const obj = {};
    parts.forEach(p => { if(p.type!=='literal') obj[p.type] = p.value; });
    return obj;
  }
  let guessParts = partsToObj(guessed);
  const targetParts = { 
    year: String(year), month: String(month), day: String(day), 
    hour: String(hours), minute: String(minutes).padStart(2,'0') 
  };
  if (!(guessParts.year === targetParts.year && 
        guessParts.month === targetParts.month && 
        guessParts.day === targetParts.day && 
        guessParts.hour === String(hours) && 
        guessParts.minute === targetParts.minute)) {
    // If the guess was wrong, find the correct UTC time by brute force over possible offsets.
    // Try offsets from -12h to +14h in 15-minute increments.
    let found = null;
    for (let offsetMin = -720; offsetMin <= 840; offsetMin += 15) {
      const tryUTC = Date.UTC(year, month - 1, day, hours, minutes) - offsetMin * 60000;
      const tryDate = new Date(tryUTC);
      const tryParts = partsToObj(new Intl.DateTimeFormat('en-US', { timeZone: baseTz, 
                                hour12: false, hour: 'numeric', minute: 'numeric', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(tryDate));
      if (tryParts.year === targetParts.year && tryParts.month === targetParts.month &&
          tryParts.day === targetParts.day && tryParts.hour === String(hours) && tryParts.minute === targetParts.minute) {
        found = tryDate;
        break;
      }
    }
    if (found) {
      dateUTC = found;
    }
  }
  // Now dateUTC is the actual moment in time corresponding to the base local time.
  renderZoneList(dateUTC);
  updateShareLink(dateUTC);
}

// Update the URL query string to reflect current state (base time and zones)
function updateShareLink(refDate) {
  const iso = refDate.toISOString(); // e.g. "2025-08-21T13:00:00.000Z"
  // Convert to ISO with offset of base zone instead of 'Z':
  // Compute base zone offset at refDate:
  const baseOffsetMin = -refDate.getTimezoneOffset(); // offset of *user* zone, not base zone
  // We need base zone offset. Easiest: format refDate in base zone with short offset:
  let tzOffsetStr = "";
  try {
    // Use timeZoneName:"shortOffset" if supported
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: baseZone.tz, timeZoneName: 'shortOffset' });
    const tzName = fmt.formatToParts(refDate).find(p=>p.type==="timeZoneName").value; // e.g. "GMT+10"
    // Convert "GMT+10" or "GMT-7" to +10:00 format
    tzOffsetStr = tzName.replace('GMT', '');
    if (/^[+-]\d\d?$/.test(tzOffsetStr)) {
      tzOffsetStr = tzOffsetStr + ":00"; // add minutes if just hour
    }
  } catch {
    // Fallback if shortOffset not supported: derive from offset minutes (approximate)
    const offset = getOffsetForZone(refDate, baseZone.tz); // (we could implement similar brute force to find base zone offset)
    const sign = offset >= 0 ? "+" : "-";
    const absOff = Math.abs(offset);
    const offHr = String(Math.floor(absOff/60)).padStart(2,"0");
    const offMin = String(absOff % 60).padStart(2,"0");
    tzOffsetStr = sign + offHr + ":" + offMin;
  }
  // Compose time param in ISO format with offset
  const baseLocalIso = baseDateInput.value + "T" + baseTimeInput.value + tzOffsetStr;
  const zonesParam = selectedZones.map(z => encodeURIComponent(z.tz)).join(",");
  const params = new URLSearchParams();
  params.set("time", baseLocalIso);
  params.set("zones", zonesParam);
  // Use history API to avoid reloading page
  window.history.replaceState({}, "", `${location.pathname}?${params.toString()}`);
}

// On initial load, check if a shareable link is present (URL query params)
function loadFromURL() {
  const params = new URLSearchParams(window.location.search);
  const timeParam = params.get("time");
  const zonesParam = params.get("zones");
  if (timeParam && zonesParam) {
    // Parse time (letting Date parse the ISO string with offset if present)
    const refDate = new Date(timeParam);
    if (!isNaN(refDate)) {
      // Set base date/time inputs
      baseDateInput.value = refDate.toISOString().slice(0,10);
      baseTimeInput.value = refDate.toISOString().slice(11,16);
      // Load zones
      const zoneIDs = zonesParam.split(",");
      selectedZones = zoneIDs.map(zID => {
        // find name from our list or use the ID as name if not found
        const match = timeZones.find(opt => opt.tz === decodeURIComponent(zID));
        return match || { name: decodeURIComponent(zID).replace("_"," "), tz: decodeURIComponent(zID) };
      });
      // Ensure baseZone is the first in list
      baseZone = selectedZones[0];
      baseZoneSelect.value = baseZone.tz;
      // Render with this state
      renderZoneList(refDate);
    }
  }
}
loadFromURL();

// Event handlers
baseZoneSelect.addEventListener("change", () => {
  const newTz = baseZoneSelect.value;
  // Update baseZone to the corresponding object (keep name consistent)
  const found = timeZones.find(opt => opt.tz === newTz);
  baseZone = found || { name: newTz, tz: newTz };
  // Ensure baseZone is at index 0 in selectedZones
  // If it was already in list (moved from another position), just move it to front
  const existingIndex = selectedZones.findIndex(z => z.tz === newTz);
  if (existingIndex > -1) {
    const [removed] = selectedZones.splice(existingIndex, 1);
    selectedZones.unshift(removed);
  } else {
    // add new base to front
    selectedZones.unshift(baseZone);
  }
  // Remove any duplicate entries of the new base in the list if present
  selectedZones = selectedZones.filter((z, i) => i === 0 || z.tz !== baseZone.tz);
  // Update inputs or recalc times
  updateTimes();
});

baseDateInput.addEventListener("change", updateTimes);
baseTimeInput.addEventListener("change", updateTimes);
// (Use 'change' event for date/time inputs to update on selection; could also use 'input' for live update)

addZoneBtn.addEventListener("click", () => {
  const cityName = newZoneInput.value.trim();
  if (!cityName) return;
  // Find matching option
  const opt = timeZones.find(o => o.name.toLowerCase() === cityName.toLowerCase());
  if (opt && !selectedZones.find(z => z.tz === opt.tz)) {
    selectedZones.push({ name: opt.name, tz: opt.tz });
    newZoneInput.value = "";
    updateTimes();
  } else if (!opt) {
    alert("Please select a valid city or time zone from the list.");
  } else {
    alert("That location is already added.");
  }
});

// Remove zone by index
function removeZone(idx) {
  if (idx < selectedZones.length) {
    const removed = selectedZones.splice(idx, 1)[0];
    // If we removed the base zone (idx 0), make the next one base
    if (idx === 0) {
      baseZone = selectedZones[0];
      baseZoneSelect.value = baseZone.tz;
    }
    updateTimes();
  }
}

// Initialize with current date/time if not set
if (!baseDateInput.value) {
  const now = new Date();
  baseDateInput.value = now.toISOString().slice(0, 10);
  baseTimeInput.value = now.toTimeString().slice(0,5);
}
// Initial rendering
updateTimes();
