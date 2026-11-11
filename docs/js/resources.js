/* Resources (DESIGN_SPEC §3.12): one glyph from the page's vocabulary per card, every study clip traced back to its
   run in the released traces, the provenance switch (C13) and the BibTeX copy. The strip groups clips by run, so
   the rounds of one run share one bracket and one id. */
Base.section("resources", async (root, data) => {
  const { $, $$, el, svg, mark } = Base;
  const HF = "https://huggingface.co/datasets/";

  const frame = (s, w, h) => {
    s.setAttribute("viewBox", `0 0 ${w} ${h}`);
    s.setAttribute("width", w);
    s.setAttribute("height", h);
  };
  const GLYPHS = {
    // the paper: a failure seen (✕) traced back to where it was decided (◆)
    paper(s) {
      frame(s, 64, 28);
      svg("path", { class: "blame-arc drawn", d: "M54,13 Q33,-3 13,12", "marker-end": "url(#arc-head)" }, s);
      mark(s, "m-cause", 9, 19, { size: 12, cls: "mark-cause" });
      mark(s, "m-seen", 56, 19, { size: 12, cls: "mark-seen" });
    },
    // the code: the loop itself, write → run → read → edit clockwise, no station singled out. Base.loopGlyph's
    // layout drawn at card size: its open chevrons vanish into the circuit when scaled up, so these heads are solid.
    code(s) {
      frame(s, 44, 44);
      svg("rect", { class: "loop-circuit", x: 7, y: 7, width: 30, height: 30, rx: 6 }, s);
      for (const d of ["M19,3 L25,7 L19,11 Z", "M33,19 L37,25 L41,19 Z", "M25,33 L19,37 L25,41 Z", "M3,25 L7,19 L11,25 Z"])
        svg("path", { class: "loop-head", d }, s);
      for (const [x, y] of [[7, 7], [37, 7], [37, 37], [7, 37]]) svg("circle", { class: "loop-stop", cx: x, cy: y, r: 4.2 }, s);
    },
    // the traces: a round of four failed episodes, an edit, a round of four that succeeded
    traces(s) {
      frame(s, 74, 28);
      for (const [x0, id, cls] of [[7, "m-fail", "mark-seen"], [54, "m-ok", "mark-ok"]])
        for (const dx of [0, 13]) for (const y of [7.5, 20.5]) mark(s, id, x0 + dx, y, { size: 11, cls });
      mark(s, "i-pencil", 37, 14, { size: 13, cls: "mark-cause" });
    },
  };
  for (const s of $$(".res-glyph", root)) GLYPHS[s.dataset.glyph](s);

  // Where to zoom each poster so a 120 px thumbnail shows the outcome: the point of the poster that stays put, as
  // fractions of its width and height, and the zoom. Picked by eye from the posters; a clip not listed shows its
  // whole poster.
  const CROP = {
    th_k0: [0.48, 0.34, 2.2], th_k4: [0.48, 0.34, 2.2],               // the hook, the wrench below it or hung on it
    syr_k0: [0.36, 0.38, 1.9], syr_k2: [0.36, 0.38, 1.9],             // the container and the syringe
    usbc_opus5: [0.6, 0.46, 1.5], usbc_sonnet5: [0.6, 0.46, 1.5],     // the port and the plug
    cable_k0: [0.3, 0.66, 1.5],                                        // the cable and its clips
  };

  // A run id breaks after its condition (<exp>/<arm>/), so every id takes the same two lines; inside the condition
  // it may still break after a slash, never inside a name.
  const runId = (node, text) => {
    const parts = text.split("/");
    const tail = parts.splice(-2).join("/");
    const cond = el("span", { class: "res-id-cond" }, node);
    parts.forEach((part, i) => {
      if (i) el("wbr", {}, cond);
      el("span", { class: "nw", text: part + "/" }, cond);
    });
    el("span", { class: "nw", text: tail }, node);
  };

  const box = $("#resources-clips", root);
  const ids = data.release_ids || {};
  const rel = new Map((ids.clips || []).map((c) => [c.id, c]));
  const runs = new Map();
  for (const c of data.clips.clips) {
    if (!c.dataset_run) continue;   // the code example's clip is not a study run; the note says so
    const key = rel.has(c.id) ? rel.get(c.id).release_run : c.dataset_run;
    if (!runs.has(key)) runs.set(key, []);
    runs.get(key).push(c);
  }
  box.style.setProperty("--groups", runs.size);
  box.style.setProperty("--tiles", [...runs.values()].reduce((n, list) => n + list.length, 0));
  const tip = Base.tooltip(box);
  // Tooltip rows are set in sans; the episode path is quoted text (§0.3), so its row, always the last, goes in mono.
  const tipNode = $(":scope > .tip", box);
  // where else on the page a clip plays: the visible clips outside this section, in page order
  const elsewhere = (id) => $$(`.clip[data-clip="${id}"]`).filter((n) => !root.contains(n) && n.getClientRects().length);
  const railName = (n) => {
    const sec = n.closest("[data-section]");
    return sec ? sec.dataset.rail || (sec.id === "top" ? "the opening" : sec.id) : null;
  };
  // A mouse click goes to the first place the clip plays; a tap shows the tooltip instead, judged by the click's own
  // pointer where the browser reports it (a laptop with a touch screen matches the media query). Enter, or a screen
  // reader's activation, is a click with no pointer (detail 0) and always goes.
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
  const tapped = (e) => e.detail > 0 && (e.pointerType === "touch" || e.pointerType === "pen" || !fine.matches);
  for (const list of runs.values()) {
    const r = rel.get(list[0].id);
    const g = el("div", { class: "res-run", style: `--n:${list.length}` }, box);
    const tiles = el("div", { class: "res-tiles" }, g);
    for (const c of list) {
      const k = "k" + c.iteration;
      const ep = rel.has(c.id) && rel.get(c.id).episode;
      const where = [...new Set(elsewhere(c.id).map(railName).filter(Boolean))];
      const label = `${c.task}, ${c.model}, round ${k}, ${c.outcome === "ok" ? "succeeded" : "failed"}. ${c.note}`;
      const t = el("figure", where.length
        ? { class: "res-tile jump", role: "link", "aria-label": `${label} Go to where it plays: ${where[0]}.` }
        : { class: "res-tile", role: "img", "aria-label": label }, tiles);
      const img = el("img", { src: c.poster, alt: "", loading: "lazy", decoding: "async" }, t);
      if (CROP[c.id]) {
        const [x, y, z] = CROP[c.id];
        img.style.transformOrigin = `${x * 100}% ${y * 100}%`;
        img.style.transform = `scale(${z})`;
      }
      const tag = el("span", { class: "clip-tag", "aria-hidden": "true" }, t);
      el("i", { class: c.outcome === "ok" ? "ok" : "fail" }, tag);
      tag.appendChild(document.createTextNode(k));
      tip.bind(t, () => {
        tipNode.classList.toggle("ep-last", !!ep);
        return { title: `${c.task} · ${c.model} · ${k}`, rows: [
          { text: c.note },
          where.length ? { text: "On this page: " + where.join(" · ") } : null,
          ep ? { text: "Episode, in the run's archive:" } : null,
          ep ? { text: ep } : null,
        ].filter(Boolean) };
      });
      if (!where.length) continue;
      t.addEventListener("click", (e) => {
        if (tapped(e)) return;
        const to = elsewhere(c.id)[0];
        if (!to) return;
        tip.hide();
        to.scrollIntoView({ behavior: Base.reduced ? "auto" : "smooth", block: "center" });
      });
      t.addEventListener("keydown", (e) => { if (e.key === "Enter") t.click(); });
    }
    el("span", { class: "res-bracket", "aria-hidden": "true" }, g);
    const cap = el("p", { class: "res-run-cap" }, g);
    el("b", { text: list[0].task }, cap);
    el("span", { text: list[0].model }, cap);
    if (r) {
      const a = el("a", { class: "res-run-id", target: "_blank", rel: "noopener",
        href: HF + ids.dataset + (r.archive ? "/blob/main/" + r.archive : ""),
        "aria-label": `Run ${r.release_run} in the Agent traces dataset` }, g);
      runId(a, r.release_run);
    }
  }

  // The switch sits at the foot of the page, far from the numbers it tags, so when it turns on the readout carries
  // one of them: Finding 3's first tagged number, cloned with its tag, and a link to it.
  const src = $("#resources-src input", root), readout = $("#resources-src-readout", root);
  const sample = () => {
    const sec = $('[data-section="f3"]');
    const num = sec && $(".num[data-src]", sec);
    if (!num) return null;
    const out = el("span", { class: "res-src-sample" });
    const n = el("b", {}, out);
    n.appendChild(num.cloneNode(true));
    const unit = num.nextElementSibling;
    if (unit && unit.classList.contains("pct")) n.appendChild(unit.cloneNode(true));
    const name = ($(".eyebrow", sec) || {}).textContent;
    el("a", { href: "#" + sec.id, text: "→ " + (name ? name.split("·")[0].trim() : "the finding") }, out);
    return out;
  };
  const paint = () => {
    document.body.classList.toggle("show-src", src.checked);
    if (!src.checked) {
      readout.textContent = "Each number quoted from the paper carries a tag naming its source; the tags are hidden.";
      return;
    }
    const s = sample();
    readout.replaceChildren("Tags shown: each number quoted from the paper names its chapter, or the data file behind its figure"
      + (s ? ", as here: " : "."));
    if (s) readout.append(s);
  };
  src.checked = document.body.classList.contains("show-src");
  src.addEventListener("change", paint);
  paint();

  Base.copy($("#resources-copy", root), $("#resources-bibtex", root));
});
