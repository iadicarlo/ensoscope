/* event_replay.js - replay one observed ENSO event, month by month, for one country.
 *
 * Everything else on the site composites events into seasons. This page does the
 * opposite: it shows the actual monthly sequence of a single event, with every
 * other observed event of the same type drawn faintly behind it so "was this one
 * unusual?" is answerable by eye.
 *
 * Data contract:
 *   data/replay/events.json    event catalogue + window per event + the Nino3.4 axis
 *   data/replay/index.json     which countries exist
 *   data/replay/<id>.json      one country's monthly series, 1981-2025
 *   data/obs_nino.json         monthly Nino3.4 (already served for the front page)
 *
 * Alignment: month 0 is January of each event's OWN first year, so month 11 is the
 * first December of every event whatever calendar year it fell in. That is what
 * makes different events comparable on one axis.
 */
"use strict";

const RP = {
  events: null,      // events.json
  countries: null,   // index.json
  nino: null,        // obs_nino.json
  country: null,     // currently loaded country payload
  forecast: null,    // SEAS5 Nino3.4 plume, drawn only where the event is running
  forecastMf9: null, // Meteo-France System 9, same
  charts: {},
  // Which cut-off each threshold panel is showing. Defaults are the mildest
  // useful one: >=32 UTCI and >=25 nights are the levels most countries
  // actually reach, so the page opens on a panel with something in it.
  thr: { heat: "utci_strong_days", night: "night_equatorial" },
};

const RP_COLOR = {
  el_nino: "#B2182B",
  la_nina: "#2166AC",
  neutral: "#6B7B8A",
  other:   "rgba(120,134,148,0.28)",   // the comparison band
  zero:    "#C7CED6",
};

function _fam(phase, entry) {
  // The synthetic "current conditions" entry has no catalogued phase, so it
  // carries the family its latest observation implies. Without this it fell
  // through to neutral and silently lost its comparison band, which is the one
  // thing that makes a developing event readable.
  if (entry && entry.is_current && entry.family) {
    return entry.family === "El Nino" ? "el_nino"
         : entry.family === "La Nina" ? "la_nina" : "neutral";
  }
  return phase.includes("el_nino") ? "el_nino"
       : phase.includes("la_nina") ? "la_nina" : "neutral";
}

// ── where the data lives ─────────────────────────────────────────────────────
// Tile data can outgrow the page's own host. The heavy directories (per-month
// global fields, per-country fields, the teleconnection tiles) are ~480 MB and
// climb with every index added, while the site itself is a few MB of HTML and
// JS. Those belong in object storage, not in the same budget as the markup.
//
// window.ENSOSCOPE_DATA_BASE, set by static/js/data_base.js, moves them without
// touching a single fetch call here. Empty means "same origin", which is what
// it is today. Anything else must serve CORS and should be a CDN-backed bucket.
//
// Deliberately only the HEAVY paths are rebased: the small JSON the page needs
// on first paint stays same-origin so first render never waits on a second
// host, and so the page still works if the bucket is unreachable.
const RP_DATA_BASE = (typeof window !== "undefined" && window.ENSOSCOPE_DATA_BASE) || "";
// The .geojson exclusion is load-bearing. data/maps holds two different kinds
// of thing: generated tiles, which are heavy, versioned and rebuilt every month,
// and the Natural Earth basemaps, which are 6.7 MB, static, and shared with
// forecast_maps.js, map_explorer.js and emdat_backtest.html. Those three fetch
// them by plain relative path, so the outlines must stay on the page's origin.
// Without this exclusion the replay map alone would look for them in the bucket
// and every country border on the tab would vanish the moment DATA_BASE is set.
// regions joined the bucket on 2026-08-27: 981 files, 94 MB of admin-1 series,
// which only this tab reads and which no page needs on first paint.
const RP_HEAVY = /^data\/(replay\/(globalmonths|months|maps|regions)|maps)\/(?!.*\.geojson$)/;

const RP_DATA_VERSION = (typeof window !== "undefined" && window.ENSOSCOPE_DATA_VERSION) || "";

function _dataURL(path) {
  const heavy = RP_HEAVY.test(path);
  const base = (RP_DATA_BASE && heavy) ? RP_DATA_BASE.replace(/\/+$/, "") + "/" : "";
  // Version only the heavy paths: they are immutable within a deploy, so the
  // query string is what lets them be cached hard without ever going stale.
  const v = (heavy && RP_DATA_VERSION && !path.includes("?"))
    ? (path.includes("?") ? "&" : "?") + "v=" + RP_DATA_VERSION : "";
  return base + path + v;
}

async function _getJSON(url) {
  // Heavy tiles are cacheable and MUST be cached: no-store on immutable data
  // means every revisit re-fetches every tile, which on metered object storage
  // is the line item that grows. The small first-paint JSON stays no-store so
  // a data refresh is picked up immediately.
  const heavy = RP_HEAVY.test(url);
  const r = await fetch(_dataURL(url), heavy ? {} : { cache: "no-store" });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

// ── month arithmetic ─────────────────────────────────────────────────────────
// "YYYY-MM" strings throughout, because that is what every served file uses and
// Date parsing of bare year-months is inconsistent across browsers.
function _monthsFrom(startYM, n) {
  const [y0, m0] = startYM.split("-").map(Number);
  const out = [];
  for (let i = 0; i < n; i++) {
    const y = y0 + Math.floor((m0 - 1 + i) / 12);
    const m = ((m0 - 1 + i) % 12) + 1;
    out.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return out;
}

/** Values for one event window, aligned to month 0 = Jan of its onset year. */
function _sliceByMonths(times, values, wantMonths) {
  const idx = {};
  for (let i = 0; i < times.length; i++) idx[times[i]] = i;
  return wantMonths.map(m => (m in idx ? values[idx[m]] : null));
}

// ── chart plumbing ───────────────────────────────────────────────────────────
function _destroy(key) {
  if (RP.charts[key]) { RP.charts[key].destroy(); delete RP.charts[key]; }
}

function _lineChart(canvasId, key, labels, main, others, opts) {
  _destroy(key);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const ds = [];
  // Comparison events first so they render underneath the highlighted one.
  for (const o of others) {
    ds.push({ data: o.values, borderColor: RP_COLOR.other, borderWidth: 1,
              pointRadius: 0, tension: 0.25, spanGaps: true, fill: false,
              // _start is this event's OWN window start. The axis and the
              // tooltip title both speak in the SELECTED event's calendar, so
              // without this a grey line pointed at in month 1 was captioned
              // "Jan 1997" when the point it drew was Jan 2023. Reported by
              // MSF: "each curve should have a clearer year".
              label: o.label, _isOther: true, _start: o.start });
  }
  // The ordinary year, under the event but over the grey comparison band, so it
  // reads as a baseline rather than as one more event. Dashed and green so it
  // cannot be confused with either the grey events or the blue forecast.
  if (opts.neutral) {
    ds.push({ data: opts.neutral, borderColor: "#2E7D5B", borderWidth: 1.6,
              borderDash: [3, 3], pointRadius: 0, tension: 0.25, spanGaps: true,
              fill: false, label: "Neutral years (average)" });
  }

  ds.push({ data: main.values, borderColor: opts.color, borderWidth: 2.4,
            pointRadius: 0, tension: 0.25, spanGaps: true, fill: false,
            label: main.label });

  // Live forecast, only when it overlaps this window (i.e. the event is running).
  // Dashed so it can never be mistaken for something that has happened.
  for (const f of (opts.forecasts || [])) {
    for (const m of f.members) {
      ds.push({ data: m, borderColor: f.faint, borderWidth: 1,
                pointRadius: 0, tension: 0.25, spanGaps: true, fill: false,
                label: `${f.label} member`, _isOther: true, _isMember: true });
    }
    ds.push({ data: f.mean, borderColor: f.color, borderWidth: 2.2,
              borderDash: f.dash, pointRadius: 0, tension: 0.25, spanGaps: true,
              fill: false, label: `${f.label} (${f.vintage})` });
  }

  // Marks the month the maps above are showing. Without it the reader has to
  // count ticks to find November 1997 on a 48-month axis, which is exactly the
  // step where a misread happens.
  const monthMarker = {
    id: "rpMonthMarker",
    afterDatasetsDraw(chart) {
      const i = (typeof RPZ !== "undefined") ? RPZ.monthIdx : -1;
      if (i == null || i < 0 || i >= chart.data.labels.length) return;
      const x = chart.scales.x.getPixelForTick(i);
      if (!isFinite(x)) return;
      const { top, bottom } = chart.chartArea;
      const c = chart.ctx;
      c.save();
      c.strokeStyle = "rgba(11,33,56,0.55)";
      c.lineWidth = 1.2;
      c.setLineDash([4, 3]);
      c.beginPath(); c.moveTo(x, top); c.lineTo(x, bottom); c.stroke();
      c.setLineDash([]);
      // The value at that month, printed, because reading it off the axis is
      // the thing this marker exists to save.
      const ds = chart.data.datasets.find(d => !d._isOther && !/Neutral/.test(d.label || ""));
      const v = ds && ds.data[i];
      if (v != null && isFinite(v)) {
        // Name the month as well as the value. The marker exists so the reader
        // can go from a map of November 1997 to the number for November 1997
        // without counting ticks; printing only the number leaves half of that.
        // Value only. The month is named once, prominently, under the slider
        // that sets it; repeating "Jan 1997:" in all six panels tripled the
        // width of every box to restate something already on screen.
        const txt = `${Math.round(v * 10) / 10}${opts.unit || ""}`;
        c.font = "600 10px system-ui, sans-serif";
        const wd = c.measureText(txt).width + 8;
        const bx = Math.min(Math.max(x - wd / 2, chart.chartArea.left), chart.chartArea.right - wd);
        // ABOVE the plot, in the padding reserved for it, so it never covers data.
        const by = top - 15;
        c.fillStyle = "rgba(255,255,255,0.92)";
        c.fillRect(bx, by, wd, 13);
        c.strokeStyle = "rgba(11,33,56,0.25)"; c.lineWidth = 1;
        c.strokeRect(bx, by, wd, 13);
        c.fillStyle = "#0B2138";
        c.fillText(txt, bx + 4, by + 9.5);
      }
      c.restore();
    },
  };

  RP.charts[key] = new Chart(ctx, {
    type: "line",
    plugins: [monthMarker],
    data: { labels, datasets: ds },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      // Room above the plot for the month readout, which used to sit INSIDE the
      // plot and cover the first months of the series. Six panels each hiding
      // their own top-left corner is a lot of chart to lose to a label.
      layout: { padding: { top: 16 } },
      interaction: { mode: "index", intersect: false },
      // Name the grey line you are pointing at. A band of a dozen anonymous
      // greys answers "was this unusual" and refuses to answer "unusual
      // compared with WHICH year", which is the next question every time.
      // Only the nearest one is named: showing all twelve is the smear again.
      onHover: (evt, act, chart) => {
        const i = act && act.length ? act[0].index : null;
        let best = null, bestD = Infinity;
        if (i != null) {
          const y = evt.y;
          chart.data.datasets.forEach((d, k) => {
            if (!d._isOther || d._isMember) return;
            const v = d.data[i];
            if (v == null) return;
            const py = chart.scales.y.getPixelForValue(v);
            const dist = Math.abs(py - y);
            if (dist < bestD) { bestD = dist; best = k; }
          });
        }
        const next = bestD <= 26 ? best : null;
        if (chart._rpNear !== next) {
          chart._rpNear = next;
          chart.data.datasets.forEach((d, k) => {
            if (!d._isOther || d._isMember) return;
            d.borderColor = k === next ? "#5A6B7A" : RP_COLOR.other;
            d.borderWidth = k === next ? 2 : 1;
          });
          chart.update("none");
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          // Compact on purpose. At the default sizing this box covered a
          // quarter of a 200px-tall panel, so pointing at a line hid the very
          // curve you were reading. Smaller type, tighter padding, a slimmer
          // colour swatch and no outsized title.
          titleFont: { size: 10.5, weight: "600" },
          bodyFont: { size: 10.5 },
          padding: { top: 5, bottom: 5, left: 7, right: 7 },
          boxPadding: 3,
          boxWidth: 7,
          boxHeight: 7,
          usePointStyle: true,
          caretSize: 4,
          titleMarginBottom: 3,
          displayColors: true,
          // Chart.js passes (item, index, items, DATA) here, not the chart, so
          // reading _rpNear off the fourth argument always read undefined and
          // the nearest grey line was filtered out of its own tooltip: the line
          // highlighted under the cursor, and the box never named it. The chart
          // hangs off the item itself.
          filter: item =>
            !item.dataset._isOther
            || item.datasetIndex === (item.chart && item.chart._rpNear),
          callbacks: {
            // The tooltip names the real month and year of the SELECTED event,
            // which the axis cannot do without lying about the grey lines.
            title: items => {
              if (!items.length) return "";
              const l = labels[items[0].dataIndex];
              return (l && l._abs) || (Array.isArray(l) ? l.join(" ") : String(l));
            },
            label: item => {
              const v = item.parsed.y;
              if (v == null) return "";
              // Shorten the NAME only in the tooltip. The box is as wide as its
              // longest line, and "1997-98 El Nino (extreme): 21.2 days" made it
              // wide enough to cover the curve being pointed at. The legend
              // directly below still carries the full names, so nothing is lost:
              // the intensity is already stated there and in the event selector.
              const full = item.dataset.label || "";
              const short = /neutral/i.test(full) ? "Neutral"
                : full.replace(/\s*\((extreme|strong|moderate)\)\s*$/i, "")
                      .replace(/\s+El Ni.o|\s+La Ni.a/i, "");
              // A comparison line is aligned on ITS OWN year 0, so index i is a
              // different calendar month for it than for the selected event.
              // Say which month that is, or the reader reads the title's date
              // and attributes it to the wrong year.
              let own = "";
              const st = item.dataset._start;
              if (item.dataset._isOther && st) {
                const y0 = parseInt(String(st).slice(0, 4), 10);
                const m0 = parseInt(String(st).slice(5), 10) - 1;
                const k = m0 + item.dataIndex;
                own = ` \u00b7 ${RP_MON[k % 12]} ${y0 + Math.floor(k / 12)}`;
              }
              return `${short}${own}: ${v.toFixed(1)}${opts.unit || ""}`;
            },
          },
        },
      },
      scales: {
        x: { title: { display: !!opts.xTitle, text: opts.xTitle || "",
                      color: "#6B7B8A", font: { size: 10 } },
             ticks: { autoSkip: false, maxRotation: 0, minRotation: 0,
                      font: { size: 9 }, color: "#6B7B8A",
                      callback: function (v, i) {
                        const step = _tickStep(labels.length, this.width);
                        const l = labels[i];
                        const isJan = Array.isArray(l) && l[1];
                        return (isJan || i % step === 0) ? l : "";
                      } },
             grid: { display: false } },
        y: { title: { display: !!opts.yTitle, text: opts.yTitle || "",
                      color: "#6B7B8A", font: { size: 10 } },
             ticks: { font: { size: 10 } },
             grid: { color: "rgba(0,0,0,0.05)" },
             beginAtZero: !!opts.beginAtZero },
      },
    },
  });
}

// ── current forecast overlay ─────────────────────────────────────────────────
// Jacob and Aina asked to see the live forecast on these plots. For sea surface
// temperature it is nearly free: the 51-member Nino3.4 plume is already served
// for the front page, so this only has to re-index it onto the replay window.
//
// It is drawn ONLY where the forecast actually overlaps the window, which in
// practice means the event still running. On a past event a current forecast
// would be meaningless, so nothing is drawn rather than something decorative.
//
// The impact panels get no forecast: there is no calibrated forecast of country
// rainfall or heat behind this site, and inventing one from the SST forecast
// would be a different (and much larger) claim than the SST plume makes.
function _forecastForWindow(sel, nMonths, fc, meta) {
  if (!fc || !fc.vintages || !fc.vintages.length) return null;

  // The event itself must still be running. Gating on the WINDOW overlapping
  // the forecast was wrong and actively misleading: the replay window runs to
  // December of the end year, so the 2025-26 La Nina, which ended in January
  // 2026, had eleven trailing months that the forecast reached into. The page
  // therefore drew a 69-88% EXTREME EL NINO forecast across a finished LA NINA
  // panel, which reads as "this La Nina is forecast to reach +3.9 sigma".
  //
  // An event counts as running only if it has not ended before observations do.
  // A developing event that is not yet catalogued is carried by the synthetic
  // "current conditions" entry instead, which is where the forecast belongs.
  const lastObs = RP.nino && RP.nino.times && RP.nino.times[RP.nino.times.length - 1];
  const ongoing = sel.is_current === true
    || (sel.end && lastObs && sel.end.slice(0, 7) >= lastObs);
  if (!ongoing) return null;
  const vintage = fc.vintages[fc.vintages.length - 1];
  const members = fc.by_start && fc.by_start[vintage];
  if (!members) return null;

  const want = _monthsFrom(sel.window_start, nMonths);
  const pos = {};
  want.forEach((m, i) => { pos[m] = i; });

  const series = [];
  let overlap = 0;
  for (const mid of Object.keys(members)) {
    const arr = new Array(nMonths).fill(null);
    let hit = 0;
    for (const step of members[mid]) {
      const i = pos[step.valid_time];
      if (i !== undefined && step.nino34_std != null) { arr[i] = step.nino34_std; hit++; }
    }
    if (hit) { series.push(arr); overlap = Math.max(overlap, hit); }
  }
  if (!overlap) return null;                    // forecast is outside this window

  // Ensemble mean across members, month by month.
  const mean = new Array(nMonths).fill(null);
  for (let i = 0; i < nMonths; i++) {
    const vals = series.map(s => s[i]).filter(v => v != null);
    if (vals.length) mean[i] = vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  return { members: series, mean, vintage, n: series.length, months: overlap,
           label: meta.label, color: meta.color, faint: meta.faint, dash: meta.dash };
}

// Both centres, not just ECMWF.
//
// Drawing SEAS5 alone presented one model's plume as "the forecast". The site
// runs SEAS5 and Meteo-France System 9 side by side everywhere else, and where
// they disagree that disagreement IS the uncertainty a planner needs to see.
//
// Neither plume is blue any more. Blue is La Nina on every other panel of this
// site, so a blue plume climbing to +3 sigma on an El Nino chart read as a
// contradiction. Orange and purple belong to no phase.
// The same two colours the Forecast tab uses for these centres (CENTRE_COLOR in
// forecast_maps.js and app.js). One model must not be blue here and orange
// three tabs away. Blue does mean La Nina on the composite maps, so the plumes
// stay dashed and the caption names the centre, which is what disambiguates
// them: side by side, the reading is "which model", not "which phase".
const RP_FC_SOURCES = [
  { key: "forecast",     label: "ECMWF SEAS5",  color: "#1f77b4",
    faint: "rgba(31,119,180,0.13)", dash: [6, 3] },
  { key: "forecastMf9",  label: "Meteo-France System 9", color: "#d62728",
    faint: "rgba(214,39,40,0.13)", dash: [2, 3] },
];

function _forecastsForWindow(sel, nMonths) {
  return RP_FC_SOURCES
    .map(m => _forecastForWindow(sel, nMonths, RP[m.key], m))
    .filter(Boolean);
}

// ── data assembly ────────────────────────────────────────────────────────────
function _comparisonEvents(sel, mode) {
  if (mode === "none") return [];
  return RP.events.events.filter(e =>
    e.id !== sel.id &&
    e.phase !== "neutral" &&
    e.phase !== "current" &&
    (mode === "same_level" && !sel.is_current
      ? e.phase === sel.phase
      : _fam(e.phase) === _fam(sel.phase, sel)));
}

function _seriesFor(evt, nMonths, times, values) {
  return _sliceByMonths(times, values, _monthsFrom(evt.window_start, nMonths));
}

// Everything below the picker describes ONE event. With no event chosen there
// is nothing for it to describe, so it is hidden rather than left showing the
// last thing drawn or an empty frame.
function _setChosen(on) {
  const empty = document.getElementById("rp-empty");
  if (empty) empty.hidden = on;
  ["rp-mapwrap", "rp-zoom-head", "rp-zoom", "rp-legend", "rp-grid",
   "rp-meta", "rp-zoom-note", "rp-chartbar", "rp-impacts"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.hidden = !on;
  });
  if (!on) {                                  // region selection cannot outlive the event
    const b = document.getElementById("rp-region-banner");
    const r = document.getElementById("rp-regions");
    if (b) b.hidden = true;
    if (r) r.hidden = true;
  }
}

function render() {
  const evSel = document.getElementById("rp-event");
  const cmpSel = document.getElementById("rp-compare");
  const sel = RP.events.events.find(e => e.id === evSel.value);
  _setChosen(!!sel);
  if (!sel || !RP.country) return;

  // "Same type and intensity only" needs an intensity, and a developing event
  // does not have one: classification takes five months, so its level is "".
  // _comparisonEvents falls back to the family set for it, which is the right
  // thing to do with the data and the wrong thing to leave in the interface:
  // the option stayed selectable, showed a tick when chosen, and drew exactly
  // the same twelve grey lines as the option above it. Reported as the two
  // choices giving identical curves, which is what a control that does nothing
  // looks like. Disabled with the reason on it instead.
  const lvlOpt = cmpSel.querySelector('option[value="same_level"]');
  if (lvlOpt) {
    lvlOpt.disabled = !!sel.is_current;
    lvlOpt.textContent = sel.is_current
      ? "Same type and intensity only (not classified yet)"
      : "Same type and intensity only";
    if (sel.is_current && cmpSel.value === "same_level") cmpSel.value = "same_family";
  }
  const cmpMode = cmpSel.value;

  const nMonths = sel.window_months;
  const labels = _monthLabels(sel.window_start, nMonths);
  const xTitle = _xAxisTitle(sel);
  const others = _comparisonEvents(sel, cmpMode);
  const colour = RP_COLOR[_fam(sel.phase, sel)];

  // Nino3.4 comes from the index file, not the country file: it is the same
  // everywhere and is what the event was classified from.
  const nt = RP.nino.times, nv = RP.nino.nino34_std;
  _lineChart("rp-chart-nino", "nino", labels,
    { label: sel.label, values: _seriesFor(sel, nMonths, nt, nv) },
    others.map(o => ({ label: o.label, start: o.window_start,
                       values: _seriesFor(o, nMonths, nt, nv) })),
    { color: colour, unit: " σ", yTitle: "Niño 3.4 (σ)", xTitle,
      forecasts: _forecastsForWindow(sel, nMonths) });

  // A selected sub-national region replaces the country's series wholesale, in
  // the same units against the same normal-year reference, so the panels below
  // mean exactly what they meant before the click. Resolved by the click
  // handler before render() runs, because render() is synchronous.
  const reg = RPRG.selected;
  const ct = (reg && reg.times) || RP.country.times;
  const cs = (reg && reg.series) || RP.country.series;
  // One chart per map layer, so anything you can put on a map you can also
  // read as a number over time. Two per row from 700px.
  const panels = [
    ["rp-chart-rain",  "rain",  "pr_total_mm",  " mm",   "mm / month", true],
    ["rp-chart-rx10",  "rx10",  "rx10day_mm",   " mm",   "mm / 10 days", true],
    ["rp-chart-cdd",   "cdd",   "cdd_days",     " days", "days",       true],
    ["rp-chart-dry",   "dry",   "dry_days",     " days", "days",       true],
    ["rp-chart-tmax",  "tmax",  "tmax_c",       " °C",   "°C",         false],
    ["rp-chart-heat",  "heat",  RP.thr.heat,    " days", "days",       true],
    ["rp-chart-night", "night", RP.thr.night,   " days", "days",       true],
  ];
  for (const [cid, key, series, unit, yTitle, zero] of panels) {
    const vals = cs[series];
    if (!vals) { _destroy(key); continue; }
    _lineChart(cid, key, labels,
      { label: sel.label, values: _seriesFor(sel, nMonths, ct, vals) },
      others.map(o => ({ label: o.label, start: o.window_start,
                         values: _seriesFor(o, nMonths, ct, vals) })),
      { color: colour, unit, yTitle, xTitle, beginAtZero: zero,
        neutral: _neutralFor(sel, nMonths, series) });
  }
  _renderThresholdUI();
  _renderLegend(sel, others.length, _forecastsForWindow(sel, nMonths));
  _renderMeta(sel, others.length);
  _renderImpacts(sel, nMonths);
}

// ── x axis: real months, on two lines, never rotated ─────────────────────────
// Bare month numbers ("0" to "47") told the reader nothing. The axis now names
// the month, with the relative year underneath each January.
//
// Two lines rather than a rotated single line, deliberately. A rotated tick
// label is anchored at its own centre, so the further it rotates the further it
// slides from the tick it belongs to, and on a 48-month axis the labels end up
// visibly offset from their gridlines. Stacking month over year keeps every
// label centred on its own tick and needs no rotation at all.
//
// The year label is the SELECTED EVENT'S OWN, e.g. 1997 then 1998.
//
// It used to be relative, "y0" and "y1", on the reasoning that the grey
// comparison lines are different events from different decades sharing one
// axis, so no single absolute year is true for all of them. That reasoning is
// still correct and the labelling was still wrong, because of who reads it: a
// reader follows the COLOURED line, which is one event in known years, and the
// grey band is context behind it. Asked for the rainfall of 1997, they were
// shown an axis running "Jan y0" with the years only in the caption below.
//
// So the ticks now name the selected event's years, which are true for the line
// being read, and the caption carries the alignment rule for the grey ones. The
// tooltip already gave the absolute month, so the two now agree instead of the
// axis saying y0 while the hover said 1997.
const RP_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function _monthLabels(windowStart, n) {
  const y0 = parseInt(String(windowStart).slice(0, 4), 10);
  const m0 = parseInt(String(windowStart).slice(5), 10) - 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = m0 + i, m = k % 12, dy = Math.floor(k / 12);
    // Year under January, and under the first tick when the window opens
    // mid-year, so no stretch of the axis is left unlabelled.
    out.push([RP_MON[m], (m === 0 || i === 0) ? String(y0 + dy) : ""]);
    out[out.length - 1]._abs = `${RP_MON[m]} ${y0 + dy}`;   // tooltips want the real date
  }
  return out;
}

