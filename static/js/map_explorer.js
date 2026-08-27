/* map_explorer.js - Orthographic globe choropleth for ENSO rainfall indicators
 *
 * Architecture:
 *   - D3 v7 orthographic projection with drag-to-rotate and scroll-to-zoom
 *   - Data rendered on a <canvas> element (fast, handles 150k cells)
 *   - Country/graticule borders rendered as SVG on top (crisp lines)
 *   - Tile format: { meta, scale, lats[], lons[], ri[], ci[], v[] } (sparse ×10)
 *   - Drill-down: World → region → country via click on SVG country layer
 */

"use strict";

// ── Where the heavy tiles come from ───────────────────────────────────────────
//
// Same split event_replay.js uses: the phase-composite tiles and their shared
// grids are rebased onto window.ENSOSCOPE_DATA_BASE, everything else stays on
// the page's own origin. This tab is the biggest consumer of data/maps, 243 MB,
// so until it went through here that directory could not leave the page host at
// all and the migration only moved a third of what it was supposed to.
//
// The Natural Earth basemaps are deliberately NOT routed through this: they are
// static, shared with forecast_maps.js and emdat_backtest.html, and must resolve
// to the same place for all of them.
//
// The version string replaces a `cache: "no-store"` that used to sit on both
// fetches. On the page's own host that was merely wasteful; against a metered
// bucket it is the expensive mistake, because reads are the operation that grows
// with traffic and no-store means every visitor re-fetches every tile. Versioned
// URLs plus the bucket's one-year immutable header make hard caching safe: a
// rebuild changes the URL rather than the object.
function _tileURL(path) {
  const base = (typeof window !== "undefined" && window.ENSOSCOPE_DATA_BASE) || "";
  const v = (typeof window !== "undefined" && window.ENSOSCOPE_DATA_VERSION) || "";
  return (base ? base.replace(/\/+$/, "") + "/" : "") + path + (v ? "?v=" + v : "");
}

// ── Colorscale definitions ────────────────────────────────────────────────────

const CMAPS = {
  RdBu: [
    [0,    [178,24,43]],
    [0.1,  [214,96,77]],
    [0.25, [244,165,130]],
    [0.4,  [253,219,199]],
    [0.5,  [247,247,247]],
    [0.6,  [209,229,240]],
    [0.75, [146,197,222]],
    [0.9,  [67,147,195]],
    [1,    [33,102,172]],
  ],
  RdBu_r: [
    [0,    [33,102,172]],
    [0.1,  [67,147,195]],
    [0.25, [146,197,222]],
    [0.4,  [209,229,240]],
    [0.5,  [247,247,247]],
    [0.6,  [253,219,199]],
    [0.75, [244,165,130]],
    [0.9,  [214,96,77]],
    [1,    [178,24,43]],
  ],
  Blues: [
    [0,    [247,251,255]],
    [0.25, [198,219,239]],
    [0.5,  [107,174,214]],
    [0.75, [33,113,181]],
    [1,    [8,48,107]],
  ],
  YlOrBr_r: [
    [0,    [140,81,10]],
    [0.25, [191,129,45]],
    [0.5,  [223,194,125]],
    [0.75, [246,232,195]],
    [1,    [255,255,229]],
  ],
  // Sequential ramps for the "absolute" layers: pale at the low end, dark at the
  // high end. CDD rises with dryness and WBGT/UTCI/heatwave-days rise with heat,
  // so darker always means worse. Do NOT swap these for a diverging map: an
  // absolute field has no zero to diverge about.
  YlOrBr: [
    [0,    [255,255,229]],
    [0.25, [254,227,145]],
    [0.5,  [254,153,41]],
    [0.75, [204,76,2]],
    [1,    [102,37,6]],
  ],
  YlOrRd: [
    [0,    [255,255,204]],
    [0.25, [254,217,118]],
    [0.5,  [253,141,60]],
    [0.75, [227,26,28]],
    [1,    [128,0,38]],
  ],
};

function interpolateColor(cmap, t) {
  // Fall back loudly: a missing entry used to silently render an absolute field
  // on a diverging RdBu ramp, which inverts its meaning (2026-07-21).
  if (!CMAPS[cmap]) console.warn(`map_explorer: unknown colormap "${cmap}", falling back to RdBu`);
  const stops = CMAPS[cmap] || CMAPS.RdBu;
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const t0 = stops[i-1][0], t1 = stops[i][0];
      const f = (t - t0) / (t1 - t0);
      const c0 = stops[i-1][1], c1 = stops[i][1];
      return [
        Math.round(c0[0] + f*(c1[0]-c0[0])),
        Math.round(c0[1] + f*(c1[1]-c0[1])),
        Math.round(c0[2] + f*(c1[2]-c0[2])),
      ];
    }
  }
  return stops[stops.length-1][1];
}

// ── Geographic hierarchy ──────────────────────────────────────────────────────

