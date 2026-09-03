/**
 * app.js - ENSO Compound Events website runtime
 *
 * Pages handled (via data-page attribute on <body>):
 *   forecast            - probability bars, legend
 *   hindcast_explorer   - spaghetti plot, obs overlay
 *
 * Only index.html and hindcast_explorer.html load this file. The seasonal-maps
 * and IOD/XRO runtimes were removed on 2026-08-14 with the pages they served:
 * neither had a page, and IOD had no data files either, so 784 lines ran for
 * nobody. hindcast_skill.html carries its own inline script and never loads
 * app.js, which is why its dispatcher branch is left alone rather than trusted.
 */

const DATA_BASE = "data/";

// Monthly data-build cache-buster. Bump whenever the served data/*.json are
// regenerated (forecast, members, hindcast). Appended to every data fetch so a
// fresh forecast vintage is never masked by a stale browser/CDN copy.
const DATA_VERSION = "20260827f";
function _dv(url) {
  return url + (url.indexOf("?") === -1 ? "?" : "&") + "v=" + DATA_VERSION;
}

// ── Forecast source selector ─────────────────────────────────────────────────
// Multi-source support (Stage 9-10): SEAS5 (ECMWF) is the default. Other C3S
// centres (Meteo-France, NCEP, DWD, CMCC) and the XRO stochastic model each
// expose their own forecast_{source}.json / forecast_members_{source}.json.
// Override with ?source=<src> in the URL or the <select id="forecast-source">
// dropdown (populated dynamically from forecast_sources.json).
const _urlParams = new URLSearchParams(window.location.search);
let _forecastSource = _urlParams.get("source") || "seas5";

function _forecastPath(base) {
  // Map "forecast.json" → "forecast_<src>.json" (source-specific),
  //      "forecast_members.json" → "forecast_members_<src>.json".
  // SEAS5 keeps the legacy bare filenames for backward compat.
  if (_forecastSource === "seas5") return DATA_BASE + base;
  const stem = base.replace(".json", "");
  // Special-case XRO IOD which uses a different stem convention.
  if (_forecastSource === "xro_iod") {
    if (stem === "forecast") return DATA_BASE + "forecast_iod_xro.json";
    if (stem === "forecast_members") return DATA_BASE + "forecast_iod_members_xro.json";
  }
  if (_forecastSource === "xro") {
    return DATA_BASE + stem + "_xro.json";
  }
  // Generic C3S centre (mf9, ncep2, dwd21, cmcc35 etc.)
  return DATA_BASE + stem + "_" + _forecastSource + ".json";
}

function setForecastSource(src) {
  _forecastSource = src || "seas5";
  const url = new URL(window.location.href);
  url.searchParams.set("source", _forecastSource);
  window.history.replaceState({}, "", url);
  window.location.reload();
}

async function _populateSourceSelector() {
  const sel = document.getElementById("forecast-source");
  if (!sel) return;
  try {
    const manifest = await loadJSON("forecast_sources.json");
    sel.innerHTML = "";
    for (const s of (manifest?.sources || [])) {
      const opt = document.createElement("option");
      opt.value = s.source;
      opt.textContent = s.model + (s.calibrated ? " - calibrated" : "");
      sel.appendChild(opt);
    }
    sel.value = _forecastSource;
  } catch (_) {
    // Manifest missing → leave the static <option> list from index.html in place.
    sel.value = _forecastSource;
  }
}


// ── Multi-select source overlay infrastructure ────────────────────────────────
// User feedback (2026-04-21): the source selector should be a multi-select
// checkbox list (not a dropdown), sources overlay on one chart with
// colour+hover identifying the centre, and switching must not reload the
// page. State is synced to the URL as ?sources=seas5,mf9,ncep2 so views are
// shareable.

// Format a "YYYY-MM" string as "MonthName YYYY" for lead labels.
// Returns the input unchanged if parse fails.
const _MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
function _formatValidMonth(vt) {
  if (!vt || typeof vt !== "string") return String(vt || "");
  const m = vt.match(/^(\d{4})-(\d{2})/);
  if (!m) return vt;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  if (!month || month < 1 || month > 12) return vt;
  return `${_MONTH_NAMES[month]} ${year}`;
}

const CENTRE_COLOR = {
  seas5:   "#1f77b4",   // ECMWF - blue
  mf9:     "#d62728",   // Meteo-France - red
  ncep2:   "#2ca02c",   // NCEP - green
  dwd21:   "#ff7f0e",   // DWD - orange
  cmcc35:  "#9467bd",   // CMCC - purple
  ukmo604: "#8c564b",   // UK Met Office - brown
  jma3:    "#e377c2",   // JMA - pink
  eccc5:   "#7f7f7f",   // ECCC - grey
  bom2:    "#17becf",   // BOM - teal
  xro:     "#111111",   // XRO - black
  xro_iod: "#111111",   // XRO IOD - black
};

const CENTRE_SHORT = {
  seas5:   "SEAS5",
  mf9:     "MF9",
  ncep2:   "NCEP",
  dwd21:   "DWD",
  cmcc35:  "CMCC",
  ukmo604: "UKMO",
  jma3:    "JMA",
  eccc5:   "ECCC",
  bom2:    "BOM",
  xro:     "XRO",
  xro_iod: "XRO-IOD",
};

// Top nav: click-to-toggle dropdowns. The header menus were pure CSS :hover
// which is flaky on touch and can leave the menu half-open when the user
// clicks the parent tab. Now clicking a .nav-dropdown-toggle toggles an
// .open class on its parent .nav-dropdown, clicking outside the menu closes
// any open dropdown, and hover still works on desktop as before.
function _wireNavDropdowns() {
  const toggles = document.querySelectorAll(".nav-dropdown-toggle");
  if (!toggles.length) return;
  toggles.forEach(t => {
    t.addEventListener("click", e => {
      e.stopPropagation();
      const parent = t.closest(".nav-dropdown");
      if (!parent) return;
      const wasOpen = parent.classList.contains("open");
      // Close every other open dropdown first, then toggle this one
      document.querySelectorAll(".nav-dropdown.open").forEach(p => {
        if (p !== parent) p.classList.remove("open");
      });
      parent.classList.toggle("open", !wasOpen);
    });
  });
  // Click anywhere outside: close every open dropdown
  document.addEventListener("click", e => {
    if (e.target.closest(".nav-dropdown")) return;
    document.querySelectorAll(".nav-dropdown.open").forEach(p => p.classList.remove("open"));
  });
  // Escape: close open dropdowns and return focus
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      document.querySelectorAll(".nav-dropdown.open").forEach(p => p.classList.remove("open"));
    }
  });
}

// Chart.js legend onClick handler that toggles every dataset sharing the same
// `_centre` tag as the clicked legend entry. Used on plume charts so hiding
// a centre in the legend also hides its 30-51 member lines, not only the
// median. Datasets without a `_centre` fall back to the default toggle.
function _makeLegendCentreToggle() {
  return function(e, legendItem, legend) {
    const chart = legend.chart;
    const ds = chart.data.datasets[legendItem.datasetIndex];
    const centre = ds && ds._centre;
    if (!centre) {
      const meta = chart.getDatasetMeta(legendItem.datasetIndex);
      meta.hidden = meta.hidden === null ? !chart.data.datasets[legendItem.datasetIndex].hidden : null;
      chart.update();
      return;
    }
    // Toggle every dataset sharing this _centre
    const anyVisible = chart.data.datasets.some((d, i) => d._centre === centre && !chart.getDatasetMeta(i).hidden);
    chart.data.datasets.forEach((d, i) => {
      if (d._centre === centre) chart.getDatasetMeta(i).hidden = anyVisible;
    });
    chart.update();
  };
}

function _forecastPathForSource(source, base, kind = "enso") {
  // Resolve a data JSON path for an explicit source + base filename.
  // base is like "forecast.json" or "forecast_members.json".
  // kind is "enso" or "iod" - determines which filename convention to use
  // for C3S centres (forecast_{src}.json vs forecast_iod_{src}.json).
  if (kind === "iod") {
    if (source === "xro_iod") {
      if (base === "forecast.json")         return DATA_BASE + "forecast_iod_xro.json";
      if (base === "forecast_members.json") return DATA_BASE + "forecast_iod_members_xro.json";
    }
    if (base === "forecast.json")         return DATA_BASE + `forecast_iod_${source}.json`;
    if (base === "forecast_members.json") return DATA_BASE + `forecast_iod_members_${source}.json`;
    return DATA_BASE + base;
  }
  // ENSO:
  if (source === "seas5") return DATA_BASE + base;
  if (source === "xro") {
    const stem = base.replace(".json", "");
    return DATA_BASE + stem + "_xro.json";
  }
  const stem = base.replace(".json", "");
  return DATA_BASE + stem + "_" + source + ".json";
}

