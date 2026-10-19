/* forecast_maps.js - Multi-model SSTA forecast renderer
 *
 * Uses the same D3 orthographic globe engine as map_explorer.js, adapted
 * for the forecast tile schema (sparse {ri, ci, v, va} + per_centre).
 */
"use strict";

const DATA_BASE = "data/forecast_maps/";

// Monthly data-build cache-buster. Bump whenever the served forecast_maps tiles
// (ssta_manifest, ssta/pixel tiles, precip series) are regenerated, so a fresh
// forecast vintage is never masked by a stale browser/CDN copy. Kept in sync
// with app.js DATA_VERSION. Static basemaps (ne_*.geojson) never change and are
// left unversioned, matching the app.js / map_explorer.js convention.
const DATA_VERSION = "20261019a";
function _dv(url) {
  return url + (url.indexOf("?") === -1 ? "?" : "&") + "v=" + DATA_VERSION;
}

// Per-centre colour palette (keep in sync with app.js)
const CENTRE_COLOR = {
  seas5:   "#1f77b4",
  mf9:     "#d62728",
  ncep2:   "#2ca02c",
  dwd21:   "#ff7f0e",
  dwd22:   "#ff7f0e",
  cmcc35:  "#9467bd",
  cmcc4:   "#9467bd",
  ukmo604: "#8c564b",
  ukmo610: "#8c564b",
  jma3:    "#e377c2",
  jma4:    "#e377c2",
  eccc5:   "#7f7f7f",
  bom2:    "#17becf",
  xro:     "#111111",
  xro_iod: "#111111",
};
const CENTRE_SHORT = {
  seas5: "SEAS5", mf9: "MF9", ncep2: "NCEP", dwd21: "DWD", dwd22: "DWD",
  cmcc35: "CMCC", cmcc4: "CMCC", ukmo604: "UKMO", ukmo610: "UKMO",
  jma3: "JMA", jma4: "JMA", eccc5: "ECCC", bom2: "BOM",
  xro: "XRO", xro_iod: "XRO-IOD",
};

// Inlined RdBu_r colour map (matches map_explorer's CMAPS.RdBu_r)
const CMAP_RDBU_R = [
  [0,    [33, 102, 172]],
  [0.1,  [67, 147, 195]],
  [0.25, [146, 197, 222]],
  [0.4,  [209, 229, 240]],
  [0.5,  [247, 247, 247]],
  [0.6,  [253, 219, 199]],
  [0.75, [244, 165, 130]],
  [0.9,  [214, 96, 77]],
  [1,    [178, 24, 43]],
];

function interpolateColor(cmap, t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < cmap.length; i++) {
    if (t <= cmap[i][0]) {
      const [t0, c0] = cmap[i-1];
      const [t1, c1] = cmap[i];
      const f = (t - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + f*(c1[0]-c0[0])),
        Math.round(c0[1] + f*(c1[1]-c0[1])),
        Math.round(c0[2] + f*(c1[2]-c0[2])),
      ];
    }
  }
  return cmap[cmap.length-1][1];
}

// ── State ────────────────────────────────────────────────────────────────────

// Variable registry: each variable has a tile-file prefix, colour range,
// cmap, units label, and for daily precip the inner field key inside the tile.
const VARIABLES = {
  "ssta": {
    filePrefix:  "ssta_L",
    manifestName: "ssta_manifest",
    vmin: -3, vmax: 3, cmap: "RdBu_r",
    units: "sigma", label: "SSTA",
    tileStyle: "sparse",
  },
  "pr_total_mm": {
    filePrefix:   "daily_pr_L",
    manifestName: "daily_pr_manifest",
    vmin: 0, vmax: 600, cmap: "Blues",
    units: "mm/month", label: "Monthly precip total",
    tileStyle: "dense-daily",
    innerKey: "pr_total_mm",
  },
  "rx1day_mm": {
    filePrefix:   "daily_pr_L",
    manifestName: "daily_pr_manifest",
    vmin: 0, vmax: 80, cmap: "Blues",
    units: "mm/day", label: "RX1DAY",
    tileStyle: "dense-daily",
    innerKey: "rx1day_mm",
  },
  "rx10day_mm": {
    filePrefix:   "daily_pr_L",
    manifestName: "daily_pr_manifest",
    vmin: 0, vmax: 300, cmap: "Blues",
    units: "mm / 10-day", label: "RX10DAY (max rolling 10-day precip)",
    tileStyle: "dense-daily",
    innerKey: "rx10day_mm",
  },
  "cdd_days": {
    filePrefix:   "daily_pr_L",
    manifestName: "daily_pr_manifest",
    vmin: 0, vmax: 30, cmap: "Oranges",
    units: "days", label: "CDD (max consecutive dry days)",
    tileStyle: "dense-daily",
    innerKey: "cdd_days",
  },
};

const CMAPS = {
  "RdBu_r": CMAP_RDBU_R,
  // Rain: brown dry, green-blue wet, as on every other rainfall map of the site.
  "BrBG":   [[0,[140,81,10]],[0.25,[216,179,101]],[0.5,[245,245,245]],[0.75,[90,180,172]],[1,[1,102,94]]],
  "BrBG_r": [[0,[1,102,94]],[0.25,[90,180,172]],[0.5,[245,245,245]],[0.75,[216,179,101]],[1,[140,81,10]]],
  "Grey":   [[0,[213,219,225]],[1,[213,219,225]]],
  "Blues": [
    [0,   [247, 252, 253]],
    [0.2, [204, 236, 230]],
    [0.4, [102, 194, 164]],
    [0.6, [65, 174, 118]],
    [0.8, [35, 139, 69]],
    [1,   [0, 68, 27]],
  ],
  // Drought colour ramp - pale cream → deep orange → dark red.
  // CDD increases with dryness, so darker = worse.
  "Oranges": [
    [0,    [254, 245, 235]],
    [0.25, [253, 208, 162]],
    [0.5,  [253, 141, 60]],
    [0.75, [217, 72, 1]],
    [1,    [127, 39, 4]],
  ],
};

// ── Regional forecast maps (build_region_forecast.py) ────────────────────────
// Each index forecast from daily SEAS5 and Météo-France System 9 fields, corrected day by day
// against CHIRPS (rain) and ERA5 (reanalysis), shown as the average of the runs against the
// site's normal (rain: % of normal, 100 = normal; otherwise the difference), in every cell
// (Isma, 17 Oct 2026: skill is in the tables); dots where the two models disagree on the sign; rain in dry
// months is grey. These replace the uncorrected April 2026 daily-precip maps.
const FC_CMAP = { pr_total: "BrBG", rx10day: "BrBG", dry_days: "BrBG_r", cdd: "BrBG_r" };
let _fcManifest = null, _fcGrid = null;
const _SSTA_LEAD_OPTIONS = [];
function _isFc(v) { return VARIABLES[v] && VARIABLES[v].tileStyle === "fcmap"; }