function _xAxisTitle(sel) {
  const y0 = parseInt(String(sel.window_start).slice(0, 4), 10);
  const y1 = parseInt(String(sel.window_end).slice(0, 4), 10);
  const span = y1 > y0 ? `${y0} to ${y1}` : `${y0}`;
  // Says whose years those are, because the grey lines do NOT share them.
  return sel.is_current
    ? `Dates are this event, ${span}; grey lines are past events aligned on their own first year`
    : `Dates are this event, ${span}; grey lines are other events aligned on their own first year`;
}

// Which ticks to draw, from the PIXELS AVAILABLE, not the month count. Keying
// it off the count alone was right at full width and wrong the moment the
// panels went two-to-a-row: 24 months in 340px is 14px a label for text that
// needs about 20, so the axis ran together into "JaFeMaAp".
// January always survives the thinning, or the year markers disappear with it.
function _tickStep(n, pxWide) {
  const per = (pxWide || 700) / Math.max(n, 1);
  return Math.max(1, Math.ceil(20 / per));
}

// ── the ordinary year ────────────────────────────────────────────────────────
// Aina asked for "the neutral average". Comparing an El Nino only against other
// El Ninos answers "was this one worse than the last one"; it cannot answer "was
// this worse than a normal year", which is the question that decides whether to
// pre-position anything.
//
// The reference is twelve numbers per indicator, one per calendar month,
// averaged over the catalogued NEUTRAL years only, which is also what the
// anomaly series are measured against. A conventional 30-year normal has El
// Ninos and La Ninas inside it, so an event measured against one is partly
// measured against itself. See _enso_baseline.py.
//
// Windows start in January by construction, but the offset is computed from
// window_start anyway rather than assumed.
function _neutralFor(sel, nMonths, key) {
  const ref = RP.country.neutral && RP.country.neutral[key];
  if (!ref || ref.every(v => v == null)) return null;
  const m0 = parseInt(String(sel.window_start).slice(5), 10) - 1;   // 0 = January
  const out = [];
  for (let i = 0; i < nMonths; i++) out.push(ref[(m0 + i) % 12]);
  return out;
}

// ── threshold selector ───────────────────────────────────────────────────────
// A threshold with no days anywhere in the record is greyed rather than hidden:
// "Kenya never reaches UTCI 46" is information, and hiding the button would
// make it look like the site simply does not carry the layer.
// BANDS, not cut-offs. These read "at least ... and above" until 2026-08-25,
// which contradicted the buttons above them the moment the counts became
// disjoint: the button said 32-38 while the sentence under it said 32 and
// above. A caption that disagrees with its own control is worse than no
// caption. Each band is now stated as the interval it actually counts, and
// says what the next band up is so the reader knows where the rest went.
const RP_THR_TEXT = {
  utci_strong_days:  "Days in the strong heat-stress band, UTCI 32 to 38 °C. Hotter days are "
                   + "counted in the bands above, not here, so the three add up.",
  utci_vstrong_days: "Days in the very strong heat-stress band, UTCI 38 to 46 °C, where outdoor "
                   + "work becomes hazardous. Days above 46 °C are counted separately.",
  utci_extreme_days: "Days at UTCI 46 °C and above, the top of the scale and the only open-ended "
                   + "band.",
  night_tropical:    "Nights with a minimum of 20 to 25 °C. Hotter nights are counted in the "
                   + "bands above.",
  night_equatorial:  "Nights with a minimum of 25 to 30 °C, when the body gets no overnight "
                   + "recovery. Nights above 30 °C are counted separately.",
  night_torrid:      "Nights at 30 °C and above, the rarest and most dangerous category, and the "
                   + "only open-ended night band. Confined to a small part of the land surface; "
                   + "over that area an El Niño still shifts it by about three nights in June "
                   + "to August.",
};

function _renderThresholdUI() {
  const cs = RP.country ? RP.country.series : {};
  for (const b of document.querySelectorAll(".rp-thr button[data-panel][data-key]")) {
    const on = RP.thr[b.dataset.panel] === b.dataset.key;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
    // "Never reached here" and "we did not compute it" are different facts and
    // must not share a message: the first is a finding about the country, the
    // second is a gap in the data.
    const st = _thrState(cs, b.dataset.key);
    b.classList.toggle("empty", st !== "ok" && !on);
    b.dataset.state = st;
    b.title = st === "never" ? "never reached in this country over 1981-2025"
            : st === "rare" ? "reached in under a day per month, even at its worst"
            : st === "absent" ? "not available in the data currently served" : "";
  }
  for (const p of ["heat", "night"]) {
    const el = document.getElementById(`rp-sub-${p}`);
    if (!el) continue;
    const key = RP.thr[p];
    const st = _thrState(cs, key);
    let extra = "";
    if (st === "never") {
      extra = `  ${RP.country.label} never reaches this threshold anywhere in the 1981-2025 record.`;
    } else if (st === "rare") {
      const vv = (cs[key] || []).filter(x => x != null);
      const mx = vv.length ? Math.max(...vv) : 0;
      const n = vv.filter(x => x > 0).length;
      extra = `  ${RP.country.label} barely reaches this threshold: ${n} month`
            + `${n === 1 ? "" : "s"} out of ${vv.length} in the whole record, peaking at `
            + `${mx.toFixed(1)} days averaged over the country.`;
    } else if (st === "absent") {
      extra = "  This threshold is not in the data currently served.";
    }
    el.textContent = (RP_THR_TEXT[key] || "") + extra;
  }
}

function _thrState(cs, key) {
  const v = cs[key];
  if (!v) return "absent";
  const vals = v.filter(x => x != null);
  if (!vals.length || vals.every(x => x === 0)) return "never";
  // A third state, because the binary was misleading. Kenya reaches UTCI 46 in
  // two months out of 504, at a tenth of a day each: not "never", but a panel
  // that is flat zero except for two invisible blips reads as broken unless the
  // page says what it is showing.
  return Math.max(...vals) < 1 ? "rare" : "ok";
}

