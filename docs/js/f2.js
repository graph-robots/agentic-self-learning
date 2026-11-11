/* Finding 2 (Skills): nine first programs drawn as dot fields, library code inside a dashed fence and new code in a
   crescent outside it (DESIGN_SPEC §3.5). Every dot count is round(lines / 20) of the paper's Figure 5 data; no share
   or total is ever printed. */
Base.section("f2", async (root, data) => {
  const { el, svg } = Base;
  Base.loopGlyph(root.querySelector(".fhead .loopglyph"), "skills");

  const CLASSES = [
    { key: "task", text: "expert task skills", color: "var(--o3)" },
    { key: "humlib", text: "general skills the human also used", color: "var(--o2)" },
    { key: "lib", text: "general skills the human did not use", color: "var(--o1)" },
    { key: "new", text: "new code", color: "var(--gen)" },
  ];
  const LINES_PER_DOT = 20;
  const PITCH = 7, DOT = 2.6, PAD = 5;
  // Vogel's sunflower: radius SPREAD·√i at the golden angle; this SPREAD gives the 7 px hex pitch
  const SPREAD = PITCH / Math.sqrt(2 * Math.PI / Math.sqrt(3));
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const THICK = 2.4;   // a crescent row costs this much arc: wider along the fence than away from it
  const KIMI = "Kimi K3";
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  const overall = new Map(data.models.models.map((m) => [m.label, m.success.overall]));
  const humanRow = data.composition.rows.find((r) => r.label === "Human");
  const modelRows = data.composition.rows.filter((r) => r !== humanRow)
    .sort((a, b) => overall.get(a.label)[2] - overall.get(b.label)[2]);   // stable: ties keep the paper's order
  const dotsOf = (r) => Object.fromEntries(CLASSES.map((c) => [c.key, Math.round(r.lines[c.key] / LINES_PER_DOT)]));

  function crescent(count, fence) {
    const r0 = fence + 2.2 + DOT, step = PITCH * Math.sqrt(3) / 2, cand = [];
    for (let j = 0; j < 8; j++) {
      const rj = r0 + j * step;
      for (let k = -40; k <= 40; k++) {
        const arc = (k + (j % 2 ? 0.5 : 0)) * PITCH, th = arc / rj;
        if (Math.abs(th) <= Math.PI * 0.9) cand.push({ x: rj * Math.cos(th), y: rj * Math.sin(th), th, cost: Math.abs(arc) + THICK * j * step });
      }
    }
    cand.sort((a, b) => a.cost - b.cost || a.th - b.th);
    return cand.slice(0, count).map((c) => ({ x: c.x, y: c.y, cls: "new" }));
  }

  // geometry at scale 1, fence centred on the origin; drawn later at the scale the grid allows
  const fields = [humanRow, ...modelRows].map((r) => {
    const n = dotsOf(r), lib = n.task + n.humlib + n.lib, dots = [];
    for (let i = 0; i < lib; i++) {
      const rad = SPREAD * Math.sqrt(i + 0.5), th = i * GOLDEN;
      dots.push({ x: rad * Math.cos(th), y: rad * Math.sin(th), cls: i < n.task ? "task" : i < n.task + n.humlib ? "humlib" : "lib" });
    }
    const fence = SPREAD * Math.sqrt(lib - 0.5) + DOT + 1.8;
    dots.push(...crescent(n.new, fence));
    return { r, n, dots, fence, kimi: r.label === KIMI, human: r === humanRow };
  });
  const ext = { l: 0, r: 0, t: 0, b: 0 };
  for (const f of fields) {
    ext.l = Math.max(ext.l, f.fence, ...f.dots.map((d) => DOT - d.x));
    ext.r = Math.max(ext.r, f.fence, ...f.dots.map((d) => d.x + DOT));
    ext.t = Math.max(ext.t, f.fence, ...f.dots.map((d) => DOT - d.y));
    ext.b = Math.max(ext.b, f.fence, ...f.dots.map((d) => d.y + DOT));
  }
  const W = ext.l + ext.r + 2 * PAD, H = ext.t + ext.b + 2 * PAD;

  const stage = root.querySelector("#f2-stage");
  const box = root.querySelector("#f2-fields");
  const readout = root.querySelector("#f2-readout");
  const callout = root.querySelector("#f2-kimi");
  const tip = Base.tooltip(box);
  const num = (v, cls) => el("span", { class: "num" + (cls ? " " + cls : ""), "data-src": "tables/model_table.tex", text: String(v) });

  const figs = fields.map((f) => {
    const label = f.r.label;
    const fig = el("figure", { class: "f2-field" + (f.human ? " human" : f.kimi ? " kimi" : ""), id: `f2-field-${slug(label)}`, "data-label": label }, box);
    f.svg = svg("svg", { role: "img", "data-min-marks": String(f.dots.length + 1),
      "aria-label": f.human ? "Human: the expert policy, all of it library code; nothing outside the fence"
        : `${label}'s first program: library code inside the fence, new code in a crescent outside it (line counts in the table that follows)` }, fig);
    const cap = el("figcaption", {}, fig);
    const main = el("span", { class: "f2-cap-main" }, cap);
    el("b", { text: f.human ? "Human" : label }, main);
    const nums = el("span", { class: "bignum-s" }, main);
    if (f.human) nums.append(num(data.models.human.overall), el("span", { class: "f2-unit", text: "overall success" }));
    else {
      const [s0, , s2] = overall.get(label);
      nums.append(num(s0, "f2-from"), " → ", num(s2));
    }
    if (f.human) el("span", { class: "f2-note", text: "the expert policy, all library code" }, cap);
    if (f.kimi) el("a", { class: "f2-see", href: "#f2-kimi" }, cap)
      .append(el("span", { class: "long", text: "most unused general skills" }), el("span", { class: "short", text: "see the note" }), " ↓");
    tip.bind(f.svg, () => ({
      title: f.human ? "Human, the expert policy" : `${label}, first program`,
      rows: CLASSES.map((c) => ({ text: `${f.r.lines[c.key]} lines · ${c.text}`, color: c.color }))
        .concat([{ text: f.human ? "one graph per task" : `mean of ${f.r.runs} runs over ${f.r.tasks} tasks` }]),
    }));
    return fig;
  });

  function draw(s) {
    const cx = (PAD + ext.l) * s, cy = (PAD + ext.t) * s;
    for (const f of fields) {
      const g = f.svg;
      g.replaceChildren();
      g.setAttribute("viewBox", `0 0 ${(W * s).toFixed(1)} ${(H * s).toFixed(1)}`);
      g.setAttribute("width", (W * s).toFixed(1));
      g.setAttribute("height", (H * s).toFixed(1));
      // Kimi K3's ring sits on the fence only: the band's inner edge is the ragged edge of the sunflower, so a circle
      // there would cut through dots. Its unused-general dots carry their own --cause outline instead (f2.css).
      if (f.kimi) svg("circle", { class: "f2-band", cx, cy, r: (f.fence * s).toFixed(2) }, g);
      svg("circle", { class: "fence", cx, cy, r: (f.fence * s).toFixed(2) }, g);
      const dots = svg("g", { class: "dots" }, g);
      for (const d of f.dots)
        svg("circle", { class: "dot", "data-cls": d.cls, cx: (cx + d.x * s).toFixed(2), cy: (cy + d.y * s).toFixed(2), r: (DOT * s).toFixed(2) }, dots);
    }
  }
  Base.mount(box, () => {
    const one = figs[1];
    const cs = getComputedStyle(one);
    const room = one.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    draw(Math.max(1, Math.min(Base.isPhone() ? 1.6 : 1.45, room / W)));
  });

  // the Kimi K3 note: its pairs chart, and the ring and the card light up together
  const pairsBox = root.querySelector("#f2-pairs");
  const pairRows = modelRows.slice().sort((a, b) => b.lines.lib - a.lines.lib);
  Base.mount(pairsBox, (w) => {
    pairsBox.replaceChildren();
    const head = "600 11.5px Manrope, sans-serif";
    const labelW = Math.max(...pairRows.map((r) => Base.textWidth(r.label, "800 12.5px Manrope, sans-serif"))) + 14;
    const maxLib = Math.max(...pairRows.map((r) => dotsOf(r).lib)), maxNew = Math.max(...pairRows.map((r) => dotsOf(r).new));
    const room = w - labelW - 18 - 8;   // the longest row stops short of the card's padding
    let p = Math.min(Base.isPhone() ? 8 : 11, room / (maxLib + maxNew));
    // the first column's header may be wider than its dots: wrap it, and never let it push the second column out
    const lines = Base.textWidth("unused general skills", head) <= maxLib * p ? ["unused general skills"] : ["unused general", "skills"];
    const headW = Math.max(...lines.map((t) => Base.textWidth(t, head)));
    p = Math.min(p, (room - headW) / maxNew);
    const x1 = labelW, x2 = labelW + Math.max(maxLib * p, headW) + 18;
    const rowH = Math.round(p + 11), top = 10 + lines.length * 14, h = top + pairRows.length * rowH;
    const g = svg("svg", { viewBox: `0 0 ${w} ${h}`, width: w, height: h, role: "img",
      "aria-label": "Kimi K3 has by far the longest row of general skills the human did not use, and a middling row of new code" }, pairsBox);
    lines.forEach((t, i) => svg("text", { class: "f2-ph", x: x1, y: 12 + i * 14, text: t }, g));
    svg("text", { class: "f2-ph", x: x2, y: 12 + (lines.length - 1) * 14, text: "new code" }, g);
    pairRows.forEach((r, i) => {
      const n = dotsOf(r), y = top + i * rowH + rowH / 2, kimi = r.label === KIMI;
      const row = svg("g", { class: "f2-pair" + (kimi ? " kimi" : "") }, g);
      if (kimi) svg("rect", { class: "f2-pair-hl", x: 0, y: y - rowH / 2, width: w, height: rowH, rx: 5 }, row);
      svg("text", { class: "f2-pl", x: 6, y: y + 4.5, text: r.label }, row);
      for (let k = 0; k < n.lib; k++) svg("circle", { class: "dot", "data-cls": "lib", cx: x1 + k * p + p / 2, cy: y, r: p * 0.39 }, row);
      for (let k = 0; k < n.new; k++) svg("circle", { class: "dot", "data-cls": "new", cx: x2 + k * p + p / 2, cy: y, r: p * 0.39 }, row);
      svg("title", { text: `${r.label}: ${r.lines.lib} lines from general skills the human did not use, ${r.lines.new} lines of new code` }, row);
    });
  });

  const kimiFig = figs[fields.findIndex((f) => f.kimi)];
  const hot = (on) => { kimiFig.classList.toggle("hot", on); callout.classList.toggle("hot", on); };
  for (const node of [kimiFig, callout]) {
    node.addEventListener("pointerenter", () => hot(true));
    node.addEventListener("pointerleave", () => hot(false));
    node.addEventListener("focusin", () => hot(true));
    node.addEventListener("focusout", () => hot(false));
  }

  // the readout says the takeaway; the toggle fades everything the library provided, leaving the crescents
  const byNew = modelRows.slice().sort((a, b) => b.lines.new - a.lines.new).map((r) => r.label);
  const low = modelRows.slice(0, 2).map((r) => r.label), high = modelRows.slice(-3).map((r) => r.label);
  // the takeaway names models by @2 and claims they have the smallest and biggest crescents: say so if the data stops agreeing
  const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  if (!same(low, byNew.slice(-2)) || !same(high, byNew.slice(0, 3))) console.error("f2: the readout's takeaway no longer matches composition.json");
  const names = (xs) => xs.flatMap((x, i) => [i ? (i === xs.length - 1 ? " and " : ", ") : "", el("b", { text: x })]);
  const say = (own) => {
    readout.replaceChildren(...(own
      ? ["Only code the models wrote themselves is left: ", ...names(byNew.slice(0, 3)), " have the biggest crescents, ",
         ...names(byNew.slice(-2)), " the smallest, and the human policy has none."]
      : ["Read down the grid, from the lowest success after feedback to the highest: ", ...names(low),
         " barely step outside the fence, while the three that end highest, ", ...names(high), ", write the biggest crescents."]));
  };
  const own = root.querySelector("#f2-own");
  own.addEventListener("change", () => { stage.dataset.own = String(own.checked); say(own.checked); });
  stage.dataset.own = "false";
  say(false);

  // the drawn numbers, for screen readers
  const table = root.querySelector("#f2-sr");
  el("caption", { text: "Lines per first program by source, and overall success at @0 and @2" }, table);
  const head = el("tr", {}, el("thead", {}, table));
  for (const t of ["Model", "@0", "@2", ...CLASSES.map((c) => c.text)]) el("th", { text: t, scope: "col" }, head);
  const body = el("tbody", {}, table);
  for (const f of fields) {
    const tr = el("tr", {}, body);
    const s = f.human ? ["", data.models.human.overall] : [overall.get(f.r.label)[0], overall.get(f.r.label)[2]];
    for (const v of [f.r.label, ...s, ...CLASSES.map((c) => f.r.lines[c.key])]) el("td", { text: String(v) }, tr);
  }
});
