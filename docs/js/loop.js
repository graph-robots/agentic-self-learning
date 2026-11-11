/* The loop (Part 2 opener): the paper's Figure 2 as a working machine. Four stations (Write → Run → Read → Edit) sit
   around a round counter, and one real run drives it: the Tool Hanging reference run, round by round. Each step
   lights Run, Read and Edit in turn and fills their panels: how the 4 training episodes ended, how close the ring got
   (and where it went on the clips' layout), and what the agent changed. The knob pills on the stations link to the
   findings that turn them. */
Base.section("loop", async (root, d) => {
  const $ = (sel) => Base.$(sel, root);
  const R = d.rounds_th, L = d.loop, T = d.tapes_th;
  const ks = R.rounds.map((r) => r.k), last = ks[ks.length - 1];
  const round = (k) => R.rounds.find((r) => r.k === k);
  const editAfter = (k) => R.edits.find((e) => e.after === k);
  const changes = (k) => L.edits.find((e) => e.after === k);
  const eps = (k) => L.episodes[String(k)];
  const nTrain = R.rounds[0].train.length;
  const hung = (r) => r.train.filter(Boolean).length;
  const fmtMM = (m) => { const mm = m * 1000; return mm >= 20 ? String(Math.round(mm)) : mm.toFixed(1); };
  const SANS = (px, w) => `${w || 500} ${px}px Manrope, "Helvetica Neue", Arial, sans-serif`;
  const MONO = (px) => `500 ${px}px "JetBrains Mono", ui-monospace, monospace`;

  /* ---- station icons: the run and edit glyphs come from the sprite; write (a graph of skills) and read (a report)
     are drawn here, at the sprite's 16-unit scale */
  function icon(parent, key, attrs) {
    const s = Base.svg("svg", Object.assign({ class: "loop-icon", viewBox: "0 0 16 16", "aria-hidden": "true" }, attrs), parent);
    if (key === "run") Base.svg("use", { href: "#i-play" }, s);
    else if (key === "edit") Base.svg("use", { href: "#i-pencil" }, s);
    else if (key === "write") {
      Base.svg("path", { class: "icon-stroke", d: "M4 8L12 3.8M4 8l8 4.2" }, s);
      for (const [cx, cy] of [[3.6, 8], [12.4, 3.6], [12.4, 12.4]]) Base.svg("circle", { class: "icon-fill", cx, cy, r: 2.2 }, s);
    } else if (key === "read") {
      Base.svg("path", { class: "icon-stroke", d: "M3.6 1.8h6l2.8 2.8v9.6H3.6z" }, s);
      Base.svg("path", { class: "icon-stroke", d: "M5.9 7.2h4.4M5.9 9.6h4.4M5.9 12h2.8" }, s);
    }
    return s;
  }
  for (const span of Base.$$(".loop-ph-icon", root)) icon(span, span.dataset.icon);

  /* text wrapped to a width, for the station captions (SVG text does not wrap) */
  const wrap = (text, maxW, font) => {
    const lines = [];
    let cur = "";
    for (const w of text.split(" ")) {
      const next = cur ? cur + " " + w : w;
      if (cur && Base.textWidth(next, font) > maxW) { lines.push(cur); cur = w; } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines;
  };

  /* ================================================================ the machine */
  const STATIONS = [
    { key: "write", name: "Write", cap: "a program, a graph of skills",
      knobs: [{ n: 2, knob: "skills", text: "Skills", href: "#skills" }] },
    { key: "run", name: "Run", cap: `${nTrain} training layouts in simulation`,
      knobs: [{ n: 6, knob: "curriculum", text: "Curriculum", href: "#curriculum" }] },
    { key: "read", name: "Read", cap: "a feedback report",
      knobs: [{ n: 3, knob: "time", text: "Feedback over time", short: "Time", href: "#temporal" },
        { n: 4, knob: "space", text: "Feedback in space", short: "Space", href: "#spatial" }] },
    { key: "edit", name: "Edit", cap: "the agent rewrites its code",
      knobs: [{ n: 1, knob: "model", text: "Model", href: "#models" },
        { n: 5, knob: "physical", text: "Physical reasoning", short: "Physics", href: "#collision" }] },
  ];
  const NEXT = { write: "run", run: "read", read: "edit", edit: "write" };
  const machine = $("#loop-machine");
  let center = null, lit = null;

  function drawMachine(w) {
    machine.replaceChildren();
    const narrow = w < 380;
    machine.classList.toggle("narrow", narrow);
    const gx = narrow ? 30 : 44, cw = (w - gx) / 2, p = narrow ? 10 : 12;
    const capFont = SANS(narrow ? 12 : 12.5), capLH = narrow ? 15 : 16;
    const pillFont = SANS(11.5, 700), pillH = 22, pillGap = 6;
    const pillW = (t) => 8 + 16 + 6 + Base.textWidth(t, pillFont) + 10;
    const plan = STATIONS.map((st) => {
      const lines = wrap(st.cap, cw - 2 * p, capFont);
      const knobs = st.knobs.map((k) => ({ ...k, label: !k.short || pillW(k.text) <= cw - 2 * p ? k.text : k.short }));
      return { st, lines, knobs, h: p + 24 + lines.length * capLH + 8 + knobs.length * (pillH + pillGap) - pillGap + p };
    });
    const topH = Math.max(plan[0].h, plan[1].h), botH = Math.max(plan[2].h, plan[3].h);
    const midH = narrow ? 112 : 128, H = topH + midH + botH;
    const box = { write: [0, 0, topH], run: [cw + gx, 0, topH], read: [cw + gx, topH + midH, botH], edit: [0, topH + midH, botH] };
    const mid = (key) => [box[key][0] + cw / 2, box[key][1] + box[key][2] / 2];

    // the circuit: one segment per hand-over, drawn under the cards; its chevron sits in the gap between two cards
    const arcs = Base.svg("g", { class: "loop-arrows" }, machine);
    for (const from of ["write", "run", "read", "edit"]) {
      const to = NEXT[from], [x1, y1] = mid(from), [x2, y2] = mid(to);
      const g = Base.svg("g", { class: "loop-arrow", "data-to": to }, arcs);
      Base.svg("path", { class: "loop-line", d: `M${x1},${y1} L${x2},${y2}` }, g);
      let cx, cy;
      if (y1 === y2) { cx = w / 2; cy = y1; } else { cx = x1; cy = topH + midH / 2; }
      const ux = Math.sign(x2 - x1), uy = Math.sign(y2 - y1), s = 5;
      Base.svg("path", { class: "loop-chev", d: `M${cx - ux * s - uy * s},${cy - uy * s - ux * s} L${cx + ux * s * 0.6},${cy + uy * s * 0.6} L${cx - ux * s + uy * s},${cy - uy * s + ux * s}` }, g);
    }

    for (const { st, lines, knobs } of plan) {
      const [x, y, h] = box[st.key];
      const g = Base.svg("g", { class: "station", "data-station": st.key }, machine);
      if (lit === st.key) g.classList.add("lit");
      Base.svg("rect", { class: "station-box", x: x + 0.5, y: y + 0.5, width: cw - 1, height: h - 1, rx: 12 }, g);
      Base.svg("circle", { class: "station-disc", cx: x + p + 11, cy: y + p + 11, r: 11 }, g);
      icon(g, st.key, { x: x + p + 4, y: y + p + 4, width: 14, height: 14 });
      Base.svg("text", { class: "station-name", x: x + p + 30, y: y + p + 16, text: st.name }, g);
      lines.forEach((line, i) => Base.svg("text", { class: "station-cap", x: x + p, y: y + p + 24 + 12 + i * capLH, text: line }, g));
      let ky = y + p + 24 + lines.length * capLH + 8;
      for (const k of knobs) {
        const a = Base.svg("a", { class: "knob", href: k.href, "data-knob": k.knob, "data-target": k.href,
          "aria-label": `Finding ${k.n}: ${k.text}` }, g);
        const kw = Math.min(pillW(k.label), cw - 2 * p);
        Base.svg("rect", { class: "knob-box", x: x + p, y: ky, width: kw, height: pillH, rx: pillH / 2 }, a);
        Base.svg("circle", { class: "knob-badge", cx: x + p + 4 + 8, cy: ky + pillH / 2, r: 8 }, a);
        Base.svg("text", { class: "knob-n", x: x + p + 12, y: ky + pillH / 2 + 4.2, "text-anchor": "middle", text: String(k.n) }, a);
        Base.svg("text", { class: "knob-label", x: x + p + 30, y: ky + pillH / 2 + 4, text: k.label }, a);
        Base.svg("title", { text: `Finding ${k.n} · ${k.text}: turns the "${st.key}" step` }, a);
        const hot = (on) => g.classList.toggle("hot", on);
        a.addEventListener("pointerenter", () => hot(true));
        a.addEventListener("pointerleave", () => hot(false));
        a.addEventListener("focus", () => hot(true));
        a.addEventListener("blur", () => hot(false));
        ky += pillH + pillGap;
      }
    }

    const cx = w / 2, cy = topH + midH / 2;
    const c = Base.svg("g", { class: "loop-center" }, machine);
    Base.svg("text", { class: "loop-k-eyebrow", x: cx, y: cy - (narrow ? 30 : 36), "text-anchor": "middle", text: "ROUND" }, c);
    const kText = Base.svg("text", { class: "loop-k", x: cx, y: cy + (narrow ? 14 : 16), "text-anchor": "middle" }, c);
    const sub = Base.svg("text", { class: "loop-k-sub", x: cx, y: cy + (narrow ? 34 : 40), "text-anchor": "middle" }, c);
    center = { kText, sub };
    machine.setAttribute("viewBox", `0 0 ${w} ${H}`);
    machine.style.height = H + "px";
    paintCenter();
  }

  const roundTag = (r) => (r.reverted ? "reverted" : r.k === 0 ? "first program" : r.k === last ? "kept" : "");
  function paintCenter() {
    if (!center) return;
    const r = round(cur);
    center.kText.textContent = `k${cur}`;
    center.sub.textContent = r.reverted ? `reverted to k${r.revert_to}` : `${hung(r)} of ${r.train.length} hung`;
  }
  function light(key) {
    lit = key;
    Base.$$(".station", machine).forEach((g) => g.classList.toggle("lit", g.dataset.station === key));
    Base.$$(".loop-arrow", machine).forEach((g) => g.classList.toggle("lit", g.dataset.to === key));
    Base.$$(".loop-panel", root).forEach((pn) => pn.classList.toggle("lit", pn.dataset.station === key));
  }
  // a panel under the pointer lights its station, so the two halves read as one machine
  for (const pn of Base.$$(".loop-panel", root)) {
    const st = () => machine.querySelector(`.station[data-station="${pn.dataset.station}"]`);
    pn.addEventListener("pointerenter", () => { const g = st(); if (g) g.classList.add("hot"); });
    pn.addEventListener("pointerleave", () => { const g = st(); if (g) g.classList.remove("hot"); });
  }

  /* ================================================================ Run: how each training episode ended */
  $("#loop-run-sub").textContent = `${nTrain} training layouts in simulation`;
  const epBox = $("#loop-eps");
  const epTip = Base.tooltip(epBox);
  function showRun(k) {
    const r = round(k);
    epBox.replaceChildren();
    const head = Base.el("div", { class: "loop-ep loop-ep-head", "aria-hidden": "true" }, epBox);
    const failed = eps(k).some((e) => !e.ok);
    for (const h of ["", "layout", "how it ended", failed ? "closest" : "", ""]) Base.el("span", { text: h }, head);
    eps(k).forEach((e, i) => {
      const item = Base.el("div", { class: "loop-ep", "data-ok": String(e.ok) }, epBox);
      const s = Base.svg("svg", { class: "loop-ep-dot", viewBox: "0 0 22 22", "aria-hidden": "true" }, item);
      Base.svg("circle", { class: "ep", "data-ok": String(e.ok), cx: 11, cy: 11, r: 8.5 }, s);
      if (!e.ok) Base.svg("use", { class: "ep-x", href: "#m-seen", x: 5, y: 5, width: 12, height: 12 }, s);
      Base.el("span", { class: "loop-ep-layout mono", text: e.layout }, item);
      const how = Base.el("span", { class: "loop-ep-how" }, item);
      if (e.ok) how.textContent = "hung";
      else if (e.raised) { how.append("stopped with an error at "); Base.el("code", { text: e.raised }, how); }
      else how.textContent = "goal not met";
      // the closest each failed layout got: the Read numeral is their median
      const near = Base.el("span", { class: "loop-ep-near" }, item);
      if (!e.ok) { Base.el("span", { class: "loop-ep-near-k", text: "closest " }, near); Base.el("b", { class: "mono", text: `${fmtMM(e.closest_mm / 1000)} mm` }, near); }
      // tapes_th.rounds follow this episode: the clips' layout, drawn in Read
      const tag = Base.el("span", { class: "loop-ep-drawn" }, item);
      if (i === 3) { Base.el("i", {}, tag); tag.append("drawn below"); }
      const what = e.ok ? "hung" : e.raised ? `stopped with an error at ${e.raised}` : "the graph finished, goal not met";
      epTip.bind(item, () => ({ title: `${e.layout} · ${what}`, rows: [{ text: `closest the ring came to the hook: ${e.closest_mm} mm` }] }));
    });
    const nodes = [...new Set(eps(k).filter((e) => e.raised).map((e) => e.raised))];
    $("#loop-readout").textContent = r.reverted
      ? `Round k${k}: ${hung(r)} of ${r.train.length}; every episode aborted at ${nodes.join(", ")}, so the loop reverted to k${r.revert_to}.`
      : `Round k${k}: ${hung(r)} of ${r.train.length} training layouts hung.`;
  }

  /* ================================================================ Read: the closest approach, and the ring's path */
  const DOMAIN = { along: [-72, 100], vert: [-45, 25] };
  const inDomain = (a, v) => a >= DOMAIN.along[0] && a <= DOMAIN.along[1] && v >= DOMAIN.vert[0] && v <= DOMAIN.vert[1];
  // the fixed program's path: round k4's in-view tail, to the ring hanging over the shank
  const T4 = T.rounds[String(last)], n4 = T4.t.length;
  let from = n4 - 1;
  while (from > 0 && inDomain(T4.along[from - 1], T4.vert[from - 1])) from--;
  const ghost = { along: T4.along.slice(from), vert: T4.vert.slice(from), n_end: T4.n[n4 - 1] };
  const rail = Base.rail($("#loop-rail"), { domain: DOMAIN, sample: Base.sampler(T4), shank: T.shank, ring: T.ring, ghost });
  $("#loop-rail-layout").textContent = eps(0)[3].layout;
  const railBox = $(".loop-railbox"), railSvg = $("#loop-rail");
  const ringLabel = Base.el("span", { class: "loop-ring-label", "aria-hidden": "true", hidden: true }, railBox);
  // beside the ring: below, above, right or left of it, the first spot that stays in the drawing and clear of the
  // path, the shank, its label, the board and the k4 ring
  function placeRingLabel() {
    const ring = railSvg.querySelector("ellipse.ring");
    if (!ringLabel.textContent || !ring || ring.style.display === "none") { ringLabel.hidden = true; return; }
    ringLabel.hidden = false;
    const box = railBox.getBoundingClientRect(), area = railSvg.getBoundingClientRect(), r = ring.getBoundingClientRect();
    const lw = ringLabel.offsetWidth, lh = ringLabel.offsetHeight, cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    const board = railSvg.querySelector(".board");
    const right = board ? board.getBoundingClientRect().left - 4 : area.right;
    const blocks = [...railSvg.querySelectorAll(".trail, .shank, .tip-label, .ghost-g:not([style*='none']) ellipse")]
      .map((n) => n.getBoundingClientRect());
    const ghost = railSvg.querySelector(".ghost-g:not([style*='none']) polyline.ghost");
    if (ghost) {
      const m = ghost.getScreenCTM();
      for (const pt of ghost.points) { const q = pt.matrixTransform(m); blocks.push({ left: q.x, right: q.x, top: q.y, bottom: q.y }); }
    }
    // beside it, the spots nearest its middle first
    const side = [];
    for (let d = 0; d <= (r.bottom - r.top + lh) / 2; d += 3) side.push(cy - lh / 2 - d, cy - lh / 2 + d);
    const spots = [[cx - lw / 2, r.bottom + 4], [cx - lw / 2, r.top - lh - 4],
      ...side.map((y) => [r.right + 6, y]), ...side.map((y) => [r.left - lw - 6, y])];
    const hits = ([x, y]) => blocks.filter((b) => b.right >= x - 2 && b.left <= x + lw + 2 && b.bottom >= y - 2 && b.top <= y + lh + 2).length;
    const fits = ([x, y]) => x >= area.left && x + lw <= right && y >= area.top && y + lh <= area.bottom;
    const ok = spots.filter(fits);
    const [x, y] = (ok.length ? ok : spots).reduce((a, b) => (hits(b) < hits(a) ? b : a));
    ringLabel.style.transform = `translate(${Math.round(x - box.left - railBox.clientLeft)}px, ${Math.round(y - box.top - railBox.clientTop)}px)`;
  }
  if ("ResizeObserver" in window) new ResizeObserver(() => requestAnimationFrame(() => requestAnimationFrame(placeRingLabel))).observe(railSvg);
  function showRead(k) {
    const r = round(k), num = $("#loop-closest");
    num.replaceChildren();
    num.className = "bignum";
    if (r.closest_m == null) {
      num.classList.add("ok", "loop-allhung");
      num.textContent = `all ${r.train.length} hung`;
      $("#loop-closest-label").textContent = "no failed layout left to measure";
    } else {
      num.append(fmtMM(r.closest_m));
      Base.el("span", { class: "loop-unit", text: " mm" }, num);
      if (r.reverted) Base.el("span", { class: "loop-rev", text: " reverted" }, num);
      // the run's progress measure is the median over the episodes that failed: all of them until a layout hangs
      $("#loop-closest-label").textContent = `closest the ring came to the hook, median of ${hung(r) ? "the failed layouts" : `all ${r.train.length}`}`;
    }
    // why the median and the drawn ring can disagree (k0: 398 mm against 13.9 mm): the median counts the episodes that
    // stopped with an error (at k0, with the ring still far from the hook), and the drawing shows one layout only
    const errs = eps(k).filter((e) => !e.ok && e.raised).length, e3 = eps(k)[3];
    const why = [errs ? `${errs === eps(k).length ? `all ${errs}` : errs} stopped with an error` : "",
      e3.ok ? "" : `the drawn layout came within ${fmtMM(e3.closest_mm / 1000)} mm`].filter(Boolean).join("; ");
    $("#loop-closest-why").textContent = why ? why[0].toUpperCase() + why.slice(1) + "." : "";
    // the path while the robot held the wrench, from where it came into view to the moment the gripper let go,
    // with the ring drawn there: what fell or tumbled afterwards is not the program's doing
    // (the last recorded pose before the gripper opened: the ring drops within the next sample)
    const track = T.rounds[String(k)];
    const held = track.t.findIndex((t) => t >= L.let_go[String(k)]) - 1;
    let enter = held;
    while (enter > 0 && inDomain(track.along[enter - 1], track.vert[enter - 1])) enter--;
    // the ✕ goes where the drawn episode failed: where the gripper let go short of the hook, or (k1) where the
    // graph stopped with an error and the abort let go
    const seen = e3.ok ? null : { t: track.t[held], title: e3.raised ? `stopped with an error at ${e3.raised}` : "let go, goal not met" };
    rail.update({ sample: Base.sampler(track), trailFrom: track.t[held] - track.t[enter], seen,
      offscreen: track.aborted ? "never reached the hook (aborted)" : "out of view" }).set(track.t[held]);
    rail.showGhost(k !== last);
    $("#loop-ghost-key").hidden = k === last;
    $("#loop-seen-key").hidden = !seen;
    ringLabel.textContent = e3.ok ? "" : `closest ${fmtMM(e3.closest_mm / 1000)} mm`;
    placeRingLabel();
  }

  /* ================================================================ Edit: the agent's words, the program, the size */
  const sizes = $("#loop-sizes");
  const sizeTip = Base.tooltip(sizes);
  const maxLines = Math.max(...R.edits.map((e) => e.lines));
  const stepList = (e) => (e ? changes(e.after).steps.join(", ") : "");
  const sizeRows = R.edits.map((e) => {
    const row = Base.el("div", { class: "loop-size" + (e.kept ? "" : " dropped"), "data-after": e.after }, sizes);
    Base.el("span", { class: "loop-size-k", text: `after k${e.after}` }, row);
    const bar = Base.el("span", { class: "loop-size-bar" }, row);
    Base.el("i", { style: `width:${(100 * e.lines) / maxLines}%` }, bar);
    const n = Base.el("span", { class: "loop-size-n mono", text: `${e.lines} lines` }, row);
    if (!e.kept) Base.el("span", { class: "loop-size-tag", text: "reverted" }, n);
    sizeTip.bind(row, () => ({ title: `Edit after k${e.after} · ${e.lines} lines`, rows: [
      { text: `applied to k${e.applied_to}'s program; changed ${stepList(e)}` },
      { text: e.kept ? `kept: it became k${e.after + 1}` : `not kept: round k${e.after + 1} was reverted` }] }));
    return row;
  });

  const ribbonOpts = () => {
    // wide enough that every step's name fits on its chip; a phone shows glyph chips on two rows
    const widest = Math.max(...L.programs["0"].map((p) => Base.textWidth(p.step, MONO(11.5))));
    return Base.isPhone() ? { rows: 2, minChip: 18 } : { rows: "auto", minChip: Math.ceil(widest + 28) };
  };
  const program = Base.ribbon($("#loop-program"), { mode: "ordinal", stages: [], groups: false, readout: $("#loop-edit-readout"), ...ribbonOpts() });
  if (window.matchMedia) {
    const mq = window.matchMedia("(max-width: 600px)");
    const onPhone = () => program.update(ribbonOpts());
    if (mq.addEventListener) mq.addEventListener("change", onPhone);
  }
  const chipTitle = (p, ch) => {
    const parts = [p.generated ? "written by the model itself, from no library skill" : `skill ${p.skill}`];
    if (ch && ch.scripts.length) parts.push(`rewrote ${ch.scripts.join(", ")}`);
    if (ch && ch.params.length) parts.push(`changed ${ch.params.join("; ")}`);
    return parts.join(" · ");
  };

  // the program's steps whose node raised in round k, in run order
  const raisedIn = (k, steps) => {
    const refs = new Set(eps(k).filter((e) => e.raised).map((e) => e.raised.split(".")[0]));
    return steps.filter((p) => refs.has(p.ref));
  };
  const codes = (names) => names.flatMap((n, i) => (i ? [", ", Base.el("code", { text: n })] : [Base.el("code", { text: n })]));

  function showEdit(k) {
    const r = round(k), e = editAfter(k), c = e && changes(k);
    const revert = $("#loop-revert");
    revert.hidden = !r.reverted;
    if (r.reverted) {
      $("#loop-revert-text").replaceChildren(Base.el("b", { text: `Round k${k} was reverted.` }),
        ` Every episode aborted, so the loop threw its program away and went back to k${r.revert_to}. The edit below was made after k${k} and applied to the restored k${r.revert_to} program.`);
      $("#loop-revert-why").textContent = r.revert_reason;
    }
    const said = $("#loop-said"), stop = $("#loop-stop");
    said.hidden = !e;
    stop.hidden = !!e;
    if (e) {
      Base.said(said, e.quote_md, `${R.model}, after round k${k}${e.applied_to !== k ? ` · applied to the restored k${e.applied_to} program` : ""}`);
    } else {
      stop.replaceChildren();
      stop.appendChild(Base.glyph("m-check", "ok"));
      const t = Base.el("div", {}, stop);
      Base.el("p", { class: "loop-stop-h", text: R.done === "val_target" ? "Stopped: validation target met." : "Stopped." }, t);
      const h0 = L.heldout[String(ks[0])], hk = L.heldout[String(k)];
      if (h0 && hk) Base.el("p", { text: `On ${hk.n} held-out layouts it never trained on, ${hk.ok} hung; the first program hung ${h0.ok}.` }, t);
    }
    sizeRows.forEach((row) => row.classList.toggle("on", e != null && +row.dataset.after === e.after));

    const shown = e ? e.applied_to : k;
    const steps = L.programs[String(shown)];
    const touched = c ? c.changes : {};
    const raised = raisedIn(k, steps), raisedRefs = new Set(raised.map((p) => p.ref));
    const errors = (p) => eps(k).filter((x) => x.raised && x.raised.split(".")[0] === p.ref);
    const stages = steps.map((p) => {
      const errs = raisedRefs.has(p.ref) ? errors(p) : [];
      const said = errs.length ? `round k${k}: stopped with an error at ${[...new Set(errs.map((x) => x.raised))].join(", ")} on ${errs.map((x) => x.layout).join(", ")}` : null;
      return { node: p.ref, label: p.step, kind: p.kind, state: errs.length ? "raised" : p.generated ? "generated" : null,
        edited: !!touched[p.step], title: [said, chipTitle(p, touched[p.step])].filter(Boolean).join(" · ") };
    });
    if (c && c.wiring) stages.push({ node: "workflow.json", label: "graph wiring", kind: "decide", edited: true, title: "the graph's own steps and routes changed" });
    // how the round's other episodes ended, at the program's end: the ✕ under a chip is an episode that stopped there
    const ended = eps(k).filter((x) => !x.raised);
    const end = [];
    if (ended.some((x) => x.ok)) end.push({ kind: "ok", text: "hung" });
    if (ended.some((x) => !x.ok)) end.push({ kind: "fail", text: "goal not met" });
    program.update({ stages, end, marks: { seen: raised.map((p) => ({ node: p.ref, title: `round k${k}: stopped with an error here` })) } });

    const unmet = ended.some((x) => !x.ok);
    const where = raised.length
      ? [`${e && e.applied_to !== k ? `In k${k}, f` : "F"}ailures showed at `, ...codes(raised.map((p) => p.step)), unmet ? " and at the end" : ""]
      : unmet ? ["Failures showed only at the end"] : null;
    $("#loop-prog-cap").replaceChildren(...(e
      ? [Base.el("b", { text: e.applied_to !== k ? `The restored k${e.applied_to} program` : `k${shown}'s program` }),
        `, ${steps.length} steps in run order. `, ...(where ? [...where, "; the"] : ["The"]),
        ` edit after k${k} changed `, ...codes(c.steps), "."]
      : [Base.el("b", { text: `k${k}'s program` }), `, ${steps.length} steps in run order, kept as the result.`,
        where ? " " : " Every training layout hung.", ...(where ? [...where, "."] : [])]));
    $("#loop-edit-readout").textContent = e
      ? `Edit after k${k}: ${e.lines} lines${e.kept ? "" : `, not kept (k${k + 1} was reverted)`}. Pick a step for the files and parameters it changed.`
      : "No edit after the last round. Pick a step for its skill.";
  }

  /* ---- a hidden table with every number drawn above */
  const table = $("#loop-table");
  Base.el("caption", { text: "The run round by round" }, table);
  const head = Base.el("tr", {}, Base.el("thead", {}, table));
  for (const h of ["Round", "Training layouts hung", "Closest approach, mm (median of the failed layouts)", "Steps that stopped with an error", "Edit after it, lines", "Steps the edit changed"])
    Base.el("th", { text: h }, head);
  const tb = Base.el("tbody", {}, table);
  for (const r of R.rounds) {
    const e = editAfter(r.k), tr = Base.el("tr", {}, tb);
    for (const v of [`k${r.k}${r.reverted ? " (reverted)" : ""}`, `${hung(r)} of ${r.train.length}`,
      r.closest_m == null ? "none failed" : fmtMM(r.closest_m), raisedIn(r.k, L.programs[String(r.k)]).map((p) => p.step).join(", ") || "none",
      e ? `${e.lines}${e.kept ? "" : " (reverted)"}` : "none", stepList(e) || "none"])
      Base.el("td", { text: v }, tr);
  }

  /* ================================================================ the stepper */
  const range = $("#loop-k"), out = $("#loop-k-out");
  range.min = String(ks[0]);
  range.max = String(last);
  const strip = Base.rounds($("#loop-rounds"), R.rounds, { compact: true, edits: R.edits, selected: ks[0],
    describe: (r) => `k${r.k} · ${hung(r)} of ${r.train.length} training layouts hung${r.reverted ? ` · every episode aborted, so the loop reverted to k${r.revert_to}` : ""}`,
    onSelect: (k) => setK(k, true) });
  let cur = ks[0], timers = [];
  function setK(k, animate) {
    k = Math.max(ks[0], Math.min(last, Math.round(k)));
    timers.forEach(clearTimeout);
    timers = [];
    cur = k;
    range.value = String(k);
    const r = round(k), tag = roundTag(r);
    range.setAttribute("aria-valuetext", `Round k${k}${tag ? `, ${tag}` : ""}`);
    out.replaceChildren(Base.el("b", { text: `Round k${k}` }), tag ? Base.el("span", { text: tag }) : "");
    $('[data-act="prev"]').disabled = k === ks[0];
    $('[data-act="next"]').disabled = k === last;
    strip.select(k);
    paintCenter();
    const steps = [["run", showRun], ["read", showRead], ["edit", showEdit]];
    if (!animate || Base.reduced) {
      steps.forEach(([, show]) => show(k));
      light(null);
      return;
    }
    // the machine turns: Run, then Read, then Edit light up as their panels fill
    steps.forEach(([key, show], i) => timers.push(setTimeout(() => { light(key); show(k); }, i * 300)));
    timers.push(setTimeout(() => light(null), steps.length * 300 + 200));
  }
  range.addEventListener("input", () => setK(+range.value, true));
  $('[data-act="prev"]').addEventListener("click", () => setK(cur - 1, true));
  $('[data-act="next"]').addEventListener("click", () => setK(cur + 1, true));
  Base.on("loop:select", (x) => setK(x != null && typeof x === "object" ? x.k : +x, true));

  Base.mount(machine, drawMachine);
  setK(ks[0], false);

  /* ================================================================ the six findings at a glance: each row in its
     finding's own words, read from that finding's header so the two never drift apart */
  const index = $("#loop-index");
  for (const k of STATIONS.flatMap((st) => st.knobs).sort((a, b) => a.n - b.n)) {
    const head = document.querySelector(`${k.href} .fhead`);
    const a = Base.el("a", { class: "loop-index-row", href: k.href }, Base.el("li", {}, index));
    Base.el("span", { class: "loop-index-n", text: String(k.n), "aria-hidden": "true" }, a);
    Base.loopGlyph(Base.svg("svg", { class: "loopglyph" }, a), k.knob);
    const words = Base.el("span", { class: "loop-index-words" }, a);
    Base.el("span", { class: "loop-index-k", text: head ? head.querySelector(".eyebrow").textContent : `Finding ${k.n} · ${k.text}` }, words);
    if (head) Base.el("span", { class: "loop-index-claim", text: head.querySelector(".claim").textContent }, words);
  }

  /* ================================================================ the tasks, as thumbnails */
  const TASKS = [
    ["tool_hanging", "Tool Hanging", "VABAR"], ["sharps_disposal", "Syringe Packing", "VABAR"], ["gear_mesh", "Gear Meshing", "VABAR"],
    ["usbc_insert", "USB-C Insertion", "VABAR"], ["cable_route", "Cable Routing", "VABAR"],
    ["kitchen", "Kitchen", "MimicGen"], ["coffee", "Coffee", "MimicGen"], ["threading", "Threading", "MimicGen"], ["mug_cleanup", "Mug Cleanup", "MimicGen"],
  ];
  const grid = $("#loop-tasks");
  for (const [key, name, bench] of TASKS) {
    const vabar = bench === "VABAR";
    const fig = Base.el("figure", { class: "loop-task", "data-bench": bench }, grid);
    const im = Base.el("div", { class: "loop-task-img" }, fig);
    const srcs = vabar ? [`assets/img/${key}_before.jpg`, `assets/img/${key}_after.jpg`] : [`assets/img/mimicgen_${key}.jpg`];
    srcs.forEach((src, i) => Base.el("img", { src, loading: "lazy", alt: i ? `${name}, goal state` : name }, im));
    if (vabar) {
      Base.el("span", { class: "loop-task-state", "aria-hidden": "true" }, im);
      fig.tabIndex = 0;
      fig.setAttribute("role", "button");
      fig.setAttribute("aria-pressed", "false");
      fig.setAttribute("aria-label", `${name}: show the goal state`);
      const flip = () => fig.setAttribute("aria-pressed", String(fig.getAttribute("aria-pressed") !== "true"));
      fig.addEventListener("click", flip);
      fig.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); flip(); } });
    }
    const cap = Base.el("figcaption", {}, fig);
    Base.el("b", { text: name }, cap);
    Base.el("small", { text: bench }, cap);
  }
});
