/* Part 3 (DESIGN_SPEC §3.10): the paper's Figure 11 with its own numbers, in the page's vocabulary. The 73 human-solved
   test cases flow through the capability the agents were missing to every lever that solves them, a case solved several
   ways split equally among its levers (so a lever's share is credit, not cases it adds); the stepper switches the
   levers on one at a time and the meter under the sankey fills one segment per lever.
   Only node badges are printed. Link masses set widths, and a tooltip may give one, rounded to 0.1, as "credited
   cases"; no cumulative share is ever written out, the meter's length carries it. */
(function () {
  "use strict";
  const S = (tag, attrs, parent) => Base.svg(tag, attrs, parent);
  const tw = (text, font) => Base.textWidth(text, font);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const SANS = (px, w) => `${w} ${px}px Manrope, "Helvetica Neue", Arial, sans-serif`;
  const NUM = (px) => `600 ${px}px "Barlow Condensed", "Arial Narrow", sans-serif`;
  const F = { capName: SANS(12.5, 600), capNameV: SANS(11.5, 600), routeName: SANS(13, 700), startText: SANS(12.5, 500) };
  const PCT = 0.6;            // the "%" is set smaller than its numeral (§1.2)
  const BAR = 10;             // thickness of the start and route nodes
  const GLYPH = { spatial: "coverage-k-spatial", motion: "k-motion", temporal: "k-grasp", perception: "k-perception",
    composition: "k-decide" };
  // what a vertical chip prints when its full name does not fit (the index below names each one in full)
  const SHORT = { spatial: "Spatial", motion: "Motion", temporal: "Manipulation", perception: "Perception",
    composition: "Composition" };
  // the lever ramp (§1.1); the CSS keys the same colours off data-route
  const LEVER = { zero_shot: "--ink", self_learning: "--o1", sim_feedback: "--o2", task_skills: "--o3",
    newer_model: "--lever-model" };
  // where the page studies each capability and lever (the index rows carry the same links)
  const STUDIED = { spatial: "Findings 4 and 5", motion: "Finding 5", temporal: "the problem, Part 1",
    perception: "Findings 3 and 6", composition: "Finding 2", self_learning: "the loop, Part 2",
    sim_feedback: "Findings 3 and 4", task_skills: "Finding 2", newer_model: "Finding 1" };

  const badge = (n) => (n.col === 0 ? String(n.badge) : n.badge.toFixed(1));
  // a route's badge in words: the zero-shot rate is not split; every other lever's is its share of the credit, a case
  // solved several ways being split equally among the levers that solve it
  const share = (n) => (n.id === "zero_shot" ? "solves " : n.id === "unsolved" ? "" : "credited with ")
    + `${badge(n)}% of the cases`;
  // a vertical chip's width when it holds a name: glyph, 5 px, name, 8 px either side
  const named = (name) => 14 + 5 + tw(name, F.capNameV) + 16;
  const badgeWidth = (n, px) => tw(badge(n), NUM(px)) + (n.col ? tw("%", NUM(px * PCT)) + 1 : 0);
  function badgeText(parent, n, px, attrs) {
    const t = S("text", attrs, parent);
    t.appendChild(document.createTextNode(badge(n)));
    if (n.col) S("tspan", { class: "pct", "font-size": px * PCT, dx: 1, text: "%" }, t);
    return t;
  }
  function wrap(text, maxW, font) {
    const lines = [];
    let cur = "";
    for (const word of text.split(" ")) {
      const next = cur ? cur + " " + word : word;
      if (cur && tw(next, font) > maxW) { lines.push(cur); cur = word; } else cur = next;
    }
    return cur ? lines.concat(cur) : lines;
  }

  /* ================================================================ the sankey (v1 Viz.sankey, ported)
     sankey(box, d, {orientation, onHover(key|null), onPick(key)}) → {highlight(routeIds, emphasis), step(i), isolate(key)}.
     orientation is "horizontal", "vertical" or "auto" (vertical when the box is too narrow for the labelled chips, as
     on phones). Columns are laid out along a, nodes stacked across b; horizontal maps (a, b) → (x, y), vertical → (b, a). */
  function sankey(box, d, opts) {
    const o = { orientation: "auto", ...opts };
    const start = d.nodes.find((n) => n.col === 0);
    const caps = d.nodes.filter((n) => n.col === 1);
    const routes = d.nodes.filter((n) => n.col === 2);
    const byId = Object.fromEntries(d.nodes.map((n) => [n.id, n]));
    const total = d.total_cases;
    const inflow = {};
    for (const l of d.links) inflow[l.target] = (inflow[l.target] || 0) + l.mass;
    const mass = (n) => (n.col === 0 ? total : inflow[n.id]);
    const zs = routes[0];
    const tip = Base.tooltip(box);
    const state = { lit: null, emph: null, iso: null };
    let view = null;

    const chipW = (n) => 9 + 14 + 7 + tw(n.label, F.capName) + 10 + badgeWidth(n, 16) + 9;
    function layoutH(w) {
      const top = 30, H = 420, pad = 12, CAP = 8;
      const k = (H - pad * (routes.length - 1)) / total;
      const routeLab = Math.max(...routes.map((n) => tw(n.label, F.routeName) + 8 + badgeWidth(n, 17)));
      const a0 = Math.round(clamp(w * 0.14, 104, 150));
      const a2 = Math.round(w - routeLab - 12 - BAR);
      const chipMax = Math.max(...caps.map(chipW));
      const a1 = Math.round(Math.min(a0 + (a2 - a0) * 0.4, a2 - CAP - 6 - chipMax - 60));
      if (a1 - a0 < 90) return null;
      const pos = {};
      let b = top;
      for (const n of routes) { pos[n.id] = { a: a2, t: BAR, b, len: mass(n) * k }; b += mass(n) * k + pad; }
      b = top;
      pos.slot = { a: a1, t: CAP, b, len: mass(zs) * k };   // where the zero-shot flow crosses the middle column
      b += mass(zs) * k + pad;
      for (const n of caps) { pos[n.id] = { a: a1, t: CAP, b, len: mass(n) * k }; b += mass(n) * k + pad; }
      pos.start = { a: a0, t: BAR, b: top + (H - total * k) / 2, len: total * k };
      return { vertical: false, w, h: top + H + 4, k, pos, heads: [[a1, 14], [a2, 14]] };
    }
    function layoutV(w) {
      // A capability is a chip that names itself when its box has room (else its glyph alone, named in the index below
      // and in a callout once tapped); each row spreads across the width so the fans have room. Text never sits on a
      // flow: the feeds stop at a strip over the chips that holds "What was missing" and the capability badges, and
      // under the route bars come their badges, then "What solved it". The meter names the routes in their colours.
      const CHIP = 24, gap = 6;
      const capRow = [{ id: "slot", m: mass(zs), need: () => 0 }].concat(caps.map((n) => ({ id: n.id, m: mass(n), need: (fit) => fit(n) })));
      const routeRow = routes.map((n) => ({ id: n.id, m: mass(n), need: () => 12 }));
      const width = (row, k, fit) => row.reduce((s, it) => s + Math.max(it.m * k, it.need(fit)), 0) + gap * (row.length - 1);
      // the largest flow scale at which both rows fit when each chip must hold fit(n) px
      const scale = (fit) => {
        let lo = 0.5, hi = 10;
        for (let i = 0; i < 30; i++) {
          const k = (lo + hi) / 2;
          if (width(capRow, k, fit) <= w && width(routeRow, k, fit) <= w && total * k <= w) lo = k; else hi = k;
        }
        return lo;
      };
      // a name in every chip is worth narrower flows, down to 70% of the glyph-only scale (a tablet affords it, a phone not)
      const kGlyph = scale(() => 26), kNamed = scale((n) => named(SHORT[n.id]));
      const k = (kNamed >= 0.7 * kGlyph ? kNamed : kGlyph) * 0.9;   // the rest of each row goes to its gaps
      // spare width beyond the minimum gaps widens chips to hold their names: short names first, then full ones, the
      // widest flows first
      const boxes = new Map(capRow.map((it) => [it.id, Math.max(it.m * k, it.need(() => 26))]));
      let spare = w - width(capRow, k, () => 26);
      const byMass = caps.slice().sort((p, q) => mass(q) - mass(p));
      for (const label of [(n) => SHORT[n.id], (n) => n.label]) {
        for (const n of byMass) {
          const grow = named(label(n)) - boxes.get(n.id);
          if (grow > 0 && grow <= spare) { boxes.set(n.id, boxes.get(n.id) + grow); spare -= grow; }
        }
      }
      const pos = {};
      const place = (row, t, box) => {
        const bs = row.map(box);
        const extra = (w - bs.reduce((s, v) => s + v, 0)) / (row.length - 1);
        let x = 0;
        row.forEach((it, i) => {
          const c = x + bs[i] / 2;
          pos[it.id] = { t, b: c - (it.m * k) / 2, len: it.m * k, box: [x, x + bs[i]] };
          x += bs[i] + extra;
        });
      };
      place(capRow, CHIP, (it) => boxes.get(it.id));
      place(routeRow, BAR, (it) => Math.max(it.m * k, 12));
      // how many staggered lines each row's badges take decides the height of the strips that hold them
      const lines = (row) => 1 + Math.max(...stagger(row.map((n) => ({ c: pos[n.id].b + pos[n.id].len / 2, w: badgeWidth(n, 15) })), w)
        .map((it) => it.level));
      const BADGE = 16, HEAD = 24;
      const a0 = 66, feedEnd = a0 + BAR + 130, a1 = feedEnd + HEAD + BADGE * lines(caps), a2 = a1 + CHIP + 230;
      for (const it of capRow) Object.assign(pos[it.id], { a: a1, in: feedEnd });
      for (const it of routeRow) pos[it.id].a = a2;
      pos.start = { a: a0, t: BAR, b: (w - total * k) / 2, len: total * k };
      const routeBase = a2 + BAR + 15, solvedY = routeBase + BADGE * (lines(routes) - 1) + 24;
      // the column heads start right of the zero-shot band, which runs down the left edge
      const hb = Math.max(pos.slot.box[1], pos[zs.id].box[1]) + 8;
      return { vertical: true, w, h: solvedY + 6, k, pos, routeBase, heads: [[feedEnd + 13, hb], [solvedY, hb]] };
    }
    /* badges centred on their nodes along one line; one that would touch its left neighbour drops to a second line */
    function stagger(items, w) {
      const last = [-Infinity, -Infinity];
      for (const it of items) {
        it.x = clamp(it.c - it.w / 2, 0, w - it.w);
        it.level = it.x < last[0] + 6 ? 1 : 0;
        if (it.level) it.x = Math.max(it.x, last[1] + 6);
        last[it.level] = it.x + it.w;
      }
      return items;
    }

    function draw(w) {
      box.querySelectorAll(":scope > svg").forEach((s) => s.remove());
      tip.hide();
      const L = o.orientation === "vertical" ? layoutV(w)
        : (o.orientation === "horizontal" || w >= 700) && layoutH(w) || layoutV(w);
      const V = L.vertical, P = V ? (a, b) => `${b},${a}` : (a, b) => `${a},${b}`;
      const rect = (a, b, t, len, attrs, parent) => S("rect", { ...(V ? { x: b, y: a, width: len, height: t } : { x: a, y: b, width: t, height: len }), ...attrs }, parent);
      const svg = S("svg", { class: "sankey" + (V ? " vertical" : ""), viewBox: `0 0 ${w} ${L.h}`, width: w, height: L.h });
      box.insertBefore(svg, box.firstChild);
      // layers in reading (and tab) order: flows, bars, the 73's label, capability chips, routes
      const gFlows = S("g", { class: "flows" }, svg), gNodes = S("g", { class: "nodes" }, svg), gLabels = S("g", { class: "labels" }, svg);
      const gCaps = S("g", { class: "caps" }, svg), gRoutes = S("g", { class: "routes" }, svg);

      // column heads, in our words
      const [[ha1, hb1], [ha2, hb2]] = L.heads;
      S("text", { class: "col-head", ...(V ? { x: hb1, y: ha1 } : { x: ha1, y: hb1 }), text: "What was missing" }, gLabels);
      S("text", { class: "col-head", ...(V ? { x: hb2, y: ha2 } : { x: ha2, y: hb2 }), text: "What solved it" }, gLabels);

      // flows: each node's outgoing links stack in data order, which is the target column's order
      const outAt = {}, inAt = {};
      const curve = (a0, b0, a1, b1) => { const m = (a0 + a1) / 2; return `C${P(m, b0)} ${P(m, b1)} ${P(a1, b1)}`; };
      const entry = (n) => (n.in != null ? n.in : n.a);   // where flows into a node end: its strip's top, or the node
      const flows = d.links.map((l) => {
        const th = l.mass * L.k, s = L.pos[l.source], t = L.pos[l.target];
        const bs = s.b + (outAt[l.source] || 0) + th / 2, bt = t.b + (inAt[l.target] || 0) + th / 2;
        outAt[l.source] = (outAt[l.source] || 0) + th;
        inAt[l.target] = (inAt[l.target] || 0) + th;
        let path = `M${P(s.a + s.t, bs)} `;
        if (l.target === zs.id) {   // zero-shot needed no capability: it crosses the middle column in its own slot
          const v = L.pos.slot, bv = v.b + th / 2;
          path += `${curve(s.a + s.t, bs, entry(v), bv)} L${P(v.a + v.t, bv)} ${curve(v.a + v.t, bv, t.a, bt)}`;
        } else path += curve(s.a + s.t, bs, entry(t), bt);
        const route = byId[l.target].col === 2 ? l.target : null;
        const p = S("path", { class: "flow" + (route ? " route" : " feed"), d: path, "data-route": route, "data-s": l.source,
          "data-t": l.target, style: `stroke-width:${Math.max(0.75, th).toFixed(2)}px` }, gFlows);
        const src = byId[l.source], dst = byId[l.target];
        const title = l.source === start.id ? (route ? dst.label : `Missing: ${dst.label}`) : `${src.label} → ${dst.label}`;
        const rows = [{ text: `credited cases (Figure 11 data): ${l.mass.toFixed(1)}` }];
        p.addEventListener("pointermove", (e) => {
          const r = box.getBoundingClientRect();
          tip.show(e.clientX - r.left, e.clientY - r.top, title, rows);
        });
        p.addEventListener("pointerleave", () => tip.hide());
        return { el: p, l, route };
      });

      // the start node: the 73 cases
      const sp = L.pos.start;
      rect(sp.a, sp.b, sp.t, sp.len, { class: "snode", rx: 2 }, gNodes);
      if (V) {
        badgeText(gLabels, start, 44, { class: "start-num", x: 0, y: sp.a - 12 });
        const nx = badgeWidth(start, 44) + 10;
        const lines = wrap(start.label.replace(/^Test/, "test"), w - nx, F.startText);
        lines.forEach((line, i) => S("text", { class: "start-text", x: nx, y: sp.a - 12 - (lines.length - 1 - i) * 17, text: line }, gLabels));
      } else {
        const lines = wrap(start.label.replace(/^Test/, "test"), sp.a - 24, F.startText);
        const cy = sp.b + sp.len / 2, top = cy - (40 + lines.length * 17) / 2;
        badgeText(gLabels, start, 44, { class: "start-num", x: sp.a - 12, y: top + 34, "text-anchor": "end" });
        lines.forEach((line, i) => S("text", { class: "start-text", x: sp.a - 12, y: top + 57 + i * 17, "text-anchor": "end", text: line }, gLabels));
      }

      // capabilities: chips with Part 1's kind glyphs
      const chips = new Map(), fullName = new Set();
      for (const n of caps) {
        const p = L.pos[n.id];
        const g = S("g", { class: "cap", "data-cap": n.id, role: "button", "aria-label": `${n.label}, ${badge(n)}% of the cases; isolate its flows` }, gCaps);
        if (V) {
          const [x0, x1] = p.box, cy = p.a + p.t / 2;
          S("rect", { class: "chip-box", x: x0, y: p.a, width: x1 - x0, height: p.t, rx: 6 }, g);
          // glyph and name centred as one group; the full name if the box holds it, else the short one, else the glyph
          const name = [n.label, SHORT[n.id]].find((s) => named(s) <= x1 - x0 + 0.01);
          const gx = name ? (x0 + x1) / 2 - (5 + tw(name, F.capNameV)) / 2 : (x0 + x1) / 2;
          Base.mark(g, GLYPH[n.id], gx, cy, { size: 14, cls: "cap-glyph", halo: false });
          if (name) S("text", { class: "cap-name", x: gx + 12, y: cy + 4, text: name }, g);
          if (name === n.label) fullName.add(n.id);
        } else {
          rect(p.a, p.b, p.t, p.len, { class: "cap-node", rx: 2 }, gNodes);
          const cy = p.b + p.len / 2, x = p.a + p.t + 6, cw = chipW(n);
          S("rect", { class: "chip-box", x, y: cy - 12, width: cw, height: 24, rx: 6 }, g);
          Base.mark(g, GLYPH[n.id], x + 16, cy, { size: 14, cls: "cap-glyph", halo: false });
          S("text", { class: "cap-name", x: x + 30, y: cy + 4.4, text: n.label }, g);
          badgeText(g, n, 16, { class: "cap-badge", x: x + cw - 9, y: cy + 5.4, "text-anchor": "end" });
        }
        tip.bind(g, () => ({ title: `${n.label} · ${badge(n)}%`, rows: [
          { text: `credited cases (Figure 11 data): ${mass(n).toFixed(1)}` }, { text: `studied in ${STUDIED[n.id]}` }] }));
        g.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse" && o.onHover) o.onHover(n.id); });
        g.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && o.onHover) o.onHover(null); });
        g.addEventListener("focus", () => o.onHover && o.onHover(n.id));
        g.addEventListener("blur", () => o.onHover && o.onHover(null));
        g.addEventListener("click", () => o.onPick && o.onPick(n.id));
        g.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (o.onPick) o.onPick(n.id); }
          if (e.key === "Escape" && o.onPick) o.onPick(null);
        });
        chips.set(n.id, g);
      }
      if (V) {   // capability badges in the strip above their chips
        const items = caps.map((n) => ({ n, c: L.pos[n.id].b + L.pos[n.id].len / 2, w: badgeWidth(n, 15) }));
        for (const it of stagger(items, w)) {
          badgeText(chips.get(it.n.id), it.n, 15, { class: "cap-badge", x: it.x, y: L.pos[it.n.id].a - 7 - it.level * 16 });
        }
      }

      // routes, coloured by the lever ramp; Unsolved is hatched
      const nodes = new Map();
      for (const n of routes) {
        const p = L.pos[n.id];
        const g = S("g", { class: "route", "data-route": n.id, role: "img", "aria-label": `${n.label}: ${share(n)}` }, gRoutes);
        rect(p.a, p.b, p.t, p.len, { class: "rnode", rx: 2 }, g);
        if (!V) {
          const cy = p.b + p.len / 2, x = p.a + p.t + 8;
          S("text", { class: "route-name", x, y: cy + 4.6, text: n.label }, g);
          badgeText(g, n, 17, { class: "route-badge", x: x + tw(n.label, F.routeName) + 8, y: cy + 5.6 });
        }
        tip.bind(g, () => ({ title: `${n.label} · ${badge(n)}%`, rows: [
          { text: `credited cases (Figure 11 data): ${mass(n).toFixed(1)}`, color: LEVER[n.id] ? `var(${LEVER[n.id]})` : null },
          ...(STUDIED[n.id] ? [{ text: `studied in ${STUDIED[n.id]}` }] : [])] }));
        nodes.set(n.id, g);
      }
      if (V) {   // route badges under their bars, staggered as the capability badges are
        const items = routes.map((n) => ({ n, c: L.pos[n.id].b + L.pos[n.id].len / 2, w: badgeWidth(n, 15) }));
        for (const it of stagger(items, w)) {
          badgeText(nodes.get(it.n.id), it.n, 15, { class: "route-badge", x: it.x, y: L.routeBase + it.level * 16 });
        }
      }
      const callout = V ? S("g", { class: "callout", "aria-hidden": "true" }, svg) : null;
      view = { svg, flows, chips, fullName, nodes, vertical: V, callout, L };
      paint();
    }

    function paint() {
      if (!view) return;
      const { lit, emph, iso } = state;
      for (const f of view.flows) {
        f.el.classList.toggle("dim", !!lit && !!f.route && !lit.has(f.route));
        f.el.classList.toggle("new", !!emph && f.route === emph);
        f.el.classList.toggle("iso", !!iso && (f.l.source === iso || f.l.target === iso));
      }
      view.svg.classList.toggle("isolating", !!iso);
      for (const [id, g] of view.nodes) g.classList.toggle("later", !!lit && !lit.has(id));
      for (const [id, g] of view.chips) g.classList.toggle("on", iso === id);
      // on the vertical sankey a chip may show only its glyph or a short name, so the isolated one names itself in full
      // just under the chip
      if (view.callout) {
        view.callout.replaceChildren();
        const n = iso && view.chips.has(iso) && !view.fullName.has(iso) ? byId[iso] : null;
        if (n) {
          const p = view.L.pos[n.id], text = `${n.label} · ${badge(n)}%`;
          const cw = tw(text, F.capName) + 20, x = clamp((p.box[0] + p.box[1]) / 2 - cw / 2, 0, view.L.w - cw), y = p.a + p.t + 8;
          S("rect", { x, y, width: cw, height: 24, rx: 6 }, view.callout);
          S("text", { x: x + 10, y: y + 16.4, text }, view.callout);
        }
      }
    }

    Base.mount(box, draw);
    return {
      /** lights the routes in routeIds (null: every route, the static figure); emphasis is the one just added */
      highlight(routeIds, emphasis) { state.lit = routeIds ? new Set(routeIds) : null; state.emph = emphasis || null; paint(); },
      /** step i (0 = zero-shot … 4 = + newer model): levers up to i in their colour, the one just added emphasised. The
       *  last step switches every lever on and adds Unsolved, which is the static figure, drawn exactly as it opens. */
      step(i) {
        if (i == null || i >= routes.length - 2) return this.highlight(null);
        this.highlight(routes.slice(0, i + 1).map((n) => n.id), routes[i].id);
      },
      /** isolates one capability's (or route's) flows; null clears */
      isolate(key) { state.iso = key || null; paint(); },
    };
  }

  /* ================================================================ the coverage meter
     One bar for the 73 cases, a segment per route in the routes' order, each labelled with its badge; step(i) fills it
     up to lever i (the last step adds Unsolved) by tweening one extent across the segments, so it grows segment by
     segment. */
  function meter(svgEl, d) {
    const routes = d.nodes.filter((n) => n.col === 2);
    const total = d.total_cases;
    const inflow = {};
    for (const l of d.links) inflow[l.target] = (inflow[l.target] || 0) + l.mass;
    const ends = [];
    routes.reduce((s, n) => { ends.push(s + inflow[n.id] / total); return ends[ends.length - 1]; }, 0);
    let W = 0, segs = [], extent = 1, last = routes.length - 1, raf = 0;

    const apply = () => segs.forEach((s) => {
      const v = clamp(extent * W - s.x, 0, s.w);
      s.rect.setAttribute("width", Math.max(0, v - (v >= s.w - 0.01 && s.i < routes.length - 1 ? 2 : 0)).toFixed(2));
    });
    function draw(w) {
      W = w;
      svgEl.replaceChildren();
      const labY = 18, barY = 28, barH = 16, h = barY + barH + 2;
      svgEl.setAttribute("viewBox", `0 0 ${w} ${h}`);
      svgEl.setAttribute("height", h);
      S("rect", { class: "meter-track", x: 0.5, y: barY + 0.5, width: w - 1, height: barH - 1, rx: 3 }, svgEl);
      // labels centred on their segments, pushed apart where segments are narrower than their labels
      const labs = routes.map((n, i) => {
        const x0 = (i ? ends[i - 1] : 0) * w, x1 = ends[i] * w, lw = badgeWidth(n, 17);
        return { n, i, x0, x1, c: (x0 + x1) / 2, lw, x: 0 };
      });
      let prev = -Infinity;
      for (const L of labs) { L.x = Math.max(L.c - L.lw / 2, 0, prev + 8); prev = L.x + L.lw; }
      let next = Infinity;
      for (const L of labs.slice().reverse()) { L.x = Math.min(L.x, w - L.lw, next - 8 - L.lw); next = L.x; }
      segs = labs.map((L) => {
        const g = S("g", { class: "seg", "data-route": L.n.id }, svgEl);
        const rect = S("rect", { class: "seg-bar", x: L.x0, y: barY, height: barH, width: 0, rx: L.i === 0 ? 3 : 0 }, g);
        S("path", { class: "seg-tick", d: `M${(L.x + L.lw / 2).toFixed(1)},${labY + 3} L${L.c.toFixed(1)},${barY - 2}` }, g);
        badgeText(g, L.n, 17, { class: "seg-badge", x: L.x, y: labY });
        S("title", { text: `${L.n.label}: ${share(L.n)}` }, g);
        return { g, rect, i: L.i, x: L.x0, w: L.x1 - L.x0 };
      });
      paintOn();
      apply();
    }
    const paintOn = () => segs.forEach((s) => s.g.classList.toggle("on", s.i <= last));
    function tween(to, animate) {
      cancelAnimationFrame(raf);
      if (!animate || Base.reduced) { extent = to; apply(); return; }
      const from = extent, t0 = performance.now(), dur = 400;
      const tick = (now) => {
        const p = Math.min(1, (now - t0) / dur);
        extent = from + (to - from) * (1 - Math.pow(1 - p, 3));
        apply();
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    Base.mount(svgEl, draw);
    return {
      /** fills the meter up to lever i (null or the last lever: every segment, Unsolved included) */
      step(i, animate) {
        last = i == null || i >= routes.length - 2 ? routes.length - 1 : i;
        paintOn();
        tween(ends[last], animate);
      },
      empty() { cancelAnimationFrame(raf); extent = 0; apply(); },
    };
  }

  /* ================================================================ the section */
  Base.section("coverage", async (root, data) => {
    const d = data.sankey;
    const $ = (sel) => root.querySelector(sel);
    const byId = Object.fromEntries(d.nodes.map((n) => [n.id, n]));
    const caps = d.nodes.filter((n) => n.col === 1), routes = d.nodes.filter((n) => n.col === 2);
    const pct = (id) => `${badge(byId[id])}%`;
    const readout = $("#coverage-readout");

    // one sentence per state; every number is a node badge. A lever's badge is its share of the credit, not cases it
    // adds: a case solved several ways is split equally among the levers that solve it. Zero-shot is a rate, not split.
    const STEP = [
      `Zero-shot: the agent's first program alone solves ${pct("zero_shot")} of the cases.`,
      `+ Self-learning: running the program and editing it from what happened is credited with ${pct("self_learning")} of the cases.`,
      `+ Simulation feedback: richer reports from the simulator are credited with ${pct("sim_feedback")} of the cases.`,
      `+ Human task skills: skills people wrote for the task are credited with ${pct("task_skills")} of the cases.`,
      `+ Newer model: a stronger model is credited with ${pct("newer_model")} of the cases. With all five levers on, only `
        + `${pct("unsolved")} of the ${d.total_cases} cases stay unsolved.`,
    ];
    const isoText = (key) => {
      const n = byId[key];
      return n.col === 1
        ? `${n.label}: what the agents were missing in ${pct(key)} of the cases. Its flows end at the levers credited with them.`
        : `${n.label}: ${share(n)}.`;
    };
    let stepText = "", pinned = null, hover = null;
    const showIso = () => {
      const key = hover || pinned;
      sk.isolate(key);
      root.querySelectorAll(".cov-rows li").forEach((li) => li.classList.toggle("on", (li.dataset.cap || li.dataset.route) === key));
      readout.textContent = key ? isoText(key) : stepText;
    };

    const sk = sankey($("#coverage-sankey"), d, {
      onHover(key) { hover = key; showIso(); },
      onPick(key) { pinned = key && pinned !== key ? key : null; showIso(); },
    });
    const m = meter($("#coverage-meter"), d);

    function setStep(i, animate) {
      sk.step(i);
      m.step(i, animate);
      stepText = STEP[i];
      showIso();
    }

    let timer = 0, replaying = false;
    const stopReplay = () => { clearTimeout(timer); timer = 0; };
    const lens = Base.lens($("#coverage-step"), (key) => { if (!replaying) stopReplay(); setStep(+key, true); });
    $("#coverage-replay").addEventListener("click", () => {
      stopReplay();
      pinned = hover = null;
      m.empty();
      replaying = true;
      lens.set("0");
      replaying = false;
      setStep(0, true);
      if (Base.reduced) return;   // no auto-step: the reader steps on with the buttons
      let i = 0;
      const next = () => {
        i += 1;
        replaying = true;
        lens.set(String(i));
        replaying = false;
        timer = i < STEP.length - 1 ? setTimeout(next, 900) : 0;
      };
      timer = setTimeout(next, 900);
    });
    root.querySelectorAll(".cov-rows li").forEach((li) => {
      const key = li.dataset.cap || li.dataset.route;
      li.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") { hover = key; showIso(); } });
      li.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") { hover = null; showIso(); } });
      li.addEventListener("focusin", () => { hover = key; showIso(); });
      li.addEventListener("focusout", () => { hover = null; showIso(); });
    });
    setStep(STEP.length - 1, false);   // the lens opens on "+ Newer model": every lever on

    // what is drawn, for screen readers and the Data drawer
    const list = (ns) => ns.map((n) => `${n.label.toLowerCase()} ${badge(n)}%`).join(", ");
    $("#coverage-sankey").setAttribute("aria-label", `The ${d.total_cases} VABAR Level-1 test cases a human policy solves, by the `
      + `capability the agents were missing (${list(caps)}) and the levers credited with solving them (${list(routes)}). `
      + `A case solved several ways is split equally among its levers.`);
    $("#coverage-meter").setAttribute("aria-label", `The ${d.total_cases} cases, each split equally among the levers that `
      + `solve it: ${list(routes)}.`);
    const table = Base.el("table", {});
    const head = Base.el("tr", {}, Base.el("thead", {}, table));
    for (const h of ["Node", "Column", "Badge"]) Base.el("th", { text: h }, head);
    const body = Base.el("tbody", {}, table);
    const COL = ["test cases", "what was missing", "what solved it"];
    for (const n of d.nodes) {
      const tr = Base.el("tr", {}, body);
      Base.el("td", { text: n.label }, tr);
      Base.el("td", { text: COL[n.col] }, tr);
      Base.el("td", { text: n.col === 0 ? `${badge(n)} cases` : `${badge(n)}%` }, tr);
    }
    $("#coverage-table").replaceChildren(table);
  });
})();