// Which map variables belong to the same family as a chart threshold, so the
// map can follow. Without this the chart can read "extreme heat stress" while
// the map underneath still shows "strong", and nothing on screen says they are
// different thresholds of the same thing.
const RP_THR_FAMILY = {
  heat:  ["utci_strong_days", "utci_vstrong_days", "utci_extreme_days"],
  night: ["night_tropical", "night_equatorial", "night_torrid"],
};

// ── Enlarge one panel ────────────────────────────────────────────────────────
// Eight panels fit on a screen at a size you can COMPARE but not read closely.
// Asked for by MSF in August 2026, alongside the blank-default fix.
//
// The big copy is built from the small chart's own config object rather than
// from the data a second time, so the two can never drift apart: whatever the
// panel is showing, including a selected sub-national region and the chosen
// threshold, is what the modal shows.
let _rpModalChart = null;

function _closeEnlarged() {
  if (_rpModalChart) { _rpModalChart.destroy(); _rpModalChart = null; }
  _restoreImpacts();                        // the figure is live nodes, not a copy
  const m = document.getElementById("rp-modal");
  if (m) m.hidden = true;
}

function _enlargePanel(panel) {
  const cv = panel.querySelector("canvas");
  const src = cv && window.Chart && Chart.getChart(cv);
  if (!src) return;
  const modal = document.getElementById("rp-modal");
  const target = document.getElementById("rp-modal-canvas");
  if (!modal || !target) return;

  const h3 = panel.querySelector("h3");
  const sub = panel.querySelector(".rp-sub");
  // textContent, not innerHTML: the threshold selector lives inside the h3 and
  // copying its markup would put dead buttons in the dialog.
  document.getElementById("rp-modal-title").textContent =
    h3 ? h3.childNodes[0].textContent.trim() : "";
  document.getElementById("rp-modal-sub").textContent = sub ? sub.textContent.trim() : "";

  if (_rpModalChart) _rpModalChart.destroy();
  modal.hidden = false;                     // must be visible before Chart measures it
  _rpModalChart = new Chart(target.getContext("2d"), {
    type: src.config.type,
    data: src.config.data,
    options: Object.assign({}, src.config.options, {
      maintainAspectRatio: false,
      animation: false,
    }),
  });
  document.getElementById("rp-modal-close").focus();
}

// The eight chart panels open in the same dialog. This one is DOM and SVG
// rather than a canvas, so it cannot go through _enlargePanel: it re-renders
// into the dialog at the larger size, which gives the lanes and the curve real
// room instead of scaling a small figure up.
function _enlargeImpacts() {
  const modal = document.getElementById("rp-modal");
  const host = document.getElementById("rp-modal-fig");
  const card = document.getElementById("rp-impacts");
  if (!modal || !host || !card) return;

  document.getElementById("rp-modal-title").textContent =
    (card.querySelector("h3") || {}).textContent || "Reported disasters and outbreaks";
  document.getElementById("rp-modal-sub").textContent =
    (document.getElementById("rp-imp-sub") || {}).textContent || "";

  const wrap = document.getElementById("rp-modal-wrap");
  if (wrap) wrap.hidden = true;             // the canvas slot is for the charts
  host.hidden = false;
  modal.hidden = false;

  // Move the live nodes across, re-render at the dialog width, then put them
  // back on close. One set of nodes means the dialog can never drift from the
  // card behind it.
  host.appendChild(document.getElementById("rp-imp-legend"));
  host.appendChild(card.querySelector(".rp-imp-fig"));
  host.appendChild(document.getElementById("rp-imp-list"));
  host.appendChild(document.getElementById("rp-imp-foot"));
  RPIMP.big = true;
  render();                                 // same path the theme buttons use
  document.getElementById("rp-modal-close").focus();
}

function _restoreImpacts() {
  const host = document.getElementById("rp-modal-fig");
  const card = document.getElementById("rp-impacts");
  if (!host || !card || host.hidden) return;
  const fig = host.querySelector(".rp-imp-fig");
  if (fig) {
    card.appendChild(document.getElementById("rp-imp-legend"));
    card.appendChild(fig);
    card.appendChild(document.getElementById("rp-imp-list"));
    card.appendChild(document.getElementById("rp-imp-foot"));
  }
  host.hidden = true;
  const wrap = document.getElementById("rp-modal-wrap");
  if (wrap) wrap.hidden = false;
  RPIMP.big = false;
  render();
}

function _wireEnlarge() {
  document.querySelectorAll(".rp-panel").forEach(panel => {
    if (!panel.querySelector("canvas") || panel.querySelector(".rp-zoombtn")) return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rp-zoombtn";
    b.textContent = "Enlarge";
    b.setAttribute("aria-label", "Enlarge this chart");
    b.addEventListener("click", () => _enlargePanel(panel));
    const wrap = panel.querySelector(".rp-canvas-wrap");
    if (wrap) wrap.appendChild(b);
  });
  const impCard = document.getElementById("rp-impacts");
  if (impCard && !impCard.querySelector(".rp-zoombtn")) {
    const ib = document.createElement("button");
    ib.type = "button";
    ib.className = "rp-zoombtn rp-imp-zoom";
    ib.textContent = "Enlarge";
    ib.setAttribute("aria-label", "Enlarge the recorded impacts figure");
    ib.addEventListener("click", _enlargeImpacts);
    const head = impCard.querySelector(".rp-imp-head");
    if (head) head.appendChild(ib);
  }

  const modal = document.getElementById("rp-modal");
  const close = document.getElementById("rp-modal-close");
  if (close) close.addEventListener("click", _closeEnlarged);
  // Click the backdrop, not the box, to dismiss.
  if (modal) modal.addEventListener("click", e => {
    if (e.target === modal) _closeEnlarged();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") _closeEnlarged();
  });
}


// ── Recorded impacts ─────────────────────────────────────────────────────────
// EM-DAT events on the SAME month axis as the charts, so a marker sits under
// the climate anomaly that preceded it. Anyamba et al. 2019 is the method and
// it is explicit that this shows TIMING, never magnitude: reporting quality
// varies by country and improved over time, so sizing by casualties would
// rank countries by how well they report rather than by what happened.
const RPIMP = { data: null, theme: "water", sel: null, big: false, band: null };

async function _loadImpacts(countryId) {
  RPIMP.data = null;
  try {
    RPIMP.data = await _getJSON(`data/replay/impacts/${countryId}.json`);
  } catch {
    RPIMP.data = null;            // no file for this country is a normal state
  }
}

function _impMonthIndex(ym, start, n) {
  const [y0, m0] = start.split("-").map(Number);
  const [y, m] = ym.split("-").map(Number);
  const k = (y - y0) * 12 + (m - m0);
  return (k >= 0 && k < n) ? k : -1;
}

// Anyamba et al. 2019 reads outbreaks as discrete events in time, not as
// magnitudes: what matters is which disease, and when it started relative to
// the anomaly. So each event is a dot at its onset month, coloured by what it
// actually was, with its duration trailing behind as a thin line rather than a
// heavy bar that swamps the axis. One colour per hazard and per named disease,
// stable across countries so the legend means the same thing everywhere.
const RP_IMP_COLOUR = {
  // water
  "Flood": "#2E74B5", "Drought": "#B5822E",
  // heat. EM-DAT's subtype is the label now, so "Heat wave" is what arrives;
  // the bare type is kept for any older build still carrying it.
  "Heat wave": "#C2603F", "Extreme temperature": "#C2603F",
  // disease, named
  "cholera": "#1B8A8F", "meningitis": "#E08A2E", "yellow fever": "#C9A227",
  "dengue": "#C0392B", "ebola": "#5B2C6F", "lassa fever": "#8A5A2B",
  "hepatitis": "#4B8B3B", "rift valley fever": "#B03A82",
  "leishmaniasis": "#7A8B2B", "marburg": "#7B241C", "plague": "#3B3B3B",
  "chikungunya": "#D4649B",
  // EM-DAT records 95 disease events with no pathogen named at all
  "Epidemic": "#8A97A3",
};

function _impColour(label) {
  return RP_IMP_COLOUR[label] || RP_IMP_COLOUR[String(label || "").toLowerCase()] || "#8A97A3";
}

function _impLabel(e) {
  return e.disease || e.type;
}

// The NASA SVS pieces (SVS 4765, and the RVF and dengue timeplots) stack the
// driver and the outcome on ONE time axis: SST, then precipitation, then the
// outbreaks. That stacking is the whole reason the lag is readable, and it is
// what our layout was missing: impacts lined up with Nino 3.4, but the country
// rainfall sat in a half-width panel further down with its own axis.
//
// So the card carries a compact rainfall-anomaly row on exactly the geometry
// the markers use. Drawn as one SVG path against px(), not a second charting
// instance, because a second instance brings its own margins and the alignment
// is the entire point. Site colours, not NASA's: wet is the blue this site
// already uses for rainfall above normal, dry the brown it uses for below.
function _impDrawRain(sel, nMonths, px, trackW) {
  const svg = document.getElementById("rp-imp-rain");
  const wrap = document.getElementById("rp-imp-drivers");
  if (!svg || !wrap) return;
  // The driver has to match the theme. Showing rainfall under "Extreme heat"
  // invited the reader to read a heat wave off a rain curve. Disease keeps
  // rainfall: Anyamba et al. 2019 ties cholera and Rift Valley fever to
  // rainfall, not to temperature.
  //
  // Heat uses UTCI rather than tmax because the cross-check said so. Of the
  // two heat waves EM-DAT records in these countries, Sudan 2015-08 shows in
  // both, but Nigeria 2002-06 in Borno sits at the 90th percentile for UTCI
  // days and the 51st for tmax: humid heat stress the daily maximum misses.
  // The three UTCI bands are disjoint, so summing them gives days at or above
  // 32 degrees, and subtracting the neutral-year climatology for that calendar
  // month keeps the same diverging shape the rainfall row has.
  const DRIVER = {
    water:   {keys: ["pr_anom_mm"], name: "Rainfall vs normal", unit: "mm", dp: 0,
              hi: "#2E74B5", lo: "#A9713A"},
    disease: {keys: ["pr_anom_mm"], name: "Rainfall vs normal", unit: "mm", dp: 0,
              hi: "#2E74B5", lo: "#A9713A"},
    heat:    {keys: ["utci_strong_days", "utci_vstrong_days", "utci_extreme_days"],
              vsNeutral: true, unit: "days", dp: 1,
              name: "Days above UTCI 32 \u00B0C, vs a neutral year",
              hi: "#C0392B", lo: "#4A7FB5"},
  };
  const drv = DRIVER[RPIMP.theme] || DRIVER.water;
  const S = RP.country && RP.country.series;
  if (!S || !RP.country.times || drv.keys.some(k => !S[k])) { wrap.hidden = true; return; }

  const want = _monthsFrom(sel.window_start, nMonths);
  const parts = drv.keys.map(k => _sliceByMonths(RP.country.times, S[k], want));
  const base = drv.vsNeutral ? drv.keys.map(k => (RP.country.neutral || {})[k]) : null;
  if (base && base.some(b => !b || b.length !== 12)) { wrap.hidden = true; return; }

  const v = want.map((ym, i) => {
    let tot = 0;
    for (const col of parts) {
      if (col[i] == null) return null;      // a missing band is a missing month
      tot += +col[i];
    }
    if (base) {
      const mi = parseInt(ym.slice(5), 10) - 1;
      for (const b of base) {
        if (b[mi] == null) return null;
        tot -= +b[mi];
      }
    }
    return tot;
  });
  if (!v.some(x => x != null)) { wrap.hidden = true; return; }
  wrap.hidden = false;

  const H = RPIMP.big ? 210 : 96, mid = H / 2;
  const amp = Math.max(...v.map(x => Math.abs(x || 0)), 1);
  const y = x => mid - (x / amp) * (mid - 3);
  const xs = i => (px(i) != null ? px(i) : (i + 0.5) * (trackW / nMonths));

  // One path per sign, so above and below normal read as different things
  // without needing a legend entry.
  // Close on the last month that HAS a value, not the last month of the window.
  // Closing on the window end drew a flat sliver along zero across every month
  // with no observation yet, which reads as "the anomaly was zero" when it
  // means "we do not know". current_conditions has 4 of 24 months.
  const first = v.findIndex(x => x != null);
  let last = -1;
  for (let i = 0; i < v.length; i++) if (v[i] != null) last = i;
  const seg = sign => {
    if (first < 0) return "";
    let d = "";
    for (let i = first; i <= last; i++) {
      if (v[i] == null) continue;
      const val = sign > 0 ? Math.max(0, v[i]) : Math.min(0, v[i]);
      d += (d ? "L" : "M") + xs(i).toFixed(1) + " " + y(val).toFixed(1) + " ";
    }
    if (!d) return "";
    return d + "L" + xs(last).toFixed(1) + " " + mid + " L" + xs(first).toFixed(1) + " " + mid + " Z";
  };

  svg.setAttribute("viewBox", `0 0 ${Math.max(trackW, 1)} ${H}`);
  svg.setAttribute("height", H);
  svg.innerHTML =
      `<defs>`
    + `<linearGradient id="rpWet" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0" stop-color="${drv.hi}" stop-opacity=".52"/>`
    + `<stop offset="1" stop-color="${drv.hi}" stop-opacity=".10"/></linearGradient>`
    + `<linearGradient id="rpDry" x1="0" y1="1" x2="0" y2="0">`
    + `<stop offset="0" stop-color="${drv.lo}" stop-opacity=".52"/>`
    + `<stop offset="1" stop-color="${drv.lo}" stop-opacity=".10"/></linearGradient>`
    + `</defs>`
    + `<path d="${seg(1)}" fill="url(#rpWet)"/>`
    + `<path d="${seg(-1)}" fill="url(#rpDry)"/>`
    + `<line x1="${first < 0 ? 0 : xs(first).toFixed(1)}" y1="${mid}" `
    + `x2="${first < 0 ? trackW : xs(last).toFixed(1)}" y2="${mid}" stroke="#C9D3DB" stroke-width="1"/>`;
  const peak = Math.max(...v.map(x => (x == null ? -Infinity : x)));
  const gap = v.length - v.filter(x => x != null).length;
  document.getElementById("rp-imp-dlab").textContent =
    `${drv.name}, ${RP.country.label || "this country"} `
    + `(peak ${peak > 0 ? "+" : ""}${peak.toFixed(drv.dp)} ${drv.unit}`
    + (gap ? `, observed record ends ${RP.country.times[RP.country.times.length - 1]}` : "")
    + ")";
}

// The months this event was actually classified as active, shaded across the
// rows the way NASA labels an "El Nino period". Taken from the event's own
// start and end, never inferred from the shape of a curve.
function _impDrawBand(sel, nMonths, px, trackW) {
  // Clear first, always. The early returns below used to leave the previous
  // event's tag and caption on screen: picking "current conditions", which has
  // no end date, kept the 2014-16 shading and its sentence from whatever was
  // selected before, naming an event the reader was no longer looking at.
  RPIMP.band = null;

  const ev = RP.events && RP.events.events.find(e => e.id === document.getElementById("rp-event").value);
  if (!ev || !ev.start || !ev.end) return;
  const ym = d => String(d).slice(0, 7);
  const a = _impClampIndex(ym(ev.start), sel.window_start, nMonths);
  const b = _impClampIndex(ym(ev.end), sel.window_start, nMonths);
  if (b <= a) return;
  const slot = trackW / nMonths;
  const xa = (px(a) != null ? px(a) : (a + 0.5) * slot) - slot / 2;
  const xb = (px(b) != null ? px(b) : (b + 0.5) * slot) + slot / 2;
  const L = Math.max(0, xa), R = Math.min(trackW, xb);
  const rules = document.getElementById("rp-imp-rules");
  if (rules) {
    const band = document.createElement("div");
    band.className = "rp-imp-band";
    band.style.left = (100 * L / trackW) + "%";
    band.style.width = (100 * (R - L) / trackW) + "%";
    rules.insertBefore(band, rules.firstChild);
  }
  // No label inside the figure: the legend above now names the event in full,
  // and a tag in here had nowhere to sit that was not on the axis or the
  // driver's own label.
  RPIMP.band = `${ev.label} active ${ym(ev.start)} to ${ym(ev.end)}`;
}