async function _loadFcManifest() {
  // Only when the SST manifest says an outlook is published for this same month.
  if (!_manifest || _manifest.outlook !== `${_tag.slice(0, 4)}-${_tag.slice(4, 6)}`) return;
  try {
    const r = await fetch(_dv(DATA_BASE + `fcmap_manifest_${_tag}.json`), {cache: "no-cache"});
    if (!r.ok) return;
    _fcManifest = await r.json();
    const g = await fetch(_dv(DATA_BASE + `fcmap_grid_${_tag}.json`), {cache: "no-cache"});
    _fcGrid = g.ok ? await g.json() : null;
  } catch (_) { _fcManifest = null; }
  if (!_fcManifest || !_fcGrid) { _fcManifest = null; return; }
  // The subtitle describes the outlook only once its maps are actually served.
  const note = document.getElementById("fm-outlook-note");
  if (note) {
    note.innerHTML = "The <strong>Forecast</strong> entries in the variable menu are the regional forecast: rain, "
      + "dry days, dry spells, heavy rain, maximum temperature, heat-stress days and warm nights from the daily "
      + "fields of ECMWF SEAS5 and Météo-France System 9, corrected day by day against CHIRPS rainfall (observed) "
      + "and ERA5 (reanalysis), and shown as the average of the runs, as % of normal (rain) or difference from "
      + "normal, on the same normal as the observations. Colours show the forecast everywhere; how well each "
      + "model did in its past forecasts (" + (_fcManifest.hindcast || "1993-2025") + "), region by region, is "
      + "in the tables on the <a href=\"event_replay.html\">Event replay</a> page. Dots: the models disagree "
      + "on the sign of the change from normal. Grey: dry months for the rain indices.";
  }
  const sel = document.getElementById("fm-variable");
  for (const ix of _fcManifest.indices) {
    VARIABLES[`fc_${ix.key}`] = { tileStyle: "fcmap", fcKey: ix.key, cmap: FC_CMAP[ix.key] || "RdBu_r",
                                  units: ix.key === "pr_total" ? "% of normal" : ix.units,
                                  label: ix.label, vmin: -1, vmax: 1 };
    const o = document.createElement("option");
    o.value = `fc_${ix.key}`;
    o.textContent = `Forecast: ${ix.label.replace(/ vs normal$/, "")}`;
    sel.appendChild(o);
  }
}

function _b64bytes(s) {
  const raw = atob(s), b = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) b[i] = raw.charCodeAt(i);
  return b;
}

/** Decoded per-cell values of one fcmap field: null where no data. */
function _fcField(f) {
  const b = _b64bytes(f.data);
  return Array.from(b, x => x === 0 ? null : f.lo + (x - 1) / 254 * (f.hi - f.lo));
}

/** Lead and centre menus follow the variable: months and periods with SEAS5, MF9 or both
 *  for the outlook, lead months and the multi-model average for SST. */
function _syncMenus() {
  const lead = document.getElementById("fm-lead"), cen = document.getElementById("fm-centre");
  if (!_SSTA_LEAD_OPTIONS.length) {
    [...lead.options].forEach(o => _SSTA_LEAD_OPTIONS.push([o.value, o.textContent]));
    _SSTA_CENTRES.push(...[...cen.options].map(o => [o.value, o.textContent]));
  }
  const cenLabel = document.querySelector('label[for="fm-centre"]');
  if (cenLabel && !cenLabel.dataset.orig) cenLabel.dataset.orig = cenLabel.textContent;
  if (cenLabel) cenLabel.textContent = _isFc(_variable) ? "Model" : cenLabel.dataset.orig;
  if (_isFc(_variable)) {
    lead.innerHTML = _fcManifest.periods.map(p => `<option value="${p.id}">${p.label}`
      + `${p.id[0] === "N" ? ` (next ${p.id.slice(1)} months)` : ""}</option>`).join("");
    if (!_fcManifest.periods.some(p => p.id === String(_lead))) _lead = "N6";
    lead.value = String(_lead);
    cen.innerHTML = `<option value="__multi">Both models (average of the two)</option>`
      + Object.entries(_fcManifest.sources).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
    if (!["__multi", ...Object.keys(_fcManifest.sources)].includes(_centre)) _centre = "__multi";
    cen.value = _centre;
  } else {
    lead.innerHTML = _SSTA_LEAD_OPTIONS.map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
    if (!_SSTA_LEAD_OPTIONS.some(([v]) => v === String(_lead))) _lead = 1;
    lead.value = String(_lead);
    cen.innerHTML = _SSTA_CENTRES.map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
    if (!_SSTA_CENTRES.some(([v]) => v === _centre)) _centre = "__multi";
    cen.value = _centre;
  }
}
const _SSTA_CENTRES = [];

let _tag = null;
let _manifest = null;
let _tiles = {};          // `${var}_L${lead}` → JSON
let _variable = "ssta";
let _lead = 1;
let _centre = "__multi";
let _showStippling = true;   // robustness stippling on low sign-agreement cells

let _projection, _pathGen, _canvas, _ctx, _svg, _W, _H;
let _projectionKind = "orthographic";  // "orthographic" | "robinson" | "naturalEarth"
let _countriesGeoJSON = null;
let _landMaskGrid = null;   // array of arrays [ri][ci] → true if land

// Build a d3 projection by name with sensible defaults for the current canvas.
// Orthographic = globe (rotatable, back-face culling); Robinson = flat world
// map (no globe; skip culling in _renderSparse when kind !== "orthographic").
function _buildProjection(kind) {
  let p;
  if (kind === "robinson") {
    if (typeof d3.geoRobinson === "function") {
      p = d3.geoRobinson();
    } else {
      // d3-geo-projection isn't loaded - fall back to the built-in equalEarth
      // which ships with vanilla d3-geo (similar flat-world look).
      p = d3.geoEqualEarth();
      kind = "equalEarth";
    }
    p.scale(_W / 5.1).translate([_W / 2, _H / 2]).rotate([-150, 0]);
  } else if (kind === "naturalEarth" && typeof d3.geoNaturalEarth1 === "function") {
    p = d3.geoNaturalEarth1().scale(_W / 5.8).translate([_W / 2, _H / 2]).rotate([-150, 0]);
  } else {
    // orthographic (globe), default
    p = d3.geoOrthographic()
          .scale(_W / 2 - 10)
          .translate([_W / 2, _H / 2])
          .clipAngle(90)
          .rotate([-150, -5]);
    kind = "orthographic";
  }
  _projectionKind = kind;
  return p;
}

// ── Data loading ─────────────────────────────────────────────────────────────

async function discoverTarget() {
  const candidates = new Set();
  const now = new Date();
  for (let d = 0; d < 6; d++) {
    const m = new Date(now.getFullYear(), now.getMonth() - d, 1);
    candidates.add(`${m.getFullYear()}${String(m.getMonth()+1).padStart(2,"0")}`);
  }
  candidates.add("202604");
  for (const tag of candidates) {
    try {
      const r = await fetch(_dv(DATA_BASE + `ssta_manifest_${tag}.json`), {cache:"no-cache"});
      if (r.ok) {
        console.log("forecast_maps: manifest", tag);
        return tag;
      }
    } catch (_) {}
  }
  return null;
}

async function loadTile(variable, lead) {
  const key = `${variable}_L${lead}`;
  if (_tiles[key]) return _tiles[key];
  const spec = VARIABLES[variable];
  const url = spec.tileStyle === "fcmap"
    ? DATA_BASE + `fcmap_${spec.fcKey}_${lead}_${_tag}.json`
    : DATA_BASE + `${spec.filePrefix}${lead}_${_tag}.json`;
  const r = await fetch(_dv(url), {cache:"no-cache"});
  if (!r.ok) throw new Error(`tile ${key} ${r.status}`);
  const j = await r.json();
  _tiles[key] = j;
  return j;
}

async function _loadCountriesGeoJSON() {
  if (_countriesGeoJSON) return _countriesGeoJSON;
  try {
    const r = await fetch("data/maps/ne_110m_countries.geojson", {cache:"no-cache"});
    _countriesGeoJSON = await r.json();
  } catch (e) {
    console.warn("no country geojson", e);
    _countriesGeoJSON = null;
  }
  return _countriesGeoJSON;
}