const GEO_HIERARCHY = {
  id: "world", label: "World",
  center: [0, 20], scale: null,   // scale=null → fit to container
  subregions: [
    {
      id: "north_america", label: "North America",
      center: [-100, 40], scale: 400,
      countries: [
        { id: "north_america_regional", label: "Regional",  regionmask: null },
        { id: "usa",     label: "USA",     regionmask: "United States of America" },
        { id: "mexico",  label: "Mexico",  regionmask: "Mexico" },
      ],
    },
    {
      id: "central_america", label: "Central America",
      center: [-85, 12], scale: 1200,
      countries: [
        { id: "central_america_regional", label: "Regional",    regionmask: null },
        { id: "guatemala",   label: "Guatemala",   regionmask: "Guatemala" },
        { id: "belize",      label: "Belize",      regionmask: "Belize" },
        { id: "honduras",    label: "Honduras",    regionmask: "Honduras" },
        { id: "el_salvador", label: "El Salvador", regionmask: "El Salvador" },
        { id: "nicaragua",   label: "Nicaragua",   regionmask: "Nicaragua" },
        { id: "costa_rica",  label: "Costa Rica",  regionmask: "Costa Rica" },
        { id: "panama",      label: "Panama",      regionmask: "Panama" },
      ],
    },
    {
      id: "caribbean", label: "Caribbean",
      center: [-72, 18], scale: 1400,
      countries: [
        { id: "caribbean_regional",  label: "Regional",         regionmask: null },
        { id: "cuba",                label: "Cuba",              regionmask: "Cuba" },
        { id: "haiti",               label: "Haiti",             regionmask: "Haiti" },
        { id: "dominican_republic",  label: "Dominican Rep.",    regionmask: "Dominican Rep." },
        { id: "jamaica",             label: "Jamaica",           regionmask: "Jamaica" },
        { id: "puerto_rico",         label: "Puerto Rico",       regionmask: "Puerto Rico" },
        { id: "trinidad",            label: "Trinidad & Tobago", regionmask: "Trinidad and Tobago" },
      ],
    },
    {
      id: "south_america", label: "South America",
      center: [-58, -15], scale: 500,
      countries: [
        { id: "south_america_regional", label: "Regional",  regionmask: null },
        { id: "colombia",  label: "Colombia",  regionmask: "Colombia" },
        { id: "venezuela", label: "Venezuela", regionmask: "Venezuela" },
        { id: "ecuador",   label: "Ecuador",   regionmask: "Ecuador" },
        { id: "peru",      label: "Peru",      regionmask: "Peru" },
        { id: "brazil",    label: "Brazil",    regionmask: "Brazil" },
        { id: "bolivia",   label: "Bolivia",   regionmask: "Bolivia" },
        { id: "argentina", label: "Argentina", regionmask: "Argentina" },
        { id: "chile",     label: "Chile",     regionmask: "Chile" },
        { id: "paraguay",  label: "Paraguay",  regionmask: "Paraguay" },
        { id: "uruguay",   label: "Uruguay",   regionmask: "Uruguay" },
      ],
    },
    {
      id: "africa", label: "Africa",
      center: [20, 5], scale: 450,
      countries: [
        { id: "africa_regional",   label: "Regional",      regionmask: null },
        { id: "ethiopia",          label: "Ethiopia",       regionmask: "Ethiopia" },
        { id: "kenya",             label: "Kenya",          regionmask: "Kenya" },
        { id: "tanzania",          label: "Tanzania",       regionmask: "Tanzania" },
        { id: "mozambique",        label: "Mozambique",     regionmask: "Mozambique" },
        { id: "zimbabwe",          label: "Zimbabwe",       regionmask: "Zimbabwe" },
        { id: "zambia",            label: "Zambia",         regionmask: "Zambia" },
        { id: "angola",            label: "Angola",         regionmask: "Angola" },
        { id: "south_africa",      label: "South Africa",   regionmask: "South Africa" },
        { id: "nigeria",           label: "Nigeria",        regionmask: "Nigeria" },
        { id: "ghana",             label: "Ghana",          regionmask: "Ghana" },
        { id: "senegal",           label: "Senegal",        regionmask: "Senegal" },
        { id: "madagascar",        label: "Madagascar",     regionmask: "Madagascar" },
        { id: "somalia",           label: "Somalia",        regionmask: "Somalia" },
        { id: "sudan",             label: "Sudan",          regionmask: "Sudan" },
        { id: "south_sudan",       label: "South Sudan",    regionmask: "S. Sudan" },
        { id: "uganda",            label: "Uganda",         regionmask: "Uganda" },
        { id: "rwanda",            label: "Rwanda",         regionmask: "Rwanda" },
        { id: "burundi",           label: "Burundi",        regionmask: "Burundi" },
        { id: "dr_congo",          label: "DR Congo",       regionmask: "Dem. Rep. Congo" },
        { id: "car",               label: "Central African Rep.", regionmask: "Central African Rep." },
        { id: "niger",             label: "Niger",          regionmask: "Niger" },
        { id: "mali",              label: "Mali",           regionmask: "Mali" },
        { id: "chad",              label: "Chad",           regionmask: "Chad" },
        { id: "burkina_faso",      label: "Burkina Faso",   regionmask: "Burkina Faso" },
        { id: "malawi",            label: "Malawi",         regionmask: "Malawi" },
      ],
    },
    {
      id: "south_asia", label: "South Asia",
      center: [78, 22], scale: 700,
      countries: [
        { id: "south_asia_regional", label: "Regional",    regionmask: null },
        { id: "india",               label: "India",        regionmask: "India" },
        { id: "pakistan",            label: "Pakistan",     regionmask: "Pakistan" },
        { id: "afghanistan",         label: "Afghanistan",  regionmask: "Afghanistan" },
        { id: "bangladesh",          label: "Bangladesh",   regionmask: "Bangladesh" },
        { id: "sri_lanka",           label: "Sri Lanka",    regionmask: "Sri Lanka" },
        { id: "nepal",               label: "Nepal",        regionmask: "Nepal" },
      ],
    },
    {
      id: "southeast_asia", label: "Southeast Asia",
      center: [115, 5], scale: 600,
      countries: [
        { id: "southeast_asia_regional", label: "Regional",   regionmask: null },
        { id: "indonesia",               label: "Indonesia",   regionmask: "Indonesia" },
        { id: "philippines",             label: "Philippines", regionmask: "Philippines" },
        { id: "vietnam",                 label: "Vietnam",     regionmask: "Vietnam" },
        { id: "thailand",                label: "Thailand",    regionmask: "Thailand" },
        { id: "myanmar",                 label: "Myanmar",     regionmask: "Myanmar" },
        { id: "malaysia",                label: "Malaysia",    regionmask: "Malaysia" },
        { id: "cambodia",                label: "Cambodia",    regionmask: "Cambodia" },
        { id: "laos",                    label: "Laos",        regionmask: "Laos" },
        { id: "papua_new_guinea",        label: "Papua NG",    regionmask: "Papua New Guinea" },
      ],
    },
    {
      id: "east_asia", label: "East Asia & Pacific",
      center: [135, 25], scale: 450,
      countries: [
        { id: "east_asia_regional", label: "Regional",   regionmask: null },
        { id: "china",              label: "China",       regionmask: "China" },
        { id: "japan",              label: "Japan",       regionmask: "Japan" },
        { id: "australia",          label: "Australia",   regionmask: "Australia" },
        { id: "new_zealand",        label: "New Zealand", regionmask: "New Zealand" },
        { id: "south_korea",        label: "South Korea", regionmask: "South Korea" },
      ],
    },
    {
      id: "middle_east", label: "Middle East",
      center: [45, 27], scale: 700,
      countries: [
        { id: "middle_east_regional", label: "Regional",     regionmask: null },
        { id: "saudi_arabia",         label: "Saudi Arabia",  regionmask: "Saudi Arabia" },
        { id: "iran",                 label: "Iran",          regionmask: "Iran" },
        { id: "iraq",                 label: "Iraq",          regionmask: "Iraq" },
        { id: "turkey",               label: "Turkey",        regionmask: "Turkey" },
        { id: "yemen",                label: "Yemen",         regionmask: "Yemen" },
        { id: "syria",                label: "Syria",         regionmask: "Syria" },
      ],
    },
    {
      id: "europe", label: "Europe",
      center: [15, 52], scale: 700,
      countries: [
        { id: "europe_regional",  label: "Regional",    regionmask: null },
        { id: "spain",            label: "Spain",        regionmask: "Spain" },
        { id: "france",           label: "France",       regionmask: "France" },
        { id: "italy",            label: "Italy",        regionmask: "Italy" },
        { id: "germany",          label: "Germany",      regionmask: "Germany" },
        { id: "portugal",         label: "Portugal",     regionmask: "Portugal" },
        { id: "greece",           label: "Greece",       regionmask: "Greece" },
        { id: "uk",               label: "UK",           regionmask: "United Kingdom" },
      ],
    },
  ],
};

// Flatten for quick lookup
const _geoById = {};
_geoById[GEO_HIERARCHY.id] = GEO_HIERARCHY;
for (const sub of GEO_HIERARCHY.subregions) {
  _geoById[sub.id] = sub;
  for (const c of sub.countries) _geoById[c.id] = c;
}