// Like _impMonthIndex but pinned to the window instead of rejecting: used for
// an event's end, which may legitimately fall outside the replayed window.
function _impClampIndex(ym, start, n) {
  const [y0, m0] = start.split("-").map(Number);
  const [y, m] = ym.split("-").map(Number);
  return Math.max(0, Math.min(n - 1, (y - y0) * 12 + (m - m0)));
}

// EM-DAT hazard types arrive capitalised ("Flood") but disease names do not
// ("cholera"), so the two would sit in one list in two different cases. Only
// names with an internal capital need an entry here; the rest are first-letter.
const RP_DISEASE_CASE = {"rift valley fever": "Rift Valley fever"};

function _impTitle(s) {
  const t = String(s == null ? "" : s).trim();
  const fixed = RP_DISEASE_CASE[t.toLowerCase()];
  if (fixed) return fixed;
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

function _renderImpacts(sel, nMonths) {
  const box = document.getElementById("rp-impacts");
  if (!box) return;
  const d = RPIMP.data;
  if (!d || !sel) { box.hidden = true; return; }
  box.hidden = false;

  const inWindow = d.events.filter(e => e.theme === RPIMP.theme &&
                                        _impMonthIndex(e.start, sel.window_start, nMonths) >= 0);
  const track = document.getElementById("rp-imp-track");
  const list = document.getElementById("rp-imp-list");
  track.innerHTML = ""; list.innerHTML = "";

  // ALIGN BY ASKING THE CHART, not by arithmetic on the card.
  //
  // The first version spanned the full card while the charts sit in a
  // two-column grid, each with its own y-axis: the rainfall plot area started
  // 610 px right of the track, so a marker sat nowhere near the month above
  // it. Alignment is the entire reason this strip exists, so an unaligned
  // strip is not cosmetic, it is a false claim.
  //
  // The second version tried to reproduce the plot area with margins and
  // collapsed the track to zero width. So this asks Chart.js where month i
  // actually is, via the same x scale the panel above draws with. It cannot
  // drift, because it is not a copy of the geometry, it IS the geometry.
  //
  // The Nino panel is the reference: it is the one full-width chart, and this
  // strip is .rp-wide directly beneath it.
  const ref = Chart.getChart(document.getElementById("rp-chart-nino"));
  // getPixelForValue is in the Nino canvas's own coordinates, but the markers
  // are positioned inside the figure, whose 1px border insets the track. That
  // put every dot a pixel right of the month it names: small, systematic, and
  // exactly the kind of drift that returns whenever the padding changes. The
  // offset between the two boxes is measured rather than assumed.
  const trackBox = track.getBoundingClientRect();
  const px = i => {
    if (!ref || !ref.scales || !ref.scales.x) return null;
    const cv = ref.canvas.getBoundingClientRect();
    const s = ref.width ? cv.width / ref.width : 1;
    return cv.left + ref.scales.x.getPixelForValue(i) * s - trackBox.left;
  };
  const trackW = trackBox.width || 1;

  const label = {water: "floods and droughts", heat: "extreme heat", disease: "disease outbreaks"};
  document.getElementById("rp-imp-sub").textContent =
    `Events recorded by EM-DAT in ${RP.country.label || "this country"} during this window, `
    + `positioned by the month they began. Markers show that something was recorded and when, `
    + `not how large it was.`;

  if (!inWindow.length) {
    // "No extreme heat recorded" reads as "no extreme heat happened", which is
    // the false impression Jake flagged on 2026-08-27 after finding the theme
    // empty across all ten countries for three different El Ninos.
    //
    // It is not that EM-DAT ignores heat. The same export holds 324 heat waves
    // across 73 countries, but 26 of them are India, 20 the USA, 17 Japan, and
    // two are in the ten countries here. That is a reporting gradient, not a
    // climate one, and saying so is more useful than a blank line. Heat is also
    // the one hazard on this site that does not depend on anyone filing a
    // report: the panels below measure it from ERA5.
    // Counted by the builder, not written here, so the sentence stays true
    // after the next EM-DAT export instead of drifting from the data it cites.
    const hc = d.heat_context;
    const heatWhy = hc && hc.top && hc.top.length
      ? `EM-DAT records no heat wave here. Across the whole database it holds `
        + `${hc.total} of them, but in only ${hc.countries_with_any} of the `
        + `${hc.countries_total} countries on this site, and `
        + hc.top.map(t => `${_impTitle(t.country.replace(/_/g, " "))} accounts for ${t.n}`)
              .join(", ") + ". "
        + "Read a blank panel as a gap in reporting rather than an absence of "
        + "dangerous heat. The heat panels below are measured from ERA5 and do "
        + "not depend on an event being reported at all."
      : "EM-DAT records no heat wave here. Read that as a gap in reporting "
        + "rather than an absence of dangerous heat: the heat panels below are "
        + "measured from ERA5 and do not depend on a report being filed.";
    const why = {
      heat: heatWhy,
      water: "No flood or drought was recorded here in this window. EM-DAT "
           + "holds only what was reported and met its threshold, so this may "
           + "be a quiet window or a poorly reported one.",
      disease: "No outbreak was recorded here in this window. EM-DAT holds "
             + "only what was reported and met its threshold, so this may be a "
             + "quiet window or a poorly reported one.",
    };
    list.innerHTML = `<li><span class="rp-imp-empty">`
                   + `${_impEsc(why[RPIMP.theme] || `No ${label[RPIMP.theme]} recorded here in this window.`)}`
                   + `</span></li>`;
  }

  const unplaced = inWindow.filter(e => !e.regions.length).length;

  // Geometry first, DOM second: overlapping events have to be packed into
  // separate lanes, and that cannot be decided until every bar's extent is
  // known. Drawn in one row they sit on top of each other, and a long event
  // hides every short one inside it, which is exactly the timing information
  // this strip exists to show.
  const DOT = 12;                          // must match .rp-imp-ev::before in the CSS
  const geo = inWindow.map(e => {
    const i0 = _impMonthIndex(e.start, sel.window_start, nMonths);
    const iEnd = e.end ? _impClampIndex(e.end, sel.window_start, nMonths) : null;
    const i1 = (iEnd != null && iEnd > i0) ? iEnd : i0;
    // An event running past the window edge is drawn to the edge and says so,
    // rather than being silently shortened to its last in-window month.
    const overruns = !!(e.end && _impMonthIndex(e.end, sel.window_start, nMonths) < 0
                        && iEnd === nMonths - 1);
    const slot = trackW / nMonths;
    const xa = px(i0) != null ? px(i0) : (i0 + 0.5) * slot;
    const xb = px(i1) != null ? px(i1) : (i1 + 0.5) * slot;
    // The dot sits ON the onset month. The tail runs to the end month, and is
    // zero-length for a single-month event, which then reads as just a dot.
    const tail = Math.max(0, Math.min(xb, trackW) - xa);
    return {e, x: Math.max(DOT / 2, Math.min(xa, trackW - DOT / 2)), tail, overruns,
            left: xa - DOT / 2, width: Math.max(tail + DOT, DOT)};
  });

  // First lane whose last marker ends before this one starts. LANE_GAP keeps
  // two close events visibly separate rather than reading as one.
  const LANE_GAP = 4, LANE_STEP = RPIMP.big ? 26 : 19;
  const laneEnds = [];
  for (const g of geo) {
    let ln = laneEnds.findIndex(end => g.left >= end + LANE_GAP);
    if (ln < 0) { ln = laneEnds.length; laneEnds.push(0); }
    laneEnds[ln] = g.left + g.width;
    g.lane = ln;
  }
  const nLanes = Math.max(laneEnds.length, 1);
  track.style.height = Math.max(nLanes * LANE_STEP + 14, RPIMP.big ? 74 : 42) + "px";

  // Month rules inside the track and a labelled axis under it. Without these a
  // dot floats in an empty strip and the reader has to trace up to the Nino
  // panel to find out which month it is in, which is exactly the work this
  // layer is supposed to remove.
  const axis = document.getElementById("rp-imp-axis");
  if (axis) axis.innerHTML = "";
  const rules = document.getElementById("rp-imp-rules");
  if (rules) rules.innerHTML = "";
  const [wy, wm] = sel.window_start.split("-").map(Number);
  const every = nMonths > 30 ? 3 : (nMonths > 18 ? 2 : 1);
  for (let i = 0; i < nMonths; i++) {
    const mi = (wm - 1 + i) % 12, yr = wy + Math.floor((wm - 1 + i) / 12);
    const cx = px(i) != null ? px(i) : (i + 0.5) * (trackW / nMonths);
    const rule = document.createElement("div");
    rule.className = "rp-imp-grid" + (mi === 0 ? " year" : "");
    rule.style.left = (100 * cx / trackW) + "%";
    if (rules) rules.appendChild(rule);
    if (axis && (i % every === 0 || mi === 0)) {
      const t = document.createElement("span");
      t.className = "rp-imp-tick" + (mi === 0 ? " year" : "");
      t.style.left = (100 * cx / trackW) + "%";
      t.innerHTML = mi === 0
        ? `${RP_MON[mi]}<b>${yr}</b>`
        : RP_MON[mi];
      axis.appendChild(t);
    }
  }

  _impDrawRain(sel, nMonths, px, trackW);
  _impDrawBand(sel, nMonths, px, trackW);

  for (const g of geo) {
    const e = g.e;
    const bar = document.createElement("div");
    bar.className = "rp-imp-ev" + (e.regions.length ? "" : " unplaced")
                  + (g.overruns ? " overruns" : "");
    bar.style.setProperty("--c", _impColour(_impLabel(e)));
    bar.style.left = (100 * (g.x - DOT / 2) / trackW) + "%";
    bar.style.width = (100 * (g.tail + DOT) / trackW) + "%";
    bar.style.top = (6 + g.lane * LANE_STEP) + "px";
    const where = e.regions.length
      ? _impWhere(e.regions, 3)
      : {short: e.location_text ? _impClip(e.location_text, 58) : "location not recorded",
         full: e.location_text || "location not recorded"};
    bar.title = `${_impTitle(_impLabel(e))} - ${_impWhen(e)}\n${where.full}`
              + (g.overruns ? "\ncontinues past the end of this window" : "");
    bar.dataset.id = e.id;
    bar.addEventListener("click", () => _selectImpact(e, sel, nMonths));
    track.appendChild(bar);

    const li = document.createElement("li");
    li.innerHTML = `<span class="rp-imp-when">${_impWhen(e)}</span>`
      + `<span class="rp-imp-what"><i class="rp-imp-dot" style="--c:${_impColour(_impLabel(e))}"></i>`
      + `${_impEsc(_impTitle(_impLabel(e)))}</span>`
      + `<span class="rp-imp-where${e.regions.length ? "" : " none"}">`
      + `${_impEsc(where.short)}</span>`;
    li.title = where.full;
    li.addEventListener("click", () => _selectImpact(e, sel, nMonths));
    li.dataset.id = e.id;
    list.appendChild(li);
  }

  // Legend carries only what this window actually contains, so it never lists
  // a disease the reader cannot see on the track.
  const legend = document.getElementById("rp-imp-legend");
  if (legend) {
    const seen = [];
    for (const g of geo) {
      const L = _impLabel(g.e);
      if (!seen.includes(L)) seen.push(L);
    }
    // Every key in one row, the shading included. It used to be explained by a
    // caption under the figure, away from the other keys, which is why nobody
    // connected the sentence to the grey block it described.
    legend.innerHTML = seen.map(L =>
      `<span class="rp-imp-key"><i class="rp-imp-dot" style="--c:${_impColour(L)}"></i>`
      + `${_impEsc(_impTitle(L))}</span>`).join("")
      + (geo.some(g => !g.e.regions.length)
          ? `<span class="rp-imp-key"><i class="rp-imp-dot hollow"></i>not placed on a map</span>`
          : "")
      + (RPIMP.band
          ? `<span class="rp-imp-key"><i class="rp-imp-swatch"></i>`
            + `${_impEsc(RPIMP.band)}</span>`
          : "");
    legend.hidden = !seen.length && !RPIMP.band;
  }

  document.getElementById("rp-imp-foot").textContent =
    `${inWindow.length} recorded in this window. `
    + (unplaced ? `${unplaced} of them name a place we hold no boundary for, drawn as `
                + `hollow rings and listed but never put on a map. ` : "")
    + `Across the whole record this country has ${d.n_mapped} of ${d.n_events} events we can `
    + `place, using the ${d.admin1_units_held} admin-1 units we hold. `
    + `${_impSources(d)}`;
}

// EM-DAT's location field is free text and can name twenty districts in one
// string, which overflows a single row. Show the first few and keep the whole
// list in the tooltip, so the row stays readable without hiding anything.
function _impWhere(names, max) {
  const full = names.join(", ");
  return names.length <= max
    ? {short: full, full}
    : {short: names.slice(0, max).join(", ") + ` +${names.length - max} more`, full};
}

function _impClip(text, max) {
  const t = String(text || "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const brk = cut.lastIndexOf(", ");
  return (brk > max * 0.5 ? cut.slice(0, brk) : cut).replace(/[,\s]+$/, "") + "...";
}

// Location and disease strings come from a free-text CSV, so they reach the DOM
// as text, never as markup.
function _impEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g,
    c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
}

// Sources are read off the events rather than named here, so adding a second
// one is a change to the builder alone. EM-DAT is the first, not the only one:
// BEACON, ProMED and EIOS are the ones being asked for.
function _impSources(d) {
  const seen = [];
  for (const e of (d.events || [])) {
    if (e.source && !seen.includes(e.source)) seen.push(e.source);
  }
  if (!seen.length) return "";
  return seen.length === 1
    ? `Source: ${seen[0]}.`
    : `Sources: ${seen.slice(0, -1).join(", ")} and ${seen[seen.length - 1]}.`;
}

// The label baked into every map file is a second copy of a name that
// index_names.js already owns, and the two drifted: the dropdown read
// "Maximum temperature (Tmax) vs normal" from the shared table while the
// colorbar underneath it read "Max temperature vs normal" straight from the
// data. Same index, same page, two names. The shared table wins everywhere the
// name is shown; the baked label stays as the fallback for any product not yet
// in the table, and can be dropped from the builder once none are.
function _varLabel(meta) {
  const canon = window.ensoIndexName && meta && window.ensoIndexName(meta.variable);
  return canon ? `${canon} vs normal` : ((meta && meta.label) || "");
}

function _impWhen(e) {
  const f = ym => {
    const [y, m] = ym.split("-").map(Number);
    return `${RP_MON[m - 1]} ${y}`;
  };
  return e.end && e.end !== e.start ? `${f(e.start)} to ${f(e.end)}` : f(e.start);
}

function _selectImpact(e, sel, nMonths) {
  RPIMP.sel = (RPIMP.sel && RPIMP.sel.id === e.id) ? null : e;
  for (const el of document.querySelectorAll(".rp-imp-ev, .rp-imp-list li")) {
    el.classList.toggle("on", !!RPIMP.sel && el.dataset.id === RPIMP.sel.id);
  }
  // Move the month slider to the event, so the maps above show the climate of
  // that month. This is the whole interaction: click what happened, see what
  // the climate was doing.
  const i = _impMonthIndex(e.start, sel.window_start, nMonths);
  const slider = document.getElementById("rp-zoom-month");
  if (RPIMP.sel && slider && i >= 0) {
    slider.value = String(i);
    slider.dispatchEvent(new Event("input", {bubbles: true}));
  }
}

function _wireImpacts() {
  for (const b of document.querySelectorAll("[data-theme]")) {
    b.addEventListener("click", () => {
      RPIMP.theme = b.dataset.theme;
      for (const o of document.querySelectorAll("[data-theme]")) {
        o.classList.toggle("on", o === b);
      }
      render();
    });
  }
}

function _wireThresholds() {
  for (const b of document.querySelectorAll(".rp-thr button[data-panel][data-key]")) {
    b.addEventListener("click", () => {
      const panel = b.dataset.panel;
      RP.thr[panel] = b.dataset.key;
      // Follow only if the map is already on this family; if the reader has it
      // on rainfall, changing a heat threshold should not yank it away.
      const vs = document.getElementById("rp-map-variable");
      if (vs && RP_THR_FAMILY[panel].includes(vs.value)
          && [...vs.options].some(o => o.value === b.dataset.key)) {
        vs.value = b.dataset.key;
        _drawEventLayer().catch(() => {});
      }
      render();
    });
  }
}

// "UK (0 grid cells)" was shown on a page drawing 540 months of ERA5 for the
// UK: the count came from whichever grid loaded first, which is CHIRPS, and
// CHIRPS stops at 50N. The chip now reports the grid the panels actually use
// and names any source that is thinner.
function _cellsChip(c) {
  const by = c.n_cells_by_source || {};
  const n = c.n_cells || 0;
  const empty = Object.keys(by).filter(k => !by[k]);
  const suffix = empty.length ? `, no ${empty.join("/")} coverage` : "";
  return `${c.label} (${n} grid cells${suffix})`;
}

/** Legend beside the charts. Swatches match the line styles exactly, so the
 *  key is read where the lines are rather than in grey text at the foot of a
 *  long page, which nobody reaches. */
function _renderLegend(sel, nOthers, fcs) {
  const el = document.getElementById("rp-legend");
  if (!el) return;
  const colour = RP_COLOR[_fam(sel.phase, sel)];
  const items = [
    [colour, "solid", 2.6, sel.is_current ? "This event (developing)" : sel.label],
    ["#8A99A8", "solid", 1.4,
     `${nOthers} other observed event${nOthers === 1 ? "" : "s"} of the same type`],
    ["#2E7D5B", "dashed", 2, "Average neutral year"],
  ].concat((fcs || []).map(f => [f.color, "dashed", 2, `${f.label} forecast`]));
  const html = (list) => list.map(([c, style, w, txt]) =>
    `<span class="rp-lg"><i style="border-top-color:${c};border-top-style:${style};`
    + `border-top-width:${w}px"></i>${txt}</span>`).join("");
  el.innerHTML = html(items);

  // The same key inside every panel. One legend above a two-column grid means
  // that by the fourth chart down you are scrolling back up to remember which
  // line is which, and the enlarge dialog had no key at all: the one view where
  // a reader is studying a single chart closely was the one view that did not
  // say what its lines were. Short labels here, because a panel is half the
  // page wide and the full event name pushed the key onto three rows.
  const short = [
    [colour, "solid", 2.6, sel.is_current ? "This event" : _shortEventName(sel.label)],
    ["#8A99A8", "solid", 1.4, "Other events"],
    ["#2E7D5B", "dashed", 2, "Neutral year"],
  ].concat((fcs || []).map(f => [f.color, "dashed", 2, f.label]));
  const compact = html(short);
  for (const panel of document.querySelectorAll(".rp-panel")) {
    if (!panel.querySelector("canvas")) continue;
    let slot = panel.querySelector(".rp-panel-lg");
    if (!slot) {
      slot = document.createElement("div");
      slot.className = "rp-legend rp-panel-lg";
      const sub = panel.querySelector(".rp-sub");
      (sub || panel.querySelector("h3")).insertAdjacentElement("afterend", slot);
    }
    slot.innerHTML = compact;
  }
  const mslot = document.getElementById("rp-modal-lg");
  if (mslot) mslot.innerHTML = html(items);
}

// "1997-98 El Nino (extreme)" is wider than a half-page panel can spare, and
// the intensity is already on the event selector and the meta chips.
function _shortEventName(label) {
  return String(label || "")
    .replace(/\s*\((extreme|strong|moderate)\)\s*$/i, "")
    .replace(/\s+El Ni.o|\s+La Ni.a/i, "");
}

function _renderMeta(sel, nOthers) {
  const c = RP.country;
  const chips = sel.is_current ? [
    ["Window", `${sel.window_start} to ${sel.window_end}`],
    // Both dates, always. Showing only one invites the reader to assume the
    // other, and the gap between them is the whole point: observations lag,
    // the forecast leads.
    ["Observed through", sel.observed_through || "n/a"],
    ["Forecast issued", sel.forecast_vintage || "n/a"],
    ["Status", "developing, not yet a catalogued event"],
  ].concat([
    ["Country", `${c.label} (${c.n_cells} grid cells)`],
  ]) : [
    ["Window", `${sel.window_start} to ${sel.window_end}`],
    ["Length", `${sel.duration_months || "?"} months`],
    ["Country", _cellsChip(c)],
    ["Compared against", `${nOthers} other event${nOthers === 1 ? "" : "s"}`],
  ];
  document.getElementById("rp-meta").innerHTML = chips
    .map(([k, v]) => `<span class="rp-chip">${k} <strong>${v}</strong></span>`).join("");

  // The footnote is now the exceptions only: things true of THIS selection that
  // the reader cannot see. Everything general moved to the legend above the
  // charts or to the methodology page. The old note was eight sentences of grey
  // text at the foot of a long page, which is where explanations go to die.
  const notes = [];
  if (sel.note) notes.push(sel.note);
  if (!sel.complete && !sel.is_current) {
    notes.push("This window runs past the end of the observed record, so the lines stop where "
             + "the data does.");
  }
  if ((c.series.pr_total_mm || []).every(v => v == null)) {
    notes.push(`${c.label} lies outside the CHIRPS band (50°S to 50°N), so the rainfall panels `
             + "are empty. The heat panels use ERA5 and are unaffected.");
  }
  const fcs2 = _forecastsForWindow(sel, sel.window_months);
  if (fcs2.length) {
    notes.push("The forecast is drawn for sea surface temperature only: there is no calibrated "
             + "forecast of country rainfall or heat behind this site.");
  }
  const noteEl = document.getElementById("rp-note");
  noteEl.innerHTML = (notes.length ? notes.join(" ") + " " : "")
    + `<a href="methodology.html#event-replay">How these are built</a>`
    + ` &middot; CHIRPS and ERA5, ${c.n_cells} grid cells over ${c.label}`
    + ` &middot; anomalies against neutral years`
    + ` &middot; <a href="index.html">ENSOscope</a>, Isma Abdelkader Di Carlo, Utrecht University`;

  // Print masthead, so a saved sheet always names what it shows rather than
  // relying on whatever the browser puts in the page header.
  const t = document.getElementById("rp-print-title");
  const s = document.getElementById("rp-print-sub");
  if (t && s) {
    t.textContent = `${sel.label} in ${c.label}`;
    // Name the thresholds on the sheet. A printed page outlives the selector,
    // so "Heat stress" alone leaves the reader unable to tell which cut-off
    // they are looking at.
    const lb = c.labels || {};
    s.textContent = `Observed monthly sequence, ${sel.window_start} to ${sel.window_end}. `
      + `Compared against ${nOthers} other observed event${nOthers === 1 ? "" : "s"} of the same type, `
      + `and against the average of the catalogued neutral years. `
      + `Heat stress: ${lb[RP.thr.heat] || RP.thr.heat}. Warm nights: ${lb[RP.thr.night] || RP.thr.night}. `
      + `ENSOscope, generated ${new Date().toISOString().slice(0, 10)}.`;
  }
}

// ── country picker map ───────────────────────────────────────────────────────
// A dropdown of 83 countries is a poor way to choose a place. This draws the
// world and lets you click. Countries WITHOUT data are drawn but inert, so the
// map never invites a click that does nothing. The dropdown stays as the
// keyboard and screen-reader path; the two are kept in sync.
//
// Reuses the GeoJSON the Teleconnections map already serves, joined on the
// Natural Earth name that the replay index carries per country.
const RPMAP = { geo: null, byName: null, svg: null, path: null, proj: null,
                drawn: false, index: null, tileCache: {} };

// Two diverging ramps, matching the Teleconnections map so the same colour
// means the same thing across the site. RdBu: blue = more. RdBu_r: red = more.
const RP_CMAPS = {
  RdBu:   [[0,[178,24,43]],[0.25,[244,165,130]],[0.5,[247,247,247]],
           [0.75,[146,197,222]],[1,[33,102,172]]],
  RdBu_r: [[0,[33,102,172]],[0.25,[146,197,222]],[0.5,[247,247,247]],
           [0.75,[244,165,130]],[1,[178,24,43]]],
};

function _rampColor(name, t) {
  const stops = RP_CMAPS[name] || RP_CMAPS.RdBu_r;
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
      const f = (t - t0) / (t1 - t0);
      return [Math.round(c0[0] + f * (c1[0] - c0[0])),
              Math.round(c0[1] + f * (c1[1] - c0[1])),
              Math.round(c0[2] + f * (c1[2] - c0[2]))];
    }
  }
  return stops[stops.length - 1][1];
}