function _parseSourcesParam(paramName = "sources") {
  // Read selected sources from the URL (?sources=a,b,c). Returns array
  // (empty if unset - caller chooses default).
  const raw = (_urlParams.get(paramName) || "").trim();
  if (!raw) return [];
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

function _writeSourcesParam(sources, paramName = "sources") {
  const url = new URL(window.location.href);
  if (sources.length === 0) {
    url.searchParams.delete(paramName);
  } else {
    url.searchParams.set(paramName, sources.join(","));
  }
  window.history.replaceState({}, "", url);
}

async function _loadManifest(kind = "enso") {
  const f = {
    "iod":          "iod_sources.json",
    "enso":         "forecast_sources.json",
    "iod_hindcast": "iod_hindcast_sources.json",
    "enso_hindcast":"hindcast_sources.json",
  }[kind] || "forecast_sources.json";
  try {
    return await loadJSON(f);
  } catch (_) {
    return {sources: []};
  }
}

async function _loadForecastsForSources(sources, kind = "enso") {
  // Load forecast.json (probability bars) for each selected source.
  // Returns {source: forecastJSON or null}.
  const entries = await Promise.all(sources.map(async src => {
    try {
      const j = await loadJSON(_forecastPathForSource(src, "forecast.json", kind));
      return [src, j];
    } catch (_) {
      return [src, null];
    }
  }));
  const out = {};
  for (const [src, j] of entries) out[src] = j;
  return out;
}

function _renderMultiSourceSelector(containerId, manifest, selected, onChange) {
  // containerId: element id to render into
  // manifest: {sources:[{source, model, ...}]}
  // selected: Set<string>
  // onChange: callback(Set<string>) when user toggles a checkbox
  const el = document.getElementById(containerId);
  if (!el) return;
  const rows = (manifest.sources || []).map(s => {
    const checked = selected.has(s.source) ? "checked" : "";
    const colour = CENTRE_COLOR[s.source] || "#888";
    const vintage = s.latest_vintage ? ` <span style="color:var(--text-muted);font-size:0.75rem">(${s.latest_vintage})</span>` : "";
    return `<label class="centre-checkbox" style="display:inline-flex;align-items:center;gap:0.35rem;padding:0.2rem 0.55rem;margin:0.15rem;border-radius:4px;cursor:pointer;font-size:0.82rem;border:1px solid var(--border)">` +
           `<input type="checkbox" value="${s.source}" ${checked} style="accent-color:${colour}">` +
           `<span style="display:inline-block;width:10px;height:10px;background:${colour};border-radius:2px"></span>` +
           `<span>${s.model}</span>${vintage}` +
           `</label>`;
  }).join("");
  el.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:0.25rem;align-items:center">${rows}</div>`;
  el.querySelectorAll("input[type=checkbox]").forEach(cb => {
    cb.addEventListener("change", () => {
      const now = new Set();
      el.querySelectorAll("input[type=checkbox]:checked").forEach(c => now.add(c.value));
      onChange(now);
    });
  });
}

// ── Shared constants ──────────────────────────────────────────────────────────

// Keep CLASS_COLOR as alias for backwards compat with CSS classes
const CLASS_COLOR = {
  extreme_la_nina:  "ln-extreme",
  strong_la_nina:   "ln-strong",
  moderate_la_nina: "ln-moderate",
  neutral:          "neutral",
  moderate_el_nino: "en-moderate",
  strong_el_nino:   "en-strong",
  extreme_el_nino:  "en-extreme",
};
const CLASS_CSS = CLASS_COLOR;  // alias

const CLASS_LABEL = {
  extreme_la_nina:  "Ext La Niña",
  strong_la_nina:   "Str La Niña",
  moderate_la_nina: "Mod La Niña",
  neutral:          "Neutral",
  moderate_el_nino: "Mod El Niño",
  strong_el_nino:   "Str El Niño",
  extreme_el_nino:  "Ext El Niño",
};

const CESM_PRODUCT_LABEL = {
  "rx1day_absolute_patterns":  "RX1day Absolute (mm/day)",
  "rx1day_anomaly_patterns":   "RX1day Anomaly vs Neutral",
  "rx10day_absolute_patterns": "Rx10day Absolute (mm)",
  "rx10day_anomaly_patterns":  "Rx10day Anomaly vs Neutral",
  "rx1daydry_absolute_patterns": "RX1DAYDRY Absolute (lower = drier)",
  "rx1daydry_anomaly_patterns": "RX1DAYDRY Anomaly vs Neutral",
  "rx10daydry_absolute_patterns": "RX10DAYDRY Absolute (lower = drier)",
  "rx10daydry_anomaly_patterns": "RX10DAYDRY Anomaly vs Neutral",
  "probability_ratio":         "RX1DAY Wet Probability (P90 exceedance)",
  "probability_ratio_rx10day": "RX10DAY Wet Probability (P90 exceedance)",
  "probability_ratio_rx1daydry":  "RX1DAYDRY Probability (P10 lower-tail)",
  "probability_ratio_rx10daydry": "RX10DAYDRY Probability (P10 lower-tail)",
};

const OBS_PRODUCT_LABEL = {
  "rx1day_anomaly":      "RX1day Anomaly vs Neutral",
  "rx1day_absolute":     "RX1day Absolute (mm/day)",
  "rx10day_anomaly":     "Rx10day Anomaly vs Neutral",
  "rx10day_absolute":    "Rx10day Absolute (mm)",
  "rx1daydry_anomaly":   "RX1DAYDRY Anomaly vs Neutral",
  "rx1daydry_absolute":  "RX1DAYDRY Absolute (lower = drier)",
  "rx10daydry_anomaly":  "RX10DAYDRY Anomaly vs Neutral",
  "rx10daydry_absolute": "RX10DAYDRY Absolute (lower = drier)",
  "rx1day":  "RX1day",
  "rx10day": "Rx10day",
};

const CESM_PER_PHASE_PRODUCT_LABEL = {
  "rx1day_anomaly":   "RX1day Anomaly vs Neutral",
  "rx1day_absolute":  "RX1day Absolute (mm/day)",
  "rx10day_anomaly":  "Rx10day Anomaly vs Neutral",
  "rx10day_absolute": "Rx10day Absolute (mm)",
  "rx1daydry_anomaly": "RX1DAYDRY Anomaly vs Neutral",
  "rx1daydry_absolute": "RX1DAYDRY Absolute (lower = drier)",
  "rx10daydry_anomaly": "RX10DAYDRY Anomaly vs Neutral",
  "rx10daydry_absolute": "RX10DAYDRY Absolute (lower = drier)",
  "probability_ratio_rx1day_wet": "RX1DAY Wet Probability (P90 exceedance)",
  "probability_ratio_rx10day_wet": "RX10DAY Wet Probability (P90 exceedance)",
  "probability_ratio_rx1daydry": "RX1DAYDRY Probability (P10 lower-tail)",
  "probability_ratio_rx10daydry": "RX10DAYDRY Probability (P10 lower-tail)",
};

const CLASSES_ORDERED = [
  "extreme_la_nina", "strong_la_nina", "moderate_la_nina",
  "neutral",
  "moderate_el_nino", "strong_el_nino", "extreme_el_nino",
];

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const VAR_META = {
  nino34_std: {
    label: "Niño 3.4 SST (sigma)",
    axis: "Niño 3.4 SST (sigma)",
  },
  nino3_std: {
    label: "Niño 3 SST (sigma)",
    axis: "Niño 3 SST (sigma)",
  },
  nino4_std: {
    label: "Niño 4 SST (sigma)",
    axis: "Niño 4 SST (sigma)",
  },
  nino3_pr_anom: {
    label: "Niño 3 Precip Anomaly (mm/day)",
    axis: "Niño 3 precip anomaly (mm/day)",
  },
};

function varLabel(varName) {
  return VAR_META[varName]?.label || varName.replace(/_/g, " ");
}

function varAxisLabel(varName) {
  return VAR_META[varName]?.axis || varName.replace(/_/g, " ");
}

// Read a CSS variable from :root
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const PHASE_COLORS = {
  extreme_la_nina:  () => cssVar("--ln-extreme")  || "#0D47A1",
  strong_la_nina:   () => cssVar("--ln-strong")   || "#1565C0",
  moderate_la_nina: () => cssVar("--ln-moderate") || "#42A5F5",
  neutral:          () => cssVar("--neutral")     || "#78909C",
  moderate_el_nino: () => cssVar("--en-moderate") || "#FFA726",
  strong_el_nino:   () => cssVar("--en-strong")   || "#E64A19",
  extreme_el_nino:  () => cssVar("--en-extreme")  || "#B71C1C",
};

// ── Utilities ─────────────────────────────────────────────────────────────────

// The per-init hindcast series is 108 MB in 72 files, read only by the hindcast
// explorer and by nothing on first paint, so it lives in the tile bucket rather
// than on the page host. Everything else app.js loads is small, needed
// immediately, and stays on this origin: if the bucket is unreachable the page
// degrades to "no hindcast" instead of not rendering.
//
// data_base.js defines the base and must load before this file. If it has not,
// the path stays relative and the fetch simply goes to the page origin, which is
// where these files used to be: no base means no rebasing, never a broken URL.
const HX_HEAVY = /^hindcast\//;

function _dataURL(path) {
  // Idempotent on purpose. Some callers hand loadJSON a bare name and some hand
  // it a path _forecastPath already prefixed with DATA_BASE, and prefixing that
  // a second time produced data/data/forecast.json: a 404 on the front page's
  // main fetch, which still rendered because a later fetch filled the panel.
  // Normalising here fixes every caller at once, including any not spotted.
  if (/^https?:\/\//.test(path)) return path;
  const rel = path.startsWith(DATA_BASE) ? path.slice(DATA_BASE.length) : path;
  const base = (typeof window !== "undefined" && window.ENSOSCOPE_DATA_BASE) || "";
  if (base && HX_HEAVY.test(rel)) {
    return `${base.replace(/\/$/, "")}/data/${rel}`;
  }
  return DATA_BASE + rel;
}

async function loadJSON(path) {
  // Bucket files are immutable for the life of a deploy and carry a version in
  // the URL, so they are fetched with normal HTTP caching: no-store on those
  // would re-download 1.5 MB per file on every revisit, and reads are the thing
  // that actually costs on object storage. Page-origin JSON stays no-store so a
  // fresh forecast vintage is never masked by a stale copy.
  const rel = path.startsWith(DATA_BASE) ? path.slice(DATA_BASE.length) : path;
  const heavy = HX_HEAVY.test(rel) && !!(typeof window !== "undefined" && window.ENSOSCOPE_DATA_BASE);
  const res = await fetch(_dv(_dataURL(path)), heavy ? {} : { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path} (HTTP ${res.status})`);
  return res.json();
}

function pct(v) { return (v * 100).toFixed(1) + "%"; }
function round2(v) { return Math.round(v * 100) / 100; }

function parseYearMonth(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ""));
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null;
  }
  return { year, month };
}

function monthLag(referenceYM, targetYM) {
  const ref = parseYearMonth(referenceYM);
  const tgt = parseYearMonth(targetYM);
  if (!ref || !tgt) return null;
  return (ref.year * 12 + ref.month) - (tgt.year * 12 + tgt.month);
}

function compareYearMonth(a, b) {
  const ay = parseYearMonth(a);
  const by = parseYearMonth(b);
  if (!ay || !by) return 0;
  const av = ay.year * 12 + ay.month;
  const bv = by.year * 12 + by.month;
  return av - bv;
}

function currentYearMonthUTC() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function shiftYearMonth(ym, deltaMonths) {
  const parsed = parseYearMonth(ym);
  if (!parsed) return null;
  const total = parsed.year * 12 + (parsed.month - 1) + deltaMonths;
  if (!Number.isFinite(total) || total < 0) return null;
  const outYear = Math.floor(total / 12);
  const outMonth = (total % 12) + 1;
  return `${String(outYear).padStart(4, "0")}-${String(outMonth).padStart(2, "0")}`;
}

function forecastStaleBadgeHTML(forecast) {
  let lag = null;
  if (Number.isFinite(forecast?.stale_months_lag)) {
    lag = Number(forecast.stale_months_lag);
  } else {
    lag = monthLag(currentYearMonthUTC(), forecast?.vintage);
  }
  // Lag 0-1 is considered operationally current (e.g., latest month not yet posted).
  if (lag === null || lag <= 1) return "";
  const title =
    `Latest available forecast (${forecast?.vintage || "unknown"}) is ` +
    `${lag} month${lag === 1 ? "" : "s"} behind current UTC month. ` +
    `Run monthly SEAS5 forecast refresh.`;
  return `<span class="warn-badge" title="${title}">⚠ ${lag} months behind</span>`;
}

// ── Forecast page ─────────────────────────────────────────────────────────────

let _latestForecastMembers = null;
let _latestForecastVintage = null;

function _setObsMethodNote(varName) {
  const methodEl = document.getElementById("forecast-latest-obs-method");
  if (!methodEl) return;
  const method = _obsData?.method || {};
  const summary = method.summary || "Observed index methodology unavailable.";
  const detail = method[varName] || "";
  methodEl.textContent = detail ? `${summary} ${detail}` : summary;
}

async function initForecastLatestPlume(forecast) {
  const cardEl = document.getElementById("forecast-latest-card");
  if (!cardEl) return;

  const titleEl = document.getElementById("forecast-latest-chart-title");
  const vintageEl = document.getElementById("forecast-latest-vintage");

  let fcData = null;
  try {
    fcData = await loadJSON(_forecastPath("forecast_members.json"));
  } catch (_) {
    fcData = null;
  }

  _obsData = await _ensureObsData();

  const availableVintages = fcData?.vintages || [];
  const fallbackVintage = availableVintages.length
    ? availableVintages[availableVintages.length - 1]
    : null;
  _latestForecastVintage = forecast?.vintage || fallbackVintage;

  if (!_latestForecastVintage || !fcData?.by_start?.[_latestForecastVintage]) {
    if (titleEl) {
      const availableNow = (_forecastSource === "seas5" || _forecastSource === "xro" || _forecastSource === "xro_iod");
      titleEl.textContent = availableNow
        ? "Latest forecast plume data not available"
        : `Ensemble plume view not yet available for ${_forecastSource.toUpperCase()} - switch to SEAS5 or XRO for plume; ${_forecastSource.toUpperCase()} probability bars above remain valid.`;
    }
    return;
  }

  _latestForecastMembers = fcData.by_start[_latestForecastVintage];
  if (vintageEl) vintageEl.textContent = _latestForecastVintage;

  const phaseLegEl = document.getElementById("fc-phase-legend");
  if (phaseLegEl) {
    phaseLegEl.innerHTML = CLASSES_ORDERED.map(cls =>
      `<div class="prob-legend-item"><div class="prob-legend-swatch ${CLASS_COLOR[cls]}"></div><span>${CLASS_LABEL[cls]}</span></div>`
    ).join("");
  }

  const defaultVar = document.getElementById("forecast-latest-variable")?.value || "nino34_std";
  _setObsMethodNote(defaultVar);

  await updateForecastLatestChart();
}

window.updateForecastLatestChart = async function() {
  const varName = document.getElementById("forecast-latest-variable")?.value || "nino34_std";
  const titleEl = document.getElementById("forecast-latest-chart-title");
  _setObsMethodNote(varName);

  if (!_latestForecastMembers || !_latestForecastVintage) {
    if (titleEl) titleEl.textContent = "Latest forecast plume data not available";
    return;
  }

  const obsLookup = {};
  if (_obsData) _obsData.times.forEach((t, i) => { obsLookup[t] = _obsData[varName]?.[i] ?? null; });

  const { datasets, labels } = _buildSpaghettiDatasets(_latestForecastMembers, varName, obsLookup);
  if (titleEl) {
    titleEl.textContent =
      `${_latestForecastVintage} Forecast Plumes - ${varLabel(varName)} - ${Object.keys(_latestForecastMembers).length} members`;
  }

  _drawChart("forecast-latest-chart", datasets, labels, varName);
  _renderSpreadStats(
    _buildSpreadStats(_latestForecastMembers, varName),
    "forecast-latest-spread-content",
    "forecast-latest-spread-card"
  );
};

// ── Current status banner ─────────────────────────────────────────────────────

const PHASE_CHIP_COLOR = {
  extreme_la_nina:  "#0D47A1",
  strong_la_nina:   "#1565C0",
  moderate_la_nina: "#42A5F5",
  neutral:          "#78909C",
  moderate_el_nino: "#F57C00",
  strong_el_nino:   "#E64A19",
  extreme_el_nino:  "#B71C1C",
};

function _phaseFamily(phase) {
  if (!phase) return "neutral";
  if (phase.includes("la_nina")) return "ln";
  if (phase.includes("el_nino")) return "en";
  return "neu";
}

function _dominantPhase(lead) {
  const classes = [
    "extreme_la_nina","strong_la_nina","moderate_la_nina","neutral",
    "moderate_el_nino","strong_el_nino","extreme_el_nino",
  ];
  // Hierarchical: dominant family first, then intensity within family
  const pLN = (lead.extreme_la_nina||0) + (lead.strong_la_nina||0) + (lead.moderate_la_nina||0);
  const pEN = (lead.moderate_el_nino||0) + (lead.strong_el_nino||0) + (lead.extreme_el_nino||0);
  const pNeu = lead.neutral || 0;
  let family;
  if (pLN >= pEN && pLN >= pNeu) family = ["extreme_la_nina","strong_la_nina","moderate_la_nina"];
  else if (pEN >= pLN && pEN >= pNeu) family = ["moderate_el_nino","strong_el_nino","extreme_el_nino"];
  else family = ["neutral"];
  // Best intensity within family
  return family.reduce((best, c) => (lead[c]||0) > (lead[best]||0) ? c : best, family[0]);
}

function _buildStatusBanner(forecast) {
  const section = document.getElementById("current-status-section");
  const cardsEl = document.getElementById("status-cards");
  const tbody   = document.getElementById("status-lead-tbody");
  if (!section || !cardsEl || !tbody || !forecast?.leads?.length) return;

  const leads = forecast.leads;

  // Medium-range signal: use leads 3-6 (or all available if fewer than 3)
  const medLeads = leads.filter(l => l.lead >= 3);
  const signalLeads = medLeads.length >= 2 ? medLeads : leads;

  // Aggregate phase-family probabilities across signal leads (simple average)
  let sumLN = 0, sumEN = 0, sumNeu = 0;
  for (const l of signalLeads) {
    sumLN  += (l.extreme_la_nina||0)+(l.strong_la_nina||0)+(l.moderate_la_nina||0);
    sumEN  += (l.moderate_el_nino||0)+(l.strong_el_nino||0)+(l.extreme_el_nino||0);
    sumNeu += (l.neutral||0);
  }
  const n = signalLeads.length;
  const avgLN = sumLN/n, avgEN = sumEN/n, avgNeu = sumNeu/n;

  // Dominant phase family across signal leads
  const domFamily = avgLN >= avgEN && avgLN >= avgNeu ? "ln"
                  : avgEN >= avgLN && avgEN >= avgNeu ? "en"
                  : "neu";
  const domFamilyLabel = { ln: "La Niña", en: "El Niño", neu: "Neutral" }[domFamily];
  const domFamilyProb  = { ln: avgLN, en: avgEN, neu: avgNeu }[domFamily];

  // Most likely intensity within dominant family (averaged across signal leads)
  const intensityClasses = {
    ln:  ["extreme_la_nina","strong_la_nina","moderate_la_nina"],
    en:  ["extreme_el_nino","strong_el_nino","moderate_el_nino"],
    neu: ["neutral"],
  }[domFamily];

  const avgByClass = {};
  for (const c of intensityClasses) {
    avgByClass[c] = signalLeads.reduce((s, l) => s + (l[c]||0), 0) / n;
  }
  const domIntensity = intensityClasses.reduce((best, c) => avgByClass[c] > avgByClass[best] ? c : best, intensityClasses[0]);
  const domIntensityProb = avgByClass[domIntensity];

  // Lead range label
  const leadMin = signalLeads[0].lead, leadMax = signalLeads[signalLeads.length-1].lead;
  const validMin = signalLeads[0].valid_time, validMax = signalLeads[signalLeads.length-1].valid_time;
  const leadRangeLabel = leadMin === leadMax ? `L${leadMin}` : `L${leadMin}-L${leadMax}`;
  const validRangeLabel = validMin === validMax ? validMin : `${validMin} - ${validMax}`;

  // Map explorer link for the dominant phase (pick a good season from valid months)
  const midLead = signalLeads[Math.floor(signalLeads.length/2)];
  const midMonth = parseInt((midLead.valid_time || "").split("-")[1] || "6", 10);
  const seasonMap = { 12:1,1:1,2:1, 3:2,4:2,5:2, 6:3,7:3,8:3, 9:4,10:4,11:4 };
  const seasonVal  = ["djf","mam","jja","son"][seasonMap[midMonth]-1] || "djf";
  const phaseMap = { ln:"moderate_la_nina", en:"moderate_el_nino", neu:"neutral" };
  const mapPhase = phaseMap[domFamily];
  const mapVarDefault = domFamily === "neu" ? "rx10day_absolute" : "rx10day_anomaly";
  const mapUrl = `map_explorer.html?source=obs&season=${seasonVal}&phase=${mapPhase}&variable=${mapVarDefault}`;

  // Card 1: dominant phase family (medium-range)
  const card1 = `
    <div class="status-card phase-${domFamily}">
      <div class="status-card-label">Most likely phase · ${leadRangeLabel}</div>
      <div class="status-card-value">${domFamilyLabel}</div>
      <div class="status-card-sub">${pct(domFamilyProb)} avg probability · ${validRangeLabel}</div>
    </div>`;

  // Card 2: most likely intensity
  const card2 = `
    <div class="status-card phase-${domFamily}">
      <div class="status-card-label">Most likely intensity · ${leadRangeLabel}</div>
      <div class="status-card-value">${CLASS_LABEL[domIntensity] || domIntensity}</div>
      <div class="status-card-sub">${pct(domIntensityProb)} avg probability · ${validRangeLabel}</div>
    </div>`;

  // Card 3: phase family split (avg across signal leads)
  const card3 = `
    <div class="status-card phase-${domFamily}">
      <div class="status-card-label">Phase balance · ${leadRangeLabel}</div>
      <div class="status-card-value">${domFamilyLabel} favoured</div>
      <div class="status-card-sub">LN ${pct(avgLN)} · Neu ${pct(avgNeu)} · EN ${pct(avgEN)}</div>
    </div>`;

  // Card 4: CTA → map explorer
  const card4 = `
    <div class="status-card" style="border-left:4px solid #1565C0;justify-content:space-between">
      <div>
        <div class="status-card-label">Explore rainfall patterns</div>
        <div class="status-card-value" style="font-size:0.95rem">What could this mean for rainfall?</div>
        <div class="status-card-sub">
          If ${CLASS_LABEL[domIntensity]||domFamilyLabel} conditions develop, explore the expected
          rainfall anomalies and drought signals by region.
        </div>
      </div>
      <a href="${mapUrl}" style="
        display:inline-block;margin-top:0.6rem;padding:0.4rem 1rem;
        background:#1565C0;color:#fff;border-radius:5px;
        font-size:0.82rem;font-weight:600;text-decoration:none;
        white-space:nowrap;align-self:flex-start">
        Open Map Explorer →
      </a>
    </div>`;

  cardsEl.innerHTML = card1 + card2 + card3 + card4;

  // Lead table rows
  let rows = "";
  for (const lead of leads) {
    const phase = _dominantPhase(lead);
    const prob  = lead[phase] || 0;
    const color = PHASE_CHIP_COLOR[phase] || "#78909C";
    const chip  = `<span class="status-phase-chip" style="background:${color}">${CLASS_LABEL[phase]||phase}</span>`;
    const isSignal = lead.lead >= 3;

    const segments = CLASSES_ORDERED.map(c => {
      const p = lead[c] || 0;
      return `<div style="flex:${Math.max(p,0.001)};background:${PHASE_CHIP_COLOR[c]||'#ccc'}"></div>`;
    }).join("");
    const bar = `<div class="status-mini-bar">${segments}</div>`;

    rows += `<tr${isSignal ? ' style="background:#fafbff"' : ''}>
      <td><strong>L${lead.lead} - ${_formatValidMonth(lead.valid_time)}</strong></td>
      <td>${lead.valid_time}</td>
      <td>${chip}</td>
      <td>${pct(prob)}</td>
      <td>${bar}</td>
    </tr>`;
  }
  tbody.innerHTML = rows;
  section.style.display = "";
}

// ── Legacy single-source forecast (kept as fallback) ─────────────────────────
// The active path is now _initForecastPageMulti() which overlays multiple
// centres. This single-source function stays here for any future code path
// that needs it.

function _renderForecastBarsSingle(container, forecast) {
  const classes = forecast.classes_ordered || CLASSES_ORDERED;
  let html =
    `<div class="prob-legend" style="margin-bottom:1rem">` +
    classes.map(cls =>
      `<div class="prob-legend-item">` +
      `<div class="prob-legend-swatch ${CLASS_COLOR[cls]}"></div>` +
      `<span>${CLASS_LABEL[cls]}</span>` +
      `</div>`
    ).join("") +
    `</div>`;

  html +=
    `<table class="forecast-table"><thead><tr>` +
    `<th>Lead</th><th>Valid Month</th>` +
    `<th style="min-width:400px">Probability Distribution</th>` +
    `</tr></thead><tbody>`;

  for (const row of forecast.leads) {
    const bars = classes.map(cls => {
      const p     = row[cls] || 0;
      const label = p >= 0.07 ? pct(p) : "";
      return `<div class="prob-seg ${CLASS_COLOR[cls]}" style="flex:${p}" ` +
             `title="${CLASS_LABEL[cls]}: ${pct(p)}">${label}</div>`;
    }).join("");
    html +=
      `<tr><td><strong>L${row.lead}</strong></td>` +
      `<td>${_formatValidMonth(row.valid_time)}</td>` +
      `<td><div class="prob-bar-row">${bars}</div></td></tr>`;
  }
  html += `</tbody></table>`;
  container.innerHTML = html;
}

// ── Multi-source ENSO forecast page ──────────────────────────────────────────

async function initForecastPage() {
  const container = document.getElementById("forecast-container");
  const metaEl    = document.getElementById("forecast-meta");
  const selectorContainerId = "forecast-multi-selector";

  // Ensure a multi-selector container exists above the probability table.
  // Old single <select> is left in place for backwards compat; hide it.
  const oldSel = document.getElementById("forecast-source");
  if (oldSel) {
    oldSel.parentElement.style.display = "none";
  }
  let selEl = document.getElementById(selectorContainerId);
  if (!selEl) {
    selEl = document.createElement("div");
    selEl.id = selectorContainerId;
    selEl.className = "card";
    selEl.style.cssText = "margin-bottom:1rem;padding:0.7rem 1.2rem";
    selEl.innerHTML =
      `<div style="font-weight:600;margin-bottom:0.5rem">` +
      `Centres (check to overlay; URL updates for sharing):</div>` +
      `<div id="forecast-multi-selector-body">Loading centres…</div>`;
    container.parentElement.insertBefore(selEl, container);
  }

  // Load manifest + default selection.
  const manifest = await _loadManifest("enso");
  if (!manifest.sources || manifest.sources.length === 0) {
    container.innerHTML = `<p style="color:#c62828">No ENSO forecast sources available.</p>`;
    return;
  }
  const allSources = manifest.sources.map(s => s.source);
  const fromUrl = _parseSourcesParam("sources");
  let selected = new Set(fromUrl.length ? fromUrl.filter(s => allSources.includes(s)) : allSources);
  if (selected.size === 0) selected = new Set([manifest.default_enso || allSources[0]]);

  async function rerender() {
    _writeSourcesParam([...selected]);
    const fcs = await _loadForecastsForSources([...selected], "enso");
    renderOutlookBanner(fcs, [...selected]);
    _renderMultiForecastBars(container, fcs, [...selected]);
    _renderMultiForecastMeta(metaEl, fcs, [...selected]);
    _renderMultiForecastPlume(fcs, [...selected]);
  }

  _renderMultiSourceSelector("forecast-multi-selector-body", manifest, selected, async (newSel) => {
    selected = newSel;
    await rerender();
  });

  await rerender();
}

// Plain-language outlook headline derived from the live forecast, across every
// selected centre (e.g. SEAS5 + Météo-France). Says which phase/intensity is
// favoured and by when, reports whether the centres agree, and links into the
// teleconnection maps preset to that phase. Generic over EN / LN / neutral.
function renderOutlookBanner(forecasts, sources) {
  const el = document.getElementById("outlook-banner");
  if (!el) return;
  const srcs = (sources || []).filter(s =>
    forecasts && forecasts[s] && Array.isArray(forecasts[s].leads) && forecasts[s].leads.length);
  if (!srcs.length) { el.style.display = "none"; return; }
  srcs.sort((a, b) => (a === "seas5" ? -1 : b === "seas5" ? 1 : 0));  // SEAS5 first

  const FAM = {
    en: ["moderate_el_nino", "strong_el_nino", "extreme_el_nino"],
    ln: ["moderate_la_nina", "strong_la_nina", "extreme_la_nina"],
    neu: ["neutral"],
  };
  const INTLABEL = {
    moderate_el_nino: "moderate", strong_el_nino: "strong", extreme_el_nino: "extreme",
    moderate_la_nina: "moderate", strong_la_nina: "strong", extreme_la_nina: "extreme", neutral: "neutral",
  };
  const FAMLABEL = { en: "El Niño", ln: "La Niña", neu: "ENSO-neutral conditions" };
  const ACCENT = { en: "#C0392B", ln: "#1565C0", neu: "#546E7A" };
  const TINT = { en: "#FBEEEB", ln: "#EAF1FB", neu: "#ECEFF1" };
  const FRIENDLY = { seas5: "SEAS5", mf9: "Météo-France", ncep2: "NCEP" };
  const nameOf = s => FRIENDLY[s] || CENTRE_SHORT[s] || s;
  const coarseWhen = vt => {
    const p = (vt || "").split("-"); const m = parseInt(p[1] || "0", 10);
    return `${m <= 4 ? "early" : m <= 8 ? "mid" : "late"} ${p[0]}`;
  };

  function analyse(f) {
    const leads = f.leads.slice().sort((a, b) => a.lead - b.lead);
    const med = leads.filter(l => l.lead >= 3);
    const sig = med.length >= 2 ? med : leads;
    const famProb = (l, fam) => FAM[fam].reduce((s, c) => s + (l[c] || 0), 0);
    const avgFam = fam => sig.reduce((s, l) => s + famProb(l, fam), 0) / sig.length;
    const dom = [["en", avgFam("en")], ["ln", avgFam("ln")], ["neu", avgFam("neu")]]
      .sort((a, b) => b[1] - a[1])[0][0];
    const INT = FAM[dom];
    const modalIntAt = l => INT.reduce((b, c) => (l[c] || 0) > (l[b] || 0) ? c : b, INT[0]);
    const nearInt = modalIntAt(leads[0]);
    let peakRank = -1, peakInt = INT[0], peakMonth = leads[0].valid_time;
    for (const l of leads) {
      const c = modalIntAt(l), r = INT.indexOf(c);
      if (r > peakRank) { peakRank = r; peakInt = c; peakMonth = l.valid_time; }
    }
    const sp = dom === "en" ? ["strong_el_nino", "extreme_el_nino"]
             : dom === "ln" ? ["strong_la_nina", "extreme_la_nina"] : ["neutral"];
    const meanSP = sig.reduce((s, l) => s + sp.reduce((a, c) => a + (l[c] || 0), 0), 0) / sig.length;
    return { dom, INT, nearInt, peakInt, peakMonth, meanSP, vintage: f.vintage, lastMonth: leads[leads.length - 1].valid_time };
  }

  const A = srcs.map(s => Object.assign({ src: s }, analyse(forecasts[s])));
  const primary = A[0];
  const dom = primary.dom;
  const agree = A.every(a => a.dom === dom);
  const rankOf = c => primary.INT.indexOf(c);

  // Consensus intensities (meaningful when the centres agree on the family).
  let nearInt = primary.nearInt, peakInt = primary.peakInt, peakWhenMonth = primary.peakMonth;
  if (agree) {
    nearInt = A.reduce((acc, a) => rankOf(a.nearInt) < rankOf(acc) ? a.nearInt : acc, primary.nearInt);
    peakInt = A.reduce((acc, a) => rankOf(a.peakInt) > rankOf(acc) ? a.peakInt : acc, primary.peakInt);
    const reaching = A.filter(a => a.peakInt === peakInt).map(a => a.peakMonth).sort();
    peakWhenMonth = reaching[reaching.length - 1] || primary.peakMonth;
  }

  const lastMonth = _formatValidMonth(primary.lastMonth);
  const whenStr = A.length === 1 ? _formatValidMonth(peakWhenMonth) : coarseWhen(peakWhenMonth);
  let headline;
  if (dom === "neu") {
    headline = `Current outlook: ENSO-neutral conditions are favoured through ${lastMonth}.`;
  } else if (rankOf(peakInt) > rankOf(nearInt)) {
    headline = `Current outlook: a ${INTLABEL[nearInt]} ${FAMLABEL[dom]} now, strengthening toward ${INTLABEL[peakInt]} by ${whenStr}.`;
  } else {
    headline = `Current outlook: a ${INTLABEL[peakInt]} ${FAMLABEL[dom]} is favoured through ${lastMonth}.`;
  }

  const ctaPhase = dom === "en" ? "strong_el_nino" : dom === "ln" ? "strong_la_nina" : "neutral";
  const ctaUrl = `map_explorer.html?source=obs&season=djf&phase=${ctaPhase}&variable=rx10day_anomaly`;

  const names = A.map(a => nameOf(a.src));
  const namesText = names.length === 1 ? names[0]
    : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  const systemWord = A.length >= 3 ? "all systems" : "both systems";
  const vintage = _formatValidMonth(primary.vintage);

  let sub;
  if (dom === "neu") {
    sub = `${namesText}, issued ${vintage}. Full distributions and skill below.`;
  } else if (A.length === 1) {
    const spTxt = primary.meanSP >= 0.995 ? `Every ${names[0]} ensemble member is`
                                          : `${Math.round(primary.meanSP * 100)}% of ${names[0]} ensemble members are`;
    sub = `${spTxt} in the strong-or-extreme ${FAMLABEL[dom]} range across the 3-6 month outlook (issued ${vintage}) - that lead time is the window for anticipatory action.`;
  } else if (agree && A.every(a => a.meanSP >= 0.995)) {
    sub = `${namesText} agree: every ensemble member in ${systemWord} is in the strong-or-extreme ${FAMLABEL[dom]} range across the 3-6 month outlook (issued ${vintage}) - that lead time is the window for anticipatory action.`;
  } else if (agree) {
    const shares = A.map(a => `${Math.round(a.meanSP * 100)}% (${nameOf(a.src)})`).join(" and ");
    sub = `${namesText} agree on ${FAMLABEL[dom]}; the strong-or-extreme share over the 3-6 month outlook is ${shares}, issued ${vintage} - that lead time is the window for anticipatory action.`;
  } else {
    sub = `${names[0]} favours a ${INTLABEL[primary.peakInt]} ${FAMLABEL[primary.dom]} over the 3-6 month outlook (issued ${vintage}); the centres differ on phase - compare them below.`;
  }

  el.style.display = "block";
  el.innerHTML =
    `<div style="border-left:5px solid ${ACCENT[dom]};background:${TINT[dom]};border-radius:8px;padding:1rem 1.2rem;margin-bottom:1.4rem">` +
      `<div style="font-size:1.18rem;font-weight:700;color:#14202b;line-height:1.32">${headline}</div>` +
      `<div style="font-size:0.9rem;color:#3b4754;margin-top:0.4rem">${sub}</div>` +
      `<a href="${ctaUrl}" style="display:inline-block;margin-top:0.85rem;padding:0.45rem 1rem;background:${ACCENT[dom]};color:#fff;border-radius:6px;font-size:0.86rem;font-weight:600;text-decoration:none">See what this means for rainfall, drought and heat &rarr;</a>` +
    `</div>`;
}

function _renderMultiForecastMeta(metaEl, forecasts, sources) {
  if (!metaEl) return;
  const parts = sources.map(src => {
    const f = forecasts[src];
    if (!f) return `<span style="color:#c62828">${CENTRE_SHORT[src] || src}: missing</span>`;
    return `<span><strong style="color:${CENTRE_COLOR[src] || '#111'}">${CENTRE_SHORT[src] || src}</strong> ${f.vintage}${f.calibrated ? " ✓" : ""}</span>`;
  }).join("");
  metaEl.innerHTML = parts + `<span style="font-size:0.8rem;color:var(--text-muted)">Probabilities = raw ensemble member fraction</span>`;
}

function _renderMultiForecastBars(container, forecasts, sources) {
  // One table section per centre; L1..L6 rows with probability bars.
  // Each centre is a <details> disclosure so users can collapse the long
  // ones instead of scrolling miles. First centre open by default.
  _ensureForecastBlockStyles();
  const classes = CLASSES_ORDERED;
  const legend =
    `<div class="prob-legend" style="margin-bottom:1rem">` +
    classes.map(cls =>
      `<div class="prob-legend-item">` +
      `<div class="prob-legend-swatch ${CLASS_COLOR[cls]}"></div>` +
      `<span>${CLASS_LABEL[cls]}</span>` +
      `</div>`
    ).join("") +
    `</div>`;

  const controls =
    `<div class="fc-block-controls" style="margin-bottom:0.6rem;display:flex;gap:0.5rem">
       <button type="button" class="btn-plain" data-fc-expand>Expand all</button>
       <button type="button" class="btn-plain" data-fc-collapse>Collapse all</button>
     </div>`;

  const sections = sources.map((src, i) => {
    const f = forecasts[src];
    const colour = CENTRE_COLOR[src] || "#111";
    const short = CENTRE_SHORT[src] || src;
    const open  = i === 0 ? " open" : "";
    if (!f) {
      return `<details class="fc-block"${open} style="border-left:4px solid ${colour}">` +
             `<summary><span style="color:${colour};font-weight:700">${short}</span> - no data</summary>` +
             `</details>`;
    }
    const headerLabel = (f.model || "").startsWith(short) ? f.model : `${short} - ${f.model}`;
    const summary =
      `<summary>` +
      `<span style="color:${colour};font-weight:700">${headerLabel}</span>` +
      ` <span style="color:var(--text-muted);font-size:0.82rem">(${f.vintage})</span>` +
      `</summary>`;
    let table =
      `<table class="forecast-table" style="margin-top:0.5rem;margin-bottom:0.5rem"><thead><tr>` +
      `<th>Lead</th><th>Valid Month</th>` +
      `<th style="min-width:400px">Probability Distribution</th>` +
      `</tr></thead><tbody>`;
    for (const row of f.leads) {
      const bars = classes.map(cls => {
        const p = row[cls] || 0;
        const label = p >= 0.07 ? pct(p) : "";
        return `<div class="prob-seg ${CLASS_COLOR[cls]}" style="flex:${p}" ` +
               `title="${CLASS_LABEL[cls]}: ${pct(p)}">${label}</div>`;
      }).join("");
      table +=
        `<tr><td><strong>L${row.lead}</strong></td>` +
        `<td>${_formatValidMonth(row.valid_time)}</td>` +
        `<td><div class="prob-bar-row">${bars}</div></td></tr>`;
    }
    table += `</tbody></table>`;
    return `<details class="fc-block"${open} style="border-left:4px solid ${colour}">${summary}${table}</details>`;
  }).join("");

  container.innerHTML = legend + controls + sections;
  _wireForecastBlockControls(container);
}

function _ensureForecastBlockStyles() {
  if (document.getElementById("fc-block-styles")) return;
  const s = document.createElement("style");
  s.id = "fc-block-styles";
  s.textContent = `
    .fc-block {
      border:1px solid var(--border);border-radius:var(--radius);
      padding:0.45rem 0.9rem;margin-bottom:0.6rem;background:var(--card-bg);
    }
    .fc-block summary {
      list-style:none;cursor:pointer;font-size:0.98rem;
      padding:0.2rem 0;display:flex;align-items:baseline;gap:0.5rem;
    }
    .fc-block summary::-webkit-details-marker { display:none }
    .fc-block summary::before {
      content:"▶";
      font-size:0.7rem;opacity:0.55;transition:transform 0.15s;
      display:inline-block;width:0.9em;
    }
    .fc-block[open] summary::before { transform:rotate(90deg) }
    .fc-block-controls .btn-plain {
      padding:0.25rem 0.7rem;border:1px solid var(--border);border-radius:4px;
      background:var(--card-bg);color:var(--text);cursor:pointer;font-size:0.78rem;
    }
    .fc-block-controls .btn-plain:hover { background:var(--surface-2, #f0f4f8) }
  `;
  document.head.appendChild(s);
}

function _wireForecastBlockControls(container) {
  const exp = container.querySelector("[data-fc-expand]");
  const col = container.querySelector("[data-fc-collapse]");
  if (exp) exp.addEventListener("click", () => {
    container.querySelectorAll("details.fc-block").forEach(d => d.open = true);
  });
  if (col) col.addEventListener("click", () => {
    container.querySelectorAll("details.fc-block").forEach(d => d.open = false);
  });
}

function _renderMultiForecastPlume(forecasts, sources) {
  // Overlay the ensemble-mean "moderate+strong+extreme El Niño" probability
  // per centre on a single Chart.js line chart. Lead on x-axis, probability
  // on y. Each source is a coloured line with legend + tooltip ID.
  const canvas = document.getElementById("forecast-latest-chart");
  if (!canvas) return;
  // Fill the "issue on file" label + hide the obs-overlay note: the single-source
  // initForecastLatestPlume path is not used on this multi-centre page, so these
  // would otherwise stay stuck on "Loading...".
  const _vEl = document.getElementById("forecast-latest-vintage");
  if (_vEl) {
    const _vs = sources.map(s => forecasts[s] && forecasts[s].vintage).filter(Boolean).sort();
    _vEl.textContent = _vs.length ? _vs[_vs.length - 1] : "not available";
  }
  const _omEl = document.getElementById("forecast-latest-obs-method");
  if (_omEl) {
    const _omP = _omEl.closest("p");
    if (_omP) _omP.style.display = "none";   // this multi-centre probability plume has no observed overlay
  }
  // Clean up previous chart
  if (window._multiChart) {
    try { window._multiChart.destroy(); } catch (_) {}
    window._multiChart = null;
  }
  // Harvest per-centre lead series for the currently selected plume variable
  const variable = (document.getElementById("forecast-latest-variable")?.value) || "_en_total";
  // Build labels from the first available forecast
  let labels = null;
  for (const src of sources) {
    if (forecasts[src]) {
      labels = forecasts[src].leads.map(r => `L${r.lead} - ${_formatValidMonth(r.valid_time)}`);
      break;
    }
  }
  if (!labels) {
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const datasets = sources.map(src => {
    const f = forecasts[src];
    if (!f) return null;
    const data = f.leads.map(r => {
      if (variable === "_en_total") {
        return ((r.moderate_el_nino || 0) + (r.strong_el_nino || 0) + (r.extreme_el_nino || 0)) * 100;
      }
      if (variable === "_ln_total") {
        return ((r.moderate_la_nina || 0) + (r.strong_la_nina || 0) + (r.extreme_la_nina || 0)) * 100;
      }
      return (r[variable] || 0) * 100;
    });
    return {
      label:           CENTRE_SHORT[src] || src,
      data,
      borderColor:     CENTRE_COLOR[src] || "#111",
      backgroundColor: CENTRE_COLOR[src] || "#111",
      tension:         0.25,
      borderWidth:     2.5,
      pointRadius:     4,
      pointHoverRadius: 6,
    };
  }).filter(Boolean);

  window._multiChart = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {labels, datasets},
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {mode: "nearest", intersect: false},
      scales: {
        y: {title: {display: true, text: "Probability (%)"}, min: 0, max: 100},
        x: {title: {display: true, text: "Lead"}},
      },
      plugins: {
        legend: {position: "bottom"},
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`,
          },
        },
        title: {
          display: true,
          text: (
            variable === "_en_total" ? "P(El Niño - any intensity) by Lead" :
            variable === "_ln_total" ? "P(La Niña - any intensity) by Lead" :
            `P(${variable}) by Lead`
          ),
        },
      },
    },
  });
}