const OBS_SUBREGIONS = new Set(["north_america","central_america","caribbean","south_america"]);


// ── Tile loading & caching ────────────────────────────────────────────────────

const _tileCache = {};

async function loadTile(source, season, phase, variable) {
  // ERA5 heat/vector tiles are written to obs_<...>.json (single observational layer).
  const filePrefix = (source === "era5") ? "obs" : source;
  const key = `${filePrefix}_${season}_${phase}_${variable}`;
  const cacheKey = `${source}|${key}`;
  if (_tileCache[cacheKey]) return _tileCache[cacheKey];
  const r = await fetch(_tileURL(`data/maps/${key}.json`));
  if (!r.ok) throw new Error(`Tile not found: ${key}.json`);
  const tile = await r.json();
  await _attachGrid(tile);
  _tileCache[cacheKey] = tile;
  return _tileCache[cacheKey];
}

// Coordinates and land-cell indices live in a shared grid file instead of being
// repeated in every tile: they were 52-54% of each file and identical across
// every tile sharing a land mask (1904 tiles, 5 distinct grids, 382 MB of
// duplication). One grid is fetched per session and reused, which also avoids
// re-parsing 150k coordinates on every layer change.
//
// Tiles that still carry lats/lons/ri/ci inline are passed through untouched,
// so old and new tiles can coexist during a rollout.
const _gridCache = {};

async function _attachGrid(tile) {
  if (!tile || !tile.grid || tile.ri) return tile;
  const gid = tile.grid;
  if (!_gridCache[gid]) {
    _gridCache[gid] = (async () => {
      const g = await fetch(_tileURL(`data/maps/grids/${gid}.json`));
      if (!g.ok) throw new Error(`Grid not found: ${gid}.json`);
      return g.json();
    })();
  }
  const grid = await _gridCache[gid];
  tile.lats = grid.lats;
  tile.lons = grid.lons;
  tile.ri = grid.ri;
  tile.ci = grid.ci;
  if (tile.v && tile.v.length !== tile.ri.length) {
    // Refuse to render rather than paint values into the wrong cells.
    throw new Error(`Grid ${gid} has ${tile.ri.length} cells but tile `
                    + `${tile.meta && tile.meta.variable} has ${tile.v.length} values`);
  }
  return tile;
}


// ── Colorbar ─────────────────────────────────────────────────────────────────

function renderColorbar(meta) {
  const { label, units, cmap, vmax, symmetric, vmin } = meta;
  const _vmin = symmetric ? -Math.abs(vmax) : (vmin != null ? vmin : 0);
  const _vmax = symmetric ?  Math.abs(vmax) : vmax;

  document.getElementById("colorbar-title").textContent = `${label} (${units})`;

  const canvas = document.getElementById("colorbar-bar");
  const W = canvas.offsetWidth || 180;
  canvas.width = W;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, canvas.height);
  for (let x = 0; x < W; x++) {
    const [R, G, B] = interpolateColor(cmap, x / (W - 1));
    ctx.fillStyle = `rgb(${R},${G},${B})`;
    ctx.fillRect(x, 0, 1, canvas.height);
  }

  const fmt = n => Number.isInteger(n) ? String(n) : n.toFixed(1);
  document.getElementById("cb-min").textContent = fmt(_vmin);
  document.getElementById("cb-mid").textContent = fmt(symmetric ? 0 : (_vmin + _vmax) / 2);
  document.getElementById("cb-max").textContent = fmt(_vmax);
}


// ── Globe state ───────────────────────────────────────────────────────────────

let _projection, _pathGen, _canvas, _ctx, _svg, _W, _H;
let _projectionKind = "orthographic";

// Build a d3 projection by name with canvas-aware defaults.
function _buildProjection(kind) {
  let p;
  if (kind === "robinson") {
    if (typeof d3.geoRobinson === "function") {
      p = d3.geoRobinson();
    } else {
      p = d3.geoEqualEarth();
      kind = "equalEarth";
    }
    p.scale(_W / 5.1).translate([_W / 2, _H / 2]).rotate([0, 0]);
  } else if (kind === "naturalEarth" && typeof d3.geoNaturalEarth1 === "function") {
    p = d3.geoNaturalEarth1().scale(_W / 5.8).translate([_W / 2, _H / 2]).rotate([0, 0]);
  } else {
    p = d3.geoOrthographic()
          .scale(_W / 2 - 10)
          .translate([_W / 2, _H / 2])
          .clipAngle(90)
          .rotate([0, -20]);
    kind = "orthographic";
  }
  _projectionKind = kind;
  return p;
}
let _currentTile = null;
let _maskFeature = null;   // GeoJSON feature for current country mask (or null)
let _drillLevel = 0;
let _subregionId = null;
let _countryId = null;
let _countriesGeoJSON = null;
let _showStippling = true;   // toggle for robustness stippling
let _probThreshold = 30;     // hide prob_ratio pixels with |value| < this % (0 = show all)
let _currentHazard = "wet"; // "wet" or "dry"
let _forecastData = null;   // cached forecast.json

// ── Variable options per hazard type ─────────────────────────────────────────

