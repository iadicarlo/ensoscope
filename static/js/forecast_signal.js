/* forecast_signal.js - the pure logic behind the Teleconnections panel
 * "ENSO forecast and what past events did here".
 *
 * Kept apart from map_explorer.js so it can be tested without a browser
 * (scripts/analysis/tests/test_forecast_signal_panel.py runs it under node).
 *
 * Why this exists (audit 2026-10-16, M1): the panel used to average the WHOLE
 * global tile, so for Kenya in September to November it reported "Drier than
 * normal" at every lead while the cells inside Kenya were 57 mm wetter in
 * extreme El Nino seasons. It also used the map's season for every forecast
 * month, one model, and an argmax over seven classes. Everything below works
 * on the selected country's own cells, the season each forecast month falls
 * in, both models, and the Forecast page's family-first rule.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EnsoSignal = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const EN = ["moderate_el_nino", "strong_el_nino", "extreme_el_nino"];
  const LN = ["moderate_la_nina", "strong_la_nina", "extreme_la_nina"];

  // Same rule as the Forecast page (app.js _dominantPhase): the family with the
  // highest total chance first (La Nina, then El Nino, then neutral on ties, as
  // there), then the strength with the highest chance inside that family.
  function mostLikelyClass(lead) {
    const p = c => lead[c] || 0;
    const pLN = LN.reduce((s, c) => s + p(c), 0);
    const pEN = EN.reduce((s, c) => s + p(c), 0);
    const pNeu = p("neutral");
    let fam;
    if (pLN >= pEN && pLN >= pNeu) fam = LN.slice().reverse();
    else if (pEN >= pLN && pEN >= pNeu) fam = EN;
    else fam = ["neutral"];
    return fam.reduce((best, c) => p(c) > p(best) ? c : best, fam[0]);
  }

  function familyOf(cls) {
    return cls.includes("el_nino") ? "el_nino" : cls.includes("la_nina") ? "la_nina" : "neutral";
  }

  // Chance of the class's whole family (El Nino, La Nina or neutral).
  function familyChance(lead, cls) {
    const fam = familyOf(cls);
    const members = fam === "el_nino" ? EN : fam === "la_nina" ? LN : ["neutral"];
    return members.reduce((s, c) => s + (lead[c] || 0), 0);
  }

  // The three-month season a calendar month (1-12) belongs to, as the map's
  // season keys: Dec-Feb, Mar-May, Jun-Aug, Sep-Nov.
  function seasonOfMonth(m) {
    if (m === 12 || m === 1 || m === 2) return "djf";
    if (m >= 3 && m <= 5) return "mam";
    if (m >= 6 && m <= 8) return "jja";
    return "son";
  }

  // Ray casting on one polygon (outer ring plus holes).
  function _inPolygon(lon, lat, polygon) {
    let inside = false;
    for (const ring of polygon) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
      }
    }
    return inside;
  }

  function inGeometry(lon, lat, geom) {
    if (!geom) return false;
    if (geom.type === "Polygon") return _inPolygon(lon, lat, geom.coordinates);
    if (geom.type === "MultiPolygon") return geom.coordinates.some(p => _inPolygon(lon, lat, p));
    return false;
  }

  function _bbox(geom) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
    for (const poly of polys) for (const ring of poly) for (const [x, y] of ring) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return [x0, y0, x1, y1];
  }

  // Indices (into the tile's value array) of the cells whose centre lies inside
  // the geometry. Depends only on the grid and the geometry, so callers cache it.
  function cellsInside(grid, geom) {
    const { lats, lons, ri, ci } = grid;
    const out = [];
    if (!geom || !ri) return out;
    const [x0, y0, x1, y1] = _bbox(geom);
    for (let k = 0; k < ri.length; k++) {
      const lat = lats[ri[k]], lon = lons[ci[k]];
      if (lat < y0 || lat > y1 || lon < x0 || lon > x1) continue;
      if (inGeometry(lon, lat, geom)) out.push(k);
    }
    return out;
  }

  // Area-weighted mean of the tile over the given cells: a regular lat-lon cell
  // covers an area proportional to cos(latitude).
  function areaMean(tile, cells) {
    let sw = 0, swv = 0;
    for (const k of cells) {
      const v = tile.v[k];
      if (v === null || v === undefined || Number.isNaN(v)) continue;
      const w = Math.cos(tile.lats[tile.ri[k]] * Math.PI / 180);
      sw += w; swv += w * (v / tile.scale);
    }
    return sw > 0 ? swv / sw : null;
  }

  // A change smaller than this, in the index's own units, reads "no clear
  // signal". Stated in the panel; keep the two in step.
  const THRESHOLD = { rx10day_anomaly: 0.5, cdd_anomaly: 0.5 };

  function direction(mean, variable) {
    if (mean === null || mean === undefined) return 0;
    const t = THRESHOLD[variable] != null ? THRESHOLD[variable] : 0.5;
    // Decide on the value as the panel prints it (one decimal), so a printed
    // "+0.5" can never sit beside "no clear signal".
    const r = Math.round(mean * 10) / 10;
    return r >= t ? 1 : r <= -t ? -1 : 0;
  }

  return { mostLikelyClass, familyOf, familyChance, seasonOfMonth, inGeometry, cellsInside,
           areaMean, direction, THRESHOLD };
});