// Point-in-polygon ray-cast (ring: array of [lon, lat])
function _pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
function _pointInPolygon(x, y, poly) {
  // poly = [outer ring, hole1, hole2, ...]
  if (!_pointInRing(x, y, poly[0])) return false;
  for (let k = 1; k < poly.length; k++) {
    if (_pointInRing(x, y, poly[k])) return false;
  }
  return true;
}
function _pointOnLand(lon, lat) {
  if (!_countriesGeoJSON) return false;
  // Normalise longitude to [-180, 180] since GeoJSON uses that convention
  const x = lon > 180 ? lon - 360 : lon;
  for (const f of _countriesGeoJSON.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === "Polygon") {
      if (_pointInPolygon(x, lat, g.coordinates)) return true;
    } else if (g.type === "MultiPolygon") {
      for (const p of g.coordinates) {
        if (_pointInPolygon(x, lat, p)) return true;
      }
    }
  }
  return false;
}

function _buildLandMaskGrid(lats, lons) {
  // Cache key must include the actual lat/lon axes, not just their lengths -
  // SSTA ships [0.5..359.5] while daily_pr ships [-179.5..179.5], both 180×360.
  const key = `${lats[0]},${lats[lats.length-1]}|${lons[0]},${lons[lons.length-1]}|${lats.length}x${lons.length}`;
  if (_landMaskGrid && _landMaskGrid.key === key) {
    return _landMaskGrid.grid;
  }
  console.log("forecast_maps: building land mask grid…", key);
  const t0 = performance.now();
  const grid = new Uint8Array(lats.length * lons.length);
  for (let r = 0; r < lats.length; r++) {
    for (let c = 0; c < lons.length; c++) {
      grid[r * lons.length + c] = _pointOnLand(lons[c], lats[r]) ? 1 : 0;
    }
  }
  _landMaskGrid = {key, grid};
  console.log(`forecast_maps: land mask built in ${((performance.now() - t0)/1000).toFixed(1)}s`);
  return grid;
}

// ── Canvas cell rendering (sparse + orthographic) ────────────────────────────

function _renderData() {
  _ctx.clearRect(0, 0, _W, _H);
  const key = `${_variable}_L${_lead}`;
  const tile = _tiles[key];
  if (!tile) {
    console.warn("forecast_maps: tile not loaded", key);
    return;
  }
  const spec = VARIABLES[_variable];
  const cmap = CMAPS[spec.cmap] || CMAP_RDBU_R;
  const vmin = spec.vmin, vmax = spec.vmax;

  if (spec.tileStyle === "sparse") {
    // SSTA schema: tile = {lats, lons, ri, ci, v, va, scale, per_centre}
    const { lats, lons, ri, ci, v, va, scale, per_centre } = tile;
    if (_centre !== "__multi" && per_centre && per_centre[_centre]) {
      const pc = per_centre[_centre];
      return _renderSparse(pc.ri, pc.ci, pc.v, null, lats, lons, scale, vmin, vmax, cmap);
    }
    _renderSparse(ri, ci, v, va, lats, lons, scale, vmin, vmax, cmap);
  } else if (spec.tileStyle === "fcmap") {
    const lats = _fcGrid.lats, lons = _fcGrid.lons, gri = _fcGrid.ri, gci = _fcGrid.ci;
    const rain = !!tile.rain;
    const systems = _centre === "__multi" ? Object.keys(tile.per_centre) : [_centre];
    // Isma, 17 Oct 2026: the forecast in every cell (the average of the chosen models' averages),
    // skill or not, lean or not; skill is in the tables. Dots where the two models disagree on the
    // sign of the change from normal: the SST stipple rule with two centres. Dry months: grey.
    const ref = rain ? 100 : 0;
    const fields = systems.map(s => _fcField(tile.per_centre[s].anom));
    const dry = tile.rain_based && tile.dry ? _fcField(tile.dry) : null;
    const ri = [], ci = [], v = [], va = [], gr = [], gc = [], gv = [];
    for (let i = 0; i < gri.length; i++) {
      const have = fields.map(f => f[i]).filter(x => x !== null);
      if (!have.length) continue;
      if (dry && dry[i] !== null && dry[i] > 0.5) { gr.push(gri[i]); gc.push(gci[i]); gv.push(0); continue; }
      ri.push(gri[i]); ci.push(gci[i]);
      v.push(have.reduce((t, x) => t + x, 0) / have.length);
      // va as in the SST tiles: % of centres agreeing with the sign; -1 = nothing to compare
      va.push(have.length < 2 ? -1 : ((have[0] - ref) * (have[1] - ref) < 0 ? 50 : 100));
    }
    _renderSparse(gr, gc, gv, null, lats, lons, 1, -1, 1, CMAPS.Grey);
    _renderSparse(ri, ci, v, va, lats, lons, 1, spec.vmin, spec.vmax, cmap);
  } else if (spec.tileStyle === "dense-daily") {
    // Daily precip tile: tile.{pr_total_mm|rx1day_mm} = {multi_model_median, per_centre_mean}
    const inner = tile[spec.innerKey];
    if (!inner) { console.warn("forecast_maps: missing field", spec.innerKey); return; }
    const field2d = (_centre === "__multi")
      ? inner.multi_model_median
      : (inner.per_centre_mean || {})[_centre];
    if (!field2d) return;
    const lats = tile.grid.lat;
    const lons = tile.grid.lon;
    // Convert dense to sparse-ish (drop NaN), reuse _renderSparse with scale=1
    const ri = [], ci = [], v = [];
    for (let r = 0; r < lats.length; r++) {
      for (let c = 0; c < lons.length; c++) {
        const vv = field2d[r][c];
        if (vv === null || vv === undefined || isNaN(vv)) continue;
        if (vv === 0) continue;   // skip zero precip to keep canvas lean
        ri.push(r); ci.push(c); v.push(vv);
      }
    }
    _renderSparse(ri, ci, v, null, lats, lons, 1, vmin, vmax, cmap);
  }
}

