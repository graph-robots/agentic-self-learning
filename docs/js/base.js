/* window.Base: the shared components every section composes (DESIGN_SPEC §1.4) and the page's boot.
   Sections register with Base.section("<id>", async (root, data) => { … }); Base loads the files the root's
   data-needs names (inline <script type="application/json"> first, data/<name> otherwise), runs init, and sets
   data-ready="1" on the root. Colours come only from CSS classes and tokens, so a theme switch needs no redraw.
   Text from data files is inserted with textContent only. */
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  let uid = 0;
  const nextId = (p) => `${p}-${++uid}`;

  /* ================================================================ elements */
  function setAttrs(node, attrs) {
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "text") node.textContent = v;
      else if (k === "dataset") Object.assign(node.dataset, v);
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : String(v));
    }
    return node;
  }
  /** Base.el(tag, attrs, parent): an HTML element. attrs: any attribute, plus text, dataset, on<event>. */
  function el(tag, attrs, parent) {
    const node = setAttrs(document.createElement(tag), attrs);
    if (parent) parent.appendChild(node);
    return node;
  }
  /** Base.svg(tag, attrs, parent): an SVG element, same attrs as el(). */
  function svg(tag, attrs, parent) {
    const node = setAttrs(document.createElementNS(NS, tag), attrs);
    if (parent) parent.appendChild(node);
    return node;
  }
  function size(root, w, h) {
    root.setAttribute("viewBox", `0 0 ${w} ${h}`);
    root.setAttribute("height", h);
    root.style.height = h + "px";
  }
  /** Base.mark(parent, id, x, y, {size, cls, title}): a sprite glyph centred at (x, y) over a 3 px --card halo. */
  function mark(parent, id, x, y, opts) {
    const o = opts || {};
    const s = o.size || 14;
    const g = svg("g", { class: o.group || null }, parent);
    const at = { href: "#" + id, x: x - s / 2, y: y - s / 2, width: s, height: s };
    if (o.halo !== false) svg("use", { ...at, class: "halo" }, g);
    svg("use", { ...at, class: o.cls || "glyph" }, g);
    if (o.title) svg("title", { text: o.title }, g);
    return g;
  }
  /** Base.glyph(id, cls): an inline <svg class="glyph"> holding one sprite symbol, for HTML text. */
  function glyph(id, cls) {
    const s = svg("svg", { class: "glyph" + (cls ? " " + cls : ""), viewBox: "0 0 16 16", "aria-hidden": "true" });
    svg("use", { href: "#" + id }, s);
    return s;
  }

  /* ================================================================ text measuring */
  const measureCtx = document.createElement("canvas").getContext("2d");
  /** Base.textWidth(text, font): rendered width in px, e.g. textWidth("reach", "500 11.5px 'JetBrains Mono'"). */
  function textWidth(text, font) {
    measureCtx.font = font || "500 12px Manrope";
    return measureCtx.measureText(text).width;
  }
  const MONO = (px) => `500 ${px}px "JetBrains Mono", ui-monospace, monospace`;
  const SANS = (px, w) => `${w || 500} ${px}px Manrope, "Helvetica Neue", Arial, sans-serif`;
  /* text cut to maxW with "…"; "" when fewer than keep characters (default 3) would be left */
  function fit(text, maxW, font, keep) {
    if (textWidth(text, font) <= maxW) return text;
    let s = text;
    while (s.length > 1 && textWidth(s + "…", font) > maxW) s = s.slice(0, -1);
    s = s.trimEnd();
    return s.length >= (keep || 3) ? s + "…" : "";
  }
  function wrapLines(text, maxW, font) {
    const words = text.split(" ");
    const lines = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? cur + " " + w : w;
      if (cur && textWidth(next, font) > maxW) { lines.push(cur); cur = w; } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines;
  }
  /* wrapLines at the narrowest width that keeps the same number of lines, so a label never ends on one stray word */
  function balanceLines(text, maxW, font) {
    const n = wrapLines(text, maxW, font).length;
    if (n < 2) return wrapLines(text, maxW, font);
    let lo = maxW / n, hi = maxW;
    while (hi - lo > 2) { const mid = (lo + hi) / 2; if (wrapLines(text, mid, font).length > n) lo = mid; else hi = mid; }
    return wrapLines(text, hi, font);
  }

  /* ================================================================ data, layout, events */
  const dataCache = new Map();
  /** Base.data(name): Promise of a data file ("clips" or "clips.json"); the inline copy first, then data/<name>. */
  function data(name) {
    const file = name.endsWith(".json") ? name : name + ".json";
    if (!dataCache.has(file)) {
      const inline = document.getElementById("json:" + file);
      dataCache.set(file, inline ? Promise.resolve(JSON.parse(inline.textContent))
        : fetch("data/" + file).then((r) => {
          if (!r.ok) throw new Error(`data/${file}: ${r.status}`);
          return r.json();
        }));
    }
    return dataCache.get(file);
  }

  /* Phone layout follows the viewport, not the element: a half-width desktop ribbon keeps its group row. */
  const phoneQuery = window.matchMedia ? window.matchMedia("(max-width: 600px)") : null;
  const isPhone = () => !!(phoneQuery && phoneQuery.matches);

  const mounts = new Set();
  const mountOf = new WeakMap();
  /** Base.mount(box, draw): draw(width) on first sight and on every width change; returns a forced redraw, whose
   *  .stop() disconnects it. One mount per element: mounting the same element again replaces the earlier one. */
  function mount(box, draw) {
    unmount(box);
    let last = 0, on = true, ro = null;
    const run = (force) => {
      if (!on) return;
      const w = Math.round(box.getBoundingClientRect().width);
      if (!w || (w === last && !force)) return;
      last = w;
      draw(w);
    };
    const redraw = () => run(true);
    const stop = () => {
      on = false;
      if (ro) ro.disconnect();
      mounts.delete(redraw);
      if (mountOf.get(box) === stop) mountOf.delete(box);
    };
    if ("ResizeObserver" in window) {
      ro = new ResizeObserver(() => requestAnimationFrame(() => run(false)));
      ro.observe(box);
    }
    mounts.add(redraw);
    mountOf.set(box, stop);
    redraw.stop = stop;
    run(true);
    return redraw;
  }
  /** Base.unmount(box): stops the element's mount, if any. */
  function unmount(box) {
    const stop = mountOf.get(box);
    if (stop) stop();
  }
  if (phoneQuery && phoneQuery.addEventListener) phoneQuery.addEventListener("change", () => mounts.forEach((r) => r()));

  /* Every component keeps one live instance per element: building it again on the same element destroys the earlier
     one first, so its observer, listeners and scrub wiring never stack. */
  const live = new WeakMap();
  function retire(root) {
    const prev = live.get(root);
    if (prev) prev.destroy();
  }

  const bus = new Map();
  /** Base.on(name, fn) / Base.emit(name, detail): page-wide events between sections (e.g. "loop:select"). */
  function on(name, fn) {
    if (!bus.has(name)) bus.set(name, new Set());
    bus.get(name).add(fn);
    return () => bus.get(name).delete(fn);
  }
  function emit(name, detail) {
    for (const fn of bus.get(name) || []) fn(detail);
  }
  function emitter() {
    const h = {};
    return {
      on(name, fn) { (h[name] = h[name] || []).push(fn); },
      off(name, fn) { h[name] = (h[name] || []).filter((f) => f !== fn); },
      emit(name, ...a) { (h[name] || []).slice().forEach((fn) => fn(...a)); },
    };
  }

  /* ================================================================ C15 tooltip */
  /* The tip sits above its anchor unless that would put it off screen or under the sticky section rail; then it
     flips below the anchor's lower edge (for a ribbon chip, under its marks row), so it never covers what it names. */
  function clearTop() {
    const nav = document.getElementById("rail");
    return nav && !nav.hidden ? Math.max(0, nav.getBoundingClientRect().bottom) + 4 : 4;
  }
  /** Base.tooltip(box): one tooltip per box. {show(x, y, title, rows, yBelow), hide(), bind(node, content, {below})};
   *  content() returns {title, rows: [{text, color}]}. Every bound node is reachable by hover, tap and focus. */
  function tooltip(box) {
    if (getComputedStyle(box).position === "static") box.style.position = "relative";
    let tip = $(":scope > .tip", box);
    if (!tip) tip = el("div", { class: "tip", hidden: true, role: "status" }, box);
    const api = {
      show(x, y, title, rows, yBelow) {
        tip.replaceChildren();
        if (title) el("b", { text: title }, tip);
        for (const r of rows || []) {
          const row = el("div", { class: "row" }, tip);
          if (r.color) el("i", { style: `background:${r.color}` }, row);
          row.appendChild(document.createTextNode(r.text));
        }
        tip.hidden = false;
        tip.style.left = clamp(x + 12, 0, Math.max(0, box.clientWidth - tip.offsetWidth)) + "px";
        const above = y - tip.offsetHeight - 10;
        const fits = box.getBoundingClientRect().top + above >= clearTop();
        tip.style.top = (fits ? above : (yBelow != null ? yBelow : y) + 10) + "px";
        tip.dataset.side = fits ? "above" : "below";
      },
      hide() { tip.hidden = true; },
      bind(node, content, opts) {
        if (!node.hasAttribute("tabindex")) node.setAttribute("tabindex", "0");
        // a small node keeps the tip clear of all of it; a tall one (a band, a link) puts it at the pointer
        const at = (e) => {
          const r = box.getBoundingClientRect(), b = node.getBoundingClientRect();
          const pointer = !!(e && e.clientX) && b.height > 48;
          const x = e && e.clientX ? e.clientX - r.left : b.left - r.left + b.width / 2;
          const y = pointer ? e.clientY - r.top : b.top - r.top;
          const below = opts && opts.below ? opts.below() : pointer ? y : b.bottom - r.top;
          return [x, y, below];
        };
        const show = (e) => { const c = content(); if (!c) return; const [x, y, below] = at(e); api.show(x, y, c.title, c.rows, below); };
        node.addEventListener("pointerenter", show);
        node.addEventListener("pointermove", show);
        node.addEventListener("pointerleave", () => api.hide());
        node.addEventListener("focus", () => show(null));
        node.addEventListener("blur", () => api.hide());
        node.addEventListener("keydown", (e) => { if (e.key === "Escape") api.hide(); });
      },
    };
    return api;
  }

  /* ================================================================ C8 lens */
  /** Base.lens(group, onChange): a radiogroup of buttons[data-key]. Click and arrow keys pick; onChange(key, button)
   *  fires on every change (not on bind). Returns {value, set(key, silent), buttons}. */
  function lens(group, onChange) {
    const buttons = $$("button, [role=radio]", group);
    group.setAttribute("role", "radiogroup");
    let current = buttons.find((b) => b.getAttribute("aria-checked") === "true") || buttons[0];
    const paint = () => buttons.forEach((b) => {
      b.setAttribute("aria-checked", String(b === current));
      b.tabIndex = b === current ? 0 : -1;
    });
    const pick = (b, silent) => {
      if (!b || b === current) return;
      current = b;
      paint();
      if (!silent && onChange) onChange(b.dataset.key, b);
    };
    buttons.forEach((b, i) => {
      if (b.tagName === "BUTTON") b.type = "button";
      b.setAttribute("role", "radio");
      b.addEventListener("click", () => pick(b));
      b.addEventListener("keydown", (e) => {
        const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        const to = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : d ? (i + d + buttons.length) % buttons.length : null;
        if (to == null) return;
        e.preventDefault();
        buttons[to].focus();
        pick(buttons[to]);
      });
    });
    paint();
    return {
      get value() { return current && current.dataset.key; },
      set(key, silent) { pick(buttons.find((b) => b.dataset.key === String(key)), silent); },
      buttons,
    };
  }
  /** Base.applyFog(root, key): data-fog on every [data-show] element whose space-separated list lacks key. */
  function applyFog(root, key) {
    for (const n of $$("[data-show]", root)) {
      if (n.dataset.show.split(/\s+/).includes(key)) n.removeAttribute("data-fog");
      else n.setAttribute("data-fog", "");
    }
  }

  /* ================================================================ C3 clip, time-following */
  const clipCache = new WeakMap();
  let nearObs = null, seenObs = null;
  const clipOf = new WeakMap();
  function observers() {
    if (nearObs || !("IntersectionObserver" in window)) return;
    nearObs = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { clipOf.get(e.target).load(); nearObs.unobserve(e.target); }
    }, { rootMargin: "400px 0px" });
    seenObs = new IntersectionObserver((entries) => {
      for (const e of entries) clipOf.get(e.target)._visible(e.isIntersecting);
    }, { threshold: 0.25 });
  }
  /** Base.clip(div): builds div.clip[data-clip] from clips.json (idempotent). Promise of
   *  {el, video, info, load(), play(from), pause(), seek(t), follow(cb)}. Attributes: data-tag, data-outcome
   *  ("ok"|"fail"), data-start (seek there and stay paused), data-autoplay ("1" forces play-while-visible even
   *  with data-start), data-loop ("0" to stop at the end). Reduced motion: no autoplay, native controls. */
  function clip(div) {
    if (clipCache.has(div)) return clipCache.get(div);
    const p = data("clips").then((d) => {
      const info = d.clips.find((c) => c.id === div.dataset.clip);
      if (!info) throw new Error(`clips.json has no clip ${div.dataset.clip}`);
      const start = div.dataset.start != null && div.dataset.start !== "" ? parseFloat(div.dataset.start) : null;
      const autoplay = !reduced && div.dataset.autoplay !== "0" && (start == null || div.dataset.autoplay === "1");
      const tag = div.dataset.tag || info.label || info.id;
      const outcome = div.dataset.outcome || info.outcome;
      div.classList.add("clip");
      const video = el("video", {
        muted: true, playsinline: true, preload: "none", poster: info.poster,
        "aria-label": `${info.task}${info.model ? ", " + info.model : ""}, ${tag}. ${info.note || ""}`.trim(),
      });
      video.muted = true;
      video.playsInline = true;
      video.loop = div.dataset.loop !== "0";
      video.dataset.src = info.src;
      div.replaceChildren(video);
      const t = el("span", { class: "clip-tag" }, div);
      if (outcome) el("i", { class: outcome === "ok" ? "ok" : "fail", "aria-hidden": "true" }, t);
      t.appendChild(document.createTextNode(tag));
      let userPaused = !autoplay, pendingSeek = start;
      // A seek waits until its target is seekable: a server without byte ranges only allows it once buffered.
      const applySeek = () => {
        if (pendingSeek == null || video.readyState < 1) return;
        const want = clamp(pendingSeek, 0, Math.max(0, (video.duration || pendingSeek) - 0.05));
        const s = video.seekable;
        if (!s.length || s.start(0) > want || s.end(s.length - 1) < want - 0.01) return;
        video.currentTime = want;
        pendingSeek = null;
      };
      for (const e of ["loadedmetadata", "progress", "canplaythrough"]) video.addEventListener(e, applySeek);
      const ctrl = {
        el: div, video, info, start,
        load() {
          if (!video.getAttribute("src")) {
            video.preload = "auto";
            video.src = info.src;
          }
        },
        play(from) {
          ctrl.load();
          userPaused = false;
          if (from != null) { pendingSeek = from; applySeek(); }
          return video.play().catch(() => {});
        },
        pause() { userPaused = true; video.pause(); },
        seek(time) { ctrl.load(); pendingSeek = time; applySeek(); },
        follow(cb) { return follow(video, cb); },
        _visible(v) {
          if (v && autoplay && !userPaused) ctrl.play();
          else if (!v && !video.paused) video.pause();
        },
      };
      if (reduced) video.controls = true;
      else {
        const btn = el("button", { type: "button", class: "playtoggle", "aria-label": "Play" }, div);
        const icon = svg("svg", { viewBox: "0 0 16 16", "aria-hidden": "true" }, btn);
        const use = svg("use", { href: "#i-play" }, icon);
        const paint = () => {
          use.setAttribute("href", video.paused ? "#i-play" : "#i-pause");
          btn.setAttribute("aria-label", video.paused ? "Play" : "Pause");
        };
        btn.addEventListener("click", () => { if (video.paused) ctrl.play(); else ctrl.pause(); });
        video.addEventListener("play", paint);
        video.addEventListener("pause", paint);
      }
      clipOf.set(div, ctrl);
      observers();
      if (nearObs) { nearObs.observe(div); seenObs.observe(div); }
      else { ctrl.load(); if (autoplay) ctrl.play(); }
      return ctrl;
    });
    clipCache.set(div, p);
    return p;
  }
  /** Base.follow(video, cb): cb(currentTime) every frame while playing (requestVideoFrameCallback, else
   *  requestAnimationFrame), and on seeked and timeupdate. Returns a function that stops it. */
  function follow(video, cb) {
    let stopped = false, pending = false;
    const rvfc = "requestVideoFrameCallback" in HTMLVideoElement.prototype;
    const frame = () => {
      pending = false;
      if (stopped) return;
      cb(video.currentTime);
      schedule();
    };
    const schedule = () => {
      if (stopped || pending || video.paused || video.ended) return;
      pending = true;
      if (rvfc) video.requestVideoFrameCallback(frame); else requestAnimationFrame(frame);
    };
    const now = () => { if (!stopped) cb(video.currentTime); };
    const events = { play: schedule, playing: schedule, seeked: now, timeupdate: now };
    for (const [k, fn] of Object.entries(events)) video.addEventListener(k, fn);
    if (!video.paused) schedule();
    return () => {
      stopped = true;
      for (const [k, fn] of Object.entries(events)) video.removeEventListener(k, fn);
    };
  }
  /** Base.piecewise(pairs): piecewise-linear map over [[x, y], …] (clamped), with .slope(x). */
  function piecewise(pairs) {
    const xs = pairs.map((p) => p[0]), ys = pairs.map((p) => p[1]);
    const seg = (x) => {
      let i = 0;
      while (i < xs.length - 2 && x > xs[i + 1]) i++;
      return i;
    };
    const f = (x) => {
      if (x <= xs[0]) return ys[0];
      if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
      const i = seg(x);
      return ys[i] + ((x - xs[i]) / (xs[i + 1] - xs[i] || 1)) * (ys[i + 1] - ys[i]);
    };
    f.slope = (x) => { const i = seg(clamp(x, xs[0], xs[xs.length - 1])); return (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i] || 1); };
    let inv = null;
    f.invert = (y) => (inv = inv || piecewise(pairs.map(([a, b]) => [b, a])))(y);
    return f;
  }
  /** Base.syncPiecewise(master, slave, pairs, {tol, rate}): keeps slave at map(master time): its playbackRate
   *  follows the segment's slope (clamped to rate, default [0.5, 2]); it seeks only when drift exceeds tol
   *  (default 0.12 s), and seeks back when the master loops. Returns {map, stop()}. */
  function syncPiecewise(master, slave, pairs, opts) {
    const o = Object.assign({ tol: 0.12, rate: [0.5, 2] }, opts);
    const map = piecewise(pairs);
    let last = 0;
    const step = (t) => {
      const want = map(t);
      if (t + 0.25 < last) slave.currentTime = want;
      last = t;
      if (!master.paused) {
        slave.playbackRate = clamp(map.slope(t), o.rate[0], o.rate[1]);
        if (slave.paused) slave.play().catch(() => {});
      }
      if (Math.abs(slave.currentTime - want) > o.tol) slave.currentTime = want;
    };
    const stopFollow = follow(master, step);
    const onPause = () => slave.pause();
    master.addEventListener("pause", onPause);
    return { map, stop() { stopFollow(); master.removeEventListener("pause", onPause); } };
  }
  /** Base.timeScale(duration, x0, x1): t → x, with .invert(x), .k (px per second), .range. */
  function timeScale(duration, x0, x1) {
    const k = (x1 - x0) / (duration || 1);
    const f = (t) => x0 + t * k;
    f.invert = (x) => (x - x0) / k;
    f.k = k;
    f.range = [x0, x1];
    f.duration = duration;
    return f;
  }
  /** Base.sampler(track): fn(t) → every numeric (or vector) series of track interpolated at t; track.t holds the
   *  sample times. Works on tapes_th clips/rounds and tapes_syr syringes ({...series, t}). */
  function sampler(track, t0) {
    const ts = t0 || track.t;
    const keys = Object.keys(track).filter((k) => k !== "t" && Array.isArray(track[k]) && track[k].length === ts.length);
    return (t) => {
      let lo = 0, hi = ts.length - 1;
      if (t <= ts[0]) hi = 0;
      else if (t >= ts[hi]) lo = hi;
      else while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ts[m] <= t) lo = m; else hi = m; }
      const f = hi === lo ? 0 : (t - ts[lo]) / (ts[hi] - ts[lo]);
      const out = { t };
      for (const k of keys) {
        const a = track[k][lo], b = track[k][hi];
        out[k] = Array.isArray(a) ? a.map((v, j) => v + (b[j] - v) * f) : a == null || b == null ? null : a + (b - a) * f;
      }
      return out;
    };
  }

  /* ================================================================ C4 episode ribbon, C5 marks */
  const FIXED = new Set(["raised", "unreached", "generated", "unreported", "still"]);
  const ROBOT_STILL = / \(robot still\)$/;
  const END_FONT = MONO(11.5);
  const scrubOwner = new WeakMap();
  const endWidth = (e) => (e.lead ? textWidth(e.lead, END_FONT) + 6 : 0) + 22 + textWidth(e.text || "", END_FONT);
  /** Base.ribbon(svg, opts): one episode as chips on a time (or program-order) axis, with ✕ / ◆ marks and blame
   *  arcs. See BASE_NOTES.md for every option. Returns {setTime(t), drawArc({animate}), setFog(fn), setCause(spec),
   *  update(opts), setStages(stages, still), on(name, fn), off(name, fn), layout, redraw(), destroy()}; events "seek"
   *  (t), "chip" (stage, i), "hover" (stage|null), "render" (layout). */
  function ribbon(root, opts) {
    retire(root);
    const o = Object.assign({ mode: "timed", stages: [], still: [], ticks: false, marks: {}, arc: null, motion: null,
      end: null, stillMinW: 4, groups: true, glyphOnly: false, readout: null, minChip: 18, rows: "auto" }, opts);
    root.classList.add("ribbon");
    if (!root.getAttribute("role")) root.setAttribute("role", "img");
    const scrub = o.scrub || (root.nextElementSibling && root.nextElementSibling.matches("input.scrub") ? root.nextElementSibling : null);
    let wrap = root.parentElement;
    if (!wrap.classList.contains("ribbon-wrap")) {
      wrap = el("div", { class: "ribbon-wrap" });
      root.parentNode.insertBefore(wrap, root);
      wrap.appendChild(root);
      if (scrub) wrap.appendChild(scrub);
    }
    const ev = emitter();
    const tip = tooltip(wrap);
    const ac = new AbortController();
    let t = null, fogFn = null, layout = null, hover = null, focusI = 0, keepFog = true;

    // a custom title is the whole row text; otherwise the times (timed) and the status
    const chipText = (s, timed) => s.title || [timed ? `${s.t0.toFixed(2)}–${s.t1.toFixed(2)} s` : null, s.status].filter(Boolean).join(" · ") || s.kind || "";
    const svgTop = () => root.getBoundingClientRect().top - wrap.getBoundingClientRect().top;
    const belowMarks = (row) => svgTop() + layout.rowsY[row].yb + 22;

    function draw(w) {
      const fogged = keepFog && layout ? new Set(layout.chips.filter((c) => c.g.hasAttribute("data-fog")).map((c) => c.i)) : new Set();
      keepFog = true;
      root.replaceChildren();
      const timed = o.mode === "timed";
      const phone = isPhone();
      const glyphOnly = phone || !!o.glyphOnly;
      const groupH = o.groups === "always" || (o.groups && !phone) ? 16 : 0;
      const chipH = glyphOnly ? 22 : 26;
      const laneH = o.motion ? 18 : 0;
      const ends = [].concat(o.end || []).filter(Boolean);
      const endW = ends.length ? Math.max(...ends.map(endWidth)) : 0;
      const n = o.stages.length, gap = 4, x0 = 1;
      // ordinal chips never go below minChip: they wrap onto more rows instead
      let endBelow = !!ends.length && endW > w * 0.32, x1 = w - 1, perRow = Math.max(1, n), rows = 1;
      const fitRows = () => {
        x1 = w - 1 - (ends.length && !endBelow ? endW + 10 : 0);
        perRow = Math.max(1, n);
        rows = 1;
        if (timed || !n) return;
        const fits = Math.max(1, Math.floor((x1 - x0 + gap) / (o.minChip + gap)));
        perRow = Math.ceil(n / (o.rows === "auto" ? Math.ceil(n / fits) : Math.max(1, Math.round(+o.rows || 1))));
        rows = Math.ceil(n / perRow);
      };
      fitRows();
      if (rows > 1 && ends.length && !endBelow) { endBelow = true; fitRows(); }
      const x = timed ? timeScale(o.duration, x0, x1) : null;
      const cw = n ? (x1 - x0 - gap * (perRow - 1)) / perRow : 0;
      const chips = o.stages.map((s, i) => {
        if (!timed) return { s, i, row: Math.floor(i / perRow), x: x0 + (i % perRow) * (cw + gap), w: cw };
        const a = x(s.t0);
        return { s, i, row: 0, x: a, w: Math.max(x(s.t1) - a, 8) };
      });
      const stills = timed ? o.still.map((s) => {
        let a = x(s.t0), b = x(s.t1);
        if (b - a < o.stillMinW) { const m = (a + b) / 2; a = m - o.stillMinW / 2; b = m + o.stillMinW / 2; }
        return { s, row: 0, x: a, w: b - a };
      }) : [];
      const L = { w, x, x0, x1, chipH, chips, stills, phone, glyphOnly, endW, endBelow, timed, rows, groupH, laneH };
      const plan = planMarks(L);
      placeRows(L, plan.bands);
      layout = L;

      const defs = svg("defs", {}, root);
      L.washG = svg("g", { class: "wash" }, root);
      const groupsG = svg("g", { class: "groups" }, root);
      const stillG = svg("g", { class: "lane-still" }, root);
      const chipsG = svg("g", { class: "lane-steps" }, root);
      const ticksG = svg("g", { class: "ticks" }, root);
      const laneG = o.motion ? svg("g", { class: "lane-motion" }, root) : null;
      L.marksG = svg("g", { class: "marks" }, root);
      const axisG = svg("g", { class: "axis" }, root);
      L.defs = defs;

      // group labels per row: a run of chips of one group (or a wide still stretch), up to the next label; a label
      // that would keep fewer than 4 characters is dropped, not cut to a fragment
      if (groupH) for (let r = 0; r < rows; r++) {
        const labels = [];
        for (const c of chips) {
          if (c.row !== r || !c.s.group) continue;
          const prev = labels[labels.length - 1];
          if (prev && prev.group === c.s.group && prev.kind === "group") { prev.x1 = c.x + c.w; continue; }
          labels.push({ kind: "group", group: c.s.group, text: c.s.group, x: c.x });
        }
        if (r === 0) for (const st of stills) if (st.w >= 30) labels.push({ kind: "still", text: st.s.label.replace(ROBOT_STILL, ""), x: st.x });
        labels.sort((a, b) => a.x - b.x);
        labels.forEach((l, i) => {
          const room = (i + 1 < labels.length ? labels[i + 1].x : w) - l.x - 8;
          const text = fit(l.text, room, SANS(11), 4);
          if (text) svg("text", { class: "group", x: l.x + 1, y: L.rowsY[r].top + 11, text }, groupsG);
        });
      }

      for (const st of stills) {
        const y = L.rowsY[0].chipY;
        const g = svg("g", { class: "chip still", "data-state": "still" }, stillG);
        svg("rect", { class: "chip-box", x: st.x, y, width: st.w, height: chipH, rx: Math.min(6, st.w / 2) }, g);
        const label = st.s.label.replace(ROBOT_STILL, "");
        if (!glyphOnly && st.w > textWidth(label, MONO(11.5)) + 12)
          svg("text", { class: "chip-label", x: st.x + 6, y: y + chipH / 2 + 4, text: label }, g);
        svg("title", { text: `${st.s.label} · ${st.s.t0.toFixed(2)}–${st.s.t1.toFixed(2)} s · ${st.s.nodes.join(", ")}` }, g);
        st.g = g;
      }

      // chips sit in the DOM narrowest last, so a chip held at the minimum width is never covered by its neighbour;
      // keyboard order stays in program order through the roving tabindex below
      const interactive = !scrub || rows > 1;
      focusI = clamp(focusI, 0, Math.max(0, n - 1));
      const order = timed ? chips.slice().sort((a, b) => b.w - a.w) : chips;
      for (const c of order) {
        const s = c.s, y = c.y;
        const g = svg("g", {
          class: "chip", "data-node": s.node, "data-kind": s.kind, "data-state": s.state || "idle",
          "data-show": s.show ? [].concat(s.show).join(" ") : null, "data-i": c.i,
        }, chipsG);
        svg("rect", { class: "chip-box", x: c.x, y, width: c.w, height: chipH, rx: Math.min(6, c.w / 2) }, g);
        c.sweep = svg("rect", { class: "chip-sweep", x: c.x, y, width: 0, height: chipH, rx: Math.min(6, c.w / 2) }, g);
        const label = s.label || s.node;
        const withLabel = !glyphOnly && c.w >= textWidth(label, MONO(11.5)) + 27;
        const gs = Math.min(12, c.w - 6);
        if (s.kind && gs >= 8) {
          const gx = withLabel ? c.x + 6 : c.x + c.w / 2 - gs / 2;
          svg("use", { class: "chip-kind", href: "#k-" + s.kind, x: gx, y: y + chipH / 2 - gs / 2, width: gs, height: gs }, g);
        }
        if (withLabel) svg("text", { class: "chip-label", x: c.x + 21, y: y + chipH / 2 + 4, text: label }, g);
        if (s.dot) svg("circle", { class: "chip-dot", cx: c.x + c.w - 5, cy: y + chipH - 5, r: 2.6, style: "fill:currentColor" }, g);
        if (s.edited) {
          const b = svg("g", { class: "edit-badge" }, g);
          svg("circle", { cx: c.x + c.w - 2, cy: y + 1, r: 6.5 }, b);
          svg("use", { href: "#i-pencil", x: c.x + c.w - 6.5, y: y - 3.5, width: 9, height: 9 }, b);
        }
        svg("title", { text: s.title ? `${s.node} · ${s.title}` : [s.node, chipText(s, timed)].filter(Boolean).join(" · ") }, g);
        c.g = g;
        if (interactive) wireChip(c);
      }

      // ✓ at a chip's top-right corner, but a chip under 16 px has none of its own: a run of them in one group shares
      // one at the run's right end, and ✓s closer than 20 px merge into the later one, so short steps never pile up
      // ticks. A ✓ shows once every chip it stands for has ended.
      L.tickGroups = [];
      if (o.ticks) {
        const ticks = [];
        let run = null;
        for (const c of chips) {
          if (c.w >= 16) { run = null; ticks.push({ chips: [c] }); continue; }
          if (run && run.group === c.s.group && run.last === c.i - 1) { run.chips.push(c); run.last = c.i; continue; }
          ticks.push(run = { group: c.s.group, chips: [c], last: c.i });
        }
        for (const tk of ticks) tk.x = Math.max(...tk.chips.map((c) => c.x + c.w));
        ticks.sort((a, b) => a.x - b.x);
        for (const tk of ticks) {
          const prev = L.tickGroups[L.tickGroups.length - 1], row = tk.chips[0].row;
          if (prev && prev.row === row && tk.x - prev.x < 20) { prev.chips.push(...tk.chips); prev.x = tk.x; continue; }
          L.tickGroups.push({ chips: tk.chips.slice(), x: tk.x, row });
        }
        for (const tg of L.tickGroups) {
          tg.t1 = Math.max(...tg.chips.map((c) => c.s.t1));
          tg.g = svg("g", { class: "tick-group" }, ticksG);
          mark(tg.g, "m-check", tg.x - 2, L.rowsY[tg.row].chipY, { size: 11, cls: "glyph mark-ok", group: "chip-badge" });
        }
      }

      if (laneG) {
        const byChip = new Map();
        for (const m of o.motion) {
          const c = m.i != null ? chips[m.i] : chips.find((ch) => ch.s.node === m.node);
          if (!c) continue;
          if (!byChip.has(c)) byChip.set(c, []);
          byChip.get(c).push(m);
        }
        for (const [c, list] of byChip) {
          const laneY = L.rowsY[c.row].laneY;
          const mw = (c.w - 2 * (list.length - 1)) / list.length;
          list.forEach((m, j) => {
            const mx = timed && m.t0 != null ? x(m.t0) : c.x + j * (mw + 2);
            const mww = timed && m.t0 != null ? Math.max(x(m.t1) - mx, 3) : mw;
            const g = svg("g", { class: "motion", "data-show": m.show ? [].concat(m.show).join(" ") : null }, laneG);
            svg("rect", { class: "motion-span", x: mx, y: laneY, width: mww, height: laneH, rx: 4 }, g);
            const lab = fit(m.label || m.tool || "", mww - 8, MONO(10));
            if (lab && !glyphOnly) svg("text", { class: "motion-label", x: mx + 4, y: laneY + laneH / 2 + 3.5, text: lab }, g);
            svg("title", { text: [m.tool, m.node].filter(Boolean).join(" · ") }, g);
          });
        }
      }

      if (timed) {
        const y = L.rowsY[0].chipY + chipH;
        for (let s = 5; s < o.duration; s += 5) svg("line", { x1: x(s), x2: x(s), y1: y, y2: y + 3 }, axisG);
      }
      for (const c of chips) if (fogged.has(c.i)) c.g.setAttribute("data-fog", "");
      L.playhead = svg("line", { class: "playhead", x1: 0, x2: 0, y1: 0, y2: 0, style: "display:none" }, root);
      L.endsG = svg("g", { class: "ends" }, root);
      drawMarks(L, plan);
      drawEnds(L);
      if (scrub) placeScrub(L);
      if (fogFn) applyFogFn();
      paintTime();
      ev.emit("render", L);
    }

    /* rows top to bottom: group labels, chips, the motion lane, then a band for the marks, whose height the marks
       decide (an arc's dip, the arc and wash labels) */
    function placeRows(L, bands) {
      L.rowsY = [];
      let top = 0;
      for (let r = 0; r < L.rows; r++) {
        const chipY = top + L.groupH + 1;
        const laneY = chipY + L.chipH + 4;
        const yb = L.laneH ? laneY + L.laneH : chipY + L.chipH;
        L.rowsY.push({ top, chipY, laneY, yb });
        top = yb + bands[r] + 6;
      }
      L.bands = bands;
      L.chipY = L.rowsY[0].chipY;
      L.yb = L.rowsY[0].yb;
      for (const c of L.chips) c.y = L.rowsY[c.row].chipY;
    }

    // a mark's place: a time, a time span, or the chips of a node, group or index (on the first of their rows)
    function spanOf(L, ref) {
      if (ref == null) return null;
      if (ref.t != null) return L.x ? { row: 0, a: L.x(ref.t), b: L.x(ref.t) } : null;
      if (ref.t0 != null && L.x) return { row: 0, a: L.x(ref.t0), b: L.x(ref.t1) };
      const cs = L.chips.filter((c) => (ref.node != null && c.s.node === ref.node) || (ref.group != null && c.s.group === ref.group) || (ref.i != null && c.i === ref.i));
      if (!cs.length) return null;
      const row = cs[0].row, inRow = cs.filter((c) => c.row === row);
      return { row, a: Math.min(...inRow.map((c) => c.x)), b: Math.max(...inRow.map((c) => c.x + c.w)) };
    }

    function planMarks(L) {
      const m = o.marks || {}, arc = o.arc;
      const seens = [].concat(m.seen || []).map((ref) => {
        const p = spanOf(L, ref);
        return p && { ref, row: p.row, x: (p.a + p.b) / 2 };
      });
      const causes = [].concat(m.cause || []).map((ref) => {
        const spanned = ref.t0 != null || ref.node != null || ref.group != null || ref.i != null;
        const p = spanOf(L, ref);
        return p && { ref, row: p.row, a: p.a, b: p.b, x: (p.a + p.b) / 2, bracket: spanned && p.b - p.a > 10 };
      });
      const pos = (p) => p.row * 1e6 + p.x;
      // unless told otherwise, each ◆ joins the first ✕ at or after it (the ✕ its consequence showed up at)
      const firstSeenAfter = (c) => {
        if (seens.length === 1) return 0;
        const i = seens.findIndex((s) => s && pos(s) >= pos(c) - 1);
        return i >= 0 ? i : seens.length - 1;
      };
      const links = !arc ? [] : m.arcs ? m.arcs.map((a) => [a.from, a.to, a.style])
        : causes.map((c, ci) => [c && (c.ref.seen != null ? c.ref.seen : firstSeenAfter(c)), ci]);
      const bands = Array.from({ length: L.rows }, (_, r) => (r === L.rows - 1 ? 22 : 0));
      for (const p of seens.concat(causes)) if (p) bands[p.row] = Math.max(bands[p.row], 22);
      const deepest = new Array(L.rows).fill(0);
      const pairs = links.map(([si, ci, style]) => ({ s: seens[si], c: causes[ci], style: style || arc.style || "solid" }))
        .filter((p) => p.s && p.c)
        .map((p) => {
          // an arc to an earlier row leaves its row at the left edge and comes back in at the right, like wrapped text
          const segs = [];
          if (p.s.row === p.c.row) segs.push({ row: p.s.row, from: p.s.x, to: p.c.x });
          else {
            const back = p.c.row < p.s.row, out = back ? L.x0 : L.x1, into = back ? L.x1 : L.x0;
            segs.push({ row: p.s.row, from: p.s.x, to: out });
            for (let r = p.s.row + (back ? -1 : 1); r !== p.c.row; r += back ? -1 : 1) segs.push({ row: r, from: into, to: out });
            segs.push({ row: p.c.row, from: into, to: p.c.x });
          }
          for (const sg of segs) {
            const span = Math.abs(sg.to - sg.from);
            sg.depth = p.style === "same" || span < 4 ? 0 : clamp(span * 0.08, 5, 16);
            deepest[sg.row] = Math.max(deepest[sg.row], sg.depth);
            bands[sg.row] = Math.max(bands[sg.row], 23 + sg.depth);
          }
          p.segs = segs;
          p.len = segs.reduce((a, sg) => a + Math.abs(sg.to - sg.from), 0);
          return p;
        });
      const plan = { seens, causes, pairs, bands, label: null, wash: null, washLabel: null };
      const font = SANS(12, 600);
      if (arc && arc.label && pairs.length) {
        const longest = pairs.reduce((a, b) => (b.len > a.len ? b : a));
        const seg = longest.segs[longest.segs.length - 1];
        const base = 32 + deepest[seg.row];
        const lines = balanceLines(arc.label, L.w - 4, font);
        plan.label = { row: seg.row, mid: (seg.from + seg.to) / 2, base, lines };
        bands[seg.row] = Math.max(bands[seg.row], base + (lines.length - 1) * 14 + 5);
      }
      const wash = Array.isArray(m.wash) ? { t0: m.wash[0], t1: m.wash[1] } : m.wash;
      if (wash) {
        const a = L.x ? L.x(wash.t0) : L.x0, b = L.x ? L.x(wash.t1) : L.x1;
        const rows = L.timed ? [0] : Array.from({ length: L.rows }, (_, r) => r);
        plan.wash = { a, b, rows };
        // the wash's words get their own line under the marks row, clear of the ✕
        const label = wash.label || (arc && arc.label && !pairs.length ? arc.label : null);
        if (label) {
          const row = rows[rows.length - 1];
          const lines = balanceLines(label, L.w - 4, font);
          const base = bands[row] + 12;
          plan.washLabel = { row, mid: (a + b) / 2, base, lines };
          bands[row] = base + (lines.length - 1) * 14 + 5;
        }
      }
      return plan;
    }

    function drawMarks(L, plan) {
      const marksG = L.marksG;
      marksG.replaceChildren();
      L.washG.replaceChildren();
      $$("mask", L.defs).forEach((mk) => mk.remove());
      const R = L.rowsY;
      if (plan.wash) for (const r of plan.wash.rows)
        svg("rect", { class: "cause-wash", x: plan.wash.a, y: R[r].chipY - 3, width: plan.wash.b - plan.wash.a, height: R[r].yb - R[r].chipY + 6, rx: 6 }, L.washG);
      for (const c of plan.causes) {
        if (!c) continue;
        const yb = R[c.row].yb;
        const g = svg("g", { class: "cause" }, marksG);
        if (c.bracket) svg("path", { class: "cause-bracket", d: `M${c.a + 1},${yb + 2} V${yb + 6} H${c.b - 1} V${yb + 2}` }, g);
        mark(g, "m-cause", c.x, yb + 12, { size: 12, cls: "mark-cause" });
        const ref = c.ref;
        const title = ref.title || ref.node || (ref.t0 != null ? `${ref.t0.toFixed(2)}–${ref.t1.toFixed(2)} s` : "");
        if (title) {
          const hit = svg("rect", { class: "cause-hit", x: Math.min(c.a, c.x - 7), y: yb, width: Math.max(c.b - c.a, 14), height: 20 }, g);
          svg("title", { text: title }, hit);
          tip.bind(hit, () => ({ title: "Where it was decided", rows: [{ text: title }] }));
        }
      }
      for (const s of plan.seens) if (s) mark(marksG, "m-seen", s.x, R[s.row].yb + 12, { size: 12, cls: "mark-seen", title: s.ref.title || "Where the failure is seen" });
      for (const p of plan.pairs) {
        const d = p.segs.map((sg) => {
          const y = R[sg.row].yb + 19;
          if (!sg.depth) return `M${sg.from},${y} L${p.style === "same" ? sg.from : sg.to},${y}`;
          return `M${sg.from},${y} Q${(sg.from + sg.to) / 2},${y + sg.depth * 2} ${sg.to},${y}`;
        }).join(" ");
        const last = p.segs[p.segs.length - 1];
        // the arc is drawn through a mask, so animating the mask reveals a dashed arc as well as a solid one
        const id = nextId("arcmask");
        const mask = svg("mask", { id, maskUnits: "userSpaceOnUse", x: 0, y: 0, width: L.w, height: 10000 }, L.defs);
        const reveal = svg("path", { class: "arc-reveal", d, style: "fill:none;stroke:#fff;stroke-width:12" }, mask);
        const path = svg("path", {
          class: "blame-arc drawn", d, mask: `url(#${id})`, "marker-end": last.depth ? "url(#arc-head)" : null,
          "stroke-dasharray": p.style === "dashed" || p.style === "inferred" ? "4 3" : null, "data-style": p.style,
        }, marksG);
        path._reveal = reveal;
      }
      const font = SANS(12, 600);
      for (const [lab, cls] of [[plan.label, "arc-label"], [plan.washLabel, "wash-label"]]) {
        if (!lab) continue;
        const tw = Math.max(...lab.lines.map((l) => textWidth(l, font)));
        const cx = clamp(lab.mid, tw / 2 + 2, L.w - tw / 2 - 2);
        lab.lines.forEach((line, i) => svg("text", { class: cls, x: cx, y: R[lab.row].yb + lab.base + i * 14, "text-anchor": "middle", text: line }, marksG));
      }
    }

    /* the end badges: beside the chips when they fit, stacked; otherwise on their own rows under the marks */
    function drawEnds(L) {
      L.endsG.replaceChildren();
      const ends = [].concat(o.end || []).filter(Boolean);
      const last = L.rowsY[L.rows - 1];
      let h = last.yb + L.bands[L.rows - 1];
      const badge = (e, ex, y, lines) => {
        const ok = e.kind === "ok";
        const g = svg("g", { class: "end " + (ok ? "ok" : "fail") }, L.endsG);
        let gx = ex;
        if (e.lead) {
          svg("text", { class: "end-text end-lead", x: ex, y: y + 4, text: e.lead }, g);
          gx += textWidth(e.lead, END_FONT) + 6;
        }
        mark(g, ok ? "m-ok" : "m-seen", gx + 7, y, { size: 13, cls: "glyph " + (ok ? "mark-ok" : "mark-seen") });
        lines.forEach((line, i) => svg("text", { class: "end-text", x: gx + 18, y: y + 4 + i * 15, text: line }, g));
      };
      if (!L.endBelow) {
        ends.forEach((e, i) => badge(e, L.x1 + 10, L.chipY + L.chipH / 2 + (i - (ends.length - 1) / 2) * 15, [e.text || ""]));
      } else if (ends.length) {
        // right-aligned as one column, so the glyphs of a list of badges line up
        const laid = ends.map((e) => {
          const leadW = e.lead ? textWidth(e.lead, END_FONT) + 6 : 0;
          const lines = wrapLines(e.text || "", L.w - 22 - leadW, END_FONT);
          return { e, lines, w: leadW + 20 + Math.max(...lines.map((l) => textWidth(l, END_FONT))) };
        });
        const ex = Math.max(0, L.w - Math.max(...laid.map((b) => b.w)));
        let y = h + 9;
        for (const b of laid) {
          badge(b.e, ex, y, b.lines);
          y += b.lines.length * 15 + 3;
        }
        h = y - 7;
      }
      size(root, L.w, Math.ceil(h));
    }

    /* marks alone, on setCause: chips keep their fog, states and fade transitions; a wrapped row whose band changes
       height moves the rows under it, so that case lays the whole ribbon out again */
    function remark() {
      const L = layout;
      const plan = planMarks(L);
      if (plan.bands.some((b, r) => r < L.rows - 1 && b !== L.bands[r])) return draw(L.w);
      L.bands = plan.bands;
      drawMarks(L, plan);
      drawEnds(L);
    }

    function choose(c) {
      if (o.readout) o.readout.textContent = [c.s.node, chipText(c.s, layout.timed)].filter(Boolean).join(" · ");
      ev.emit("chip", c.s, c.i);
    }
    function wireChip(c) {
      const g = c.g;
      g.setAttribute("tabindex", c.i === focusI ? "0" : "-1");
      tip.bind(g, () => ({ title: c.s.node, rows: [{ text: chipText(c.s, layout.timed) }] }), { below: () => belowMarks(c.row) });
      g.addEventListener("click", () => {
        choose(c);
        // a wrapped ribbon's scrub takes keys only, so its chips seek
        if (scrub) { api.setTime(layout.timed ? c.s.t0 : c.i); ev.emit("seek", t); }
      });
      g.addEventListener("focus", () => {
        focusI = c.i;
        for (const ch of layout.chips) ch.g.setAttribute("tabindex", ch.i === focusI ? "0" : "-1");
      });
      g.addEventListener("keydown", (e) => {
        const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        const to = e.key === "Home" ? 0 : e.key === "End" ? layout.chips.length - 1 : d ? clamp(c.i + d, 0, layout.chips.length - 1) : null;
        if (to != null) { e.preventDefault(); layout.chips[to].g.focus(); return; }
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); g.dispatchEvent(new MouseEvent("click")); }
      });
      g.addEventListener("pointerenter", () => ev.emit("hover", c.s));
      g.addEventListener("pointerleave", () => ev.emit("hover", null));
    }

    // the scrub is wired once per ribbon; a later ribbon on the same input takes it over
    if (scrub) {
      const prev = scrubOwner.get(scrub);
      if (prev) prev.abort();
      scrubOwner.set(scrub, ac);
      const sig = { signal: ac.signal };
      const go = (v) => { api.setTime(v); ev.emit("seek", v); };
      // where chips overlap at the minimum width, the narrowest (drawn on top) wins
      const at = (e, list) => {
        const px = e.clientX - scrub.getBoundingClientRect().left + layout.x0;
        return list.filter((c) => px >= c.x && px <= c.x + c.w).sort((a, b) => a.w - b.w)[0] || null;
      };
      scrub.addEventListener("input", () => go(+scrub.value), sig);
      scrub.addEventListener("keydown", (e) => {
        const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
        if (!d) return;
        e.preventDefault();
        const stepT = layout.timed ? (e.shiftKey ? 1 : 0.1) : 1;
        go(clamp((t == null ? 0 : t) + d * stepT, 0, +scrub.max));
      }, sig);
      scrub.addEventListener("pointermove", (e) => {
        if (!layout) return;
        const c = at(e, layout.chips), st = !c && at(e, layout.stills);
        const px = e.clientX - wrap.getBoundingClientRect().left, top = svgTop() + layout.chipY;
        if (c) tip.show(px, top, c.s.node, [{ text: chipText(c.s, layout.timed) }], belowMarks(0));
        else if (st) tip.show(px, top, st.s.label, [{ text: st.s.nodes.join(", ") }], belowMarks(0));
        else tip.hide();
        const s = c ? c.s : null;
        if (s !== hover) { hover = s; ev.emit("hover", s); }
      }, sig);
      scrub.addEventListener("pointerleave", () => { tip.hide(); if (hover) { hover = null; ev.emit("hover", null); } }, sig);
      scrub.addEventListener("pointerup", (e) => { const c = layout && at(e, layout.chips); if (c) choose(c); }, sig);
    }
    function placeScrub(L) {
      scrub.min = 0;
      scrub.max = L.timed ? o.duration : Math.max(0, o.stages.length - 1);
      scrub.step = L.timed ? 0.01 : 1;
      if (!scrub.getAttribute("aria-label")) scrub.setAttribute("aria-label", "Scrub the episode");
      Object.assign(scrub.style, {
        left: L.x0 + "px", width: L.x1 - L.x0 + "px", top: svgTop() + L.chipY + "px", height: L.chipH + "px",
        pointerEvents: L.rows > 1 ? "none" : "",
      });
    }

    function paintTime() {
      const L = layout;
      if (!L) return;
      const ph = L.playhead;
      if (t == null || (L.timed && !L.x)) { ph.style.display = "none"; return; }
      const at = L.timed ? null : L.chips[Math.round(t)];
      const px = L.timed ? L.x(t) : at ? at.x + at.w / 2 : null;
      if (px != null) {
        const y = L.rowsY[at ? at.row : 0].chipY;
        setAttrs(ph, { x1: px, x2: px, y1: y - 3, y2: y + L.chipH + 3 });
        ph.style.display = "";
      }
      for (const c of L.chips) {
        const s = c.s;
        const state = s.state || "idle";
        c.g.classList.toggle("ticked", !!o.ticks && L.timed && t >= s.t1);
        if (FIXED.has(state)) continue;
        const running = L.timed ? t >= s.t0 && t < s.t1 : Math.round(t) === c.i;
        c.g.setAttribute("data-state", running ? "running" : state);
        c.sweep.setAttribute("width", running && L.timed ? clamp((t - s.t0) / (s.t1 - s.t0 || 1), 0, 1) * c.w : 0);
      }
      for (const tg of L.tickGroups) tg.g.classList.toggle("ticked", L.timed && t >= tg.t1);
      if (scrub && document.activeElement !== scrub) scrub.value = t;
    }
    function applyFogFn() {
      for (const c of layout.chips) {
        if (fogFn(c.s, c.i)) c.g.setAttribute("data-fog", ""); else c.g.removeAttribute("data-fog");
      }
    }

    const api = {
      setTime(tt) { t = tt; paintTime(); return api; },
      drawArc(opt) {
        const animate = opt && opt.animate && !reduced;
        if (!layout) return api;
        for (const p of $$(".blame-arc", layout.marksG)) {
          const reveal = p._reveal;
          p.classList.remove("drawn");
          if (animate) {
            const len = Math.max(1, p.getTotalLength());
            reveal.style.transition = "none";
            reveal.style.strokeDasharray = `${len} ${len}`;
            reveal.style.strokeDashoffset = String(len);
            reveal.getBoundingClientRect();
            reveal.style.transition = "stroke-dashoffset var(--t-arc) var(--ease)";
            reveal.style.strokeDashoffset = "0";
          } else {
            reveal.style.transition = "none";
            reveal.style.strokeDashoffset = "0";
          }
          p.getBoundingClientRect();
          p.classList.add("drawn");
        }
        return api;
      },
      setFog(fn) { fogFn = fn; if (layout && fn) applyFogFn(); return api; },
      setCause(next) {
        o.marks = Object.assign({}, o.marks, pick(next, ["cause", "seen", "wash", "arcs"]), next.marks);
        if ("arc" in next) o.arc = next.arc;
        if (layout) remark();
        return api;
      },
      /** any option, merged; new stages drop the fog carried over from Base.applyFog (re-apply the lens) */
      update(next) {
        if ("stages" in next) keepFog = false;
        Object.assign(o, next);
        if (layout) redraw();
        return api;
      },
      setStages(stages, still) { return api.update(still ? { stages, still } : { stages }); },
      on(name, fn) { ev.on(name, fn); return api; },
      off(name, fn) { ev.off(name, fn); return api; },
      get layout() { return layout; },
      redraw: () => redraw(),
      destroy() {
        redraw.stop();
        ac.abort();
        if (scrub && scrubOwner.get(scrub) === ac) scrubOwner.delete(scrub);
        tip.hide();
        root.replaceChildren();
        layout = null;
        if (live.get(root) === api) live.delete(root);
      },
    };
    const redraw = mount(root, draw);
    live.set(root, api);
    return api;
  }
  function pick(obj, keys) {
    const out = {};
    for (const k of keys) if (k in obj) out[k] = obj[k];
    return out;
  }

  /* ================================================================ C6 pose tape */
  /* Liang–Barsky: does segment a→b cross the rectangle [x0, x1] × [y0, y1]? */
  function segHitsRect(ax, ay, bx, by, x0, y0, x1, y1) {
    let lo = 0, hi = 1;
    const dx = bx - ax, dy = by - ay;
    for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
      if (p === 0) { if (q < 0) return false; continue; }
      const r = q / p;
      if (p < 0) { if (r > hi) return false; lo = Math.max(lo, r); } else { if (r < lo) return false; hi = Math.min(hi, r); }
    }
    return true;
  }
  /** Base.tape(svg, {x, duration, series:[{t, v, cls}], yDomain, yLabels:[{v, text}], band:[v0, v1], endLabel,
   *  height}): a value over time under a ribbon. x: a ribbon handle (shares its time axis), a timeScale, or
   *  omitted (duration across the full width). A value outside yDomain runs dashed along the edge it left by, with a
   *  chevron where it left. Returns {setTime(t), update(opts), redraw(), destroy()}. */
  function tape(root, opts) {
    retire(root);
    const o = Object.assign({ series: [], band: null, endLabel: null, yLabels: [] }, opts);
    root.classList.add("tape");
    const rib = o.x && typeof o.x.on === "function" ? o.x : null;
    let t = null, L = null;
    function draw(w) {
      root.replaceChildren();
      const all = o.series.flatMap((s) => s.v.filter((v) => v != null));
      const [v0, v1] = o.yDomain || [Math.min(...all), Math.max(...all)];
      const lo = Math.min(v0, v1), hi = Math.max(v0, v1);
      const h = o.height || (isPhone() ? 56 : 64);
      const X = rib ? rib.layout && rib.layout.x : typeof o.x === "function" ? o.x : timeScale(o.duration, 1, w - 60);
      if (!X) return;
      const [xa, xb] = X.range;
      const top = 6, bot = h - 6;
      const Y = (v) => bot - ((clamp(v, lo, hi) - v0) / (v1 - v0 || 1)) * (bot - top);
      if (o.band) svg("rect", { class: "goal-band", x: xa, width: xb - xa, y: Y(Math.max(...o.band)), height: Math.abs(Y(o.band[0]) - Y(o.band[1])) }, root);
      svg("line", { class: "tape-base", x1: xa, x2: xb, y1: bot + 0.5, y2: bot + 0.5 }, root);
      const segs = [], blocked = [];   // every drawn segment and mark, so the end label can keep clear of them
      const lines = o.series.map((s) => {
        const cls = s.cls ? " " + s.cls : "";
        const { inside, outside, exits } = trace(s, X, Y, lo, hi, segs);
        svg("path", { class: "tape-line" + cls, d: inside }, root);
        if (outside) svg("path", { class: "tape-line tape-clipped" + cls, d: outside }, root);
        for (const e of exits) {
          const y = e.up ? top : bot, k = e.up ? 1 : -1;
          svg("path", { class: "tape-over" + cls, d: `M${e.x - 4},${y + 2 * k} L${e.x},${y - 3 * k} L${e.x + 4},${y + 2 * k}` }, root);
          blocked.push([e.x - 5, y - 4, e.x + 5, y + 4]);
        }
        return { s, f: sampler({ t: s.t, v: s.v }) };
      });
      const unitFont = MONO(10.5);
      for (const l of o.yLabels) blocked.push([xa + 3, Y(l.v) - 13, xa + 3 + textWidth(l.text, unitFont), Y(l.v)]);
      for (const l of o.yLabels) svg("text", { class: "tape-unit", x: xa + 3, y: Y(l.v) - 3, text: l.text }, root);
      if (o.endLabel && lines.length) {
        // the free spot nearest the series' last point: right of it, else anywhere left of it inside the tape
        const s = lines[0].s;
        let li = s.v.length - 1;
        while (li > 0 && s.v[li] == null) li--;
        const ex = X(s.t[li]), ey = Y(s.v[li]);
        const tw = textWidth(o.endLabel, "600 16px 'Barlow Condensed'"), th = 12;
        const free = ([x, y]) => !segs.some((g) => segHitsRect(...g, x - 4, y - th - 2, x + tw + 6, y + 3))
          && !blocked.some((b) => x < b[2] && x + tw > b[0] && y - th < b[3] && y > b[1]);
        const right = ex + 6 + tw <= w ? [ex + 6, ey + 5] : null;
        const left = [];
        for (let dx = 6; ex - dx - tw >= xa; dx += 6) for (let y = top + th; y <= bot; y += 3) left.push([ex - dx - tw, y]);
        const dist = ([x, y]) => Math.hypot(x + tw / 2 - ex, y - th / 2 - ey);
        left.sort((a, b) => dist(a) - dist(b));
        const [lx, ly] = (right && free(right) ? right : left.find(free)) || [Math.max(xa, ex - 6 - tw), ey < h / 2 ? ey + 17 : ey - 6];
        svg("text", { class: "tape-end", x: lx, y: ly, text: o.endLabel }, root);
      }
      const heads = lines.map((l) => svg("circle", { class: "tape-head" + (l.s.cls ? " " + l.s.cls : ""), r: 3.5, cx: -10, cy: -10 }, root));
      const ph = svg("line", { class: "playhead", y1: top - 4, y2: bot + 2, style: "display:none" }, root);
      size(root, w, h);
      L = { X, Y, lines, heads, ph };
      paint();
    }
    /* one series as two paths: the part inside [lo, hi], and the parts outside it drawn along the edge they left by */
    function trace(s, X, Y, lo, hi, segs) {
      const side = (v) => (v > hi ? 1 : v < lo ? -1 : 0);
      const pts = [];
      s.t.forEach((tt, i) => {
        const v = s.v[i];
        if (v == null) { pts.push(null); return; }
        const px = X(tt), prev = pts[pts.length - 1];
        // thin to under a pixel, but never across an edge of the domain
        if (prev && px - prev.x < 0.8 && side(v) === side(prev.v) && i !== s.t.length - 1) return;
        pts.push({ x: px, v });
      });
      const path = () => {
        let d = "", pen = null;
        return {
          to(ax, ay, bx, by) {
            const a = `${ax.toFixed(1)},${ay.toFixed(1)}`;
            if (pen !== a) d += "M" + a;
            pen = `${bx.toFixed(1)},${by.toFixed(1)}`;
            d += "L" + pen;
            segs.push([ax, ay, bx, by]);
          },
          get d() { return d; },
        };
      };
      const inside = path(), outside = path(), exits = [];
      const edge = (v) => Y(v > hi ? hi : lo);
      const first = pts.find(Boolean);
      if (first && side(first.v)) exits.push({ x: first.x, up: first.v > hi });
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1], q = pts[i];
        if (!p || !q) continue;
        const dv = q.v - p.v;
        const at = (f) => [p.x + f * (q.x - p.x), p.v + f * dv];
        // the fractions fa..fb of p→q that lie inside the domain
        let fa = 0, fb = 1;
        if (dv) { const f1 = (lo - p.v) / dv, f2 = (hi - p.v) / dv; fa = Math.max(0, Math.min(f1, f2)); fb = Math.min(1, Math.max(f1, f2)); }
        else if (side(p.v)) { fa = 1; fb = 0; }
        if (fb <= fa) { outside.to(p.x, edge(p.v), q.x, edge(q.v)); continue; }
        if (fa > 0) outside.to(p.x, edge(p.v), at(fa)[0], edge(p.v));
        const [ax, av] = at(fa), [bx, bv] = at(fb);
        inside.to(ax, Y(av), bx, Y(bv));
        if (fb < 1) {
          exits.push({ x: bx, up: q.v > hi });
          outside.to(bx, edge(q.v), q.x, edge(q.v));
        }
      }
      return { inside: inside.d, outside: outside.d, exits };
    }
    function paint() {
      if (!L || t == null) return;
      L.ph.style.display = "";
      L.ph.setAttribute("x1", L.X(t));
      L.ph.setAttribute("x2", L.X(t));
      L.lines.forEach((l, i) => {
        const inRange = t >= l.s.t[0] && t <= l.s.t[l.s.t.length - 1];
        const v = inRange ? l.f(t).v : null;
        L.heads[i].style.display = v == null ? "none" : "";
        if (v != null) { L.heads[i].setAttribute("cx", L.X(t)); L.heads[i].setAttribute("cy", L.Y(v)); }
      });
    }
    const onRender = () => redraw();
    const api = {
      setTime(tt) { t = tt; paint(); return api; },
      update(next) { Object.assign(o, next); redraw(); return api; },
      redraw: () => redraw(),
      destroy() {
        redraw.stop();
        if (rib) rib.off("render", onRender);
        root.replaceChildren();
        L = null;
        if (live.get(root) === api) live.delete(root);
      },
    };
    const redraw = mount(root, draw);
    if (rib) rib.on("render", onRender);
    live.set(root, api);
    return api;
  }

  /* ================================================================ C7 shank rail */
  /** Base.rail(svg, {domain:{along:[a0, a1], vert:[v0, v1]}, sample(t) → {along, vert, n}, trailFrom (s, default 2),
   *  ghost:{along:[], vert:[], n_end}, seen:{t}, offscreen (label), shank, ring}): Tool Hanging's side view in the
   *  shank's frame, mm to scale; the board on the right, the free tip pointing left. Returns {set(t), showGhost(b),
   *  update(opts), destroy()}; update takes any option (a new round's sample, ghost, offscreen label or seen). */
  function rail(root, opts) {
    retire(root);
    const o = Object.assign({ trailFrom: 2, offscreen: "out of view", shank: { len_mm: 61.1, r_mm: 2.5 }, ring: { inner_r_mm: 14.1 }, scalebar: 20 }, opts);
    root.classList.add("rail");
    if (!root.getAttribute("role")) root.setAttribute("role", "img");
    let t = null, ghostOn = false, L = null;
    const inside = (s) => {
      const [a0, a1] = o.domain.along, [v0, v1] = o.domain.vert;
      return s && s.along <= a1 && s.along >= a0 && s.vert <= v1 && s.vert >= v0;
    };
    function draw(w) {
      root.replaceChildren();
      const [a0, a1] = o.domain.along, [v0, v1] = o.domain.vert;
      const pad = 10;
      const k = (w - 2 * pad) / (a1 - a0);
      const h = Math.round((v1 - v0) * k + 2 * pad);
      const X = (a) => pad + (a1 - a) * k;
      const Y = (v) => pad + (v1 - v) * k;
      const len = o.shank.len_mm, r = o.shank.r_mm;
      const bx = X(-len);
      svg("rect", { class: "board-face", x: bx, y: 0, width: Math.max(0, w - bx), height: h }, root);
      svg("line", { class: "board", x1: bx, x2: bx, y1: 0, y2: h }, root);
      svg("rect", { class: "shank", x: X(0), y: Y(r), width: len * k, height: 2 * r * k, rx: r * k }, root);
      svg("text", { class: "tip-label", x: X(0), y: Y(r) - 7, "text-anchor": "middle", text: "tip" }, root);
      const sb = svg("g", { class: "geo-scale" }, root);
      const sx = pad + 2, sy = h - pad - 2, sw = o.scalebar * k;
      svg("line", { x1: sx, x2: sx + sw, y1: sy, y2: sy }, sb);
      svg("line", { x1: sx, x2: sx, y1: sy - 3, y2: sy + 3 }, sb);
      svg("line", { x1: sx + sw, x2: sx + sw, y1: sy - 3, y2: sy + 3 }, sb);
      svg("text", { x: sx + sw + 5, y: sy + 3.5, text: `${o.scalebar} mm` }, sb);
      const ghostG = svg("g", { class: "ghost-g", style: ghostOn ? "" : "display:none" }, root);
      if (o.ghost) {
        const pts = o.ghost.along.map((a, i) => `${X(a).toFixed(1)},${Y(o.ghost.vert[i]).toFixed(1)}`).join(" ");
        svg("polyline", { class: "ghost", points: pts }, ghostG);
        const n = o.ghost.n_end;
        const end = o.ghost.along.length - 1;
        if (n) svg("ellipse", ringAttrs(X(o.ghost.along[end]), Y(o.ghost.vert[end]), n, k, "ghost"), ghostG);
      }
      const trailG = svg("g", { class: "trail-g" }, root);
      const ring = svg("ellipse", { class: "ring", rx: 0, ry: 0 }, root);
      const seenG = svg("g", { class: "seen-g" }, root);
      if (o.seen) {
        const s = o.sample(o.seen.t);
        if (inside(s)) mark(seenG, "m-seen", X(s.along), Y(s.vert), { size: 13, cls: "mark-seen", title: o.seen.title || "Where the failure is seen" });
      }
      const off = svg("g", { class: "offscreen", style: "display:none" }, root);
      const offPath = svg("path", { "marker-end": "url(#arrow-muted)" }, off);
      const offText = svg("text", { text: o.offscreen }, off);
      size(root, w, h);
      L = { X, Y, k, w, h, ring, trailG, off, offPath, offText, pad };
      paint();
    }
    function ringAttrs(cx, cy, n, k, cls) {
      const r = o.ring.inner_r_mm * k;
      const minor = Math.max(0.8, r * Math.abs(n[2]));
      const ang = Math.hypot(n[0], n[1]) < 1e-3 ? 0 : (Math.atan2(-n[1], -n[0]) * 180) / Math.PI + 90;
      return { class: cls, cx, cy, rx: r, ry: minor, transform: `rotate(${ang.toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)})` };
    }
    function paint() {
      if (!L || t == null) return;
      const s = o.sample(t);
      const inView = inside(s);
      L.ring.style.display = inView ? "" : "none";
      if (inView) setAttrs(L.ring, ringAttrs(L.X(s.along), L.Y(s.vert), s.n, L.k, "ring"));
      L.trailG.replaceChildren();
      // about 12 samples a second, so a long trail (a whole round's path) stays as smooth as the 2 s one
      const steps = Math.max(24, Math.ceil(o.trailFrom * 12)), pts = [];
      for (let i = 0; i <= steps; i++) {
        const ti = t - o.trailFrom + (o.trailFrom * i) / steps;
        if (ti < 0) continue;
        const p = o.sample(ti);
        pts.push(inside(p) ? [L.X(p.along), L.Y(p.vert)] : null);
      }
      for (let i = 1; i < pts.length; i++) {
        if (!pts[i - 1] || !pts[i]) continue;
        svg("line", { class: "trail", x1: pts[i - 1][0], y1: pts[i - 1][1], x2: pts[i][0], y2: pts[i][1], style: `opacity:${(0.1 + 0.8 * i / pts.length).toFixed(2)}` }, L.trailG);
      }
      L.off.style.display = inView || !s ? "none" : "";
      if (!inView && s) {
        const cx = clamp(L.X(s.along), L.pad + 14, L.w - L.pad - 14), cy = clamp(L.Y(s.vert), L.pad + 14, L.h - L.pad - 14);
        const dx = L.X(s.along) - cx, dy = L.Y(s.vert) - cy, d = Math.hypot(dx, dy) || 1;
        const ux = dx / d, uy = dy / d;
        L.offPath.setAttribute("d", `M${cx - ux * 14},${cy - uy * 14} L${cx},${cy}`);
        const tw = textWidth(o.offscreen, SANS(11.5, 600));
        const tx = clamp(cx - ux * 18 + (ux < -0.3 ? 6 : ux > 0.3 ? -tw - 6 : -tw / 2), 2, L.w - tw - 2);
        const ty = clamp(cy - uy * 22 + 4, 12, L.h - 4);
        setAttrs(L.offText, { x: tx, y: ty });
      }
    }
    const api = {
      set(tt) { t = tt; paint(); return api; },
      showGhost(b) { ghostOn = !!b; const g = $(".ghost-g", root); if (g) g.style.display = ghostOn ? "" : "none"; return api; },
      update(next) { Object.assign(o, next); redraw(); return api; },
      destroy() {
        redraw.stop();
        root.replaceChildren();
        L = null;
        if (live.get(root) === api) live.delete(root);
      },
    };
    const redraw = mount(root, draw);
    live.set(root, api);
    return api;
  }

  /* ================================================================ C17 gauge and keyhole */
  /** Base.gauge(svg, {min:0, max:90, labels:["upright", "flat"], size, r:50}): a dial whose needle leans as far from
   *  vertical as the value, drawn over exactly [min, max]: a quarter for 0–90 (tilt), a half for −90–90
   *  (tilt_signed, labels ["flat", "upright", "flat"]). Two labels sit at min and max; three at min, 0 and max.
   *  Returns {set(deg, {animate}), ghost(deg|null), update(opts), destroy()}: the needle eases only when set() is
   *  asked to animate (a discrete step), so a needle driven by video time never lags. */
  function gauge(root, opts) {
    retire(root);
    const o = Object.assign({ min: 0, max: 90, labels: ["upright", "flat"], size: 220, r: 50 }, opts);
    root.classList.add("gauge");
    if (!root.getAttribute("role")) root.setAttribute("role", "img");
    let val = null, ghostVal = null, L = null;
    const P = (deg, rr) => [rr * Math.sin((deg * Math.PI) / 180), -rr * Math.cos((deg * Math.PI) / 180)];
    function draw(w0) {
      root.replaceChildren();
      const r = o.r, a0 = o.min, a1 = o.max;
      const font = SANS(11);
      const at = o.labels.length === 3 ? [a0, 0, a1] : [a0, a1];
      // lay out around the hub at (0, 0), then fit the box to what was drawn
      const labels = o.labels.map((text, i) => {
        const [lx, ly] = P(at[i], r + 10), s = Math.sin((at[i] * Math.PI) / 180);
        const anchor = Math.abs(s) < 0.35 ? "middle" : s > 0 ? "start" : "end";
        const tw = textWidth(text, font);
        const x0 = anchor === "middle" ? lx - tw / 2 : anchor === "start" ? lx : lx - tw;
        const y = anchor === "middle" ? ly - 4 : ly + 4;
        return { text, x: lx, y, anchor, box: [x0, y - 10, x0 + tw, y + 3] };
      });
      const pts = [[-4, -4], [4, 4]];
      for (let d = a0; d <= a1; d += 5) pts.push(P(d, r + 3));
      pts.push(P(a1, r + 3));
      for (const l of labels) pts.push([l.box[0], l.box[1]], [l.box[2], l.box[3]]);
      const pad = 2;
      const minX = Math.min(...pts.map((p) => p[0])) - pad, maxX = Math.max(...pts.map((p) => p[0])) + pad;
      const minY = Math.min(...pts.map((p) => p[1])) - pad, maxY = Math.max(...pts.map((p) => p[1])) + pad;
      const W = Math.ceil(maxX - minX), H = Math.ceil(maxY - minY), cx = -minX, cy = -minY;
      const Q = (deg, rr) => { const [x, y] = P(deg, rr); return [cx + x, cy + y]; };
      const [ax, ay] = Q(a0, r), [bx, by] = Q(a1, r);
      svg("path", { class: "track", d: `M${ax},${ay} A${r},${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${bx},${by}` }, root);
      const ticks = new Set([a0, (a0 + a1) / 2, a1]);
      if (a0 < 0 && a1 > 0) ticks.add(0);
      for (const d of ticks) {
        const [x1, y1] = Q(d, r - 6), [x2, y2] = Q(d, r + 4);
        svg("line", { class: "tick", x1, y1, x2, y2 }, root);
      }
      for (const l of labels) svg("text", { class: "gauge-label", x: cx + l.x, y: cy + l.y, "text-anchor": l.anchor, text: l.text }, root);
      const ghost = svg("line", { class: "needle ghost", x1: cx, y1: cy, x2: cx, y2: cy - r + 6, style: "display:none" }, root);
      const needle = svg("line", { class: "needle", x1: cx, y1: cy, x2: cx, y2: cy - r + 4 }, root);
      svg("circle", { class: "hub", cx, cy, r: 3.5 }, root);
      const scale = Math.min(1, w0 / W, o.size / W);
      root.setAttribute("viewBox", `0 0 ${W} ${H}`);
      root.removeAttribute("height");
      root.style.height = H * scale + "px";
      root.style.maxWidth = W * scale + "px";
      L = { cx, cy, needle, ghost };
      paint(false);
    }
    function paint(animate) {
      if (!L) return;
      const rot = (d) => `rotate(${clamp(d, o.min, o.max).toFixed(1)}deg)`;
      for (const [line, v] of [[L.needle, val], [L.ghost, ghostVal]]) {
        line.classList.toggle("tween", !!animate);
        line.style.display = v == null ? "none" : "";
        line.style.transformOrigin = `${L.cx}px ${L.cy}px`;
        if (v != null) line.style.transform = rot(v);
      }
    }
    const api = {
      set(d, opt) { val = d; paint(opt && opt.animate); return api; },
      ghost(d, opt) { ghostVal = d; paint(opt && opt.animate); return api; },
      update(next) { Object.assign(o, next); redraw(); return api; },
      destroy() {
        redraw.stop();
        root.replaceChildren();
        L = null;
        if (live.get(root) === api) live.delete(root);
      },
    };
    const redraw = mount(root, draw);
    live.set(root, api);
    return api;
  }

  /** Base.keyhole(svg, {opening_mm, syringe:{len_mm, dia_mm}, lid_z_mm, domain:{x:[x0, x1], y:[y0, y1]}, height,
   *  bars:[{sample(t) → {tilt_signed, z_mm, r_mm}, cls}], lid_mm, box}): a side section of the syringe box lid with
   *  its opening; x is mm from the opening's centre, y mm above the lid. The box walls (dashed, schematic) stand at
   *  box.x, default the domain's ends. Bars are clipped to the domain. Returns {set(t), dims(list), update(opts),
   *  destroy()}; dims draws .geo-dim callouts: {kind:"dim", from:[x, y], to:[x, y], label, key, off} | {kind:"cone",
   *  at, deg, len, label, key} | {kind:"note", at, label, key}, in the section's mm. A dim's label sits off px above
   *  a horizontal line (below it when off < 0), or to its right (left when off < 0) of a vertical one. */
  function keyhole(root, opts) {
    retire(root);
    const o = Object.assign({ opening_mm: 55, syringe: { len_mm: 150.5, dia_mm: 14.4 }, lid_z_mm: 0, lid_mm: 6,
      domain: { x: [-110, 190], y: [-130, 180] }, bars: [], box: null }, opts);
    root.classList.add("keyhole");
    if (!root.getAttribute("role")) root.setAttribute("role", "img");
    let t = null, L = null, dimList = [];
    function draw(w) {
      root.replaceChildren();
      const [x0, x1] = o.domain.x, [y0, y1] = o.domain.y;
      const k = o.height ? Math.min(w / (x1 - x0), o.height / (y1 - y0)) : w / (x1 - x0);
      const h = o.height || Math.round((y1 - y0) * k);
      const ox = (w - (x1 - x0) * k) / 2, oy = (h - (y1 - y0) * k) / 2;
      const X = (x) => ox + (x - x0) * k, Y = (y) => oy + (y1 - y) * k;
      const half = o.opening_mm / 2;
      // the lid at no less than 5 px, so the section reads; the opening is a real gap between its two ends
      const lidTop = Y(0), lidH = Math.max(o.lid_mm * k, 5), under = lidTop + lidH;
      const [bx0, bx1] = o.box ? o.box.x : [x0, x1];
      for (const bx of [bx0, bx1]) svg("line", { class: "box-wall", x1: X(bx), x2: X(bx), y1: under, y2: Y(y0) }, root);
      svg("text", { class: "geo-label", x: X(bx1) - 6, y: under + 14, "text-anchor": "end", text: "box" }, root);
      svg("rect", { class: "lid", x: X(bx0), y: lidTop, width: X(-half) - X(bx0), height: lidH }, root);
      svg("rect", { class: "lid", x: X(half), y: lidTop, width: X(bx1) - X(half), height: lidH }, root);
      for (const ex of [-half, half]) svg("line", { class: "lid-end", x1: X(ex), x2: X(ex), y1: lidTop - 1, y2: under + 1 }, root);
      const clipId = nextId("keyclip");
      svg("rect", { x: X(x0), y: Y(y1), width: (x1 - x0) * k, height: (y1 - y0) * k }, svg("clipPath", { id: clipId }, svg("defs", {}, root)));
      const barsG = svg("g", { class: "bars", "clip-path": `url(#${clipId})` }, root);
      const bars = o.bars.map((b) => {
        const g = svg("g", { class: "bar-g", style: "display:none" }, barsG);
        svg("rect", { class: "bar" + (b.cls ? " " + b.cls : ""), x: (-o.syringe.len_mm / 2) * k, y: (-o.syringe.dia_mm / 2) * k, width: o.syringe.len_mm * k, height: o.syringe.dia_mm * k, rx: (o.syringe.dia_mm / 2) * k }, g);
        return { b, g };
      });
      const dimsG = svg("g", { class: "dims" }, root);
      size(root, w, h);
      L = { X, Y, k, bars, dimsG };
      paint();
      renderDims();
    }
    function paint() {
      if (!L || t == null) return;
      for (const { b, g } of L.bars) {
        const s = b.sample(t);
        const inView = s && s.r_mm <= o.domain.x[1] + o.syringe.len_mm / 2;
        g.style.display = inView ? "" : "none";
        if (!inView) continue;
        const ts = (s.tilt_signed * Math.PI) / 180;
        const phi = Math.atan2(Math.cos(ts), -Math.sin(ts));   // the long axis, from horizontal, in the section
        g.setAttribute("transform", `translate(${L.X(s.r_mm).toFixed(1)} ${L.Y(s.z_mm - o.lid_z_mm).toFixed(1)}) rotate(${(-phi * 180 / Math.PI).toFixed(1)})`);
      }
    }
    function renderDims() {
      if (!L) return [];
      L.dimsG.replaceChildren();
      const P = ([x, y]) => [L.X(x), L.Y(y)];
      return dimList.map((d) => {
        const g = svg("g", { class: "geo-dim" + (d.kind === "cone" ? " cone" : ""), "data-key": d.key || null }, L.dimsG);
        if (d.kind === "cone") {
          const [ax, ay] = P(d.at), len = d.len * L.k, a = (d.deg * Math.PI) / 180;
          svg("path", { d: `M${ax},${ay} L${ax - len * Math.sin(a)},${ay - len * Math.cos(a)} A${len},${len} 0 0 1 ${ax + len * Math.sin(a)},${ay - len * Math.cos(a)} Z` }, g);
          if (d.label) svg("text", { x: ax + len * Math.sin(a) + 4, y: ay - len * Math.cos(a) + 4, text: d.label }, g);
        } else if (d.kind === "note") {
          const [ax, ay] = P(d.at);
          svg("text", { x: ax, y: ay, text: d.label }, g);
        } else {
          const [ax, ay] = P(d.from), [bx, by] = P(d.to);
          const len = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / len, ny = (bx - ax) / len;
          svg("line", { x1: ax, y1: ay, x2: bx, y2: by }, g);
          for (const [px, py] of [[ax, ay], [bx, by]]) svg("line", { x1: px - nx * 4, y1: py - ny * 4, x2: px + nx * 4, y2: py + ny * 4 }, g);
          const off = d.off != null ? d.off : 8, mx = (ax + bx) / 2, my = (ay + by) / 2;
          // the label clears the line and its 4 px end ticks on the side off asks for
          if (Math.abs(bx - ax) < Math.abs(by - ay)) {
            svg("text", { x: mx + (off >= 0 ? 1 : -1) * (Math.abs(off) + 4), y: my, "dominant-baseline": "central", "text-anchor": off >= 0 ? "start" : "end", text: d.label }, g);
          } else {
            svg("text", { x: mx, y: off >= 0 ? my - off - 4 : my - off + 4, "dominant-baseline": off >= 0 ? "auto" : "hanging", "text-anchor": "middle", text: d.label }, g);
          }
        }
        if (d.title) svg("title", { text: d.title }, g);
        return g;
      });
    }
    const api = {
      set(tt) { t = tt; paint(); return api; },
      dims(list) { dimList = list || []; return renderDims(); },
      update(next) { Object.assign(o, next); redraw(); return api; },
      destroy() {
        redraw.stop();
        root.replaceChildren();
        L = null;
        if (live.get(root) === api) live.delete(root);
      },
    };
    const redraw = mount(root, draw);
    live.set(root, api);
    return api;
  }

  /* ================================================================ C9 round strip */
  /** Base.rounds(svg, rounds, {compact, labels:{k: text}, edits, describe(r), onSelect(k), selected}): one cell per
   *  round of rounds_th.json: four training-layout dots (filled ok, hollow ✕ failed), the reverted round struck
   *  through with a return arrow over the top. Each edit is a pencil (hover or focus names its stages): in the gutter
   *  between two rounds when it was applied to the round before it, or on an arc under the strip from the program it
   *  was applied to (edits[].applied_to) when that round was reverted. Returns {select(k), update(opts), destroy()}. */
  function rounds(root, list, opts) {
    retire(root);
    const o = Object.assign({ compact: false, labels: {}, edits: [], selected: null }, opts, { rounds: list });
    root.classList.add("rounds");
    if (!root.getAttribute("role")) root.setAttribute("role", "group");
    const tip = tooltip(root.parentElement);
    const describe = (r) => (o.describe ? o.describe(r) : `k${r.k} · ${r.train.filter(Boolean).length} of ${r.train.length} training layouts succeeded${r.reverted ? ` · reverted to k${r.revert_to}` : ""}`);
    const stageNames = (e) => (e.stages || []).map((s) => (s === "wiring" ? "graph wiring" : s)).join(", ");
    function draw(w) {
      root.replaceChildren();
      const list = o.rounds, n = list.length;
      const idx = (k) => list.findIndex((x) => x.k === k);
      const gut = o.compact ? 14 : 18;   // the gutter between cells holds the pencil, clear of every box
      const cw = (w - gut * (n - 1)) / n;
      const cellX = (i) => i * (cw + gut);
      const cx = (i) => cellX(i) + cw / 2;
      const dots = Math.max(...list.map((x) => x.train.length));
      const gap = o.compact ? 4 : 6;
      const r = clamp((cw - 12 - gap * (dots - 1)) / (2 * dots), 3, o.compact ? 4.5 : 6.5);
      const font = SANS(11, 600);
      // labels sit above their cell, wrapped to its width, never across a box's border
      const labelLines = new Map(o.compact ? [] : list.filter((rd) => o.labels[rd.k]).map((rd) => [rd.k, wrapLines(o.labels[rd.k], cw - 2, font).slice(0, 2)]));
      const labelH = labelLines.size ? Math.max(...[...labelLines.values()].map((ls) => ls.length)) * 13 + 3 : 0;
      const arcH = list.some((x) => x.reverted) ? 14 : 0;
      const boxTop = labelH + arcH;
      const dotsY = boxTop + r + 9;
      const kY = dotsY + r + 15;
      const boxBot = kY + 6;
      const step = r * 2 + gap;
      const edits = o.edits.map((e) => ({ e, i: idx(e.after), j: idx(e.applied_to != null ? e.applied_to : e.after) }))
        .filter((x) => x.i >= 0 && x.i < n - 1 && x.j >= 0);
      const lineH = edits.some((x) => x.j !== x.i) ? 20 : 0;
      const linksG = svg("g", { class: "links" }, root);
      list.forEach((rd, i) => {
        const g = svg("g", { class: "round", "data-k": rd.k, "data-reverted": rd.reverted ? "true" : null, tabindex: 0, role: "button", "aria-label": describe(rd) }, root);
        svg("rect", { class: "round-box", x: cellX(i) + 1, y: boxTop + 1, width: cw - 2, height: boxBot - boxTop - 2, rx: 8 }, g);
        const xs = rd.train.map((_, j) => cx(i) + (j - (rd.train.length - 1) / 2) * step);
        rd.train.forEach((ok, j) => {
          svg("circle", { class: "ep", "data-ok": String(!!ok), cx: xs[j], cy: dotsY, r }, g);
          if (!ok) svg("use", { class: "ep-x", href: "#m-seen", x: xs[j] - r * 0.7, y: dotsY - r * 0.7, width: r * 1.4, height: r * 1.4 }, g);
        });
        svg("text", { class: "round-k", x: cx(i), y: kY, "text-anchor": "middle", text: `k${rd.k}` }, g);
        const lines = labelLines.get(rd.k);
        if (lines) {
          const half = Math.max(...lines.map((l) => textWidth(l, font))) / 2 + 1;
          lines.forEach((line, li) => svg("text", { class: "round-label", x: clamp(cx(i), half, w - half), y: labelH - 3 - (lines.length - 1 - li) * 13, "text-anchor": "middle", text: line }, g));
        }
        if (rd.reverted) {
          svg("path", { class: "revert-strike", d: `M${xs[0] - r - 4},${dotsY} H${xs[xs.length - 1] + r + 4}` }, g);
          const j = idx(rd.revert_to);
          if (j >= 0) svg("path", { class: "revert-arrow", d: `M${cx(i) - step},${boxTop} C${cx(i) - step},${boxTop - arcH} ${cx(j) + step},${boxTop - arcH} ${cx(j) + step},${boxTop}`, "marker-end": "url(#arrow-muted)" }, linksG);
        }
        g.classList.toggle("selected", o.selected === rd.k);
        tip.bind(g, () => ({ title: describe(rd) }));
        const choose = () => { if (o.onSelect) o.onSelect(rd.k); };
        g.addEventListener("click", choose);
        g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(); } });
      });
      for (const { e, i, j } of edits) {
        const next = list[i + 1].k, onto = j !== i;
        let px = cellX(i) + cw + gut / 2, py = dotsY;
        if (onto) {
          // the edit after a reverted round went onto the program it was reverted to: the arc says where k(i+1) came from
          const a = cx(j), b = cx(i + 1), c = boxBot + 16;
          svg("path", { class: "lineage", d: `M${a},${boxBot} C${a},${c} ${b},${c} ${b},${boxBot + 1}`, "marker-end": "url(#arc-head)" }, linksG);
          px = (a + b) / 2;
          py = 0.25 * boxBot + 0.75 * c;
        }
        const text = `${onto ? `applied to k${e.applied_to}'s program (k${e.after} was reverted)` : `applied to k${e.after}'s program`}, giving k${next} · ${stageNames(e)}${e.lines != null ? ` · ${e.lines} lines` : ""}`;
        const pg = svg("g", { class: "pencils", "aria-label": `Edit after k${e.after}: ${text}` }, root);
        svg("circle", { class: "pencil-hit", cx: px, cy: py, r: 8 }, pg);
        svg("use", { href: "#i-pencil", x: px - 5.5, y: py - 5.5, width: 11, height: 11 }, pg);
        tip.bind(pg, () => ({ title: `Edit after k${e.after}`, rows: [{ text }] }));
      }
      size(root, w, boxBot + lineH + 1);
    }
    const api = {
      select(k) { o.selected = k; $$(".round", root).forEach((g) => g.classList.toggle("selected", +g.dataset.k === k)); return api; },
      update(next) { Object.assign(o, next); redraw(); return api; },
      destroy() {
        redraw.stop();
        tip.hide();
        root.replaceChildren();
        if (live.get(root) === api) live.delete(root);
      },
    };
    const redraw = mount(root, draw);
    live.set(root, api);
    return api;
  }

  /* ================================================================ C2 loop glyph */
  const STATION = { skills: "write", curriculum: "run", time: "read", space: "read", model: "edit", physical: "edit" };
  /** Base.loopGlyph(svg, knob): the 28×28 loop (write → run → read → edit, clockwise) with the knob's station filled. */
  function loopGlyph(root, knob) {
    const on = STATION[knob];
    root.replaceChildren();
    setAttrs(root, { viewBox: "0 0 28 28", width: 28, height: 28, "aria-hidden": root.getAttribute("aria-hidden") || "true" });
    svg("rect", { class: "circuit", x: 5, y: 5, width: 18, height: 18, rx: 5 }, root);
    for (const d of ["M12.6,3.4 L15,5 L12.6,6.6", "M21.4,12.6 L23,15 L24.6,12.6", "M15.4,21.4 L13,23 L15.4,24.6", "M3.4,15.4 L5,13 L6.6,15.4"])
      svg("path", { class: "chev", d }, root);
    for (const [name, x, y] of [["write", 5, 5], ["run", 23, 5], ["read", 23, 23], ["edit", 5, 23]])
      svg("circle", { class: "station" + (name === on ? " on" : ""), "data-station": name, cx: x, cy: y, r: 3.3 }, root);
    svg("title", { text: `turns the "${on}" step of the loop` }, root);
    return root;
  }

  /* ================================================================ C11 verbatim blocks */
  const test = (spec, line, i) => spec == null ? false : typeof spec === "function" ? !!spec(line, i)
    : Array.isArray(spec) ? spec.includes(i) : typeof spec === "number" ? spec === i : line.includes(spec);
  function scrollInto(box, node) {
    const b = box.getBoundingClientRect(), n = node.getBoundingClientRect();
    box.scrollTop += n.top - b.top - 32;
  }
  /** Base.report(pre, lines, {focus, symptom, lit}): verbatim report lines; focus (the evidence line, --cause rule),
   *  symptom (--seen rule) and lit (<mark> lines) each take a substring, an index, a list of indices or a
   *  predicate. Scrolls the first focus line into view inside the box. Returns the line elements. */
  function report(pre, lines, opts) {
    const o = opts || {};
    pre.replaceChildren();
    let first = null;
    const out = lines.map((line, i) => {
      const node = document.createElement(test(o.lit, line, i) ? "mark" : "span");
      const focus = test(o.focus, line, i), symptom = test(o.symptom, line, i);
      node.className = "ln" + (line.startsWith("#") ? " h" : "") + (focus ? " focus" : "") + (symptom ? " symptom" : "");
      node.dataset.i = i;
      node.textContent = line || " ";
      softBreaks(node);
      pre.appendChild(node);
      if (!first && (focus || symptom)) first = node;
      return node;
    });
    if (first) scrollInto(pre, first);
    return out;
  }
  /** Base.said(blockquote, text, cite): the agent's own words, in sans; `code`, **bold** and *em* kept. */
  function said(block, text, cite) {
    block.replaceChildren();
    for (const part of text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/)) {
      if (!part) continue;
      if (part.startsWith("`")) el("code", { text: part.slice(1, -1) }, block);
      else if (part.startsWith("**")) el("b", { text: part.slice(2, -2) }, block);
      else if (part.startsWith("*")) el("em", { text: part.slice(1, -1) }, block);
      else block.appendChild(document.createTextNode(part));
    }
    if (cite) el("cite", { text: cite }, block);
    return block;
  }
  /** Base.diff(pre, lines, hl): diff lines (+ added, - removed); hl as report()'s focus marks lines. */
  function diff(pre, lines, hl) {
    pre.replaceChildren();
    return lines.map((l, i) => softBreaks(el("span", {
      class: "ln" + (l.startsWith("+") ? " add" : l.startsWith("-") ? " del" : "") + (test(hl, l, i) ? " hl" : ""),
      "data-i": i, text: l || " ",
    }, pre)));
  }
  /** Base.softBreaks(node): verbatim blocks wrap at spaces only, so a token too long for a phone's box (a dotted
   *  key=value with a 16-digit float, a nested call) gets a <wbr> after each of its "=" and "(": it wraps between its
   *  parts, never inside a name or a number. Shorter tokens get none, so "y=0.02" never splits from its value. The
   *  text itself, and so textContent and a copy of it, is unchanged. Returns node. */
  const LONG_TOKEN = 28, HAS_LONG = new RegExp(`\\S{${LONG_TOKEN + 1}}`);
  function softBreaks(node) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    for (const t of texts) {
      if (!HAS_LONG.test(t.nodeValue)) continue;
      const frag = document.createDocumentFragment();
      for (const word of t.nodeValue.split(/(\s+)/)) {
        const parts = word.length > LONG_TOKEN ? word.split(/(?<=[=(])(?=\S)/) : [word];
        parts.forEach((part, i) => { if (i) frag.appendChild(document.createElement("wbr")); frag.appendChild(document.createTextNode(part)); });
      }
      t.replaceWith(frag);
    }
    return node;
  }
  /** Base.paperTable(box, head, rows, {rowClass(i)}): a table in the paper's style. head: header rows; a cell is a
   *  value or {v, best, span}. */
  function paperTable(box, head, rows, opts) {
    const t = el("table", { class: "paper" });
    const thead = el("thead", {}, t);
    for (const hr of head) {
      const tr = el("tr", {}, thead);
      for (const h of hr) {
        if (h && typeof h === "object") el("th", { text: h.v, colspan: h.span || null }, tr);
        else el("th", { text: h }, tr);
      }
    }
    const tb = el("tbody", {}, t);
    rows.forEach((r, i) => {
      const tr = el("tr", { class: (opts && opts.rowClass && opts.rowClass(i)) || null }, tb);
      for (const c of r) {
        if (c && typeof c === "object") el("td", { text: c.v, class: c.best ? "best" : null, colspan: c.span || null }, tr);
        else el("td", { text: c }, tr);
      }
    });
    box.replaceChildren(t);
    return t;
  }
  /** Base.copy(button, source): copies source (an element's text, or a function's result) to the clipboard; if the
   *  clipboard is unavailable, selects the element's text instead. */
  function copy(button, source) {
    const label = button.textContent;
    button.addEventListener("click", () => {
      const text = typeof source === "function" ? source() : source.textContent;
      const done = (msg) => { button.textContent = msg; setTimeout(() => { button.textContent = label; }, 1600); };
      const fallback = () => {
        if (typeof source !== "function") {
          const r = document.createRange();
          r.selectNodeContents(source);
          const s = getSelection();
          s.removeAllRanges();
          s.addRange(r);
        }
        done("Selected");
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => done("Copied"), fallback);
      else fallback();
    });
  }
  /** Base.ladder(box, items:[{key, text}], {label, active, after}): ordered numerals; the active one in ink, earlier
   *  ones --ctx, later ones faded. Returns {set(key)}. */
  function ladder(box, items, opts) {
    const o = opts || {};
    box.classList.add("ladder");
    box.replaceChildren();
    if (o.label) el("span", { class: "numlabel", text: o.label }, box);
    const nodes = items.map((it, i) => {
      if (i) el("span", { class: "sep", text: "·", "aria-hidden": "true" }, box);
      const n = el("span", { class: "n", "data-key": it.key, text: it.text }, box);
      if (it.pct) el("span", { class: "pct", text: "%" }, n);
      return n;
    });
    if (o.after) el("span", { class: "ctx", text: o.after }, box);
    const set = (key) => {
      const at = items.findIndex((it) => String(it.key) === String(key));
      nodes.forEach((n, i) => { n.classList.toggle("on", i === at); n.classList.toggle("later", at >= 0 && i > at); });
    };
    if (o.active != null) set(o.active);
    return { set };
  }

  /* ================================================================ C16 rail, page boot */
  function renderRail() {
    const nav = document.getElementById("rail");
    if (!nav) return;
    const roots = $$("[data-section][data-rail]").filter((r) => r.id);
    if (!roots.length) { nav.hidden = true; return; }
    const wrap = el("div", { class: "wide" }, nav);
    if (document.getElementById("top")) el("a", { class: "brand", href: "#top", text: "Robot RSI" }, wrap);
    const links = new Map(roots.map((r) => [r, el("a", { href: "#" + r.id, text: r.dataset.rail }, wrap)]));
    if (!("IntersectionObserver" in window)) return;
    const inBand = new Set();
    let active = null;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) { if (e.isIntersecting) inBand.add(e.target); else inBand.delete(e.target); }
      const now = roots.filter((r) => inBand.has(r)).pop() || null;
      // outside the rail's sections (the hero, Resources, the footer) active stays null, so a jump from the footer back
      // to the hero must still reach the reset below
      if (now === active && now) return;
      active = now;
      links.forEach((a, r) => a.classList.toggle("on", r === now));
      const a = now && links.get(now), bar = wrap;
      if (bar.scrollWidth <= bar.clientWidth) return;
      // back up in the hero, a phone's scrolled rail returns to its start rather than staying on the last section
      const left = a ? a.offsetLeft - bar.clientWidth / 2 + a.offsetWidth / 2
        : roots[0].getBoundingClientRect().top > innerHeight / 2 ? 0 : null;
      if (left != null) bar.scrollTo({ left, behavior: reduced ? "auto" : "smooth" });
    }, { rootMargin: "-45% 0px -50% 0px" });
    roots.forEach((r) => io.observe(r));
    // the hero has no rail link, but an instant jump to it (reduced motion, the brand link) crosses no rail section on
    // the way, so it is watched too: its arrival is what resets the rail
    const top = document.getElementById("top");
    if (top) io.observe(top);
  }
  /* In-page links scroll within the current page (dev pages carry <base href="../">, which would otherwise send
     "#x" to index.html). */
  function anchors() {
    document.addEventListener("click", (e) => {
      const a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey) return;
      const id = decodeURIComponent(a.getAttribute("href").slice(1));
      const target = id ? document.getElementById(id) : null;
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
      history.replaceState(null, "", location.pathname + location.search + "#" + id);
    });
  }
  /* ✕ ◆ ✓ ● written in a .legend-marks line become the sprite's glyphs, each held together with its words in one
     span.legend-item, so a narrow line never strands a glyph from its label; the "·" separators go. */
  const LEGEND = { "✕": ["m-seen", "seen"], "◆": ["m-cause", "cause"], "✓": ["m-check", "ok"], "●": ["m-ok", "ok"] };
  /** Base.legend(el): applies that to one element (idempotent); boot applies it to every .legend-marks. */
  function legend(box) {
    if (box.dataset.legend) return box;
    box.dataset.legend = "1";
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    const trim = (s) => s.replace(/^[\s·]+|[\s·]+$/g, "");
    for (const node of texts) {
      if (!/[✕◆✓●]/.test(node.nodeValue)) continue;
      const parts = node.nodeValue.split(/([✕◆✓●])/);
      const frag = document.createDocumentFragment();
      if (trim(parts[0])) frag.appendChild(document.createTextNode(parts[0].replace(/[\s·]+$/, " ")));
      for (let i = 1; i < parts.length; i += 2) {
        const item = el("span", { class: "legend-item" }, frag);
        const g = glyph(LEGEND[parts[i]][0], LEGEND[parts[i]][1]);
        g.setAttribute("role", "img");
        g.setAttribute("aria-label", parts[i]);
        item.appendChild(g);
        const words = trim(parts[i + 1] || "");
        if (words) el("span", { text: words }, item);
      }
      node.parentNode.replaceChild(frag, node);
    }
    return box;
  }

  const registry = new Map();
  let booted = false;
  /** Base.section(id, init): init(root, data) runs once the page is parsed; data holds every file the root's
   *  data-needs names, keyed by name without ".json". The root gets data-ready="1" when init resolves. */
  function section(id, init) {
    registry.set(id, init);
    if (booted) runSection(id);
  }
  async function runSection(id) {
    const root = document.querySelector(`[data-section="${id}"]`);
    if (!root) return;
    const init = registry.get(id);
    try {
      if (init) {
        const names = (root.dataset.needs || "").split(/\s+/).filter(Boolean);
        const files = await Promise.all(names.map(data));
        const d = {};
        names.forEach((n, i) => { d[n.replace(/\.json$/, "")] = files[i]; });
        await init(root, d);
      }
      root.dataset.ready = "1";
    } catch (err) {
      root.dataset.ready = "error";
      console.error(`section ${id}:`, err);
    }
  }
  async function boot() {
    booted = true;
    renderRail();
    anchors();
    $$(".legend-marks").forEach(legend);
    const ids = $$("[data-section]").map((r) => r.dataset.section);
    await Promise.all(ids.map(runSection));
    $$(".clip[data-clip]").forEach((div) => clip(div).catch((err) => console.error(err)));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => mounts.forEach((r) => r()));
    document.documentElement.dataset.ready = "1";
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else setTimeout(boot, 0);

  window.Base = {
    reduced, $, $$, el, svg, mark, glyph, textWidth, data, mount, unmount, isPhone, on, emit, tooltip, lens, applyFog,
    clip, follow, piecewise, syncPiecewise, timeScale, sampler, ribbon, tape, rail, gauge, keyhole, rounds,
    loopGlyph, STATION, report, said, diff, softBreaks, paperTable, copy, ladder, legend, section,
  };
})();
