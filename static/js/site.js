/* site.js - shared site chrome loaded on every page:
   - click/tap-to-open nav dropdowns (idempotent; works on touch)
   - "About" nav link
   - mobile hamburger menu
   - site footer with author credit, contact, and data-source pointer
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
      // Guide follows Forecast and Event replay, the two main tabs
      var replay = nav.querySelector('a[data-nav="event_replay"]');
      nav.insertBefore(gl, replay ? replay.nextSibling : (nav.children[1] || null));
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

  function init() { injectChrome(); wireNavDropdowns(); renderOutbreakSources(); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