function _renderSparse(ri, ci, v, va, lats, lons, scale, vmin, vmax, cmap) {
  // Shrink cells slightly (factor < 1) to avoid coastal overdraw on land.
  const dlat = lats.length > 1 ? Math.abs(lats[1] - lats[0]) : 1.0;
  const dlon = lons.length > 1 ? Math.abs(lons[1] - lons[0]) : 1.0;
  const SHRINK = 0.92;
  const hlat = dlat * SHRINK / 2;
  const hlon = dlon * SHRINK / 2;
  const opacity = 0.90;

  // Widest a genuine cell can project to, with a generous allowance for
  // projection distortion. A cell straddling the antimeridian seam has one
  // corner wrapped to the far side and spans the whole map, so it lands far
  // above this and gets dropped below.
  const maxCellPx = Math.max(24, _projection.scale() * dlon * Math.PI / 180 * 20);

  const [λ0, φ0] = _projection.rotate().map(d => -d * Math.PI / 180);
  const landGrid = _buildLandMaskGrid(lats, lons);
  const nLon = lons.length;

  // Ocean variables (ssta) skip land cells; land variables (precip) skip ocean.
  const keepOnLand = (_variable !== "ssta");

  // Back-face culling only applies to globe-style projections (orthographic).
  // Robinson / equalEarth / naturalEarth1 render everything flat; skipping
  // would erroneously drop half the world on the far side of the rotation.
  const cullBackFace = (_projectionKind === "orthographic");

  let nDrawn = 0, nMasked = 0, nBack = 0;
  for (let idx = 0; idx < ri.length; idx++) {
    const r = ri[idx], c = ci[idx];
    // Land/ocean mask - skip cells on the wrong side
    const onLand = !!landGrid[r * nLon + c];
    if (keepOnLand ? !onLand : onLand) { nMasked++; continue; }

    const lon = lons[c], lat = lats[r];
    const λ = lon * Math.PI / 180;
    const φ = lat * Math.PI / 180;
    if (cullBackFace) {
      const dot = Math.sin(φ0)*Math.sin(φ) + Math.cos(φ0)*Math.cos(φ)*Math.cos(λ - λ0);
      if (dot < 0) { nBack++; continue; }
    }

    const val = v[idx] / scale;
    const t = (val - vmin) / (vmax - vmin);
    const [R, G, B] = interpolateColor(cmap, t);

    const corners = [
      [lon - hlon, lat - hlat],
      [lon + hlon, lat - hlat],
      [lon + hlon, lat + hlat],
      [lon - hlon, lat + hlat],
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
    nDrawn++;
  }
  console.log(`forecast_maps: drew=${nDrawn} skipMasked=${nMasked} skipBack=${nBack}`);

  // Robustness stippling: va[idx] is the percentage of contributing centres
  // that agree on the SIGN of the anomaly (-1 = missing / single-centre view).
  // Cells below the agreement threshold are not robust, so overlay a stipple dot
  // rather than let them read as confident colour - the same low-agreement
  // convention the teleconnection map uses (OPERATIONS section 5). The exact
  // fraction is carried in the tile meta (stipple_threshold_frac, 0.667 for the
  // 2-model mix), so the threshold follows the data instead of being hardcoded.
  if (_showStippling && va && va.length === ri.length) {
    const tile = _tiles[`${_variable}_L${_lead}`];
    const meta = (tile && tile.meta) || {};
    const threshFrac = (typeof meta.stipple_threshold_frac === "number")
      ? meta.stipple_threshold_frac : 0.667;
    const dotR = Math.max(0.8, Math.min(2.0, _projection.scale() / 600));
    _ctx.fillStyle = "rgba(40,40,40,0.55)";
    let nStipple = 0;
    for (let idx = 0; idx < ri.length; idx++) {
      const agree = va[idx];
      if (agree < 0 || agree / 100 >= threshFrac) continue;   // -1 = missing, skip
      const r = ri[idx], c = ci[idx];
      const onLand = !!landGrid[r * nLon + c];
      if (keepOnLand ? !onLand : onLand) continue;            // same mask as colour pass
      const lon = lons[c], lat = lats[r];
      if (cullBackFace) {
        const lam = lon * Math.PI / 180, phi = lat * Math.PI / 180;
        const dot = Math.sin(φ0)*Math.sin(phi) + Math.cos(φ0)*Math.cos(phi)*Math.cos(lam - λ0);
        if (dot < 0) continue;
      }
      const p = _projection([lon, lat]);
      if (!p) continue;
      _ctx.beginPath();
      _ctx.arc(p[0], p[1], dotR, 0, 2 * Math.PI);
      _ctx.fill();
      nStipple++;
    }
    console.log(`forecast_maps: stippled=${nStipple} (sign-agreement < ${(threshFrac*100).toFixed(1)}%)`);
  }
}

function _renderSVG() {
  _svg.selectAll("*").remove();
  // Globe outline (ocean fill - NO FILL so canvas beneath shows through)
  _svg.append("path")
    .datum({type:"Sphere"})
    .attr("d", _pathGen)
    .attr("fill", "none")
    .attr("stroke", "#6a7f99")
    .attr("stroke-width", 0.6);
  // Graticule
  const gr = d3.geoGraticule().step([30, 30])();
  _svg.append("path")
    .datum(gr)
    .attr("d", _pathGen)
    .attr("fill", "none")
    .attr("stroke", "rgba(80,100,120,0.25)")
    .attr("stroke-width", 0.4);
  // Country borders - transparent fill so the click has a wide hit target
  if (_countriesGeoJSON) {
    _svg.append("g")
      .selectAll("path")
      .data(_countriesGeoJSON.features)
      .join("path")
      .attr("d", _pathGen)
      .attr("fill", "rgba(255,255,255,0.01)")
      .attr("stroke", "rgba(30,30,40,0.65)")
      .attr("stroke-width", 0.4)
      .attr("class", "fm-country-path")
      .style("cursor", "pointer");
  }

  // Sub-national regions for the currently-drilled country, if any
  if (_activeCountry && _regionsGeoJSON) {
    const subset = _regionsGeoJSON.features.filter(f => {
      const p = f.properties || {};
      return (p.admin || p.ADMIN) === _activeCountry;
    });
    if (subset.length) {
      _svg.append("g")
        .selectAll("path")
        .data(subset)
        .join("path")
        .attr("d", _pathGen)
        .attr("fill", "rgba(255,200,0,0.04)")
        .attr("stroke", "rgba(200,120,0,0.8)")
        .attr("stroke-width", 0.8)
        .attr("class", "fm-region-path")
        .style("cursor", "pointer");

      // Highlight the active country outline more strongly
      const activeFeat = _countriesGeoJSON.features.find(f => {
        const n = (f.properties||{}).name || (f.properties||{}).NAME;
        return n === _activeCountry;
      });
      if (activeFeat) {
        _svg.append("path")
          .datum(activeFeat)
          .attr("d", _pathGen)
          .attr("fill", "none")
          .attr("stroke", "#d62728")
          .attr("stroke-width", 1.5);
      }
    }
  }
}

function _redraw() {
  _renderData();
  _renderSVG();
  _updateStippleLegend();
}

// Show the robustness-stipple legend only when the current view actually has
// sign-agreement data to stipple (multi-model SSTA). Single-centre views and
// variables without a `va` array draw no dots, so the legend is hidden.
function _updateStippleLegend() {
  const el = document.getElementById("fm-stipple-legend");
  if (!el) return;
  const tile = _tiles[`${_variable}_L${_lead}`];
  const hasAgreement = _showStippling && _centre === "__multi" && tile
    && (_isFc(_variable) ? !!tile.per_centre : Array.isArray(tile.va) && tile.va.length > 0);
  el.style.display = hasAgreement ? "flex" : "none";
}

// ── Colourbar ────────────────────────────────────────────────────────────────

/** The clicked cell in words: each model's value and the cell's flags (Isma, 17 Oct 2026: the
 *  record and past-range flags go in the tooltip, not the map). Null off the grid or in dry months. */
function _fcCellInfo(lon, lat) {
  const tile = _tiles[`${_variable}_L${_lead}`];
  if (!tile || !_fcGrid) return null;
  let best = -1, bd = 1e9;
  for (let i = 0; i < _fcGrid.ri.length; i++) {
    const d = Math.abs(_fcGrid.lats[_fcGrid.ri[i]] - lat) + Math.abs(_fcGrid.lons[_fcGrid.ci[i]] - lon);
    if (d < bd) { bd = d; best = i; }
  }
  if (best < 0 || bd > 1.0) return null;
  const dry = tile.rain_based && tile.dry ? _fcField(tile.dry) : null;
  if (dry && dry[best] !== null && dry[best] > 0.5) return "This cell: dry months: little rain falls then.";
  const unit = tile.rain ? "% of normal" : (VARIABLES[_variable].units || "");
  const parts = [];
  // the record flag only where both models have 9 in 10 runs past the record on the same side
  const bs = Object.values(tile.per_centre).map(pc => pc.beyond ? _fcField(pc.beyond)[best] : null)
    .map(b => (b === null ? 0 : Math.round(b)));
  const joint = bs.length === 2 && bs[0] !== 0 && bs[0] === bs[1];
  for (const [s, pc] of Object.entries(tile.per_centre)) {
    const v = _fcField(pc.anom)[best];
    if (v === null) continue;
    const name = (_fcManifest.sources || {})[s] || s;
    const flags = [];
    if (joint) flags.push("beyond the record since 1982 on this cell");
    const x = pc.extrap ? _fcField(pc.extrap)[best] : null;
    if (x !== null && x > 0.5) flags.push("beyond the model's past range; treat as indicative");
    const val = tile.rain ? `${Math.round(v)}${unit}` : `${v > 0 ? "+" : ""}${v.toFixed(1)}\u00a0${unit}`;
    parts.push(`${name} ${val}` + (flags.length ? ` (${flags.join("; ")})` : ""));
  }
  return parts.length ? `This cell: ${parts.join("; ")}.` : null;
}

/** Colour range for an outlook tile: rain 40 to 160 % of normal; the rest symmetric at
 *  the 98th percentile of the skilful cells, so one outlier does not wash the map out. */
function _fcRange(tile) {
  if (tile.rain) return [40, 160];
  const vals = [];
  for (const s of Object.keys(tile.per_centre)) {
    const a = _fcField(tile.per_centre[s].anom);
    a.forEach(x => { if (x !== null) vals.push(Math.abs(x)); });
  }
  vals.sort((p, q) => p - q);
  const top = vals.length ? vals[Math.floor(0.98 * (vals.length - 1))] : 1;
  const nice = [0.5, 1, 2, 3, 5, 10, 15, 20, 30, 50, 100].find(x => x >= top) || top;
  return [-nice, nice];
}

function renderColorbar(vmin, vmax, units) {
  const spec = VARIABLES[_variable];
  if (spec.tileStyle === "fcmap") {
    const tile = _tiles[`${_variable}_L${_lead}`];
    if (tile) {
      [vmin, vmax] = _fcRange(tile);
      spec.vmin = vmin; spec.vmax = vmax;
      const p = tile.period || {};
      tile.meta = { units: spec.units, label: `${spec.label.replace(/ vs normal$/, "")}, ${p.label || ""}`
        + `${(p.id || "")[0] === "N" ? ` (next ${p.id.slice(1)} months)` : ""}: average of the runs, `
        + (tile.rain ? "% of normal (100 = normal)" : `difference from normal (${spec.units})`)
        + ". Colours show the forecast everywhere; how well each model did in the past is in the tables on "
        + "the Event replay page. Dots: the models disagree on the sign."
        + (tile.rain_based ? " Grey: dry months." : "") };
    }
  }
  const cmap = CMAPS[spec.cmap] || CMAP_RDBU_R;
  // Read the units + label from the tile meta rather than the static registry:
  // the SSTA field is a variance-adjusted sigma, not K, and the meta label is
  // stamped with the valid month, so reading from the data keeps the colourbar
  // correct and never stale. Fall back to the registry when no tile is loaded.
  const tile = _tiles[`${_variable}_L${_lead}`];
  const meta = (tile && tile.meta) || {};
  const uUnits = meta.units || units || spec.units || "";
  const c = document.getElementById("fm-colorbar");
  const W = c.offsetWidth || 360;
  c.width = W;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, W, c.height);
  for (let x = 0; x < W; x++) {
    const [R,G,B] = interpolateColor(cmap, x/(W-1));
    ctx.fillStyle = `rgb(${R},${G},${B})`;
    ctx.fillRect(x, 0, 1, c.height);
  }
  document.getElementById("fm-cmin").textContent = vmin.toFixed(vmin === Math.floor(vmin) ? 0 : 1);
  document.getElementById("fm-cmax").textContent = (vmax >= 0 ? "+" : "") + vmax.toFixed(vmax === Math.floor(vmax) ? 0 : 1);
  const unitsSpan = c.parentElement.querySelector("span:last-child");
  if (unitsSpan) {
    // meta.label is the authoritative caption (already carries the sigma unit
    // and the valid month); fall back to the registry label + units bracket.
    unitsSpan.textContent = meta.label ? meta.label : `${spec.label} [${uUnits}]`;
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const container = document.getElementById("fm-map");
  if (!container) return;
  _W = container.clientWidth  || 900;
  _H = container.clientHeight || 500;

  _canvas = document.createElement("canvas");
  _canvas.width = _W; _canvas.height = _H;
  _canvas.style.cssText = "position:absolute;top:0;left:0;pointer-events:none;";
  container.appendChild(_canvas);
  _ctx = _canvas.getContext("2d");

  _svg = d3.select("#fm-map")
    .append("svg")
    .attr("width", _W)
    .attr("height", _H)
    .style("position", "absolute")
    .style("top", "0")
    .style("left", "0");

  _projectionKind = "orthographic";
  _projection = _buildProjection(_projectionKind);
  _pathGen = d3.geoPath(_projection);

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
  _svg.on("wheel", event => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 0.89;
    const s = Math.max(100, Math.min(_W * 5, _projection.scale() * factor));
    _projection.scale(s);
    _redraw();
  });

  // Discover tag, load manifest
  const metaEl = document.getElementById("fm-meta");
  _tag = await discoverTarget();
  if (!_tag) {
    metaEl.innerHTML = `<span style="color:#c62828">No forecast maps available.</span>`;
    return;
  }
  const mR = await fetch(_dv(DATA_BASE + `ssta_manifest_${_tag}.json`), {cache:"no-cache"});
  _manifest = await mR.json();
  const yy = _tag.slice(0,4), mm = _tag.slice(4,6);
  metaEl.innerHTML =
    `Init: <strong>${yy}-${mm}</strong> · ` +
    `Centres (${_manifest.n_centres}): <strong>${_manifest.centres_included.join(", ")}</strong>`;

  // Label the lead dropdown from the manifest's per-lead valid month when present
  // (the build writes valid_months), falling back to L1 = init month. Either way
  // the labels follow the data and never go stale after a rebuild.
  const _MONTHS = ["January","February","March","April","May","June",
                   "July","August","September","October","November","December"];
  const _vm = _manifest.valid_months || {};
  const _iy = parseInt(yy, 10), _im = parseInt(mm, 10);
  const _leadSel = document.getElementById("fm-lead");
  if (_leadSel) {
    [..._leadSel.options].forEach(o => {
      const L = parseInt(o.value, 10);
      let yr, mo;  // mo is 1..12
      if (_vm[L]) { const p = String(_vm[L]).split("-"); yr = +p[0]; mo = +p[1]; }
      else { const tot = (_iy * 12 + (_im - 1)) + (L - 1); yr = Math.floor(tot / 12); mo = (tot % 12) + 1; }
      o.textContent = `L${L} - ${_MONTHS[mo - 1]} ${yr}`;
    });
  }

  // Populate centre dropdown
  const sel = document.getElementById("fm-centre");
  for (const c of _manifest.centres_included) {
    const opt = document.createElement("option");
    opt.value = c; opt.textContent = c.toUpperCase();
    sel.appendChild(opt);
  }

  await _loadFcManifest();
  _syncMenus();

  // Preload all SSTA leads for default variable
  await preloadVariable(_variable);

  const spec = VARIABLES[_variable];
  renderColorbar(spec.vmin, spec.vmax, spec.units);

  document.getElementById("fm-lead").addEventListener("change", async e => {
    _lead = _isFc(_variable) ? e.target.value : parseInt(e.target.value, 10);
    if (_isFc(_variable)) await loadTile(_variable, _lead).catch(err => console.warn(err));
    const s = VARIABLES[_variable];
    renderColorbar(s.vmin, s.vmax, s.units);   // keep the meta caption's month in sync
    _redraw();
  });
  document.getElementById("fm-centre").addEventListener("change", e => {
    _centre = e.target.value;
    _redraw();
  });
  document.getElementById("fm-variable").addEventListener("change", async e => {
    _variable = e.target.value;
    _syncMenus();
    if (_isFc(_variable)) await loadTile(_variable, _lead).catch(err => console.warn(err));
    else await preloadVariable(_variable);
    const s = VARIABLES[_variable];
    renderColorbar(s.vmin, s.vmax, s.units);
    _redraw();
  });
  const projSel = document.getElementById("fm-projection");
  if (projSel) {
    projSel.addEventListener("change", e => {
      const newKind = e.target.value || "orthographic";
      _projection = _buildProjection(newKind);
      _pathGen = d3.geoPath(_projection);
      _renderSVG();
      _redraw();
    });
  }

  _redraw();
}

