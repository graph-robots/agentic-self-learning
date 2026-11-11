/* Code (DESIGN_SPEC §3.11): the study's feedback conditions as four switches over the release's example config.
   The card shows what the release's loader would merge: config.yaml's feedback: and agent: blocks with each
   overlay's values written in, the overlay file named with its own comment, and the command that runs it. Two
   switches away from the reference have no overlay file of their own, so the run line stays on config.yaml.
   Each switch keeps config.yaml's own value marked "reference", and under the outcome-only form the switches that
   change nothing in the report (code_configs' "inert") are hatched. */
Base.section("code", async (root, data) => {
  const { $, $$, el } = Base;
  const cfg = data.code_configs;
  const dir = cfg.base.path.replace(/\/[^/]+$/, "");
  const fmt = (v) => (Array.isArray(v) ? `[${v.join(", ")}]` : String(v));

  // config.yaml's lines; a value line carries its dotted path ("feedback.granularity")
  let block = null;
  const baseLines = cfg.base.yaml.split("\n").map((text) => {
    const top = /^(\w+):\s*$/.exec(text);
    if (top) block = top[1];
    const kv = /^(\s+)(\w+): (.*)$/.exec(text);
    return kv ? { text, path: `${block}.${kv[2]}`, indent: kv[1], key: kv[2], value: kv[3] } : { text };
  });
  const reference = Object.fromEntries(baseLines.filter((l) => l.path).map((l) => [l.path, l.value]));
  const overlayFor = (path, key) => cfg.overlays.find((o) => path in o.set && fmt(o.set[path]) === key);
  // the overlay a switch has picked; none while it sits at the reference
  const overlayOf = (s) => (s.lens.value === reference[s.path] ? null : overlayFor(s.path, s.lens.value));

  const cfgPre = $("#code-cfg", root), quick = $("#code-quick", root);
  const files = $("#code-overlay", root), note = $("#code-note", root), why = $(".code-why", root);
  // each switch announces its own value and file; the card shows every file in play
  const switches = $$(".lens[data-path]", root).map((group) => {
    const path = group.dataset.path;
    for (const b of $$("button", group)) {
      if (b.dataset.key !== reference[path] && !overlayFor(path, b.dataset.key))
        throw new Error(`code: no overlay sets ${path} to ${b.dataset.key}`);
    }
    const row = group.parentElement;
    const sw = { path, row, readout: $("[data-readout]", row), lens: Base.lens(group, () => render(true)) };
    // pointing at a switch outlines the lines it writes
    row.addEventListener("pointerenter", () => link(sw));
    row.addEventListener("focusin", () => link(sw));
    row.addEventListener("pointerleave", () => link(null));
    row.addEventListener("focusout", () => link(null));
    return sw;
  });
  // the Agent sublabels name the model each choice runs, read off the files so they cannot drift from them
  const agent = switches.find((s) => s.path === "agent.kind");
  for (const b of agent.lens.buttons) {
    const o = overlayFor(agent.path, b.dataset.key);
    const model = (o && o.set["agent.model"]) || reference["agent.model"];
    if (!cfg.model_names[model]) throw new Error(`code: no paper name for ${model}`);
    $("span", b).append(` · ${cfg.model_names[model]}`);
  }
  for (const s of switches) {
    const refs = el("div", { class: "code-refs", "aria-hidden": "true" });
    for (const b of s.lens.buttons) {
      const ref = b.dataset.key === reference[s.path];
      el("span", { text: ref ? "reference" : "" }, refs);
      if (ref) el("span", { class: "sr-only", text: " (the paper's reference)" }, b);
    }
    $(".lens", s.row).after(refs);
  }
  let linked = null;
  function link(sw) {
    linked = sw;
    const o = sw && overlayOf(sw);
    const paths = sw ? [sw.path, ...Object.keys((o && o.set) || {})] : [];
    $$(".ln", cfgPre).forEach((n) => n.classList.toggle("linked", paths.includes(n.dataset.k)));
  }
  $$("svg.loopglyph[data-knob]", root).forEach((s) => Base.loopGlyph(s, s.dataset.knob));
  Base.copy($("#code-copy", root), quick);

  function merged(overlays) {
    const set = Object.assign({}, ...overlays.map((o) => o.set));
    const lines = baseLines.map((l) => (l.path && l.path in set
      ? { ...l, text: `${l.indent}${l.key}: ${fmt(set[l.path])}`, set: true } : l));
    // a key config.yaml does not write (codex.yaml's reasoning_effort) goes at the end of its block
    for (const [path, v] of Object.entries(set)) {
      if (path in reference) continue;
      const [b, key] = path.split(".");
      const at = lines.map((l) => !!l.path && l.path.startsWith(b + ".")).lastIndexOf(true);
      lines.splice(at + 1, 0, { text: `${lines[at].indent}${key}: ${fmt(v)}`, path, set: true });
    }
    return lines;
  }

  // Lines are keyed by path (or text), so a re-render flashes exactly the lines whose text changed.
  function paint(pre, lines, flash, yamlKeys) {
    const before = new Map($$(".ln", pre).map((n) => [n.dataset.k, n.textContent]));
    pre.replaceChildren();
    for (const l of lines) {
      const n = el("span", { class: "ln" + (l.set ? " set" : ""), dataset: { k: l.path || "=" + l.text } }, pre);
      const kv = yamlKeys && /^(\s*)(\w+:)(.*)$/.exec(l.text);
      if (kv) {
        n.append(kv[1]);
        el("span", { class: "y-key", text: kv[2] }, n);
        n.append(kv[3]);
      } else {
        // a break opportunity after each slash of a URL or path (not between the two of "//"), for the phone's wrap
        l.text.split(/(?<=\/)(?!\/)/).forEach((part, i) => { if (i) el("wbr", {}, n); n.append(part); });
      }
      n.append("\n");
      if (flash && before.get(n.dataset.k) !== n.textContent) {
        n.classList.add("flash");
        setTimeout(() => n.classList.remove("flash"), 200);
      }
    }
  }

  function render(flash) {
    const overlays = switches.map(overlayOf).filter(Boolean);
    paint(cfgPre, merged(overlays), flash, true);
    link(linked);

    const inert = Object.entries(cfg.inert.when).every(([p, v]) => switches.find((s) => s.path === p).lens.value === fmt(v));
    why.hidden = !inert;
    for (const s of switches) {
      const o = overlayOf(s);
      s.row.toggleAttribute("data-fog", inert && cfg.inert.paths.includes(s.path));
      s.readout.textContent = `${s.path}: ${s.lens.value}, `
        + (o ? `from ${o.file}: ${o.comment}` : `config.yaml, ${cfg.base.comment}`)
        + (inert && s.path in cfg.inert.when ? ` ${why.textContent}` : "");
    }
    const entries = overlays.length ? overlays.map((o) => [o.file, o.comment]) : [["config.yaml", cfg.base.comment]];
    files.replaceChildren(...entries.map(([file, comment]) => {
      const item = el("span", { class: "code-entry" });
      el("span", { class: "code-path", text: file }, item);
      el("span", { class: "c", text: "# " + comment }, item);
      return item;
    }));

    const one = overlays.length === 1;
    paint(quick, cfg.quickstart.map((text, i) => (text.includes(cfg.base.path)
      ? { text: one ? text.replace(cfg.base.path, `${dir}/${overlays[0].file}`) : text, path: "run", set: one }
      : { text, path: "=" + i })), flash, false);

    note.hidden = !overlays.length;
    if (one) {
      note.replaceChildren(el("span", { class: "code-swatch", "aria-hidden": "true" }), "Marked lines come from ");
      el("code", { text: overlays[0].file }, note);
      note.append(", the rest from ");
      el("code", { text: "config.yaml" }, note);
      note.append(", which it overlays.");
    } else if (overlays.length) {
      const used = new Set(overlays.flatMap((o) => Object.keys(o.set).map((p) => p.split(".")[0])));
      const blocks = ["feedback", "agent"].filter((b) => used.has(b));
      note.replaceChildren("Combine settings by editing ");
      blocks.forEach((b, i) => {
        if (i) note.append(" and ");
        el("code", { text: b + ":" }, note);
      });
      note.append(" in config.yaml");
    }
  }
  render(false);
});