/** The event's impact field, drawn under the country outlines. */
async function _drawEventLayer() {
  const cv = document.getElementById("rp-map-canvas");
  const varSel = document.getElementById("rp-map-variable");
  const cb = document.getElementById("rp-colorbar");
  if (!cv || !RPMAP.proj || !RPMAP.index) return;

  const evId = document.getElementById("rp-event").value;
  const key = varSel && varSel.value;
  const selEv = RP.events && RP.events.events.find(e => e.id === evId);

  // Month first. Only if there is no monthly field for this product does the
  // map fall back to the window average it used to show.
  if (selEv && RPZ.monthIdx >= 0 && RPGM.index) {
    const gm = await _loadGlobalMonth(key, _monthKeyAt(selEv, RPZ.monthIdx));
    if (gm) {
      RPMAP.field = gm;
      _repaintWorld();
      if (cb) {
        cb.hidden = false;
        document.getElementById("rp-cb-title").textContent =
          `${_varLabel(gm.meta)} (${gm.meta.units}) - ${_monthLabelAt(selEv, RPZ.monthIdx)}`;
        _paintColorbar(document.getElementById("rp-cb-bar"),
                       document.getElementById("rp-cb-ticks"),
                       gm.meta.cmap, gm.meta.vmax);
      }
      return;
    }
  }

  const entry = RPMAP.index.maps.find(m => m.event === evId && m.variable === key);

  const w = _mapWidth(), h = 330;
  const dpr = window.devicePixelRatio || 1;
  cv.width = w * dpr; cv.height = h * dpr;
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // Past the observed record. This product HAS monthly fields, just not for the
  // month the slider is on, because the window is padded to whole years. Say
  // that, rather than dropping through to the window-average map below: that
  // map answers a different question, and showing it under a month label would
  // silently swap "November 2026" for "the whole event", which is exactly the
  // confusion the month slider was added to remove.
  if (selEv && RPZ.monthIdx >= 0 && RPGM.index && RPGM.index.products[key]
      && Array.isArray(RPGM.index.months)
      && !RPGM.index.months.includes(_monthKeyAt(selEv, RPZ.monthIdx))) {
    if (cb) cb.hidden = true;
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--muted") || "#6b7280";
    ctx.font = "13px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`No observations for ${_monthLabelAt(selEv, RPZ.monthIdx)} yet.`,
                 w / 2, h / 2 - 8);
    ctx.fillText("The replay window runs to the end of the calendar year; the record does not.",
                 w / 2, h / 2 + 12);
    return;
  }

  if (!entry) {                      // no map for this event/variable combination
    if (cb) cb.hidden = true;
    return;
  }

  const tile = await _loadEventTile(entry);
  if (!tile) { if (cb) cb.hidden = true; return; }

  const { lats, lons, ri, ci, v, scale, meta } = tile;
  const vmax = Math.abs(meta.vmax), cmap = meta.cmap;
  // Cell size in projected pixels, from the grid spacing itself rather than a
  // guess, so 1 degree and 0.25 degree products both tile without gaps.
  const dLat = Math.abs(lats[1] - lats[0]), dLon = Math.abs(lons[1] - lons[0]);
  RPMAP.field = { lats, lons, ri, ci, v, scale, meta, dLat, dLon };
  _repaintWorld();

  if (cb) {
    cb.hidden = false;
    document.getElementById("rp-cb-title").textContent = `${_varLabel(meta)} (${meta.units})`;
    _paintColorbar(document.getElementById("rp-cb-bar"),
                   document.getElementById("rp-cb-ticks"), cmap, vmax);
  }

}

// ── global monthly maps ──────────────────────────────────────────────────────
// The world map used to show one field per event: the whole window averaged.
// Isma asked for it to follow the month slider, so scrubbing an event animates
// the global pattern instead of restating a mean. One file per product per
// month, ~29 KB, so a slider step is a small fetch rather than a 15 MB blob.
const RPGM = { index: null, grids: {}, cache: {} };

async function _gmGrid(gid) {
  if (!RPGM.grids[gid]) {
    RPGM.grids[gid] = await _getJSON(`data/replay/globalmonths/grids/${gid}.json`);
  }
  return RPGM.grids[gid];
}

/** Decoded global field for one product and one calendar month, or null. */
async function _loadGlobalMonth(product, ym) {
  if (!RPGM.index || !RPGM.index.products[product]) return null;
  // The index lists the months that were actually built. An event window is
  // padded to whole years, so it runs past the observed record: the 2025-26
  // event window ends 2026-12 while the cube ends at the last complete year.
  // Asking anyway just produces a 404 per step of the slider.
  if (Array.isArray(RPGM.index.months) && !RPGM.index.months.includes(ym)) return null;
  const key = `${product}/${ym}`;
  if (RPGM.cache[key] !== undefined) return RPGM.cache[key];
  let out = null;
  try {
    const d = await _getJSON(`data/replay/globalmonths/${product}/${ym}.json`);
    const g = await _gmGrid(d.grid);
    const raw = atob(d.data);
    const b = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) b[i] = raw.charCodeAt(i);
    if (b.length !== g.ri.length) {
      throw new Error(`${b.length} bytes against ${g.ri.length} cells`);
    }
    // Decode once into plain values so the painter and the readout share one
    // array, and 0 stays the no-data sentinel rather than the bottom of scale.
    const v = new Float32Array(b.length);
    const keepR = [], keepC = [];
    let n = 0;
    for (let i = 0; i < b.length; i++) {
      if (b[i] === 0) continue;
      v[n] = (b[i] - 1) / 254 * 2 * d.vmax - d.vmax;
      keepR.push(g.ri[i]); keepC.push(g.ci[i]); n++;
    }
    const meta = RPGM.index.products[product];
    out = { lats: g.lats, lons: g.lons, ri: keepR, ci: keepC,
            v: Array.from(v.slice(0, n)), scale: 1,
            dLat: g.dlat, dLon: g.dlon,
            // Rounded, not the raw percentile. A bar reading -92.6 / -46.3 / 0
            // is a number nobody can halve by eye; -100 / -50 / 0 is.
            // The index keys products BY variable, so the entry itself has no
            // variable field; without it the shared name table cannot be
            // consulted and the colorbar fell back to the label baked into the
            // data, which is the copy that had drifted.
            meta: { label: _varLabel({ ...meta, variable: product }),
                    units: meta.units, cmap: meta.cmap,
                    vmax: _niceMax(meta.vmax_display) } };
  } catch (err) {
    console.warn("global month unavailable:", key, err.message);
  }
  RPGM.cache[key] = out;
  return out;
}

/** Repaint the world canvas from the last drawn field under the current zoom.
 *  Kept separate from _drawEventLayer so a pan does not refetch the tile. */
function _repaintWorld() {
  const cv = document.getElementById("rp-map-canvas");
  const f = RPMAP.field;
  if (!cv || !f || !RPMAP.proj) return;
  const w = _mapWidth(), h = 330;
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const t = RPMAP.transform || d3.zoomIdentity;
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.scale(t.k, t.k);
  const b = { x0: (0 - t.x) / t.k, x1: (w - t.x) / t.k,
              y0: (0 - t.y) / t.k, y1: (h - t.y) / t.k };
  const { lats, lons, ri, ci, v, scale, meta, dLat, dLon } = f;
  const vmax = Math.abs(meta.vmax);
  for (let i = 0; i < v.length; i++) {
    _fillCell(ctx, RPMAP.proj, lats[ri[i]], lons[ci[i]], dLat, dLon, v[i] / scale,
              meta.cmap, vmax, b);
  }
  ctx.restore();
}