async function preloadVariable(variable) {
  const leads = _manifest.leads_available;
  await Promise.all(leads.map(L =>
    loadTile(variable, L).catch(e => console.warn("tile load failed", variable, L, e))
  ));
}

document.addEventListener("DOMContentLoaded", init);


// ── Country-click + time-series panel ────────────────────────────────────────

let _countrySeries = null;        // loaded precip_country_series_{TAG}.json
let _regionSeries  = null;        // loaded precip_region_series_{TAG}.json
let _regionsGeoJSON = null;       // ne_10m_admin_1 features
let _countryChart = null;
let _activeCountry = null;        // name of country being drilled into (for sub-region overlay)
let _activePanelScope = null;     // "country" | "region" | "pixel"
let _activePanelKey   = null;
let _pixelMode = false;           // when true: click anywhere on map opens pixel panel
let _pixelTiles = {};             // `${var}_L${lead}` → JSON (pixel precip tiles)

async function _loadCountrySeries() {
  if (_countrySeries !== null) return _countrySeries;
  try {
    const r = await fetch(_dv(DATA_BASE + `precip_country_series_${_tag}.json`), {cache:"no-cache"});
    if (!r.ok) throw new Error("HTTP " + r.status);
    _countrySeries = await r.json();
    console.log("forecast_maps: loaded", Object.keys(_countrySeries.countries).length, "countries series");
  } catch (e) {
    console.warn("forecast_maps: no country series", e);
    _countrySeries = {countries: {}};
  }
  return _countrySeries;
}

