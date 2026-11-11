/* Finding 3, feedback over time (DESIGN_SPEC §3.6). One failed Tool Hanging episode of the shared first program,
   read through three reports. The lens re-slices everything at once: fog over what that report leaves out, ◆ at
   the stage the agent edited first and the arc back to it from ✕, the report excerpt, the agent's diagnosis and
   where it edited round by round. Results: Table 2 as bars, Figure 6's skills-traced-back counts as dot strips.
   Below 861 px the ribbon becomes a vertical list with the arc as a rail on its left. */
Base.section("f3", async (root, data) => {
  const { f3_case: C, f3_timeline: T, f3_geom: G, skill_reach: R, temporal } = data;
  const { el, svg } = Base;
  const $ = (sel) => Base.$(sel, root);
  const KEYS = ["episode", "motion", "skill"];
  const NAME = { episode: "per-episode", motion: "per-motion", skill: "per-skill" };
  const MONO = (px) => `500 ${px}px "JetBrains Mono", ui-monospace, monospace`;
  const SANS = (px, w) => `${w || 500} ${px}px Manrope, "Helvetica Neue", Arial, sans-serif`;
  const narrow = window.matchMedia("(max-width: 860px)");
  let lens = "skill";

  Base.loopGlyph($(".fhead .loopglyph"), "time");
  el("span", { class: "f3-episode", text: T.label }, $(".f3-key"));

  /* ---------------------------------------------------------------- the episode's steps */
  const tool = (m) => m.tool.replace(/^robot\./, "");
  const motionsOf = (node) => T.motions.filter((m) => m.node === node);
  const shows = (v) => KEYS.filter((k) => v[k]);
  const where = (keys) => !keys.length ? "in no report" : keys.length === KEYS.length ? "in every report"
    : `in the ${keys.map((k) => NAME[k]).join(" and ")} report${keys.length > 1 ? "s" : ""}`;
  const ran = T.nodes.map((n) => ({
    node: n.node, group: n.group, label: n.label, kind: n.kind, dur: n.duration_s,
    state: n.node === T.abort.node ? "raised" : undefined,
    show: shows(n.visible).join(" ") || "none",
    title: [`${n.duration_s.toFixed(1)} s`, n.node === T.abort.node ? `raised: ${T.abort.error}` : n.status,
      where(shows(n.visible))].join(" · "),
  }));
  // the steps the program never reached carry one group label, so the run reads "never reached" above them
  const unreached = T.unreached.map((u) => ({ node: u.group, group: "never reached", label: u.label, kind: u.kind,
    state: "unreached", title: "never reached in this episode" }));
  const rec = T.recovery;
  const recovery = { node: rec.node, group: rec.group, label: rec.label, kind: rec.kind, recovery: true,
    show: shows(rec.visible).join(" ") || "none",
    title: `ran after the error: ${motionsOf(rec.node).map(tool).join(", ")} · ${where(shows(rec.visible))}` };
  const steps = [...ran, ...unreached, recovery];
  const motionShow = (m) => shows(m.shown).join(" ") || "none";
  const raised = T.motions.find((m) => m.n === T.raised_motion);

  // arc labels quote report tokens in backticks: mono on the phone rail (Base.said) and in a tspan on the ribbon
  const CAUSE = {
    episode: { title: "its first edit: the grasp stage, where the episode failed", arc: "edits where it failed" },
    motion: { title: "its first edit: perception, inferred from where the hand was sent", arc: "inferred: the report has no line for perception" },
    skill: { title: "its first edit: perception, read off perceive_sg.loop's own entry", arc: "read in the report: `feature_center` on the wrong end" },
  };
  const plain = (s) => s.replace(/`/g, "");
  const causeRef = (k) => ({ ...(T.cause[k].node ? { node: T.cause[k].node } : { group: T.cause[k].group }), title: CAUSE[k].title });
  const arcOf = (k) => ({ style: T.cause[k].style, label: plain(CAUSE[k].arc) });

  /* ---------------------------------------------------------------- the ribbon (wide screens)
     The ribbon runs in timed mode on a unit axis that is not time: ordinal mode gives every chip the same width,
     which leaves twenty chips no room for a label. Here the steps that ran get room for their names, the unreached
     ones keep the glyph-only width, and the axis spans 1 so no time ticks are drawn. The motion that raised is
     named beside the ✕ instead of inside the reach, so the reach needs no more room than its own label. */
  const CHIP = MONO(11.5), LANE = MONO(10), GROUP = SANS(11), DUR = MONO(10);
  const GAP = 2, UNREACHED = 22, RECOVERY = 44;   // 22 px: a glyph-only chip (spec C4)
  const GLYPH = 26;                               // a chip that ran, shown by its kind glyph only
  const keep = new Set([T.abort.node, ...KEYS.map((k) => T.cause[k].node).filter(Boolean)]);
  const durText = (s) => `${s.dur.toFixed(1)} s`;
  // base draws a chip's label from textWidth + 27; the half pixel keeps float error from dropping it
  const named = (s) => Base.textWidth(s.label, CHIP) + 27.5;
  // the label, then the duration flush right with 6 px either side
  const timedW = (s) => named(s) + Base.textWidth(durText(s), DUR) + 6;
  const fitsDur = (s, w) => w >= timedW(s) - 0.5;
  function layout(w) {
    const avail = w - 2 - GAP * (steps.length - 1);
    const sum = (a) => a.reduce((x, v) => x + v, 0);
    const ranIdx = steps.map((s, i) => i).filter((i) => steps[i].state !== "unreached" && !steps[i].recovery);
    const min = steps.map((s) => s.state === "unreached" ? UNREACHED : s.recovery ? RECOVERY : named(s));
    // short of room, chips give up their labels, longest first, keeping the failing node's and the cause's to the last
    const drop = ranIdx.slice().sort((a, b) => keep.has(steps[a].node) - keep.has(steps[b].node) || min[b] - min[a]);
    for (const i of drop) { if (sum(min) <= avail) break; min[i] = GLYPH; }
    let wd = min.slice();
    if (sum(min) > avail) {
      const flex = sum(ranIdx.map((i) => min[i]));
      const k = Math.max(0.3, (avail - sum(min) + flex) / flex);
      for (const i of ranIdx) wd[i] = min[i] * k;
    } else {
      // the room left goes, whole or not at all, to: the durations of the failing node and the cause, the group
      // label of a group of one chip, a motion's full tool name, then every other duration, smallest first
      const labelled = (i) => wd[i] > GLYPH;
      const wants = [];
      for (const i of ranIdx) if (keep.has(steps[i].node) && labelled(i)) wants.push([i, timedW(steps[i])]);
      for (const i of ranIdx) if (steps.filter((t) => t.group === steps[i].group).length === 1) wants.push([i, Base.textWidth(steps[i].group, GROUP) + 12]);
      for (const i of ranIdx) {
        const ms = motionsOf(steps[i].node);
        if (ms.length && steps[i].node !== T.abort.node) wants.push([i, sum(ms.map((m) => Base.textWidth(tool(m), LANE) + 10)) + 2 * (ms.length - 1)]);
      }
      ranIdx.filter((i) => labelled(i) && !keep.has(steps[i].node)).map((i) => [i, timedW(steps[i])])
        .sort((a, b) => a[1] - wd[a[0]] - (b[1] - wd[b[0]])).forEach((x) => wants.push(x));
      let left = avail - sum(wd);
      for (const [i, to] of wants) if (to > wd[i] && to - wd[i] <= left) { left -= to - wd[i]; wd[i] = to; }
      for (const i of ranIdx) wd[i] += left / ranIdx.length;
    }
    const span = sum(wd) + GAP * (steps.length - 1);
    let x = 0;
    const out = steps.map((s, i) => {
      const st = { ...s, t0: x / span, t1: (x + wd[i]) / span };
      x += wd[i] + GAP;
      return st;
    });
    // a chip's motions share it by the length of their names when all fit, in equal parts otherwise
    const motion = [];
    for (const st of out) {
      const ms = motionsOf(st.node);
      if (!ms.length) continue;
      const inner = st.t1 - st.t0 - (GAP / span) * (ms.length - 1);
      const nat = ms.map((m) => (Base.textWidth(tool(m), LANE) + 10) / span);
      const parts = sum(nat) <= inner ? nat.map((v) => (v * inner) / sum(nat)) : ms.map(() => inner / ms.length);
      let t0 = st.t0;
      ms.forEach((m, j) => {
        motion.push({ node: m.node, tool: m.tool, label: tool(m), t0, t1: t0 + parts[j], show: motionShow(m), n: m.n });
        t0 += parts[j] + GAP / span;
      });
    }
    const hit = motion.find((m) => m.n === raised.n);
    return { stages: out, motion, seenT: (hit.t0 + hit.t1) / 2 };
  }

  const ribbonSvg = $("#f3-ribbon");
  let ribbon = null, seenT = 0;
  const marksFor = (k) => ({ seen: { t: seenT, title: `${T.abort.node} raised: ${T.abort.error}` }, cause: [causeRef(k)] });

  // what the ribbon draws gets three additions: durations inside the chips that hold them, a card-coloured ground
  // under every label so a fogged chip's muted text never sits on the hatch, and the raised motion's name by the ✕
  const TOKEN = "feature_center";
  function ground(g, before, x0, x1, y, h) {
    g.insertBefore(svg("rect", { class: "f3-ground", x: x0, y, width: Math.max(0, x1 - x0), height: h, rx: 3 }), before);
  }
  function dress(L) {
    for (const t of Base.$$(".motion-label", ribbonSvg)) {
      // a tool name cut short is left to its span's tooltip
      if (t.textContent.endsWith("…")) { t.remove(); continue; }
      const m = t.parentNode, x = +t.getAttribute("x"), y = +t.getAttribute("y");
      ground(m, t, x - 2, x + Base.textWidth(t.textContent, LANE) + 2, y - 9, 12);
    }
    for (const c of L.chips) {
      const g = c.g, kind = g.querySelector(".chip-kind"), label = g.querySelector(".chip-label");
      const y = c.y + L.chipH / 2 - 8;
      if (label) {
        const x = +label.getAttribute("x");
        ground(g, kind || label, (kind ? +kind.getAttribute("x") : x) - 3, x + Base.textWidth(label.textContent, CHIP) + 3, y, 16);
      } else if (kind) {
        const x = +kind.getAttribute("x"), s = +kind.getAttribute("width");
        ground(g, kind, x - 2, x + s + 2, y, 16);
      }
      if (label && c.s.dur != null && fitsDur(c.s, c.w)) {
        const right = c.x + c.w - 6, text = durText(c.s);
        const d = svg("text", { class: "f3-dur", x: right, y: c.y + L.chipH / 2 + 3.5, "text-anchor": "end", text }, g);
        ground(g, d, right - Base.textWidth(text, DUR) - 3, right + 3, y, 16);
      }
    }
    const x = L.x(seenT), y = L.rowsY[0].yb + 12;
    const by = svg("g", { class: "f3-raised", "aria-hidden": "true" }, ribbonSvg);
    svg("text", { x: x + 10, y: y + 4, text: tool(raised) }, by);
    monoArc();
  }
  // the arc's words are ours, the token it names is the report's
  function monoArc() {
    for (const t of Base.$$(".arc-label", ribbonSvg)) {
      const s = t.textContent, i = s.indexOf(TOKEN);
      if (i >= 0) t.replaceChildren(s.slice(0, i), svg("tspan", { class: "f3-tokspan", text: TOKEN }), s.slice(i + TOKEN.length));
    }
  }

  Base.mount($("#f3-program"), (w) => {
    if (narrow.matches) return;
    const lay = layout(w);
    seenT = lay.seenT;
    const opts = { stages: lay.stages, motion: lay.motion, marks: marksFor(lens), arc: arcOf(lens) };
    if (ribbon) { ribbon.update(opts); return; }
    ribbon = Base.ribbon(ribbonSvg, { mode: "timed", duration: 1, groups: true, ...opts });
    // a redraw rebuilds the motion lane, whose fog the ribbon does not carry over
    ribbon.on("render", (L) => { dress(L); Base.applyFog(ribbonSvg, lens); });
    ribbon.on("hover", (s) => link(s && s.node));
    ribbon.on("chip", (s) => pick(s));
    if (ribbon.layout) dress(ribbon.layout);
    Base.applyFog(ribbonSvg, lens);
  });

  // focus links a chip to its report line just as hover does (the ribbon reports hover only)
  $("#f3-program").addEventListener("focusin", (e) => { const n = e.target.closest("[data-node]"); if (n) link(n.dataset.node); });
  $("#f3-program").addEventListener("focusout", () => link(null));

  /* ---------------------------------------------------------------- the vertical list (narrow screens) */
  const list = $("#f3-steps");
  const rail = svg("svg", { class: "f3-rail", "aria-hidden": "true" }, $("#f3-program"));
  function buildList() {
    list.replaceChildren();
    let group = null, row = null;
    for (const s of steps) {
      if (s.group !== group) { group = s.group; el("li", { class: "grp", text: group }, list); }
      if (s.state === "unreached") {
        row = row || el("li", { class: "unreached" }, list);
        const u = el("span", { class: "u", title: `${s.node} · ${s.title}` }, row);
        u.append(Base.glyph("k-" + s.kind));
        el("code", { text: s.label }, u);
        continue;
      }
      const li = el("li", { class: "step" + (s.recovery ? " recovery" : ""), "data-node": s.node, "data-kind": s.kind,
        "data-state": s.state || "ran", "data-show": s.show, tabindex: "0", title: `${s.node} · ${s.title}` }, list);
      li.append(Base.glyph("k-" + s.kind));
      el("code", { text: s.label }, li);
      if (s.dur != null) el("span", { class: "dur", text: `${s.dur.toFixed(1)} s` }, li);
      li.addEventListener("click", () => pick(s));
      li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(s); } });
      for (const m of motionsOf(s.node))
        el("li", { class: "mot", "data-n": m.n, "data-show": motionShow(m), title: `${m.tool} · ${s.node}` }, list)
          .append(el("code", { text: tool(m) }));
    }
  }
  buildList();

  // the arc as a rail in the left gutter: ✕ on the motion that raised, ◆ on the cause, the rail between them
  function drawRail() {
    if (!list.offsetWidth) return;
    for (const n of Base.$$(".note", list)) n.remove();
    const c = T.cause[lens];
    const rows = c.node ? [list.querySelector(`.step[data-node="${c.node}"]`)] : Base.$$(`.step[data-node^="${c.group}."]`, list);
    const xRow = list.querySelector(`.mot[data-n="${raised.n}"]`);
    const note = Base.said(el("li", { class: "note", "data-style": c.style }), CAUSE[lens].arc);
    (c.style === "same" ? xRow : rows[rows.length - 1]).after(note);
    rail.replaceChildren();
    rail.style.top = `${list.offsetTop}px`;
    const h = list.scrollHeight;
    rail.setAttribute("viewBox", `0 0 24 ${h}`);
    rail.setAttribute("height", h);
    const mid = (li) => li.offsetTop + li.offsetHeight / 2;
    const ys = mid(xRow), top = mid(rows[0]), bot = mid(rows[rows.length - 1]), yc = (top + bot) / 2;
    if (rows.length > 1) svg("path", { class: "cause-bracket", d: `M22,${top - 6} H18 V${bot + 6} H22` }, rail);
    // as on the ribbon, "same" is an arc of zero length: the agent edited where the failure showed
    const same = c.style === "same";
    svg("path", { class: "blame-arc drawn", d: same ? `M10,${ys} V${ys}` : `M10,${ys - 9} V${yc + 9}`,
      "marker-end": same ? null : "url(#arc-head)", "data-style": c.style, "stroke-dasharray": c.style === "inferred" ? "4 3" : null }, rail);
    Base.mark(rail, "m-cause", rows.length > 1 ? 18 : 10, yc, { size: 12, cls: "mark-cause", title: CAUSE[lens].title });
    Base.mark(rail, "m-seen", 10, ys, { size: 12, cls: "mark-seen", title: `${T.abort.node} raised: ${T.abort.error}` });
  }
  Base.mount(list, drawRail);

  /* ---------------------------------------------------------------- the wrench from above */
  const inset = $("#f3-inset");
  const A = G.actual, P = G.perceived, GR = G.grasp;
  const rad = (d) => (d * Math.PI) / 180;
  const obb = () => {
    const c = Math.cos(rad(P.yaw_deg)), s = Math.sin(rad(P.yaw_deg));
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [
      P.center_xy[0] + a * P.half_len_m * c - b * P.half_wid_m * s, P.center_xy[1] + a * P.half_len_m * s + b * P.half_wid_m * c]);
  };
  let graspText = null;
  function drawInset(W) {
    if (W < 240) return;
    inset.replaceChildren();
    const r = P.radius_inner_m, fc = P.feature_center_xy;
    const pts = A.outline[0].concat(obb(), [[fc[0] - r, fc[1] - r], [fc[0] + r, fc[1] + r]]);
    const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
    const y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
    const wide = W >= 640;
    const feature = G.tokens.feature_center.replace(/^(feature_center=\(x=[^,]+),.*$/, "$1, …)");
    const PUT = "where perception put the ring", POSE = "simulator pose, frame 0";
    // above the wrench, the two labels share two rows; a phone too narrow for that lifts the actual ring's a row
    const lift = !wide && Math.max(
      Math.max(Base.textWidth(feature, MONO(11)), Base.textWidth("not in this report:", SANS(12, 700))) + Base.textWidth("actual ring", SANS(12, 700)),
      Base.textWidth(PUT, SANS(11.5)) + Base.textWidth(POSE, SANS(11.5))) + 12 > W;
    const left = wide ? 214 : 8, right = wide ? 176 : 8, top = wide ? 22 : lift ? 90 : 62, below = 46;
    const s = Math.min((W - left - right) / (x1 - x0), wide ? 2400 : 1e9);   // px per metre
    const ox = left + (W - left - right - (x1 - x0) * s) / 2;
    const X = (x) => ox + (x - x0) * s, Y = (y) => top + (y1 - y) * s;
    const H = Math.ceil(top + (y1 - y0) * s + below);
    inset.setAttribute("viewBox", `0 0 ${W} ${H}`);
    inset.setAttribute("height", H);
    const pathOf = (ring) => "M" + ring.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("L") + "Z";
    const text = (g, x, y, str, cls, anchor) => svg("text", { x, y, class: cls, "text-anchor": anchor || "start", text: str }, g);

    // the simulator's wrench and ring are always drawn. What perception and the plan made of them is drawn over it;
    // where a report leaves them out they stay drawn, faint, each over a hatch of its own footprint, so the fog
    // covers the estimates and never the simulator's wrench as a whole
    svg("path", { class: "f3-wrench", d: A.outline.map(pathOf).join(" "), "fill-rule": "evenodd" }, inset);
    const ring = { x: X(A.ring_xy[0]), y: Y(A.ring_xy[1]), r: A.ring_r_m * s };
    svg("circle", { class: "f3-ring", cx: ring.x, cy: ring.y, r: ring.r }, inset);

    const box = obb();
    const pr = { x: X(fc[0]), y: Y(fc[1]), r: r * s };
    const seen = svg("g", { class: "f3-perceived f3-shapes", "data-show": "skill" }, inset);
    svg("circle", { class: "fog-veil", cx: pr.x, cy: pr.y, r: pr.r + 4 }, seen);
    svg("path", { class: "f3-obb", d: pathOf(box) }, seen);
    svg("circle", { class: "f3-pring", cx: pr.x, cy: pr.y, r: pr.r }, seen);
    // the report's own tokens, gone where the report is; the veil's words take their place
    const said = svg("g", { class: "f3-perceived f3-said", "data-show": "skill" }, inset);
    const veil = svg("g", { class: "f3-veil", "data-show": "skill" }, inset);
    // the box's own label sits on its top edge, clear of the ring's leader on narrow screens
    const bx0 = X(Math.min(...box.map((p) => p[0]))), bx1 = X(Math.max(...box.map((p) => p[0])));
    text(said, wide ? bx0 + 4 : bx0 + (bx1 - bx0) * 0.3, Y(Math.max(...box.map((p) => p[1]))) - 5, "target_obb", "f3-mono muted");

    const gx = X(GR.center_xy[0]), gy = Y(GR.center_xy[1]);
    const grasp = svg("g", { class: "f3-grasp f3-shapes", "data-show": "motion skill" }, inset);
    svg("rect", { class: "fog-veil", x: gx - 9, y: gy - 9, width: 18, height: 18, rx: 4 }, grasp);
    svg("path", { class: "f3-x", d: `M${gx - 5},${gy - 5}L${gx + 5},${gy + 5}M${gx + 5},${gy - 5}L${gx - 5},${gy + 5}` }, grasp);
    const gl = top + (y1 - y0) * s + 14;
    svg("path", { class: "f3-lead", d: `M${gx},${gy + 7}V${gl - 4}` }, grasp);
    // centred under the target, but kept inside the box for the longest of its two labels
    const gw = Math.max(...[G.tokens.shift, G.tokens.toward].map((t) => Base.textWidth(t, MONO(11)))) / 2 + 2;
    const gcx = Math.min(Math.max(gx, gw), W - gw);
    text(grasp, gcx, gl + 9, "grasp target", "f3-label", "middle");
    graspText = text(svg("g", { class: "f3-grasp f3-said", "data-show": "motion skill" }, inset), gcx, gl + 24, "", "f3-mono", "middle");

    // labels: beside the wrench on wide screens, above it on narrow ones. The actual ring's place is in every
    // report too (its offset from the hook's tip), so its label says only where the drawing takes it from.
    const lab = svg("g", { class: "f3-labels" }, inset);
    if (wide) {
      const lx = pr.x - pr.r - 12;
      svg("path", { class: "f3-lead seen", d: `M${pr.x - pr.r - 2},${pr.y}H${lx + 4}` }, seen);
      text(said, lx, pr.y - 3, feature, "f3-mono seen", "end");
      text(said, lx, pr.y + 12, PUT, "f3-note", "end");
      text(veil, lx, pr.y - 3, "not in this report:", "f3-label", "end");
      text(veil, lx, pr.y + 12, PUT, "f3-note", "end");
      const rx = X(x1) + 14;
      svg("path", { class: "f3-lead", d: `M${ring.x + ring.r + 2},${ring.y}H${rx - 4}` }, lab);
      text(lab, rx, ring.y - 3, "actual ring", "f3-label");
      text(lab, rx, ring.y + 12, POSE, "f3-note");
    } else {
      svg("path", { class: "f3-lead seen", d: `M${pr.x},${pr.y - pr.r - 2}V${top - 22}` }, seen);
      text(said, 0, top - 42, feature, "f3-mono seen");
      text(said, 0, top - 28, PUT, "f3-note");
      text(veil, 0, top - 42, "not in this report:", "f3-label");
      text(veil, 0, top - 28, PUT, "f3-note");
      const up = lift ? 28 : 0;
      svg("path", { class: "f3-lead", d: `M${ring.x},${ring.y - ring.r - 2}V${top - 22 - up}` }, lab);
      text(lab, W - 2, top - 42 - up, "actual ring", "f3-label", "end");
      text(lab, W - 2, top - 28 - up, POSE, "f3-note", "end");
    }
    // 20 mm, to scale
    const sb = svg("g", { class: "geo-scale" }, inset), sy = H - 8, sx = wide ? X(x0) : 0;
    svg("line", { x1: sx, x2: sx + 0.02 * s, y1: sy, y2: sy }, sb);
    svg("line", { x1: sx, x2: sx, y1: sy - 3, y2: sy + 3 }, sb);
    svg("line", { x1: sx + 0.02 * s, x2: sx + 0.02 * s, y1: sy - 3, y2: sy + 3 }, sb);
    text(sb, sx + 0.02 * s + 5, sy + 3.5, "20 mm");
    Base.applyFog(inset, lens);
    setGrasp();
  }
  const setGrasp = () => { if (graspText) graspText.textContent = lens === "motion" ? G.tokens.toward : G.tokens.shift; };
  Base.mount(inset.parentElement, (w) => drawInset(inset.getBoundingClientRect().width || w));

  /* ---------------------------------------------------------------- the report, the diagnosis, the edits */
  const pre = $("#f3-report");
  let reportLines = [];
  const failing = (k) => (line) => line.startsWith("**Your graph raised") || (k === "motion" && line.includes("error was raised during this motion"));
  function showReport(k) {
    const c = C.conditions[k];
    // the evidence line is ruled in --cause only where the report named the cause (per skill)
    reportLines = Base.report(pre, c.excerpt, { focus: k === "skill" ? c.focus : null, symptom: failing(k) });
    const tok = G.tokens.feature_center;
    for (const l of reportLines) {
      const i = l.textContent.indexOf(tok);
      if (k !== "skill" || i < 0) continue;
      const txt = l.textContent;
      l.replaceChildren(txt.slice(0, i), el("b", { class: "f3-tok", text: tok }), txt.slice(i + tok.length));
      Base.softBreaks(l);   // the rebuilt line keeps report()'s break points
    }
    for (const l of reportLines) {
      const node = nodeOf(l.textContent);
      if (!node) continue;
      l.dataset.node = node;
      l.addEventListener("pointerenter", () => pulseChip(node, true));
      l.addEventListener("pointerleave", () => pulseChip(node, false));
    }
    centreReport();
  }
  // the evidence the lens is about, centred in the box at any width: per skill the underlined token (the
  // perceive_sg.loop entry wraps to some sixteen lines on a phone), otherwise the last line ruled as the symptom
  function centreReport() {
    const at = pre.querySelector(".f3-tok") || Base.$$(".ln.symptom", pre).pop();
    if (!at) return;
    const b = pre.getBoundingClientRect(), n = at.getBoundingClientRect();
    pre.scrollTop += n.top + n.height / 2 - (b.top + pre.clientTop + pre.clientHeight / 2);
  }
  // the node a report line names: by name, or (per motion) through the motion it reports
  function nodeOf(text) {
    const s = steps.find((st) => text.includes("`" + st.node + "`"));
    if (s) return s.node;
    const m = /^### Motion (\d+) ·/.exec(text);
    return m ? T.motions.find((mm) => mm.n === +m[1]).node : null;
  }
  function lineOf(node) {
    const ns = motionsOf(node).map((m) => m.n);
    return reportLines.find((l) => l.textContent.includes("`" + node + "`"))
      || reportLines.find((l) => { const m = /^### Motion (\d+) ·/.exec(l.textContent); return m && ns.includes(+m[1]); }) || null;
  }
  let lit = null;
  function link(node) {
    if (lit) lit.classList.remove("pulse");
    lit = node ? lineOf(node) : null;
    if (!lit) return;
    lit.classList.add("pulse");
    const b = pre.getBoundingClientRect(), n = lit.getBoundingClientRect();
    if (n.top < b.top || n.bottom > b.bottom) pre.scrollTop += n.top - b.top - 2 * parseFloat(getComputedStyle(pre).lineHeight);
  }
  function pulseChip(node, on) {
    for (const g of Base.$$(`[data-node="${node}"]`, $("#f3-program"))) g.classList.toggle("pulse", on);
  }

  const said = $("#f3-said"), more = $("#f3-more");
  const firstSentences = (t, n) => t.split(/(?<=[.!?])\s+(?=[A-Z0-9`*])/).slice(0, n).join(" ");
  function showSaid() {
    const full = C.conditions[lens].diagnosis, open = more.getAttribute("aria-expanded") === "true";
    const short = firstSentences(full, 2);
    Base.said(said, open || short === full ? full : short + " …", `Opus 5, after reading the ${NAME[lens]} report of round k0`);
    more.hidden = short === full;
    more.textContent = open ? "Show less" : "Read all";
  }
  more.addEventListener("click", () => { more.setAttribute("aria-expanded", String(more.getAttribute("aria-expanded") !== "true")); showSaid(); });

  const COLS = [["perceive", "perceive"], ["grasp", "grasp"], ["carry", "carry"], ["mate", "mate"], ["wiring", "graph"]];
  // one row per round the run had: the three runs differ in length, and a row it never had would read as "no edit"
  function showEdits(k) {
    const box = $("#f3-edits"), edited = C.conditions[k].edited;
    box.replaceChildren(el("span", { class: "corner" }));
    for (const [key, label] of COLS) el("span", { class: "colh" + (key === "perceive" ? " cause" : ""), text: label }, box);
    edited.forEach((e, r) => {
      el("span", { class: "rowh", text: `k${r}` }, box);
      for (const [key, label] of COLS)
        el("span", { class: "cell" + (key === "perceive" ? " perceive" : ""), "data-col": key, "data-on": e.includes(key) ? "" : null,
          title: `after k${r}: ${e.includes(key) ? "edited" : "did not edit"} ${label}` }, box);
    });
    const touched = edited.map((e, r) => (e.includes("perceive") ? `k${r}` : null)).filter(Boolean);
    box.setAttribute("aria-label", `The ${NAME[k]} run's edits, round by round: ${touched.length ? "perception edited after " + touched.join(" and ") : "perception never edited"}.`);
  }

  const READOUT = {
    episode: "Per episode, the report gives only the error at `grasp_sg.reach` and the end state. The agent edited the grasp, where the episode failed, and never touched perception in any round.",
    motion: "Per motion, the report gives one block per robot motion and none for perception, which moves nothing. The agent had to infer the bad estimate from where the hand was sent, and edited perception first.",
    skill: "Per skill, the report lists what every step returned. The agent read `perceive_sg.loop`'s `feature_center` on the wrong end of the wrench, traced the miss at `grasp_sg.reach` back to it, and edited perception first.",
  };
  const readout = $("#f3-readout");
  function pick(s) {
    const keys = s.show ? s.show.split(" ").filter((k) => KEYS.includes(k)) : [];
    const words = s.state === "unreached" ? "never reached in this episode."
      : `${s.dur != null ? s.dur.toFixed(1) + " s, " : ""}${keys.includes(lens) ? "in" : "not in"} the ${NAME[lens]} report.`;
    Base.said(readout, `\`${s.node}\`: ${words}`);
    link(s.node);
  }

  const ladders = Base.$$(".f3-nums .ladder", root);
  function setLens(k, animate) {
    lens = k;
    root.dataset.lens = k;
    Base.applyFog(root, k);
    if (ribbon) {
      ribbon.setCause({ cause: [causeRef(k)], arc: arcOf(k) }).drawArc({ animate });
      monoArc();
      ribbonSvg.setAttribute("aria-label", `The failed episode as program steps. The failure shows at ${T.abort.node}; with the ${NAME[k]} report the agent's first edit went to ${T.cause[k].node || T.cause[k].group} (${plain(CAUSE[k].arc)}).`);
    }
    drawRail();
    setGrasp();
    showReport(k);
    showSaid();
    showEdits(k);
    for (const lad of ladders) {
      const ns = Base.$$(".n", lad), at = ns.findIndex((n) => n.dataset.key === k);
      ns.forEach((n, i) => { n.classList.toggle("on", i === at); n.classList.toggle("later", i > at); });
    }
    for (const n of Base.$$(".f3-nk [data-key]", root)) n.classList.toggle("on", n.dataset.key === k);
    Base.said(readout, READOUT[k]);
  }
  const lensCtl = Base.lens($("#f3-lens"), (k) => setLens(k, true));
  // a numeral or its label is a shortcut to its report for the pointer; the lens stays the keyboard's way
  for (const n of Base.$$(".f3-nums [data-key]", root)) n.addEventListener("click", () => lensCtl.set(n.dataset.key));
  // on a phone the lens follows the reader down the stage (css), but only while the stage is on screen: off screen
  // it stays where it belongs instead of resting at the stage's foot
  const stage = $("#f3-stage");
  if ("IntersectionObserver" in window) new IntersectionObserver(([e]) => stage.classList.toggle("f3-in", e.isIntersecting)).observe(stage);
  narrow.addEventListener("change", () => setLens(lens, false));
  setLens(lens, false);
  // a new width rewraps the report (and the fonts arriving do the same), so the evidence is centred again
  Base.mount(pre, centreReport);

  /* ---------------------------------------------------------------- results: Table 2 as bars */
  const results = $("#f3-results"), tip = Base.tooltip(results);
  const ROW_KEYS = ["initial", "episode", "motion", "skill"];
  const ROW_LABEL = { initial: "First program", episode: "Per episode", motion: "Per motion", skill: "Per skill" };
  const TASK = { overall: "Overall", tool_hanging: "Tool Hanging", sharps_disposal: "Syringe Packing" };
  const value = (key, task) => temporal.rows.find((r) => r.key === key)[task];
  let task = "overall";
  const barsSvg = $("#f3-bars");
  let bars = null;
  function drawBars(W) {
    if (W < 240) return;   // a passing resize (a screenshot's, say) too narrow to draw in
    barsSvg.replaceChildren();
    const lw = 96, vx = 44, x0 = lw, x1 = W - vx, rowH = 30, barH = 14, top = 4;
    const H = top + ROW_KEYS.length * rowH + 20;
    barsSvg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    barsSvg.setAttribute("height", H);
    const X = (v) => x0 + ((x1 - x0) * v) / 100;
    const grid = svg("g", { class: "f3-grid" }, barsSvg);
    for (const v of [0, 25, 50, 75, 100]) {
      svg("line", { x1: X(v), x2: X(v), y1: top, y2: top + ROW_KEYS.length * rowH }, grid);
      if (v % 50 === 0) svg("text", { x: X(v), y: H - 4, "text-anchor": "middle", text: v === 100 ? "100%" : String(v) }, grid);
    }
    const clip = `f3-barclip`;
    svg("rect", { x: x0, y: 0, width: W - x0, height: H }, svg("clipPath", { id: clip }, svg("defs", {}, barsSvg)));
    bars = ROW_KEYS.map((key, i) => {
      const y = top + i * rowH + (rowH - barH) / 2;
      const g = svg("g", { class: "f3-bar", "data-key": key }, barsSvg);
      svg("rect", { class: "hit", x: 0, y: top + i * rowH, width: W, height: rowH }, g);
      svg("text", { class: "f3-rowlabel", x: lw - 10, y: y + barH / 2 + 4.5, "text-anchor": "end", text: ROW_LABEL[key] }, g);
      // the bar's left end runs under the clip, so only its value end is rounded
      const rect = svg("rect", { class: "bar " + key, x: x0 - 4, y, height: barH, rx: 4, "clip-path": `url(#${clip})` }, g);
      const val = svg("text", { class: "f3-val", y: y + barH / 2 + 5.5 }, g);
      tip.bind(g, () => ({ title: `${ROW_LABEL[key]} · ${TASK[task]}`, rows: [{ text: `${value(key, task)}% held-out success (Table 2)` }] }));
      return { key, rect, val, X };
    });
    paintBars(false);
  }
  function paintBars(animate) {
    if (!bars) return;
    for (const b of bars) {
      const v = value(b.key, task);
      b.rect.style.transition = animate && !Base.reduced ? "width var(--t-step) var(--ease)" : "none";
      b.val.style.transition = animate && !Base.reduced ? "transform var(--t-step) var(--ease)" : "none";
      b.rect.style.width = `${Math.max(0, b.X(v) - b.X(0) + 4)}px`;
      b.val.setAttribute("x", 0);
      b.val.style.transform = `translateX(${b.X(v) + 6}px)`;
      b.val.textContent = `${v}%`;
    }
    // the takeaway for a screen reader: which report did best in this task, then the others in order
    const ranked = ROW_KEYS.slice(1).sort((x, y) => value(y, task) - value(x, task));
    const name = (k) => ROW_LABEL[k].toLowerCase();
    barsSvg.setAttribute("aria-label", `Held-out success ${task === "overall" ? "overall" : "in " + TASK[task]}: ${name(ranked[0])} reports highest at ${value(ranked[0], task)}%, then ${ranked.slice(1).map((k) => `${name(k)} ${value(k, task)}%`).join(" and ")}; the first program ${value("initial", task)}%.`);
    const t = $("#f3-bars-table");
    t.replaceChildren(el("caption", { text: `Held-out success, ${TASK[task]}, %` }));
    for (const key of ROW_KEYS) { const tr = el("tr", {}, t); el("th", { text: ROW_LABEL[key] }, tr); el("td", { text: String(value(key, task)) }, tr); }
    const v = (k) => [el("span", { class: "num", "data-src": "chapters/skill_aquisition.tex", text: String(value(k, task)) }), "%"];
    $("#f3-bars-readout").replaceChildren(`${TASK[task]}: per episode `, ...v("episode"), ", per motion ", ...v("motion"),
      ", per skill ", ...v("skill"), ...(task === "sharps_disposal"
        ? [". A syringe left across the opening shows in the end state, so a coarse report is enough."]
        : [", from ", ...v("initial"), " for the first program."]));
  }
  Base.mount(barsSvg, drawBars);
  Base.lens($("#f3-task"), (k) => { task = k; paintBars(true); });

  /* ---------------------------------------------------------------- results: Figure 6's counts as dot strips */
  const reachSvg = $("#f3-reach");
  function drawReach(W) {
    if (W < 240) return;
    reachSvg.replaceChildren();
    const lw = 96, x0 = lw, x1 = W - 8, stripH = 52, pitch = 9, top = 12;
    const bins = R.bins.length, bw = (x1 - x0) / bins;
    const H = top + R.conditions.length * stripH + 30;
    reachSvg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    reachSvg.setAttribute("height", H);
    const cx = (i) => x0 + (i + 0.5) * bw;
    const grid = svg("g", { class: "f3-grid" }, reachSvg);
    R.bins.forEach((b, i) => svg("text", { x: cx(i), y: H - 16, "text-anchor": "middle", text: b }, grid));
    svg("text", { x: (x0 + x1) / 2, y: H - 2, "text-anchor": "middle", class: "f3-axis-title", text: "skills traced back" }, grid);
    R.conditions.forEach((c, j) => {
      const base = top + (j + 1) * stripH - 8;
      svg("line", { class: "f3-base", x1: x0, x2: x1, y1: base + 5, y2: base + 5 }, reachSvg);
      svg("text", { class: "f3-rowlabel", x: lw - 10, y: base - 6, "text-anchor": "end", text: c.label }, reachSvg);
      c.counts.forEach((n, i) => {
        const g = svg("g", { class: "f3-bin" }, reachSvg);
        svg("rect", { class: "hit", x: cx(i) - bw / 2, y: base - stripH + 10, width: bw, height: stripH - 4 }, g);
        for (let d = 0; d < n; d++) {
          const col = d % 3, rowi = Math.floor(d / 3);
          svg("circle", { class: "dot " + c.key, cx: cx(i) + (col - 1) * pitch, cy: base - rowi * pitch, r: 3.6 }, g);
        }
        tip.bind(g, () => ({ title: c.label, rows: [{ text: `${n} edit${n === 1 ? "" : "s"} traced back ${R.bins[i] === "6+" ? "6 or more skills" : R.bins[i] + " skill" + (R.bins[i] === "1" ? "" : "s")}` }] }));
      });
      // the mean, placed on the bins' own scale
      const mx = x0 + (c.mean + 0.5) * bw;
      // the tick rises above the tallest stack of dots, so its label never covers one
      const tickTop = base - 3 * pitch - 12;
      svg("line", { class: "f3-mean", x1: mx, x2: mx, y1: tickTop, y2: base + 9 }, reachSvg);
      svg("text", { class: "f3-meanlabel", x: mx + 5, y: tickTop + 9, text: `mean ${c.mean.toFixed(1)}` }, reachSvg);
    });
    const t = $("#f3-reach-table");
    t.replaceChildren(el("caption", { text: "Edits by skills traced back" }));
    const hr = el("tr", {}, t);
    el("th", { text: "Report" }, hr);
    for (const b of R.bins) el("th", { text: b }, hr);
    el("th", { text: "mean" }, hr);
    for (const c of R.conditions) {
      const tr = el("tr", {}, t);
      el("th", { text: c.label }, tr);
      for (const n of c.counts) el("td", { text: String(n) }, tr);
      el("td", { text: c.mean.toFixed(1) }, tr);
    }
  }
  Base.mount(reachSvg, drawReach);

  /* ---------------------------------------------------------------- the drawer: Table 2 as printed */
  const tasks = ["overall", "tool_hanging", "sharps_disposal", "gear_mesh", "usbc_insert", "cable_route"];
  const best = Object.fromEntries(tasks.map((t) => [t, Math.max(...temporal.rows.filter((r) => r.key !== "initial").map((r) => r[t]))]));
  Base.paperTable($("#f3-t2"),
    [["Feedback", "Overall", "Tool Hanging", "Syringe Packing", "Gear Meshing", "USB-C Insertion", "Cable Routing"]],
    temporal.rows.map((r) => [r.label, ...tasks.map((t) => ({ v: String(r[t]), best: r.key !== "initial" && r[t] === best[t] }))]),
    { rowClass: (i) => (temporal.rows[i].key === "initial" ? "base" : null) });
});
