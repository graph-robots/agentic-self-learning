/* Hero (DESIGN_SPEC §3.1): Opus 5's first Tool Hanging program and its program four rounds later, side by side on one
   clock. th_k0 is the master; th_k4 follows a piecewise map over the step boundaries the two share. Both open paused
   on their end frames; one button plays them from the start, and they stop on their end frames again. One step strip
   serves both programs, with a ✓ row for each, and under it the run's five rounds; the held-out result heads the card. */
Base.section("hero", async (root, d) => {
  const $ = (sel) => root.querySelector(sel);
  const byId = (id) => d.clips.clips.find((c) => c.id === id);
  const k0 = byId("th_k0"), k4 = byId("th_k4"), R = d.rounds_th;
  const readout = $("#hero-readout");
  const phoneQ = window.matchMedia("(max-width: 600px)");
  const noHover = window.matchMedia("(hover: none)");
  if (k0.stages.length !== k4.stages.length || k0.stages.some((s, i) => s.node !== k4.stages[i].node))
    throw new Error("hero: th_k0 and th_k4 must run the same steps in the same order");

  // the readout is our words with node names in mono, so it is built from parts: text, or elements
  const code = (text) => Base.el("code", { text });
  const say = (...parts) => readout.replaceChildren(...parts.flat().filter((p) => p != null && p !== "")
    .map((p) => (typeof p === "string" ? document.createTextNode(p) : p)));

  /* ---- th_k4's time as a function of th_k0's: every step boundary the two share, strictly increasing in both */
  const pairs = [];
  for (const p of [[0, 0], ...k0.stages.flatMap((s, i) => [[s.t0, k4.stages[i].t0], [s.t1, k4.stages[i].t1]]), [k0.duration_s, k4.duration_s]]) {
    const last = pairs[pairs.length - 1];
    if (!last || (p[0] > last[0] && p[1] > last[1])) pairs.push(p);
  }
  const toK4 = Base.piecewise(pairs);
  const div0 = $('.clip[data-clip="th_k0"]'), div4 = $('.clip[data-clip="th_k4"]');
  const start = parseFloat(div0.dataset.start);
  div4.dataset.start = toK4(start).toFixed(2);
  // once the last step (release) is over the outcome is settled, and each clip says it
  const settled = k0.stages[k0.stages.length - 1].t1;

  /* ---- one strip for both programs: the lead-in still, the steps, an end badge per program. Over the chips the
     subgraphs go by plain names ("carry", not "carry_sg"); each chip's title keeps the node. */
  const OUTCOME = { fail: { glyph: "m-seen", text: "not hung" }, ok: { glyph: "m-ok", text: "hung" } };
  const both = (s, i) => (s.status === k4.stages[i].status ? `reported ${s.status} in both programs` : `k0 ${s.status}, k4 ${k4.stages[i].status}`);
  const centres = k0.stages.map((s) => (s.t0 + s.t1) / 2);
  const tightest = Math.min(...centres.slice(1).map((c, i) => c - centres[i]));
  // "six": a chip and a ✓ per step. "merged" and "phone": the short grasp steps share one chip, since three slivers
  // carry no glyph and their ✓s would pile up; a phone also drops the end badges' words (each clip says them).
  const shapeOf = (L) => (L.phone ? "phone" : L.x.k * tightest >= 12 ? "six" : "merged");
  const steps = (shape) => {
    const out = [];
    k0.stages.forEach((s, i) => {
      const prev = out[out.length - 1];
      if (shape !== "six" && prev && prev.sg === s.group) {
        prev.t1 = s.t1;
        prev.parts.push(i);
        prev.label = prev.group;
        prev.node = s.group;
        prev.title = `${prev.parts.map((j) => k0.stages[j].label).join(", ")} · ${both(s, i)}`;
        return;
      }
      out.push({ ...s, sg: s.group, group: s.group.replace(/_sg$/, ""), title: both(s, i), parts: [i] });
    });
    return out;
  };
  const ends = (shape) => [k0, k4].map((c) => ({ lead: `k${c.iteration}`, kind: c.outcome, text: shape === "phone" ? "" : OUTCOME[c.outcome].text }));
  // the lead-in is 1.2 s, too narrow for "perceive · plan" over it; the strip's key names the hatch in full
  const leadIn = { ...k0.still[0], label: "look (robot still)" };

  let shape = phoneQ.matches ? "phone" : "six";
  const svgR = $("#hero-ribbon");
  const ribbon = Base.ribbon(svgR, { mode: "timed", duration: k0.duration_s, still: [leadIn], stages: steps(shape), end: ends(shape) });

  /* ---- a ✓ row per program under the chips; base's end badges are moved onto the rows, so each row ends in its
     program's outcome */
  const ROW = 15;   // the pitch of base's stacked end badges
  const ROW_FONT = '500 10.5px "JetBrains Mono", monospace';
  const programs = [{ k: "k0", clip: k0 }, { k: "k4", clip: k4 }];
  let cols = [], now = start;
  const paintRows = () => cols.forEach((c) => c.marks.forEach((m) => m.classList.toggle("done", now >= c.t1)));
  const drawRows = (L) => {
    const g = Base.svg("g", { class: "hero-rows" }, svgR);
    const ys = programs.map((_, r) => L.yb + 10 + r * ROW);
    cols = L.chips.slice().sort((a, b) => a.i - b.i).map((c) => ({ c, x: c.x + c.w / 2, t1: c.s.t1 }));
    // the row names sit under the lead-in, where no step has a mark; a phone has no room, and the end badges name them
    const firstMark = cols.length ? cols[0].x - 6 : L.w;
    programs.forEach((p, r) => {
      const named = Base.textWidth(p.k, ROW_FONT) + 4 < firstMark;
      if (named) Base.svg("text", { class: "hero-row-k", x: 1, y: ys[r] + 3.5, text: p.k }, g);
      // a dotted guide carries the eye from the row's name along its ✓s to its end badge
      const x0 = named ? Base.textWidth(p.k, ROW_FONT) + 6 : L.x0;
      Base.svg("line", { class: "hero-row-line", x1: x0, x2: L.endBelow ? L.x1 : L.x1 + 6, y1: ys[r], y2: ys[r] }, g);
    });
    for (const col of cols) {
      col.marks = programs.map((p, r) => {
        const st = Base.svg("g", { class: "hero-st", "data-row": p.k }, g);
        Base.svg("circle", { class: "hero-pending", cx: col.x, cy: ys[r], r: 3 }, st);
        Base.mark(st, "m-check", col.x, ys[r], { size: 11, cls: "glyph mark-ok", group: "hero-done" });
        const nodes = col.c.s.parts.map((j) => p.clip.stages[j]);
        Base.svg("title", { text: `${p.k} · ${nodes.map((s) => s.node).join(", ")} · reported ${[...new Set(nodes.map((s) => s.status))].join(", ")}` }, st);
        return st;
      });
    }
    // base stacks the badges around the chip row, or, when they do not fit beside it, under the strip
    const h0 = +svgR.getAttribute("height"), bottom = ys[ys.length - 1] + 7;
    let h = h0;
    if (!L.endBelow) {
      L.endsG.setAttribute("transform", `translate(0 ${ys[0] - (L.chipY + L.chipH / 2 - ROW / 2)})`);
      h = Math.max(h0, bottom);
    } else {
      const firstBadge = L.yb + L.bands[L.rows - 1] + 9;
      const dy = Math.max(0, bottom + 12 - firstBadge);
      L.endsG.setAttribute("transform", `translate(0 ${dy})`);
      h = h0 + dy;
    }
    if (h !== h0) {
      svgR.setAttribute("viewBox", `0 0 ${L.w} ${h}`);
      svgR.setAttribute("height", h);
      svgR.style.height = h + "px";
    }
    paintRows();
  };
  const onRender = (L) => {
    const want = shapeOf(L);
    if (want !== shape) {
      // a width change moved the strip to another shape: lay it out again after this draw has finished
      shape = want;
      queueMicrotask(() => ribbon.update({ stages: steps(shape), end: ends(shape) }));
      return;
    }
    root.classList.toggle("hero-merged", shape !== "six");
    drawRows(L);
  };
  ribbon.on("render", onRender);
  onRender(ribbon.layout);
  const show = (t) => {
    now = t;
    ribbon.setTime(t);
    paintRows();
    for (const div of [div0, div4]) div.classList.toggle("hero-done", t >= settled);
  };

  /* ---- the five rounds and what each round did */
  const hung = (r) => r.train.filter(Boolean).length;
  const held = (r) => Math.round(r.heldout.rate * r.heldout.n);
  const why = (r) => r.revert_reason.split(" (")[0];
  const round = (k) => R.rounds.find((r) => r.k === k);
  const last = R.rounds[R.rounds.length - 1];
  const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  // an edit's stages are the scripts/<stage>/ folders it touched, plus workflow.json (the wiring), in plain words
  const PLAIN = { perceive: "perception", mate: "hook-placement", carry: "carry" };
  const what = (e) => {
    const scripts = e.stages.filter((s) => s !== "wiring").map((s) => PLAIN[s] || s);
    return [scripts.length ? `its ${list(scripts)} code` : null, e.stages.includes("wiring") ? "its graph wiring" : null].filter(Boolean).join(" and ");
  };
  // lines is the length of accepted.diff, headers and context included: a diff's size, not lines changed
  const diffSize = (n) => `${/^(8|1[18](\d{3})*$)/.test(String(n)) ? "an" : "a"} ${n}-line diff`;
  const describe = (r) => (r.reverted
    ? `k${r.k} · ${hung(r)} of ${r.train.length} · ${why(r)}, so the loop reverted to k${r.revert_to}`
    : `k${r.k} · ${hung(r)} of ${r.train.length} training layouts hung${r.heldout ? ` · ${held(r)} of ${r.heldout.n} held-out` : ""}`);
  const then = (r) => {
    const e = R.edits.find((x) => x.after === r.k);
    if (!e) return r === last && R.done === "val_target" ? " The run stopped here: the program met its validation target." : "";
    const onto = e.applied_to !== e.after ? `k${e.applied_to}'s program: ` : "";
    return ` The agent then edited ${onto}${what(e)} (${diffSize(e.lines)}).`;
  };
  const sentence = (r) => (r.reverted
    ? `Round k${r.k}: ${why(r)}, so the loop reverted to k${r.revert_to}'s program.${then(r)}`
    : `Round k${r.k}: ${hung(r)} of ${r.train.length} training layouts hung${r.heldout ? `, and ${held(r)} of ${r.heldout.n} held-out layouts` : ""}.${then(r)}`);
  const editSentence = (e) => {
    const next = R.rounds[R.rounds.findIndex((r) => r.k === e.after) + 1];
    const whose = e.applied_to !== e.after ? `k${e.applied_to}'s program, since k${e.after} was reverted` : "the program";
    return `After k${e.after}, the agent edited ${whose}: ${what(e)} (${diffSize(e.lines)}). The result is k${next.k}.`;
  };
  const r0 = round(k0.iteration), r4 = round(k4.iteration);
  // the end frames, in the clips' own words
  const resting = `k${k0.iteration}: ${k0.note} k${k4.iteration}: ${k4.note}`;
  const atTime = (t) => {
    const s = k0.stages.find((x) => t >= x.t0 && t < x.t1), lead = k0.still[0];
    const where = s ? code(s.node) : t < lead.t1 ? "robot still, looking and planning" : t >= settled ? "after the last step" : "between steps";
    return [`${t.toFixed(1)} s · `, where, ` · ${k0.stages.filter((x) => x.t1 <= t).length} of ${k0.stages.length} steps reported ok in each program`];
  };
  $("#hero-h0").textContent = `${held(r0)}/${r0.heldout.n}`;
  $("#hero-h4").textContent = `${held(r4)}/${r4.heldout.n}`;

  const goLoop = (k) => {
    Base.emit("loop:select", k);
    const target = document.getElementById("findings");
    if (target) target.scrollIntoView({ behavior: Base.reduced ? "auto" : "smooth", block: "start" });
  };
  const sayRound = (k, offerLoop) => {
    const link = offerLoop && document.getElementById("findings")
      ? Base.el("a", { class: "hero-goto", href: "#findings", text: "See this round in the loop ↓", onclick: (e) => { e.preventDefault(); goLoop(k); } })
      : null;
    say(sentence(round(k)), link);
  };
  let selected = null;
  const svgK = $("#hero-rounds");
  const strip = Base.rounds(svgK, R.rounds, {
    compact: phoneQ.matches, labels: { [r0.k]: "first program", [r4.k]: "kept" }, edits: R.edits, describe,
    // a mouse has already shown the round on hover, so a click goes on to the loop. A first tap only selects it, with
    // the way on in the readout; a second tap on the same round takes it.
    onSelect: (k) => {
      if (!noHover.matches || selected === k) return goLoop(k);
      selected = k;
      strip.select(k);
      point(null);
    },
  });
  phoneQ.addEventListener("change", () => strip.update({ compact: phoneQ.matches }));
  const body = $("#hero-rounds-table tbody");
  for (const r of R.rounds) {
    const tr = Base.el("tr", {}, body);
    for (const text of [`k${r.k}`, `${hung(r)} of ${r.train.length}`,
      r.reverted ? `${why(r)}; reverted to k${r.revert_to}` : r.heldout ? `${held(r)} of ${r.heldout.n} held-out layouts` : ""]) Base.el("td", { text }, tr);
  }

  // base draws the arc from the program an edit went onto (k0) to the round it gave (k2) unlabelled; the label goes
  // under it after every redraw, and the strip grows to hold it
  const onto = R.edits.find((e) => e.applied_to !== e.after);
  const labelArc = () => {
    const arc = svgK.querySelector(".lineage");
    if (!onto || !arc || svgK.querySelector(".hero-lineage-label")) return;
    const b = arc.getBBox(), y = b.y + b.height + 20;
    Base.svg("text", { class: "hero-lineage-label", x: b.x + b.width / 2, y, "text-anchor": "middle", text: `edit applied to k${onto.applied_to}'s program` }, svgK);
    const w = +svgK.viewBox.baseVal.width, h = +svgK.getAttribute("height");
    if (y + 4 > h) {
      svgK.setAttribute("viewBox", `0 0 ${w} ${y + 4}`);
      svgK.setAttribute("height", y + 4);
      svgK.style.height = y + 4 + "px";
    }
  };
  new MutationObserver(labelArc).observe(svgK, { childList: true });
  labelArc();

  // pencils come in the order base draws them: every edit after a round that has a next round, onto a round shown
  const at = (k) => R.rounds.findIndex((r) => r.k === k);
  const drawnEdits = R.edits.filter((e) => at(e.after) >= 0 && at(e.after) < R.rounds.length - 1 && at(e.applied_to != null ? e.applied_to : e.after) >= 0);
  const clipOf = new Map([[r0.k, div0], [r4.k, div4]]);
  const linkClips = (k) => clipOf.forEach((div, kk) => div.classList.toggle("linked", kk === k));
  // a round or a pencil names what happened in it; k0's and k4's rounds also outline their clip. Away from the strip
  // the readout goes back to the selected round, if a tap chose one, or to what the end frames show.
  function point(target) {
    const pencil = target && target.closest(".pencils"), g = target && target.closest(".round");
    if (pencil) {
      linkClips(null);
      say(editSentence(drawnEdits[[...svgK.querySelectorAll(".pencils")].indexOf(pencil)]));
    } else if (g) {
      linkClips(+g.dataset.k);
      sayRound(+g.dataset.k, +g.dataset.k === selected);
    } else {
      linkClips(selected);
      if (selected != null) sayRound(selected, true); else say(resting);
    }
  }
  svgK.addEventListener("pointerover", (e) => point(e.target));
  svgK.addEventListener("focusin", (e) => point(e.target));
  svgK.addEventListener("pointerleave", () => { if (!svgK.contains(document.activeElement)) point(null); });
  svgK.addEventListener("focusout", (e) => { if (!svgK.contains(e.relatedTarget)) point(null); });
  const prompt = () => { $("#hero-try").textContent = `▸ ${noHover.matches ? "Tap" : "Hover"} a round below to see what happened in it.`; };
  noHover.addEventListener("change", prompt);
  prompt();
  say(resting);

  /* ---- the clips: the tag on each frame, its outcome once settled, and one play control for both */
  const caps = root.querySelectorAll(".hero-pair-cap p");
  const [c0, c4] = await Promise.all([Base.clip(div0), Base.clip(div4)]);
  [c0, c4].forEach((c, i) => {
    // a phone keeps "k0" and the outcome dot on the frame; the rest of the tag is the caption under the pair
    const [k, ...more] = c.el.dataset.tag.split(" · ");
    caps[i].textContent = more.join(" · ");
    const tag = c.el.querySelector(".clip-tag"), dot = tag.querySelector("i");
    tag.replaceChildren(...[dot, document.createTextNode(k), Base.el("span", { class: "hero-tag-more", text: ` · ${more.join(" · ")}` })].filter(Boolean));
    const o = OUTCOME[c.info.outcome];
    const pill = Base.el("span", { class: `hero-outcome ${c.info.outcome}` }, c.el);
    pill.append(Base.glyph(o.glyph), Base.el("span", { text: o.text }));
    // the pair plays as one, from the button under it, so neither clip keeps a control of its own
    c.video.controls = false;
    const own = c.el.querySelector(".playtoggle");
    if (own) own.remove();
  });
  const v0 = c0.video;
  Base.syncPiecewise(v0, c4.video, pairs);
  c0.follow(show);
  ribbon.on("seek", (t) => { c0.pause(); c0.seek(t); c4.seek(toK4(t)); show(t); say(atTime(t)); });

  const btn = $("#hero-play"), icon = btn.querySelector("use"), word = btn.querySelector("span");
  const paint = () => {
    const playing = !v0.paused && !v0.ended, fromStart = v0.currentTime >= settled;
    icon.setAttribute("href", playing ? "#i-pause" : "#i-play");
    word.textContent = playing ? "Pause" : "Play both";
    btn.setAttribute("aria-label", playing ? "Pause both clips" : fromStart ? "Play both clips from the start" : "Play both clips");
  };
  btn.addEventListener("click", () => {
    if (!v0.paused && !v0.ended) { c0.pause(); return; }
    // from the end state the pair starts over; from a pause mid-way it goes on
    const from = v0.ended || v0.currentTime >= settled ? 0 : null;
    if (from != null) c4.seek(toK4(from));
    c0.play(from);
    if (selected == null) say(resting);   // a scrub's time stamp would go stale while the pair plays
  });
  // no loop: the master stops on its last frame, and th_k4 is put on its own
  v0.addEventListener("ended", () => { c4.seek(toK4(k0.duration_s)); show(k0.duration_s); });
  for (const e of ["play", "pause", "ended", "seeked"]) v0.addEventListener(e, paint);
  paint();
  show(start);
});