async function _loadRegionSeries() {
  if (_regionSeries !== null) return _regionSeries;
  try {
    const r = await fetch(_dv(DATA_BASE + `precip_region_series_${_tag}.json`), {cache:"no-cache"});
    if (!r.ok) throw new Error("HTTP " + r.status);
    _regionSeries = await r.json();
    console.log("forecast_maps: loaded", Object.keys(_regionSeries.regions).length, "regions series");
  } catch (e) {
    console.warn("forecast_maps: no region series", e);
    _regionSeries = {regions: {}};
  }
  return _regionSeries;
}


/** Force d3-geo ring winding on a FeatureCollection, in place.
 *
 *  d3-geo is spherical: the interior is the region to the LEFT of the ring, so
 *  an exterior ring must run clockwise in lon/lat. GeoJSON RFC 7946 says the
 *  opposite and d3 does not rewind for you, so a counter-clockwise exterior
 *  ring is drawn as the whole sphere minus that ring: invisible against the
 *  background, but its hit area covers the entire panel and it swallows every
 *  click. Natural Earth ships twelve such rings, all tiny four-point islands.
 *  Florida's took every click on the USA panel until 2026-09-18; clicking
 *  California selected Florida, and China and Japan had the same trap.
 *
 *  The builder normalises on write (scripts/analysis/finance/_geojson_winding.py)
 *  and an invariant fails if a bad ring reaches website/data. This is the third
 *  line: the served files can come from a bucket, and a click trap must never
 *  be one stale upload away.
 */
function _rewindForD3ForecastMaps(gj) {
  if (!gj || !gj.features) return gj;
  const area = ring => {
    let a = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  };
  const fix = rings => rings.map((r, i) => {
    if (r.length < 4) return r;
    const wantNegative = i === 0;                 // exterior clockwise, holes the other way
    return ((area(r) < 0) !== wantNegative) ? r.slice().reverse() : r;
  });
  for (const f of gj.features) {
    const g = f && f.geometry;
    if (!g) continue;
    if (g.type === "Polygon") g.coordinates = fix(g.coordinates);
    else if (g.type === "MultiPolygon") g.coordinates = g.coordinates.map(fix);
  }
  return gj;
}

async function _loadRegionsGeoJSON() {
  if (_regionsGeoJSON) return _regionsGeoJSON;
  try {
    const r = await fetch("data/maps/ne_10m_admin_1_states_provinces.geojson", {cache:"no-cache"});
    if (!r.ok) throw new Error("HTTP " + r.status);
    _regionsGeoJSON = _rewindForD3ForecastMaps(await r.json());
  } catch (e) {
    console.warn("forecast_maps: no admin-1 geojson", e);
    _regionsGeoJSON = {features: []};
  }
  return _regionsGeoJSON;
}

async function _loadPixelTile(variable, lead) {
  const key = `${variable}_L${lead}`;
  if (_pixelTiles[key]) return _pixelTiles[key];
  const url = DATA_BASE + `pixel_precip_${variable}_L${lead}_${_tag}.json`;
  try {
    const r = await fetch(_dv(url), {cache:"no-cache"});
    if (!r.ok) throw new Error("HTTP " + r.status);
    _pixelTiles[key] = await r.json();
  } catch (e) {
    console.warn("forecast_maps: pixel tile load failed", url, e);
    _pixelTiles[key] = null;
  }
  return _pixelTiles[key];
}

async function _preloadPixelVar(variable) {
  await Promise.all([1,2,3,4,5,6].map(L => _loadPixelTile(variable, L)));
}

