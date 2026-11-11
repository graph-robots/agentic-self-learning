/* Part 1 (DESIGN_SPEC §3.2): three failing first programs. Each card keeps one clock for its clip, its episode
   ribbon (✕ where the failure shows, ◆ where it was decided) and one diagram drawn from the run's recorded poses.
   Every number in a readout is read from the tapes at the playhead, inside the card's "example run" frame. */
Base.section("problem", async (root, d) => {
  const $ = (sel, r) => (r || root).querySelector(sel);
  const P = d.problem;
  const clipInfo = (id) => d.clips.clips.find((c) => c.id === id);
  const within = (t, spans) => spans.some((s) => t >= s.t0 && t <= s.t1);
  const words = (label) => label.replace(/ \(robot still\)$/, "");
  // a step in words: its subgraph, and the node when that adds something ("engage", "grasp close", "transport_move")
  const step = (s) => {
    const group = s.group.replace(/_sg$/, "");
    return s.label === "run" ? group : s.label.includes(group) ? s.label : `${group} ${s.label}`;
  };
  // what the program was doing at t: a step, a still stretch, or a gap the clip's record leaves unplaced (where the
  // graph looped back), named after the step before it
  const phase = (clip, t) => {
    const s = clip.stages.find((x) => t >= x.t0 && t < x.t1);
    if (s) return step(s);
    const st = clip.still.find((x) => t >= x.t0 && t < x.t1);
    if (st) return `${words(st.label)}, robot still`;
    const prev = clip.stages.filter((x) => x.t1 <= t).pop();
    return prev ? `after ${step(prev)}` : "before the first step";
  };
  const fill = (table, rows) => {
    table.replaceChildren();
    for (const [k, v] of rows) {
      const tr = Base.el("tr", {}, table);
      Base.el("th", { text: k, scope: "row" }, tr);
      Base.el("td", { text: v }, tr);
    }
  };
  const caption = (key, clip) => {
    $(`#problem-${key}-cap`).textContent = `${clip.model}'s first program, one training layout (${clip.layout}). The clip replays at ${clip.speed}× speed.`;
  };
  // a ribbon's own layout is ready on its first draw, before a listener can hear it: run fn now and on each redraw
  const onLayout = (ribbon, fn) => {
    ribbon.on("render", fn);
    if (ribbon.layout) fn(ribbon.layout);
  };

  /* One card: clip, ribbon and diagram on one clock. o.draw(t) moves the diagram, o.describe(t) is the readout,
     o.at(t) says whether the playhead stands on the ✕ ("seen") or a ◆ ("cause"). The matching text block lights only
     once the reader has played, scrubbed or asked; the opening frame lights nothing, the same on every card. */
  async function card(key, o) {
    const el = $(`#problem-${key}`), readout = $(`#problem-${key}-readout`);
    const div = $(".clip", el);
    div.dataset.start = String(o.start);
    const clip = await Base.clip(div);
    if (o.clipped) o.clipped(div);
    const ribbon = Base.ribbon($(`#problem-${key}-ribbon`), { ...o.ribbon, readout });
    let t = o.start, engaged = false;
    const show = (tt) => {
      t = tt;
      ribbon.setTime(tt);
      o.draw(tt);
      el.dataset.at = engaged ? o.at(tt) : "";
      readout.textContent = o.describe(tt);
    };
    const engage = () => { engaged = true; };
    clip.follow(show);
    clip.video.addEventListener("play", engage);
    ribbon.on("seek", (tt) => { engage(); clip.pause(); clip.seek(tt); show(tt); });
    ribbon.on("chip", () => { readout.textContent = o.describe(t); });
    if (o.after) o.after(ribbon);
    show(o.start);

    const play = $('[data-act="play"]', el), icon = $("use", play), label = $("span", play);
    const paint = () => {
      const on = !clip.video.paused && !clip.video.ended;
      icon.setAttribute("href", on ? "#i-pause" : "#i-play");
      label.textContent = on ? "Pause" : "Play";
    };
    for (const e of ["play", "pause", "ended"]) clip.video.addEventListener(e, paint);
    play.addEventListener("click", () => {
      if (!clip.video.paused) { clip.pause(); return; }
      // from the start, unless the reader has already moved through the episode and wants to go on from there
      clip.play(!engaged || t >= clip.info.duration_s - 0.1 ? 0 : t);
    });
    $('[data-act="trace"]', el).addEventListener("click", () => {
      engage();
      clip.pause();
      clip.seek(o.traceT);
      show(o.traceT);
      ribbon.drawArc({ animate: true });
      if (o.onTrace) o.onTrace(ribbon);
    });
    const ghost = $('[data-act="ghost"]', el);
    if (ghost) {
      ghost.addEventListener("change", () => { o.ghost(ghost.checked); show(t); });
      if (ghost.checked) { o.ghost(true); show(t); }
    }
  }

  /* ---------------------------------------------------------------- 1 · Tool Hanging */
  const th = clipInfo("th_k0"), th4 = clipInfo("th_k4");
  const TT = d.tapes_th, T0 = TT.clips.th_k0, T4 = TT.clips.th_k4, ev = T0.events, PT = P.th;
  const at0 = Base.sampler(T0), lastT0 = T0.t[T0.t.length - 1];
  const DOMAIN = { along: [-80, 140], vert: [-60, 30] };
  // the ring rests against the tip for the 3 s before contact, so a 2 s trail would be empty at the default frame;
  // 8 s shows the approach under the shank's axis that led there
  const TRAIL_S = 8;
  const inView = (s) => s.along >= DOMAIN.along[0] && s.along <= DOMAIN.along[1] && s.vert >= DOMAIN.vert[0] && s.vert <= DOMAIN.vert[1];
  // round 4's ring from its engage step on: in front of the tip, over it, onto the shank
  const engage4 = th4.stages.find((s) => s.node === "engage_sg.run").t0;
  const g0 = T4.t.findIndex((x) => x >= engage4), n4 = T4.t.length;
  const ghost4 = { along: T4.along.slice(g0), vert: T4.vert.slice(g0), n_end: T4.n[n4 - 1] };
  const rail = Base.rail($("#problem-th-rail"), {
    domain: DOMAIN, sample: (t) => at0(Math.min(t, lastT0)), shank: TT.shank, ring: TT.ring, offscreen: "out of view",
    trailFrom: TRAIL_S, seen: { t: PT.seen.t, title: "where the ring stops: just short of the tip" },
  });
  $("#problem-th-trailkey").textContent = `its path over the last ${TRAIL_S} s`;
  let offscreen = "out of view", thGhost = false;
  // the first sample after the release that leaves the view: where the ring falls to
  const exitI = T0.t.findIndex((x, i) => x > ev.release_t && !inView({ along: T0.along[i], vert: T0.vert[i] }));
  const exitT = T0.t[exitI];
  const over = railOverlay($("#problem-th-railbox"), DOMAIN, TT, { along: T0.along[exitI], vert: T0.vert[exitI] });
  const thSpans = PT.cause;
  await card("th", {
    start: PT.start,
    traceT: Math.round(((thSpans[0].t0 + thSpans[0].t1) / 2) * 100) / 100,
    clipped: (div) => hookCallout(div, PT.hook_in_frame),
    ribbon: {
      mode: "timed", duration: th.duration_s, stages: th.stages, still: th.still, ticks: true,
      end: { kind: "fail", text: PT.end_line },
      marks: {
        seen: { t: PT.seen.t, title: "the ring stops short of the tip" },
        cause: thSpans.map((c) => ({ t0: c.t0, t1: c.t1, title: c.node === "perceive_sg.loop"
          ? "perceive_sg.loop: where perception put the ring"
          : "mate_sg.compute: the crossing height, then the crossing leg planned from it" })),
      },
      arc: { style: PT.arc, label: "decided earlier: the ring estimate and the crossing height" },
    },
    draw(t) {
      const want = t >= ev.release_t ? "falls" : "out of view";
      if (want !== offscreen) { offscreen = want; rail.update({ offscreen }); }
      rail.set(t);
      const s = at0(Math.min(t, lastT0));
      // the lines the dimension's label keeps clear of: the trail as Base.rail samples it, and round 4's path
      const trail = [];
      for (let i = 0, n = TRAIL_S * 12; i <= n; i++) {
        const ti = t - TRAIL_S + (TRAIL_S * i) / n;
        if (ti >= 0) { const p = at0(Math.min(ti, lastT0)); trail.push([p.along, p.vert]); }
      }
      const lines = [trail].concat(thGhost ? [ghost4.along.map((a, i) => [a, ghost4.vert[i]])] : []);
      over.set(t < ev.release_t && inView(s) ? s : null, t >= PT.seen.t && t < exitT ? at0(t) : null, lines);
    },
    at: (t) => (t >= PT.seen.t && t <= ev.release_t ? "seen" : within(t, thSpans) ? "cause" : ""),
    describe(t) {
      const s = at0(Math.min(t, lastT0));
      const side = (v, a, b) => `${Math.round(Math.abs(v))} mm ${v >= 0 ? a : b}`;
      const where = inView(s)
        ? `the ring is ${side(s.along, "in front of", "behind")} the tip and ${side(s.vert, "above", "below")} the shank's axis`
        : t >= ev.release_t ? `the wrench has fallen; its ring is ${Math.round(-s.vert)} mm below the shank`
          : `the ring is out of view, ${Math.round(s.dist)} mm from the shank`;
      let note = "";
      if (t >= PT.seen.t && t <= ev.release_t) note = " · ✕ seen here: the ring stops short of the tip";
      else if (within(t, [thSpans[0]])) note = " · ◆ decided here: perceive_sg.loop places the ring";
      else if (within(t, [thSpans[1]])) note = " · ◆ decided here: the crossing height from mate_sg.compute";
      return `${t.toFixed(1)} s · ${phase(th, t)} · ${where}${note}`;
    },
    ghost(on) { thGhost = on; rail.update({ ghost: on ? ghost4 : null }).showGhost(on); },
  });
  Base.said($("#problem-th-said"), PT.quote, PT.cite);
  caption("th", th);
  const c0 = at0(PT.start);
  fill($("#problem-th-data"), [["time, s", PT.start.toFixed(2)], ["ring, mm in front of the tip", c0.along.toFixed(1)],
    ["ring, mm above the shank's axis", c0.vert.toFixed(1)], ["ring's inner radius, mm", String(TT.ring.inner_r_mm)]]);

  /* ---------------------------------------------------------------- 2 · Syringe Packing */
  const sy = clipInfo("syr_k0"), sy2 = clipInfo("syr_k2"), TS = d.tapes_syr, S0 = TS.clips.syr_k0, S2 = TS.clips.syr_k2, PS = P.syr;
  const track = (S, name) => Base.sampler({ t: S.t, ...S.syringes[name] });
  const nodes = (clip, node) => clip.stages.filter((s) => s.node === node);
  const pass2 = nodes(sy, "grasp_sg.open")[1].t0, pass2b = nodes(sy2, "grasp_sg.open")[1].t0;
  const grip2 = nodes(sy, "grasp_sg.close")[1].t0;
  const bars0 = S0.order.map((name) => track(S0, name)), bars2 = S2.order.map((name) => track(S2, name));
  // which pass the program is in, and which syringe the diagram follows: the one in hand, and between passes the one
  // just let go, which lies across the lid in plain view while the arm is away at the tray for the next
  const pass = (t) => (t < pass2 ? 0 : 1);
  const carried = (t) => (t < grip2 ? 0 : 1);
  // round 2's time at the same step of round 0: matched stage by stage (round 2 replaced carry and release by one insert)
  const k2Time = Base.piecewise(syncPairs(sy, sy2));
  const ghostAt = (t) => { const u = k2Time(t); return bars2[u < pass2b ? 0 : 1](u); };
  const lid = TS.lid_z_mm, L = TS.syringe.len_mm, DIA = TS.syringe.dia_mm;
  // tall enough for the flat carry, which crosses some 120 mm over the lid
  const KEY = { height: 210, domain: { x: [-90, 180], y: [-50, 140] } };
  const key = Base.keyhole($("#problem-syr-key"), { ...KEY, opening_mm: TS.opening_mm, syringe: TS.syringe, lid_z_mm: lid });
  const opening = { kind: "dim", from: [-TS.opening_mm / 2, -14], to: [TS.opening_mm / 2, -14], label: `${TS.opening_mm} mm`, off: -6, key: "opening" };
  // the syringe's length, called out along it while it lies near flat and whole in view, against the opening below:
  // over the syringe when it is low, under it when it is high in the section. The label is the paper's figure for
  // the syringe, as the prose beside it gives it; with round 2's bar shown it would sit across that bar, so it goes
  const lengthDim = (s) => {
    if (syrGhost) return [];
    const ts = (s.tilt_signed * Math.PI) / 180, phi = Math.atan2(Math.cos(ts), -Math.sin(ts));
    const ax = [Math.cos(phi), Math.sin(phi)], c = [s.r_mm, s.z_mm - lid];
    const half = (L * Math.abs(ax[0])) / 2, [x0, x1] = KEY.domain.x;
    if (Math.abs(ax[0]) < 0.9 || c[0] - half < x0 || c[0] + half > x1) return [];
    const side = c[1] > 60 ? -1 : 1, off = side * (DIA / 2 + 8);
    const up = ax[0] > 0 ? [-ax[1], ax[0]] : [ax[1], -ax[0]];
    const end = (k) => [c[0] + (k * L * ax[0]) / 2 + up[0] * off, c[1] + (k * L * ax[1]) / 2 + up[1] * off];
    return [{ kind: "dim", from: end(-1), to: end(1), label: `${PS.paper.len_mm} mm`, off: side * 5, key: "length",
      title: `${PS.paper.len_mm} mm: the paper's syringe (${PS.paper.src})` }];
  };
  const onion = carryTrace($("#problem-syr-keybox"), { ...KEY, lid, syringe: TS.syringe });
  const gauge = Base.gauge($("#problem-syr-gauge"), { min: 0, max: 90, labels: ["upright", "flat"], size: 120, r: 44 });
  const tiltLabel = $("#problem-syr-tiltlabel");
  let syrGhost = false, tape = null, barsFor = -1;
  // the syringe not followed sits underneath, dashed; the followed one on top
  const setBars = (i) => {
    barsFor = i;
    key.update({ bars: [{ sample: bars0[1 - i], cls: "idle" }, { sample: bars0[i], cls: "flat" }]
      .concat(syrGhost ? [{ sample: ghostAt, cls: "ghost" }] : []) });
  };
  const tapeSeries = () => S0.order.map((name) => ({ t: S0.t, v: S0.syringes[name].tilt }))
    .concat(syrGhost ? [ghostSeries()] : []);
  // round 2's carried syringe, on round 0's clock
  const ghostSeries = () => ({ t: S2.t.map(k2Time.invert), cls: "ghost",
    v: S2.t.map((u, i) => S2.syringes[S2.order[u < pass2b ? 0 : 1]].tilt[i]) });
  const syrSpans = PS.cause;
  const syrSeen = nodes(sy, "transport_sg.release");
  const syrWhere = (s) => {
    const r = Math.round(s.r_mm);
    if (s.r_mm > 150) return `${r} mm from the opening`;
    // lid_z_mm is where a syringe let go flat comes to rest, so within a little of it the syringe lies on the lid
    if (s.z_mm - lid > DIA / 2 + 1.5) return `${Math.round(s.z_mm - lid)} mm above the lid, ${r} mm from the opening's centre`;
    return `lying on the lid, ${r} mm from the opening's centre`;
  };
  await card("syr", {
    start: PS.start,
    traceT: syrSpans[0].t0,
    ribbon: {
      mode: "timed", duration: sy.duration_s, still: sy.still, ticks: true, groups: "always",
      stages: sy.stages.map((s) => ({ ...s, group: s.t0 < pass2 ? "syringe 1" : "syringe 2" })),
      end: PS.end.map((text) => ({ kind: "fail", text })),
      marks: {
        seen: PS.seen.map((s) => ({ t: s.t, title: "let go flat over the lid" })),
        cause: syrSpans.map((c, i) => ({ t0: c.t0, t1: c.t1, title: `grasp_sg.close → transport_sg.transport_move, syringe ${i + 1}` })),
      },
      arc: { style: PS.arc, label: "decided at the grasp: it is carried flat" },
    },
    after(ribbon) {
      tape = Base.tape($("#problem-syr-tape"), {
        x: ribbon, yDomain: [0, 90], series: tapeSeries(), endLabel: "flat the whole carry",
        yLabels: [{ v: 90, text: "tilt · 90° flat" }, { v: 0, text: "0° upright" }],
      });
      onLayout(ribbon, graspGlyphs);
    },
    draw(t) {
      const i = carried(t), s = bars0[i](t);
      if (i !== barsFor) setBars(i);
      key.set(t);
      for (const g of key.dims([opening].concat(lengthDim(s)))) if (g.dataset.key === "length") g.dataset.src = PS.paper.src;
      const span = syrSpans[i];
      onion.set(t >= span.t0 ? bars0[i] : null, span.t0, Math.min(t, span.t1));
      tape.setTime(t);
      gauge.set(s.tilt);
      gauge.ghost(syrGhost ? ghostAt(t).tilt : null);
      tiltLabel.textContent = `tilt of syringe ${i + 1}`;
    },
    at: (t) => (within(t, syrSeen) ? "seen" : within(t, syrSpans) ? "cause" : ""),
    describe(t) {
      const i = carried(t), p = pass(t), s = bars0[i](t);
      const state = `${Math.round(s.tilt)}° from vertical, ${syrWhere(s)}`;
      const subject = i === p ? state : `syringe ${i + 1} lies where it was let go: ${state}`;
      let note = within(t, syrSeen) ? " · ✕ let go flat over the lid" : within(t, syrSpans) ? " · ◆ held flat since the grasp" : "";
      if (syrGhost) note += ` · round 2 at this step: ${Math.round(ghostAt(t).tilt)}°`;
      return `${t.toFixed(1)} s · syringe ${p + 1} · ${phase(sy, t)} · ${subject}${note}`;
    },
    ghost(on) {
      syrGhost = on;
      setBars(barsFor);
      tape.update({ series: tapeSeries() });
    },
  });
  caption("syr", sy);
  const s0 = bars0[carried(PS.start)](PS.start);
  fill($("#problem-syr-data"), [["time, s", PS.start.toFixed(2)], ["syringe", String(carried(PS.start) + 1)],
    ["tilt from vertical, °", s0.tilt.toFixed(1)], ["height above the lid, mm", (s0.z_mm - lid).toFixed(1)],
    ["offset from the opening's centre, mm", s0.r_mm.toFixed(1)], ["opening, mm", String(TS.opening_mm)],
    ["syringe length, mm", String(PS.paper.len_mm)]]);

  /* ---------------------------------------------------------------- 3 · Cable Routing */
  const cb = clipInfo("cable_k0"), TC = d.tapes_cable, PC = P.cable;
  const shapeAt = Base.sampler({ t: TC.t, pts: TC.pts });
  const pairsOf = (flat) => Array.from({ length: flat.length / 2 }, (_, i) => [flat[2 * i], flat[2 * i + 1]]);
  const shape = (t) => pairsOf(shapeAt(Math.min(t, TC.t[TC.t.length - 1])).pts);
  const seat0 = TC.static.regions.find((r) => r.id === "seat0");
  const thenT = PC.seen.t;
  // the piece of cable the arrow follows: of those in seat0's corridor when the let-go began, the one that ends
  // farthest from where it was then
  const thenShape = shape(thenT), restShape = shape(TC.t[TC.t.length - 1]);
  const sprung = thenShape.map((p, i) => [i, Math.hypot(restShape[i][0] - p[0], restShape[i][1] - p[1])])
    .filter(([i]) => inside(thenShape[i], seat0.corners)).sort((a, b) => b[1] - a[1])[0];
  const map = cableMap($("#problem-cable-map"), TC.static, TC.pts, sprung ? sprung[0] : null);
  const washSpan = [{ t0: PC.wash[0], t1: PC.wash[1] }];
  // the cable springs back while the gripper opens, in the let-go's first fraction of a second; the ✕ text stays lit a
  // little longer so a scrub can land on it
  const seenSpan = [{ t0: PC.seen.t, t1: PC.seen.t + 0.6 }];
  // the run's verdict holds only once its recording has ended; before that the readout names the time and the step
  const endT = TC.t[TC.t.length - 1];
  const WASH_LABEL = "decided everywhere: every contact changes the cable's shape";
  await card("cable", {
    start: PC.start,
    traceT: PC.wash[0],
    ribbon: {
      mode: "timed", duration: cb.duration_s, still: cb.still, ticks: false,
      stages: cb.stages.map((s) => (s.node === "support_sg.take" ? { ...s, dot: true, title: TC.held_detail } : s)),
      end: { kind: "fail", text: TC.goal_row },
      marks: {
        seen: { t: PC.seen.t, title: "let go: the cable springs back off the peg" },
        wash: { t0: PC.wash[0], t1: PC.wash[1], label: WASH_LABEL },
      },
    },
    after(ribbon) { onLayout(ribbon, washDiamond); },
    draw(t) { map.set(shape(t), t > thenT + 0.25 ? shape(thenT) : null); },
    at: (t) => (within(t, seenSpan) ? "seen" : within(t, washSpan) ? "cause" : ""),
    describe(t) {
      const note = within(t, seenSpan) ? " · ✕ the let-go begins" : t >= endT ? ` · the report's goal row: ${TC.goal_row}` : "";
      return `${t.toFixed(1)} s · ${phase(cb, t)}${note}`;
    },
    onTrace() {
      // no single step to point at: the wash itself is the answer, so it is the thing that flashes
      const wash = $("#problem-cable-ribbon .cause-wash");
      if (!wash || Base.reduced) return;
      wash.classList.remove("flash");
      wash.getBoundingClientRect();
      wash.classList.add("flash");
    },
  });
  caption("cable", cb);
  fill($("#problem-cable-data"), [["time, s", PC.start.toFixed(2)], ["step", phase(cb, PC.start)], ["goal row", TC.goal_row]]);

  /* ---------------------------------------------------------------- the summary: three ✕ / ◆ patterns */
  mini($("#problem-mini-th"), { clip: th, seen: [PT.seen.t], cause: thSpans });
  mini($("#problem-mini-syr"), { clip: sy, seen: PS.seen.map((s) => s.t), cause: syrSpans });
  mini($("#problem-mini-cable"), { clip: cb, seen: [PC.seen.t], wash: washSpan[0] });

  /* ================================================================ helpers scoped to this section */

  // round 0 → round 2 times, step by step: open, reach and close match by name; round 0's carry and release
  // together match round 2's insert
  function syncPairs(a, b) {
    const pairs = [[0, 0]];
    for (let p = 0; p < 2; p++) {
      const A = (n) => nodes(a, n)[p], B = (n) => nodes(b, n)[p];
      for (const n of ["grasp_sg.open", "grasp_sg.goto_grasp"]) pairs.push([A(n).t0, B(n).t0]);
      pairs.push([A("grasp_sg.close").t0, B("grasp_sg.close").t0], [A("grasp_sg.close").t1, B("grasp_sg.close").t1]);
      pairs.push([A("transport_sg.transport_move").t0, B("transport_sg.insert").t0]);
      pairs.push([A("transport_sg.release").t1, B("transport_sg.insert").t1]);
    }
    pairs.push([a.duration_s, b.duration_s]);
    return pairs.filter((q, i) => i === 0 || (q[0] > pairs[i - 1][0] && q[1] > pairs[i - 1][1]));
  }

  /* "Decided at the grasp" has to point at a step the reader can name: each grasp_sg.close chip shows the grasp
     glyph, also where the chip is too narrow for Base.ribbon to give it one (a phone's width). */
  function graspGlyphs(lay) {
    for (const c of lay.chips) {
      if (c.s.node !== "grasp_sg.close" || c.g.querySelector(".chip-kind")) continue;
      const gs = Math.max(7, Math.min(10, c.w - 2));
      Base.svg("use", { class: "chip-kind", href: "#k-grasp", x: c.x + c.w / 2 - gs / 2, y: c.y + lay.chipH / 2 - gs / 2, width: gs, height: gs }, c.g);
    }
  }

  /* The cable's wash says where it was decided, so its words open with the ◆ they stand for. */
  function washDiamond(lay) {
    const first = [...lay.marksG.querySelectorAll("text.wash-label")][0];
    if (!first) return;
    const tw = Base.textWidth(first.textContent, "600 12px Manrope"), x = +first.getAttribute("x") + 8;
    first.setAttribute("x", x);
    Base.mark(lay.marksG, "m-cause", x - tw / 2 - 9, +first.getAttribute("y") - 4, { size: 11, cls: "mark-cause" });
  }

  /* Where the syringe was over its carry, as faded outlines every 0.3 s, laid over the lid section: carried flat, all
     the way down. An outline that would leave the section is skipped rather than cut, so none reads as a broken
     stroke. Base.keyhole's layout (centred, mm to scale) is mirrored here. */
  function carryTrace(box, o) {
    const over = Base.svg("svg", { class: "key-over", "aria-hidden": "true" }, box);
    let geo = null, state = null;
    const draw = (w) => {
      over.replaceChildren();
      const [x0, x1] = o.domain.x, [y0, y1] = o.domain.y;
      const k = Math.min(w / (x1 - x0), o.height / (y1 - y0));
      const ox = (w - (x1 - x0) * k) / 2, oy = (o.height - (y1 - y0) * k) / 2;
      over.setAttribute("viewBox", `0 0 ${w} ${o.height}`);
      over.style.height = o.height + "px";
      geo = { k, X: (x) => ox + (x - x0) * k, Y: (y) => oy + (y1 - y) * k, g: Base.svg("g", {}, over) };
      paint();
    };
    const paint = () => {
      if (!geo) return;
      geo.g.replaceChildren();
      if (!state) return;
      const { sample, t0, t1 } = state, { len_mm: len, dia_mm: dia } = o.syringe, k = geo.k;
      const [x0, x1] = o.domain.x, [y0, y1] = o.domain.y;
      for (let t = t0; t <= t1; t += 0.3) {
        const s = sample(t);
        const ts = (s.tilt_signed * Math.PI) / 180, phi = Math.atan2(Math.cos(ts), -Math.sin(ts));
        const cx = s.r_mm, cy = s.z_mm - o.lid;
        const hx = (Math.abs(Math.cos(phi)) * len + dia) / 2, hy = (Math.abs(Math.sin(phi)) * len + dia) / 2;
        if (cx - hx < x0 || cx + hx > x1 || cy - hy < y0 || cy + hy > y1) continue;
        const g = Base.svg("g", { transform: `translate(${geo.X(cx).toFixed(1)} ${geo.Y(cy).toFixed(1)}) rotate(${(-phi * 180 / Math.PI).toFixed(1)})` }, geo.g);
        Base.svg("rect", { class: "onion", x: (-len / 2) * k, y: (-dia / 2) * k, width: len * k, height: dia * k, rx: (dia / 2) * k }, g);
      }
    };
    Base.mount(box, draw);
    return { set(sample, t0, t1) { state = sample ? { sample, t0, t1 } : null; paint(); } };
  }

  function inside([x, y], poly) {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  }

  /* Over the rail, in its layout (10 px pad, mm to scale, mirrored here so the two line up): the shank's axis run out
     past the tip as a dashed guide, the ring's centre and how far it sits off that axis (the ring's hole has to be on
     the axis to go over the tip), the shank's name, and the "then falls" cue, which Base.rail cannot draw because it
     only marks a sample once it is out of view. */
  function railOverlay(box, dom, tapes, exit) {
    const over = Base.svg("svg", { class: "rail-over", "aria-hidden": "true" }, box);
    let geo = null, ring = null, fallFrom = null, avoid = [];
    const draw = (w) => {
      over.replaceChildren();
      const pad = 10, [a0, a1] = dom.along, [v0, v1] = dom.vert, k = (w - 2 * pad) / (a1 - a0);
      const h = Math.round((v1 - v0) * k + 2 * pad);
      const X = (a) => pad + (a1 - a) * k, Y = (v) => pad + (v1 - v) * k;
      over.setAttribute("viewBox", `0 0 ${w} ${h}`);
      over.style.height = h + "px";
      Base.svg("line", { class: "axis-guide", x1: X(0), x2: X(a1), y1: Y(0), y2: Y(0) }, over);
      Base.svg("text", { class: "geo-label", x: X(a1), y: Y(0) - 6, text: "the shank's axis" }, over);
      // the shank's name, over its middle, when it fits beside the rail's own "tip" label
      const name = Base.textWidth("hook shank", "500 11.5px Manrope") < tapes.shank.len_mm * k - 22 ? "hook shank" : "shank";
      Base.svg("text", { class: "geo-label", x: X(-tapes.shank.len_mm / 2), y: Y(tapes.shank.r_mm) - 7, "text-anchor": "middle", text: name }, over);
      const dim = Base.svg("g", { class: "geo-dim hot off-axis", style: "display:none" }, over);
      const dimLine = Base.svg("line", {}, dim), tick0 = Base.svg("line", {}, dim), tick1 = Base.svg("line", {}, dim);
      const ext = Base.svg("line", { class: "ext" }, dim), dimText = Base.svg("text", { "dominant-baseline": "central" }, dim);
      const dot = Base.svg("circle", { class: "ring-centre", r: 2.6, style: "display:none" }, over);
      const fall = Base.svg("g", { class: "fall", style: "display:none" }, over);
      const fallPath = Base.svg("path", { "marker-end": "url(#arrow-muted)" }, fall);
      const fallText = Base.svg("text", { class: "geo-label", text: "then falls" }, fall);
      geo = { X, Y, k, w, h, pad, dim, dimLine, tick0, tick1, ext, dimText, dot, fall, fallPath, fallText };
      paint();
    };
    // half the drawn ring's width on screen: Base.rail's ellipse (semi-axes r and r·|n_aside|, turned to the normal)
    const halfWidth = (n) => {
      const r = tapes.ring.inner_r_mm * geo.k, minor = Math.max(0.8, r * Math.abs(n[2]));
      const a = Math.hypot(n[0], n[1]) < 1e-3 ? 0 : Math.atan2(-n[1], -n[0]) + Math.PI / 2;
      return Math.hypot(r * Math.cos(a), minor * Math.sin(a));
    };
    // does the box [x0, y0, x1, y1] (px) touch any of the polylines (mm)? sampled every 2 px along each
    const touches = (b, polys) => polys.some((pts) => pts.some((p, i) => {
      if (!i) return false;
      const ax = geo.X(pts[i - 1][0]), ay = geo.Y(pts[i - 1][1]), bx = geo.X(p[0]), by = geo.Y(p[1]);
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 2));
      for (let j = 0; j <= n; j++) {
        const x = ax + ((bx - ax) * j) / n, y = ay + ((by - ay) * j) / n;
        if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]) return true;
      }
      return false;
    }));
    const paint = () => {
      if (!geo) return;
      const { X, Y } = geo;
      geo.dot.style.display = ring ? "" : "none";
      geo.dim.style.display = "none";
      if (ring) {
        const cx = X(ring.along), cy = Y(ring.vert), ay = Y(0);
        geo.dot.setAttribute("cx", cx);
        geo.dot.setAttribute("cy", cy);
        // the dimension stands clear of the ring, on whichever side has room for its label
        const gap = halfWidth(ring.n) + 10, label = `${Math.round(Math.abs(ring.vert))} mm`;
        const tw = Base.textWidth(label, "500 11px 'JetBrains Mono'"), th = 11;
        const left = cx - gap - tw - 8 >= geo.pad, sgn = left ? -1 : 1;
        const dx = cx + sgn * gap;
        if (Math.abs(cy - ay) >= 6) {
          geo.dim.style.display = "";
          const set = (n, a) => { for (const [k, v] of Object.entries(a)) n.setAttribute(k, v.toFixed ? v.toFixed(1) : v); };
          set(geo.dimLine, { x1: dx, x2: dx, y1: cy, y2: ay });
          set(geo.tick0, { x1: dx - 4, x2: dx + 4, y1: cy, y2: cy });
          set(geo.tick1, { x1: dx - 4, x2: dx + 4, y1: ay, y2: ay });
          set(geo.ext, { x1: cx + sgn * 4, x2: dx + sgn * 6, y1: cy, y2: cy });
          // beside the dimension's middle when that is clear of the trail, round 4's path and the axis; else beside
          // its far end, under it, or above the axis
          const lo = Math.max(cy, ay), hi = Math.min(cy, ay), side = dx + sgn * 7;
          const spots = [[side, (cy + ay) / 2], [side, lo + 2 + th / 2], [dx, lo + 6 + th / 2, "middle"], [side, hi - 4 - th / 2]];
          const boxOf = ([x, y, anchor]) => {
            const x0 = anchor === "middle" ? x - tw / 2 : left ? x - tw : x;
            return [x0 - 1, y - th / 2, x0 + tw + 1, y + th / 2];
          };
          const axis = [[0, 0], [dom.along[1], 0]];
          const at = spots.find((sp) => !touches(boxOf(sp), avoid.concat([axis]))) || spots[0];
          set(geo.dimText, { x: at[0], y: at[1], "text-anchor": at[2] || (left ? "end" : "start") });
          geo.dimText.textContent = label;
        }
      }
      geo.fall.style.display = fallFrom ? "" : "none";
      if (!fallFrom) return;
      // from the bottom of the ring along the recorded exit direction, to the view's lower edge
      const r = tapes.ring.inner_r_mm, sx = fallFrom.along, sy = fallFrom.vert - r;
      const f = (dom.vert[0] - sy) / (exit.vert - sy || -1);
      const ex = sx + (exit.along - sx) * Math.min(1, Math.max(0, f));
      const x1 = X(sx), y1 = Y(sy) + 4, x2 = X(ex), y2 = Y(dom.vert[0]) - 2;
      geo.fallPath.setAttribute("d", `M${x1.toFixed(1)},${y1.toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)}`);
      geo.fallText.setAttribute("x", (Math.max(x1, x2) + 8).toFixed(1));
      geo.fallText.setAttribute("y", ((y1 + y2) / 2 + 4).toFixed(1));
    };
    Base.mount(box, draw);
    return { set(s, from, lines) { ring = s; fallFrom = from; avoid = lines || []; paint(); } };
  }

  /* A thin circle round the hook in the clip, where the task's side camera sees the shank (problem.json projects its
     two ends into the frame); the camera never moves, so the callout holds for the whole clip. Wide enough to take in
     the ring where it stops at the tip. */
  function hookCallout(div, at) {
    const box = Base.el("div", { class: "hook-callout", "aria-hidden": "true" }, div);
    const ring = Base.el("span", { class: "ring" }, box);
    const label = Base.el("span", { class: "label", text: "hook" }, box);
    Base.mount(box, (w) => {
      const h = box.clientHeight;
      const [tx, ty, bx, by] = [at.tip[0] * w, at.tip[1] * h, at.base[0] * w, at.base[1] * h];
      const r = 1.25 * Math.hypot(tx - bx, ty - by), cx = (tx + bx) / 2, cy = (ty + by) / 2;
      Object.assign(ring.style, { left: `${cx - r}px`, top: `${cy - r}px`, width: `${2 * r}px`, height: `${2 * r}px` });
      Object.assign(label.style, { right: `${w - cx + r + 6}px`, top: `${cy}px` });
    });
  }

  /* Cable Routing, top-down as the clip's camera sees it: screen right is world +y, screen down is world +x, so the
     robots stand at the top. mm to scale; the pegs, the two end fittings and the three goal corridors come from the
     run's manifest. Once the let-go has begun, an arrow follows one piece of cable (index `piece` of the drawn
     points) from where it lay in seat0's corridor then to where it is now: how far it sprang back. */
  function cableMap(svg, st, allPts, piece) {
    const xs = [], ys = [];
    for (const f of allPts) for (let i = 0; i < f.length; i += 2) { xs.push(f[i]); ys.push(f[i + 1]); }
    for (const r of st.regions) for (const [x, y] of r.corners) { xs.push(x); ys.push(y); }
    for (const f of [st.port, st.anchor]) { xs.push(f.x - f.half, f.x + f.half); ys.push(f.y - f.half, f.y + f.half); }
    const pad = 14;   // mm around everything the run ever drew
    const dom = { x: [Math.min(...xs) - pad, Math.max(...xs) + pad], y: [Math.min(...ys) - pad, Math.max(...ys) + pad] };
    let L = null, now = null, then = null;
    const draw = (w) => {
      svg.replaceChildren();
      const k = w / (dom.y[1] - dom.y[0]);
      const h = Math.round((dom.x[1] - dom.x[0]) * k) + 22;
      const SX = (y) => (y - dom.y[0]) * k, SY = (x) => (x - dom.x[0]) * k;
      const P = ([x, y]) => [SX(y), SY(x)];
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      svg.style.height = h + "px";
      const parts = [], areas = [];
      const bbox = (pts) => [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])),
        Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
      for (const r of st.regions) {
        const pts = r.corners.map(P);
        Base.svg("polygon", { class: "cm-goal", points: pts.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ") }, svg);
        areas.push({ text: r.id, box: bbox(pts) });
      }
      for (const [name, f] of [["anchor", st.anchor], ["port", st.port]]) {
        const [cx, cy] = P([f.x, f.y]), s = f.half * k;
        Base.svg("rect", { class: "cm-fit", x: cx - s, y: cy - s, width: 2 * s, height: 2 * s, rx: 2,
          transform: `rotate(${(90 - f.yaw_deg).toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)})` }, svg);
        parts.push({ text: name, box: [cx - s, cy - s, cx + s, cy + s] });
      }
      // a peg at its shaft's size, but never under 5 px, with an outline ring so it reads at any width
      for (const p of st.pegs) {
        const [cx, cy] = P([p.x, p.y]), r = Math.max(5, p.r * k);
        Base.svg("circle", { class: "cm-peg-ring", cx, cy, r: r + 2.5 }, svg);
        Base.svg("circle", { class: "cm-peg", cx, cy, r }, svg);
        parts.push({ text: p.id, box: [cx - r - 3, cy - r - 3, cx + r + 3, cy + r + 3] });
      }
      const thenPath = Base.svg("path", { class: "cm-then" }, svg);
      const cable = Base.svg("path", { class: "cm-cable" }, svg);
      const spring = Base.svg("g", { class: "cm-spring", style: "display:none" }, svg);
      const springLine = Base.svg("path", {}, spring), springHead = Base.svg("path", { class: "head" }, spring);
      const springLead = Base.svg("path", { class: "lead" }, spring);
      const springText = Base.svg("text", { text: "sprang back" }, spring);
      const tip = Base.svg("circle", { class: "cm-end", r: 3.6 }, svg);
      const tipLabel = Base.svg("text", { class: "cm-label", text: "free end" }, svg);
      const sb = Base.svg("g", { class: "geo-scale" }, svg);
      const bar = 50 * k, sx = w - bar - 2, sy = h - 6;
      Base.svg("line", { x1: sx, x2: sx + bar, y1: sy, y2: sy }, sb);
      for (const x of [sx, sx + bar]) Base.svg("line", { x1: x, x2: x, y1: sy - 3, y2: sy + 3 }, sb);
      Base.svg("text", { x: sx - 5, y: sy + 3.5, "text-anchor": "end", text: "50 mm" }, sb);

      // each name goes to the first side of its shape that is clear of the parts, the names placed so far, the scale
      // bar and the cable where it comes to rest; parts first, so a name stays next to the small thing it names
      const font = "500 10.5px 'JetBrains Mono'", lh = 10;
      const names = parts.map((q) => q.box).concat([[sx - 44, sy - 8, w, h]]), taken = names.slice();
      const rest = allPts[allPts.length - 1];
      for (let i = 2; i < rest.length; i += 2) {
        const [ax, ay] = P([rest[i - 2], rest[i - 1]]), [bx, by] = P([rest[i], rest[i + 1]]);
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 5));
        for (let j = 0; j <= n; j++) {
          const x = ax + ((bx - ax) * j) / n, y = ay + ((by - ay) * j) / n;
          taken.push([x - 2, y - 2, x + 2, y + 2]);
        }
      }
      const clear = (b) => b[0] >= 0 && b[2] <= w && b[1] >= 0 && b[3] <= h
        && !taken.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
      for (const l of parts.concat(areas)) {
        const tw = Base.textWidth(l.text, font), [x0, y0, x1, y1] = l.box, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        const right = [x1 + 4, cy - lh / 2], left = [x0 - 4 - tw, cy - lh / 2];
        const below = [cx - tw / 2, y1 + 3], above = [cx - tw / 2, y0 - 3 - lh];
        const tries = l.text.startsWith("seat") || l.text === "portbox" ? [below, above, left, right] : [right, left, above, below];
        const box = ([x, y]) => [x, y, x + tw, y + lh];
        for (const c of tries) c[0] = Math.max(0, Math.min(w - tw, c[0]));   // slide along the edge, not off the map
        const at = tries.find((c) => clear(box(c))) || tries[0];
        taken.push(box(at));
        names.push(box(at));
        Base.svg("text", { class: "cm-label", x: at[0], y: at[1] + lh - 1.5, text: l.text }, svg);
      }
      L = { P, cable, thenPath, tip, tipLabel, w, h, spring, springLine, springHead, springLead, springText, names };
      paint();
    };
    const line = (pts) => pts.map((p, i) => (i ? "L" : "M") + L.P(p).map((v) => v.toFixed(1)).join(",")).join(" ");
    const paint = () => {
      if (!L || !now) return;
      L.cable.setAttribute("d", line(now));
      L.thenPath.setAttribute("d", then ? line(then) : "");
      const [ex, ey] = L.P(now[now.length - 1]);
      L.tip.setAttribute("cx", ex);
      L.tip.setAttribute("cy", ey);
      const tw = Base.textWidth("free end", "500 10.5px 'JetBrains Mono'");
      L.tipLabel.setAttribute("x", ex + 7 + tw > L.w ? ex - 7 - tw : ex + 7);
      L.tipLabel.setAttribute("y", ey - 6);
      paintSpring();
    };
    const paintSpring = () => {
      const on = then && piece != null;
      const [ax, ay] = on ? L.P(then[piece]) : [0, 0], [bx, by] = on ? L.P(now[piece]) : [0, 0];
      const len = Math.hypot(bx - ax, by - ay);
      L.spring.style.display = on && len >= 10 ? "" : "none";
      if (!on || len < 10) return;
      const ux = (bx - ax) / len, uy = (by - ay) / len, hx = bx - ux * 3, hy = by - uy * 3;
      L.springLine.setAttribute("d", `M${(ax + ux * 3).toFixed(1)},${(ay + uy * 3).toFixed(1)} L${(hx - ux * 6).toFixed(1)},${(hy - uy * 6).toFixed(1)}`);
      L.springHead.setAttribute("d", `M${hx.toFixed(1)},${hy.toFixed(1)} L${(hx - ux * 7 - uy * 3.5).toFixed(1)},${(hy - uy * 7 + ux * 3.5).toFixed(1)} L${(hx - ux * 7 + uy * 3.5).toFixed(1)},${(hy - uy * 7 - ux * 3.5).toFixed(1)} Z`);
      // the words go to the clear spot nearest the arrow's middle, with the map's names, both cable shapes and the
      // arrow itself in the way; a hairline leads back to the arrow when they cannot sit right beside it
      const tw = Base.textWidth("sprang back", "600 11.5px Manrope"), lh = 11, mx = (ax + bx) / 2, my = (ay + by) / 2;
      const sample = (pts) => pts.slice(1).flatMap((q, i) => {
        const [x0, y0] = pts[i], [x1, y1] = q, n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 3));
        return Array.from({ length: n + 1 }, (_, j) => [x0 + ((x1 - x0) * j) / n, y0 + ((y1 - y0) * j) / n]);
      });
      const marks = sample(now.map(L.P)).concat(sample(then.map(L.P)), sample([[ax, ay], [bx, by]]));
      const crossings = (b) => 100 * L.names.filter((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]).length
        + marks.filter(([px, py]) => px > b[0] - 2 && px < b[2] + 2 && py > b[1] - 2 && py < b[3] + 2).length;
      let best = null;
      for (let dy = -60; dy <= 60; dy += 4) {
        for (let dx = -tw - 70; dx <= 70; dx += 5) {
          const x = Math.max(0, Math.min(L.w - tw, mx + dx)), y = Math.max(lh + 2, Math.min(L.h - 4, my + dy));
          const b = [x, y - lh, x + tw, y + 3];
          const ex = Math.max(b[0], Math.min(mx, b[2])), ey = Math.max(b[1], Math.min(my, b[3]));
          const c = 12 * crossings(b) + Math.hypot(mx - ex, my - ey);
          if (!best || c < best.c) best = { c, x, y, ex, ey };
        }
      }
      L.springText.setAttribute("x", best.x.toFixed(1));
      L.springText.setAttribute("y", best.y.toFixed(1));
      const far = Math.hypot(mx - best.ex, my - best.ey) > 10;
      L.springLead.setAttribute("d", far ? `M${best.ex.toFixed(1)},${best.ey.toFixed(1)} L${mx.toFixed(1)},${my.toFixed(1)}` : "");
    };
    Base.mount(svg, draw);
    return { set(pts, before) { now = pts; then = before; paint(); } };
  }

  /* A card's ✕ / ◆ pattern alone: its steps on the episode's own time axis, without labels or glyphs. A wash has its
     ◆ under its middle: decided everywhere at once. */
  function mini(svg, o) {
    const c = o.clip;
    const draw = (w) => {
      svg.replaceChildren();
      const X = Base.timeScale(c.duration_s, 1, w - 1);
      const chipY = 4, chipH = 14, yb = chipY + chipH, markY = yb + 12, h = markY + 22;
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      svg.style.height = h + "px";
      if (o.wash) Base.svg("rect", { class: "cause-wash", x: X(o.wash.t0), y: chipY - 3, width: X(o.wash.t1) - X(o.wash.t0), height: chipH + 6, rx: 5 }, svg);
      for (const s of c.still) {
        const a = X(s.t0), b = Math.max(X(s.t1), a + 3);
        Base.svg("rect", { class: "mini-still", x: a, y: chipY, width: b - a, height: chipH, rx: 3 }, svg);
      }
      for (const s of c.stages) {
        const a = X(s.t0), b = Math.max(X(s.t1), a + 3);
        Base.svg("rect", { class: "mini-chip", x: a + 0.5, y: chipY, width: Math.max(2, b - a - 1), height: chipH, rx: 3 }, svg);
      }
      const causes = (o.cause || []).map((s) => {
        const a = X(s.t0), b = X(s.t1);
        Base.svg("path", { class: "cause-bracket", d: `M${a + 1},${yb + 2} V${yb + 5} H${b - 1} V${yb + 2}` }, svg);
        return (a + b) / 2;
      });
      for (const t of o.seen) {
        const sx = X(t);
        // each ✕ traces back to the nearest ◆ before it
        const back = causes.filter((cx) => cx <= sx);
        if (back.length) {
          for (const cx of o.seen.length > 1 ? [back[back.length - 1]] : back) {
            const depth = Math.min(10, Math.max(4, (sx - cx) * 0.08));
            Base.svg("path", { class: "blame-arc drawn", d: `M${sx},${markY + 6} Q${(sx + cx) / 2},${markY + 6 + depth * 2} ${cx},${markY + 6}`, "marker-end": "url(#arc-head)" }, svg);
          }
        }
        Base.mark(svg, "m-seen", sx, markY, { size: 11, cls: "mark-seen" });
      }
      for (const cx of causes) Base.mark(svg, "m-cause", cx, markY, { size: 11, cls: "mark-cause" });
      if (o.wash) Base.mark(svg, "m-cause", (X(o.wash.t0) + X(o.wash.t1)) / 2, markY, { size: 11, cls: "mark-cause" });
    };
    Base.mount(svg, draw);
  }
});