// ── IOD skill page ───────────────────────────────────────────────────────────

// ── IOD skill page (mirrors ENSO skill structure) ───────────────────────────

let _iodSkillData = null;
let _iodLabelSet = "events";
let _iodSignFilter = "pIOD";   // "pIOD" - nIOD has no intensity split


function _renderIodLabelSetControls() {
  const host = document.getElementById("iod-skill-labelset-controls");
  if (!host) return;
  const lsKeys = Object.keys(_iodSkillData.label_sets || {});
  host.innerHTML = lsKeys.map(ls => {
    const active = ls === _iodLabelSet;
    const label = ls === "events" ? "Events labels" : "Monthly indices";
    return `<button class="skill-toggle-btn${active?' active':''}" data-ls="${ls}">${label}</button>`;
  }).join("");
  host.querySelectorAll("button[data-ls]").forEach(btn => btn.addEventListener("click", () => {
    _iodLabelSet = btn.dataset.ls;
    _renderIodLabelSetControls();
    // Re-render figures with current selection
    const selected = [];
    document.querySelectorAll("#iod-skill-selector-body input[type=checkbox]:checked").forEach(cb => selected.push(cb.value));
    _renderIodPhaseFigure(selected);
    _renderIodIntensityFigure(selected);
  }));
}


function _renderIodPhaseFigure(sources) {
  _ensureSkillCardStyles();
  const host = document.getElementById("iod-skill-phase-figure");
  if (!host) return;
  const ls = _iodSkillData.label_sets[_iodLabelSet];
  const phases = ["extreme_piod", "moderate_piod", "niod", "neutral"];
  const pLabel = {extreme_piod:"Extreme pIOD", moderate_piod:"Moderate pIOD", niod:"nIOD", neutral:"Neutral"};
  const leads = _iodSkillData.leads || [1,2,3,4,5,6];
  const cards = sources.map(src => {
    const pc = ls.per_centre[src];
    if (!pc) return "";
    return _renderSkillCard(src, pc, phases, pLabel, leads);
  }).filter(Boolean).join("");
  host.innerHTML = _skillLegend() +
    (cards ? `<div class="skill-grid">${cards}</div>`
           : `<p style="color:var(--text-muted)">No centres selected.</p>`);
}