const VARIABLE_OPTIONS = {
  // 2026-06-23: simplified to anomaly + absolute only (prob-ratio layers removed);
  // frost days removed (heat-focused).
  // Base names come from index_names.js so this tab and the Replay tab cannot
  // drift apart again; only the " - anomaly/absolute" suffix is local.
  wet: [
    { value: "rx10day_anomaly",      label: `${window.ensoIndexName("rx10day")} - anomaly vs neutral` },
    { value: "rx10day_absolute",     label: `${window.ensoIndexName("rx10day")} - absolute mean` },
  ],
  dry: [
    { value: "cdd_anomaly",    label: `${window.ensoIndexName("cdd")} - anomaly vs neutral` },
    { value: "cdd_absolute",   label: `${window.ensoIndexName("cdd")} - absolute mean` },
  ],
  heat: [
    { value: "wbgt_max_anomaly",    label: "WBGT (heat-stress) - anomaly vs neutral" },
    { value: "wbgt_max_absolute",   label: "WBGT - absolute mean" },
    { value: "utci_max_anomaly",    label: "UTCI (universal heat-stress) - anomaly vs neutral" },
    { value: "utci_max_absolute",   label: "UTCI - absolute mean" },
    { value: "tmax_anomaly",        label: `${window.ensoIndexName("tmax")} - anomaly vs neutral` },
    { value: "tmax_absolute",       label: `${window.ensoIndexName("tmax")} - absolute mean` },
    { value: "hw_days_anomaly",     label: "Daytime heatwave days - anomaly vs neutral" },
    { value: "hw_days_absolute",    label: "Daytime heatwave days - absolute" },
    { value: "hw_nights_anomaly",   label: "Nighttime heatwave days - anomaly vs neutral" },
    { value: "hw_nights_absolute",  label: "Nighttime heatwave days - absolute" },
    { value: "hw_compound_anomaly", label: "Compound (day+night) heatwave days - anomaly vs neutral" },
    { value: "hw_compound_absolute",label: "Compound (day+night) heatwave days - absolute" },
    // Fixed-temperature health thresholds (Aug 2026). Grouped after the
    // percentile-based layers, and labelled with the actual cut-off so the
    // reader never has to guess what "strong" means. See methodology.html
    // #heat-thresholds for why the absolute counts are ERA5-first.
    { value: "utci_strong_absolute",      label: "Days with UTCI 32 to 38 °C - absolute" },
    { value: "utci_strong_anomaly",       label: "Days with UTCI 32 to 38 °C - anomaly vs neutral" },
    { value: "utci_vstrong_absolute",     label: "Days with UTCI 38 to 46 °C - absolute" },
    { value: "utci_vstrong_anomaly",      label: "Days with UTCI 38 to 46 °C - anomaly vs neutral" },
    { value: "utci_extreme_absolute",     label: "Days with UTCI 46 °C and above - absolute" },
    { value: "utci_extreme_anomaly",      label: "Days with UTCI 46 °C and above - anomaly vs neutral" },
    { value: "wbgt_strong_absolute",      label: "Days with WBGT 29 to 31 °C - absolute" },
    { value: "wbgt_strong_anomaly",       label: "Days with WBGT 29 to 31 °C - anomaly vs neutral" },
    { value: "wbgt_vstrong_absolute",     label: "Days with WBGT 31 to 32 °C - absolute" },
    { value: "wbgt_vstrong_anomaly",      label: "Days with WBGT 31 to 32 °C - anomaly vs neutral" },
    { value: "wbgt_extreme_absolute",     label: "Days with WBGT 32 °C and above - absolute" },
    { value: "wbgt_extreme_anomaly",      label: "Days with WBGT 32 °C and above - anomaly vs neutral" },
    { value: "night_tropical_absolute",   label: "Nights 20 to 25 °C (tropical) - absolute" },
    { value: "night_tropical_anomaly",    label: "Nights 20 to 25 °C (tropical) - anomaly vs neutral" },
    { value: "night_equatorial_absolute", label: "Nights 25 to 30 °C (equatorial) - absolute" },
    { value: "night_equatorial_anomaly",  label: "Nights 25 to 30 °C (equatorial) - anomaly vs neutral" },
    { value: "night_torrid_absolute",     label: "Nights 30 °C and above (torrid) - absolute" },
    { value: "night_torrid_anomaly",      label: "Nights 30 °C and above (torrid) - anomaly vs neutral" },
  ],
  // vector (dengue/malaria suitability) removed 2026-06-23 - teleconnections
  // tab keeps heat + precip metrics only.
};

function _rebuildVariableOptions() {
  const sel = document.getElementById("ctrl-variable");
  const prev = sel.value;
  sel.innerHTML = "";
  for (const opt of VARIABLE_OPTIONS[_currentHazard]) {
    const el = document.createElement("option");
    el.value = opt.value;
    el.textContent = opt.label;
    sel.appendChild(el);
  }
  // Restore previous selection if still valid for new hazard
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
}

// Hazards each source supports, ordered (first = default).
const _SOURCE_HAZARDS = {
  obs:   ["wet", "dry"],
  era5:  ["heat"],
  cesm2: ["wet", "dry", "heat"],
};

// The same table read the other way: which sources can answer a hazard, best
// first. THIS is the direction a reader thinks in.
//
// Heat used to be display:none unless you first set Source to ERA5, and the
// page opens on CHIRPS, which has no heat. So the only route to the heat maps
// was a dropdown you had no reason to touch, and MSF reported the heat maps as
// missing when all 270 layers per season were sitting there. Hazard is the
// QUESTION ("does El Nino make it hotter here?"); source is our answer to it.
// A control that hides the question until you have guessed the answer has it
// backwards.
const _HAZARD_SOURCES = {
  wet:  ["obs", "cesm2"],
  dry:  ["obs", "cesm2"],
  heat: ["era5", "cesm2"],
};

function _sourceFor(hazard, preferred) {
  const able = _HAZARD_SOURCES[hazard] || ["obs"];
  return able.includes(preferred) ? preferred : able[0];
}

// Every hazard button stays VISIBLE whatever the source. One the current
// source cannot answer is MARKED, not hidden, so the reader can see it exists
// and clicking it moves the source rather than appearing to do nothing.
//
// Both setters call this. When only setSource did, choosing Heat moved the
// source to ERA5 but left Heat still flagged as belonging to another source,
// which is the same class of staleness as the bug being fixed here.
function _markHazardButtons(source) {
  const allowed = _SOURCE_HAZARDS[source] || ["wet", "dry"];
  for (const h of ["wet", "dry", "heat"]) {
    const btn = document.getElementById("hazard-" + h);
    if (!btn) continue;
    btn.style.display = "";
    btn.classList.toggle("other-source", !allowed.includes(h));
    btn.title = allowed.includes(h) ? ""
      : `Comes from ${_HAZARD_SOURCES[h][0] === "era5" ? "ERA5 reanalysis"
         : "the CESM2 ensemble"}; clicking switches the source for you.`;
  }
}

window.setHazard = function(hazard, opts) {
  _currentHazard = hazard;
  for (const h of ["wet", "dry", "heat"]) {
    const btn = document.getElementById("hazard-" + h);
    if (btn) btn.classList.toggle("active", hazard === h);
  }
  // Move the source to one that can answer this hazard, keeping the current
  // one when it can. Silent because it is bookkeeping, not a choice the reader
  // made: they asked for heat, and this is simply where heat comes from.
  const sel = document.getElementById("ctrl-source");
  if (sel) {
    const want = _sourceFor(hazard, sel.value);
    if (sel.value !== want) sel.value = want;
    _markHazardButtons(sel.value);
  }
  _rebuildVariableOptions();
  if (!(opts && opts.defer)) loadAndRender();
};

window.setSource = function(source, opts) {
  const allowed = _SOURCE_HAZARDS[source] || ["wet", "dry"];
  _markHazardButtons(source);
  if (!allowed.includes(_currentHazard)) {
    setHazard(allowed[0], opts);
  } else if (!(opts && opts.defer)) {
    loadAndRender();
  }
};

async function _loadCountriesGeoJSON() {
  if (_countriesGeoJSON) return _countriesGeoJSON;
  const r = await fetch("data/maps/ne_110m_countries.geojson");
  _countriesGeoJSON = await r.json();
  return _countriesGeoJSON;
}

// Natural Earth 110m abbreviates a few country names; map them to the canonical
// hierarchy spelling so name lookups can be EXACT. The previous bidirectional
// substring match silently mislabelled Mali as Somalia, Niger as Nigeria, Guinea
// as Papua New Guinea and S. Sudan as Sudan (reported by MSF, 2026-07-30).
const _NAME_ALIASES = {
  "dominican rep.": "dominican republic",
};
function _canonName(s) {
  const k = (s || "").toLowerCase().trim();
  return _NAME_ALIASES[k] || k;
}

