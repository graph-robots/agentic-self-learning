/* Finding 1 (Model): a slopegraph of overall success @0 → @1 → @2 whose lines fan out from one band, with each model's
   classified edits (Figure 4's data) as a row of squares beside its @2 end; then the USB-C pair, two programs after
   two rounds on one layout. */
Base.section("f1", async (root, d) => {
  const $ = (sel) => root.querySelector(sel);
  const SRC = "tables/model_table.tex";
  const CLASSES = [
    ["fixed", "fixed, success rose"],
    ["cleared", "fixed, no gain"],
    ["same", "same failure"],
    ["moved", "a different failure"],
  ];
  const KEY_LEAD = "Each square is one edit, classified by its outcome (the paper's Figure 4 data):";
  const ROUND_SUB = ["first policy", "after 1 round", "after 2 rounds"];
  const NUM = (px) => `600 ${px}px "Barlow Condensed", "Arial Narrow", sans-serif`;
  const SANS = (px, w) => `${w || 700} ${px}px Manrope, "Helvetica Neue", Arial, sans-serif`;

  // the eight models of Table 1 at their default budget; the effort variants are not drawn
  const edits = new Map(d.edit_outcomes.rows.map((r) => [r.label, r]));
  const models = d.models.models.filter((m) => m.variant === "main").map((m) => ({
    id: m.id, label: m.label, group: m.group, v: m.success.overall, edits: edits.get(m.label) || null,
  }));
  const LAYER = { context: 0, flat: 1, repairs: 2 };
  models.sort((a, b) => LAYER[a.group] - LAYER[b.group]);
  const focal = models.filter((m) => m.group !== "context");
  const human = d.models.human.overall;
  const band = [Math.min(...focal.map((m) => m.v[0])), Math.max(...focal.map((m) => m.v[0]))];
  const byLabel = (label) => models.find((m) => m.label === label);

  const svgEl = $("#f1-slope");
  const tip = Base.tooltip($("#f1-wrap"));
  let s = 2, target = 2, all = true, raf = 0, L = null;

  const valueText = (m, k) => (m.id === "opus55" && k === 2 ? `${m.v[0]} → ${m.v[2]}` : String(m.v[k]));
  const labelDx = (m) => (m.group === "context" ? 9 : 11);
  const shown = () => models.filter((m) => all || m.group !== "context");

  /* labels (and repair rows) at their line's y, pushed apart to at least `gap` and kept within [lo, hi] */
  function spread(items, gap, lo, hi) {
    const list = items.slice().sort((a, b) => a.want - b.want);
    list.forEach((it) => { it.y = it.want; });
    for (let pass = 0; pass < 200; pass++) {
      let moved = false;
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1], b = list[i], over = gap - (b.y - a.y);
        if (over <= 0.01) continue;
        moved = true;
        a.y -= over / 2;
        b.y += over / 2;
      }
      for (const it of list) it.y = Math.max(lo, Math.min(hi, it.y));
      if (!moved) break;
    }
    return list;
  }

  function wrap(text, maxW, font) {
    const lines = [];
    let cur = "";
    for (const word of text.split(" ")) {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && Base.textWidth(next, font) > maxW) { lines.push(cur); cur = word; } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function editSquare(parent, cls, x, y, sq) {
    // outlined squares are inset by half their stroke, so every square covers the same box
    const inset = cls === "cleared" || cls === "moved" ? 0.75 : 0;
    return Base.svg("rect", { class: `edit ${cls}`, x: x + inset, y: y + inset, width: sq - 2 * inset, height: sq - 2 * inset, rx: 1.5 }, parent);
  }

  /* the square key under the rows' head: the sentence, then the four classes in the rows' order, two to a line.
     Returns its last baseline. */
  function drawKey(parent, x, y, width, sq) {
    const lead = Base.svg("text", { class: "key-lead", x, y }, parent);
    const lines = wrap(KEY_LEAD, width, SANS(12, 500));
    // every line but the last keeps its trailing space, so the sentence reads whole in the page's text
    lines.forEach((line, i) => Base.svg("tspan", { x, dy: i ? 15 : 0, text: i < lines.length - 1 ? `${line} ` : line }, lead));
    const by = y + (lines.length - 1) * 15 + 19;
    const itemW = Math.max(...CLASSES.map(([, text]) => sq + 6 + Base.textWidth(text, SANS(12, 500)))) + 14;
    const perLine = width + 14 >= 2 * itemW ? 2 : 1;
    CLASSES.forEach(([cls, text], i) => {
      const ix = x + (i % perLine) * itemW, iy = by + Math.floor(i / perLine) * 17;
      editSquare(parent, cls, ix, iy - 4 - sq / 2, sq);
      Base.svg("text", { class: "key-item", x: ix + sq + 6, y: iy, text }, parent);
    });
    return by + (Math.ceil(CLASSES.length / perLine) - 1) * 17;
  }

  function size(w, h) {
    svgEl.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svgEl.setAttribute("height", h);
    svgEl.style.height = h + "px";
  }

  function draw(w) {
    svgEl.replaceChildren();
    const phone = Base.isPhone() || w < 700;
    svgEl.classList.toggle("phone", phone);
    // squares in class order, with a wider gap between classes so each count reads as a group
    const sq = phone ? 8 : 10, sqGap = 2, classGap = phone ? 3 : 4;
    const maxN = Math.max(...d.edit_outcomes.rows.map((r) => r.n));
    const labelW = Math.max(...models.map((m) => Base.textWidth(valueText(m, 2), NUM(phone ? 15 : 17))
      + Base.textWidth(m.label, SANS(phone ? 11.5 : 12.5)) + 6));
    const rowsW = maxN * (sq + sqGap) + (CLASSES.length - 1) * classGap;
    // desktop: slopes on the left, the repair rows in a column to the right of the labels; phone: rows below
    const x0 = phone ? 84 : 132;
    const rx = phone ? 0 : w - rowsW - 4;
    const x2 = phone ? w - labelW - 14 : rx - labelW - 46;
    const x1 = (x0 + x2) / 2;
    const S = (tag, attrs, parent) => Base.svg(tag, attrs, parent || svgEl);
    const xs = [x0, x1, x2];
    const chartH = phone ? 226 : 318;

    // the rows' head and square key: desktop, at the top of the rows' column, with the chart starting low enough for
    // the highest row to clear the key; phone, under the chart, right above the list
    const rows = S("g", { class: "repairs" });
    const headX = phone ? 0 : rx;
    const head = (hy) => {
      S("text", { class: "rows-head", x: headX, y: hy, text: "Why they separate" }, rows);
      return drawKey(rows, headX, hy + 18, w - headX, sq);
    };
    let top = 50, keyEnd = 0;
    if (!phone) {
      keyEnd = head(20);
      const vTop = Math.max(...models.map((m) => m.v[2]));
      top = Math.max(62, keyEnd + 29 - (85 - vTop) / 55 * chartH);
    }
    const y = (v) => top + (85 - v) / 55 * chartH;
    const chartBottom = y(30);
    if (phone) keyEnd = head(chartBottom + 40);
    const listTop = keyEnd + 24, listRowH = sq + 26;
    if (!phone) size(w, chartBottom + 26);

    // axis: three round columns, gridlines at 40 / 60 / 80, the human reference
    const axis = S("g", { class: "axis" });
    for (const v of [40, 60, 80]) {
      S("line", { class: "grid", x1: 30, x2: x2, y1: y(v), y2: y(v) }, axis);
      S("text", { class: "axis-label", x: 0, y: y(v) + 4, text: `${v}%` }, axis);
    }
    const cols = xs.map((x, k) => {
      const g = S("g", { class: "col", "data-k": k }, axis);
      S("line", { class: "colline", x1: x, x2: x, y1: y(85) - 4, y2: chartBottom }, g);
      S("text", { class: "col-k", x, y: phone ? 16 : 20, "text-anchor": "middle", text: `@${k}` }, g);
      S("text", { class: "col-sub", x, y: phone ? 30 : 37, "text-anchor": "middle", text: phone ? ["first", "1 round", "2 rounds"][k] : ROUND_SUB[k] }, g);
      return g;
    });
    S("line", { class: "human", x1: 30, x2: x2 + 6, y1: y(human), y2: y(human) }, axis);
    S("text", { class: "human-tag", x: 34, y: y(human) - 6, text: `H ${human}` }, axis);

    // the dead heat at @0: a bracket over the four focal models' first-policy scores
    const bx = x0 - 12, b0 = y(band[1]) - 5, b1 = y(band[0]) + 5;
    const br = S("g", { class: "bracket-g" });
    S("path", { class: "bracket", d: `M${bx + 5},${b0} H${bx} V${b1} H${bx + 5}` }, br);
    S("text", { class: "bracket-label", x: bx - 6, y: (b0 + b1) / 2 + 6, "text-anchor": "end", text: `${band[0]}–${band[1]}%` }, br);

    // repair rows: desktop, a column at the right; phone, a list under the chart (by success @2). Before @2 each
    // row's squares sit under one fog bar, the page's "not shown yet", with a note under the rows.
    const hidden = S("text", { class: "rows-note", x: headX, text: "Step to @2 to see each model's edits." });

    const lines = S("g", { class: "lines" });
    const labels = S("g", { class: "labels" });
    const items = new Map();
    for (const m of models) {
      const g = S("g", { class: "model", "data-id": m.id, "data-group": m.group }, lines);
      const hit = S("path", { class: "hit" }, g);
      const path = S("path", { class: "slope" }, g);
      const pts = m.v.map((v, k) => S("circle", { class: "pt", cx: xs[k], cy: y(v), r: m.group === "context" ? 3.5 : 4.5 }, g));
      S("title", { text: `${m.label}: ${m.v.join("% → ")}%` }, g);
      const lab = S("g", { class: "label", "data-id": m.id, "data-group": m.group, tabindex: -1 }, labels);
      const leader = S("line", { class: "leader" }, lab);
      const text = S("text", {}, lab);
      const val = S("tspan", { class: "v" }, text);
      S("tspan", { class: "n", dx: 5, text: m.label }, text);
      let row = null;
      if (m.edits) {
        row = S("g", { class: "row", "data-id": m.id, "data-group": m.group }, rows);
        const e = m.edits;
        // first, so base's focus ring (on a focused group's first child) outlines the whole row
        const hitBox = S("rect", { class: "row-hit", x: phone ? 0 : -8, y: phone ? -10 : -sq / 2 - 4, height: phone ? listRowH - 4 : sq + 8, rx: 4 }, row);
        if (phone) {
          S("line", { class: "key", "data-group": m.group, x1: 0, x2: 12, y1: 0, y2: 0 }, row);
          S("text", { class: "row-name", x: 18, y: 4, text: m.label }, row);
        } else S("line", { class: "leader dots" }, row);
        const squares = S("g", { class: "sq" }, row);
        let x = 0;
        const sy = phone ? 16 : 0;
        for (const [cls] of CLASSES) {
          for (let j = 0; j < e[cls]; j++, x += sq + sqGap) editSquare(squares, cls, x, sy - sq / 2, sq);
          if (e[cls]) x += classGap;
        }
        S("rect", { class: "fogbar", x: 0, y: sy - sq / 2, width: x - sqGap - classGap, height: sq, rx: 1.5 }, row);
        hitBox.setAttribute("width", phone ? w : x + 12);
      } else if (!phone) {
        row = S("g", { class: "row none", "data-id": m.id, "data-group": m.group }, rows);
        S("text", { class: "row-none", x: 0, y: 4, text: "not in Figure 4" }, row);
      }
      items.set(m.id, { m, g, hit, path, pts, lab, leader, text, val, row });
      const content = () => ({ title: m.label, rows: describe(m) });
      tip.bind(g, content);
      tip.bind(lab, content);   // hover only: the line already takes the tab stop
      if (row && m.edits) tip.bind(row, content);
      for (const node of [g, lab, row].filter(Boolean)) {
        node.addEventListener("pointerenter", () => setHot(m.id));
        node.addEventListener("pointerleave", () => setHot(null));
        node.addEventListener("focus", () => setHot(m.id));
        node.addEventListener("blur", () => setHot(null));
      }
    }
    L = { phone, w, xs, y, rx, listTop, listRowH, items, cols, rows, hidden, chartBottom, top };
    paint();
  }

  function describe(m) {
    const out = [{ text: `Overall success: @0 ${m.v[0]}% · @1 ${m.v[1]}% · @2 ${m.v[2]}%` }];
    if (!m.edits) out.push({ text: `No edit record: ${m.label} is not in Figure 4.` });
    else {
      out.push({ text: `${m.edits.n} edits, each classified by its outcome:` });
      // each swatch is a background shorthand (f1.css), so the hollow classes stay hollow in the tooltip too
      for (const [cls, text] of CLASSES) out.push({ text: `${m.edits[cls]} ${text}`, color: `var(--sw-${cls})` });
    }
    return out;
  }

  function setHot(id) {
    svgEl.toggleAttribute("data-hot", !!id);
    for (const it of L.items.values()) {
      const on = it.m.id === id;
      it.g.classList.toggle("hot", on);
      it.lab.classList.toggle("hot", on);
      if (it.row) it.row.classList.toggle("hot", on);
    }
  }

  /* everything that moves with the round (s, 0..2, tweened) and the "All models" switch */
  function paint() {
    if (!L) return;
    const { xs, y, phone } = L;
    const k = Math.floor(Math.min(s, 1.999)), f = s - k;
    const headX = xs[k] + (xs[k + 1] - xs[k]) * f;
    const vis = new Set(shown().map((m) => m.id));
    const at = (m) => m.v[k] + (m.v[k + 1] - m.v[k]) * f;
    const shownK = Math.round(s);
    const gap = phone ? 16 : 20;
    const placed = spread(shown().map((m) => ({ id: m.id, want: y(at(m)) })), gap, L.top + 8, L.chartBottom + (phone ? 6 : 14));
    const ly = new Map(placed.map((p) => [p.id, p.y]));
    // the rows keep the @2 layout, whatever the round, so they appear where the labels land
    const final = spread(shown().map((m) => ({ id: m.id, want: y(m.v[2]) })), gap, L.top + 8, L.chartBottom + (phone ? 6 : 14));
    const ry = new Map(final.map((p) => [p.id, p.y]));
    const listOrder = shown().filter((m) => m.edits).sort((a, b) => b.v[2] - a.v[2] || a.label.localeCompare(b.label));

    for (const it of L.items.values()) {
      const m = it.m, on = vis.has(m.id);
      it.g.style.display = on ? "" : "none";
      it.lab.style.display = on ? "" : "none";
      if (it.row) it.row.style.display = on ? "" : "none";
      if (!on) continue;
      const p = [[xs[0], y(m.v[0])]];
      if (s >= 1) p.push([xs[1], y(m.v[1])]);
      if (s > 0.001 && s !== 1) p.push([headX, y(at(m))]);
      const dPath = "M" + p.map((q) => q.map((v) => v.toFixed(1)).join(",")).join(" L");
      it.path.setAttribute("d", dPath);
      it.hit.setAttribute("d", dPath);
      it.pts.forEach((c, j) => c.classList.toggle("off", j > s + 1e-6));
      const hy = y(at(m)), lx = headX + labelDx(m), yy = ly.get(m.id);
      it.leader.setAttribute("x1", headX + 6);
      it.leader.setAttribute("y1", hy);
      it.leader.setAttribute("x2", lx - 3);
      it.leader.setAttribute("y2", yy);
      it.leader.style.display = Math.abs(yy - hy) > 3 ? "" : "none";
      it.text.setAttribute("x", lx);
      it.text.setAttribute("y", yy + 5);
      it.val.textContent = valueText(m, shownK);
      if (!it.row) continue;
      if (phone) {
        const i = listOrder.indexOf(m);
        it.row.setAttribute("transform", `translate(0,${L.listTop + i * L.listRowH})`);
      } else {
        const rowY = ry.get(m.id);
        it.row.setAttribute("transform", `translate(${L.rx},${rowY})`);
        const dots = it.row.querySelector(".leader.dots");
        if (dots) {
          const labelEnd = xs[2] + labelDx(m) + Base.textWidth(valueText(m, 2), NUM(17)) + 5 + Base.textWidth(m.label, SANS(12.5));
          const x1 = labelEnd + 8 - L.rx;
          for (const [a, v] of [["x1", x1], ["x2", -8], ["y1", 0], ["y2", 0]]) dots.setAttribute(a, v);
          dots.style.display = x1 < -14 ? "" : "none";
        }
      }
    }
    const rowsOn = target === 2 && s === 2;
    L.rows.classList.toggle("shown", rowsOn);
    L.hidden.classList.toggle("shown", !rowsOn);
    // the note goes under the rows: on the phone, under the visible list, which also sets the chart's height
    if (phone) {
      const noteY = L.listTop + listOrder.length * L.listRowH + 2;
      L.hidden.setAttribute("y", noteY);
      size(L.w, noteY + 8);
    } else {
      const lowest = Math.max(...shown().filter((m) => L.items.get(m.id).row).map((m) => ry.get(m.id)));
      L.hidden.setAttribute("y", Math.min(lowest + 30, L.chartBottom + 18));
    }
    L.cols.forEach((c, j) => c.classList.toggle("later", j > target));
  }

  const ease = (p) => 1 - Math.pow(1 - p, 3);
  function go(k) {
    target = k;
    cancelAnimationFrame(raf);
    const from = s, t0 = performance.now(), dur = Base.reduced ? 0 : 400;
    if (!dur || from === k) { s = k; paint(); return; }
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      s = p < 1 ? from + (k - from) * ease(p) : k;
      paint();
      if (p < 1) raf = requestAnimationFrame(step);
    };
    paint();
    raf = requestAnimationFrame(step);
  }

  /* the readout: one sentence per state, every number tagged with its table */
  const readout = $("#f1-readout");
  function say() {
    readout.replaceChildren();
    const put = (text) => readout.appendChild(document.createTextNode(text));
    const num = (v) => Base.el("span", { class: "num", "data-src": SRC, text: String(v) }, readout);
    const pct = (label, k) => { put(`${label} `); num(byLabel(label).v[k]); put("%"); };
    const k = target;
    Base.el("b", { text: ["@0, the first policy. ", "@1, after one round of feedback. ", "@2, after two rounds. "][k] }, readout);
    if (k === 0) {
      put("Opus 5, Fable 5.1, GPT-6 Astra and Sonnet 5 all start at ");
      num(band[0]); put("–"); num(band[1]); put("%.");
    } else {
      pct("Opus 5", k); put(" and "); pct("Fable 5.1", k);
      put(k === 1 ? " climb; " : " pull away; ");
      pct("GPT-6 Astra", k); put(" and "); pct("Sonnet 5", k);
      put(k === 1 ? " barely move." : ` stay flat. ${L && L.phone ? "Below" : "On the right"}: what each model's edits did.`);
    }
    if (!all) put(" Other models hidden.");
  }

  /* the screen-reader copy of what is drawn */
  const sr = $("#f1-sr");
  const tr = (cells, tag) => { const r = Base.el("tr", {}, sr); cells.forEach((c) => Base.el(tag || "td", { text: String(c) }, r)); };
  Base.el("caption", { text: "Overall held-out success (%) per round, and each model's edits by outcome (Figure 4's data)" }, sr);
  tr(["Model", "@0", "@1", "@2", ...CLASSES.map(([, t]) => t)], "th");
  for (const m of models) tr([m.label, ...m.v, ...CLASSES.map(([c]) => (m.edits ? m.edits[c] : "–"))]);
  tr(["Human", human, human, human, "–", "–", "–", "–"]);

  const fan = focal.slice().sort((a, b) => b.v[2] - a.v[2]).map((m) => `${m.label} ${m.v[2]}`).join(", ");
  svgEl.setAttribute("aria-label", `Overall held-out success after 0, 1 and 2 rounds of feedback. Opus 5, Fable 5.1, GPT-6 Astra and Sonnet 5 start at ${band[0]}–${band[1]}% and fan out to ${fan}. Each square beside a line is one edit, classified by its outcome; human reference ${human}%.`);

  /* the line key, under the chart: it says what each line does, not why (the squares beside the rows are their own
     key) */
  const names = (group) => focal.filter((m) => m.group === group).sort((a, b) => b.v[2] - a.v[2]).map((m) => m.label).join(", ");
  const lineKey = Base.el("p", { class: "legend-row" }, $("#f1-legend"));
  for (const [group, text] of [["repairs", `pull away after feedback (${names("repairs")})`], ["flat", `stay flat (${names("flat")})`],
    ["context", "other models"], ["human", "H: human expert policy"]]) {
    const it = Base.el("span", { class: "legend-item" }, lineKey);
    const sv = Base.svg("svg", { class: "sw", viewBox: "0 0 18 12", width: 18, height: 12, "aria-hidden": "true" }, it);
    Base.svg("line", { class: group === "human" ? "human" : "key", "data-group": group, x1: 1, x2: 17, y1: 6, y2: 6 }, sv);
    Base.el("span", { text }, it);
  }

  Base.loopGlyph($(".fhead .loopglyph"), "model");
  Base.mount(svgEl, (w) => { draw(w); say(); });
  Base.lens($("#f1-round"), (key) => { go(+key); say(); });
  $("#f1-all").addEventListener("change", (e) => { all = e.target.checked; setHot(null); tip.hide(); paint(); say(); });

  /* ---- the USB-C pair: each program under its own clip, opened at the last frame */
  const clipInfo = (id) => d.clips.clips.find((c) => c.id === id);
  const pair = [
    { id: "usbc_opus5", name: "Opus 5", svg: "#f1-rib-opus", end: { kind: "ok", text: "seated" } },
    { id: "usbc_sonnet5", name: "Sonnet 5", svg: "#f1-rib-sonnet", end: { kind: "fail", text: "aborts" }, seen: "end_abort.recovery" },
  ];
  const usbcOut = $("#f1-usbc-readout");
  const code = (text) => Base.el("code", { text });
  const atEnd = (p) => p.t >= p.info.stages[p.info.stages.length - 1].t1 - 0.01;
  function status(p, t) {
    const st = p.info.stages.find((x) => t >= x.t0 && t < x.t1);
    if (atEnd(p)) return p.seen ? ["aborted at ", code(p.seen), ", plug let go beside the port"] : ["plug seated"];
    return st ? [code(st.node)] : [t < p.info.stages[0].t0 ? "starting" : "between steps"];
  }
  function sayUsbc() {
    if (!pair.every((p) => p.clip)) return;
    usbcOut.replaceChildren();
    // at rest both clips hold their last frames, which the labels under them already name: only the node is new
    if (pair.every((p) => p.clip.video.paused && atEnd(p))) {
      const p = pair.find((q) => q.seen);
      usbcOut.append(`${p.name} aborts at `, code(p.seen), ".");
      return;
    }
    pair.forEach((p, i) => {
      if (i) usbcOut.append(" · ");
      Base.el("b", { text: `${p.name}: ` }, usbcOut);
      usbcOut.append(...status(p, p.t));
    });
  }
  /* each row's own time axis, in its clip's seconds: the two clips differ in length (Sonnet 5's is cut at the
     abort), so the same width spans a different time in each row. A label is kept only where it clears the ones
     already placed and the ✕. */
  function timeAxis(p) {
    const L = p.ribbon.layout;
    if (!L || !L.x) return;
    const g = Base.svg("g", { class: "time-axis", "aria-hidden": "true" }, $(p.svg));
    const by = L.yb + 15, dur = p.info.duration_s;
    const taken = [];
    const seen = p.seen && L.chips.find((c) => c.s.node === p.seen);
    if (seen) taken.push([seen.x + seen.w / 2 - 8, seen.x + seen.w / 2 + 8]);
    // the clip's length first (set bold), then 0, then every 5 s
    const ticks = [[dur, `${dur} s`, "end", "time-end"], [0, "0", "start", ""]];
    for (let t = 5; t < dur; t += 5) ticks.push([t, `${t} s`, "middle", ""]);
    for (const [t, text, anchor, cls] of ticks) {
      const x = L.x(t), tw = Base.textWidth(text, SANS(11, cls ? 700 : 500));
      const a = anchor === "end" ? x - tw : anchor === "middle" ? x - tw / 2 : x;
      Base.svg("line", { class: "time-tick", x1: x, x2: x, y1: L.yb, y2: L.yb + 4 }, g);
      if (taken.some(([l, r]) => a < r + 12 && a + tw > l - 12)) continue;
      taken.push([a, a + tw]);
      Base.svg("text", { class: `time-label ${cls}`.trim(), x, y: by, "text-anchor": anchor, text }, g);
    }
  }
  for (const p of pair) {
    p.info = clipInfo(p.id);
    const div = root.querySelector(`.clip[data-clip="${p.id}"]`);
    // opened at the end, where the point is: one plug seated, one lying beside the port
    div.dataset.start = (p.info.duration_s - 0.05).toFixed(2);
    p.ribbon = Base.ribbon($(p.svg), {
      mode: "timed", duration: p.info.duration_s, stages: p.info.stages, still: p.info.still, end: p.end, readout: usbcOut,
      marks: p.seen ? { seen: { node: p.seen, title: "the program aborts here and lets go of the plug beside the port" } } : {},
    });
    timeAxis(p);
    p.ribbon.on("render", () => timeAxis(p));
    p.clip = await Base.clip(div);
    p.t = p.clip.start;
    p.clip.follow((t) => { p.t = t; p.ribbon.setTime(t); sayUsbc(); });
    p.clip.video.addEventListener("pause", sayUsbc);
    p.ribbon.on("seek", (t) => { p.clip.pause(); p.clip.seek(t); p.t = t; p.ribbon.setTime(t); sayUsbc(); });
    p.ribbon.setTime(p.t);
  }
  sayUsbc();
  $("#f1-play").addEventListener("click", () => pair.forEach((p) => p.clip.play(0)));

  /* ---- the drawer: Table 1 as the paper prints it */
  const tasks = d.models.tasks;
  const head = [
    ["Model", { v: "Overall", span: 3 }, { v: "Δ Overall", span: 2 }, ...tasks.slice(1).map((t) => ({ v: t.label, span: 3 }))],
    ["", "@0", "@1", "@2", "1", "2", ...tasks.slice(1).flatMap(() => ["@0", "@1", "@2"])],
  ];
  const signed = (v) => (v > 0 ? `+${v}` : String(v));
  const body = [["Human", { v: human, span: 3 }, { v: "–", span: 2 }, ...tasks.slice(1).map((t) => ({ v: d.models.human[t.key], span: 3 }))]]
    .concat(d.models.models.map((m) => [m.label === "Opus 5" ? "Opus 5, xhigh" : m.label, ...m.success.overall, ...m.delta.map(signed),
      ...tasks.slice(1).flatMap((t) => m.success[t.key])]));
  Base.paperTable($("#f1-t1"), head, body, { rowClass: (i) => (i === 0 ? "human" : "") });
});