async function showPixelPanel(lon, lat) {
  // Find nearest land cell across any already-loaded pixel tile
  const variable = document.getElementById("fm-country-variable").value || "pr_total_mm";
  await _preloadPixelVar(variable);
  // Use L1 tile to pick the cell index closest to (lat, lon)
  const tL1 = _pixelTiles[`${variable}_L1`];
  if (!tL1) return;
  const lats = tL1.lats, lons = tL1.lons;
  // Find nearest grid row/col
  let bestIdx = -1, bestDist = 1e18;
  for (let i = 0; i < tL1.ri.length; i++) {
    const r = tL1.ri[i], c = tL1.ci[i];
    const dlat = lats[r] - lat;
    // wrap lon into same sign as dataset
    let lon_ds = lons[c];
    let dlon = lon_ds - lon;
    if (dlon > 180) dlon -= 360;
    if (dlon < -180) dlon += 360;
    const d = dlat*dlat + dlon*dlon;
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  if (bestIdx < 0) return;
  const ri = tL1.ri[bestIdx], ci = tL1.ci[bestIdx];
  const cellLat = tL1.lats[ri], cellLon = tL1.lons[ci];

  // Assemble per-centre quantile arrays across 6 leads
  const centres = Object.keys(tL1.centres);
  const field = {};
  for (const src of centres) {
    const p10 = new Array(6).fill(null);
    const p50 = new Array(6).fill(null);
    const p90 = new Array(6).fill(null);
    for (let L = 1; L <= 6; L++) {
      const t = _pixelTiles[`${variable}_L${L}`];
      if (!t) continue;
      const scale = (t.meta && t.meta.scale) || 10;
      // Find bestIdx in this tile's sparse arrays (should be same order)
      // Tiles share ri/ci ordering since built from same land mask.
      const idx = bestIdx;
      if (t.centres[src]) {
        p10[L-1] = t.centres[src].p10[idx] / scale;
        p50[L-1] = t.centres[src].p50[idx] / scale;
        p90[L-1] = t.centres[src].p90[idx] / scale;
      }
    }
    field[src] = {p10, p50, p90,
      // Fill in P25/P75 as midpoints so the box+whisker renderer still draws
      p25: p10.map((v,i) => v==null||p50[i]==null ? null : (v+p50[i])/2),
      p75: p50.map((v,i) => v==null||p90[i]==null ? null : (v+p90[i])/2),
    };
  }

  _activePanelScope = "pixel";
  _activePanelKey   = `pixel:${cellLat.toFixed(1)},${cellLon.toFixed(1)}:${variable}`;
  const card = document.getElementById("fm-country-card");
  card.classList.add("active");
  document.getElementById("fm-country-title").textContent =
    `Pixel ${cellLat.toFixed(1)}°N ${cellLon.toFixed(1)}°E - precip forecast`;
  const backBtn = document.getElementById("fm-country-back");
  if (backBtn) backBtn.style.display = "none";
  // Build a shape matching what _renderCountryChart expects
  const pseudoCountry = {[variable]: field};
  _renderCountryChart(pseudoCountry);
  card.scrollIntoView({behavior: "smooth", block: "nearest"});
}

function _countryColor(src) {
  return (typeof CENTRE_COLOR === "object" ? CENTRE_COLOR : {})[src] || "#888";
}
function _centreShort(src) {
  return (typeof CENTRE_SHORT === "object" ? CENTRE_SHORT : {})[src] || src.toUpperCase();
}

async function showCountryPanel(name) {
  if (!name) return;

  // Don't offer a country drill-down when the user is looking at a variable
  // that has no country-level series (e.g. SSTA - SST averaged over a country
  // is scientifically meaningless). Keep the per-country drill-down for
  // precipitation / drought-style indices only.
  if (!_variableSupportsCountryDrill(_variable)) {
    _flashMapToast(`Country drill-down isn't available for ${_variableLabel(_variable)}. ` +
                    `Switch to a precip variable (Monthly precip, RX1DAY) first.`);
    return;
  }

  const series = await _loadCountrySeries();
  const country = series.countries[name];
  if (!country) {
    console.warn("forecast_maps: no country series for", name);
    return;
  }
  // Also load regions + geojson so the map can overlay them
  await Promise.all([_loadRegionSeries(), _loadRegionsGeoJSON()]);
  _activeCountry    = name;
  _activePanelScope = "country";
  _activePanelKey   = name;
  const card = document.getElementById("fm-country-card");
  card.classList.add("active");
  document.getElementById("fm-country-title").textContent =
    `${name} - precip forecast from ${series.init} init`;
  // Sync the drill-down variable dropdown to the current map variable when possible
  _syncCountryDrillVariable();
  _renderCountryChart(country);
  const backBtn = document.getElementById("fm-country-back");
  if (backBtn) backBtn.style.display = "none";
  _redraw();  // repaint globe with sub-region overlay
  card.scrollIntoView({behavior: "smooth", block: "nearest"});
}

// Country drill-down is supported only for variables that have a country
// series on disk. Currently: monthly precip total, RX1DAY, RX10DAY, CDD.
// SSTA does NOT get a per-country drill (averaging SST over a country is
// not meaningful).
const _COUNTRY_DRILL_VARIABLES = new Set([
  "pr_total_mm", "rx1day_mm", "rx10day_mm", "cdd_days",
]);
function _variableSupportsCountryDrill(v) { return _COUNTRY_DRILL_VARIABLES.has(v); }
function _variableLabel(v) {
  const labels = {
    ssta: "SSTA",
    pr_total_mm: "monthly precip total",
    rx1day_mm: "RX1DAY",
    rx10day_mm: "RX10DAY",
    cdd_days: "CDD",
  };
  return labels[v] || v;
}
function _syncCountryDrillVariable() {
  const cv = document.getElementById("fm-country-variable");
  if (!cv) return;
  const want = _variable;
  const opt = [...cv.options].find(o => o.value === want);
  if (opt) cv.value = want;
}
function _flashMapToast(msg) {
  let t = document.getElementById("fm-toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "fm-toast";
    t.style.cssText = "position:fixed;bottom:1rem;right:1rem;background:rgba(20,30,50,0.92);" +
                       "color:#fff;padding:0.6rem 1rem;border-radius:6px;font-size:0.82rem;" +
                       "max-width:420px;z-index:9000;box-shadow:0 4px 14px rgba(0,0,0,0.35)";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(t._hideT);
  t._hideT = setTimeout(() => { t.style.display = "none"; }, 5000);
}

async function showRegionPanel(admin, regionName) {
  if (!_variableSupportsCountryDrill(_variable)) {
    _flashMapToast(`Region drill-down isn't available for ${_variableLabel(_variable)}. ` +
                    `Switch to a precip variable first.`);
    return;
  }
  const series = await _loadRegionSeries();
  const key = `${admin}|${regionName}`;
  const region = series.regions[key];
  if (!region) {
    console.warn("forecast_maps: no region series for", key);
    return;
  }
  _activePanelScope = "region";
  _activePanelKey   = key;
  const card = document.getElementById("fm-country-card");
  card.classList.add("active");
  document.getElementById("fm-country-title").textContent =
    `${regionName}, ${admin} - precip forecast from ${series.init} init`;
  _syncCountryDrillVariable();
  _renderCountryChart(region);
  const backBtn = document.getElementById("fm-country-back");
  if (backBtn) backBtn.style.display = "inline-block";
  card.scrollIntoView({behavior: "smooth", block: "nearest"});
}

function resetDrill() {
  _activeCountry = null;
  _activePanelScope = null;
  _activePanelKey = null;
  document.getElementById("fm-country-card").classList.remove("active");
  if (_countryChart) { try { _countryChart.destroy(); } catch (_) {} _countryChart = null; }
  _redraw();
}

// Destroy + redraw - Chart.js doesn't have native box plot, so we use a
// custom plugin that draws one box per (lead, centre) using the 5 quantiles.
function _renderCountryChart(country) {
  const canvas = document.getElementById("fm-country-chart");
  if (_countryChart) { try { _countryChart.destroy(); } catch (_) {} _countryChart = null; }
  const variable = document.getElementById("fm-country-variable").value;
  const field = country[variable];
  if (!field) return;

  const centres = Object.keys(field);
  const N_LEADS = 6;
  const leadLabels = ["L1","L2","L3","L4","L5","L6"];

  // Compute global y-limits across all centres & quantiles
  let ymin = Infinity, ymax = -Infinity;
  for (const src of centres) {
    for (const k of ["p10","p25","p50","p75","p90"]) {
      for (const v of (field[src][k] || [])) {
        if (v == null || !isFinite(v)) continue;
        if (v < ymin) ymin = v;
        if (v > ymax) ymax = v;
      }
    }
  }
  if (!isFinite(ymin)) { ymin = 0; ymax = 1; }
  ymin = Math.min(0, ymin);
  // Round ymax up to a "nice" tick so the axis label isn't e.g. 132.7.
  // Pick a step from {1,2,5}×10^k that keeps ~5 visible ticks, then ceil
  // ymax to the next multiple of that step.
  function _niceAxisMax(raw) {
    if (raw <= 0) return 1;
    const pow10 = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / pow10;           // in [1, 10)
    let step;
    if (n <= 1)   step = 0.2 * pow10;
    else if (n <= 2) step = 0.5 * pow10;
    else if (n <= 5) step = 1.0 * pow10;
    else             step = 2.0 * pow10;
    return Math.ceil(raw * 1.02 / step) * step;
  }
  ymax = _niceAxisMax(ymax);

  // Build dummy datasets so Chart.js lays out the axis + legend entries
  const datasets = centres.map(src => ({
    label: _centreShort(src),
    data: field[src].p50 || [],
    borderColor: _countryColor(src),
    backgroundColor: _countryColor(src),
    borderWidth: 0,
    pointRadius: 0,
    showLine: false,
    _boxData: {src, q: field[src]},
  }));

  // Custom plugin: draw boxes + whiskers + median line + P10/P90 whiskers.
  const boxPlugin = {
    id: "boxWhiskerDraw",
    afterDatasetsDraw(chart) {
      const {ctx, chartArea, scales} = chart;
      const xScale = scales.x;
      const yScale = scales.y;
      const categoryW = (xScale.getPixelForValue(1) - xScale.getPixelForValue(0));
      const nC = centres.length;
      const boxW = Math.max(6, Math.min(28, categoryW * 0.8 / nC));
      for (let L = 0; L < N_LEADS; L++) {
        const cx0 = xScale.getPixelForValue(L);
        for (let i = 0; i < nC; i++) {
          const src = centres[i];
          const q   = field[src];
          const p10 = q.p10?.[L], p25 = q.p25?.[L], p50 = q.p50?.[L];
          const p75 = q.p75?.[L], p90 = q.p90?.[L];
          if ([p10, p25, p50, p75, p90].some(v => v == null || !isFinite(v))) continue;

          const offset = (i - (nC - 1) / 2) * (boxW + 2);
          const x = cx0 + offset;
          const y10 = yScale.getPixelForValue(p10);
          const y25 = yScale.getPixelForValue(p25);
          const y50 = yScale.getPixelForValue(p50);
          const y75 = yScale.getPixelForValue(p75);
          const y90 = yScale.getPixelForValue(p90);
          const col = _countryColor(src);

          // Whisker line
          ctx.strokeStyle = col;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, y10); ctx.lineTo(x, y90);
          ctx.stroke();
          // Whisker caps
          ctx.beginPath();
          ctx.moveTo(x - boxW*0.3, y10); ctx.lineTo(x + boxW*0.3, y10);
          ctx.moveTo(x - boxW*0.3, y90); ctx.lineTo(x + boxW*0.3, y90);
          ctx.stroke();
          // Box (P25-P75)
          ctx.fillStyle = col + "55";
          ctx.fillRect(x - boxW/2, y75, boxW, y25 - y75);
          ctx.strokeStyle = col;
          ctx.strokeRect(x - boxW/2, y75, boxW, y25 - y75);
          // Median line
          ctx.strokeStyle = "#111";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x - boxW/2, y50); ctx.lineTo(x + boxW/2, y50);
          ctx.stroke();
        }
      }
    },
  };

  _countryChart = new Chart(canvas.getContext("2d"), {
    type: "scatter",
    data: {labels: leadLabels, datasets},
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: {position: "bottom"},
        tooltip: {enabled: false},
      },
      scales: {
        x: {
          type: "linear",
          min: -0.5,
          max: N_LEADS - 0.5,
          ticks: {
            stepSize: 1,
            callback: (v) => leadLabels[v] || "",
          },
          title: {display: true, text: "Lead month"},
          grid: {display: false},
        },
        y: {
          min: ymin,
          max: ymax,
          title: {
            display: true,
            text: ({
              pr_total_mm: "Monthly precip total (mm/month)",
              rx1day_mm:   "RX1DAY (mm/day)",
              rx10day_mm:  "RX10DAY (mm / 10-day)",
              cdd_days:    "CDD (days)",
            }[variable] || variable),
          },
        },
      },
    },
    plugins: [boxPlugin],
  });
}