function _renderIodIntensityFigure(sources) {
  _ensureSkillCardStyles();
  const ctrlsHost = document.getElementById("iod-skill-intensity-family-controls");
  const host = document.getElementById("iod-skill-intensity-figure");
  if (!host || !ctrlsHost) return;
  ctrlsHost.innerHTML =
    `<button class="skill-toggle-btn active">Positive IOD - moderate vs extreme</button>
     <span style="margin-left:0.5rem;color:var(--text-muted);font-size:0.78rem">
     (nIOD has no intensity split in the detect_iod_events convention.)</span>`;
  const ls = _iodSkillData.label_sets[_iodLabelSet];
  const phases = ["moderate_piod", "extreme_piod"];
  const pLabel = {moderate_piod:"Moderate pIOD", extreme_piod:"Extreme pIOD"};
  const leads = _iodSkillData.leads || [1,2,3,4,5,6];
  const cards = sources.map(src => {
    const pc = ls.per_centre[src];
    if (!pc) return "";
    return _renderSkillCard(src, pc, phases, pLabel, leads);
  }).filter(Boolean).join("");
  host.innerHTML = _skillLegend() +
    (cards ? `<div class="skill-grid">${cards}</div>`
           : `<p style="color:var(--text-muted)">No centres selected.</p>`);
}



// ── IOD hindcast explorer ────────────────────────────────────────────────────


