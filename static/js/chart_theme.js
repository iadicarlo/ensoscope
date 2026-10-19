/* chart_theme.js - one chart style for every Chart.js chart on the site, matching
   the paper figures (docs/site_design_system_2026-10-17.md, section 4.8).
   Load it after chart.umd.min.js and before the page's own chart code. Colours
   come from the CSS tokens on :root (static/css/style.css), never from hex copies.

   Legends stay as each chart sets them until its page gets its key box and direct
   labels: switching every legend off here would leave colours without a label.
   Pages turn on direct labels per chart with options.plugins.directLabels.enabled. */
(function () {
  var v = function (n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); };
  var d = Chart.defaults;

  d.font.family = v("--font");
  d.font.size = 12;
  d.color = v("--tick");
  d.borderColor = v("--grid");
  d.animation = false;

  d.elements.line.tension = 0;
  d.elements.line.borderWidth = 2;
  d.elements.point.radius = 0;
  d.elements.point.hoverRadius = 4;

  Object.assign(d.plugins.tooltip, {
    backgroundColor: "#fff", borderColor: v("--hairline"), borderWidth: 1,
    titleColor: v("--ink"), bodyColor: v("--ink"), cornerRadius: 4, padding: 8, boxPadding: 4
  });
  d.plugins.tooltip.titleFont = { size: 13, weight: "600" };
  d.plugins.tooltip.bodyFont = { size: 13 };

  d.scale.grid.color = v("--grid");
  d.scale.border.color = v("--axis");
  d.scale.ticks.color = v("--tick");

  // Direct labels, as in the paper figures: the dataset label in a right margin
  // OUTSIDE the plot, at the height of the dataset's last non-null point, in the
  // dataset colour (or labelColor, for the systems' darker text variants), 13 px, 600.
  // The margin is a layout box, like the legend, so the plot shrinks to make room and
  // no line can run under a label. Labels are pushed apart so no two touch, with a
  // thin leader from the plot edge when one had to move. Where the margin would take
  // more than maxShare of the chart width, no labels are drawn: every chart that uses
  // them also has a key box listing the same series. The drawn boxes are kept on
  // chart.$directLabelBoxes for the overlap check in the screenshot sweep.
  var FONT = function () { return "600 13px " + v("--font"); };
  var GAP = 10, LINE_H = 16;
  var labelled = function (chart) {
    var out = [];
    chart.data.datasets.forEach(function (ds, i) {
      var meta = chart.getDatasetMeta(i);
      if (!ds.label || meta.hidden || ds.directLabel === false || !chart.isDatasetVisible(i)) return;
      var k = ds.data.length - 1;
      while (k >= 0 && (ds.data[k] == null || (typeof ds.data[k] === "object" && ds.data[k].y == null))) k--;
      if (k < 0) return;
      out.push({ i: i, k: k, txt: ds.directText || ds.label, color: ds.labelColor || ds.borderColor });
    });
    return out;
  };
  Chart.register({
    id: "directLabels",
    defaults: { enabled: false, maxShare: 0.25 },
    start: function (chart, args, opts) {
      var box = chart.$directLabelBox = {
        position: "right", weight: 2000, fullSize: false, on: false, options: {},
        left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0,
        isHorizontal: function () { return false; },
        update: function (maxWidth, maxHeight) {
          var o = chart.options.plugins.directLabels || {};
          var need = 0;
          if (o.enabled) {
            var ctx = chart.ctx;
            ctx.save(); ctx.font = FONT();
            labelled(chart).forEach(function (l) { need = Math.max(need, ctx.measureText(l.txt).width); });
            ctx.restore();
            if (need) need = Math.ceil(need) + GAP + 2;
          }
          box.on = need > 0 && need <= o.maxShare * chart.width;
          box.width = box.on ? Math.min(need, maxWidth) : 0;
          box.height = maxHeight;
        },
        draw: function () {},
      };
      Chart.layouts.addBox(chart, box);
    },
    stop: function (chart) {
      if (chart.$directLabelBox) Chart.layouts.removeBox(chart, chart.$directLabelBox);
    },
    afterDatasetsDraw: function (chart, args, opts) {
      chart.$directLabelBoxes = [];
      var box = chart.$directLabelBox;
      if (!opts.enabled || !box || !box.on) return;
      var area = chart.chartArea, ctx = chart.ctx;
      var items = labelled(chart).map(function (l) {
        var p = chart.getDatasetMeta(l.i).data[l.k];
        var y = p ? Math.max(area.top, Math.min(area.bottom, p.y)) : null;
        return { txt: l.txt, color: l.color, want: y, y: y };
      }).filter(function (l) { return l.want != null && isFinite(l.want); });
      if (!items.length) return;
      // Spread: top to bottom keeping LINE_H apart, then back up from the bottom edge.
      items.sort(function (a, b) { return a.want - b.want; });
      var lo = area.top + LINE_H / 2, hi = area.bottom - LINE_H / 2;
      items.forEach(function (it, j) { it.y = Math.max(it.want, lo, j ? items[j - 1].y + LINE_H : lo); });
      for (var j = items.length - 1; j >= 0; j--) {
        var cap = j === items.length - 1 ? hi : items[j + 1].y - LINE_H;
        if (items[j].y > cap) items[j].y = cap;
      }
      var x = area.right + GAP;
      ctx.save();
      ctx.font = FONT();
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      items.forEach(function (it) {
        if (Math.abs(it.y - it.want) > 1) {
          ctx.strokeStyle = v("--rule"); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(area.right + 2, it.want); ctx.lineTo(x - 2, it.y); ctx.stroke();
        }
        ctx.fillStyle = it.color;
        ctx.fillText(it.txt, x, it.y);
        var w = ctx.measureText(it.txt).width;
        chart.$directLabelBoxes.push({ txt: it.txt, x: x, y: it.y - 7, w: w, h: 14 });
      });
      ctx.restore();
    }
  });

  // Class colour for an ENSO class key such as "strong_el_nino" -> var(--en-strong).
  var cls = function (k) {
    return v("--" + k.replace(/_/g, "-").replace("la-nina", "ln").replace("el-nino", "en")
      .replace(/^(extreme|strong|moderate)-(ln|en)$/, "$2-$1"));
  };
  window.ENSO_THEME = { v: v, cls: cls };
})();
