/* Shareable links (Isma, 18 Nov 2026): every view's URL holds its whole state and reopens it; a small
   "Copy link" control copies it. One helper for the country page, Event replay and Forecast maps.

   window.ENSO_LINK = { toQuery(state, keys), fromQuery(search, spec), write(state, keys), copyButton(host) }
   spec: { name: "str" | "list" }: a list is written comma-separated ("open=pr_total,tmax").
   A value that is empty is left out; nothing unknown is ever read back (fromQuery keeps only spec's names). */
(function () {
  function toQuery(state, keys) {
    const p = new URLSearchParams();
    for (const k of keys) {
      const v = state[k];
      if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) continue;
      p.set(k, Array.isArray(v) ? v.join(",") : String(v));
    }
    return p.toString();
  }

  function fromQuery(search, spec) {
    const p = new URLSearchParams(search);
    const s = {};
    for (const [k, t] of Object.entries(spec)) {
      const v = p.get(k);
      if (v === null || v === "") continue;
      s[k] = t === "list" ? v.split(",").filter(Boolean) : v;
    }
    return s;
  }

  function write(state, keys) {
    history.replaceState(null, "", "?" + toQuery(state, keys) + location.hash);
  }

  /** A "Copy link" button with a visible confirmation, appended to host, or placed right after it (opts.after),
   *  so a heading never reads "...Copy link" to assistive tools. */
  function copyButton(host, opts) {
    if (!document.getElementById("lk-style")) {
      const st = document.createElement("style"); st.id = "lk-style";
      st.textContent = `.lk-copy { font: inherit; font-size: var(--fs-sm); color: var(--link); background: var(--page);
        border: 1px solid var(--rule); border-radius: var(--r-ctl); padding: 3px 10px; cursor: pointer; margin-left: 10px;
        vertical-align: middle; } .lk-copy:hover { border-color: var(--link); }
        .lk-copy:focus-visible { outline: 2px solid var(--link); outline-offset: 1px; }
        .lk-ok { font-size: var(--fs-sm); color: var(--muted); margin-left: 8px; vertical-align: middle; }
        .lk-wrap { display: block; margin: 4px 0 var(--s2); }
        @media print { .lk-copy, .lk-ok, .lk-wrap { display: none !important; } }`;
      document.head.appendChild(st);
    }
    const b = document.createElement("button");
    b.type = "button"; b.className = "lk-copy"; b.textContent = "Copy link";
    b.title = "Copy the address of this view, to send it";
    const ok = document.createElement("span");
    ok.className = "lk-ok"; ok.setAttribute("role", "status");
    b.addEventListener("click", async () => {
      const href = location.href;
      try { await navigator.clipboard.writeText(href); }
      catch (e) {
        const t = document.createElement("textarea"); t.value = href; document.body.appendChild(t);
        t.select(); document.execCommand("copy"); t.remove();
      }
      ok.textContent = "Link copied";
      clearTimeout(b._t); b._t = setTimeout(() => { ok.textContent = ""; }, 2500);
    });
    if (opts && opts.after) {
      const w = document.createElement("span"); w.className = "lk-wrap";
      w.appendChild(b); w.appendChild(ok); host.after(w);
      b.style.marginLeft = "0";
    } else { host.appendChild(b); host.appendChild(ok); }
    return b;
  }

  window.ENSO_LINK = { toQuery, fromQuery, write, copyButton };
})();