window.updateIodHindcastChart = async function() {
  const yearSel = document.getElementById("iod-hx-year");
  const monthSel = document.getElementById("iod-hx-month");
  const varSel = document.getElementById("iod-hx-variable");
  if (!yearSel || !monthSel || !varSel) return;
  const year = parseInt(yearSel.value || "1993", 10);
  const month = parseInt(monthSel.value || "1", 10);
  const variable = varSel.value;

  const canvas = document.getElementById("iod-hx-chart");
  if (!canvas) return;
  if (window._iodHxChart) {
    try { window._iodHxChart.destroy(); } catch (_) {}
    window._iodHxChart = null;
  }

  const sources = [...(window._iodHxSelected || new Set())];
  const titleEl = document.getElementById("iod-hx-chart-title");

  const labels = [1, 2, 3, 4, 5, 6].map(L => `L${L}`);
  const datasets = [];
  const _plotted = [], _missing = [];
  for (const src of sources) {
    const hc = await (window._iodHxEnsureLoaded ? window._iodHxEnsureLoaded(src) : Promise.resolve(null));
    if (!hc) { _missing.push({src, reason: "IOD hindcast JSON missing"}); continue; }
    const data = [];
    let nFound = 0;
    for (const L of [1, 2, 3, 4, 5, 6]) {
      const e = hc.entries.find(x => x.hindcast_year === year && x.start_month === month && x.lead_time === L);
      if (!e) { data.push(null); continue; }
      nFound++;
      let v;
      if (variable === "_piod_total") {
        v = (e.prob_extreme_piod || 0) + (e.prob_moderate_piod || 0);
      } else {
        v = e[variable] || 0;
      }
      data.push(v * 100);
    }
    if (nFound === 0) {
      const yrsAvail = [...new Set(hc.entries.map(x => x.hindcast_year))].sort();
      const last = yrsAvail.length ? yrsAvail[yrsAvail.length - 1] : "none";
      _missing.push({src, reason: `no ${year}-m${String(month).padStart(2,"0")} in IOD hindcast (latest ${last})`});
      continue;
    }
    _plotted.push(src);
    datasets.push({
      label: CENTRE_SHORT[src] || src,
      data,
      borderColor: CENTRE_COLOR[src] || "#111",
      backgroundColor: CENTRE_COLOR[src] || "#111",
      tension: 0.25,
      borderWidth: 2.5,
      pointRadius: 4,
      pointHoverRadius: 6,
    });
  }

  if (titleEl) {
    titleEl.textContent = `IOD probability by lead - init ${String(month).padStart(2,"0")}/${year} - ${_plotted.length} of ${sources.length} centre${sources.length === 1 ? "" : "s"} plotted`;
  }

  window._iodHxChart = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {labels, datasets},
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {mode: "nearest", intersect: false},
      scales: {
        y: {title: {display: true, text: "Probability (%)"}, min: 0, max: 100},
        x: {title: {display: true, text: "Lead"}},
      },
      plugins: {
        legend: {position: "bottom"},
        tooltip: {callbacks: {label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y === null ? "n/a" : ctx.parsed.y.toFixed(1) + "%"}`}},
      },
    },
  });

  _renderPlumeCoverageBanner({
    hostId: "iod-hx-coverage-banner",
    insertAfter: "iod-hx-chart-title",
    selected: sources, plotted: _plotted, missing: _missing,
    contextLabel: `${String(month).padStart(2,"0")}/${year} init`,
  });
};


// ── ENSO hindcast multi-centre overlay ───────────────────────────────────────

async function initEnsoHindcastMultiCentre() {
  const bodyEl = document.getElementById("enso-hx-selector-body");
  if (!bodyEl) return;
  const manifest = await _loadManifest("enso_hindcast");
  const allSources = (manifest.sources || []).map(s => s.source);
  const fromUrl = _parseSourcesParam("sources");
  let selected = new Set(
    fromUrl.length ? fromUrl.filter(s => allSources.includes(s))
                    : allSources   // default: ALL centres selected
  );
  if (selected.size === 0 && allSources.length) selected.add(allSources[0]);

  const hxCache = {};
  async function ensureLoaded(src) {
    if (hxCache[src] !== undefined) return hxCache[src];
    try {
      hxCache[src] = await loadJSON(`enso_hindcast_${src}.json`);
    } catch (_) {
      hxCache[src] = null;
    }
    return hxCache[src];
  }

  async function buildYearDropdown() {
    const yearSel = document.getElementById("enso-hx-year");
    const monthSel = document.getElementById("enso-hx-month");
    if (!yearSel || !monthSel) return;
    const selMonth = parseInt(monthSel.value || "1", 10);
    const allYears = new Set();
    for (const src of selected) {
      const hc = await ensureLoaded(src);
      if (!hc) continue;
      for (const e of hc.entries) {
        if (e.start_month === selMonth) allYears.add(e.hindcast_year);
      }
    }
    const years = [...allYears].sort((a, b) => a - b);
    const prev = yearSel.value;
    yearSel.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join("");
    if (prev && years.includes(parseInt(prev))) yearSel.value = prev;
    else if (years.length) yearSel.value = String(years[years.length - 1]);
  }

  _renderMultiSourceSelector("enso-hx-selector-body", manifest, selected, async (newSel) => {
    selected = newSel;
    _writeSourcesParam([...selected]);
    await buildYearDropdown();
    window.updateEnsoHindcastChart();
  });

  document.getElementById("enso-hx-month")?.addEventListener("change", async () => {
    await buildYearDropdown();
    window.updateEnsoHindcastChart();
  });

  _writeSourcesParam([...selected]);
  await buildYearDropdown();

  window._ensoHxCache = hxCache;
  window._ensoHxSelected = selected;
  window._ensoHxEnsureLoaded = ensureLoaded;
  await window.updateEnsoHindcastChart();
}

window.updateEnsoHindcastChart = async function() {
  const yearSel = document.getElementById("enso-hx-year");
  const monthSel = document.getElementById("enso-hx-month");
  const varSel = document.getElementById("enso-hx-variable");
  if (!yearSel || !monthSel || !varSel) return;
  const year = parseInt(yearSel.value || "1993", 10);
  const month = parseInt(monthSel.value || "1", 10);
  const variable = varSel.value;

  const canvas = document.getElementById("enso-hx-chart");
  if (!canvas) return;
  if (window._ensoHxChart) {
    try { window._ensoHxChart.destroy(); } catch (_) {}
    window._ensoHxChart = null;
  }

  const sources = [...(window._ensoHxSelected || new Set())];
  const titleEl = document.getElementById("enso-hx-chart-title");

  const labels = [1, 2, 3, 4, 5, 6].map(L => `L${L}`);
  const datasets = [];
  const _plotted = [], _missing = [];
  for (const src of sources) {
    const hc = await (window._ensoHxEnsureLoaded ? window._ensoHxEnsureLoaded(src) : Promise.resolve(null));
    if (!hc) { _missing.push({src, reason: "hindcast JSON missing"}); continue; }
    const data = [];
    let nFound = 0;
    for (const L of [1, 2, 3, 4, 5, 6]) {
      const e = hc.entries.find(x => x.hindcast_year === year && x.start_month === month && x.lead_time === L);
      if (!e) { data.push(null); continue; }
      nFound++;
      let v;
      if (variable === "_en_total") {
        v = (e.prob_extreme_el_nino || 0) + (e.prob_strong_el_nino || 0) + (e.prob_moderate_el_nino || 0);
      } else if (variable === "_ln_total") {
        v = (e.prob_extreme_la_nina || 0) + (e.prob_strong_la_nina || 0) + (e.prob_moderate_la_nina || 0);
      } else {
        v = e[variable] || 0;
      }
      data.push(v * 100);
    }
    if (nFound === 0) {
      // Help the user understand the "why"
      const yrsAvail = [...new Set(hc.entries.map(x => x.hindcast_year))].sort();
      const last = yrsAvail.length ? yrsAvail[yrsAvail.length - 1] : "none";
      _missing.push({src, reason: `no ${year}-m${String(month).padStart(2,"0")} in hindcast (latest year ${last})`});
      continue;
    }
    _plotted.push(src);
    datasets.push({
      label: CENTRE_SHORT[src] || src,
      data,
      borderColor: CENTRE_COLOR[src] || "#111",
      backgroundColor: CENTRE_COLOR[src] || "#111",
      tension: 0.25,
      borderWidth: 2.5,
      pointRadius: 4,
      pointHoverRadius: 6,
    });
  }

  if (titleEl) {
    titleEl.textContent = `ENSO probability by lead - init ${String(month).padStart(2,"0")}/${year} - ${_plotted.length} of ${sources.length} centre${sources.length === 1 ? "" : "s"} plotted`;
  }

  window._ensoHxChart = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {labels, datasets},
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {mode: "nearest", intersect: false},
      scales: {
        y: {title: {display: true, text: "Probability (%)"}, min: 0, max: 100},
        x: {title: {display: true, text: "Lead"}},
      },
      plugins: {
        legend: {position: "bottom"},
        tooltip: {callbacks: {label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y === null ? "n/a" : ctx.parsed.y.toFixed(1) + "%"}`}},
      },
    },
  });

  _renderPlumeCoverageBanner({
    hostId: "enso-hx-coverage-banner",
    insertAfter: "enso-hx-chart-title",
    selected: sources, plotted: _plotted, missing: _missing,
    contextLabel: `${String(month).padStart(2,"0")}/${year} init`,
  });
};


// Hook the existing variable-select + Update button into the multi-plume.
// Detects page kind by which selector body is present.
window.updateForecastLatestChart = async function() {
  const ensoBody = document.getElementById("forecast-multi-selector-body");
  const iodBody  = document.getElementById("iod-multi-selector-body");
  const body = ensoBody || iodBody;
  if (!body) return;
  const sources = [];
  body.querySelectorAll("input[type=checkbox]:checked").forEach(cb => sources.push(cb.value));
  const kind = ensoBody ? "enso" : "iod";
  const fcs = await _loadForecastsForSources(sources, kind);
  if (kind === "iod") {
    _renderMultiIodPlume(fcs, sources);
  } else {
    _renderMultiForecastPlume(fcs, sources);
  }
};

// ── Hindcast skill page ───────────────────────────────────────────────────────

const SKILL_PHASE3_ORDER = ["el_nino", "neutral", "la_nina"];
const SKILL_INTENSITY_BY_SIGN = {
  la_nina: ["moderate_la_nina", "strong_la_nina", "extreme_la_nina"],
  el_nino: ["moderate_el_nino", "strong_el_nino", "extreme_el_nino"],
};

const SKILL_INTENSITY_SIGN_LABEL = {
  la_nina: "La Niña",
  el_nino: "El Niño",
};

const SKILL_CLASS_LABEL = {
  el_nino: "El Niño",
  neutral: "Neutral",
  la_nina: "La Niña",
  moderate_la_nina: "Moderate La Niña",
  strong_la_nina: "Strong La Niña",
  extreme_la_nina: "Extreme La Niña",
  moderate_el_nino: "Moderate El Niño",
  strong_el_nino: "Strong El Niño",
  extreme_el_nino: "Extreme El Niño",
};

let _hindcastSkillData = null;
let _activeSkillLabelSet = "events";
let _activeSkillIntensitySign = "la_nina";

function _skillPct(v) {
  return v === null || v === undefined ? "NA" : `${(v * 100).toFixed(0)}%`;
}

function _skillCellColor(v) {
  if (v === null || v === undefined) return "#f3f5f8";
  const hue = 12 + (110 * v);      // red -> green
  const light = 94 - (44 * v);     // darker for higher skill
  return `hsl(${hue} 70% ${light}%)`;
}

function _skillCIText(low, high) {
  if (low === null || high === null || low === undefined || high === undefined) return "CI unavailable";
  return `95% CI ${Math.round(low * 100)}-${Math.round(high * 100)}%`;
}

function _renderSkillLabelSetControls() {
  const container = document.getElementById("skill-labelset-controls");
  if (!container || !_hindcastSkillData?.skill_dashboard?.label_sets) return;

  const labelSets = _hindcastSkillData.skill_dashboard.label_sets;
  const keys = Object.keys(labelSets);
  if (!keys.length) {
    container.innerHTML = "<p style='color:var(--text-muted)'>No label sets found.</p>";
    return;
  }
  if (!keys.includes(_activeSkillLabelSet)) _activeSkillLabelSet = keys[0];

  container.innerHTML = keys.map((k) => {
    const active = k === _activeSkillLabelSet ? "active" : "";
    return `<button class="skill-toggle-btn ${active}" onclick="window.setSkillLabelSet('${k}')">${labelSets[k].label}</button>`;
  }).join("");
}

function _buildSkillTable(order, payloadMap, leads, meanRecall, totalSupport) {
  let html = "<table class='skill-heatmap-table'><thead><tr><th>Class</th>";
  for (const lead of leads) html += `<th>L${lead}</th>`;
  html += "</tr></thead><tbody>";

  for (const cls of order) {
    const row = payloadMap?.[cls] || {};
    const recall = row.recall || [];
    const support = row.support || [];
    const low = row.ci95_low || [];
    const high = row.ci95_high || [];

    html += `<tr><th>${SKILL_CLASS_LABEL[cls] || cls}</th>`;
    for (let i = 0; i < leads.length; i++) {
      const v = recall[i] ?? null;
      const n = support[i] ?? 0;
      const ci = _skillCIText(low[i] ?? null, high[i] ?? null);
      const tip = `${SKILL_CLASS_LABEL[cls] || cls} - Lead L${leads[i]}: recall ${_skillPct(v)}, n=${n}. ${ci}.`;
      html += `<td class="skill-cell" style="background:${_skillCellColor(v)}" title="${tip}">` +
              `<div class="skill-value">${_skillPct(v)}</div>` +
              `<div class="skill-meta">n=${n}</div>` +
              `</td>`;
    }
    html += "</tr>";
  }

  html += "<tr class='skill-summary-row'><th>Mean recall</th>";
  for (let i = 0; i < leads.length; i++) {
    html += `<td><strong>${_skillPct(meanRecall?.[i] ?? null)}</strong></td>`;
  }
  html += "</tr>";

  html += "<tr class='skill-summary-row'><th>Total n</th>";
  for (let i = 0; i < leads.length; i++) {
    html += `<td><strong>${totalSupport?.[i] ?? 0}</strong></td>`;
  }
  html += "</tr>";

  html += "</tbody></table>";
  return html;
}

function _buildSkillSubsetSummary(order, payloadMap, leads) {
  const meanRecall = [];
  const totalSupport = [];

  for (let i = 0; i < leads.length; i++) {
    let recallSum = 0;
    let recallCount = 0;
    let supportSum = 0;

    for (const cls of order) {
      const row = payloadMap?.[cls] || {};
      const v = row.recall?.[i];
      const n = row.support?.[i];

      if (v !== null && v !== undefined) {
        recallSum += v;
        recallCount += 1;
      }
      if (typeof n === "number" && Number.isFinite(n)) {
        supportSum += n;
      }
    }

    meanRecall.push(recallCount ? recallSum / recallCount : null);
    totalSupport.push(supportSum);
  }

  return { meanRecall, totalSupport };
}

function _renderSkillIntensityControls() {
  const container = document.getElementById("skill-intensity-family-controls");
  if (!container || !_hindcastSkillData?.skill_dashboard?.label_sets) return;

  const setPayload = _hindcastSkillData.skill_dashboard.label_sets?.[_activeSkillLabelSet];
  if (!setPayload?.intensity6) {
    container.innerHTML = "<p style='color:var(--text-muted)'>No intensity data found.</p>";
    return;
  }

  const signKeys = ["la_nina", "el_nino"].filter((sign) =>
    SKILL_INTENSITY_BY_SIGN[sign].some((cls) => !!setPayload.intensity6[cls])
  );

  if (!signKeys.length) {
    container.innerHTML = "<p style='color:var(--text-muted)'>No sign-specific intensity classes found.</p>";
    return;
  }

  if (!signKeys.includes(_activeSkillIntensitySign)) {
    _activeSkillIntensitySign = signKeys[0];
  }

  container.innerHTML = signKeys.map((sign) => {
    const active = sign === _activeSkillIntensitySign ? "active" : "";
    return `<button class="skill-toggle-btn ${active}" onclick="window.setSkillIntensitySign('${sign}')">${SKILL_INTENSITY_SIGN_LABEL[sign]}</button>`;
  }).join("");
}

function _renderSkillFigures() {
  if (!_hindcastSkillData?.skill_dashboard) return;

  const dashboard = _hindcastSkillData.skill_dashboard;
  const setPayload = dashboard.label_sets?.[_activeSkillLabelSet];
  if (!setPayload) return;

  _renderSkillIntensityControls();

  const phaseEl = document.getElementById("skill-phase-figure");
  const intensityEl = document.getElementById("skill-intensity-figure");

  if (phaseEl) {
    phaseEl.innerHTML = _buildSkillTable(
      SKILL_PHASE3_ORDER,
      setPayload.phase3,
      dashboard.leads,
      setPayload.phase3_lead_mean_recall,
      setPayload.phase3_total_support_by_lead,
    );
  }

  if (intensityEl) {
    const activeClasses = (SKILL_INTENSITY_BY_SIGN[_activeSkillIntensitySign] || [])
      .filter((cls) => !!setPayload.intensity6?.[cls]);

    if (!activeClasses.length) {
      intensityEl.innerHTML = "<p style='color:var(--text-muted)'>No intensity classes available for this sign.</p>";
      return;
    }

    const summary = _buildSkillSubsetSummary(activeClasses, setPayload.intensity6, dashboard.leads);
    intensityEl.innerHTML = _buildSkillTable(
      activeClasses,
      setPayload.intensity6,
      dashboard.leads,
      summary.meanRecall,
      summary.totalSupport,
    );
  }
}

window.setSkillLabelSet = function(labelKey) {
  if (!_hindcastSkillData?.skill_dashboard?.label_sets?.[labelKey]) return;
  _activeSkillLabelSet = labelKey;
  _renderSkillLabelSetControls();
  _renderSkillFigures();
};

window.setSkillIntensitySign = function(signKey) {
  if (!SKILL_INTENSITY_BY_SIGN[signKey]) return;
  _activeSkillIntensitySign = signKey;
  _renderSkillFigures();
};

// ── ENSO skill page (mirrors IOD skill structure, multi-centre) ─────────────

let _ensoSkillLabelSet = "events";
let _ensoSkillSign     = "el_nino";

async function initHindcastPage() {
  const manifest = await _loadManifest("enso_hindcast");
  const allSources = (manifest.sources || []).map(s => s.source);
  const fromUrl = _parseSourcesParam("sources");
  let selected = new Set(fromUrl.length ? fromUrl.filter(s => allSources.includes(s)) : allSources);
  if (selected.size === 0 && allSources.length) selected.add(allSources[0]);

  let skill;
  try {
    skill = await loadJSON("hindcast_skill.json");
  } catch (e) {
    const host = document.getElementById("skill-container");
    if (host) host.innerHTML =
      `<p style="color:#c62828">Error loading hindcast_skill.json: ${e.message}</p>`;
    return;
  }

  _hindcastSkillData = skill;

  function rerender() {
    _writeSourcesParam([...selected]);
    _renderEnsoSkillLabelSetControls();
    _renderEnsoSkillPhaseFigure([...selected]);
    _renderEnsoSkillIntensityFigure([...selected]);
  }

  _renderMultiSourceSelector("skill-selector-body", manifest, selected, (newSel) => {
    selected = newSel;
    rerender();
  });
  rerender();
}

function _ensoSkillCellColor(v) {
  if (v === null || v === undefined) return "#f3f5f8";
  const hue = 12 + (110 * v);
  const light = 94 - (44 * v);
  return `hsl(${hue}, 65%, ${light}%)`;
}