function _findFeatureByName(name) {
  if (!_countriesGeoJSON || !name) return null;
  const target = _canonName(name);
  return _countriesGeoJSON.features.find(f => _canonName(f.properties.name) === target);
}


// ── Canvas data rendering ─────────────────────────────────────────────────────

// Stipple threshold: cells where fraction agreeing < this value get a dot
const STIPPLE_THRESHOLD = 0.6;

function _renderData() {
  _ctx.clearRect(0, 0, _W, _H);
  if (!_currentTile) return;

  const { meta, scale, lats, lons, ri, ci, v, va } = _currentTile;
  const { vmax, symmetric, vmin, cmap } = meta;
  const _vmin = symmetric ? -Math.abs(vmax) : (vmin != null ? vmin : 0);
  const _vmax = symmetric ?  Math.abs(vmax) : vmax;

  const dlat = lats.length > 1 ? Math.abs(lats[1] - lats[0]) : 0.25;
  const dlon = lons.length > 1 ? Math.abs(lons[1] - lons[0]) : 0.25;
  const opacity = 0.85;

  // Widest a genuine cell can project to, with a generous allowance for
  // projection distortion. A cell straddling the antimeridian seam has one
  // corner wrapped to the far side and spans the whole map, so it lands far
  // above this and gets dropped (see the guard in pass 1).
  const maxCellPx = Math.max(24, _projection.scale() * dlon * Math.PI / 180 * 20);

  // Pre-clip to visible hemisphere using dot product - only meaningful for
  // globe-style projections (orthographic). Robinson / Natural Earth render
  // everything flat, so skip the cull there.
  const [λ0, φ0] = _projection.rotate().map(d => -d * Math.PI / 180);  // center lon/lat in rad
  const cullBackFace = (_projectionKind === "orthographic");

  // Prob-ratio threshold filter
  const isProbRatio = _PROB_RATIO_VARS.has(meta.variable || "");
  const probThreshAbs = isProbRatio ? _probThreshold : 0;

  // --- Pass 1: colour fill ---
  for (let idx = 0; idx < ri.length; idx++) {
    const r = ri[idx], c = ci[idx];

    if (_maskFeature && !_pointInFeature(lons[c], lats[r], _maskFeature)) continue;

    const lon = lons[c], lat = lats[r];
    const λ = lon * Math.PI / 180;
    const φ = lat * Math.PI / 180;
    if (cullBackFace) {
      const dot = Math.sin(φ0)*Math.sin(φ) + Math.cos(φ0)*Math.cos(φ)*Math.cos(λ - λ0);
      if (dot < 0) continue;
    }

    const val = v[idx] / scale;

    // Hide pixels below the prob-ratio threshold
    if (probThreshAbs > 0 && Math.abs(val) < probThreshAbs) continue;

    const t = (val - _vmin) / (_vmax - _vmin);
    const [R, G, B] = interpolateColor(cmap, t);

    const corners = [
      [lon - dlon/2, lat - dlat/2],
      [lon + dlon/2, lat - dlat/2],
      [lon + dlon/2, lat + dlat/2],
      [lon - dlon/2, lat + dlat/2],
    ].map(pt => _projection(pt));
    if (corners.some(p => !p)) continue;

    // Drop antimeridian-wrapped cells: they smear into full-width colour bars
    // that sweep across the map as you drag it (reported by MSF, 2026-07-21).
    const xs = corners.map(p => p[0]);
    if (Math.max(...xs) - Math.min(...xs) > maxCellPx) continue;

    _ctx.beginPath();
    _ctx.moveTo(corners[0][0], corners[0][1]);
    for (let k = 1; k < corners.length; k++) _ctx.lineTo(corners[k][0], corners[k][1]);
    _ctx.closePath();
    _ctx.fillStyle = `rgba(${R},${G},${B},${opacity})`;
    _ctx.fill();
  }

  // --- Pass 2: stippling for low-agreement cells ---
  if (_showStippling && va && va.length === ri.length) {
    // Dot radius scales slightly with zoom
    const dotR = Math.max(0.8, Math.min(2.0, _projection.scale() / 600));
    _ctx.fillStyle = "rgba(40,40,40,0.55)";

    for (let idx = 0; idx < ri.length; idx++) {
      const agreeVal = va[idx];
      if (agreeVal < 0 || agreeVal / 100 >= STIPPLE_THRESHOLD) continue;  // -1 = missing, skip

      const r = ri[idx], c = ci[idx];
      if (_maskFeature && !_pointInFeature(lons[c], lats[r], _maskFeature)) continue;

      const lon = lons[c], lat = lats[r];
      const λ = lon * Math.PI / 180;
      const φ = lat * Math.PI / 180;
      const dot = Math.sin(φ0)*Math.sin(φ) + Math.cos(φ0)*Math.cos(φ)*Math.cos(λ - λ0);
      if (dot < 0) continue;

      const centre = _projection([lon, lat]);
      if (!centre) continue;

      _ctx.beginPath();
      _ctx.arc(centre[0], centre[1], dotR, 0, 2 * Math.PI);
      _ctx.fill();
    }
  }
}

// Point-in-polygon (ray casting) - for country mask
function _pointInPolygon(pt, polygon) {
  const [px, py] = pt;
  let inside = false;
  for (const ring of polygon) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > py) !== (yj > py) && px < ((xj-xi)*(py-yi)/(yj-yi) + xi)) {
        inside = !inside;
      }
    }
  }
  return inside;
}

function _pointInFeature(lon, lat, feature) {
  const geom = feature.geometry;
  if (!geom) return false;
  const pt = [lon, lat];
  if (geom.type === "Polygon")      return _pointInPolygon(pt, geom.coordinates);
  if (geom.type === "MultiPolygon") return geom.coordinates.some(p => _pointInPolygon(pt, p));
  return false;
}


// ── SVG border layer ──────────────────────────────────────────────────────────

function _renderSVG() {
  _svg.selectAll("*").remove();

  // Globe outline (ocean fill)
  _svg.append("path")
    .datum({type: "Sphere"})
    .attr("d", _pathGen)
    .attr("fill", "#c8d8e8")
    .attr("stroke", "#aab8c8")
    .attr("stroke-width", 0.5);

  // Graticule
  const graticule = d3.geoGraticule().step([30, 30])();
  _svg.append("path")
    .datum(graticule)
    .attr("d", _pathGen)
    .attr("fill", "none")
    .attr("stroke", "rgba(100,120,140,0.25)")
    .attr("stroke-width", 0.5);

  // Country borders
  if (_countriesGeoJSON) {
    _svg.append("g")
      .selectAll("path")
      .data(_countriesGeoJSON.features)
      .join("path")
      .attr("d", _pathGen)
      .attr("fill", "transparent")
      .attr("stroke", "rgba(60,60,80,0.55)")
      .attr("stroke-width", 0.4)
      .attr("class", "country-border")
      .style("cursor", _drillLevel < 2 ? "pointer" : "default")
      .on("click", (event, d) => { event.stopPropagation(); _onCountryClick(d); });
  }

  // Highlight selected country at level 2
  if (_drillLevel === 2 && _maskFeature) {
    _svg.append("path")
      .datum(_maskFeature)
      .attr("d", _pathGen)
      .attr("fill", "none")
      .attr("stroke", "#222")
      .attr("stroke-width", 1.5);
  }
}