// Wire up controls and SVG click handler once init() has built the globe
(function setupCountryClickHooks() {
  const interval = setInterval(() => {
    if (_countriesGeoJSON && _svg) {
      clearInterval(interval);
      _attachCountryClicks();
    }
  }, 250);
})();

function _attachCountryClicks() {
  // Re-attach after each _renderSVG() call (countries get rebuilt each redraw).
  const wrap = _renderSVG;
  // Only wrap once - guard
  if (wrap._patchedForClicks) return;
  wrap._patchedForClicks = true;
  // Hook into existing _renderSVG: patch via monkey-patching wouldn't persist
  // because render-svg is a private function. Easier: use d3 delegated click.
  _svg.on("click", (event) => {
    // Always invert the click to geographic coordinates, then do a
    // point-in-polygon test against the features. This avoids SVG hit-test
    // artefacts for polygons that span the antimeridian or are weirdly
    // shaped after orthographic projection (Alaska/Russia/Fiji).
    const svgNode = _svg.node();
    const rect = svgNode.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const ll = _projection.invert([x, y]);
    if (!ll) return;
    const [lon, lat] = ll;

    if (_isFc(_variable)) {
      const info = _fcCellInfo(lon, lat);
      _flashMapToast((info ? info + " " : "") + "Region by region detail for this forecast: Event replay, with "
                     + "the country and the developing El Niño selected.");
      return;
    }
    if (_pixelMode) {
      showPixelPanel(lon, lat);
      return;
    }

    // Two-level drill. If a country is already active, look for a region hit first.
    if (_activeCountry && _regionsGeoJSON) {
      const hit = _findFeatureHit(lon, lat,
        _regionsGeoJSON.features.filter(f => {
          const p = f.properties || {};
          return (p.admin || p.ADMIN) === _activeCountry;
        })
      );
      if (hit) {
        const p = hit.properties || {};
        const admin = p.admin || p.ADMIN;
        const name  = p.name  || p.NAME;
        if (admin && name) { showRegionPanel(admin, name); return; }
      }
    }
    // Otherwise, fall back to country hit
    if (_countriesGeoJSON) {
      const hit = _findFeatureHit(lon, lat, _countriesGeoJSON.features);
      if (hit) {
        const p = hit.properties || {};
        const name = p.name || p.NAME || p.ADMIN;
        if (name) showCountryPanel(name);
      }
    }
  });

  function _findFeatureHit(lon, lat, features) {
    // GeoJSON coords are -180..180; user clicks also come back from
    // _projection.invert in that range.
    for (const f of features) {
      const g = f.geometry;
      if (!g) continue;
      if (g.type === "Polygon") {
        if (_pointInPolygon(lon, lat, g.coordinates)) return f;
      } else if (g.type === "MultiPolygon") {
        for (const poly of g.coordinates) {
          if (_pointInPolygon(lon, lat, poly)) return f;
        }
      }
    }
    return null;
  }

  document.getElementById("fm-pixel-mode")?.addEventListener("change", (e) => {
    _pixelMode = e.target.checked;
    if (_pixelMode) {
      // When pixel mode is on, hide country hover cursor
      document.querySelectorAll(".fm-country-path").forEach(el => el.style.cursor = "crosshair");
    }
  });
  // Variable selector → re-render chart for whatever is currently shown
  document.getElementById("fm-country-variable").addEventListener("change", () => {
    if (!_activePanelScope) return;
    let data = null;
    if (_activePanelScope === "country") {
      data = _countrySeries?.countries?.[_activePanelKey];
    } else if (_activePanelScope === "region") {
      data = _regionSeries?.regions?.[_activePanelKey];
    }
    if (data) _renderCountryChart(data);
  });
  // Close button
  document.getElementById("fm-country-close").addEventListener("click", () => {
    resetDrill();
  });
  // Back-to-country button (visible only in region scope)
  document.getElementById("fm-country-back")?.addEventListener("click", () => {
    if (_activeCountry) showCountryPanel(_activeCountry);
    document.getElementById("fm-country-back").style.display = "none";
  });
}