function _renderEnsoSkillLabelSetControls() {
  const host = document.getElementById("skill-labelset-controls");
  const dash = _hindcastSkillData?.skill_dashboard;
  if (!host || !dash?.label_sets) return;
  const lsKeys = Object.keys(dash.label_sets);
  host.innerHTML = lsKeys.map(ls => {
    const active = ls === _ensoSkillLabelSet;
    const label = ls === "events" ? "Events labels" : "Monthly indices";
    return `<button class="skill-toggle-btn${active?' active':''}" data-ls="${ls}">${label}</button>`;
  }).join("");
  host.querySelectorAll("button[data-ls]").forEach(btn => btn.addEventListener("click", () => {
    _ensoSkillLabelSet = btn.dataset.ls;
    _renderEnsoSkillLabelSetControls();
    const selected = [];
    document.querySelectorAll("#skill-selector-body input[type=checkbox]:checked").forEach(cb => selected.push(cb.value));
    _renderEnsoSkillPhaseFigure(selected);
    _renderEnsoSkillIntensityFigure(selected);
  }));
}

// Shared skill-card CSS (injected once on first render)
function _ensureSkillCardStyles() {
  if (document.getElementById("skill-card-styles")) return;
  const s = document.createElement("style");
  s.id = "skill-card-styles";
  s.textContent = `
    .skill-legend {
      display:flex;align-items:center;gap:0.6rem;font-size:0.78rem;
      color:var(--text-muted);margin:0.4rem 0 0.9rem;flex-wrap:wrap;
    }
    .skill-legend .lg-grad {
      width:180px;height:10px;border-radius:5px;
      background:linear-gradient(90deg,hsl(12 65% 94%),hsl(67 65% 72%),hsl(122 65% 50%));
      border:1px solid var(--border);
    }
    .skill-grid {
      display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));
      gap:0.9rem;
    }
    .skill-card {
      border:1px solid var(--border);border-radius:var(--radius);
      overflow:hidden;background:var(--card-bg);
    }
    .skill-card-head {
      padding:0.45rem 0.75rem;font-weight:700;font-size:0.88rem;
      color:#fff;display:flex;justify-content:space-between;align-items:center;
    }
    .skill-card-head .n-total { font-weight:500;font-size:0.76rem;opacity:0.85 }
    /* Horizontal scroll wrapper so L5 & L6 are reachable on narrow cards */
    .sk-matrix-wrap { overflow-x:auto; max-width:100% }
    .sk-matrix { width:100%;border-collapse:separate;border-spacing:0;font-size:0.74rem;min-width:360px }
    .sk-matrix th, .sk-matrix td { padding:0.28rem 0.3rem;text-align:center;min-width:56px }
    .sk-matrix thead th {
      background:#F7F9FC;color:var(--text-muted);font-weight:700;
      text-transform:uppercase;letter-spacing:0.04em;font-size:0.68rem;
      border-bottom:1px solid var(--border);
      position:sticky;top:0;z-index:2;
    }
    .sk-matrix tbody th {
      text-align:left;padding-left:0.55rem;white-space:nowrap;font-weight:600;
      background:#FBFCFE;border-right:1px solid var(--border);color:var(--text);
      position:sticky;left:0;z-index:3;
      min-width:120px;
    }
    .sk-matrix thead th:first-child {
      position:sticky;left:0;z-index:4;background:#F7F9FC;
    }
    .sk-matrix tbody td { border-bottom:1px solid #f0f2f5 }
    .sk-matrix tbody tr:last-child td, .sk-matrix tbody tr:last-child th { border-bottom:none }
    .sk-matrix .sk-overall th, .sk-matrix .sk-overall td {
      border-top:2px solid #cfd8dc;
      background:#F3F6F9 !important;
      font-weight:800;
    }
    .sk-matrix .sk-overall th { background:#E8ECEF !important }
    .sk-val { font-weight:700;font-size:0.82rem;line-height:1 }
    .sk-n   { font-size:0.62rem;color:rgba(0,0,0,0.55);margin-top:0.1rem }
    /* Subtle scroll shadow so users realise they can scroll right */
    .sk-matrix-wrap::-webkit-scrollbar { height:6px }
    .sk-matrix-wrap::-webkit-scrollbar-thumb { background:rgba(0,0,0,0.18);border-radius:3px }
  `;
  document.head.appendChild(s);
}

function _skillLegend() {
  return `
    <div class="skill-legend">
      <span>Recall</span>
      <span>0</span>
      <span class="lg-grad"></span>
      <span>1</span>
      <span style="margin-left:0.8rem">
        Cells show % with sample size <em>n</em>. - = no observed months of that phase in the 1993-2024 window.
      </span>
    </div>`;
}