function _redraw() {
  _renderData();
  _renderSVG();
}


// ── Drill-down ────────────────────────────────────────────────────────────────

function _renderBreadcrumb() {
  const bc = document.getElementById("map-breadcrumb");
  let html = `<span class="bc-item ${_drillLevel===0?"bc-current":""}" onclick="drillTo(0,'world')">World</span>`;
  if (_drillLevel >= 1 && _subregionId) {
    const sub = _geoById[_subregionId];
    html += `<span class="bc-sep">›</span>`;
    html += `<span class="bc-item ${_drillLevel===1?"bc-current":""}" onclick="drillTo(1,'${_subregionId}')">${sub?.label||_subregionId}</span>`;
  }
  if (_drillLevel >= 2 && _countryId) {
    const co = _geoById[_countryId];
    html += `<span class="bc-sep">›</span>`;
    html += `<span class="bc-item bc-current">${co?.label||_countryId}</span>`;
  }
  bc.innerHTML = html;
}

function _rotateTo(center, scale, duration = 700) {
  const targetRotate = [-center[0], -center[1]];
  const targetScale = scale || (_W / 2 - 10);

  const r0 = _projection.rotate();
  const s0 = _projection.scale();

  d3.transition()
    .duration(duration)
    .tween("rotate", () => {
      const ir = d3.interpolate(r0, targetRotate);
      const is = d3.interpolate(s0, targetScale);
      return t => {
        _projection.rotate(ir(t)).scale(is(t));
        _redraw();
      };
    });
}

window.drillTo = function(level, geoId) {
  if (level === 0) {
    _drillLevel = 0; _subregionId = null; _countryId = null; _maskFeature = null;
    _rotateTo(GEO_HIERARCHY.center || [0, 20], null);
  } else if (level === 1) {
    _drillLevel = 1; _subregionId = geoId; _countryId = null; _maskFeature = null;
    const geo = _geoById[geoId];
    if (geo) _rotateTo(geo.center, geo.scale);
  }
  _renderBreadcrumb();
  _redraw();
  _updateAlertPanel();
};

async function _onCountryClick(feature) {
  const name = feature.properties.name;
  await _loadCountriesGeoJSON();

  if (_drillLevel === 0) {
    // Find which subregion this country belongs to
    for (const sub of GEO_HIERARCHY.subregions) {
      const match = sub.countries.find(c => c.regionmask && _namesMatch(name, c.regionmask));
      if (match) {
        _drillLevel = 1; _subregionId = sub.id; _countryId = null; _maskFeature = null;
        _rotateTo(sub.center, sub.scale);
        _renderBreadcrumb();
        return;
      }
    }
  } else if (_drillLevel === 1) {
    const sub = _geoById[_subregionId];
    if (!sub) return;
    const match = sub.countries.find(c => c.regionmask && _namesMatch(name, c.regionmask));
    if (match && match.regionmask) {
      _drillLevel = 2; _countryId = match.id;
      _maskFeature = _findFeatureByName(match.regionmask);
      // Zoom into country centroid
      const centroid = d3.geoCentroid(feature);
      _rotateTo(centroid, Math.min(_geoById[_subregionId].scale * 2.5, 3000));
      _renderBreadcrumb();
      _redraw();
      _updateAlertPanel();
    }
  } else if (_drillLevel === 2) {
    // Click anywhere → back to subregion
    _drillLevel = 1; _countryId = null; _maskFeature = null;
    const geo = _geoById[_subregionId];
    if (geo) _rotateTo(geo.center, geo.scale);
    _renderBreadcrumb();
    _redraw();
  }
}

function _namesMatch(a, b) {
  return _canonName(a) === _canonName(b);
}


// ── Tooltip ───────────────────────────────────────────────────────────────────

function _setupTooltip() {
  const tooltip = document.getElementById("map-tooltip");
  const container = document.getElementById("map-container");

  container.addEventListener("mousemove", e => {
    if (!_currentTile) return;
    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Invert projection to get lon/lat
    const inv = _projection.invert([mx, my]);
    if (!inv) { tooltip.style.display = "none"; return; }
    const [lon, lat] = inv;

    const { lats, lons, ri, ci, v, scale, meta } = _currentTile;
    const dlat = lats.length > 1 ? Math.abs(lats[1]-lats[0]) : 0.25;
    const dlon = lons.length > 1 ? Math.abs(lons[1]-lons[0]) : 0.25;

    for (let idx = 0; idx < ri.length; idx++) {
      const r = ri[idx], c = ci[idx];
      if (_maskFeature && !_pointInFeature(lons[c], lats[r], _maskFeature)) continue;
      if (Math.abs(lat - lats[r]) <= dlat/2 && Math.abs(lon - lons[c]) <= dlon/2) {
        tooltip.style.display = "block";
        tooltip.style.left = (mx + 14) + "px";
        tooltip.style.top  = (my - 10) + "px";
        let tip = `${lats[r].toFixed(2)}°, ${lons[c].toFixed(2)}°  →  ${(v[idx]/scale).toFixed(1)} ${meta.units}`;
        if (_currentTile.va && _currentTile.va[idx] >= 0) {
          tip += `  ·  ${_currentTile.va[idx]}% events agree`;
        }
        tooltip.textContent = tip;
        return;
      }
    }
    tooltip.style.display = "none";
  });
  container.addEventListener("mouseleave", () => { tooltip.style.display = "none"; });
}


// ── Load & render ─────────────────────────────────────────────────────────────

function _showLoading(on) {
  document.getElementById("map-loading").style.display = on ? "flex" : "none";
}

// (prob-ratio tiles removed 2026-06-23, so this set is now empty)
const _OBS_NO_PROB = new Set();
// Variables only available for OBS (no CESM2 equivalent)
const _OBS_ONLY = new Set();

// Anomaly-vs-neutral is meaningless for the Neutral phase itself - hide it there.
const _NEUTRAL_HIDDEN = new Set([
  "rx10day_anomaly", "cdd_anomaly",
]);

function _updateVariableOptions() {
  const source = document.getElementById("ctrl-source").value;
  const phase  = document.getElementById("ctrl-phase").value;
  const sel    = document.getElementById("ctrl-variable");
  const current = sel.value;
  let firstVisible = null;

  for (const opt of sel.options) {
    const hidden = (source === "obs"   && _OBS_NO_PROB.has(opt.value)) ||
                   (source === "cesm2" && _OBS_ONLY.has(opt.value))    ||
                   (phase  === "neutral" && _NEUTRAL_HIDDEN.has(opt.value));
    // display:none on an <option> is IGNORED by Safari, so there the metric
    // stayed selectable and choosing it fetched a tile that does not exist:
    // a blank map and a 404, with the control looking like it worked. Setting
    // .disabled as well is honoured by every browser, so an unavailable metric
    // is unpickable rather than merely invisible-if-your-browser-agrees.
    opt.style.display = hidden ? "none" : "";
    opt.disabled = hidden;
    if (!hidden && !firstVisible) firstVisible = opt.value;
  }

  const currentOpt = sel.querySelector(`option[value="${current}"]`);
  if (currentOpt && currentOpt.disabled) {
    sel.value = firstVisible || sel.options[0]?.value;
  }

  // Show prob-ratio controls only when a prob_ratio variable is selected
  const probRow = document.getElementById("prob-ratio-controls");
  if (probRow) probRow.style.display = _PROB_RATIO_VARS.has(sel.value) ? "" : "none";
}