async function _drawPickerMap() {
  if (RPMAP.drawn) return;
  const wrap = document.getElementById("rp-mapwrap");
  const svgEl = document.getElementById("rp-map");
  if (!wrap || !svgEl || typeof d3 === "undefined") return;

  RPMAP.geo = await _getJSON("data/maps/ne_110m_countries.geojson");
  RPMAP.byName = {};
  for (const c of RP.countries.countries) {
    if (c.regionmask) RPMAP.byName[c.regionmask] = c;
  }

  const w = _mapWidth();
  const h = 330;
  const proj = (d3.geoNaturalEarth1 ? d3.geoNaturalEarth1() : d3.geoEquirectangular())
    .fitSize([w, h], { type: "FeatureCollection", features: RPMAP.geo.features });
  RPMAP.proj = proj;
  RPMAP.path = d3.geoPath(proj);
  RPMAP.svg = d3.select(svgEl).attr("viewBox", `0 0 ${w} ${h}`);
  RPMAP.svg.selectAll("*").remove();
  // Outlines live in a <g> so zooming is one transform rather than a redraw of
  // every path. The canvas underneath is redrawn with the same transform.
  RPMAP.g = RPMAP.svg.append("g");

  RPMAP.g.selectAll("path")
    .data(RPMAP.geo.features)
    .join("path")
    .attr("d", RPMAP.path)
    .attr("class", d => {
      const c = RPMAP.byName[d.properties.name];
      return "rp-c" + (c ? " has-data" : "");
    })
    .append("title")               // native tooltip: no extra layer to maintain
    .text(d => {
      const c = RPMAP.byName[d.properties.name];
      return c ? c.label : `${d.properties.name} (no data)`;
    });

  RPMAP.g.selectAll("path").on("click", (evt, d) => {
    if (RPMAP.dragged) return;          // a pan should not also pick a country
    const c = RPMAP.byName[d.properties.name];
    if (!c) return;
    const sel = document.getElementById("rp-country");
    sel.value = c.id;
    sel.dispatchEvent(new Event("change"));
  });

  // ── pan and zoom ──────────────────────────────────────────────────────────
  // At world scale a small country is a few pixels wide and effectively
  // unclickable. Zoom fixes that, and it has to move the canvas and the SVG
  // together or the data slides off the outlines.
  //
  // A click that follows a drag must not select a country, so the handler
  // checks how far the pointer travelled.
  RPMAP.transform = d3.zoomIdentity;
  const zoom = d3.zoom()
    .scaleExtent([1, 12])
    .translateExtent([[0, 0], [w, h]])
    .on("start", () => { RPMAP.dragged = false; })
    .on("end", () => { setTimeout(() => { RPMAP.dragged = false; }, 0); })
    .on("zoom", (ev) => {
      if (ev.sourceEvent && ev.sourceEvent.type === "mousemove") RPMAP.dragged = true;
      RPMAP.transform = ev.transform;
      RPMAP.g.attr("transform", ev.transform);
      _repaintWorld();
    });
  RPMAP.zoom = zoom;
  RPMAP.svg.call(zoom).on("dblclick.zoom", null);
  RPMAP.svg.on("dblclick", () => RPMAP.svg.transition().duration(350)
                                   .call(zoom.transform, d3.zoomIdentity));

  RPMAP.drawn = true;
  _highlightSelected();

  // Impact-variable selector, built from whatever maps actually exist so it can
  // never offer a layer that has not been generated.
  const vs = document.getElementById("rp-map-variable");
  if (vs && RPMAP.index && !vs.options.length) {
    const seen = [];
    for (const m of RPMAP.index.maps) {
      if (!seen.some(x => x.variable === m.variable)) {
        // index_names.js is the authority; the label in the data file is a
        // fallback for anything not yet in the table.
        seen.push({ variable: m.variable, label: _varLabel(m) });
      }
    }
    vs.innerHTML = seen.map(x => `<option value="${x.variable}">${x.label}</option>`).join("");
    vs.addEventListener("change", () => {
      _drawEventLayer().catch(() => {}); _drawZoom().catch(() => {});
    });
  }
  await _drawEventLayer().catch(err => console.warn("event layer:", err.message));
}

function _highlightSelected() {
  if (!RPMAP.svg) return;
  const id = document.getElementById("rp-country").value;
  RPMAP.svg.selectAll("path").classed("sel", d => {
    const c = RPMAP.byName[d.properties.name];
    return !!c && c.id === id;
  });
  const hint = document.getElementById("rp-map-hint");
  if (hint) {
    const c = RP.countries.countries.find(x => x.id === id);
    hint.textContent = c ? `${c.label} - click another country to change` : "Click a country";
  }
}


/** Drawing width for both map layers.
 *
 * The wrapper measures 0 until layout settles, which the SVG path used to hide
 * behind a "|| 900" fallback plus viewBox scaling. The canvas has neither, so a
 * zero here produced a zero-width canvas and no data layer at all. One helper,
 * one fallback, and a ResizeObserver below to redraw once a real width exists.
 */
function _mapWidth() {
  const wrap = document.getElementById("rp-mapwrap");
  const w = wrap ? wrap.clientWidth : 0;
  return w > 0 ? w : 900;
}

function _watchMapSize() {
  const wrap = document.getElementById("rp-mapwrap");
  if (!wrap || typeof ResizeObserver === "undefined") return;
  let last = 0;
  new ResizeObserver(() => {
    const w = wrap.clientWidth;
    if (w > 0 && Math.abs(w - last) > 2) {
      last = w;
      RPMAP.drawn = false;
      _drawPickerMap().catch(() => {});
    }
  }).observe(wrap);
}

// ── boot ─────────────────────────────────────────────────────────────────────
async function _loadCountry(id) {
  RP.country = await _getJSON(`data/replay/${id}.json`);
}

async function init() {
  try {
    [RP.events, RP.countries, RP.nino] = await Promise.all([
      _getJSON("data/replay/events.json"),
      _getJSON("data/replay/index.json"),
      _getJSON("data/obs_nino.json"),
    ]);
    // Optional: the page must work without it, so a failure here is not fatal.
    [RP.forecast, RP.forecastMf9] = await Promise.all([
      _getJSON("data/forecast_members.json").catch(() => null),
      _getJSON("data/forecast_members_mf9.json").catch(() => null),
    ]);
    RPMAP.index = await _getJSON("data/replay/maps/index.json").catch(() => null);
    RPGM.index = await _getJSON("data/replay/globalmonths/index.json").catch(() => null);
  } catch (err) {
    document.getElementById("rp-grid").innerHTML =
      `<div class="rp-empty">Replay data not available: ${err.message}</div>`;
    return;
  }

  const evSel = document.getElementById("rp-event");
  // Chronological, most recent first, with what is happening now at the top.
  // Grouping by phase family put 1982 above 2023 and made the list impossible
  // to scan for "the last few events". Neutral periods are no longer events at
  // all: they are the reference line on every panel instead.
  const ordered = RP.events.events.filter(e => e.is_current)
    .concat(RP.events.events.filter(e => !e.is_current)
      .sort((a, b) => b.window_start.localeCompare(a.window_start)));
  evSel.innerHTML = '<option value="" selected>Choose an event...</option>'
    + ordered.map(e => `<option value="${e.id}">${e.label}</option>`).join("");
  // NOTHING is selected on load.
  //
  // This used to default to the developing event, on the reasoning that the
  // most recent catalogued event can be months stale. The reasoning was right
  // and the result was still wrong: the monthly map fields end at the last
  // COMPLETE source year, and a developing event's window starts after it. In
  // August 2026 the default window was 2026-01 to 2027-12 against maps ending
  // 2025-12, so the two did not overlap by a single month. Every panel was
  // blank at all 24 slider positions and the only thing that changed as you
  // dragged was a year label, which is exactly how it was reported to us.
  //
  // A blank page that says "choose an event" is honest and takes one click.
  // Picking a different default would only move the problem: whichever event
  // is chosen for the reader is the one nobody chose deliberately.
  evSel.value = "";

  const cSel = document.getElementById("rp-country");
  const cs = RP.countries.countries.slice().sort((a, b) => a.label.localeCompare(b.label));
  cSel.innerHTML = cs.map(c => `<option value="${c.id}">${c.label}</option>`).join("");
  cSel.value = cs.some(c => c.id === "kenya") ? "kenya" : cs[0].id;

  await _loadCountry(cSel.value);
  await _loadImpacts(cSel.value);
  _wireThresholds();
  _wireEnlarge();
  _wireImpacts();
  render();
  _drawPickerMap().then(() => _drawZoom()).catch(err => {
    // The page is fully usable from the dropdown, so a map failure must not
    // take the charts down with it.
    console.warn("event_replay: picker map unavailable:", err.message);
    const w = document.getElementById("rp-mapwrap");
    if (w) w.style.display = "none";
  });

  evSel.addEventListener("change", () => {
    render(); _drawEventLayer().catch(() => {}); _drawZoom().catch(() => {});
  });
  document.getElementById("rp-compare").addEventListener("change", render);
  cSel.addEventListener("change", async () => {
    await _loadCountry(cSel.value);
    await _loadImpacts(cSel.value);
    _highlightSelected();
    render();
    _drawZoom().catch(() => {});
  });

  const pdf = document.getElementById("rp-pdf");
  if (pdf) {
    pdf.addEventListener("click", () => {
      // Chart.js sizes its canvases to the on-screen container. The print
      // stylesheet changes those heights, so without a resize the printed
      // charts come out at the screen aspect ratio and get clipped. Resizing
      // before the dialog opens, and again after, keeps both views correct.
      const wrap = document.getElementById("rp-mapwrap");
      const wasHidden = wrap && wrap.style.display === "none";
      if (wasHidden) wrap.style.display = "";      // the sheet should show the map

      // Force the sub-national section open for the sheet. A <details> prints
      // exactly as it sits, so a reader who never expanded it would get a PDF
      // with the heading and no numbers under it, and would have no way of
      // knowing they were missing. Restored afterwards so the screen is
      // unchanged.
      const reg = document.getElementById("rp-regions");
      const regWasShut = reg && !reg.open;
      if (regWasShut) reg.open = true;

      Object.values(RP.charts).forEach(c => c.resize());
      window.addEventListener("afterprint", function once() {
        window.removeEventListener("afterprint", once);
        if (wasHidden) wrap.style.display = "none";
        if (regWasShut) reg.open = false;
        Object.values(RP.charts).forEach(c => c.resize());
      });
      setTimeout(() => window.print(), 120);
    });
  }

  const toggle = document.getElementById("rp-map-toggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const w = document.getElementById("rp-mapwrap");
      const open = w.style.display !== "none";
      w.style.display = open ? "none" : "";
      toggle.textContent = open ? "Pick on map" : "Hide map";
      if (!open) _highlightSelected();
    });
  }

  // The strip sizes itself from the container it is in, and on paper there is
  // no sideways scroll to fall back on: a 48-month window drawn at screen width
  // simply runs off the page. Chart.js is resized on print already; the strip
  // and the zoom are hand-drawn, so they have to be told.
  //
  // beforeprint rather than the button's click handler, so Cmd-P and File >
  // Print produce the same sheet as the button does.
  window.addEventListener("beforeprint", () => {
    document.body.classList.add("rp-printing");
    _drawZoom().catch(() => {});
  });
  window.addEventListener("afterprint", () => {
    document.body.classList.remove("rp-printing");
    _drawZoom().catch(() => {});
  });

  _wireReadout("rp-map", "rp-map-readout",
               () => RPMAP.field, () => RPMAP.proj,
               () => RPMAP.field && RPMAP.field.meta,
               () => RPMAP.transform);
  for (const [svg, slot] of [["rp-zoom-svg", "a"], ["rp-zoom-svg-b", "b"]]) {
    _wireReadout(svg, `rp-zoom-readout-${slot}`,
                 () => RPZ.panel[slot] && RPZ.panel[slot].field,
                 () => RPZ.panel[slot] && RPZ.panel[slot].proj,
                 () => RPZ.panel[slot] && RPZ.panel[slot].field.meta);
  }

  // Redraw whenever the container actually changes width, which also covers
  // the first layout pass where it still measures 0.
  _watchMapSize();
}

document.addEventListener("DOMContentLoaded", init);

// ─────────────────────────────────────────────────────────────────────────────
// Country zoom, side by side
// ─────────────────────────────────────────────────────────────────────────────

// ── country zoom ─────────────────────────────────────────────────────────────
// The world map shows where the event landed globally; at world scale a single
// country is a few pixels. This is the same field over the selected country,
// with its neighbours kept for context so the reader can see whether a signal
// stops at the border (which would mean the mask, not the climate signal).
// State for the two spatial panels. monthIdx -1 means the whole replay window,
// which is what the per-event maps already hold; 0..n-1 selects one month, which
// comes from the per-country monthly fields instead.
// monthIdx -1 is the whole-window average; 0 is January of year 0, which is
// where the page opens. A window average smears a season that started early
// into one that caught up late, and that difference is usually the point.
const RPZ = { cmp: null, monthIdx: 0, cache: {}, panel: { a: null, b: null }, token: 0 };

/** Blank the two panels and their tables at once, so nothing from the previous
 *  country is ever on screen under the new country's name. */
function _clearZoomPanels(msg) {
  for (const id of ["rp-zoom-canvas", "rp-zoom-canvas-b"]) {
    const cv = document.getElementById(id);
    if (cv) cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
  }
  for (const id of ["rp-zoom-svg", "rp-zoom-svg-b"]) {
    const s = document.getElementById(id);
    if (s && window.d3) {
      const sel = d3.select(s); sel.selectAll("*").remove();
      if (msg) {
        sel.append("text").attr("x", "50%").attr("y", "50%")
           .attr("text-anchor", "middle").attr("class", "rp-zoom-empty").text(msg);
      }
    }
  }
  const box = document.getElementById("rp-regions");
  if (box) box.hidden = true;
}