// Render a single centre card: phase × lead matrix.
function _renderSkillCard(src, pc, phases, pLabel, leads) {
  const colour = (typeof CENTRE_COLOR === "object" ? CENTRE_COLOR : {})[src] || "#333";
  const short  = (typeof CENTRE_SHORT === "object" ? CENTRE_SHORT : {})[src] || src;
  // total obs months contributing (sum over phases of n at L1 since n same for all phases at fixed L)
  let nTotal = 0;
  for (const p of phases) nTotal += (pc[p]?.n?.[0] || 0);

  // Overall accuracy per lead = sum_p(hit_p) / sum_p(n_p) where hit_p = recall_p × n_p.
  // This mirrors the old scorecard "headline accuracy" and gives the user a
  // single number per lead that combines phases weighted by their support.
  const overall = leads.map((_L, i) => {
    let numer = 0, denom = 0;
    for (const p of phases) {
      const r = pc[p]?.recall?.[i];
      const n = pc[p]?.n?.[i];
      if (r == null || !n) continue;
      numer += r * n;
      denom += n;
    }
    return denom > 0 ? numer / denom : null;
  });

  let rows = "";
  for (const p of phases) {
    rows += `<tr><th>${pLabel[p] || p}</th>`;
    for (let i = 0; i < leads.length; i++) {
      const r  = pc[p]?.recall?.[i];
      const n  = pc[p]?.n?.[i];
      const bg = _ensoSkillCellColor(r);
      const txt = (r === null || r === undefined) ? "-" : (r * 100).toFixed(0) + "%";
      const tip = `${pLabel[p] || p} · L${leads[i]}\nrecall=${txt}, n=${n}`;
      rows += `<td style="background:${bg}" title="${tip}">
        <div class="sk-val">${txt}</div><div class="sk-n">n=${n}</div>
      </td>`;
    }
    rows += "</tr>";
  }

  // Overall row (support-weighted mean recall = classification accuracy)
  rows += `<tr class="sk-overall"><th>Overall</th>`;
  for (let i = 0; i < leads.length; i++) {
    const v = overall[i];
    const bg = _ensoSkillCellColor(v);
    const txt = (v == null) ? "-" : (v * 100).toFixed(0) + "%";
    rows += `<td style="background:${bg};font-weight:800" title="Support-weighted mean recall across phases at L${leads[i]}">
      <div class="sk-val">${txt}</div>
    </td>`;
  }
  rows += `</tr>`;

  let headCols = `<tr><th>Phase</th>`;
  for (const L of leads) headCols += `<th>L${L}</th>`;
  headCols += "</tr>";

  return `
    <div class="skill-card">
      <div class="skill-card-head" style="background:${colour}">
        <span>${short}</span>
        <span class="n-total">${nTotal} obs-months</span>
      </div>
      <div class="sk-matrix-wrap">
        <table class="sk-matrix">
          <thead>${headCols}</thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function _renderEnsoSkillPhaseFigure(sources) {
  _ensureSkillCardStyles();
  const host = document.getElementById("skill-phase-figure");
  const dash = _hindcastSkillData?.skill_dashboard;
  if (!host || !dash?.label_sets) return;
  const ls = dash.label_sets[_ensoSkillLabelSet];
  if (!ls) { host.innerHTML = `<p>Label set ${_ensoSkillLabelSet} missing.</p>`; return; }
  const phases = dash.phases || [
    "extreme_el_nino","strong_el_nino","moderate_el_nino",
    "neutral",
    "moderate_la_nina","strong_la_nina","extreme_la_nina",
  ];
  const pLabel = {
    extreme_el_nino:"Extreme El Niño", strong_el_nino:"Strong El Niño", moderate_el_nino:"Moderate El Niño",
    neutral:"Neutral",
    moderate_la_nina:"Moderate La Niña", strong_la_nina:"Strong La Niña", extreme_la_nina:"Extreme La Niña",
  };
  const leads = dash.leads || [1,2,3,4,5,6];

  // Current JSON is multi-centre LOYO aggregated (no per_centre breakdown).
  // Build one combined card from intensity6 (EN/LN sub-tiers) + phase3.neutral.
  const pc = _ensoBuild7PhasePc(ls);
  const card = pc ? _renderSkillCard("ALL", pc, phases, pLabel, leads) : "";

  host.innerHTML = _skillLegend() +
    (card ? `<div class="skill-grid">${card}</div>`
          : `<p style="color:var(--text-muted)">No skill data for this label set.</p>`);
}

// Convert {phase3, intensity6} aggregated label_set into the per-phase
// {recall, n} shape the skill-card renderer expects, expanding to 7 phases.
function _ensoBuild7PhasePc(ls) {
  const out = {};
  const i6 = ls.intensity6 || {};
  const p3 = ls.phase3 || {};
  for (const k of ["moderate_el_nino","strong_el_nino","extreme_el_nino",
                    "moderate_la_nina","strong_la_nina","extreme_la_nina"]) {
    if (i6[k]) out[k] = { recall: i6[k].recall, n: i6[k].support };
  }
  if (p3.neutral) out.neutral = { recall: p3.neutral.recall, n: p3.neutral.support };
  return Object.keys(out).length ? out : null;
}

function _renderEnsoSkillIntensityFigure(sources) {
  _ensureSkillCardStyles();
  const ctrlsHost = document.getElementById("skill-intensity-family-controls");
  const host      = document.getElementById("skill-intensity-figure");
  if (!host || !ctrlsHost) return;
  ctrlsHost.innerHTML = `
    <button class="skill-toggle-btn${_ensoSkillSign==='el_nino'?' active':''}" data-sign="el_nino">El Niño - moderate / strong / extreme</button>
    <button class="skill-toggle-btn${_ensoSkillSign==='la_nina'?' active':''}" data-sign="la_nina">La Niña - moderate / strong / extreme</button>
  `;
  ctrlsHost.querySelectorAll("button[data-sign]").forEach(btn => btn.addEventListener("click", () => {
    _ensoSkillSign = btn.dataset.sign;
    const selected = [];
    document.querySelectorAll("#skill-selector-body input[type=checkbox]:checked").forEach(cb => selected.push(cb.value));
    _renderEnsoSkillIntensityFigure(selected);
  }));

  const dash = _hindcastSkillData?.skill_dashboard;
  if (!dash?.label_sets) return;
  const ls = dash.label_sets[_ensoSkillLabelSet];
  const phases = _ensoSkillSign === "el_nino"
    ? ["moderate_el_nino","strong_el_nino","extreme_el_nino"]
    : ["moderate_la_nina","strong_la_nina","extreme_la_nina"];
  const pLabel = {
    moderate_el_nino:"Moderate El Niño", strong_el_nino:"Strong El Niño", extreme_el_nino:"Extreme El Niño",
    moderate_la_nina:"Moderate La Niña", strong_la_nina:"Strong La Niña", extreme_la_nina:"Extreme La Niña",
  };
  const leads = dash.leads || [1,2,3,4,5,6];

  // Aggregated intensity6 → renderer-friendly pc shape.
  const i6 = ls?.intensity6 || {};
  const pc = {};
  for (const p of phases) {
    if (i6[p]) pc[p] = { recall: i6[p].recall, n: i6[p].support };
  }
  const card = Object.keys(pc).length
    ? _renderSkillCard("ALL", pc, phases, pLabel, leads) : "";

  host.innerHTML = _skillLegend() +
    (card ? `<div class="skill-grid">${card}</div>`
          : `<p style="color:var(--text-muted)">No intensity6 data for this label set.</p>`);
}

// ── Seasonal maps page ────────────────────────────────────────────────────────


// ── Spaghetti / ensemble chart helpers ────────────────────────────────────────

function _median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2;
}

function _buildSpaghettiDatasets(memberData, varName, obsLookup) {
  const members = Object.entries(memberData);
  if (!members.length) return { datasets: [], labels: [] };

  const nLeads = members[0][1].length;
  const labels = members[0][1].map(r => r.valid_time);

  const datasets = [];

  // Thin lines - one per member
  for (const [, rows] of members) {
    const phase    = rows[rows.length - 1]?.phase || rows[rows.length - 1]?.classified_phase || "neutral";
    let hexColor   = "#90A4AE";
    try { hexColor = PHASE_COLORS[phase] ? PHASE_COLORS[phase]() : hexColor; } catch(_) {}
    datasets.push({
      label: "_member",
      data:  rows.map(r => r[varName] ?? null),
      borderColor: hexColor + "66",
      borderWidth: 1,
      pointRadius: 0,
      pointHoverRadius: 0,
      tension: 0.2,
      fill: false,
    });
  }

  // Thick median line
  const medianData = Array.from({ length: nLeads }, (_, i) => {
    const vals = members.map(([, rows]) => rows[i]?.[varName]).filter(v => v != null);
    return vals.length ? _median(vals) : null;
  });
  datasets.push({
    label: "Ensemble Median",
    data: medianData,
    borderColor: "#000000",
    borderWidth: 2.5,
    pointRadius: 3,
    pointStyle: "line",
    tension: 0.2,
    fill: false,
  });

  // Observed overlay (thick dotted black)
  if (obsLookup) {
    datasets.push({
      label: "Observed",
      data:  labels.map(ym => obsLookup[ym] ?? null),
      borderColor: "#000000",
      borderDash:  [2, 4],
      borderWidth: 3,
      pointRadius: 0,
      pointHoverRadius: 0,
      pointStyle: "line",
      tension: 0,
      fill: false,
    });
  }

  return { datasets, labels };
}

function _renderSeriesLegend(canvasId, hasObserved) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !canvas.parentElement) return;

  const legendId = `${canvasId}-series-legend`;
  let legendEl = document.getElementById(legendId);
  if (!legendEl) {
    legendEl = document.createElement("div");
    legendEl.id = legendId;
    legendEl.className = "series-legend";
    canvas.parentElement.appendChild(legendEl);
  }

  const items = [
    `<div class="series-legend-item"><span class="series-line median"></span><span>Ensemble Median</span></div>`,
  ];
  if (hasObserved) {
    items.push(`<div class="series-legend-item"><span class="series-line observed"></span><span>Observed</span></div>`);
  }

  legendEl.innerHTML = items.join("");
}

function _buildSpreadStats(memberData, varName) {
  const members = Object.values(memberData);
  if (!members.length) return [];
  return members[0].map((_, i) => {
    const vals = members.map(rows => rows[i]?.[varName]).filter(v => v != null);
    if (!vals.length) return null;
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const std  = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
    const sorted = [...vals].sort((a, b) => a - b);
    return {
      valid_time: members[0][i]?.valid_time,
      lead: i + 1, n: vals.length,
      median: round2(_median(vals)), mean: round2(mean), std: round2(std),
      p10: round2(sorted[Math.floor(vals.length * 0.1)] ?? sorted[0]),
      p90: round2(sorted[Math.floor(vals.length * 0.9)] ?? sorted[sorted.length - 1]),
    };
  }).filter(Boolean);
}

function _renderSpreadStats(stats, containerId, cardId) {
  const card = document.getElementById(cardId);
  const cont = document.getElementById(containerId);
  if (!card || !cont) return;
  card.style.display = "block";
  let html = `<table class="spread-table"><thead><tr>` +
    `<th>Lead</th><th>Valid</th><th>N</th><th>Median</th><th>Mean</th><th>Std Dev</th><th>P10</th><th>P90</th>` +
    `</tr></thead><tbody>`;
  for (const r of stats) {
    html += `<tr><td><strong>L${r.lead}</strong></td><td>${_formatValidMonth(r.valid_time)}</td><td>${r.n}</td>` +
            `<td>${r.median}</td><td>${r.mean}</td><td>${r.std}</td><td>${r.p10}</td><td>${r.p90}</td></tr>`;
  }
  html += `</tbody></table>`;
  cont.innerHTML = html;
}

function _drawChart(canvasId, datasets, labels, varName) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const existing = Chart.getChart(ctx);
  if (existing) existing.destroy();

  const hasObserved = datasets.some(ds => ds.label === "Observed");

  const renderDatasets = [
    {
      label: "_zero_ref",
      data: labels.map(() => 0),
      borderColor: "#8D8D8D",
      borderWidth: 3,
      borderDash: [10, 8],
      pointRadius: 0,
      pointHoverRadius: 0,
      tension: 0,
      fill: false,
    },
    ...datasets,
  ];

  new Chart(ctx, {
    type: "line",
    data: { labels, datasets: renderDatasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: { mode: "index", intersect: false, filter: item => !item.dataset.label.startsWith("_") },
      },
      scales: {
        x: { ticks: { maxRotation: 0 }, grid: { color: "rgba(0,0,0,0.05)" } },
        y: { title: { display: true, text: varAxisLabel(varName) }, grid: { color: "rgba(0,0,0,0.05)" } },
      },
    },
  });

  _renderSeriesLegend(canvasId, hasObserved);
}

// ── Hindcast explorer page ────────────────────────────────────────────────────

let _hxCache = {};
let _obsData  = null;
let _hxOperationalOverlay = {};

async function _ensureObsData() {
  if (_obsData) return _obsData;
  try { _obsData = await loadJSON("obs_nino.json"); } catch(_) { _obsData = null; }
  return _obsData;
}

async function _loadOperationalForecastOverlay() {
  let fcData = null;
  let forecast = null;
  try {
    [fcData, forecast] = await Promise.all([
      loadJSON(_forecastPath("forecast_members.json")),
      loadJSON(_forecastPath("forecast.json")),
    ]);
  } catch (_) {
    _hxOperationalOverlay = {};
    return;
  }

  const latestVintage = forecast?.vintage;
  if (!latestVintage || !fcData?.by_start) {
    _hxOperationalOverlay = {};
    return;
  }

  const overlay = {};
  // Fold contiguous prior monthly issues into hindcasts.
  // Stop at the first missing month to avoid pulling isolated legacy test vintages.
  let vintage = shiftYearMonth(latestVintage, -1);
  while (vintage && fcData.by_start[vintage]) {
    const lag = monthLag(latestVintage, vintage);
    if (!Number.isFinite(lag) || lag < 1) break;

    const parsed = parseYearMonth(vintage);
    if (!parsed) break;

    const key = `m${String(parsed.month).padStart(2, "0")}`;
    overlay[key] ||= {};
    overlay[key][String(parsed.year)] = fcData.by_start[vintage];

    vintage = shiftYearMonth(vintage, -1);
  }

  _hxOperationalOverlay = overlay;
}

function _applyOperationalOverlayToMonth(monthKey) {
  const byYear = _hxOperationalOverlay[monthKey];
  if (!byYear) return;

  if (!_hxCache[monthKey]) {
    _hxCache[monthKey] = {
      start_month: Number(monthKey.slice(1)),
      years: {},
    };
  }

  _hxCache[monthKey].years ||= {};
  for (const [year, members] of Object.entries(byYear)) {
    _hxCache[monthKey].years[year] = members;
  }
}

async function initHindcastExplorer() {
  const yearSel  = document.getElementById("hx-year");
  const monthSel = document.getElementById("hx-month");
  if (monthSel) monthSel.value = 1;

  await _loadOperationalForecastOverlay();

  async function refreshYearOptionsForMonth() {
    const month = parseInt(monthSel?.value || "1", 10);
    const key   = `m${String(month).padStart(2, "0")}`;
    if (!_hxCache[key]) {
      try { _hxCache[key] = await loadJSON(`hindcast/${key}.json`); }
      catch(_) { _hxCache[key] = null; }
    }
    _applyOperationalOverlayToMonth(key);

    const prevYear = yearSel?.value;
    const years = Object.keys(_hxCache[key]?.years || {})
      .map(y => parseInt(y, 10))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);

    if (!yearSel) return;
    yearSel.innerHTML = "";
    for (const y of years) {
      const opt = document.createElement("option");
      opt.value = String(y);
      opt.text = String(y);
      yearSel.appendChild(opt);
    }

    if (prevYear && years.includes(parseInt(prevYear, 10))) {
      yearSel.value = prevYear;
    } else if (years.length) {
      yearSel.value = String(years[years.length - 1]);
    }
  }

  if (monthSel) {
    monthSel.addEventListener("change", async () => {
      await refreshYearOptionsForMonth();
      await updateHindcastChart();
    });
  }

  await refreshYearOptionsForMonth();

  // Phase color legend for spaghetti chart
  const hxLegEl = document.getElementById("hx-phase-legend");
  if (hxLegEl) {
    hxLegEl.innerHTML = CLASSES_ORDERED.map(cls =>
      `<div class="prob-legend-item"><div class="prob-legend-swatch ${CLASS_COLOR[cls]}"></div><span>${CLASS_LABEL[cls]}</span></div>`
    ).join("");
  }

  await updateHindcastChart();
}

window.updateHindcastChart = async function() {
  const year    = parseInt(document.getElementById("hx-year").value);
  const month   = parseInt(document.getElementById("hx-month").value);
  const varName = document.getElementById("hx-variable").value;

  const key    = `m${String(month).padStart(2, "0")}`;
  if (!_hxCache[key]) {
    try { _hxCache[key] = await loadJSON(`hindcast/${key}.json`); }
    catch(_) { _hxCache[key] = null; }
  }
  _applyOperationalOverlayToMonth(key);
  const hxData = _hxCache[key];
  const obs    = await _ensureObsData();

  const titleEl    = document.getElementById("hx-chart-title");
  const summaryEl  = document.getElementById("hx-phase-summary");

  if (!Number.isFinite(year)) {
    if (titleEl) titleEl.textContent = "No hindcast years available for this start month";
    return;
  }

  if (!hxData?.years?.[String(year)]) {
    if (titleEl) {
      const years = Object.keys(hxData?.years || {}).map(y => parseInt(y, 10)).filter(Number.isFinite).sort((a, b) => a - b);
      if (years.length) {
        titleEl.textContent = `No data for year ${year} (available: ${years[0]}-${years[years.length - 1]})`;
      } else {
        titleEl.textContent = hxData ? `No data for year ${year}` : "Hindcast member data not available";
      }
    }
    return;
  }

  const yearData = hxData.years[String(year)];
  const obsLookup = {};
  if (obs) obs.times.forEach((t, i) => { obsLookup[t] = obs[varName]?.[i] ?? null; });

  const { datasets, labels } = _buildSpaghettiDatasets(yearData, varName, obsLookup);

  if (titleEl) titleEl.textContent = `${year} ${MONTH_NAMES[month-1]} start - ${varLabel(varName)} - ${Object.keys(yearData).length} members`;

  if (summaryEl) {
    const lastPhases = Object.values(yearData).map(rows => rows[rows.length-1]?.phase || rows[rows.length-1]?.classified_phase || "").filter(Boolean);
    const counts = {};
    lastPhases.forEach(p => { counts[p] = (counts[p] || 0) + 1; });
    const top = Object.entries(counts).sort((a,b) => b[1]-a[1])[0];
    if (top) summaryEl.innerHTML = `L6 majority: <strong>${CLASS_LABEL[top[0]] || top[0]}</strong> (${top[1]}/${lastPhases.length} members)`;
  }

  _drawChart("hx-chart", datasets, labels, varName);
  _renderSpreadStats(_buildSpreadStats(yearData, varName), "hx-stats-content", "hx-stats-card");
};

// ── Forecast explorer page ────────────────────────────────────────────────────

let _fcMembersData = null;


window.updateForecastChart = async function() {
  const vintage = document.getElementById("fc-vintage")?.value;
  const varName = document.getElementById("fc-variable")?.value || "nino34_std";
  const titleEl = document.getElementById("fc-chart-title");

  if (!_fcMembersData?.by_start?.[vintage]) {
    if (titleEl) titleEl.textContent = _fcMembersData ? `No member data for vintage ${vintage}` : "Forecast member data not available";
    return;
  }

  const memberData = _fcMembersData.by_start[vintage];
  const obsLookup  = {};
  if (_obsData) _obsData.times.forEach((t, i) => { obsLookup[t] = _obsData[varName]?.[i] ?? null; });

  const { datasets, labels } = _buildSpaghettiDatasets(memberData, varName, obsLookup);
  if (titleEl) titleEl.textContent = `${vintage} Forecast - ${varLabel(varName)} - ${Object.keys(memberData).length} members`;

  _drawChart("fc-chart", datasets, labels, varName);
  _renderSpreadStats(_buildSpreadStats(memberData, varName), "fc-spread-content", "fc-spread-card");
};

// ── Page router ───────────────────────────────────────────────────────────────


// Global error handler to catch uncaught errors and log stack traces
window.addEventListener("error", function(event) {
  console.error("[Global Error Handler] Uncaught error:", event.error || event.message, event);
});
window.addEventListener("unhandledrejection", function(event) {
  console.error("[Global Error Handler] Unhandled promise rejection:", event.reason, event);
});

// ── IOD page ──────────────────────────────────────────────────────────────────

const _iodUrlParams = new URLSearchParams(window.location.search);
let _iodSource = _iodUrlParams.get("source") || "seas5";

const IOD_CLASSES = ["extreme_piod", "moderate_piod", "niod", "neutral"];
const IOD_LABEL = {
  extreme_piod:  "Ext pIOD",
  moderate_piod: "Mod pIOD",
  niod:          "Neg IOD",
  neutral:       "Neutral",
};




// ── Multi-source IOD forecast page ───────────────────────────────────────────




function _renderMultiIodPlume(forecasts, sources) {
  const canvas = document.getElementById("forecast-latest-chart");
  if (!canvas) return;
  if (window._multiChart) {
    try { window._multiChart.destroy(); } catch (_) {}
    window._multiChart = null;
  }
  const variable = (document.getElementById("forecast-latest-variable")?.value) || "_piod_total";
  let labels = null;
  for (const src of sources) {
    if (forecasts[src]) {
      labels = forecasts[src].leads.map(r => `L${r.lead || r.lead_time} - ${_formatValidMonth(r.valid_time)}`);
      break;
    }
  }
  if (!labels) {
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const datasets = sources.map(src => {
    const f = forecasts[src];
    if (!f) return null;
    const data = f.leads.map(r => {
      const get = (k) => (r[k] !== undefined ? r[k] : r[`prob_${k}`]) || 0;
      if (variable === "_piod_total") return (get("extreme_piod") + get("moderate_piod")) * 100;
      return get(variable) * 100;
    });
    return {
      label:            CENTRE_SHORT[src] || src,
      data,
      borderColor:      CENTRE_COLOR[src] || "#111",
      backgroundColor:  CENTRE_COLOR[src] || "#111",
      tension:          0.25,
      borderWidth:      2.5,
      pointRadius:      4,
      pointHoverRadius: 6,
    };
  }).filter(Boolean);

  window._multiChart = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {labels, datasets},
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {mode: "nearest", intersect: false},
      scales: {
        y: {title: {display: true, text: "Probability (%)"}, min: 0, max: 100},
        x: {title: {display: true, text: "Lead"}},
      },
      plugins: {
        legend: {position: "bottom"},
        tooltip: {callbacks: {label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`}},
        title: {
          display: true,
          text: (
            variable === "_piod_total" ? "P(Positive IOD - any intensity) by Lead" :
            `P(${IOD_LABEL[variable] || variable}) by Lead`
          ),
        },
      },
    },
  });
}



document.addEventListener("DOMContentLoaded", () => {
  // Populate the forecast-source dropdown from the manifest (adds multi-system
  // C3S + XRO options that exist on disk). Falls back silently if the manifest
  // is missing, preserving the static dropdown.
  _populateSourceSelector();
  // Nav dropdowns + shared chrome (About link, mobile menu, footer) are handled
  // by site.js, which is loaded on every page (app.js is not).

  const page = document.body.dataset.page;
  if      (page === "forecast")          initForecastPage();
  else if (page === "hindcast_skill")    initHindcastPage();
  else if (page === "hindcast_explorer") { initEnsoHindcastMultiCentre().then(initEnsoHindcastPlumePage); }
});


// ── ENSO hindcast: per-centre member plumes ─────────────────────────────────

async function initEnsoHindcastPlumePage() {
  // Uses #enso-hx-year, #enso-hx-month from the overlay card; local vars:
  // variable <select id=hxp-variable>, canvas #hxp-chart, button via
  // window.updateEnsoHindcastPlume.
  const yearSel  = document.getElementById("enso-hx-year");
  const monthSel = document.getElementById("enso-hx-month");
  const varSel   = document.getElementById("hxp-variable");
  if (!yearSel || !monthSel || !varSel) return;
  // re-render on any control change
  yearSel.addEventListener("change", () => window.updateEnsoHindcastPlume());
  monthSel.addEventListener("change", () => window.updateEnsoHindcastPlume());
  varSel.addEventListener("change", () => window.updateEnsoHindcastPlume());
  await window.updateEnsoHindcastPlume();
}

window._ensoPlumeCache = {};  // key: src_m{MM} → JSON
async function _loadHindcastCentreFile(src, month) {
  const key = `${src}_m${String(month).padStart(2,"0")}`;
  if (window._ensoPlumeCache[key] !== undefined) return window._ensoPlumeCache[key];
  // Through _dataURL like every other hindcast read, or this one fetch keeps
  // asking the page origin for a file that now lives in the bucket.
  const rel = src === "seas5"
    ? `hindcast/m${String(month).padStart(2, "0")}.json`
    : `hindcast/${src}_m${String(month).padStart(2, "0")}.json`;
  const path = _dataURL(rel);
  try {
    const heavy = !!(window.ENSOSCOPE_DATA_BASE && HX_HEAVY.test(rel));
    const r = await fetch(_dv(path), heavy ? {} : {cache: "no-cache"});
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    window._ensoPlumeCache[key] = j;
    return j;
  } catch (e) {
    console.warn("plume fetch failed", path, e);
    window._ensoPlumeCache[key] = null;
    return null;
  }
}