// ── Alert panel ───────────────────────────────────────────────────────────────

const PHASE_LABEL = {
  extreme_la_nina: "Extreme La Niña", strong_la_nina: "Strong La Niña",
  moderate_la_nina: "Moderate La Niña", neutral: "Neutral",
  moderate_el_nino: "Moderate El Niño", strong_el_nino: "Strong El Niño",
  extreme_el_nino: "Extreme El Niño",
};
const PHASE_FAMILY = phase => phase.includes("el_nino") ? "el_nino" :
                               phase.includes("la_nina") ? "la_nina" : "neutral";

async function _loadForecast() {
  if (_forecastData) return _forecastData;
  try {
    // ?v= is the monthly data-build buster (kept in sync with app.js DATA_VERSION)
    const r = await fetch("data/forecast.json?v=20260731a", {cache: "no-store"});
    _forecastData = await r.json();
  } catch(e) { _forecastData = null; }
  return _forecastData;
}

// Compute dominant phase and its aggregate probability from a forecast lead row
function _dominantPhase(lead) {
  const classes = ["extreme_la_nina","strong_la_nina","moderate_la_nina","neutral",
                   "moderate_el_nino","strong_el_nino","extreme_el_nino"];
  let best = classes[0], bestP = 0;
  for (const c of classes) {
    if ((lead[c] || 0) > bestP) { bestP = lead[c]; best = c; }
  }
  const fam = PHASE_FAMILY(best);
  const famP = classes.filter(c => PHASE_FAMILY(c) === fam).reduce((s,c) => s+(lead[c]||0), 0);
  return { phase: best, prob: bestP, famProb: famP, family: fam };
}

// Get the composite anomaly sign for the tile's current variable at the dominant phase
// Returns +1 (wetter/more extreme than neutral), -1 (drier/less), or 0 (no signal)
function _tileSignForPhase(phase) {
  if (!_currentTile || !_currentTile.v || _currentTile.v.length === 0) return 0;
  const vals = _currentTile.v.map(x => x / _currentTile.scale);
  const mean = vals.reduce((s,v) => s+v, 0) / vals.length;
  if (Math.abs(mean) < 0.01) return 0;
  return mean > 0 ? 1 : -1;
}

function _signalPill(famProb, sign, hazard) {
  // sign: +1 means anomaly is positive (wetter for wet hazard, drier for dry hazard)
  // For wet hazard: positive anomaly + high EN prob = Alert; for dry: positive anomaly = drier = Alert
  const isAdverse = sign !== 0;
  if (!isAdverse || famProb < 0.25) return `<span class="signal-pill signal-neutral">-</span>`;
  if (famProb >= 0.5) return `<span class="signal-pill signal-alert">High</span>`;
  if (famProb >= 0.35) return `<span class="signal-pill signal-watch">Watch</span>`;
  return `<span class="signal-pill signal-neutral">Low</span>`;
}

async function _updateAlertPanel() {
  const panel = document.getElementById("alert-panel");
  const tbody = document.getElementById("alert-tbody");
  const titleEl = document.getElementById("alert-panel-title");
  const noteEl  = document.getElementById("alert-note");

  if (_drillLevel === 0) { panel.style.display = "none"; return; }

  const fc = await _loadForecast();
  if (!fc) { panel.style.display = "none"; return; }

  const geoLabel = _drillLevel === 2
    ? (_geoById[_countryId]?.label || _countryId)
    : (_geoById[_subregionId]?.label || _subregionId);
  const season = document.getElementById("ctrl-season").value.toUpperCase();
  const hazard = _currentHazard;
  const hazardLabel = hazard === "wet" ? "Wet extreme signal" : "Drought / dry signal";

  titleEl.textContent = `Forecast × Impact Signal - ${geoLabel} · ${season}`;

  let rows = "";
  for (const lead of fc.leads) {
    const { phase, prob, famProb, family } = _dominantPhase(lead);
    // Get tile signal at the dominant phase's anomaly
    // Load the anomaly tile for the dominant phase to check sign
    const anomVar = hazard === "wet" ? "rx10day_anomaly" : "cdd_anomaly";
    let sign = 0;
    try {
      const t = await loadTile(document.getElementById("ctrl-source").value,
                               season.toLowerCase(), phase, anomVar);
      if (t && t.v && t.v.length > 0) {
        const vals = t.v.map(x => x / t.scale);
        const mean = vals.reduce((s,v) => s+v, 0) / vals.length;
        sign = mean > 0.5 ? 1 : mean < -0.5 ? -1 : 0;
      }
    } catch(e) { sign = 0; }

    const probPct = (famProb * 100).toFixed(0);
    const signText = sign === 0 ? "No clear signal" :
                     (hazard === "wet")
                       ? (sign > 0 ? "↑ Wetter than normal" : "↓ Drier than normal")
                       : (sign > 0 ? "↓ Drier than normal" : "↑ Wetter than normal");
    const pill = _signalPill(famProb, sign, hazard);

    rows += `<tr>
      <td>+${lead.lead}</td>
      <td>${lead.valid_time}</td>
      <td>${PHASE_LABEL[phase] || phase}</td>
      <td>${probPct}%</td>
      <td style="color:var(--text-muted)">${signText}</td>
      <td>${pill}</td>
    </tr>`;
  }

  tbody.innerHTML = rows;
  noteEl.innerHTML = `Forecast vintage: <strong>${fc.vintage}</strong> &nbsp;·&nbsp; `
    + `Impact signal from ${document.getElementById("ctrl-source").value === "obs" ? "CHIRPS observations" : "CESM2 large ensemble"} `
    + `composite for dominant phase at each lead. `
    + `<a href="hindcast_skill.html" style="color:var(--accent)">Skill verification →</a>`;
  panel.style.display = "";
}

// ── Load & render ─────────────────────────────────────────────────────────────

