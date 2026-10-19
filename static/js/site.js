/* site.js - shared site chrome loaded on every page:
   - click/tap-to-open nav dropdowns (idempotent; works on touch)
   - "About" nav link
   - mobile hamburger menu
   - site footer with author credit, contact, and data-source pointer
   - the ENSO meter strip under the header (data/enso_now.json)
   Self-contained and safe to load alongside app.js. */
(function () {
  function wireNavDropdowns() {
    document.querySelectorAll(".nav-dropdown-toggle").forEach(function (t) {
      if (t.dataset.navWired) return;
      t.dataset.navWired = "1";
      t.addEventListener("click", function (e) {
        e.stopPropagation();
        var parent = t.closest(".nav-dropdown");
        if (!parent) return;
        var wasOpen = parent.classList.contains("open");
        document.querySelectorAll(".nav-dropdown.open").forEach(function (p) {
          if (p !== parent) p.classList.remove("open");
        });
        parent.classList.toggle("open", !wasOpen);
      });
    });
    // Selecting an item closes its dropdown (so it never stays stuck open,
    // including when the link points back to the current page).
    document.querySelectorAll(".nav-dropdown-menu a").forEach(function (link) {
      if (link.dataset.navLinkWired) return;
      link.dataset.navLinkWired = "1";
      link.addEventListener("click", function () {
        document.querySelectorAll(".nav-dropdown.open").forEach(function (p) { p.classList.remove("open"); });
      });
    });
    if (!document.body.dataset.navOutsideWired) {
      document.body.dataset.navOutsideWired = "1";
      document.addEventListener("click", function (e) {
        if (e.target.closest(".nav-dropdown")) return;
        document.querySelectorAll(".nav-dropdown.open").forEach(function (p) { p.classList.remove("open"); });
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") {
          document.querySelectorAll(".nav-dropdown.open").forEach(function (p) { p.classList.remove("open"); });
        }
      });
    }
  }

  function injectChrome() {
    var headerInner = document.querySelector(".header-inner");
    var nav = headerInner ? headerInner.querySelector("nav") : null;

    if (nav && !nav.querySelector('a[data-nav="guide"]')) {
      var gl = document.createElement("a");
      gl.href = "guide.html";
      gl.textContent = "Guide";
      gl.setAttribute("data-nav", "guide");
      if (document.body.dataset.page === "guide") gl.classList.add("active");
      // Order: Forecast, Guide, Event replay (Isma, 17 Oct 2026)
      var replay = nav.querySelector('a[data-nav="event_replay"]');
      nav.insertBefore(gl, replay || nav.children[1] || null);
    }

    if (nav && !nav.querySelector('.nav-dropdown[data-nav-group="about"]')) {
      var page = document.body.dataset.page;
      var isAbout = (page === "about" || page === "methodology" || page === "updates");
      var dd = document.createElement("div");
      dd.className = "nav-dropdown";
      dd.setAttribute("data-nav-group", "about");
      dd.innerHTML =
        '<span class="nav-dropdown-toggle' + (isAbout ? " active" : "") + '" data-nav="about">About</span>' +
        '<div class="nav-dropdown-menu">' +
          '<a href="updates.html" data-nav-item="updates"' + (page === "updates" ? ' class="active"' : "") + ">What's new</a>" +
          '<a href="about.html" data-nav-item="about_me"' + (page === "about" ? ' class="active"' : "") + ">About and contact</a>" +
          '<a href="methodology.html" data-nav-item="methodology"' + (page === "methodology" ? ' class="active"' : "") + ">Methodology and data</a>" +
        "</div>";
      nav.appendChild(dd);
    }

    if (headerInner && nav && !headerInner.querySelector(".nav-toggle")) {
      var btn = document.createElement("button");
      btn.className = "nav-toggle";
      btn.type = "button";
      btn.setAttribute("aria-label", "Toggle navigation");
      btn.innerHTML = "<span></span><span></span><span></span>";
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        headerInner.classList.toggle("nav-open");
      });
      headerInner.appendChild(btn);
      nav.addEventListener("click", function (e) {
        if (e.target.tagName === "A") headerInner.classList.remove("nav-open");
      });
    }

    if (!document.querySelector("footer.site-footer")) {
      var f = document.createElement("footer");
      f.className = "site-footer";
      f.innerHTML =
        '<div class="footer-inner">' +
          '<div class="footer-col">' +
            '<div class="footer-title">ENSOscope</div>' +
            '<p>Operational El Niño / La Niña forecasts and teleconnection maps, turning seasonal climate forecasts into regional signals for anticipatory action.</p>' +
            '<p class="footer-muted">Created by Isma Abdelkader Di Carlo (PhD).</p>' +
          '</div>' +
          '<div class="footer-col">' +
            '<div class="footer-title">Explore</div>' +
            '<a href="guide.html">Guide</a>' +
            '<a href="index.html">Forecast</a>' +
            '<a href="map_explorer.html">Teleconnections</a>' +
            '<a href="event_replay.html">Event replay</a>' +
            '<a href="hindcast_skill.html">Skill</a>' +
            '<a href="methodology.html">Methodology and data sources</a>' +
            '<a href="updates.html">What&rsquo;s new</a>' +
            '<a href="about.html">About and contact</a>' +
          '</div>' +
          '<div class="footer-col">' +
            '<div class="footer-title">Contact and code</div>' +
            '<a href="https://iadicarlo.org" target="_blank" rel="noopener">iadicarlo.org</a>' +
            '<a href="https://github.com/iadicarlo" target="_blank" rel="noopener">github.com/iadicarlo</a>' +
            '<a href="about.html">Full contact details</a>' +
            '<a href="https://doi.org/10.5281/zenodo.23366523" target="_blank" rel="noopener" title="Cite ENSOscope (all versions)"><img src="https://zenodo.org/badge/DOI/10.5281/zenodo.23366523.svg" alt="DOI 10.5281/zenodo.23366523" style="margin-top:0.3rem"></a>' +
            '<p class="footer-muted">The datasets ENSOscope uses, their licences and how to cite them are on the Methodology page.</p>' +
          '</div>' +
        '</div>' +
        '<div class="footer-bottom">For research and humanitarian decision-support. Seasonal forecasts carry real uncertainty; read the Skill and Methodology pages before acting on them.' +
          '<span style="display:block;margin-top:0.85rem;opacity:0.8">© 2026 Isma Abdelkader Di Carlo · Content licensed <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">CC BY 4.0</a> · Underlying datasets keep their own licenses (see Methodology).</span></div>';
      document.body.appendChild(f);
    }
  }

  // Outbreak sources are listed once, in the build's source registry
  // (build_impact_timeline.py), and published in impacts/index.json. The replay
  // page's source notes and the methodology list are written from it, so a new
  // source shows up here without editing either page. The text already in the
  // HTML stays if the file cannot be read.
  function renderOutbreakSources() {
    var para = document.getElementById("rp-imp-sources");
    var list = document.getElementById("outbreak-sources-list");
    if (!para && !list) return;
    fetch("data/replay/impacts/index.json", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.sources || !d.sources.length) return;
        if (para) para.textContent = d.sources.map(function (s) { return s.description; }).join(" ");
        if (list) {
          list.querySelectorAll("li.src-static").forEach(function (li) { li.remove(); });
          d.sources.forEach(function (s) {
            var li = document.createElement("li");
            var b = document.createElement("strong");
            b.textContent = s.title || s.label;
            li.appendChild(b);
            li.appendChild(document.createTextNode(" - " + (s.reference || s.label) + (s.url ? ", " : ".")));
            if (s.url) {
              var a = document.createElement("a");
              a.href = s.url; a.target = "_blank"; a.rel = "noopener";
              a.textContent = s.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
              li.appendChild(a);
              li.appendChild(document.createTextNode("."));
            }
            list.appendChild(li);
          });
        }
      })
      .catch(function () {});
  }

  // ENSO meter: the strip under the header on every page. Everything it says is
  // written by build_enso_now.py into data/enso_now.json (checked against the
  // classifier, the catalogue and the Forecast page by check_consistency.py);
  // this only lays it out. If the file cannot be read the strip is simply absent.
  var EM_COLOR = {
    extreme_la_nina: "--ln-extreme", strong_la_nina: "--ln-strong", moderate_la_nina: "--ln-moderate",
    neutral: "--neutral",
    moderate_el_nino: "--en-moderate", strong_el_nino: "--en-strong", extreme_el_nino: "--en-extreme"
  };
  var SVG_NS = "http://www.w3.org/2000/svg";

  function emEl(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  // Two wordings of one phrase: the long one on wide screens, the short one on phones.
  function emDual(longText, shortText) {
    var f = document.createDocumentFragment();
    f.appendChild(emEl("span", "em-long", longText));
    f.appendChild(emEl("span", "em-short", shortText));
    return f;
  }
  function emSigned(v) { return (v >= 0 ? "+" : "-") + Math.abs(v).toFixed(2); }

  function emTrace(trace, labelOf) {
    var W = 76, H = 18, P = 3, n = trace.length;
    var vmax = 1;
    trace.forEach(function (t) { vmax = Math.max(vmax, Math.abs(t.value)); });
    var x = function (k) { return P + k * (W - 2 * P) / Math.max(1, n - 1); };
    var y = function (v) { return H / 2 - v / vmax * (H / 2 - P); };   // zero in the middle
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "em-trace");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Relative Niño 3.4 index, " + trace[0].label + " to " +
      trace[n - 1].label + ", from " + emSigned(trace[0].value) + " to " + emSigned(trace[n - 1].value) + " σ");
    var zero = document.createElementNS(SVG_NS, "line");
    zero.setAttribute("class", "em-zero");
    zero.setAttribute("x1", 0); zero.setAttribute("x2", W);
    zero.setAttribute("y1", y(0)); zero.setAttribute("y2", y(0));
    svg.appendChild(zero);
    var line = document.createElementNS(SVG_NS, "polyline");
    line.setAttribute("class", "em-line");
    line.setAttribute("points", trace.map(function (t, k) { return x(k).toFixed(1) + "," + y(t.value).toFixed(1); }).join(" "));
    svg.appendChild(line);
    trace.forEach(function (t, k) {
      var c = document.createElementNS(SVG_NS, "circle");
      c.setAttribute("cx", x(k).toFixed(1)); c.setAttribute("cy", y(t.value).toFixed(1));
      c.setAttribute("r", k === n - 1 ? 2.6 : 1.8);
      if (k === n - 1) c.setAttribute("class", "em-last");
      c.style.fill = "var(" + EM_COLOR[t["class"]] + ")";
      var tt = document.createElementNS(SVG_NS, "title");
      tt.textContent = t.label + ": " + emSigned(t.value) + " σ, " + labelOf[t["class"]] + " conditions";
      c.appendChild(tt);
      svg.appendChild(c);
    });
    return svg;
  }

  function renderEnsoMeter() {
    var header = document.querySelector("body > header");
    if (!header || document.querySelector(".enso-meter")) return;
    var v = window.ENSOSCOPE_DATA_VERSION ? "?v=" + window.ENSOSCOPE_DATA_VERSION : "";
    fetch("data/enso_now.json" + v, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.observed || document.querySelector(".enso-meter")) return;
        var o = d.observed, ev = d.event || {}, fc = d.forecast;
        var labelOf = {};
        (d.classes || []).forEach(function (c) { labelOf[c.key] = c.label; });

        var sec = emEl("section", "enso-meter");
        sec.setAttribute("aria-label", d.sentence);
        var inner = emEl("div", "em-inner");
        sec.appendChild(inner);

        // 1. the seven classes, La Niña to El Niño, the observed one marked
        var g = emEl("div", "em-gauge");
        g.setAttribute("role", "img");
        g.setAttribute("aria-label", "Seven classes from extreme La Niña to extreme El Niño; " +
          o.month_label + " is in " + o.class_label + ", " + o.value_title);
        g.title = o.value_title;
        g.appendChild(emEl("span", "em-end", "La Niña"));
        var bar = emEl("span", "em-bar");
        var on = -1;
        (d.classes || []).forEach(function (c, k) {
          var s = emEl("span", "em-seg" + (c.key === o["class"] ? " is-on" : ""));
          s.style.background = "var(" + EM_COLOR[c.key] + ")";
          s.title = c.key === o["class"] ? c.label + ", " + o.value_title : c.label;
          if (c.key === o["class"]) on = k;
          bar.appendChild(s);
        });
        if (on >= 0) {
          var mk = emEl("span", "em-mark");
          mk.style.left = ((on + 0.5) / d.classes.length * 100).toFixed(2) + "%";
          bar.appendChild(mk);
        }
        g.appendChild(bar);
        g.appendChild(emEl("span", "em-end", "El Niño"));
        inner.appendChild(g);

        // 2. the latest month and its class (the index value is on the scale's tooltip)
        var now = emEl("p", "em-now");
        var b = emEl("strong");
        b.appendChild(emDual(o.line, o.line_short));
        now.appendChild(b);
        inner.appendChild(now);

        // 3. since when, and for El Niño the latest eastern Pacific rain; whether it
        //    counts as an event yet (the catalogue's view) is in the tooltip
        var st = emEl("p", "em-status");
        st.appendChild(emDual(o.status_line, o.status_short));
        if (ev.text) st.title = ev.text;
        inner.appendChild(st);

        var def = emEl("a", "em-def", d.definition_text || "How we measure this");
        def.href = d.definition_href || "methodology.html#enso-classes";
        inner.appendChild(def);

        // 4. the last months of the index, each dot coloured by its month's class
        if (o.trace && o.trace.length > 1) {
          inner.appendChild(emTrace(o.trace.map(function (t) {
            return { value: t.value, "class": t["class"], label: _emMonth(t.month) };
          }), labelOf));
        }

        // 5. the ENSO forecast, one line, secondary
        if (fc) {
          var a = emEl("a", "em-fc");
          a.href = fc.href || "index.html";
          var key = emEl("span", "em-key");
          key.style.background = "var(" + EM_COLOR[fc["class"]] + ")";
          a.appendChild(key);
          var run = emEl("span", "em-fc-run");
          run.appendChild(emDual(fc.run_label + ":", fc.run_short + ":"));
          a.appendChild(run);
          a.appendChild(document.createTextNode(" "));
          a.appendChild(emDual(fc.sentence, fc.short));
          inner.appendChild(a);
        }

        header.parentNode.insertBefore(sec, header.nextSibling);
        emFit(sec);
        var t;
        window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(function () { emFit(sec); }, 120); });
      })
      .catch(function () {});
  }
  // If a line would be cut short, switch the first two lines to their short wording.
  // Phones have it already from the stylesheet, so this only acts above 768 px.
  // The forecast line is not part of it: it wraps on desktop, and on tablets and
  // phones its short wording fits.
  function emFit(sec) {
    sec.classList.remove("em-fit1");
    if (window.matchMedia("(max-width: 768px)").matches) return;
    var lines = sec.querySelectorAll(".em-now, .em-status");
    var cut = function () {
      for (var i = 0; i < lines.length; i++) if (lines[i].scrollWidth > lines[i].clientWidth + 1) return true;
      return false;
    };
    if (cut()) sec.classList.add("em-fit1");
  }
  var _EM_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function _emMonth(ym) { return _EM_MONTHS[parseInt(ym.slice(5, 7), 10) - 1] + " " + ym.slice(0, 4); }

  function init() { injectChrome(); wireNavDropdowns(); renderOutbreakSources(); renderEnsoMeter(); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