window.updateEnsoHindcastPlume = async function() {
  const canvas = document.getElementById("hxp-chart");
  if (!canvas) return;
  const yearSel  = document.getElementById("enso-hx-year");
  const monthSel = document.getElementById("enso-hx-month");
  const varSel   = document.getElementById("hxp-variable");
  if (!yearSel || !monthSel || !varSel) return;

  const year  = parseInt(yearSel.value || "1993", 10);
  const month = parseInt(monthSel.value || "1", 10);
  const variable = varSel.value || "nino34_std";

  if (window._ensoPlumeChart) {
    try { window._ensoPlumeChart.destroy(); } catch (_) {}
    window._ensoPlumeChart = null;
  }

  const selected = [...(window._ensoHxSelected || new Set())];
  if (!selected.length) return;

  // Load per-centre JSON files in parallel
  const files = await Promise.all(selected.map(src => _loadHindcastCentreFile(src, month)));

  const labels = [];  // lead valid times from first available centre
  const datasets = [];
  const _plotted = [];    // centres with rows actually drawn
  const _missing = [];    // [{src, reason}] for transparency banner
  let obsMedian = null; // future

  for (let i = 0; i < selected.length; i++) {
    const src = selected[i];
    const f = files[i];
    if (!f) { _missing.push({src, reason: "JSON file missing or failed to load"}); continue; }
    const yrs = f.years || {};
    const members = yrs[String(year)];
    if (!members) {
      const avail = Object.keys(yrs).sort();
      const last  = avail.length ? avail[avail.length - 1] : "none";
      _missing.push({src, reason: `no ${year} init in JSON (has ${avail.length} yrs, latest ${last})`});
      continue;
    }
    _plotted.push(src);
    const colour = (typeof CENTRE_COLOR === "object" ? CENTRE_COLOR : {})[src] || "#888";

    // Build valid_time labels from first member if not set
    const firstMemKey = Object.keys(members)[0];
    if (firstMemKey && !labels.length) {
      for (const row of members[firstMemKey]) labels.push(row.valid_time || "");
    }

    // Individual member lines - thin, transparent, coloured by centre
    for (const mem of Object.keys(members)) {
      const arr = members[mem].map(r => (r ? (r[variable] == null ? null : r[variable]) : null));
      datasets.push({
        label: undefined,        // hide individual in legend
        data: arr,
        borderColor: colour + "40",  // alpha
        backgroundColor: "transparent",
        borderWidth: 0.7,
        pointRadius: 0,
        tension: 0.25,
        showLine: true,
        _isMemberLine: true,
        _centre: src,
      });
    }

    // Ensemble median overlay (thick, labelled)
    const nLead = labels.length;
    const med = new Array(nLead).fill(null);
    for (let L = 0; L < nLead; L++) {
      const vals = [];
      for (const mem of Object.keys(members)) {
        const v = members[mem][L] ? members[mem][L][variable] : null;
        if (v != null && isFinite(v)) vals.push(v);
      }
      if (vals.length) {
        vals.sort((a,b)=>a-b);
        med[L] = vals[Math.floor(vals.length/2)];
      }
    }
    datasets.push({
      label: (CENTRE_SHORT[src] || src) + " median",
      data: med,
      borderColor: colour,
      backgroundColor: colour,
      borderWidth: 3,
      pointRadius: 3,
      tension: 0.25,
      showLine: true,
      _centre: src,
    });
  }

  // Chart.js rendering
  window._ensoPlumeChart = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {labels, datasets},
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: {mode: "nearest", intersect: false},
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            filter: (item, data) => !data.datasets[item.datasetIndex]._isMemberLine,
          },
          // When the user clicks a centre legend, toggle BOTH its median line
          // AND all its member lines so the whole centre disappears.
          onClick: _makeLegendCentreToggle(),
        },
        tooltip: {callbacks: {
          label: ctx => `${ctx.dataset.label || "member"}: ${ctx.parsed.y == null ? "n/a" : ctx.parsed.y.toFixed(2)}`,
        }},
      },
      scales: {
        x: {title: {display: true, text: "Valid month"}},
        y: {title: {display: true, text: variable}},
      },
    },
  });

  const title = document.getElementById("hxp-chart-title");
  if (title) title.textContent =
    `Multi-centre member plumes - ${year}-${String(month).padStart(2,"0")} init - ${variable}`;
  _renderPlumeCoverageBanner({
    hostId: "hxp-coverage-banner",
    insertAfter: "hxp-chart-title",
    selected, plotted: _plotted, missing: _missing,
    contextLabel: `${year}-${String(month).padStart(2,"0")} init`,
  });
};

// Render a small banner under each plume chart reporting
//   "N of M centres plotted; missing: X (reason), Y (reason)"
// so the site self-reports gaps instead of silently dropping them.
function _renderPlumeCoverageBanner({hostId, insertAfter, selected, plotted, missing, contextLabel}) {
  let el = document.getElementById(hostId);
  if (!el) {
    el = document.createElement("div");
    el.id = hostId;
    el.className = "plume-coverage-banner";
    const anchor = document.getElementById(insertAfter);
    if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(el, anchor.nextSibling);
  }
  _ensurePlumeCoverageBannerStyles();
  const nPlotted = plotted.length, nSel = selected.length;
  const ok = nPlotted === nSel;
  const missList = missing.map(m =>
    `<span><strong style="color:${CENTRE_COLOR[m.src] || '#555'}">${CENTRE_SHORT[m.src] || m.src}</strong> - ${m.reason}</span>`
  ).join(" · ");
  el.innerHTML =
    `<div class="pcb ${ok ? 'ok' : 'warn'}">` +
    `<strong>${nPlotted} of ${nSel} centres plotted</strong>` +
    ` for ${contextLabel}` +
    (missing.length
       ? ` &middot; <span class="pcb-missing">missing: ${missList}</span>`
       : ` &middot; all requested centres present`) +
    `</div>`;
}

function _ensurePlumeCoverageBannerStyles() {
  if (document.getElementById("plume-coverage-banner-styles")) return;
  const s = document.createElement("style");
  s.id = "plume-coverage-banner-styles";
  s.textContent = `
    .plume-coverage-banner { margin:0.3rem 0 0.5rem }
    .pcb { font-size:0.78rem;padding:0.4rem 0.7rem;border-radius:4px;border:1px solid var(--border);color:var(--text) }
    .pcb.ok   { background:#f3fbf5;border-color:#b3d8c2 }
    .pcb.warn { background:#fff6ec;border-color:#f5c48a }
    .pcb-missing span { margin-right:0.5rem }
  `;
  document.head.appendChild(s);
}


// ── IOD hindcast: per-centre member plumes ──────────────────────────────────


window.updateIodHindcastPlume = async function() {
  const canvas = document.getElementById("iodhxp-chart");
  if (!canvas) return;
  const yearSel  = document.getElementById("iod-hx-year");
  const monthSel = document.getElementById("iod-hx-month");
  const varSel   = document.getElementById("iodhxp-variable");
  if (!yearSel || !monthSel || !varSel) return;

  const year  = parseInt(yearSel.value || "1993", 10);
  const month = parseInt(monthSel.value || "1", 10);
  const variable = varSel.value || "iod_std";

  if (window._iodPlumeChart) {
    try { window._iodPlumeChart.destroy(); } catch (_) {}
    window._iodPlumeChart = null;
  }

  const selected = [...(window._iodHxSelected || new Set())];
  if (!selected.length) return;

  const files = await Promise.all(selected.map(src => _loadHindcastCentreFile(src, month)));

  const labels = [];
  const datasets = [];
  const _plotted = [], _missing = [];
  for (let i = 0; i < selected.length; i++) {
    const src = selected[i];
    const f = files[i];
    if (!f) { _missing.push({src, reason: "JSON missing or failed to load"}); continue; }
    const yrs = f.years || {};
    const members = yrs[String(year)];
    if (!members) {
      const avail = Object.keys(yrs).sort();
      const last = avail.length ? avail[avail.length - 1] : "none";
      _missing.push({src, reason: `no ${year} init (has ${avail.length} yrs, latest ${last})`});
      continue;
    }
    _plotted.push(src);
    const colour = (typeof CENTRE_COLOR === "object" ? CENTRE_COLOR : {})[src] || "#888";

    const firstMemKey = Object.keys(members)[0];
    if (firstMemKey && !labels.length) {
      for (const row of members[firstMemKey]) labels.push(row.valid_time || "");
    }

    for (const mem of Object.keys(members)) {
      const arr = members[mem].map(r => (r ? (r[variable] == null ? null : r[variable]) : null));
      datasets.push({
        label: undefined,
        data: arr,
        borderColor: colour + "40",
        backgroundColor: "transparent",
        borderWidth: 0.7,
        pointRadius: 0,
        tension: 0.25,
        showLine: true,
        _isMemberLine: true,
        _centre: src,
      });
    }

    const nLead = labels.length;
    const med = new Array(nLead).fill(null);
    for (let L = 0; L < nLead; L++) {
      const vals = [];
      for (const mem of Object.keys(members)) {
        const v = members[mem][L] ? members[mem][L][variable] : null;
        if (v != null && isFinite(v)) vals.push(v);
      }
      if (vals.length) {
        vals.sort((a,b)=>a-b);
        med[L] = vals[Math.floor(vals.length/2)];
      }
    }
    datasets.push({
      label: (CENTRE_SHORT[src] || src) + " median",
      data: med,
      borderColor: colour,
      backgroundColor: colour,
      borderWidth: 3,
      pointRadius: 3,
      tension: 0.25,
      showLine: true,
      _centre: src,
    });
  }

  window._iodPlumeChart = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {labels, datasets},
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: {mode: "nearest", intersect: false},
      plugins: {
        legend: {
          position: "bottom",
          labels: {filter: (item, data) => !data.datasets[item.datasetIndex]._isMemberLine},
          onClick: _makeLegendCentreToggle(),
        },
        tooltip: {callbacks: {
          label: ctx => `${ctx.dataset.label || "member"}: ${ctx.parsed.y == null ? "n/a" : ctx.parsed.y.toFixed(2)}`,
        }},
      },
      scales: {
        x: {title: {display: true, text: "Valid month"}},
        y: {title: {display: true, text: variable}},
      },
    },
  });
  const title = document.getElementById("iodhxp-chart-title");
  if (title) title.textContent =
    `Multi-centre IOD member plumes - ${year}-${String(month).padStart(2,"0")} init - ${variable}`;
  _renderPlumeCoverageBanner({
    hostId: "iodhxp-coverage-banner",
    insertAfter: "iodhxp-chart-title",
    selected, plotted: _plotted, missing: _missing,
    contextLabel: `${year}-${String(month).padStart(2,"0")} init`,
  });
};


// ── Forecast members plume: shared helper ───────────────────────────────────

async function _loadForecastMembersForCentre(src, iod) {
  const file = iod ? `forecast_iod_members_${src}.json` : `forecast_members_${src}.json`;
  // SEAS5 ENSO uses the legacy name
  const url = (!iod && src === "seas5") ? DATA_BASE + "forecast_members.json" : DATA_BASE + file;
  try {
    const r = await fetch(_dv(url), {cache: "no-cache"});
    if (!r.ok) return null;
    return await r.json();
  } catch (_) {
    return null;
  }
}

function _getSelectedForecastSources() {
  const body = document.getElementById("forecast-multi-selector-body")
            || document.getElementById("iod-multi-selector-body");
  if (!body) return [];
  const out = [];
  body.querySelectorAll("input[type=checkbox]:checked").forEach(cb => out.push(cb.value));
  return out;
}

async function _renderForecastMembersPlume({canvasId, titleLabel, variable, iod}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const prevKey = iod ? "_iodFcMembersChart" : "_ensoFcMembersChart";
  if (window[prevKey]) {
    try { window[prevKey].destroy(); } catch (_) {}
    window[prevKey] = null;
  }
  const sources = _getSelectedForecastSources();
  if (!sources.length) return;

  const perCentre = await Promise.all(sources.map(src => _loadForecastMembersForCentre(src, iod)));

  // Find a current vintage from the first available
  let currentVintage = null;
  for (const j of perCentre) {
    if (j && j.vintages && j.vintages.length) {
      currentVintage = j.vintages[j.vintages.length - 1];
      break;
    }
  }
  if (!currentVintage) return;

  const labels = [];
  const datasets = [];
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const j = perCentre[i];
    if (!j) continue;
    const members = (j.by_start || {})[currentVintage];
    if (!members) continue;
    const colour = CENTRE_COLOR[src] || "#888";

    // Build labels from the first member's lead rows (same across members)
    if (!labels.length) {
      const firstMem = members[Object.keys(members)[0]];
      if (firstMem) {
        for (const row of firstMem) labels.push(_formatValidMonth(row.valid_time));
      }
    }

    // Per-member lines (thin, translucent)
    for (const mem of Object.keys(members)) {
      const arr = members[mem].map(r => (r ? (r[variable] == null ? null : r[variable]) : null));
      datasets.push({
        label: undefined,
        data: arr,
        borderColor: colour + "40",
        backgroundColor: "transparent",
        borderWidth: 0.7,
        pointRadius: 0,
        tension: 0.25,
        showLine: true,
        _isMemberLine: true,
        _centre: src,
      });
    }

    // Ensemble median overlay per centre
    const nLead = labels.length;
    const med = new Array(nLead).fill(null);
    for (let L = 0; L < nLead; L++) {
      const vals = [];
      for (const mem of Object.keys(members)) {
        const v = members[mem][L] ? members[mem][L][variable] : null;
        if (v != null && isFinite(v)) vals.push(v);
      }
      if (vals.length) {
        vals.sort((a,b)=>a-b);
        med[L] = vals[Math.floor(vals.length / 2)];
      }
    }
    datasets.push({
      label: (CENTRE_SHORT[src] || src) + " median",
      data: med,
      borderColor: colour,
      backgroundColor: colour,
      borderWidth: 3,
      pointRadius: 3,
      tension: 0.25,
      showLine: true,
      _centre: src,
    });
  }

  window[prevKey] = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {labels, datasets},
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: {mode: "nearest", intersect: false},
      plugins: {
        legend: {
          position: "bottom",
          labels: {filter: (item, data) => !data.datasets[item.datasetIndex]._isMemberLine},
          onClick: _makeLegendCentreToggle(),
        },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label || "member"}: ${ctx.parsed.y == null ? "n/a" : ctx.parsed.y.toFixed(2)}`,
          },
        },
      },
      scales: {
        x: {title: {display: true, text: `Valid month (init ${currentVintage})`}},
        y: {title: {display: true, text: variable}},
      },
    },
  });
}

window.updateForecastMembersPlume = async function() {
  const variable = document.getElementById("fc-members-variable")?.value || "nino34_std";
  await _renderForecastMembersPlume({canvasId: "fc-members-chart", variable, iod: false});
};
window.updateIodForecastMembersPlume = async function() {
  const variable = document.getElementById("fc-iod-members-variable")?.value || "iod_std";
  await _renderForecastMembersPlume({canvasId: "fc-iod-members-chart", variable, iod: true});
};

// Bind auto-updates when variables change + initial draw on page load
document.addEventListener("DOMContentLoaded", () => {
  const enso = document.getElementById("fc-members-variable");
  if (enso) {
    enso.addEventListener("change", () => window.updateForecastMembersPlume());
    // Defer first draw until the selector cards are rendered + user picked centres
    setTimeout(() => window.updateForecastMembersPlume(), 1500);
  }
  const iod = document.getElementById("fc-iod-members-variable");
  if (iod) {
    iod.addEventListener("change", () => window.updateIodForecastMembersPlume());
    setTimeout(() => window.updateIodForecastMembersPlume(), 1500);
  }
});