async function loadAndRender() {
  _updateVariableOptions();
  const source   = document.getElementById("ctrl-source").value;
  const season   = document.getElementById("ctrl-season").value;
  const phase    = document.getElementById("ctrl-phase").value;
  const variable = document.getElementById("ctrl-variable").value;

  _showLoading(true);
  try {
    _currentTile = await loadTile(source, season, phase, variable);
    renderColorbar(_currentTile.meta);

    let note = _currentTile.meta.coverage || "";
    if (_currentTile.meta.n_events != null) {
      note += `  ·  n = ${_currentTile.meta.n_events} event${_currentTile.meta.n_events !== 1 ? "s" : ""}`;
    }
    if (source === "obs" && note.includes("Americas only") &&
        _drillLevel >= 1 && !OBS_SUBREGIONS.has(_subregionId)) {
      note += "  ·  No CHIRPS data here - switch to CESM2.";
    }
    document.getElementById("coverage-note").textContent = note;

    // Show/hide stipple toggle depending on whether tile has agreement data
    const hasAgreement = Array.isArray(_currentTile.va) && _currentTile.va.length > 0;
    const stippRow = document.getElementById("stipple-toggle-row");
    if (stippRow) stippRow.style.display = hasAgreement ? "" : "none";

    // No agreement at all on a single-intensity OBSERVED layer is deliberate,
    // not missing data: 1-7 events per class cannot support a sign test, and
    // strong La Nina is a single event in every season, where agreement is 100%
    // by construction and no dot could ever appear. Say so, and point at the
    // pooled layer, rather than leaving the reader to assume robustness.
    if (!hasAgreement && _currentTile.meta && _currentTile.meta.robustness_note) {
      document.getElementById("coverage-note").textContent =
        note + "  ·  No robustness dots: " + _currentTile.meta.robustness_note + ".";
    }

    // With only a handful of observed events the agreement fraction is quantised
    // (n=3 can only give 33/67/100%), so for some metrics it never falls below the
    // threshold and NO dots can ever be drawn. Silence there would read as "every
    // pixel is robust", which is the opposite of the truth, so say it plainly.
    if (hasAgreement) {
      const nEv = _currentTile.meta.n_events;
      let below = 0;
      for (let i = 0; i < _currentTile.va.length; i++) {
        const a = _currentTile.va[i];
        if (a >= 0 && a / 100 < STIPPLE_THRESHOLD) { below++; break; }
      }
      if (below === 0 && nEv != null && nEv < 8) {
        document.getElementById("coverage-note").textContent = note +
          `  ·  Too few events (n = ${nEv}) to test robustness here: agreement can only take a few ` +
          `values and never drops below ${Math.round(STIPPLE_THRESHOLD * 100)}%, so the absence of ` +
          `dots is a small-sample limit, not evidence of a robust signal. Switch to CESM2 for a real test.`;
      }
    }

    _redraw();
    _updateAlertPanel();
  } catch (err) {
    console.error(err);
    document.getElementById("coverage-note").textContent = `Data not available: ${err.message}`;
  } finally {
    _showLoading(false);
  }
}

window.toggleStippling = function() {
  const cb = document.getElementById("ctrl-stipple");
  if (cb) _showStippling = cb.checked;
  _redraw();
};

window.setProbThreshold = function() {
  const sel = document.getElementById("ctrl-prob-threshold");
  _probThreshold = sel ? parseInt(sel.value, 10) : 0;
  _redraw();
};

// 2026-06-23: prob-ratio layers removed from the teleconnections tab.
const _PROB_RATIO_VARS = new Set([]);


// ── Initialisation ────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  const container = document.getElementById("map-container");
  _W = container.clientWidth  || 800;
  _H = document.getElementById("map").clientHeight || 560;

  // Canvas (data layer - behind SVG)
  _canvas = document.createElement("canvas");
  _canvas.width  = _W;
  _canvas.height = _H;
  _canvas.style.cssText = "position:absolute;top:0;left:0;pointer-events:none;";
  container.appendChild(_canvas);
  _ctx = _canvas.getContext("2d");

  // SVG (borders + globe outline - on top, receives pointer events)
  _svg = d3.select("#map")
    .append("svg")
    .attr("width",  _W)
    .attr("height", _H)
    .style("position", "absolute")
    .style("top", "0")
    .style("left", "0");

  // Projection
  _projectionKind = "orthographic";
  _projection = _buildProjection(_projectionKind);
  _pathGen = d3.geoPath(_projection);

  // Build variable options for default hazard (wet) and apply
  // source-specific hazard visibility.
  _rebuildVariableOptions();
  setSource(document.getElementById("ctrl-source").value);

  // Load country borders then do initial render
  await _loadCountriesGeoJSON();
  _renderSVG();

  // Drag to rotate
  const drag = d3.drag()
    .on("start", () => { container.style.cursor = "grabbing"; })
    .on("drag", event => {
      const [λ, φ] = _projection.rotate();
      const sens = 0.3 / (_projection.scale() / (_W / 2));
      _projection.rotate([λ + event.dx * sens, φ - event.dy * sens]);
      _redraw();
    })
    .on("end", () => { container.style.cursor = "grab"; });

  _svg.call(drag);
  container.style.cursor = "grab";

  // Scroll to zoom
  _svg.on("wheel", event => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 0.89;
    const s = Math.max(100, Math.min(_W * 5, _projection.scale() * factor));
    _projection.scale(s);
    _redraw();
  });

  // Apply URL params to pre-select controls (e.g. from forecast page CTA).
  //
  // Assigning .value does NOT fire change, so the old version set the source
  // box to "era5" while setSource never ran: the heat variables were never
  // loaded into the dropdown, ctrl-variable stayed empty, and the page asked
  // for "obs_mam_all_el_nino_.json" and 404'd. A link that looks specific and
  // silently lands you somewhere broken is worse than no link.
  //
  // So the variable decides the hazard, the hazard decides the source, and
  // every step runs its real handler. `defer` keeps them from each triggering
  // a render; one render happens at the end.
  const _urlParams = new URLSearchParams(window.location.search);
  const _wantVar = _urlParams.get("variable");
  const _wantHaz = _urlParams.get("hazard")
    || (_wantVar && Object.keys(VARIABLE_OPTIONS).find(
          h => VARIABLE_OPTIONS[h].some(o => o.value === _wantVar)));
  if (_wantHaz && VARIABLE_OPTIONS[_wantHaz]) setHazard(_wantHaz, {defer: true});
  const _wantSrc = _urlParams.get("source");
  if (_wantSrc && (_SOURCE_HAZARDS[_wantSrc] || []).includes(_currentHazard)) {
    const el = document.getElementById("ctrl-source");
    if (el) el.value = _wantSrc;
    setSource(_wantSrc, {defer: true});
  }
  ["season","phase","variable"].forEach(key => {
    const val = _urlParams.get(key);
    const el  = document.getElementById(`ctrl-${key}`);
    // Only if the option EXISTS, or we set a value nothing can serve.
    if (val && el && [...el.options].some(o => o.value === val)) el.value = val;
  });

  // Controls
  ["ctrl-source","ctrl-season","ctrl-phase","ctrl-variable"].forEach(id => {
    document.getElementById(id).addEventListener("change", loadAndRender);
  });

  // Projection switcher (orthographic / robinson / naturalEarth)
  const projSel = document.getElementById("ctrl-projection");
  if (projSel) {
    projSel.addEventListener("change", e => {
      const newKind = e.target.value || "orthographic";
      _projection = _buildProjection(newKind);
      _pathGen = d3.geoPath(_projection);
      _renderSVG();
      _redraw();
    });
  }

  _setupTooltip();
  loadAndRender();
});
