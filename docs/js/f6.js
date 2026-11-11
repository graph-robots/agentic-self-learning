/* Finding 6 · Curriculum (DESIGN_SPEC §3.9): two roads to a camera policy. The fork names them and doubles as the
   legend; the dumbbells give every task's held-out success both ways (Table 4), ordered by which road won; the chip
   rows count the skills in the selected row's final programs, so "patched, not reorganized" can be counted. The two
   lock-in cards are schematics of the appendix's single-run cases; their numbers stay in the tagged card text. */
Base.section("f6", async (root, data) => {
  const { el, svg, $ } = Base;
  const cur = data.curriculum;
  const SRC = "chapters/appendix/curriculum.tex";

  const NUM = '600 18px "Barlow Condensed", "Arial Narrow", sans-serif';
  const SANS = (px, w) => `${w || 500} ${px}px Manrope, "Helvetica Neue", Arial, sans-serif`;
  const tw = (text, px, w) => Base.textWidth(text, SANS(px, w));
  const frame = (box, w, h) => {
    box.setAttribute("viewBox", `0 0 ${w} ${h}`);
    box.setAttribute("height", h);
    box.style.height = h + "px";
  };
  const icon = (parent, id, x, y, s, cls) => svg("use", { href: "#" + id, x, y, width: s, height: s, class: cls }, parent);
  const greedy = (text, maxW, px, w) => text.split(" ").reduce((lines, word) => {
    const last = lines[lines.length - 1];
    if (last && tw(last + " " + word, px, w) <= maxW) lines[lines.length - 1] = last + " " + word;
    else lines.push(word);
    return lines;
  }, []);
  // the narrowest wrap with as few lines as the greedy one, so a caption never ends on one stray word
  const wrap = (text, maxW, px, w) => {
    const n = greedy(text, maxW, px, w).length;
    let lo = maxW / n, hi = maxW;
    while (hi - lo > 2) { const mid = (lo + hi) / 2; if (greedy(text, mid, px, w).length > n) lo = mid; else hi = mid; }
    return greedy(text, hi, px, w);
  };
  const pct = (v) => String(Math.round(v));   // Table 4's success cells are whole percents
  const skills = (v) => v.toFixed(1);         // its skill counts keep one decimal (12.0)
  const keyOf = (task) => task.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  // a paper number written into generated text keeps its provenance, like the tagged spans in the fragment
  const num = (text, src) => el("span", { class: "num", [src.endsWith(".json") ? "data-fig" : "data-src"]: src, text });
  const say = (box, parts) => box.replaceChildren(...parts.map((p) => (typeof p === "string" ? document.createTextNode(p) : p)));

  const THUMB = {
    "Tool Hanging": "tool_hanging_before.jpg", "Gear Meshing": "gear_mesh_before.jpg", "USB-C Insertion": "usbc_insert_before.jpg",
    "Kitchen": "mimicgen_kitchen.jpg", "Coffee": "mimicgen_coffee.jpg", "Threading": "mimicgen_threading.jpg",
    "Mug Cleanup": "mimicgen_mug_cleanup.jpg",
  };
  const overall = cur.rows.find((r) => r.task === "Overall");
  const lead = (r) => r.success.curr - r.success.perc;   // orders the rows; never printed
  const tasks = cur.rows.filter((r) => r !== overall).sort((a, b) => lead(b) - lead(a));
  const rows = [...tasks, overall];
  let selected = overall;

  /* ---------------------------------------------------------------- the fork: two roads, and the legend */
  const fork = $("#f6-fork", root);
  Base.mount(fork, (w) => {
    fork.replaceChildren();
    const compact = w < 600;   // the phone's two-line legend
    const th = compact ? 22 : 26, yA = compact ? 14 : 36, yB = compact ? 56 : 84, H = compact ? 70 : 124;
    const ends = [["curr", "with curriculum", yA], ["perc", "camera only", yB]];
    const endW = 26 + Math.max(...ends.map(([, t]) => tw(t, 12.5, 700)));
    const x0 = compact ? 0 : 228, xe = w - endW - (compact ? 2 : 10), xm = (x0 + xe) / 2;
    frame(fork, w, H);
    if (!compact) {
      const sx = 190, sy = (yA + yB) / 2;
      ["Same task, model, skills,", "feedback and budget"].forEach((t, i) =>
        svg("text", { class: "start-label", x: 0, y: sy - 4 + i * 16, text: t }, fork));
      for (const y of [yA, yB]) svg("path", { class: "branch", d: `M${sx},${sy} C${sx + 24},${sy} ${x0 - 24},${y} ${x0},${y}` }, fork);
      svg("circle", { class: "start", cx: sx, cy: sy, r: 4 }, fork);
    }
    const font = compact ? 12 : 12.5, s = compact ? 13 : 15;
    const seg = (x, y, width, cls, glyph, label, sub) => {
      const g = svg("g", { class: "seg " + cls }, fork);
      svg("rect", { x, y: y - th / 2, width, height: th, rx: 7 }, g);
      icon(g, glyph, x + 9, y - s / 2, s, "ico");
      const lx = x + 16 + s, room = x + width - lx - 8, lw = tw(label, font, 600);
      if (lw > room) return;
      svg("text", { class: "seg-label", x: lx, y: y + 4.5, text: label }, g);
      if (sub && lw + 10 + tw(sub, 11.5) <= room) svg("text", { class: "seg-sub", x: lx + lw + 10, y: y + 4.5, text: sub }, g);
    };
    seg(x0, yA, xm - x0 - 3, "priv", "i-box", compact ? "privileged" : "privileged geometry", "exact poses, no camera");
    seg(xm + 3, yA, xe - xm - 3, "cam curr", "i-camera", compact ? "camera" : "RGB-D camera");
    seg(x0, yB, xe - x0, "cam perc", "i-camera", compact ? "camera from the start" : "RGB-D camera from the start");
    // the switch is a moment in both roads; on a phone it marks road A only and is named in the gap below it
    const top = yA - th / 2 - (compact ? 3 : 10), bottom = compact ? yA + th / 2 + 3 : yB + th / 2 + 4;
    svg("line", { class: "switch", x1: xm, x2: xm, y1: top, y2: bottom }, fork);
    if (compact) svg("text", { class: "switch-label", x: xm, y: bottom + 11, "text-anchor": "middle", text: "switch" }, fork);
    else {
      svg("text", { class: "switch-label", x: xm, y: top - 4, "text-anchor": "middle", text: "switch, halfway" }, fork);
      svg("text", { class: "axis-note", x: xe, y: bottom + 16, "text-anchor": "end", text: "iterations →" }, fork);
    }
    for (const [cls, text, y] of ends) {
      svg("circle", { class: "dot " + cls, cx: xe + 14, cy: y, r: 6.5 }, fork);
      svg("text", { class: "end-label", x: xe + 26, y: y + 4.5, text }, fork);
    }
  });

  /* ---------------------------------------------------------------- the dumbbells: every task, both roads */
  const bells = $("#f6-bells", root);
  bells.setAttribute("role", "radiogroup");
  let rowNodes = [];
  const paintSelection = () => rowNodes.forEach(({ g, r }) => {
    g.setAttribute("aria-checked", String(r === selected));
    g.setAttribute("tabindex", r === selected ? "0" : "-1");
  });
  Base.mount(bells, (w) => {
    bells.replaceChildren();
    // a phone gives each row a name line above its bar, so the bar can use the whole width: beside a name column the
    // axis kept about 180 px and Overall's two dots ran into each other
    const stacked = w < 480;
    const nameFont = stacked ? 12.5 : 13.5;
    const labelW = 12 + Math.max(...rows.map((r) => tw(r.task, nameFont, 700)));
    const x0 = stacked ? 26 : labelW + 30, x1 = w - (stacked ? 28 : 30);
    const X = (v) => x0 + (v / 100) * (x1 - x0);
    const RH = stacked ? 56 : 40, GH = 26, barY = stacked ? 41 : RH / 2;
    const grid = svg("g", { class: "grid" }, bells);
    const layer = svg("g", { class: "rows" }, bells);
    const tickY = stacked ? 27 : 11;
    svg("text", { class: "axis-title", x: 12, y: 11, text: "held-out success, %" }, bells);
    for (const v of [0, 25, 50, 75, 100]) svg("text", { class: "tick", x: X(v), y: tickY, "text-anchor": "middle", text: String(v) }, bells);
    rowNodes = [];

    const row = (r, y, legend) => {
      const cy = y + barY, c = r.success.curr, p = r.success.perc;
      const g = svg("g", {
        class: "row" + (r === overall ? " total" : ""), role: "radio", "data-key": keyOf(r.task),
        "aria-label": `${r.task}: ${pct(c)}% held-out success with the curriculum, ${pct(p)}% camera only`,
      }, layer);
      svg("rect", { class: "row-bg", x: 0, y: y + 2, width: w, height: RH - 4, rx: 8 }, g);
      svg("rect", { class: "accent", x: 0, y: y + 10, width: 3, height: RH - 20, rx: 1.5 }, g);
      const bench = (r.bench || "mean of all tasks").toUpperCase();
      svg("text", { class: "name", x: 12, y: stacked ? y + 16 : cy - 1, text: r.task }, g);
      if (stacked) svg("text", { class: "bench", x: 20 + tw(r.task, nameFont, r === overall ? 800 : 700), y: y + 16, text: bench }, g);
      else svg("text", { class: "bench", x: 12, y: cy + 12, text: bench }, g);
      svg("line", { class: "bar", x1: X(Math.min(c, p)), x2: X(Math.max(c, p)), y1: cy, y2: cy }, g);
      const R = stacked ? 5 : 6;   // Overall's 46 and 52 sit 6 points apart
      svg("circle", { class: "dot perc", cx: X(p), cy, r: R }, g);
      svg("circle", { class: "dot curr", cx: X(c), cy, r: R }, g);
      const [lo, hi] = c < p ? ["curr", "perc"] : ["perc", "curr"];
      svg("text", { class: "val " + lo, x: X(Math.min(c, p)) - 11, y: cy + 5, "text-anchor": "end", text: pct(Math.min(c, p)) }, g);
      svg("text", { class: "val " + hi, x: X(Math.max(c, p)) + 11, y: cy + 5, text: pct(Math.max(c, p)) }, g);
      if (legend) {   // the top row names its two dots, so the chart reads without the fork
        const labels = [["curr", "with curriculum", X(c)], ["perc", "camera only", X(p)]].map(([cls, text, x]) => {
          const half = tw(text, 10.5, 600) / 2;
          return { cls, text, x: Math.max(x0 - 10 + half, Math.min(w - half, x)), half };
        });
        const [a, b] = labels;
        if (Math.abs(a.x - b.x) > a.half + b.half + 8)
          for (const l of labels) svg("text", { class: "dlabel " + l.cls, x: l.x, y: cy - 11, "text-anchor": "middle", text: l.text }, g);
      }
      svg("title", { text: `${r.task}: ${pct(c)}% with the curriculum, ${pct(p)}% camera only` }, g);
      g.addEventListener("click", () => select(r));
      rowNodes.push({ g, r });
    };

    let y = stacked ? 34 : 20;
    const top = y;
    // the heads say which road came out ahead, not the paper's "accelerate / constrain": the paper names only some
    // tasks with those verbs, and USB-C and Gear Meshing are not among them
    const groups = [["curr", "Curriculum ahead", tasks.filter((r) => lead(r) > 0)], ["perc", "Camera only ahead", tasks.filter((r) => lead(r) <= 0)]];
    for (const [cls, name, list] of groups) {
      svg("circle", { class: "dot " + cls, cx: 16, cy: y + 13.5, r: 4 }, bells);
      svg("text", { class: "ghead", x: 26, y: y + 17, text: name.toUpperCase() }, bells);
      y += GH;
      list.forEach((r, i) => { row(r, y, cls === "curr" && i === 0); y += RH; });
    }
    y += 8;
    svg("line", { class: "rule", x1: 0, x2: w, y1: y, y2: y }, bells);
    row(overall, y + 4, false);
    y += RH + 4;
    for (const v of [0, 25, 50, 75, 100])
      svg("line", { class: v === 50 ? "mid" : null, x1: X(v), x2: X(v), y1: top, y2: y }, grid);
    frame(bells, w, y + 2);
    paintSelection();
  });
  bells.addEventListener("keydown", (e) => {
    const i = rowNodes.findIndex(({ r }) => r === selected), n = rowNodes.length;
    const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    const to = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : d ? (i + d + n) % n : null;
    if (to == null) return;
    e.preventDefault();
    select(rowNodes[to].r);
    rowNodes[to].g.focus();
  });

  const sr = $("#f6-sr", root);
  el("caption", { text: "Held-out success (%) and final program size (skills), with and without the curriculum" }, sr);
  const srHead = el("tr", {}, el("thead", {}, sr));
  for (const h of ["Task", "Success with", "Success without", "Skills with", "Skills without"]) el("th", { text: h }, srHead);
  const srBody = el("tbody", {}, sr);
  for (const r of rows) {
    const tr = el("tr", {}, srBody);
    for (const v of [r.task, pct(r.success.curr), pct(r.success.perc), skills(r.skills.curr), skills(r.skills.perc)]) el("td", { text: v }, tr);
  }

  /* ---------------------------------------------------------------- program size, in skill chips */
  const chips = $("#f6-chips", root), thumb = $("#f6-thumb", root), all = $("#f6-all", root);
  const readout = $("#f6-readout", root), echo = $("#f6-echo", root), take = $("#f6-take", root);
  // Overall is the mean of the seven tasks, so its slot shows all seven scenes, in the dumbbells' order
  for (const r of tasks) el("img", { src: "assets/img/" + THUMB[r.task], alt: "", title: r.task, width: 40, height: 60 }, all);
  all.setAttribute("aria-label", "The seven tasks: " + tasks.map((r) => r.task).join(", "));
  const chipRows = (r) => (r === overall ? [
    { key: "priv", glyph: "i-box", label: "End of the privileged phase", v: cur.skills_after_privileged, cls: "curr" },
    { key: "curr", label: "With curriculum, final", v: r.skills.curr, from: cur.skills_after_privileged, cls: "curr" },
    { key: "perc", label: "Camera only, final", v: r.skills.perc, cls: "perc" },
  ] : [
    { key: "curr", label: "With curriculum, final", v: r.skills.curr, cls: "curr" },
    { key: "perc", label: "Camera only, final", v: r.skills.perc, cls: "perc" },
  ]);
  const redrawChips = Base.mount(chips, (w) => {
    chips.replaceChildren();
    const phone = Base.isPhone();
    const sq = phone ? 10 : 14, gap = 2, five = phone ? 3 : 4;   // a wider gap every five, for counting
    const lineW = (n) => n * sq + (n - 1) * gap + Math.floor((n - 1) / 5) * five;
    const numW = 10 + Math.max(...chipRows(selected).map((s) => Base.textWidth(skills(s.v), NUM)));
    const perLine = lineW(20) + numW <= w ? 20 : 10;
    const at = (i) => [(i % perLine) * (sq + gap) + Math.floor((i % perLine) / 5) * five, Math.floor(i / perLine) * (sq + gap)];
    let y = 0;
    const list = chipRows(selected);
    for (const spec of list) {
      const g = svg("g", { class: "chiprow " + spec.cls, "data-key": spec.key }, chips);
      if (spec.glyph) icon(g, spec.glyph, -1, y + 1, 13, "ico priv");
      else svg("circle", { class: "dot " + spec.cls, cx: 5.5, cy: y + 7.5, r: 4.5 }, g);
      svg("text", { class: "cr-label", x: 17, y: y + 12, text: spec.label }, g);
      y += 20;
      const whole = Math.floor(spec.v + 1e-9), frac = spec.v - whole, n = Math.ceil(spec.v - 1e-9);
      const kept = spec.from != null ? Math.floor(spec.from + 1e-9) : n;   // squares before the switch's increment
      for (let i = 0; i < n; i++) {
        const [x, dy] = at(i), part = i < whole ? 1 : frac, wid = part * sq;
        const cls = i >= kept ? "inc" : spec.cls;
        if (part < 1) svg("rect", { class: "sq-slot", x: x + 0.5, y: y + dy + 0.5, width: sq - 1, height: sq - 1, rx: 2.5 }, g);
        // the camera-only squares carry an ink ring like their legend dot; it is drawn inside the square so the
        // two-pixel gaps that make them countable stay open
        const k = cls === "perc" ? 0.5 : 0;
        svg("rect", { class: "sq " + cls, x: x + k, y: y + dy + k, width: Math.max(0, wid - 2 * k), height: sq - 2 * k, rx: Math.min(2.5, wid / 2) }, g);
      }
      const [lx, ly] = at(n - 1);
      svg("text", { class: "cr-num", x: lx + sq + 8, y: y + ly + sq - 0.5, text: skills(spec.v) }, g);
      y += ly + sq;
      if (spec.from != null) {
        y += 16;
        svg("rect", { class: "sq inc", x: 0.75, y: y - 9, width: 9, height: 9, rx: 2 }, g);
        svg("text", { class: "cr-note", x: 15, y: y, text: "outlined: added after the switch" }, g);
      }
      y += 16;
    }
    frame(chips, w, y - 12);
    chips.setAttribute("aria-label", list.map((s) => `${s.label}: ${skills(s.v)} skills`).join("; "));
  });

  const show = (r) => {
    selected = r;
    paintSelection();
    redrawChips();
    const task = $("#f6-task", root), succ = $("#f6-succ", root);
    const bench = el("span", { class: "bench" });
    if (r === overall) bench.append("mean of ", num("7", SRC), " tasks × ", num("3", SRC), " runs");
    else bench.textContent = r.bench;
    task.replaceChildren(document.createTextNode(r.task), bench);
    succ.replaceChildren();
    for (const [cls, v] of [["curr", r.success.curr], ["perc", r.success.perc]]) {
      const item = el("span", { class: "succ-item " + cls }, succ);
      el("i", { class: "key " + cls, "aria-hidden": "true" }, item);
      item.appendChild(num(pct(v), "curriculum.json"));
      el("span", { class: "pct", text: "%" }, item);
    }
    el("span", { class: "succ-label", text: "held out" }, succ);
    if (r === overall) {
      thumb.hidden = true;
      all.hidden = false;
    } else {
      thumb.src = "assets/img/" + THUMB[r.task];
      thumb.alt = `${r.task}: the task's starting scene`;
      thumb.hidden = false;
      all.hidden = true;
    }
    take.hidden = r !== overall;
    const f = (v, fmt) => num(fmt(v), "curriculum.json");
    if (r === overall) say(readout, ["Overall: with the curriculum, programs go from ", f(cur.skills_after_privileged, skills),
      " skills at the end of the privileged phase to ", f(r.skills.curr, skills), " after the switch; camera-only programs end at ",
      f(r.skills.perc, skills), ". The inherited program is patched, not rebuilt."]);
    else say(readout, [`${r.task} (${r.bench}): `, f(r.success.curr, pct), "% held-out success with the curriculum vs ",
      f(r.success.perc, pct), "% camera only; final programs of ", f(r.skills.curr, skills), " and ", f(r.skills.perc, skills), " skills."]);
    // a phone stacks the program-size panel a screen below the rows, so the row's answer is repeated under them
    // (shown under 860 px only; the panel's readout is the one announced)
    if (r === overall) say(echo, ["Overall: ", f(cur.skills_after_privileged, skills), " → ", f(r.skills.curr, skills),
      " skills after the switch, ", f(r.skills.perc, skills), " camera only: patched, not rebuilt. Squares below."]);
    else say(echo, [`${r.task}: final programs of `, f(r.skills.curr, skills), " skills with the curriculum, ",
      f(r.skills.perc, skills), " camera only. Squares below."]);
  };
  const select = (r) => { if (r !== selected) show(r); };
  show(overall);

  /* ---------------------------------------------------------------- lock-in 1: Kitchen's tab (schematic) */
  const tab = $("#f6-tab", root);
  Base.mount(tab, (w) => {
    tab.replaceChildren();
    // the drawing is laid out in phone units and scaled up where the card is wide, so it fills the card that stands
    // beside the taller Gear card; text keeps its size
    const k = w >= 440 ? 1.4 : 1;
    const sw = (w - 28) / 2, xs = sw + 14, cxP = sw / 2, cxC = sw + 28 + sw / 2;
    const gxC = cxC - 24 * k;                                   // the camera policy's gripper closes this far beside the tab
    const cause = [cxP + 17 * k, 62 * k], seen = [gxC - 12 * k, 64 * k];   // ◆ beside the privileged pinch, ✕ beside the miss
    // the blame arc's label sits above its peak and clear of "schematic"; the scene starts under the label
    const mx = (cause[0] + seen[0]) / 2;
    const arcLines = wrap("decided before the switch", 2 * Math.min(mx, w - 72 - mx), 12, 600);
    const T = 12 + (arcLines.length - 1) * 15 + 5;
    const caps = [["Privileged: pinches the tab", "i-box"], ["Camera: a few mm of error misses the tab", "i-camera"]]
      .map(([text, glyph]) => ({ glyph, lines: wrap(text, sw - 22, 12, 600).slice(0, 2) }));
    const potBottom = T + 146 * k, capY = potBottom + 32;
    const H = capY + (Math.max(...caps.map((c) => c.lines.length)) - 1) * 15 + 6;
    frame(tab, w, H);
    svg("text", { class: "geo-label", x: w, y: 11, "text-anchor": "end", text: "schematic" }, tab);
    const scene = (cx, privileged, cap) => {
      const g = svg("g", { class: "scene" }, tab), Y = (v) => T + v * k;
      svg("rect", { class: "pot", x: cx - 62 * k, y: Y(82), width: 124 * k, height: 64 * k, rx: 16 * k }, g);
      svg("rect", { class: "pot-in", x: cx - 53 * k, y: Y(91), width: 106 * k, height: 46 * k, rx: 9 * k }, g);
      svg("rect", { class: "tabpart", x: cx - 4 * k, y: Y(50), width: 8 * k, height: 33 * k, rx: 1.5 }, g);
      // a parallel gripper, drawn like the page's pinch glyph (#k-grasp): open around the tab, or closed beside it
      const gx = privileged ? cx : gxC, o = (privileged ? 5.5 : 1.6) * k, half = 15 * k;
      const jaw = (sx) => `M${gx + sx * half},${Y(26)} V${Y(44)} L${gx + sx * o},${Y(54)} V${Y(70)}`;
      svg("path", { class: "hand", d: `M${gx},${Y(8)} V${Y(26)} M${gx - half},${Y(26)} H${gx + half} ${jaw(-1)} ${jaw(1)}` }, g);
      if (!privileged) {
        const dim = svg("g", { class: "dimension" }, g), t = 4 * k, room = w - cx - t - 5;
        svg("path", { d: `M${cx - t},${Y(46)} V${Y(42)} M${cx + t},${Y(46)} V${Y(42)} M${cx - t},${Y(44)} H${cx + t}` }, dim);
        const label = ["tab, a few mm", "a few mm"].find((l) => tw(l, 11.5, 700) <= room);
        if (label) svg("text", { x: cx + t + 5, y: Y(44) + 4, text: label }, dim);
      }
      const capW = 18 + Math.max(...cap.lines.map((l) => tw(l, 12, 600)));
      const cx0 = cx - capW / 2;
      icon(g, cap.glyph, cx0, capY - 11, 13, "ico" + (privileged ? " priv" : ""));
      cap.lines.forEach((l, i) => svg("text", { class: "caption", x: cx0 + 18, y: capY + i * 15, text: l }, g));
    };
    scene(cxP, true, caps[0]);
    svg("line", { class: "switch", x1: xs, x2: xs, y1: T + 4, y2: potBottom + 4 }, tab);
    svg("text", { class: "switch-label", x: xs, y: potBottom + 16, "text-anchor": "middle", text: "switch" }, tab);
    scene(cxC, false, caps[1]);

    // decided there, seen here: the agent itself kept naming the tab grasp as the cause, so the arc is dashed
    // (inferred), as on the rest of the page; it runs from the ✕ back across the switch to the ◆
    const marks = svg("g", { class: "marks" }, tab);
    const s = [seen[0] - 4, T + seen[1] - 8], e = [cause[0] + 4, T + cause[1] - 6], peak = T + 14 * k;
    const c = [(s[0] + e[0]) / 2, 2 * peak - (s[1] + e[1]) / 2];
    svg("path", { class: "blame-arc drawn", d: `M${s} Q${c} ${e}`, "stroke-dasharray": "4 3", "data-style": "inferred",
      "marker-end": "url(#arc-head)" }, marks);
    arcLines.forEach((l, i) => svg("text", { class: "arc-label", x: mx, y: 12 + i * 15, "text-anchor": "middle", text: l }, marks));
    Base.mark(marks, "m-cause", cause[0], T + cause[1], { size: 12, cls: "mark-cause", title: "decided before the switch: pinch the tab" });
    Base.mark(marks, "m-seen", seen[0], T + seen[1], { size: 13, cls: "mark-seen", title: "misses the tab" });
  });

  /* ---------------------------------------------------------------- lock-in 2: Gear Meshing's camera (schematic) */
  const pixels = $("#f6-pixels", root), camOut = $("#f6-cam-readout", root);
  // lit cells per view, as [row, first col, last col]: 3 raised pixels from the front, 18 from overhead (the paper's
  // counts; the shapes are schematic)
  const LIT = { front: [[5, 4, 6]], overhead: [[1, 5, 6], [2, 4, 7], [3, 3, 8], [4, 4, 7], [5, 5, 6]] };
  const COLS = 12, ROWS = 8;
  const plate = (view, r) => view === "overhead" || r >= 6;
  const lit = (view, r, c) => LIT[view].some(([lr, a, b]) => lr === r && c >= a && c <= b);
  let view = "front";
  const setView = (v) => {
    view = v;
    pixels.dataset.view = v;
    for (const px of pixels.querySelectorAll(".pxgrid .px")) {
      const r = +px.dataset.r, c = +px.dataset.c;
      px.classList.toggle("lit", lit(v, r, c));
      px.classList.toggle("plate", plate(v, r) && !lit(v, r, c));
    }
    const n = LIT[v].reduce((s, [, a, b]) => s + b - a + 1, 0);
    pixels.setAttribute("aria-label", `Schematic depth-pixel grid around one peg, seen by the ${v} camera: ${n} lit cells`);
    if (v === "front") say(camOut, ["Front, the camera the inherited policy kept: the short pegs are often merged with the plate or missed entirely."]);
    else say(camOut, ["Overhead, the camera the perception-only run used: each peg covers about ", num("18", SRC), " depth pixels."]);
  };
  Base.mount(pixels, (w) => {
    pixels.replaceChildren();
    const wide = w >= 440;
    const c = wide ? 18 : w < 300 ? 12 : 14, vw = wide ? 132 : 96, gap = wide ? 28 : 20, top = 22;
    const ox = Math.max(0, (w - (vw + gap + COLS * c)) / 2), gx = ox + vw + gap;   // the side view and grid, centred
    const H = top + ROWS * c + 34;
    frame(pixels, w, H);
    svg("text", { class: "geo-label", x: w, y: 11, "text-anchor": "end", text: "schematic, pixel counts from the paper" }, pixels);
    // side view: where each camera looks from
    const side = svg("g", { class: "side", transform: `translate(${ox},0)` }, pixels), py = top + ROWS * c - 22;
    svg("rect", { class: "plate-side", x: 2, y: py + 8, width: vw - 4, height: 8, rx: 1.5 }, side);
    svg("rect", { class: "peg", x: vw / 2 - 3, y: py - 2, width: 6, height: 10, rx: 1 }, side);
    const cams = { front: [[2, py - 18], [24, py - 9]], overhead: [[vw / 2 - 10, top - 2], [vw / 2, top + 20]] };
    for (const [name, [[ix, iy], [rx, ry]]] of Object.entries(cams)) {
      const g = svg("g", { class: "cam", "data-cam": name }, side);
      svg("line", { class: "ray", x1: rx, y1: ry, x2: vw / 2, y2: py - 3 }, g);
      icon(g, "i-camera", ix, iy, 20, "ico");
    }
    svg("text", { class: "geo-label", x: vw / 2, y: top + ROWS * c + 16, "text-anchor": "middle", text: "side view" }, side);
    const grid = svg("g", { class: "pxgrid" }, pixels);
    for (let r = 0; r < ROWS; r++) {
      for (let col = 0; col < COLS; col++)
        svg("rect", { class: "px", "data-r": r, "data-c": col, x: gx + col * c + 0.5, y: top + r * c + 0.5, width: c - 1, height: c - 1, rx: 1.5 }, grid);
    }
    const ly = top + ROWS * c + 16;
    svg("rect", { class: "px lit", x: gx, y: ly - 9, width: 10, height: 10, rx: 1.5 }, pixels);
    svg("text", { class: "px-key", x: gx + 15, y: ly, text: "peg, above the plate" }, pixels);
    const kx = gx + 15 + tw("peg, above the plate", 11.5) + 14;
    if (kx + 15 + tw("plate", 11.5) <= w) {
      svg("rect", { class: "px plate", x: kx, y: ly - 9, width: 10, height: 10, rx: 1.5 }, pixels);
      svg("text", { class: "px-key", x: kx + 15, y: ly, text: "plate" }, pixels);
    }
    setView(view);
  });
  Base.lens($("#f6-cam", root), (k) => setView(k));

  /* ---------------------------------------------------------------- the drawer: Table 4 as printed */
  Base.paperTable($("#f6-t4", root),
    [["Task", { v: "# Skills", span: 2 }, { v: "Success (%)", span: 2 }], ["", "w/ curr.", "w/o curr.", "w/ curr.", "w/o curr."]],
    cur.rows.map((r) => [r.task, skills(r.skills.curr), skills(r.skills.perc),
      { v: pct(r.success.curr), best: r.success.curr > r.success.perc }, { v: pct(r.success.perc), best: r.success.perc > r.success.curr }]),
    { rowClass: (i) => (cur.rows[i] === overall ? "total" : null) });
});
