/* forecast_maps.js - Multi-model SSTA forecast renderer
 *
 * Uses the same D3 orthographic globe engine as map_explorer.js, adapted
 * for the forecast tile schema (sparse {ri, ci, v, va} + per_centre).
 */
"use strict";

const DATA_BASE = "data/forecast_maps/";

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
    units: "K", label: "SSTA",
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

let _tag = null;
let _manifest = null;
let _tiles = {};          // `${var}_L${lead}` → JSON
let _variable = "ssta";
let _lead = 1;
let _centre = "__multi";

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
      const r = await fetch(DATA_BASE + `ssta_manifest_${tag}.json`, {cache:"no-cache"});
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
  const url = DATA_BASE + `${spec.filePrefix}${lead}_${_tag}.json`;
  const r = await fetch(url, {cache:"no-cache"});
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

function _renderSparse(ri, ci, v, _ignoredVa, lats, lons, scale, vmin, vmax, cmap) {
  // Shrink cells slightly (factor < 1) to avoid coastal overdraw on land.
  const dlat = lats.length > 1 ? Math.abs(lats[1] - lats[0]) : 1.0;
  const dlon = lons.length > 1 ? Math.abs(lons[1] - lons[0]) : 1.0;
  const SHRINK = 0.92;
  const hlat = dlat * SHRINK / 2;
  const hlon = dlon * SHRINK / 2;
  const opacity = 0.90;

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

    _ctx.beginPath();
    _ctx.moveTo(corners[0][0], corners[0][1]);
    for (let k = 1; k < corners.length; k++) _ctx.lineTo(corners[k][0], corners[k][1]);
    _ctx.closePath();
    _ctx.fillStyle = `rgba(${R},${G},${B},${opacity})`;
    _ctx.fill();
    nDrawn++;
  }
  console.log(`forecast_maps: drew=${nDrawn} skipMasked=${nMasked} skipBack=${nBack}`);
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
}

// ── Colourbar ────────────────────────────────────────────────────────────────

function renderColorbar(vmin, vmax, units) {
  const spec = VARIABLES[_variable];
  const cmap = CMAPS[spec.cmap] || CMAP_RDBU_R;
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
  if (unitsSpan && units) {
    unitsSpan.textContent = `${spec.label} [${units}]`;
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
  const mR = await fetch(DATA_BASE + `ssta_manifest_${_tag}.json`, {cache:"no-cache"});
  _manifest = await mR.json();
  const yy = _tag.slice(0,4), mm = _tag.slice(4,6);
  metaEl.innerHTML =
    `Init: <strong>${yy}-${mm}</strong> · ` +
    `Centres (${_manifest.n_centres}): <strong>${_manifest.centres_included.join(", ")}</strong>`;

  // Label the lead dropdown from the init month (L1 = init month), so the
  // valid-month labels follow the data and never go stale after a rebuild.
  const _MONTHS = ["January","February","March","April","May","June",
                   "July","August","September","October","November","December"];
  const _iy = parseInt(yy, 10), _im = parseInt(mm, 10);
  const _leadSel = document.getElementById("fm-lead");
  if (_leadSel) {
    [..._leadSel.options].forEach(o => {
      const L = parseInt(o.value, 10);
      const tot = (_iy * 12 + (_im - 1)) + (L - 1);
      o.textContent = `L${L} - ${_MONTHS[tot % 12]} ${Math.floor(tot / 12)}`;
    });
  }

  // Populate centre dropdown
  const sel = document.getElementById("fm-centre");
  for (const c of _manifest.centres_included) {
    const opt = document.createElement("option");
    opt.value = c; opt.textContent = c.toUpperCase();
    sel.appendChild(opt);
  }

  // Preload all SSTA leads for default variable
  await preloadVariable(_variable);

  const spec = VARIABLES[_variable];
  renderColorbar(spec.vmin, spec.vmax, spec.units);

  document.getElementById("fm-lead").addEventListener("change", e => {
    _lead = parseInt(e.target.value, 10);
    _redraw();
  });
  document.getElementById("fm-centre").addEventListener("change", e => {
    _centre = e.target.value;
    _redraw();
  });
  document.getElementById("fm-variable").addEventListener("change", async e => {
    _variable = e.target.value;
    await preloadVariable(_variable);
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
    const r = await fetch(DATA_BASE + `precip_country_series_${_tag}.json`, {cache:"no-cache"});
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
    const r = await fetch(DATA_BASE + `precip_region_series_${_tag}.json`, {cache:"no-cache"});
    if (!r.ok) throw new Error("HTTP " + r.status);
    _regionSeries = await r.json();
    console.log("forecast_maps: loaded", Object.keys(_regionSeries.regions).length, "regions series");
  } catch (e) {
    console.warn("forecast_maps: no region series", e);
    _regionSeries = {regions: {}};
  }
  return _regionSeries;
}

async function _loadRegionsGeoJSON() {
  if (_regionsGeoJSON) return _regionsGeoJSON;
  try {
    const r = await fetch("data/maps/ne_10m_admin_1_states_provinces.geojson", {cache:"no-cache"});
    if (!r.ok) throw new Error("HTTP " + r.status);
    _regionsGeoJSON = await r.json();
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
    const r = await fetch(url, {cache:"no-cache"});
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
