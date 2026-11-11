/* Finding 5 (Physical reasoning): the first program and the program after two rounds on one clock, each with its
   clip, ribbon, lid section and tilt gauge, and an outline of one moment of its carry; the constants of the fix drawn
   on that outline once the second program's insert step starts; the paper's 17 of 19; and the paper's Figure 8 rows
   for Syringe Packing. */
Base.section("f5", async (root, d) => {
  const $ = (sel) => root.querySelector(sel);
  const T = d.tapes_syr, C = d.f5_case, S = d.structure;
  const clipInfo = (id) => d.clips.clips.find((c) => c.id === id);
  const MONO = (px) => `500 ${px}px "JetBrains Mono", ui-monospace, monospace`;
  const SANS = `500 11.5px Manrope, "Helvetica Neue", Arial, sans-serif`;
  const half = T.opening_mm / 2, HALF = T.syringe.len_mm / 2, halfW = T.syringe.dia_mm / 2, LID_MM = 6;
  Base.loopGlyph($(".fhead .loopglyph"), "physical");

  /* ---------------------------------------------------------------- two lanes, one clock */
  // each lane keeps one moment of syringe 1's carry as a faint outline, read off its tape: the first program holds it
  // flat over the opening (4.73–4.83 s); the second holds it upright with its low tip 60 mm over the lid (5.13–5.23 s),
  // which is where the fix's constants put it
  const lanes = [
    { id: "k0", info: clipInfo("syr_k0"), tape: T.clips.syr_k0, cls: "flat", name: "first program",
      ghost: { t: 4.8, cls: "ghost flat", note: "carried flat over the opening" } },
    { id: "k2", info: clipInfo("syr_k2"), tape: T.clips.syr_k2, cls: "ok", name: "after 2 rounds",
      ghost: { t: 5.17, cls: "ghost", note: "carried upright" } },
  ];
  const D = Math.max(...lanes.map((L) => L.info.duration_s));
  const fixLane = lanes[1];
  const fixT0 = fixLane.info.stages.find((s) => s.node === "transport_sg.insert").t0;
  // syringe 1's last recorded pose before the second program's hand lets go (the next sample is 96 mm lower)
  const RELEASE_T = 5.53;
  // tall enough for the second program's carry (syringe 1's upper end 210 mm over the lid) and for where that syringe
  // comes to rest in the box (its low end 180 mm under); wide enough on the left for the callout labels, which a
  // phone numbers and keys below instead
  const domain = () => (Base.isPhone() ? { x: [-150, 185], y: [-200, 218] } : { x: [-300, 185], y: [-200, 218] });
  const keyH = () => (Base.isPhone() ? 320 : 350);

  // Base.keyhole's own mapping (to scale, centred in its box), for what f5 draws over and beside its section;
  // under is the lid's underside, which the keyhole draws no thinner than 5 px
  function frame(w) {
    const { x: [x0, x1], y: [y0, y1] } = domain(), h = keyH();
    const k = Math.min(w / (x1 - x0), h / (y1 - y0));
    const ox = (w - (x1 - x0) * k) / 2, oy = (h - (y1 - y0) * k) / 2;
    return { w, h, k, X: (x) => ox + (x - x0) * k, Y: (y) => oy + (y1 - y) * k, under: -Math.max(LID_MM, 5 / k) };
  }
  // a syringe in the section: its centre (mm from the opening's centre, mm above the lid) and the unit vector toward
  // its upper end, as Base.keyhole draws it
  function pose(s) {
    const a = (s.tilt_signed * Math.PI) / 180;
    return { x: s.r_mm, y: s.z_mm - T.lid_z_mm, u: [-Math.sin(a), Math.cos(a)] };
  }
  const endOf = (p, sgn) => [p.x + sgn * HALF * p.u[0], p.y + sgn * HALF * p.u[1]];   // +1 the upper end, −1 the low
  // a dims() note centred on y and anchored at x like text-anchor (the keyhole sets a note from its start), in mm
  function note(fr, key, text, font, x, y, anchor, title) {
    const tw = Base.textWidth(text, font) / fr.k;
    return { kind: "note", key, label: text, title, at: [anchor === "end" ? x - tw : anchor === "middle" ? x - tw / 2 : x, y - 4 / fr.k] };
  }

  for (const L of lanes) {
    const tp = L.tape;
    // each syringe in the order it is carried: syringe 1 is solid, syringe 2 dashed, in the section and on the gauge
    L.tracks = tp.order.map((name) => Base.sampler({ t: tp.t, ...tp.syringes[name] }));
    L.pass2 = L.info.stages.filter((s) => s.node === "grasp_sg.open")[1].t0;
    L.inBox = tp.order.filter((name) => tp.end[name].in_box).length;
    const fix = (s) => s.node === "transport_sg.insert" && L === fixLane;
    L.ribbon = Base.ribbon($(`#f5-rib-${L.id}`), {
      mode: "timed", duration: D, still: L.info.still, groups: "always",
      stages: L.info.stages.map((s) => ({ ...s, group: s.t0 < L.pass2 ? "syringe 1" : "syringe 2",
        edited: fix(s) || null, title: fix(s) ? `runs ${C.diff_file}, the edit made after round ${C.iteration}` : null })),
      end: { kind: L.inBox === tp.order.length ? "ok" : "fail", text: `${L.inBox} of ${tp.order.length} in the box` },
      marks: L === fixLane ? {} : {
        seen: L.info.stages.filter((s) => s.node === "transport_sg.release").map((s) => ({ t: s.t0, title: "let go flat, over the lid" })),
      },
    });
    const ghost = L.tracks[0](L.ghost.t);
    L.keyhole = Base.keyhole($(`#f5-key-${L.id}`), {
      opening_mm: T.opening_mm, syringe: T.syringe, lid_z_mm: T.lid_z_mm, lid_mm: LID_MM, domain: domain(), height: keyH(),
      bars: [{ sample: () => ghost, cls: L.ghost.cls }, ...L.tracks.map((sample, i) => ({ sample, cls: L.cls + (i ? " second" : "") }))],
    });
    // drawn over the section: the opening, tinted so it shows through a syringe lying across it, and, on the first
    // section, where the two flat syringes nearly coincide, "1" and "2" at their ends
    L.over = Base.svg("svg", { class: "f5-over", "aria-hidden": "true" }, $(`#f5-key-${L.id}`).parentElement);
    L.gauge = Base.gauge($(`#f5-g-${L.id}`), { min: 0, max: 90, labels: ["upright", "flat"], size: 150, r: 34 });
    $(`#f5-note-${L.id}`).textContent = L.info.note;
  }

  /* ---------------------------------------------------------------- the fix, drawn where it acts */
  const K = Object.fromEntries(C.constants.map((c) => [c.name, c]));
  const CALLOUTS = [
    { key: "carry", names: ["carry_clearance_m"], gloss: "from the lid to the syringe's low tip while it is carried" },
    { key: "hang", names: ["min_hang_m", "max_hang_m"], gloss: "from the hand to the low tip: the syringe's half-length, clamped to this range (dotted)" },
    { key: "rim", names: ["tip_below_rim_m"], gloss: "how far below the rim the low tip goes before the hand lets go" },
    { key: "upright", names: ["upright_cos"], gloss: "how close to vertical the syringe must stand before it is lowered" },
  ];
  const keyList = $("#f5-key-list");
  CALLOUTS.forEach((c, i) => {
    const li = Base.el("li", { "data-key": c.key }, keyList);
    Base.el("span", { class: "n", text: String(i + 1), "aria-hidden": "true" }, li);
    const body = Base.el("span", {}, li);
    c.names.forEach((n) => Base.el("code", { text: K[n].token }, body));
    Base.el("span", { class: "gloss", text: c.gloss }, body);
  });

  // the opening, named and measured in both sections; each lane's carry outline, with its time; on the first section,
  // the syringe's length measured on that outline
  function statics(L, fr) {
    const px = (n) => n / fr.k, g = pose(L.tracks[0](L.ghost.t));
    const yo = fr.under - px(9);
    const out = [
      { kind: "dim", key: "opening", from: [-half, yo], to: [half, yo], label: "" },
      note(fr, "opening", "opening", SANS, -half - px(8), yo, "end"),
    ];
    const when = `${L.ghost.t.toFixed(1)} s · ${L.ghost.note}`;
    if (L === fixLane) {
      out.push(note(fr, "ghost", when, SANS, g.x + halfW + px(10), g.y - 20, "start"));
      return out;
    }
    const low = Math.min(endOf(g, 1)[1], endOf(g, -1)[1]) - halfW;
    out.push(note(fr, "ghost", when, SANS, g.x, low - px(12), "middle"));
    let [nx, ny] = [-g.u[1], g.u[0]];
    if (ny < 0) [nx, ny] = [-nx, -ny];
    const d = halfW + px(7), [ax, ay] = endOf(g, -1), [bx, by] = endOf(g, 1);
    out.push({ kind: "dim", key: "length", from: [ax + nx * d, ay + ny * d], to: [bx + nx * d, by + ny * d], label: "syringe", off: 3 });
    return out;
  }

  // the fix's constants, drawn from the lid up on the axis of the second program's recorded carry, where they land on
  // the outline: x from the opening's centre, y above the lid, in mm
  function callouts(fr) {
    const mm = (n) => K[n].value * 1000, px = (n) => n / fr.k;
    const clear = mm("carry_clearance_m"), rim = mm("tip_below_rim_m");
    const hang = Math.min(Math.max(HALF, mm("min_hang_m")), mm("max_hang_m")), hand = clear + hang;
    const a = Math.acos(K.upright_cos.value), deg = (a * 180) / Math.PI;
    const x = pose(fixLane.tracks[0](fixLane.ghost.t)).x;
    const [tx] = endOf(pose(fixLane.tracks[0](RELEASE_T)), -1);   // the low tip as the hand let go
    const font = MONO(11.5), w = (n) => Base.textWidth(K[n].token, font);   // f5.css sets the callouts at 11.5 px
    const rimAt = [-half - px(12), px(12)];   // where the rim's leader starts: above the lid, left of the opening
    const cone = [x - hang * Math.sin(a), hand + hang * Math.cos(a)];   // the cone's upper left corner
    // the labels go on the drawing when they fit left of it, else the callouts are numbered and keyed below
    const lefts = [
      fr.X(x) - 12 - w("carry_clearance_m"),
      fr.X(x) - halfW * fr.k - 12 - Math.max(w("min_hang_m"), w("max_hang_m")),
      fr.X(rimAt[0]) - 4 - w("tip_below_rim_m"),
      fr.X(cone[0]) - 6 - w("upright_cos"),
    ];
    const numbered = Base.isPhone() || Math.min(...lefts) < 2;
    const lab = (i, n) => (numbered ? String(i) : K[n].token);
    const title = (c) => `${c.names.map((n) => K[n].token).join(" · ")}: ${c.gloss}`;
    const [carry, hangC, rimC, up] = CALLOUTS.map(title);
    // the carry label sits near the top of its dimension, clear of the second syringe's last pose in the opening
    const carryY = clear - px(10);
    return { numbered, list: [
      { kind: "dim", key: "carry", from: [x, 0], to: [x, clear], label: "", title: carry },
      note(fr, "carry", lab(1, "carry_clearance_m"), font, x - px(12), carryY, "end", carry),
      { kind: "dim", key: "hang", from: [x, clear], to: [x, hand], off: -(halfW * fr.k + 8), label: lab(2, "min_hang_m"), title: hangC },
      numbered ? null : note(fr, "hang", K.max_hang_m.token, font, x - halfW - px(12), clear + hang / 2 - px(15), "end", hangC),
      // the clamp's range, measured from the hand: the low tip may sit anywhere between these two ticks
      { kind: "dim", key: "hang", cls: "range", from: [x + halfW + px(5), hand - mm("min_hang_m")], to: [x + halfW + px(5), hand - mm("max_hang_m")], label: "", title: hangC },
      { kind: "dim", key: "rim", from: [tx, 0], to: [tx, -rim], label: "", title: rimC },
      { kind: "dim", key: "rim", cls: "leader", from: rimAt, to: [tx, -rim], label: "", title: rimC },
      note(fr, "rim", lab(3, "tip_below_rim_m"), font, rimAt[0] - px(4), rimAt[1], "end", rimC),
      { kind: "cone", key: "upright", at: [x, hand], deg, len: hang, label: numbered ? "4" : "", title: up },
      numbered ? null : note(fr, "upright", K.upright_cos.token, font, cone[0] - px(6), cone[1], "end", up),
    ].filter(Boolean) };
  }
  // dims() draws what Base.keyhole knows; a range or a leader is a dimension with its look set here
  function drawDims(L, list) {
    const gs = L.keyhole.dims(list);
    gs.forEach((g, i) => { if (list[i].cls) g.classList.add(list[i].cls); });
    return gs;
  }

  const keySvg = $("#f5-key-k2");
  let drawn = null, numbered = false;
  function setCallouts(on, animate) {
    const want = on ? "on" : "off";
    if (drawn === want) return;
    drawn = want;
    const fr = frame(keySvg.clientWidth || keySvg.getBoundingClientRect().width), plan = callouts(fr);
    numbered = plan.numbered;
    // numbered callouts are keyed right under their section; labelled ones name their constant on the drawing, and the
    // diff below shows its line, so they need no key
    keyList.classList.toggle("numbered", numbered);
    keyList.hidden = !numbered;
    const gs = drawDims(fixLane, [...statics(fixLane, fr), ...(on ? plan.list : [])]);
    if (!on || !animate || Base.reduced) return;
    // one callout after another, 300 ms each; the opening and the outline stay
    const order = CALLOUTS.map((c) => c.key);
    const drawnIn = gs.filter((g) => order.includes(g.dataset.key));
    drawnIn.forEach((g) => { g.style.transition = "none"; g.style.opacity = "0"; });
    keySvg.getBoundingClientRect();
    drawnIn.forEach((g) => {
      g.style.transition = `opacity 300ms var(--ease) ${order.indexOf(g.dataset.key) * 300}ms`;
      g.style.opacity = "1";
    });
  }

  /* ---------------------------------------------------------------- what the agent said, and wrote */
  const said = $("#f5-said");
  $("#f5-diff-file").textContent = C.diff_file;
  const keyOfLine = (line) => (CALLOUTS.find((c) => c.names.some((n) => line.includes(n))) || {}).key;
  const lines = Base.diff($("#f5-diff"), C.diff, () => false);
  lines.forEach((ln) => {
    // a phone wraps long lines; a wrapped line continues 2 characters deeper than its own code starts
    ln.style.setProperty("--hang", `${/^[+-]?\s*/.exec(ln.textContent)[0].length + 2}ch`);
    const key = keyOfLine(ln.textContent);
    if (!key) return;
    ln.dataset.key = key;
    ln.tabIndex = 0;
    ln.addEventListener("pointerenter", () => hot(key));
    ln.addEventListener("pointerleave", () => hot(null));
    ln.addEventListener("focus", () => hot(key));
    ln.addEventListener("blur", () => hot(null));
  });
  function hot(key) {
    for (const g of keySvg.querySelectorAll(".geo-dim[data-key]")) g.classList.toggle("hot", g.dataset.key === key);
    for (const ln of lines) ln.classList.toggle("hl", !!key && ln.dataset.key === key);
    for (const li of keyList.children) li.classList.toggle("on", li.dataset.key === key);
  }
  const calloutKeys = CALLOUTS.map((c) => c.key);
  keySvg.addEventListener("pointerover", (e) => {
    const g = e.target.closest(".geo-dim[data-key]");
    hot(g && calloutKeys.includes(g.dataset.key) ? g.dataset.key : null);
  });
  keySvg.addEventListener("pointerleave", () => hot(null));
  for (const li of keyList.children) {
    li.tabIndex = 0;
    li.addEventListener("pointerenter", () => hot(li.dataset.key));
    li.addEventListener("pointerleave", () => hot(null));
    li.addEventListener("focus", () => hot(li.dataset.key));
    li.addEventListener("blur", () => hot(null));
  }

  /* ---------------------------------------------------------------- clips and the clock */
  const ctrls = await Promise.all(lanes.map((L) => Base.clip(root.querySelector(`.lane[data-lane="${L.id}"] .clip`))));
  lanes.forEach((L, i) => {
    L.ctrl = ctrls[i];
    L.ctrl.video.controls = false;   // one clock drives both clips: the Play button and the scrubber
  });
  const master = lanes.reduce((a, b) => (b.info.duration_s > a.info.duration_s ? b : a));
  const scrub = $("#f5-scrub"), playBtn = $("#f5-play"), clock = $("#f5-t"), readout = $("#f5-readout");
  scrub.max = D;
  let t = D, playing = false;
  for (const L of lanes) L.ribbon.on("chip", (s) => { stop(); seekAll(s.t0); });

  const stageAt = (L, tl) => L.info.stages.find((s) => tl >= s.t0 && tl < s.t1) || L.info.still.find((s) => tl >= s.t0 && tl < s.t1);
  function describe(L, tl, tilt) {
    const st = stageAt(L, tl), i = tl < L.pass2 ? 0 : 1;
    const parts = [];
    if (st && st.node) parts.push(Base.el("code", { text: st.node }));
    else if (st) parts.push(st.label.replace(/ \(robot still\)$/, ""));
    else parts.push(tl < L.info.stages[0].t0 ? "before the first step" : "after the last step");
    parts.push(tilt ? `, syringe ${i + 1} at ${Math.round(L.tracks[i](tl).tilt)}° from vertical` : `, syringe ${i + 1}`);
    return parts;
  }
  // while the clips play, the readout changes only when a step does (no running time or tilt for screen readers)
  function writeReadout() {
    const out = [];
    if (t >= D - 0.02) {
      out.push(`End · ${lanes[0].name}: ${lanes[0].inBox} of ${lanes[0].tape.order.length} syringes in the box · ${fixLane.name}: ${fixLane.inBox} of ${fixLane.tape.order.length}, through `,
        Base.el("code", { text: "transport_sg.insert" }), `, the step that runs the edit made after round ${C.iteration}.`);
    } else {
      if (!playing) out.push(`${t.toFixed(1)} s · `);
      lanes.forEach((L, i) => out.push(`${i ? " · " : ""}${L.name}: `, ...describe(L, Math.min(t, L.info.duration_s), !playing)));
    }
    const text = out.map((p) => (typeof p === "string" ? p : p.textContent)).join("");
    if (text === readout.textContent) return;
    readout.replaceChildren(...out.map((p) => (typeof p === "string" ? document.createTextNode(p) : p)));
  }

  function show(tt, animate) {
    t = Math.max(0, Math.min(D, tt));
    for (const L of lanes) {
      const tl = Math.min(t, L.info.duration_s);
      L.ribbon.setTime(tl);
      L.keyhole.set(tl);
      paintEnds(L, tl);
      L.gauge.set(L.tracks[0](tl).tilt).ghost(L.tracks[1](tl).tilt);
    }
    setCallouts(Math.min(t, fixLane.info.duration_s) >= fixT0, animate);
    if (document.activeElement !== scrub) scrub.value = t;
    clock.textContent = `${t.toFixed(1)} s`;
    writeReadout();
  }
  function seekAll(tt) {
    show(tt, true);
    for (const L of lanes) L.ctrl.seek(Math.min(t, L.info.duration_s - 0.05));
  }
  function paintButton() {
    playBtn.querySelector("use").setAttribute("href", playing ? "#i-pause" : "#i-play");
    playBtn.querySelector("span").textContent = playing ? "Pause" : "Play";
    playBtn.setAttribute("aria-label", playing ? "Pause both programs" : "Play both programs");
  }
  function stop() {
    if (!playing) return;
    playing = false;
    for (const L of lanes) L.ctrl.pause();
    paintButton();
    writeReadout();
  }
  function start() {
    const from = t >= D - 0.05 ? 0 : t;
    playing = true;
    paintButton();
    show(from, true);
    for (const L of lanes) if (from < L.info.duration_s - 0.05) L.ctrl.play(from);
  }
  playBtn.addEventListener("click", () => (playing ? stop() : start()));

  // the longest clip is the clock; the other follows it and stops at its own end
  Base.follow(master.ctrl.video, (vt) => {
    if (!playing) return;
    show(vt, true);
    for (const L of lanes) {
      if (L === master) continue;
      const v = L.ctrl.video, end = L.info.duration_s - 0.05;
      if (t >= end) { if (!v.paused) v.pause(); continue; }
      if (v.paused) L.ctrl.play();
      if (Math.abs(v.currentTime - t) > 0.15) v.currentTime = t;
    }
  });
  master.ctrl.video.addEventListener("pause", stop);
  master.ctrl.video.addEventListener("ended", () => show(D));

  scrub.addEventListener("input", () => { stop(); seekAll(+scrub.value); });
  scrub.addEventListener("keydown", (e) => {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    stop();
    seekAll(t + step * (e.shiftKey ? 1 : 0.1));
    scrub.value = t;
  });

  /* ---------------------------------------------------------------- layout that depends on the width */
  const wide = window.matchMedia("(min-width: 861px)");
  // the overlay on each section: the opening's tint, and on the first section the two syringes' numbers
  function drawOver(L) {
    const fr = (L.fr = frame($(`#f5-key-${L.id}`).getBoundingClientRect().width));
    L.over.replaceChildren();
    L.over.setAttribute("viewBox", `0 0 ${fr.w} ${fr.h}`);
    const top = fr.Y(T.syringe.dia_mm + 2);
    Base.svg("rect", { class: "geo-goal", x: fr.X(-half), y: top, width: fr.X(half) - fr.X(-half), height: fr.Y(fr.under) - top }, L.over);
    L.ends = L === fixLane ? [] : L.tracks.map((_, i) => Base.svg("text", { class: "f5-end", "text-anchor": "middle", "dominant-baseline": "central", text: String(i + 1) }, L.over));
  }
  // each number sits just past the end of its syringe that is farther from the other one, so the two never meet
  function paintEnds(L, tl) {
    if (!L.ends || !L.ends.length) return;
    const fr = L.fr, { x: [x0, x1], y: [y0, y1] } = domain(), reach = HALF + 9 / fr.k;
    const ps = L.tracks.map((s) => pose(s(tl)));
    const inside = ([x, y]) => x > x0 && x < x1 && y > y0 && y < y1;
    ps.forEach((p, i) => {
      const other = ps[1 - i], dist = ([x, y]) => Math.hypot(x - other.x, y - other.y);
      const spots = [1, -1].map((sg) => [p.x + sg * reach * p.u[0], p.y + sg * reach * p.u[1]]).filter(inside);
      if (inside([other.x, other.y])) spots.sort((a, b) => dist(b) - dist(a));
      const at = spots[0], label = L.ends[i];
      label.style.display = at ? "" : "none";
      if (at) { label.setAttribute("x", fr.X(at[0]).toFixed(1)); label.setAttribute("y", fr.Y(at[1]).toFixed(1)); }
    });
  }
  Base.mount($(".lanes"), () => {
    for (const L of lanes) {
      L.keyhole.update({ domain: domain(), height: keyH() });
      drawOver(L);
      paintEnds(L, Math.min(t, L.info.duration_s));
    }
    drawDims(lanes[0], statics(lanes[0], lanes[0].fr));
    // the lanes stack under 860 px, so "on the right" becomes the second lane
    Base.said(said, C.quote, `Opus 5, after its first fix was reverted (round ${C.iteration}). The program it wrote here is the one ${wide.matches ? "on the right" : "tagged “after 2 rounds” above"}.`);
    const on = drawn === "on";
    drawn = null;
    setCallouts(on, false);
  });

  show(D);
  // the drawn end state, as a table
  const endTable = $("#f5-end-table");
  const endHead = Base.el("tr", {}, Base.el("thead", {}, endTable));
  for (const h of ["Program", "Syringe", "Moment", "Tilt, degrees from vertical", "Centre above the lid, mm", "In the box"]) Base.el("th", { text: h }, endHead);
  const endBody = Base.el("tbody", {}, endTable);
  const row = (cells) => { const tr = Base.el("tr", {}, endBody); for (const v of cells) Base.el("td", { text: v }, tr); };
  const nums = (s) => [String(Math.round(s.tilt)), String(Math.round(s.z_mm - T.lid_z_mm))];
  for (const L of lanes) {
    row([L.name, "syringe 1", `${L.ghost.t.toFixed(1)} s, ${L.ghost.note} (outline)`, ...nums(L.tracks[0](L.ghost.t)), ""]);
    L.tape.order.forEach((name, i) => row([L.name, `syringe ${i + 1}`, "end", ...nums(L.tracks[i](L.info.duration_s)), L.tape.end[name].in_box ? "yes" : "no"]));
  }
  const ep = (L) => `${L.info.split === "train" ? "training" : L.info.split} episode ${+L.info.episode.split("/").pop()}`;
  $("#f5-source").textContent = `${fixLane.info.task}, ${fixLane.info.model}, layout ${fixLane.info.layout}: round ${lanes[0].info.iteration} and round ${fixLane.info.iteration} of one run, ${ep(lanes[0])} each.`;

  /* ---------------------------------------------------------------- 17 of 19 */
  // each policy is a small box with an opening in its lid. The paper says only that 17 carried or released the syringe
  // flat over the opening: those lie across the lid; the rest get an empty slot, since how they held it is not reported
  const glyphSvg = $("#f5-19 svg");
  const [FLAT, ALL] = Base.$$("#f5-19 .bignum .num", root).map((n) => +n.textContent);   // the paper's, tagged there
  Base.mount($("#f5-19 .f5-19-art"), (w) => {
    glyphSvg.replaceChildren();
    const perRow = Math.ceil(ALL / 2), c = Math.min(44, Math.floor(w / perRow)), ch = Math.round(c * 1.1), rowGap = 10;
    const W = perRow * c, H = ch * 2 + rowGap;
    glyphSvg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    glyphSvg.setAttribute("width", W);
    glyphSvg.setAttribute("height", H);
    const len = c * 0.74, th = Math.max(5, c * 0.16), gap = c * 0.3, m = 4, ly = Math.round(ch * 0.42);
    for (let i = 0; i < ALL; i++) {
      const flat = i < FLAT, gx = (i % perRow) * c, gy = Math.floor(i / perRow) * (ch + rowGap);
      const g = Base.svg("g", { class: "syr " + (flat ? "flat" : "other"), transform: `translate(${gx} ${gy})` }, glyphSvg);
      Base.svg("path", { class: "gwall", d: `M${m},${ly}V${ch - 1}H${c - m}V${ly}` }, g);
      Base.svg("line", { class: "glid", x1: m, x2: c / 2 - gap / 2, y1: ly, y2: ly }, g);
      Base.svg("line", { class: "glid", x1: c / 2 + gap / 2, x2: c - m, y1: ly, y2: ly }, g);
      Base.svg("rect", { class: "gbar", x: c / 2 - len / 2, y: ly - th - 1.5, width: len, height: th, rx: th / 2 }, g);
    }
  });

  /* ---------------------------------------------------------------- the paper's Figure 8 rows */
  const KIND_LABEL = { perception: "perception", motion: "motion plan", grasp: "grasp plan", move: "move", decide: "decide", other: "other" };
  const kinds = $("#f5-kinds");
  for (const [k, label] of Object.entries(KIND_LABEL)) {
    const s = Base.el("span", { class: "kind" + (k === "motion" ? " motion" : "") }, kinds);
    s.appendChild(Base.glyph("k-" + k));
    Base.el("span", { text: label }, s);
  }
  const gapItem = Base.el("span", { class: "kind gap" }, kinds);
  Base.el("i", { "aria-hidden": "true" }, gapItem);
  Base.el("span", { text: "no such step" }, gapItem);

  const stSvg = $("#f5-structure");
  const stTip = Base.tooltip($(".f5-structure"));
  const rows = S.rows, cols = S.cols;
  const pct = (key) => (S.success_pct[key] == null ? "–" : `${S.success_pct[key]}%`);
  Base.mount($(".f5-structure"), (w) => {
    stSvg.replaceChildren();
    const phone = w < 520;
    const blocks = phone ? [cols.slice(0, Math.ceil(cols.length / 2)), cols.slice(Math.ceil(cols.length / 2))] : [cols];
    const offs = phone ? [0, Math.ceil(cols.length / 2)] : [0];
    const labelW = phone ? 20 : 108, rateW = phone ? 38 : 48;
    const per = Math.max(...blocks.map((b) => b.length));
    const pitch = (w - labelW - rateW) / per, s = Math.min(24, pitch - 5);
    // on a phone the gap keeps the success column's head with the block whose rows carry the rates
    const rowH = s + 24, blockH = rows.length * rowH, top = 18, blockGap = phone ? 34 : 12;
    const H = top + blocks.length * blockH + (blocks.length - 1) * blockGap;
    stSvg.setAttribute("viewBox", `0 0 ${w} ${H}`);
    stSvg.setAttribute("height", H);
    // the success column heads the block that carries it (the last one)
    Base.svg("text", { class: "st-head", x: w, y: top + (blocks.length - 1) * (blockH + blockGap) - 7, "text-anchor": "end", text: "success @2" }, stSvg);
    const rep = S.repeat || {}, badges = [];
    blocks.forEach((block, bi) => {
      const by = top + bi * (blockH + blockGap);
      const cx = (j) => labelW + j * pitch + (pitch - s) / 2;
      const ry = (r) => by + r * rowH + 6;
      // the human row's motion-plan columns, carried down through the agent rows
      block.forEach((col, j) => {
        if (col[0] && col[0].cls === "motion") Base.svg("rect", { class: "st-band", x: cx(j) - 3, y: ry(0) - 3, width: s + 6, height: ry(rows.length - 1) + s + 3 - (ry(0) - 3), rx: 7 }, stSvg);
      });
      rows.forEach((row, r) => {
        const y = ry(r);
        const have = block.map((col, j) => (col[r] ? j : null)).filter((j) => j != null);
        if (have.length > 1) Base.svg("line", { class: "st-line", x1: cx(have[0]) + s / 2, x2: cx(have[have.length - 1]) + s / 2, y1: y + s / 2, y2: y + s / 2 }, stSvg);
        Base.svg("text", { class: "st-letter", x: 0, y: y + s / 2 + 4, text: row.label }, stSvg);
        if (!phone) Base.svg("text", { class: "st-name", x: 16, y: y + s / 2 + 4, text: row.name }, stSvg);
        if (bi === blocks.length - 1) Base.svg("text", { class: "st-rate", x: w, y: y + s / 2 + 6, "text-anchor": "end", text: pct(row.key) }, stSvg);
        block.forEach((col, j) => {
          const cell = col[r], x = cx(j);
          if (!cell) {
            Base.svg("rect", { class: "st-gap", x: x + 0.5, y: y + 0.5, width: s - 1, height: s - 1, rx: 5 }, stSvg);
            return;
          }
          const g = Base.svg("g", { class: "st-chip " + cell.cls }, stSvg);
          Base.svg("rect", { x, y, width: s, height: s, rx: 5 }, g);
          const gs = Math.min(13, s - 9);
          Base.svg("use", { href: "#k-" + cell.cls, x: x + (s - gs) / 2, y: y + (s - gs) / 2, width: gs, height: gs }, g);
        });
        // a block the agent unrolls is drawn once; a bracket under it says how many times it runs
        const R = rep[row.key];
        if (R) {
          const at = (step) => block.findIndex((col) => col[r] && col[r].step === step);
          const a = at(R.first), b = at(R.last);
          const ja = a >= 0 ? a : bi > 0 ? 0 : null, jb = b >= 0 ? b : bi < blocks.length - 1 ? block.length - 1 : null;
          if (ja != null && jb != null) {
            const yb = y + s + 5, xa = cx(ja), xb = cx(jb) + s;
            Base.svg("path", { class: "st-repeat", d: `M${xa},${yb - 3}V${yb}H${xb}V${yb - 3}` }, stSvg);
            if (b >= 0) {
              const times = `×${R.times}`, tw = Base.textWidth(times, MONO(10.5)) + 10, mx = (xa + xb) / 2;
              const badge = Base.svg("g", { class: "st-times-g", tabindex: "0" });
              Base.svg("rect", { class: "st-times-bg", x: mx - tw / 2, y: yb - 6.5, width: tw, height: 13, rx: 6.5 }, badge);
              Base.svg("text", { class: "st-times", x: mx, y: yb + 3.6, "text-anchor": "middle", text: times }, badge);
              Base.svg("title", { text: `${times}: ${row.name}'s program runs this block ${R.times === 2 ? "twice" : `${R.times} times`}` }, badge);
              badges.push(badge);
            }
          }
        }
      });
      // one focusable column per step position: its tooltip names what each program does there
      block.forEach((col, j) => {
        const hit = Base.svg("rect", { class: "st-hit", x: labelW + j * pitch, y: ry(0) - 4, width: pitch, height: ry(rows.length - 1) + s + 4 - (ry(0) - 4) }, stSvg);
        stTip.bind(hit, () => ({
          title: `Step ${offs[bi] + j + 1}`,
          rows: rows.map((row, r) => ({ text: `${row.label}: ${col[r] ? `${col[r].step} (${KIND_LABEL[col[r].cls]})` : "no such step"}` })),
        }));
      });
    });
    // over the step columns, so the badge's own title answers a hover on it
    for (const b of badges) stSvg.appendChild(b);
  });
  // the drawn rows, as a table
  const table = $("#f5-structure-table");
  const head = Base.el("tr", {}, Base.el("thead", {}, table));
  for (const h of ["Step", ...rows.map((r) => `${r.label} (${r.name})`)]) Base.el("th", { text: h }, head);
  const body = Base.el("tbody", {}, table);
  cols.forEach((col, j) => {
    const tr = Base.el("tr", {}, body);
    Base.el("td", { text: String(j + 1) }, tr);
    col.forEach((cell) => Base.el("td", { text: cell ? `${cell.step} (${KIND_LABEL[cell.cls]})` : "none" }, tr));
  });
  const rate = Base.el("tr", {}, body);
  Base.el("td", { text: "success @2" }, rate);
  rows.forEach((row) => Base.el("td", { text: pct(row.key) }, rate));
});
