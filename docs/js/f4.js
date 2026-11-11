/* Finding 4 (DESIGN_SPEC §3.7): "Four ways to say the same miss." One side view of th_k0's last moment, drawn to
   scale from the recorded poses, with each report format's own words written onto it. The report, the two ladders
   and the study's dot table follow the same lens.

   Every label is cut verbatim from that format's report (f4_case.tabs[i].labels). An annotation is drawn under the
   format that first states it; what a richer format repeats stays in its report, not on the drawing, so each view
   shows what that format adds. Labels that do not fit beside the drawing move into a numbered key under it. */
Base.section("f4", async (root, data) => {
  const B = Base;
  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel, r) => B.$$(sel, r);
  const C = data.f4_case, G = C.scene, T = data.tapes_th, S = data.spatial;
  const track = T.clips.th_k0, E = track.end, N = track.n[track.n.length - 1];
  const ORDER = C.tabs.map((t) => t.key);
  const tab = Object.fromEntries(C.tabs.map((t) => [t.key, t]));
  const has = (name) => ORDER.filter((k) => name in tab[k].labels);
  const word = (k, name) => tab[k].labels[name];
  const anyLabel = (name) => { const k = has(name)[0]; return k ? word(k, name) : ""; };
  const MONO = '500 11px "JetBrains Mono"', NOTE = "500 10.5px Manrope", NOTE_GEO = "500 11.5px Manrope", NOTE_INSET = "500 11px Manrope";
  const LH = { mono: 13.5, note: 12.5 };

  const fig = $("#f4-fig"), svg = $("#f4-scene"), box = $(".scene-box"), keyList = $("#f4-key"), pre = $("#f4-report");
  const tip = B.tooltip(box);
  let lensKey = "parts", anns = [];

  /* ---------------------------------------------------------------- the annotations, one per report fact */
  // the wrench's centre line, at a given height (mm)
  const axisAt = (v) => {
    const [oa, ov] = E.wrench_origin, [aa, av] = E.wrench_axis;
    return [oa + ((v - ov) / av) * aa, v];
  };
  const ITEMS = [
    { key: "outcome", names: ["outcome"], show: ["outcome"],
      lines: [{ t: anyLabel("outcome"), mono: true }, { t: "the only line about the wrench" }] },
    { key: "axes", names: [], show: ["world"] },
    { key: "wrench_at", names: ["wrench_at"],
      lines: [{ t: anyLabel("wrench_at"), mono: true }, { t: "where the report puts the wrench (its body origin), world x, y, z in m" }] },
    { key: "delta", names: ["dist", "delta_world"],
      lines: [{ t: anyLabel("dist"), mono: true }, { t: anyLabel("delta_world"), mono: true }, { t: "distance and world offset (Δ) from the hook's origin to that point" }] },
    { key: "rests", names: ["rests"], lines: [{ t: anyLabel("rests"), mono: true }] },
    { key: "hook_frame", names: ["delta_hook"],
      lines: [{ t: anyLabel("delta_hook"), mono: true }, { t: "the same offset, in the hook's own axes" }] },
    { key: "axis", names: ["axis", "stands"],
      lines: [{ t: anyLabel("axis"), mono: true }, { t: anyLabel("stands"), mono: true }, { t: "the wrench's long axis" }] },
    { key: "outline", names: ["ring_shank"] },
    { key: "along", names: ["along"] },
    { key: "vert", names: ["vert"] },
    { key: "encloses", names: ["encloses"],
      lines: [{ t: `encloses: ${anyLabel("encloses")}`, mono: true }, { t: "the ring is not around the shank" }] },
    { key: "above", names: ["aside", "plane"] },
  ];
  for (const it of ITEMS) {
    it.show = it.show || ORDER.filter((k) => it.names.some((n) => n in tab[k].labels)).slice(0, 1);
    it.fresh = it.show[0];
  }

  /* ---------------------------------------------------------------- drawing helpers */
  const textBlock = (g, lines, x, y, anchor) => {
    const t = B.svg("text", { class: "lab", x, y, "text-anchor": anchor }, g);
    let dy = 0, w = 0, h = 0;
    lines.forEach((ln, i) => {
      const lh = ln.mono ? LH.mono : LH.note;
      B.svg("tspan", { class: ln.mono ? "lab-mono" : "lab-note", x, dy: i ? dy : lh - 3.5, text: ln.t }, t);
      dy = lh;
      w = Math.max(w, B.textWidth(ln.t, ln.mono ? MONO : NOTE));
      h += lh;
    });
    return { t, w, h };
  };
  const arrowTo = (g, x1, y1, x2, y2, cls) =>
    B.svg("line", { class: cls, x1, y1, x2, y2, "marker-end": `url(#f4-head-${/cause/.test(cls) ? "cause" : "ink"})` }, g);
  // a frame's three axes at (ox, oy): in-plane ones as arrows, the one along the line of sight as ⊙ (toward you) or ⊗
  const axesGlyph = (g, ox, oy, axes, len, cls) => {
    const flat = Object.entries(axes).filter(([, [a, v]]) => Math.hypot(a, v) > 0.5);
    const deep = Object.entries(axes).filter(([, [a, v]]) => Math.hypot(a, v) <= 0.5);
    const gap = deep.length ? 5.5 : 0;   // arrows leave the ⊙/⊗ of the axis along the line of sight clear
    for (const [name, [a, v]] of flat) {
      const ux = -a, uy = -v, ex = ox + ux * len, ey = oy + uy * len;
      B.svg("line", { class: "axis-halo", x1: ox + ux * gap, y1: oy + uy * gap, x2: ex, y2: ey }, g);
      arrowTo(g, ox + ux * gap, oy + uy * gap, ex, ey, cls);
      // a horizontal axis is named under its tip, a vertical one beside it
      const [nx, ny] = Math.abs(ux) > Math.abs(uy) ? [ex + ux * 4, ey + 13] : [ex - 9, ey + uy * 2 + 4];
      B.svg("text", { class: "axis-name", x: nx, y: ny, "text-anchor": "middle", text: name }, g);
    }
    for (const [name, [, , s]] of deep) {
      B.svg("circle", { class: "axis-out", cx: ox, cy: oy, r: 4.5 }, g);
      if (s > 0) B.svg("circle", { class: "axis-dot", cx: ox, cy: oy, r: 1.3 }, g);
      else B.svg("path", { class: "axis-cross", d: `M${ox - 2.6},${oy - 2.6}l5.2,5.2M${ox + 2.6},${oy - 2.6}l-5.2,5.2` }, g);
      B.svg("text", { class: "axis-name", x: ox - 9, y: oy + 14, "text-anchor": "middle", text: name }, g);
    }
  };
  const dim = (g, a, b, exts) => {
    for (const [p, q] of exts || []) B.svg("line", { class: "dim-ext", x1: p[0], y1: p[1], x2: q[0], y2: q[1] }, g);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
    B.svg("line", { class: "dim-line", x1: a[0], y1: a[1], x2: b[0], y2: b[1], pathLength: 1 }, g);
    for (const [px, py] of [a, b]) B.svg("line", { class: "dim-tick", x1: px - nx * 4, y1: py - ny * 4, x2: px + nx * 4, y2: py + ny * 4 }, g);
  };
  const ringAttrs = (cx, cy, n, r) => {
    const ang = Math.hypot(n[0], n[1]) < 1e-3 ? 0 : (Math.atan2(-n[1], -n[0]) * 180) / Math.PI + 90;
    return { cx, cy, rx: r, ry: Math.max(0.8, r * Math.abs(n[2])), transform: `rotate(${ang.toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)})` };
  };
  const hits = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  // a label wraps only at spaces outside brackets: a quoted [x, y, z] or (wrench_1 ✗) stays on one line
  const tokens = (t) => t.match(/(?:[^\s[(]+|\[[^\]]*\]|\([^)]*\))+/g) || [t];

  /* ---------------------------------------------------------------- the scene */
  function draw(w) {
    if (w < 240) return;   // a box not laid out yet; the mount draws again once it has its width
    svg.replaceChildren();
    keyList.replaceChildren();
    const phone = B.isPhone();
    // wide: a column right of the board holds the clip's last frame and, right under it, the format's side panel
    // (world axes, or the view from above); narrow: they sit in the drawing's empty corners
    const side = !phone && w >= 440;
    const right = w - Math.max(0, (w - 600) / 2);   // a wide box (stacked columns) centres the drawing in it
    const h = Math.round(phone ? 340 : Math.max(300, Math.min(416, w * 0.86)));
    const top = 40, bottom = 22, hatch = phone ? 20 : 24;
    const k = (h - top - bottom) / -T.table_vert_mm;
    // the column takes what the labels leave: room left of the wrench for the widest quote that cannot wrap
    const need = Math.max(...ITEMS.flatMap((it) => (it.lines || []).filter((ln) => ln.mono).flatMap((ln) => tokens(ln.t)).map((t) => B.textWidth(t, MONO))));
    const reach = (T.shank.len_mm + Math.max(...G.wrench_outline.map((p) => p[0]))) * k;   // board front to wrench's left
    const sideW = side ? Math.round(Math.min(216, Math.max(168, right - hatch - 12 - reach - 24 - 10 - need))) : 0;
    const wrap = $(".endframe-wrap");
    fig.classList.toggle("side", side);
    wrap.style.right = side ? `${w - right}px` : "";
    wrap.style.width = side ? `${sideW}px` : "";
    const Xb = right - (side ? sideW + 12 : 0) - hatch;     // the board's front, at along = -shank length
    const Xt = Xb - T.shank.len_mm * k, Yt = top;          // the shank's free tip
    const X = (a) => Xt - a * k, Y = (v) => Yt - v * k;
    const P = ([a, v]) => [X(a), Y(v)];
    const Ytable = Y(T.table_vert_mm);
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("height", h);
    svg.style.height = h + "px";
    const sv = svg.getBoundingClientRect(), tb = wrap.getBoundingClientRect();

    const defs = B.svg("defs", {}, svg);
    for (const name of ["ink", "cause"]) {
      const m = B.svg("marker", { id: `f4-head-${name}`, viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse", markerUnits: "userSpaceOnUse" }, defs);
      B.svg("path", { class: `head-${name}`, d: "M0,0.8 L9,5 L0,9.2 z" }, m);
    }

    // fixed geometry: the pegboard standing on the table, the hook's shank, the table, the wrench and its ring
    const base = B.svg("g", { class: "base" }, svg);
    const boardTop = Math.max(0, Y(G.board_vert_mm[1]));
    B.svg("rect", { class: "board-face", x: Xb, y: boardTop, width: hatch, height: Ytable - boardTop }, base);
    B.svg("line", { class: "board", x1: Xb, x2: Xb, y1: boardTop, y2: Ytable }, base);
    B.svg("rect", { class: "table-face", x: 0, y: Ytable, width: Xb + hatch, height: 7 }, base);
    B.svg("line", { class: "table", x1: 0, x2: Xb + hatch, y1: Ytable, y2: Ytable }, base);
    // the goal under every format: the ring around the shank, i.e. its centre within a hole's radius of the axis
    const r = T.shank.r_mm, gr = T.ring.inner_r_mm * k;
    B.svg("rect", { class: "goal-band", x: Xt - 3, y: Yt - gr, width: Xb - Xt + 3, height: 2 * gr, rx: 6 }, base);
    B.svg("rect", { class: "shank", x: Xt, y: Y(r), width: T.shank.len_mm * k, height: 2 * r * k, rx: r * k }, base);
    B.svg("text", { class: "geo-label", x: Xt - 6, y: Yt + 4, "text-anchor": "end", text: "tip" }, base);
    const path = (pts) => "M" + pts.map((p) => P(p).map((v) => v.toFixed(1)).join(",")).join("L") + "Z";
    B.svg("path", { class: "wrench", d: path(G.wrench_outline) + G.wrench_holes.map(path).join(""), "fill-rule": "evenodd" }, base);
    const R = P([E.along, E.vert]), rr = T.ring.inner_r_mm * k;
    B.svg("ellipse", { class: "ring", ...ringAttrs(R[0], R[1], N, rr) }, base);
    const sb = B.svg("g", { class: "geo-scale" }, base), sw = 50 * k, sx = Xb - 10 - sw, sy = h - 6;
    B.svg("line", { x1: sx, x2: sx + sw, y1: sy, y2: sy }, sb);
    for (const x of [sx, sx + sw]) B.svg("line", { x1: x, x2: x, y1: sy - 3, y2: sy + 3 }, sb);
    B.svg("text", { x: sx - 5, y: sy + 3.5, "text-anchor": "end", text: "50 mm" }, sb);

    const wrenchL = Math.min(...G.wrench_outline.map((p) => X(p[0])));
    const wrenchTop = Math.max(...G.wrench_outline.map((p) => p[1]));
    const O = P(E.wrench_origin), H = P(G.hook_origin);
    const axisX = wrenchL - 12, colRight = axisX - 12;
    // a point on the Δ arrow in open air, between the shank and the wrench's top, for its labels
    const onDelta = (v) => [H[0] + (O[0] - H[0]) * ((Y(v) - H[1]) / (O[1] - H[1])), Y(v)];
    const deltaAt = onDelta((G.hook_origin[1] + wrenchTop) / 2);

    // the side panels' slot: right under the thumbnail when it has a column, else the drawing's bottom-left corner;
    // column labels keep clear of the thumbnail and of the goal's label
    const slot = (ih) => (side ? [right - sideW, tb.bottom - sv.top + 12] : [2, Ytable - 10 - ih]);
    const obstacles = { all: [] };
    const thumb = side ? null : [0, 0, tb.right - sv.left + 6, tb.bottom - sv.top + 6];
    if (thumb) obstacles.all.push(thumb);
    const goalWords = "goal: ring around the shank", goalRight = Xt - 6, goalTop = Yt + 12;
    const goalLines = !thumb || goalRight - B.textWidth(goalWords, NOTE_GEO) > thumb[2] ? [goalWords] : ["goal: ring", "around the shank"];
    const goalW = Math.max(...goalLines.map((t) => B.textWidth(t, NOTE_GEO)));
    const gt = B.svg("text", { class: "geo-label", x: goalRight, y: goalTop + 9, "text-anchor": "end" }, base);
    goalLines.forEach((t, i) => B.svg("tspan", { x: goalRight, dy: i ? 13 : 0, text: t }, gt));
    obstacles.all.push([goalRight - goalW - 3, goalTop - 3, goalRight + 3, goalTop + goalLines.length * 13 + 2]);

    const layer = {};
    anns = ITEMS.map((it) => {
      const g = B.svg("g", { class: "ann", "data-key": it.key, "data-show": it.show.join(" "), "data-names": it.names.join(" ") }, svg);
      layer[it.key] = { it, g, labels: [] };
      return g;
    });
    const L = (key) => layer[key].g;
    const column = (key, anchor, preferY) => layer[key].labels.push({ lines: layer[key].it.lines, anchor, preferY });
    const block = (lens, rect) => (obstacles[lens] = obstacles[lens] || []).push(rect);
    const fixed = (key, lines, x, y, anchor) => {
      const b = textBlock(L(key), lines, x, y, anchor);
      const x0 = anchor === "end" ? x - b.w : anchor === "middle" ? x - b.w / 2 : x;
      block(layer[key].it.fresh, [x0 - 3, y - 2, x0 + b.w + 3, y + b.h + 2]);
    };
    const panel = (g, title, ih, pw) => {
      const [px, py] = slot(ih);
      B.svg("rect", { class: "inset", x: px, y: py, width: pw, height: ih, rx: 8 }, g);
      B.svg("text", { class: "lab-note", x: px + 8, y: py + 14, text: title }, g);
      if (!side) block(layer[g.dataset.key].it.fresh, [px, py, px + pw, py + ih]);
      return [px, py];
    };
    const label = (g, text, x, y, anchor) => B.svg("text", { class: "geo-label", x, y, "text-anchor": anchor || "start", text }, g);

    // Outcome only: one ✕ on the wrench, nothing else
    const xm = P(axisAt((E.wrench_origin[1] + E.vert) / 2));
    B.mark(L("outcome"), "m-seen", xm[0], xm[1], { size: 15, cls: "mark-seen" });
    column("outcome", [xm[0] - 9, xm[1]]);

    // World frame: world axes, the body origin's coordinates, its distance from the hook's origin, the table contact
    const [wx, wy] = panel(L("axes"), "world axes", 74, side ? sideW : 84);
    axesGlyph(L("axes"), wx + 30, wy + 50, G.world_axes, 24, "axis-ink");
    B.svg("circle", { class: "centre-dot", cx: O[0], cy: O[1], r: 3.6 }, L("wrench_at"));
    column("wrench_at", [O[0] - 4, O[1]]);
    arrowTo(L("delta"), H[0], H[1], O[0], O[1] - 5, "delta");
    B.svg("circle", { class: "origin-dot", cx: H[0], cy: H[1], r: 2.6 }, L("delta"));
    column("delta", deltaAt);
    const foot = G.wrench_outline.filter((p) => Math.abs(Y(p[1]) - Ytable) < 1.5).map((p) => X(p[0]));
    if (foot.length) B.svg("line", { class: "contact", x1: Math.min(...foot), x2: Math.max(...foot), y1: Ytable - 1, y2: Ytable - 1 }, L("rests"));
    column("rests", [Math.min(...foot, wrenchL), Ytable - 2], Ytable - 22);

    // Object frames: the hook's own axes at its origin, the offset in them, the wrench's long axis
    arrowTo(L("hook_frame"), H[0], H[1], O[0], O[1] - 5, "delta cause");
    axesGlyph(L("hook_frame"), H[0], H[1], G.hook_axes, 26, "axis-cause");
    column("hook_frame", deltaAt);
    const yTop = Y(wrenchTop) - 16;
    arrowTo(L("axis"), axisX, O[1], axisX, yTop, "long-axis");
    B.svg("line", { class: "dim-ext", x1: axisX - 4, x2: O[0], y1: O[1], y2: O[1] }, L("axis"));
    column("axis", [axisX - 4, yTop + 10]);

    // + Part annotations: ring and shank outlined, the ring's offset from the tip as dimensions, enclosure
    B.svg("ellipse", { class: "part", ...ringAttrs(R[0], R[1], N, rr + 2.2) }, L("outline"));
    B.svg("rect", { class: "part", x: Xt - 2, y: Y(r) - 2, width: T.shank.len_mm * k + 2, height: 2 * r * k + 4, rx: r * k + 2 }, L("outline"));
    const dA = Y(r) - 12;
    dim(L("along"), [Xt, dA], [R[0], dA], [[[Xt, Y(r) - 3], [Xt, dA - 4]], [[R[0], Y(r) - 3], [R[0], dA - 4]]]);
    fixed("along", [{ t: anyLabel("along"), mono: true }], Math.min((Xt + R[0]) / 2 + 30, Xb - 6), dA - 19, "end");
    dim(L("vert"), [R[0], Yt], [R[0], R[1]]);
    fixed("vert", [{ t: anyLabel("vert"), mono: true }], R[0] - 9, (Yt + Math.min(R[1], Y(wrenchTop))) / 2 - 7, "end");
    column("encloses", [R[0] - rr - 3, R[1]]);

    // + Part annotations, seen from above and to scale: the ring beside the shank, edge-on, its axis 85° off the
    // shank's. The shank's axis runs dashed through the ring, so the angle sits between two named lines.
    const A = L("above");
    const aw = side ? sideW : Math.round(Math.min(252, wrenchL - 16));
    // along: room left of the tip for the offset's dimension and its label (two lines if need be), then the board
    const aside = anyLabel("aside"), cut = aside.lastIndexOf(" ");
    const halves = [aside.slice(0, cut), aside.slice(cut + 1)], lw = Math.max(...halves.map((t) => B.textWidth(t, MONO)));
    const a0 = Math.max(26, (6 * (aw - 16) + (T.shank.len_mm + 6) * (lw + 3)) / (aw - 19 - lw));
    const ki = (aw - 16) / (a0 + T.shank.len_mm + 6);
    const yS = 46, arrow = 28, yR = yS + E.aside * ki;            // from the panel's top: the shank's axis, the ring
    const rowA = yR + arrow + 14, rowB = rowA + 18, rowC = rowB + 16, ah = Math.round(rowC + 10);
    const [px, py] = panel(A, "seen from above", ah, aw);
    const tx = (a) => px + 8 + (a0 - a) * ki, ty = (s) => py + yS + s * ki;   // aside is down: you look down
    const bx = tx(-T.shank.len_mm), x0 = tx(0);
    B.svg("rect", { class: "board-face", x: bx, y: py + 24, width: 6, height: ah - 32 }, A);
    B.svg("line", { class: "board", x1: bx, x2: bx, y1: py + 24, y2: py + ah - 8 }, A);
    B.svg("rect", { class: "shank part-line", x: x0, y: ty(-r), width: bx - x0, height: 2 * r * ki, rx: r * ki }, A);
    label(A, "shank", (x0 + bx) / 2, ty(-r) - 6, "middle");
    const c = [tx(E.along), ty(E.aside)];
    const nh = Math.hypot(N[0], N[2]) || 1, na = N[0] / nh, ns = N[2] / nh;
    const half = T.ring.inner_r_mm * ki, ringL = c[0] - Math.abs(ns) * half, ringR = c[0] + Math.abs(ns) * half;
    // the sideways offset, measured from the shank's axis to the ring's centre left of the tip
    const dx = tx(6);
    B.svg("line", { class: "dim-ext", x1: dx - 4, x2: x0, y1: ty(0), y2: ty(0) }, A);
    B.svg("line", { class: "ref-line", x1: dx - 4, x2: bx, y1: c[1], y2: c[1] }, A);
    dim(A, [dx, ty(0)], [dx, c[1]]);
    const fits = B.textWidth(aside, MONO) <= dx - 5 - (px + 4);
    const words = fits ? [aside] : halves;
    textBlock(A, words.map((t) => ({ t, mono: true })), dx - 5, (ty(0) + c[1]) / 2 - (words.length * LH.mono) / 2 - 1, "end");
    B.svg("line", { class: "ring-edge", x1: c[0] + ns * half, y1: c[1] + na * half, x2: c[0] - ns * half, y2: c[1] - na * half }, A);
    // the ring's axis, flipped to point away from the shank; the angle is read against the shank's axis
    const sgn = ns >= 0 ? 1 : -1, ux = -na * sgn, uy = ns * sgn, ref = ux >= 0 ? 0 : Math.PI;
    const end = [c[0] + ux * arrow, c[1] + uy * arrow];
    arrowTo(A, c[0], c[1], end[0], end[1], "normal cause");
    const ar = 14, a2 = Math.atan2(uy, ux);
    const sweep = ((a2 - ref + 2 * Math.PI) % (2 * Math.PI)) < Math.PI ? 1 : 0;
    B.svg("path", { class: "angle", d: `M${c[0]},${c[1]} L${c[0] + ar * Math.cos(ref)},${c[1] + ar * Math.sin(ref)} A${ar},${ar} 0 0 ${sweep} ${c[0] + ar * Math.cos(a2)},${c[1] + ar * Math.sin(a2)} Z` }, A);
    const mid = Math.atan2(Math.sin(ref) + Math.sin(a2), Math.cos(ref) + Math.cos(a2));
    B.svg("text", { class: "lab-mono", x: c[0] + 22 * Math.cos(mid) + 1, y: c[1] + 22 * Math.sin(mid) + 5, text: anyLabel("plane") }, A);
    // the three names, in rows under the drawing, each with a leader to its line
    // the arrow's name sits under its head, clear of the leader rising to the ring's near end
    label(A, "ring's axis", Math.max(end[0], ringL + 4 + B.textWidth("ring's axis", NOTE_INSET) / 2), py + rowA, "middle");
    label(A, "ring, seen edge-on", px + 8, py + rowB);
    B.svg("polyline", { class: "leader", points: `${ringL - 2},${py + rowB - 11} ${ringL - 2},${c[1] + 9} ${ringL + 5},${c[1] + 2}` }, A);
    const xc = (ringR + bx) / 2;
    label(A, "parallel to the shank", bx - 8, py + rowC, "end");
    B.svg("line", { class: "leader", x1: xc, x2: xc, y1: py + rowC - 11, y2: c[1] + 2 }, A);

    placeColumns(colRight, h - 4);
    setLens(lensKey, false);

    function placeColumns(right, floor) {
      let n = 0;
      for (const lens of ORDER) {
        const blocks = Object.values(layer).filter((l) => l.it.fresh === lens).flatMap((l) => l.labels.map((b) => ({ ...b, l })));
        const width = (ln) => B.textWidth(ln.t, ln.mono ? MONO : NOTE);
        const wrap = (ln, maxW) => {
          const out = [];
          for (const word of tokens(ln.t)) {
            const last = out[out.length - 1];
            if (last && width({ ...ln, t: last.t + " " + word }) <= maxW) last.t += " " + word;
            else out.push({ ...ln, t: word });
          }
          return out;
        };
        // labels keep clear of the long-axis arrow wherever it is drawn
        const room = layer.axis.it.show.includes(lens) ? right : right + 12;
        blocks.forEach((b) => {
          b.right = Math.min(room, b.anchor[0] - 10);
          // a line wider than the room left of the drawing wraps into balanced lines (the words stay the report's)
          b.lines = b.lines.flatMap((ln) => {
            if (width(ln) <= b.right - 4) return [ln];
            const n = wrap(ln, b.right - 4).length;
            let lo = 0, hi = b.right - 4;
            while (hi - lo > 2) { const mid = (lo + hi) / 2; if (wrap(ln, mid).length > n) lo = mid; else hi = mid; }
            return wrap(ln, hi);
          });
          b.w = Math.max(...b.lines.map(width));
          b.h = b.lines.reduce((s, ln) => s + (ln.mono ? LH.mono : LH.note), 0);
          b.cy = b.preferY != null ? b.preferY : b.anchor[1];
        });
        blocks.sort((a, b) => a.cy - b.cy);
        const fixedHere = obstacles.all.concat(obstacles[lens] || []);
        let cursor = 4;
        for (const b of blocks) {
          const hit = (y) => fixedHere.find((f) => hits([b.right - b.w - 2, y - 2, b.right + 2, y + b.h + 2], f));
          let y = Math.max(b.cy - b.h / 2, cursor);
          for (let guard = 0, o; guard < 6 && (o = hit(y)); guard++) {
            // step to the nearer free side of what is in the way, keeping below the labels already placed
            const up = o[1] - b.h - 5, down = o[3] + 3;
            y = up >= cursor && !hit(up) && b.cy - (up + b.h / 2) <= down + b.h / 2 - b.cy ? up : down;
          }
          b.y = y;
          b.out = y + b.h > floor || b.right - b.w < 2;
          if (!b.out) cursor = y + b.h + 8;
        }
        for (const b of blocks) {
          const g = b.l.g, [ax, ay] = b.anchor;
          if (!b.out) {
            // a label right beside its anchor needs no leader
            const ly = Math.min(Math.max(ay, b.y + 5), b.y + b.h - 5);
            if (ax - b.right > 14 || Math.abs(ly - ay) > 1) B.svg("polyline", { class: "leader", points: `${b.right + 3},${ly} ${Math.max(b.right + 3, ax - 14)},${ly} ${ax},${ay}` }, g);
            textBlock(g, b.lines, b.right, b.y, "end");
            continue;
          }
          // no room beside the drawing: a numbered badge at the anchor, and the words in the key below
          n += 1;
          const bx = ax - 12, by = ay;
          B.svg("line", { class: "leader", x1: bx + 6, y1: by, x2: ax, y2: ay }, g);
          B.svg("circle", { class: "badge", cx: bx, cy: by, r: 8 }, g);
          B.svg("text", { class: "badge-n", x: bx, y: by + 4, "text-anchor": "middle", text: String(n) }, g);
          const li = B.el("li", { "data-show": lens }, keyList);
          B.el("span", { class: "n", text: String(n) }, li);
          for (const ln of b.lines) B.el(ln.mono ? "code" : "span", { class: ln.mono ? null : "note", text: ln.t }, li);
        }
      }
    }
  }

  /* ---------------------------------------------------------------- the report, linked to the drawing both ways */
  function renderReport(key) {
    const t = tab[key];
    const lines = t.end.length ? t.head.concat(["### At the end of the episode"], t.end) : t.head.slice();
    const off = t.head.length + 1;
    // the outcome format's only news is its verdict, the symptom line (--seen, as the ✕ in the drawing); every other
    // format lights the lines it adds
    const verdict = t.line_labels.findIndex((ls) => ls.includes("outcome"));
    const els = B.report(pre, lines, key === ORDER[0] ? { symptom: verdict } : { lit: t.new.map((i) => i + off) });
    const names = (i) => (i < t.head.length ? t.line_labels[i] : i >= off ? t.line_labels[i - 1] : []);
    els.forEach((ln, i) => {
      ln.dataset.ann = names(i).join(" ");
      ln.addEventListener("pointerenter", () => pulse(names(i)));
      ln.addEventListener("pointerleave", () => pulse([]));
    });
    if (t.end.length) pre.insertBefore(B.el("span", { class: "elide", text: "… where everything started, and every skill's own lines …" }), els[t.head.length]);
    else B.el("b", { text: "Nothing about where anything ended up." }, B.el("span", { class: "elide none" }, pre));
    // a short box (phones) opens on what this format adds, one whole line of context above it
    pre.scrollTop = 0;
    const first = pre.querySelector("mark, .ln.symptom");
    if (!first) return;
    const at = first.getBoundingClientRect().top - pre.getBoundingClientRect().top - pre.clientTop;
    if (at + first.offsetHeight > pre.clientHeight) pre.scrollTop = at - parseFloat(getComputedStyle(first).lineHeight);
  }
  function pulse(names) {
    for (const g of anns) g.classList.toggle("pulse", names.some((n) => g.dataset.names.split(" ").includes(n)));
  }
  function lightLines(names) {
    for (const ln of $$(".ln", pre)) ln.classList.toggle("pulse", !!names.length && names.some((n) => (ln.dataset.ann || "").split(" ").includes(n)));
  }
  const reportLine = (names) => $$(".ln", pre).filter((ln) => names.some((n) => (ln.dataset.ann || "").split(" ").includes(n))).map((ln) => ln.textContent.replace(/^- /, ""));

  /* ---------------------------------------------------------------- the lens and everything it drives */
  const rows = Object.fromEntries(S.rows.map((r) => [r.key, r]));
  // the ladders are the paper's numbers, tagged in the fragment; they must read as Table 3 (spatial.json) does
  const ladders = { "f4-ladder-th": "tool_hanging", "f4-ladder-all": "overall" };
  for (const [id, col] of Object.entries(ladders)) {
    for (const n of $$(`#${id} .n`, root)) {
      const got = n.querySelector(".num").textContent, want = String(rows[n.dataset.key][col]);
      if (got !== want) console.error(`f4: #${id} ${n.dataset.key} reads ${got}, Table 3 says ${want}`);
    }
  }
  const setLadders = (key) => {
    for (const id of Object.keys(ladders)) {
      const ns = $$(`#${id} .n`, root), at = ns.findIndex((n) => n.dataset.key === key);
      ns.forEach((n, i) => { n.classList.toggle("on", i === at); n.classList.toggle("later", i > at); });
    }
  };
  // what each report leaves the agent to derive, shrinking format by format
  const TODO = {
    outcome: "everything: where the wrench, its ring and the hook ended up.",
    world: "where the ring is relative to the shank.",
    frames: "where the ring is: the report gives the wrench's centre and long axis, not its ring.",
    parts: "nothing about the ring and the shank; the report names both.",
  };
  const SAY = {
    outcome: () => `${tab.outcome.label}: the report says the episode failed, "${word("outcome", "outcome")}", and nothing about where the wrench, its ring or the hook ended up.`,
    world: () => `${tab.world.label}: the wrench's body origin at ${word("world", "wrench_at")}, ${word("world", "dist")} from the hook's origin. Where its ring sits relative to the shank is left to the agent.`,
    frames: () => `${tab.frames.label}: the same offset in the hook's own axes, ${word("frames", "delta_hook")}, and the wrench's long axis, ${word("frames", "axis")}: it ${word("frames", "stands")}.`,
    parts: () => `${tab.parts.label}: the ring's centre is ${word("parts", "along")}, ${word("parts", "vert")} and ${word("parts", "aside")} from the shank's tip, its plane ${word("parts", "plane")} off the shank's axis; encloses: ${word("parts", "encloses")}.`,
  };
  let dots = null;
  function setLens(key, animate) {
    lensKey = key;
    svg.dataset.lens = key;
    B.applyFog(svg, key);
    B.applyFog(keyList, key);
    for (const g of anns) {
      const shown = !g.hasAttribute("data-fog");
      g.classList.remove("enter", "pulse");
      g.setAttribute("tabindex", shown && g.dataset.names ? "0" : "-1");
      if (animate && shown && !B.reduced) { void g.getBoundingClientRect(); g.classList.add("enter"); }
    }
    keyList.hidden = !$$("li:not([data-fog])", keyList).length;
    renderReport(key);
    $("#f4-todo-what").textContent = TODO[key];
    $("#f4-todo").classList.toggle("plain", key === "parts");
    setLadders(key);
    if (dots) dots.select(key);
    $("#f4-readout").textContent = SAY[key]();
  }
  const lens = B.lens($("#f4-lens"), (key) => setLens(key, true));

  B.mount(svg, draw);
  // an annotation under the pointer, or in focus, lights its report lines; in focus it also shows them in a tooltip
  const annOf = (e) => (e.target.closest && e.target.closest(".ann")) || null;
  const namesOf = (a) => a.dataset.names.split(" ").filter(Boolean);
  svg.addEventListener("pointerover", (e) => { const a = annOf(e); if (a) { lightLines(namesOf(a)); a.classList.add("pulse"); } });
  svg.addEventListener("pointerout", (e) => {
    const a = annOf(e);
    if (a && !(e.relatedTarget && a.contains(e.relatedTarget))) { lightLines([]); a.classList.remove("pulse"); }
  });
  svg.addEventListener("focusin", (e) => {
    const a = annOf(e);
    if (!a) return;
    lightLines(namesOf(a));
    const r = a.getBoundingClientRect(), b = box.getBoundingClientRect();
    tip.show(r.left - b.left + r.width / 2, r.top - b.top, tab[lensKey].label, reportLine(namesOf(a)).map((text) => ({ text })), r.bottom - b.top);
  });
  svg.addEventListener("focusout", () => { lightLines([]); tip.hide(); });

  /* ---------------------------------------------------------------- the study: a dot table, Table 3 */
  const COLS = [["overall", "Overall"], ["tool_hanging", "Tool Hanging"], ["sharps_disposal", "Syringe Packing"],
    ["gear_mesh", "Gear Meshing"], ["usbc_insert", "USB-C Insertion"], ["cable_route", "Cable Routing"]];
  const RAMP = { outcome: "ctx", world: "o1", frames: "o2", parts: "o3" };
  const SHORT = { outcome: "Outcome", world: "World", frames: "Frames", parts: "+ Parts" };
  dots = dotTable($("#f4-table"), $(".dots-box"));
  function dotTable(el, holder) {
    const dtip = B.tooltip(holder);
    let groups = {};
    const draw = (w) => {
      if (w < 240) return;   // a box not laid out yet; the mount draws again once it has its width
      el.replaceChildren();
      groups = {};
      const flip = w < 520;   // phone: tasks down the side, formats across
      const down = flip ? COLS : ORDER.map((k) => [k, tab[k].label]);
      const across = flip ? ORDER.map((k) => [k, SHORT[k]]) : COLS;
      const labW = flip ? 104 : 136, headH = flip ? 24 : 36, rowH = flip ? 40 : 46;
      const colW = (w - labW) / across.length;
      const rmax = Math.min(colW * 0.24, rowH / 2 - 5, 15);
      const h = headH + rowH * down.length + 4;
      el.setAttribute("viewBox", `0 0 ${w} ${h}`);
      el.setAttribute("height", h);
      el.style.height = h + "px";
      const fmt = (d, a) => (flip ? [a, d] : [d, a]);   // → [format key, task key]
      const bands = B.svg("g", { class: "bands" }, el);
      // a selected format is a row on desktop, a column on a phone
      for (const fk of ORDER) {
        const i = (flip ? across : down).findIndex(([k]) => k === fk);
        const rect = flip ? { x: labW + i * colW + 2, y: 2, width: colW - 4, height: h - 4 } : { x: 0, y: headH + i * rowH + 3, width: w, height: rowH - 6 };
        groups[fk] = { band: B.svg("rect", { class: "band", rx: 8, ...rect }, bands), cells: [] };
      }
      across.forEach(([key, text], j) => {
        const cx = labW + j * colW + colW / 2;
        const lines = flip ? [text] : text.split(" ");
        lines.forEach((t, li) => B.svg("text", { class: "head" + (key === "overall" ? " overall" : ""), "data-key": flip ? key : null, x: flip ? cx : labW + j * colW + 6, y: headH - 8 - (lines.length - 1 - li) * 13, "text-anchor": flip ? "middle" : "start", text: t }, el));
      });
      if (!flip) B.svg("line", { class: "split", x1: labW + colW, x2: labW + colW, y1: 4, y2: h - 4 }, el);
      else B.svg("line", { class: "split", x1: 4, x2: w - 4, y1: headH + rowH, y2: headH + rowH }, el);
      down.forEach(([dk, dtext], i) => {
        const y = headH + i * rowH + rowH / 2;
        const words = flip ? dtext.split(" ") : [dtext];
        words.forEach((t, li) => B.svg("text", { class: "rowlab" + (dk === "overall" ? " overall" : ""), "data-key": flip ? null : dk, x: 8, y: y + 4 - (words.length - 1) * 6.5 + li * 13, text: t }, el));
        across.forEach(([ak], j) => {
          const [fk, task] = fmt(dk, ak);
          const v = rows[fk][task];
          // dot and numeral as one block: centred under a phone's column head, after a desktop's left-set one
          const x = labW + j * colW + (flip ? (colW - 2 * rmax - 21) / 2 + rmax : rmax + 8);
          const cell = B.svg("g", { class: "cell", "data-format": fk }, el);
          const rad = v > 0 ? Math.max(2.5, rmax * Math.sqrt(v / 100)) : 2.5;
          B.svg("circle", { class: "dot" + (v > 0 ? "" : " zero"), cx: x, cy: y, r: rad, style: v > 0 ? `fill:var(--${RAMP[fk]})` : null }, cell);
          B.svg("text", { class: "val", x: x + rmax + 5, y: y + 5, text: String(v) }, cell);
          const hit = B.svg("rect", { class: "hit", x: labW + j * colW, y: y - rowH / 2, width: colW, height: rowH, tabindex: -1 }, cell);
          const taskName = COLS.find(([k]) => k === task)[1];
          dtip.bind(hit, () => ({ title: taskName, rows: [{ text: `${tab[fk].label}: ${v}% held-out success`, color: `var(--${RAMP[fk]})` }] }));
          hit.addEventListener("click", () => lens.set(fk));
          groups[fk].cells.push(cell);
        });
      });
      paint();
    };
    let sel = lensKey;
    const paint = () => {
      for (const [k, g] of Object.entries(groups)) {
        g.band.classList.toggle("on", k === sel);
        g.cells.forEach((c) => c.classList.toggle("on", k === sel));
      }
      for (const t of B.$$(".rowlab[data-key], .head[data-key]", el)) t.classList.toggle("on", t.dataset.key === sel);
    };
    B.mount(el, draw);
    return { select(k) { sel = k; paint(); } };
  }

  const srHead = B.el("tr", {}, B.el("thead", {}, $("#f4-sr")));
  ["Format"].concat(COLS.map((c) => c[1])).forEach((t) => B.el("th", { text: t }, srHead));
  const srBody = B.el("tbody", {}, $("#f4-sr"));
  for (const k of ORDER) {
    const tr = B.el("tr", {}, srBody);
    B.el("th", { text: tab[k].label }, tr);
    for (const [c] of COLS) B.el("td", { text: `${rows[k][c]}%` }, tr);
  }
  B.paperTable($("#f4-t3"), [["Spatial representation"].concat(COLS.map((c) => c[1]))], S.rows.map((r) => [r.label].concat(COLS.map(([c]) => r[c]))));
  B.loopGlyph($(".fhead .loopglyph"), "space");
  setLens(lens.value, false);
});
