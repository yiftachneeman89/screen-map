// Screen Map: wires up loading a project, the flow chart, the layout gallery and the details panel.

const $ = (id) => document.getElementById(id);
let app = null;  // { name, res, model, renderer, chart }

function show(section) {
  for (const id of ["landing", "loading", "flowView", "galleryView"]) $(id).hidden = id !== section;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// ---------------------------------------------------------------- loading

async function load(items) {
  show("loading");
  $("loadError").hidden = true;
  $("panel").hidden = true;
  try {
    $("loadingText").textContent = "Reading files…";
    const raw = await readProject(items);
    if (!raw.texts.some((f) => /\/res\/layout/.test("/" + f.path)) && !raw.texts.some((f) => f.path.endsWith("AndroidManifest.xml"))) {
      throw new Error("No Android layouts or manifest found. Pick the project folder (the one that contains app/).");
    }
    $("loadingText").textContent = "Loading images and fonts…";
    const res = await loadResources(raw);
    $("loadingText").textContent = "Reading the code…";
    await new Promise((r) => setTimeout(r, 20));
    const model = new Analyzer(raw, res).run();
    if (!Object.keys(model.screens).length) throw new Error("Couldn't find any activities or fragments in this project.");
    const renderer = new Renderer(res, model);
    app = { name: raw.name, res, model, renderer };
    $("projectName").textContent = raw.name;
    $("tabs").hidden = false;
    $("topActions").hidden = false;
    document.title = `${raw.name} · Screen Map`;
    $("loadingText").textContent = "Drawing screens…";
    // text is measured for ConstraintLayout/RelativeLayout, so the fonts must be there first
    await Promise.all(["400", "500", "700"].map((w) => document.fonts.load(`${w} 16px Roboto`).catch(() => {})));
    await document.fonts.ready;
    showFlow();
  } catch (err) {
    console.error(err);
    show("landing");
    $("loadError").textContent = err.message || String(err);
    $("loadError").hidden = false;
  }
}

function showFlow() {
  setTab("flow");
  show("flowView");
  if (!app.chart) {
    app.chart = new FlowChart($("canvas"), app.model, app.renderer, {
      projectName: app.name,
      onSelect: (id, vid) => (id ? openScreen(id, vid) : closePanel()),
      onZoom: (z) => { $("zoomPct").textContent = Math.round(z * 100) + "%"; },
    });
    app.chart.build();
    $("sharedToggle").hidden = !app.chart.sharedCount;
    $("sharedLabel").textContent = `Nav-bar arrows (${app.chart.sharedCount})`;
    $("sharedCheck").checked = true;
    const s = Object.values(app.model.screens);
    const tapEdges = app.model.edges.filter((e) => !e.auto).length;
    const buttons = s.reduce((n, x) => n + x.handlers.length, 0);
    $("stats").innerHTML = `<span><b>${s.length}</b> screens</span><span><b>${buttons}</b> buttons with code</span><span><b>${tapEdges}</b> taps that open a screen</span>`;
  }
}

function showGallery() {
  setTab("gallery");
  show("galleryView");
  if (!app.galleryBuilt) { buildGallery(); app.galleryBuilt = true; }
}

function setTab(view) {
  for (const b of document.querySelectorAll(".tab-btn")) b.classList.toggle("active", b.dataset.view === view);
}

// ---------------------------------------------------------------- describing what a button does

const NAV_VERB = { activity: "Opens", fragment: "Shows", dialog: "Opens the dialog" };

function screenName(id) {
  const s = app.model.screens[id];
  return s ? (s.dialogOf ? s.layout : s.cls) : id;
}

function phrase(e) {
  const s = app.model.screens[e.to];
  switch (e.type) {
    case "nav": return `${NAV_VERB[s?.kind] || "Opens"} ${screenName(e.to)}`;
    case "back": return { finish: "closes this screen", finishAffinity: "closes the app's screens", onBackPressed: "goes back", popBackStack: "goes back", navigateUp: "goes back", dismiss: "closes the dialog", dismissAllowingStateLoss: "closes the dialog" }[e.how] || "goes back";
    case "toast": return e.text ? `shows the message “${e.text}”` : e.error ? "shows the error message" : "shows a message";
    case "alert": return e.title ? `shows a pop-up “${e.title}”` : "shows a pop-up";
    case "dialog": return `opens the ${e.layout} dialog`;
    case "api":
    case "visibility": return e.text;
    case "call": return `runs ${e.name}`;
    default: return "";
  }
}

// ["if a", "if b", "if it fails"] -> "if a and b, if it fails"
function condText(cond) {
  const list = (cond || []).filter((c, i, a) => a.indexOf(c) === i);
  return list.map((c, i) => (i && /^if /.test(c) && /^if /.test(list[i - 1]) ? c.slice(3) : c)).join(" and ");
}

function lowerFirst(s) { return s ? s[0].toLowerCase() + s.slice(1) : s; }
function upperFirst(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

function joinPhrases(list) {
  const parts = [...new Set(list.map(lowerFirst))];
  if (parts.length <= 1) return parts[0] || "";
  return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
}

// effects -> "If X: opens A and closes this screen. Otherwise: shows the message “…”."
function describe(effects) {
  const meaningful = effects.filter((e) => e.type !== "call");
  const calls = effects.filter((e) => e.type === "call" && !meaningful.some((m) => m.via && e.name.startsWith(m.via + "(")));
  if (!meaningful.length) {
    return calls.length ? `Runs ${calls.map((c) => c.name).join(", ")}.` : "Nothing found that changes screens - it may only update this screen.";
  }
  const groups = new Map();
  for (const e of meaningful) {
    const key = condText(e.cond);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(phrase(e));
  }
  const out = [];
  for (const [cond, list] of groups) {
    const body = joinPhrases(list);
    out.push(cond ? `${upperFirst(cond)}: ${body}.` : upperFirst(body) + ".");
  }
  if (calls.length) out.push(`Also runs ${calls.map((c) => c.name).join(", ")}.`);
  return out.join(" ");
}

function effectChips(effects) {
  const wrap = h("div", "h-effects");
  const seen = new Set();
  for (const e of effects) {
    if (e.type === "call") continue;
    const key = e.type + (e.to || e.text || e.layout || e.how || e.title);
    if (seen.has(key)) continue;
    seen.add(key);
    let chip;
    if (e.type === "nav" && app.model.screens[e.to]) {
      chip = h("button", "fx fx-nav");
      chip.innerHTML = `→ ${esc(screenName(e.to))}`;
      chip.onclick = () => { openScreen(e.to); app.chart?.focusNode(e.to); };
    } else if (e.type === "back") { chip = h("span", "fx fx-back"); chip.textContent = "← " + phrase(e); }
    else if (e.type === "toast" || e.type === "alert") { chip = h("span", "fx fx-toast"); chip.textContent = "💬 " + (e.text || e.title || (e.error ? "error message" : e.type === "alert" ? "pop-up" : "message")); }
    else if (e.type === "dialog") {
      const id = Object.keys(app.model.screens).find((k) => app.model.screens[k].layout === e.layout && app.model.screens[k].dialogOf);
      chip = h("button", "fx fx-nav");
      chip.textContent = `▢ ${e.layout}`;
      if (id) chip.onclick = () => openScreen(id);
    } else { chip = h("span", "fx fx-api"); chip.textContent = e.text; }
    if (e.cond && e.cond.length) chip.title = upperFirst(condText(e.cond));
    wrap.append(chip);
  }
  return wrap.children.length ? wrap : null;
}

function codeBlock(item) {
  if (!item.code) return null;
  const d = h("details", "code");
  const file = item.file ? item.file.split("/").pop() : "";
  d.innerHTML = `<summary>Code · ${esc(file)}${item.line ? ":" + item.line : ""}</summary><pre></pre>`;
  d.querySelector("pre").textContent = item.code;
  return d;
}

// ---------------------------------------------------------------- details panel

function closePanel() {
  $("panel").hidden = true;
  document.querySelectorAll(".node.selected").forEach((n) => n.classList.remove("selected"));
  app.selected = null;
}

function openScreen(id, vid) {
  const s = app.model.screens[id];
  if (!s) return;
  app.selected = id;
  document.querySelectorAll(".node.selected").forEach((n) => n.classList.remove("selected"));
  app.chart?.nodes.get(id)?.el.classList.add("selected");
  const body = $("panelBody");
  body.innerHTML = "";
  $("panel").hidden = false;

  const head = h("div", "p-head");
  head.innerHTML = `<span class="badge badge-${s.kind}">${KIND_LABEL[s.kind]}</span>${s.launcher ? '<span class="badge badge-start">Start</span>' : ""}<h2></h2>`;
  head.querySelector("h2").textContent = screenName(id);
  body.append(head);
  const meta = h("div", "p-meta");
  if (s.file) meta.innerHTML += `<span><code>${esc(s.file.split("/").pop())}${s.line ? ":" + s.line : ""}</code></span>`;
  if (s.layout) meta.innerHTML += `<span>layout <code>${esc(s.layout)}.xml</code></span>`;
  if (s.host) meta.innerHTML += `<span>shown inside <code>${esc(s.host.host)}</code></span>`;
  if (s.dialogOf) meta.innerHTML += `<span>opened by <code>${esc(screenName(s.dialogOf))}</code></span>`;
  body.append(meta);

  const incoming = app.model.edges.filter((e) => e.to === id);
  const outgoing = [...new Set(app.model.edges.filter((e) => e.from === id).map((e) => e.to))];
  const links = h("div", "p-links");
  const linkList = (label, ids) => {
    if (!ids.length) return;
    const lab = h("span");
    lab.textContent = label;
    links.append(lab);
    for (const t of ids) {
      const b = h("button", "chip-link");
      b.textContent = screenName(t);
      b.onclick = () => { openScreen(t); app.chart?.focusNode(t); };
      links.append(b);
    }
  };
  linkList("Opened from", [...new Set(incoming.map((e) => e.from))]);
  if (incoming.length && outgoing.length) links.append(h("span", "", { flexBasis: "100%", height: "2px" }));
  linkList("Leads to", outgoing);
  if (!incoming.length && !s.launcher) { const m = h("span", "muted"); m.textContent = "Nothing in the code opens this screen."; links.append(m); }
  body.append(links);

  // big render
  const wrap = h("div", "p-shot-wrap");
  const scale = Math.min(0.9, (Math.min(560, window.innerWidth * 0.46) - 60) / SCREEN_W);
  const shot = h("div", "p-shot", { width: SCREEN_W * scale + "px", height: SCREEN_H * scale + "px" });
  const scaler = h("div", "shot-scale", { transform: `scale(${scale})` });
  const phone = app.renderer.screen(s, { interactive: true });
  scaler.append(phone);
  shot.append(scaler);
  wrap.append(shot);
  body.append(wrap);
  relayout(phone);

  // buttons and what they do
  const sec = h("section", "p-section");
  sec.innerHTML = `<h3>Buttons and what they do</h3>`;
  const cards = new Map();
  const byId = new Map();
  for (const hd of s.handlers) {
    const key = hd.id || hd.label;
    if (!byId.has(key)) byId.set(key, []);
    byId.get(key).push(hd);
  }
  for (const [key, list] of byId) {
    const card = h("div", "h-card");
    const first = list[0];
    const info = first.id ? app.model.idInfo[first.id] : null;
    const top = h("div", "h-top");
    top.innerHTML = `<b></b>${first.id ? `<span class="h-tag">${esc(info?.tag || "")} #${esc(first.id)}</span>` : ""}<span class="h-event">${esc(list.map((x) => x.event).filter((v, i, a) => a.indexOf(v) === i).join(", "))}</span>`;
    top.querySelector("b").textContent = first.label;
    card.append(top);
    for (const hd of list) {
      const p = h("p", "h-desc");
      p.textContent = describe(hd.effects);
      card.append(p);
      const chips = effectChips(hd.effects);
      if (chips) card.append(chips);
      const code = codeBlock(hd);
      if (code) card.append(code);
    }
    if (first.id) {
      card.onmouseenter = () => markView(phone, first.id, true);
      card.onmouseleave = () => markView(phone, first.id, false);
      cards.set(first.id, card);
    }
    sec.append(card);
  }
  if (!s.handlers.length) { const m = h("p", "muted"); m.textContent = "No click handlers found for this screen."; sec.append(m); }
  body.append(sec);

  // clickable-looking views with no code
  const wiredIds = new Set(s.handlers.map((x) => x.id).filter(Boolean));
  for (const v of phone.querySelectorAll("[data-vid]")) {
    if (wiredIds.has(v.dataset.vid) && !v.closest("[data-copy]")) {
      v.classList.add("wired");
      v.onclick = (ev) => { ev.stopPropagation(); selectCard(cards, phone, v.dataset.vid); };
    }
  }
  const loose = [...phone.querySelectorAll(".v-button, .v-imagebutton, .v-fab, .v-efab, .v-chip, .bn-item, [data-tag=ImageButton]")]
    .filter((v) => v.dataset.vid && !wiredIds.has(v.dataset.vid) && !v.closest("[data-copy]") && getComputedStyle(v).display !== "none");
  if (loose.length) {
    const sec2 = h("section", "p-section");
    sec2.innerHTML = `<h3>Buttons with no code found</h3>`;
    const list = h("div", "unwired");
    for (const v of [...new Map(loose.map((x) => [x.dataset.vid, x])).values()]) {
      const c = h("span", "fx");
      c.textContent = app.model.idInfo[v.dataset.vid]?.text || humanizeId(v.dataset.vid, s.cls);
      c.title = "#" + v.dataset.vid;
      list.append(c);
    }
    sec2.append(list);
    const m = h("p", "muted");
    m.textContent = "These look like buttons, but no click handler for them was found (they might be set up in a way Screen Map doesn't follow, or do nothing yet).";
    sec2.append(m);
    body.append(sec2);
  }

  // automatic transitions
  if (s.auto.length) {
    const sec3 = h("section", "p-section");
    sec3.innerHTML = `<h3>Happens on its own</h3>`;
    for (const a of s.auto) {
      const card = h("div", "h-card");
      card.innerHTML = `<div class="h-top"><b></b></div>`;
      card.querySelector("b").textContent = a.trigger;
      const p = h("p", "h-desc");
      p.textContent = describe(a.effects);
      card.append(p);
      const chips = effectChips(a.effects);
      if (chips) card.append(chips);
      const code = codeBlock(a);
      if (code) card.append(code);
      sec3.append(card);
    }
    body.append(sec3);
  }

  $("panel").scrollTop = 0;
  if (vid && cards.has(vid)) setTimeout(() => selectCard(cards, phone, vid), 30);
}

function markView(phone, vid, on) {
  for (const v of phone.querySelectorAll(`[data-vid="${CSS.escape(vid)}"]`)) if (!v.closest("[data-copy]")) v.classList.toggle("active", on);
}

function selectCard(cards, phone, vid) {
  for (const c of cards.values()) c.classList.remove("active");
  phone.querySelectorAll(".wired.active").forEach((v) => v.classList.remove("active"));
  const card = cards.get(vid);
  if (!card) return;
  card.classList.add("active");
  markView(phone, vid, true);
  card.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ---------------------------------------------------------------- gallery of every layout

function buildGallery() {
  const g = $("gallery");
  g.innerHTML = "";
  const { model, res, renderer } = app;
  const usage = {};
  const note = (layout, text) => { (usage[layout] = usage[layout] || []).push(text); };
  for (const s of Object.values(model.screens)) {
    if (s.layout) note(s.layout, s.dialogOf ? `dialog in ${s.dialogOf}` : `${s.kind} ${s.cls}`);
    for (const it of s.itemLayouts || []) note(it, `list row in ${s.cls}`);
  }
  for (const name of Object.keys(res.files.layout)) {
    const doc = res.doc("layout", name);
    if (!doc) continue;
    for (const inc of doc.getElementsByTagName("include")) note((inc.getAttribute("layout") || "").replace("@layout/", ""), `included in ${name}`);
  }
  const groups = { Screens: [], "List rows, dialogs and parts": [], "Not used by any code": [] };
  for (const name of Object.keys(res.files.layout).sort()) {
    const u = usage[name] || [];
    const isScreen = u.some((t) => /^(activity|fragment) /.test(t));
    groups[isScreen ? "Screens" : u.length ? "List rows, dialogs and parts" : "Not used by any code"].push(name);
  }
  for (const [title, names] of Object.entries(groups)) {
    if (!names.length) continue;
    const gh = h("div", "g-group");
    gh.textContent = `${title} · ${names.length}`;
    g.append(gh);
    for (const name of names) {
      const card = h("div", "g-card");
      const head = h("div", "node-head");
      head.innerHTML = `<b></b><small></small>`;
      head.querySelector("b").textContent = `${name}.xml`;
      head.querySelector("small").textContent = (usage[name] || ["not referenced"]).join(" · ");
      card.append(head);
      const shot = h("div", "g-shot");
      const screen = Object.values(model.screens).find((s) => s.layout === name && !s.host);
      const phone = screen ? renderer.screen(screen) : renderer.standalone(name);
      const scaler = h("div", "shot-scale", { transform: `scale(${NODE_SCALE})` });
      scaler.append(phone);
      shot.append(scaler);
      card.append(shot);
      g.append(card);
      relayout(phone);
      const ph = phone.getBoundingClientRect().height || SCREEN_H * NODE_SCALE;
      shot.style.height = Math.min(ph, SCREEN_H * NODE_SCALE) + "px";
      shot.style.width = SCREEN_W * NODE_SCALE + "px";
      card.onclick = () => {
        if (screen) openScreen(screen.id);
        else openLayout(name, usage[name]);
      };
    }
  }
}

function openLayout(name, usage) {
  const body = $("panelBody");
  body.innerHTML = "";
  $("panel").hidden = false;
  const head = h("div", "p-head");
  head.innerHTML = `<span class="badge badge-fragment">Layout</span><h2></h2>`;
  head.querySelector("h2").textContent = `${name}.xml`;
  body.append(head);
  const meta = h("div", "p-meta");
  meta.textContent = (usage || ["Not referenced by any code or layout"]).join(" · ");
  body.append(meta);
  const wrap = h("div", "p-shot-wrap");
  const scale = Math.min(0.9, (Math.min(560, window.innerWidth * 0.46) - 60) / SCREEN_W);
  const shot = h("div", "p-shot", { width: SCREEN_W * scale + "px" });
  const scaler = h("div", "shot-scale", { transform: `scale(${scale})` });
  const phone = app.renderer.standalone(name, null, { interactive: true });
  scaler.append(phone);
  shot.append(scaler);
  wrap.append(shot);
  body.append(wrap);
  relayout(phone);
  shot.style.height = phone.getBoundingClientRect().height + "px";
  const file = app.res.files.layout[name];
  if (file) {
    const d = h("details", "code");
    d.innerHTML = `<summary>XML · ${esc(file.path)}</summary><pre></pre>`;
    d.querySelector("pre").textContent = file.text;
    body.append(d);
  }
}

// ---------------------------------------------------------------- events

$("folderInput").addEventListener("change", (e) => { if (e.target.files.length) load(filesFromInput(e.target.files)); e.target.value = ""; });
const drop = $("drop");
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", async (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  load(await filesFromDrop(e.dataTransfer));
});
$("openOther").onclick = () => {
  if (app?.chart) app.chart.host.innerHTML = "";
  app = null;
  $("tabs").hidden = true;
  $("topActions").hidden = true;
  $("panel").hidden = true;
  $("projectName").textContent = "Your Android app as a flow chart";
  document.title = "Screen Map";
  show("landing");
};
for (const b of document.querySelectorAll(".tab-btn")) b.onclick = () => (b.dataset.view === "flow" ? showFlow() : showGallery());
$("panelClose").onclick = closePanel;
$("zoomIn").onclick = () => app.chart.zoomBy(1.25);
$("zoomOut").onclick = () => app.chart.zoomBy(0.8);
$("fitBtn").onclick = () => app.chart.fit();
$("resetBtn").onclick = () => app.chart.resetLayout();
$("sharedCheck").onchange = (e) => app.chart.setHideShared(!e.target.checked);
$("search").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || !app) return;
  const q = e.target.value.trim().toLowerCase();
  if (!q) return;
  const hit = Object.values(app.model.screens).find((s) => screenName(s.id).toLowerCase().includes(q) || (s.layout || "").includes(q));
  if (!hit) return;
  showFlow();
  app.chart.focusNode(hit.id);
  openScreen(hit.id);
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && app) closePanel(); });
window.addEventListener("resize", () => { if (app?.chart && !$("flowView").hidden) app.chart.apply(); });