async function _drawZoom() {
  if (!window.d3 || !RPMAP.geo || !RP.country) return;
  const sel = RP.events.events.find(e => e.id === document.getElementById("rp-event").value);
  if (!sel) return;

  // Two problems, one cause: this function awaits several fetches, so two runs
  // can overlap and the SLOWER one paints last.
  //
  // Symptom reported from the live site: pick India, then China, and the header
  // says China while both panels still show India. Measured at 1.0 s live with a
  // warm cache and a fast line, which is long enough to screenshot and much
  // longer on the connections these users actually have.
  //
  // The token makes the newest call the only one allowed to paint. Clearing up
  // front means the gap shows an honest "Loading" rather than the previous
  // country's data captioned with the new country's name, which is worse than
  // showing nothing.
  const myToken = ++RPZ.token;
  const stale = () => RPZ.token !== myToken;
  _clearZoomPanels("Loading " + (RP.country.label || "") + "...");

  _syncZoomControls(sel);
  const cmp = RP.events.events.find(e => e.id === RPZ.cmp) || null;
  const varKey = (document.getElementById("rp-map-variable") || {}).value;

  const feat = RPMAP.geo.features.find(f =>
    f.properties && f.properties.name === RP.country.regionmask);

  // ONE scale for both panels. Two panels on independent scales would show the
  // same anomaly in different colours and quietly invert the comparison they
  // exist to make, so the scale is resolved once and passed to both.
  // A month was asked for but the monthly field for this variable is not
  // served: fall back to the window view rather than drawing two empty panels
  // under a note about a missing per-event map, which would be the wrong
  // explanation for the wrong problem.
  const monthly = RPZ.monthIdx >= 0 ? await _loadMonthField(RP.country.id, varKey) : null;
  if (stale()) return;                       // a newer selection is already drawing
  const monthMissing = RPZ.monthIdx >= 0 && !monthly;
  if (monthMissing) RPZ.monthIdx = -1;
  // Two ranges, deliberately: vmax is what the bytes were quantised over and
  // covers the data exactly, vmax_display is the percentile the colour ramp
  // uses. Colouring with the storage range would stretch the ramp to the single
  // largest month in 45 years and render every ordinary month white.
  // The colour range is set from the TWO MONTHS ON SCREEN, not from all 504.
  // A fixed per-country range is comparable across months but saturates on the
  // extreme ones, and November 1997 against November 2023 came out as two
  // near-identical blocks of dark blue: both far past the 98th percentile, so
  // the ramp had nothing left to distinguish them with, in the one comparison
  // the panel exists to make. Scaling to the pair spends the whole ramp on the
  // difference. The bar is labelled per panel and carries its numbers, so the
  // range is never implicit.
  const scale = monthly
    ? { vmax: _pairScale(monthly, sel, cmp),
        cmap: monthly.cmap, label: monthly.label, units: monthly.units }
    : await _windowScale(sel, varKey);
  if (stale()) return;

  const ta = document.getElementById("rp-zoom-title-a");
  const tb = document.getElementById("rp-zoom-title-b");
  const when = RPZ.monthIdx >= 0 ? _monthLabelAt(sel, RPZ.monthIdx) : "whole window";
  if (ta) ta.textContent = `${_shortEv(sel)} - ${when}`;
  if (tb) tb.textContent = cmp
    ? `${_shortEv(cmp)} - ${RPZ.monthIdx >= 0 ? _monthLabelAt(cmp, RPZ.monthIdx) : "whole window"}`
    : "Pick an event to compare";

  await _drawZoomPanel("rp-zoom-canvas", "rp-zoom-svg", "rp-zoomwrap", feat, sel, varKey,
                       monthly, scale, "a");
  if (stale()) return;
  await _drawZoomPanel("rp-zoom-canvas-b", "rp-zoom-svg-b", "rp-zoomwrap-b", feat, cmp, varKey,
                       monthly, scale, "b");
  if (stale()) return;

  _zoomColorbar(scale);

  // Sub-national numbers under the pair, from the same cells.
  _renderRegions(RP.country.id, varKey, sel, cmp).catch(() => {
    const box = document.getElementById("rp-regions");
    if (box) box.hidden = true;
  });

  // Outlines arrive after the first paint, so redraw once, and only if this
  // country actually has any. Guarded against re-entry: _drawZoomPair calls
  // back into itself here, and without the check it would loop.
  if (RP.country && RPRG.bounds[RP.country.id] === undefined) {
    const cid = RP.country.id;
    _prefetchBounds(cid).then(got => {
      if (got && RP.country && RP.country.id === cid) _drawZoom();
    }).catch(() => {});
  }

  const note = document.getElementById("rp-zoom-note");
  if (note) {
    note.textContent = scale
      ? `${scale.label} (${scale.units}), against ${RP.country.climatology || "neutral years"} `
        + `for the same calendar month${RPZ.monthIdx >= 0 ? "" : "s"}. Both panels share one `
        + "colour scale, so a stronger colour really is a stronger anomaly"
        + (RPZ.monthIdx >= 0
            ? ", set from the two months shown so the comparison uses the full range; it "
              + "rescales as you move the slider"
            : "")
        + ". Values are clipped to the country; neighbours are outlined for orientation only. "
        + "One degree, the resolution of the "
        + (RPZ.monthIdx >= 0 ? "monthly fields." : "per-event maps.")
        // Asked for by MSF, 2026-08-20. A single month is one draw from a noisy
        // distribution, and the pattern can move between neighbouring months
        // within the same event. Saying so is not a hedge: without it a reader
        // takes one month as the event's signature, and then treats the next
        // month's different pattern as a contradiction rather than as ordinary
        // month-to-month variability.
        + (RPZ.monthIdx >= 0
            ? "  This is a single month. Patterns commonly shift between "
              + "neighbouring months of the same event; a different month "
              + "looking different does not make either one wrong."
            : "")
      : "No map for this variable and event.";
    if (monthMissing) {
      note.textContent += "  Month-by-month fields are not served for this variable, so the "
        + "panels show the whole window instead.";
    }
  }
}

// ── Sub-national breakdown ──────────────────────────────────────────────────
//
// A map answers "where", a table answers "how much". MSF asked for the second:
// an operational planner writes down "eastern DRC ran 50 mm above normal in
// January 1997", and you cannot read that off a pixel grid.
//
// The numbers come from the same 0.25 degree cells the panels above are drawn
// from, averaged inside each admin-1 boundary, so the table can never disagree
// with the map it sits under.
const RPRG = { index: null, cache: {}, bounds: {}, selected: null };

// The chart panels key off the country series names; the regional store keys off
// the map-layer names. Same quantity, two vocabularies, so the mapping is spelled
// out rather than guessed at by stripping suffixes.
const RP_REGION_VAR = {
  pr_total_mm: "pr_total", rx10day_mm: "rx10day", cdd_days: "cdd",
  dry_days: "dry_days", tmax_c: "tmax",
  utci_strong_days: "utci_strong_days", utci_vstrong_days: "utci_vstrong_days",
  utci_extreme_days: "utci_extreme_days",
  night_tropical: "night_tropical", night_equatorial: "night_equatorial",
  night_torrid: "night_torrid",
};

/** Absolute monthly series for ONE region, shaped like RP.country.series.
 *
 *  Absolute, not anomaly, deliberately. These charts plot real values against a
 *  dashed normal-year line. Feeding them anomalies would put the reference at
 *  zero and silently change what the y-axis means when you click a province,
 *  which is exactly the sort of thing nobody notices until a number is quoted
 *  in a report. absolute = anomaly + the region's neutral mean for that month.
 */
async function _regionSeries(countryId, regionName) {
  const out = { times: null, series: {}, clim: {} };
  for (const [countryKey, regionKey] of Object.entries(RP_REGION_VAR)) {
    const d = await _loadRegions(countryId, regionKey);
    if (!d) continue;
    const r = d.regions.find(x => x.name === regionName);
    if (!r) continue;
    out.times = out.times || d.times;
    if (!r.clim || r.clim.every(x => x === null)) continue;   // cannot make an absolute
    out.series[countryKey] = d.times.map((t, i) => {
      const a = r.values[i], c = r.clim[parseInt(t.slice(5), 10) - 1];
      return (a === null || c === null) ? null : Math.round((a + c) * 100) / 100;
    });
    out.clim[countryKey] = r.clim;
  }
  return out.times ? out : null;
}

/** Admin-1 outlines for one country, from its own small boundary file rather
 *  than the 6.3 MB global one. Synchronous by design: the panel draw cannot
 *  await, so the first paint has no outlines and _prefetchBounds triggers a
 *  redraw once they arrive. */
function _adminFeatures(countryId) {
  if (!countryId) return null;
  const b = RPRG.bounds[countryId];
  return b && b.features ? b.features : null;
}

async function _prefetchBounds(countryId) {
  if (!countryId || RPRG.bounds[countryId] !== undefined) return false;
  RPRG.bounds[countryId] = null;                       // in flight, do not refetch
  const g = await _getJSON(`data/replay/regions/${countryId}/_bounds.json`).catch(() => null);
  RPRG.bounds[countryId] = g || { features: [] };
  return !!(g && g.features && g.features.length);
}

async function _loadRegions(countryId, varKey) {
  if (RPRG.index === null) {
    RPRG.index = await _getJSON("data/replay/regions/index.json").catch(() => false);
  }
  if (!RPRG.index || !RPRG.index.countries[countryId]) return null;
  const key = `${countryId}/${varKey}`;
  if (RPRG.cache[key] === undefined) {
    RPRG.cache[key] = await _getJSON(`data/replay/regions/${countryId}/${varKey}.json`)
      .catch(() => null);
  }
  return RPRG.cache[key];
}

/** Select a sub-national region (or null for the whole country) and redraw.
 *  Awaits the series here so render(), which is synchronous, can just read it. */
async function _selectRegion(countryId, regionName) {
  if (!regionName) {
    RPRG.selected = null;
  } else {
    const s = await _regionSeries(countryId, regionName).catch(() => null);
    // Refuse silently rather than showing a region with no numbers behind it.
    if (!s || !Object.keys(s.series).length) return;
    RPRG.selected = { country: countryId, name: regionName, ...s };
  }
  _updateRegionBanner();
  render();
  _drawZoom().catch(() => {});
}

/** Says which area the charts below are for, and offers the way back. Without
 *  it a reader who clicked a province sees six charts that silently became a
 *  different place. */
function _updateRegionBanner() {
  const el = document.getElementById("rp-region-banner");
  if (!el) return;
  const r = RPRG.selected;
  if (!r) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  el.innerHTML = `Charts below show <strong>${r.name}</strong>`
    + `<button type="button" id="rp-region-clear">Show whole country</button>`;
  const btn = document.getElementById("rp-region-clear");
  if (btn) btn.addEventListener("click", () => _selectRegion(r.country, null));
}

/** Rows for the current month of both events, sorted by the left-hand panel. */
async function _renderRegions(countryId, varKey, sel, cmp) {
  const box = document.getElementById("rp-regions");
  if (!box) return;
  const data = await _loadRegions(countryId, varKey);
  // No admin-1 coverage for this country is a normal state, not an error: say
  // nothing rather than showing an empty table.
  if (!data || !data.regions || !data.regions.length) { box.hidden = true; return; }

  const at = (ev) => {
    if (!ev || RPZ.monthIdx < 0) return null;
    const ym = _monthKeyAt(ev, RPZ.monthIdx);
    const i = data.times.indexOf(ym);
    return i < 0 ? null : { ym, i };
  };
  const A = at(sel), B = at(cmp);
  if (!A) { box.hidden = true; return; }          // window view: no single month to tabulate

  const rows = data.regions.map(r => ({
    name: r.name, n: r.n_cells,
    a: r.values[A.i], b: B ? r.values[B.i] : undefined,
    sa: r.sd ? r.sd[A.i] : null, sb: (B && r.sd) ? r.sd[B.i] : null,
  })).sort((x, y) => (y.a ?? -Infinity) - (x.a ?? -Infinity));

  // "+18.6 +/- 15.3" reads as one figure with its spread. The spread is across
  // the 0.25 degree cells inside the region, so it says whether the province
  // moved as one: Katanga at +17.8 +/- 25.3 is not a wet province, it is a
  // province with a wet part and a dry part, and the mean alone hides that.
  const fmt = (v, sd) => {
    if (v === null || v === undefined) return '<span class="rp-rg-na">n/a</span>';
    const main = (v > 0 ? "+" : "") + v.toFixed(1);
    return sd === null || sd === undefined
      ? main
      : `${main}<span class="rp-rg-sd"> &plusmn; ${sd.toFixed(1)}</span>`;
  };

  const hdrA = `${_shortEv(sel)}<br><span class="rp-sub">${_monthLabelAt(sel, RPZ.monthIdx)}</span>`;
  const hdrB = cmp
    ? `${_shortEv(cmp)}<br><span class="rp-sub">${_monthLabelAt(cmp, RPZ.monthIdx)}</span>`
    : null;

  const table = document.getElementById("rp-regions-table");
  table.innerHTML =
    `<thead><tr><th>Region</th><th>${hdrA}</th>${hdrB ? `<th>${hdrB}</th>` : ""}` +
    `<th>cells</th></tr></thead><tbody>` +
    rows.map(r => `<tr><td>${r.name}</td><td>${fmt(r.a, r.sa)}</td>` +
                  (hdrB ? `<td>${fmt(r.b, r.sb)}</td>` : "") +
                  `<td class="rp-rg-na">${r.n}</td></tr>`).join("") +
    `</tbody>`;

  document.getElementById("rp-regions-summary").textContent =
    `By sub-national region (${rows.length})`;
  document.getElementById("rp-regions-note").textContent =
    `${data.var_label} (${data.units}) averaged over the 0.25 degree cells inside each `
    + `${data.admin} admin-1 boundary, against ${data.climatology} for the same calendar `
    + `month. Same cells as the maps above. The figure after ± is the spread of those `
    + `cells within the region, so it says whether the region moved as one: a spread `
    + `larger than the mean means part of it went the other way. Regions with fewer than `
    + `${RPRG.index.min_cells} cells are omitted: a mean over one or two pixels is noise. `
    + `Click a region on the maps above to put it in the charts below.`;
  box.hidden = false;
}

/** Colour range for the two panels' current month: the 98th percentile of the
 *  pair, not the maximum. One outlier cell setting the range left the other
 *  ninety-nine pale; at the 98th the bulk of the field uses the ramp and only
 *  the very top saturates, which is the normal trade a map makes. */
function _pairScale(monthly, a, b) {
  const vals = [];
  for (const e of [a, b]) {
    if (!e) continue;
    const row = monthly.at[_monthKeyAt(e, RPZ.monthIdx)];
    if (row === undefined) continue;
    const off = row * monthly.n_cells;
    for (let i = 0; i < monthly.n_cells; i++) {
      const byte = monthly.bytes[off + i];
      if (byte === 0) continue;
      vals.push(Math.abs((byte - 1) / 254 * 2 * monthly.vmax - monthly.vmax));
    }
  }
  vals.sort((x, y) => x - y);
  const mx = vals.length ? vals[Math.min(vals.length - 1,
                                Math.floor(0.98 * (vals.length - 1)))] : 0;
  if (!(mx > 0)) {
    return _niceMax(monthly.vmax_display != null ? monthly.vmax_display : monthly.vmax);
  }
  // Round up to a readable colourbar end so the number under the bar is not
  // an arbitrary 137.4082.
  const e = Math.pow(10, Math.floor(Math.log10(mx)));
  for (const st of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    if (mx <= st * e) return st * e;
  }
  return 10 * e;
}

/** Warm the next and previous month so dragging the slider does not stutter. */
function _prefetchNeighbours() {
  const vs = document.getElementById("rp-map-variable");
  const sel = RP.events && RP.events.events.find(
    e => e.id === document.getElementById("rp-event").value);
  if (!vs || !sel || !RPGM.index) return;
  for (const d of [-1, 1]) {
    const i = RPZ.monthIdx + d;
    if (i < 0 || i >= sel.window_months) continue;
    _loadGlobalMonth(vs.value, _monthKeyAt(sel, i)).catch(() => {});
  }
}

function _shortEv(e) {
  if (!e) return "";
  if (e.is_current) return "Now (developing)";
  return String(e.label).replace(/\s*(El Nino|La Nina)\s*/i, " ").replace(/[()]/g, "").trim();
}

/** Real calendar month at offset i of THIS event's window. */
function _monthLabelAt(e, i) {
  const y0 = parseInt(String(e.window_start).slice(0, 4), 10);
  const m0 = parseInt(String(e.window_start).slice(5), 10) - 1;
  const k = m0 + i;
  return `${RP_MON[k % 12]} ${y0 + Math.floor(k / 12)}`;
}

function _monthKeyAt(e, i) {
  const y0 = parseInt(String(e.window_start).slice(0, 4), 10);
  const m0 = parseInt(String(e.window_start).slice(5), 10) - 1;
  const k = m0 + i;
  return `${y0 + Math.floor(k / 12)}-${String(k % 12 + 1).padStart(2, "0")}`;
}

function _syncZoomControls(sel) {
  const cs = document.getElementById("rp-zoom-cmp");
  if (cs && !cs._filled) {
    cs.addEventListener("change", () => { RPZ.cmp = cs.value; _drawZoom().catch(() => {}); });
    cs._filled = true;
  }
  if (cs) {
    // Same family as the selected event, same set the charts compare against.
    const opts = RP.events.events.filter(e => e.id !== sel.id && e.phase !== "current"
                                         && _fam(e.phase) === _fam(sel.phase, sel));
    const want = opts.map(o => o.id).join(",");
    if (cs._key !== want) {
      cs.innerHTML = opts.map(o => `<option value="${o.id}">${o.label}</option>`).join("");
      cs._key = want;
      if (!opts.some(o => o.id === RPZ.cmp)) RPZ.cmp = opts.length ? opts[0].id : null;
      cs.value = RPZ.cmp || "";
    }
  }
  const sl = document.getElementById("rp-zoom-month");
  if (sl) {
    // No whole-window position any more. A window average was the default and
    // it hid the thing the tab is for: two seasons usually differ in WHEN, not
    // in the total.
    sl.min = 0;
    sl.max = String(sel.window_months - 1);
    if (RPZ.monthIdx > sel.window_months - 1) RPZ.monthIdx = 0;
    sl.value = String(RPZ.monthIdx);
    if (!sl._wired) {
      sl.addEventListener("input", () => {
        RPZ.monthIdx = +sl.value;
        _drawZoom().catch(() => {});
        _drawEventLayer().catch(() => {});   // the world map follows the month
        _prefetchNeighbours();
        // Cheap: update() with no animation only redraws, it does not rebuild.
        Object.values(RP.charts).forEach(c => c.update("none"));
      });
      sl._wired = true;
    }
    const out = document.getElementById("rp-zoom-month-out");
    if (out) {
      out.textContent = RPZ.monthIdx < 0 ? "Whole window"
        : `${_monthLabelAt(sel, RPZ.monthIdx)}  (month ${RPZ.monthIdx + 1} of ${sel.window_months})`;
    }
  }
}

