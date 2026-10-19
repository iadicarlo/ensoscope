/* ramps.js - the colour ramps the Teleconnections maps draw, in one place.
   map_explorer.js reads them here, and the Guide's map key samples them, so the
   key cannot drift from the maps when a ramp changes. Load before either. */
(function () {
  var CMAPS = {
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

  // Rainfall is brown and green, matching the Event replay tab. Red reads as
  // hot, which is the wrong instinct for a rainfall deficit.
  // BrBG: green = more rain. BrBG_r: brown = more dry.
  BrBG: [
    [0, [140, 81, 10]], [0.25, [216, 179, 101]], [0.5, [245, 245, 245]],
    [0.75, [90, 180, 172]], [1, [1, 102, 94]],
  ],
  BrBG_r: [
    [0, [1, 102, 94]], [0.25, [90, 180, 172]], [0.5, [245, 245, 245]],
    [0.75, [216, 179, 101]], [1, [140, 81, 10]],
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

  // Anomaly ramps: the print ramps of the packs and the paper figures
  // (scripts/analysis/finance/ensoscope_figstyle.py, RAIN_CMAP and TEMP_CMAP, evenly
  // spaced stops as LinearSegmentedColormap.from_list spaces them). Grey means near
  // normal on every product; continuous, through the grey.
  CMAPS.rain_anom   = [[0.0, [166, 97, 26]], [0.5, [199, 206, 214]], [1.0, [1, 133, 113]]];            // dry brown, grey, wet teal
  CMAPS.rain_anom_r = [[0.0, [1, 133, 113]], [0.5, [199, 206, 214]], [1.0, [166, 97, 26]]];      // reversed (CDD, dry days)
  CMAPS.temp_anom   = [[0.0, [5, 48, 97]], [0.166667, [33, 102, 172]], [0.333333, [146, 197, 222]], [0.5, [199, 206, 214]], [0.666667, [244, 165, 130]], [0.833333, [178, 24, 43]], [1.0, [103, 0, 31]]];            // cooler blue, grey, hotter red
  // Continuous gridded maps on the site (Teleconnections, the Forecast maps globe, the
  // replay world map): the same end colours with a near-white middle #F7F7F7, so a
  // mostly near-normal globe does not turn grey (Isma, 19 Oct 2026). Region-based maps
  // (the replay country pair and regional forecast map) keep the grey middle of the packs.
  CMAPS.rain_cont   = [[0.0, [166, 97, 26]], [0.5, [247, 247, 247]], [1.0, [1, 133, 113]]];
  CMAPS.rain_cont_r = [[0.0, [1, 133, 113]], [0.5, [247, 247, 247]], [1.0, [166, 97, 26]]];
  CMAPS.temp_cont   = [[0.0, [5, 48, 97]], [0.166667, [33, 102, 172]], [0.333333, [146, 197, 222]], [0.5, [247, 247, 247]], [0.666667, [244, 165, 130]], [0.833333, [178, 24, 43]], [1.0, [103, 0, 31]]];
  CMAPS.temp_cont_r = [[0.0, [103, 0, 31]], [0.166667, [178, 24, 43]], [0.333333, [244, 165, 130]], [0.5, [247, 247, 247]], [0.666667, [146, 197, 222]], [0.833333, [33, 102, 172]], [1.0, [5, 48, 97]]];
  CMAPS.temp_anom_r = [[0.0, [103, 0, 31]], [0.166667, [178, 24, 43]], [0.333333, [244, 165, 130]], [0.5, [199, 206, 214]], [0.666667, [146, 197, 222]], [0.833333, [33, 102, 172]], [1.0, [5, 48, 97]]];

  // Which anomaly ramp replaces each legacy diverging ramp. Only anomaly layers are
  // switched; absolute layers keep their sequential ramps (and the two absolute
  // layers drawn on RdBu_r keep it).
  var ANOMALY = { BrBG: "rain_anom", BrBG_r: "rain_anom_r", RdBu_r: "temp_anom", RdBu: "temp_anom_r" };
  var CONTINUOUS = { BrBG: "rain_cont", BrBG_r: "rain_cont_r", RdBu_r: "temp_cont", RdBu: "temp_cont_r" };
  // kind: "continuous" for gridded maps, "region" for maps of regions as in the packs.
  function forAnomaly(name, kind) {
    if (kind !== "continuous" && kind !== "region") throw new Error("ramps.js: map kind must be continuous or region");
    return (kind === "continuous" ? CONTINUOUS : ANOMALY)[name] || name;
  }

  // Outside the data (neighbouring countries, ocean, land with no data): the light
  // neighbour fill, far lighter than the grey middle. No data inside a map: the same
  // fill with a thin ink hatch at 25% (ensoscope_figstyle.nodata_style).
  var NEIGHBOUR = "#EEF1F4";
  function hatch(ctx) {
    var c = document.createElement("canvas"); c.width = c.height = 6;
    var g = c.getContext("2d");
    g.fillStyle = NEIGHBOUR; g.fillRect(0, 0, 6, 6);
    g.strokeStyle = "rgba(11, 33, 56, 0.25)"; g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(0, 6); g.lineTo(6, 0); g.moveTo(-1, 1); g.lineTo(1, -1); g.moveTo(5, 7); g.lineTo(7, 5); g.stroke();
    return ctx.createPattern(c, "repeat");
  }

  // A CSS gradient sampling ramp `name` from t0 to t1 (0 to 1), for keys.
  function css(name, t0, t1) {
    var stops = CMAPS[name];
    if (!stops) throw new Error("ramps.js: unknown ramp " + name);
    var at = function (t) {
      for (var i = 1; i < stops.length; i++) {
        if (t <= stops[i][0]) {
          var a = stops[i - 1], b = stops[i], f = (t - a[0]) / (b[0] - a[0]);
          return "rgb(" + [0, 1, 2].map(function (k) { return Math.round(a[1][k] + f * (b[1][k] - a[1][k])); }).join(",") + ")";
        }
      }
      var l = stops[stops.length - 1][1];
      return "rgb(" + l.join(",") + ")";
    };
    var parts = [];
    for (var j = 0; j <= 4; j++) { var t = t0 + (t1 - t0) * j / 4; parts.push(at(t) + " " + (j * 25) + "%"); }
    return "linear-gradient(90deg, " + parts.join(", ") + ")";
  }
  // The colour at t (0 to 1) on ramp `name`, as [R, G, B].
  function color(name, t) {
    var stops = CMAPS[name];
    if (!stops) throw new Error("ramps.js: unknown ramp " + name);
    t = Math.max(0, Math.min(1, t));
    for (var i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        var a = stops[i - 1], b = stops[i], f = (t - a[0]) / (b[0] - a[0]);
        return [0, 1, 2].map(function (k) { return Math.round(a[1][k] + f * (b[1][k] - a[1][k])); });
      }
    }
    return stops[stops.length - 1][1].slice();
  }
  window.ENSO_RAMPS = CMAPS;
  window.ENSO_RAMP_CSS = css;
  window.ENSO_RAMP_COLOR = color;
  window.ENSO_ANOMALY = forAnomaly;
  window.ENSO_NEIGHBOUR = NEIGHBOUR;
  window.ENSO_HATCH = hatch;
})();