/** Colour scale for the whole-window view, taken from the per-event map itself. */
async function _windowScale(sel, varKey) {
  if (!RPMAP.index) return null;
  const e = RPMAP.index.maps.find(m => m.event === sel.id && m.variable === varKey);
  if (!e) return null;
  return { vmax: _niceMax(Math.abs(e.vmax)), cmap: e.cmap, label: e.label, units: e.units };
}

/** Per-country monthly fields: base64 uint8, decoded once and cached. */
async function _loadMonthField(countryId, varKey) {
  const k = `${countryId}/${varKey}`;
  if (RPZ.cache[k] !== undefined) return RPZ.cache[k];
  let d = null;
  try {
    d = await _getJSON(`data/replay/months/${countryId}/${varKey}.json`);
    const raw = atob(d.data);
    const b = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) b[i] = raw.charCodeAt(i);
    if (b.length !== d.n_months * d.n_cells) {
      throw new Error(`${b.length} bytes for ${d.n_months}x${d.n_cells} cells`);
    }
    d.bytes = b;
    d.at = {};
    d.times.forEach((t, i) => { d.at[t] = i; });
  } catch (err) {
    console.warn("monthly field unavailable:", k, err.message);
    d = null;
  }
  RPZ.cache[k] = d;
  return d;
}

async function _drawZoomPanel(canvasId, svgId, wrapId, feat, evt, varKey, monthly, scale, slot) {
  const cv = document.getElementById(canvasId);
  const svgEl = document.getElementById(svgId);
  const wrap = document.getElementById(wrapId);
  if (!cv || !svgEl || !wrap) return;

  const w = wrap.clientWidth || 300, h = wrap.clientHeight || 210;
  const svg = d3.select(svgEl).attr("width", w).attr("height", h)
                .attr("viewBox", `0 0 ${w} ${h}`);
  svg.selectAll("*").remove();
  const dpr = window.devicePixelRatio || 1;
  cv.width = w * dpr; cv.height = h * dpr;
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (slot) RPZ.panel[slot] = null;
  if (!feat) return;

  // Equirectangular, not Mercator: the data cells are lat/lon rectangles and
  // stay rectangles under it, so they tile without seams at the cell edges.
  const proj = d3.geoEquirectangular().fitExtent([[5, 5], [w - 5, h - 5]], feat);
  const path = d3.geoPath(proj);
  const painted = { lats: [], lons: [], v: [], scale: 1,
                    dLat: 1, dLon: 1, meta: scale || {} };
  const PANEL_B = { x0: 0, x1: w, y0: 0, y1: h };

  if (evt && scale) {
    // Clip to the country. Painting the neighbours' cells too made it genuinely
    // hard to tell which signal belonged to the country being read. The
    // outlines stay, and the selected border is drawn heavy, so the reader can
    // still see where the clip runs and judge whether it cut a real gradient.
    ctx.save();
    ctx.beginPath();
    d3.geoPath(proj, ctx)(feat);
    ctx.clip();
    if (monthly && RPZ.monthIdx >= 0) {
      const key = _monthKeyAt(evt, RPZ.monthIdx);
      const row = monthly.at[key];
      if (row !== undefined) {
        const { lats, lons, dlat, dlon, n_cells, bytes } = monthly;
        const off = row * n_cells;
        for (let i = 0; i < n_cells; i++) {
          const b = bytes[off + i];
          if (b === 0) continue;                       // 0 is the no-data sentinel
          const val = (b - 1) / 254 * 2 * monthly.vmax - monthly.vmax;   // storage range
          _fillCell(ctx, proj, lats[i], lons[i], dlat, dlon, val, scale.cmap,
                    scale.vmax, PANEL_B);                                  // display range
          painted.lats.push(lats[i]); painted.lons.push(lons[i]); painted.v.push(val);
          painted.dLat = dlat; painted.dLon = dlon;
        }
      } else {
        svg.append("text").attr("x", w / 2).attr("y", h / 2).attr("text-anchor", "middle")
          .attr("class", "rp-zoom-empty").text("outside the observed record");
      }
    } else {
      const entry = RPMAP.index && RPMAP.index.maps.find(
        m => m.event === evt.id && m.variable === varKey);
      const tile = entry ? await _loadEventTile(entry) : null;
      if (tile) {
        const { lats, lons, ri, ci, v, scale: sc } = tile;
        const dLat = Math.abs(lats[1] - lats[0]), dLon = Math.abs(lons[1] - lons[0]);
        for (let i = 0; i < v.length; i++) {
          _fillCell(ctx, proj, lats[ri[i]], lons[ci[i]], dLat, dLon, v[i] / sc,
                    scale.cmap, scale.vmax, PANEL_B);
          painted.lats.push(lats[ri[i]]); painted.lons.push(lons[ci[i]]);
          painted.v.push(v[i] / sc);
        }
        painted.dLat = dLat; painted.dLon = dLon;
      }
    }
    ctx.restore();
  }

  // Admin-1 boundaries for the selected country, UNDER the country outline so
  // the clip edge stays the strongest line on the panel. Without these the
  // sub-national table below is a list of names the reader cannot place on the
  // map, which is half a feature.
  const sub = _adminFeatures(RP.country && RP.country.id);
  if (sub && sub.length) {
    const cid = RP.country.id;
    svg.append("g").selectAll("path")
      .data(sub).enter().append("path")
      .attr("d", path)
      .attr("class", d => "rp-zr"
        + (RPRG.selected && RPRG.selected.name === (d.properties || {}).name
            ? " rp-zr-on" : ""))
      // Clicking a province swaps every chart below to that province. Clicking
      // the selected one again goes back to the whole country, so there is
      // always a way out without hunting for a reset control.
      .on("click", (evtObj, d) => {
        const nm = (d.properties || {}).name;
        if (!nm) return;
        _selectRegion(cid, RPRG.selected && RPRG.selected.name === nm ? null : nm);
      })
      .append("title").text(d => (d.properties || {}).name || "");
  }

  svg.append("g").selectAll("path")
    .data(RPMAP.geo.features).enter().append("path")
    .attr("d", path)
    .attr("class", f => "rp-zc" + (f === feat ? " rp-zc-sel" : ""));

  if (slot) RPZ.panel[slot] = { field: painted, proj };
}

// Bounds are in PROJECTION space, not screen space. Passing the canvas size
// worked only at zoom 1: once the view is panned, the visible window in
// projection space is offset by the transform, and culling against the canvas
// size discarded every cell that was actually on screen, so a zoomed map went
// blank.
function _fillCell(ctx, proj, la, lo, dLat, dLon, val, cmap, vmax, b) {
  const p0 = proj([lo - dLon / 2, la + dLat / 2]);
  const p1 = proj([lo + dLon / 2, la - dLat / 2]);
  if (!p0 || !p1) return;
  if (p1[0] < b.x0 - 20 || p0[0] > b.x1 + 20 || p1[1] < b.y0 - 20 || p0[1] > b.y1 + 20) return;
  const [R, G, B] = _rampColor(cmap, (val + vmax) / (2 * vmax));
  ctx.fillStyle = `rgb(${R},${G},${B})`;
  ctx.fillRect(p0[0], p0[1], Math.max(1, p1[0] - p0[0]), Math.max(1, p1[1] - p0[1]));
}

// One bar per panel. They carry the same scale by construction, but a single
// shared bar sat too far from either map to read a colour against.
function _zoomColorbar(scale) {
  for (const sfx of ["a", "b"]) {
    const cb = document.getElementById(`rp-zoom-cb-${sfx}`);
    if (!cb) continue;
    if (!scale) { cb.hidden = true; continue; }
    cb.hidden = false;
    _paintColorbar(document.getElementById(`rp-zoom-cb-bar-${sfx}`),
                   document.getElementById(`rp-zoom-cb-ticks-${sfx}`),
                   scale.cmap, scale.vmax);
    const cap = document.getElementById(`rp-zoom-cb-cap-${sfx}`);
    if (cap) cap.textContent = `${scale.label} (${scale.units})`;
    // Say that the range follows the month, so nobody reads two months' colours
    // as directly comparable when the ramp has rescaled between them.
    const cbEl = document.getElementById(`rp-zoom-cb-${sfx}`);
    if (cbEl) {
      cbEl.title = RPZ.monthIdx >= 0
        ? "Scale set from the two months shown, so the two panels are directly comparable "
          + "with each other. It rescales when you move the month slider."
        : "Scale set from this variable across all events.";
    }
  }
}

// ── pointer readout ──────────────────────────────────────────────────────────
// A diverging colour ramp tells you "wetter" or "drier"; it does not tell you
// by how much, and reading a number back off a colour is exactly what people
// get wrong. Hovering or clicking any map now names the cell and its value.
//
// Values come from the arrays that were painted, not from sampling the canvas:
// reading a pixel back gives you the colour after quantisation and antialiasing,
// which is a different number from the data.
function _fmtLatLon(la, lo) {
  const a = `${Math.abs(la).toFixed(1)}°${la >= 0 ? "N" : "S"}`;
  const o = `${Math.abs(lo).toFixed(1)}°${lo >= 0 ? "E" : "W"}`;
  return `${a} ${o}`;
}

/** Nearest painted cell to a projected point, or null if the click is off-field. */
function _valueAt(field, proj, px, py) {
  if (!field || !proj || !proj.invert) return null;
  const ll = proj.invert([px, py]);
  if (!ll || !isFinite(ll[0]) || !isFinite(ll[1])) return null;
  const [lo, la] = ll;
  // Two shapes reach here: the world tile indexes into lat/lon axes via ri/ci,
  // the zoom carries one lat and lon per cell already. Normalise rather than
  // duplicating the search.
  const { lats, lons, ri, ci, v, scale, dLat, dLon } = field;
  const la_i = k => (ri ? lats[ri[k]] : lats[k]);
  const lo_i = k => (ci ? lons[ci[k]] : lons[k]);
  // Cell membership, not nearest neighbour: outside every cell must read as no
  // data rather than silently snapping to the closest one, which would invent a
  // value for the middle of an ocean.
  for (let i = 0; i < v.length; i++) {
    const cla = la_i(i), clo = lo_i(i);
    if (Math.abs(cla - la) <= dLat / 2 && Math.abs(clo - lo) <= dLon / 2) {
      return { lat: cla, lon: clo, value: v[i] / (scale || 1) };
    }
  }
  return { lat: la, lon: lo, value: null };
}

function _wireReadout(canvasOrSvg, boxId, getField, getProj, getMeta, getTransform) {
  const el = document.getElementById(canvasOrSvg);
  const box = document.getElementById(boxId);
  if (!el || !box) return;
  const show = evt => {
    const r = el.getBoundingClientRect();
    let px = evt.clientX - r.left, py = evt.clientY - r.top;
    // Undo the zoom before inverting: the projection knows nothing about it, so
    // a zoomed map would report the coordinates of wherever that pixel used to be.
    const t = getTransform && getTransform();
    if (t) { px = (px - t.x) / t.k; py = (py - t.y) / t.k; }
    const hit = _valueAt(getField(), getProj(), px, py);
    if (!hit) { box.hidden = true; return; }
    const meta = getMeta() || {};
    box.hidden = false;
    box.textContent = hit.value == null
      ? `${_fmtLatLon(hit.lat, hit.lon)} - no data`
      : `${_fmtLatLon(hit.lat, hit.lon)}  ${_varLabel(meta) || "value"} `
        + `${hit.value > 0 ? "+" : ""}${_fmtV(Math.abs(hit.value)) * (hit.value < 0 ? -1 : 1)}`
        + `${meta.units ? " " + meta.units : ""}`;
  };
  el.addEventListener("mousemove", show);
  el.addEventListener("click", show);
  el.addEventListener("mouseleave", () => { box.hidden = true; });
}

function _fmtV(v) {
  return v >= 100 ? Math.round(v) : v >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100;
}

/** Round a range end to something a reader can hold in their head: 1, 2, 2.5,
 *  5 and their decades. "+/-131" is an artefact of a percentile, not a number
 *  anyone can divide by eye. */
/** Nearest 1/2/5 x 10^n at or below v: the classic axis step, so every label
 *  lands on a number and the gaps stay even. */
function _niceStep(v) {
  if (!(v > 0) || !isFinite(v)) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / e;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * e;
}

function _niceMax(v) {
  if (!(v > 0) || !isFinite(v)) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  for (const st of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) if (v <= st * e) return st * e;
  return 10 * e;
}

/** Ramp plus a symmetric ladder of ticks: -v, -v/2, 0, +v/2, +v, with minor
 *  marks between, so a colour can be read back to a number instead of only
 *  "more" or "less". */
function _paintColorbar(canvas, labelsEl, cmap, vmax) {
  if (!canvas) return;
  const bw = Math.max(canvas.clientWidth || 160, 40);
  canvas.width = bw;
  const h = canvas.height || 9;
  const ctx = canvas.getContext("2d");
  for (let x = 0; x < bw; x++) {
    const [R, G, B] = _rampColor(cmap, x / (bw - 1));
    ctx.fillStyle = `rgb(${R},${G},${B})`;
    ctx.fillRect(x, 0, 1, h);
  }
  // Marks drawn into the ramp at the SAME values the labels use, so a tick and
  // its number are the same place rather than two competing ladders.
  ctx.fillStyle = "rgba(0,0,0,0.30)";
  const tstep = _niceStep((2 * vmax) / 5);
  for (let v = -Math.floor(vmax / tstep) * tstep; v <= vmax + 1e-9; v += tstep) {
    const x = Math.round(((v + vmax) / (2 * vmax)) * (bw - 1));
    ctx.fillRect(Math.min(Math.max(x, 0), bw - 1), h - 3, 1, 3);
  }
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(Math.round((bw - 1) / 2), 0, 1, h);      // zero
  if (labelsEl) {
    // Ticks on a nice STEP inside the range, not at fixed fractions of it.
    // Quartering the range gave -7.5 / -3.75 / 0: the ends were round and the
    // ticks between them were not, which is the half a reader actually uses.
    // A 1/2/5 step means every label is round and they are still evenly spaced.
    const step = _niceStep((2 * vmax) / 5);
    const out = [];
    for (let v = -Math.floor(vmax / step) * step; v <= vmax + 1e-9; v += step) {
      const val = Math.abs(v) < step / 1e6 ? 0 : v;
      const pct = ((val + vmax) / (2 * vmax)) * 100;
      const txt = val === 0 ? "0"
        : `${val > 0 ? "+" : "-"}${_fmtV(Math.abs(val))}`;
      out.push(`<span style="left:${pct.toFixed(2)}%">${txt}</span>`);
    }
    labelsEl.innerHTML = out.join("");
  }
}

async function _loadEventTile(entry) {
  let tile = RPMAP.tileCache[entry.file];
  if (tile) return tile;
  try {
    tile = await _getJSON(`data/replay/maps/${entry.file}`);
  } catch (err) {
    console.warn("event tile unavailable:", entry.file, err.message);
    return null;
  }
  if (tile.grid && !tile.ri) {
    const g = await _getJSON(`data/replay/maps/grids/${tile.grid}.json`);
    Object.assign(tile, { lats: g.lats, lons: g.lons, ri: g.ri, ci: g.ci });
    if (tile.v.length !== tile.ri.length) {
      throw new Error(`event map ${entry.file}: ${tile.v.length} values against `
                      + `${tile.ri.length} grid cells`);
    }
  }
  RPMAP.tileCache[entry.file] = tile;
  return tile;
}

