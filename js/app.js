// Screen Map: wires up loading a project, the flow chart, the layout gallery and the screen viewer.

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
  closeViewer();
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
      onSelect: (id, vid) => openScreen(id, vid),
      onZoom: (z) => { $("zoomPct").textContent = Math.round(z * 100) + "%"; },
      onMoved: (moved) => { $("resetBtn").hidden = !moved; },
    });
    app.chart.build();
    $("sharedToggle").hidden = !app.chart.sharedCount;
    $("sharedCheck").checked = false;
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

const NAV_VERB = { activity: "Opens", fragment: "Shows", dialog: "Opens the pop-up" };

function screenName(id) {
  const s = app.model.screens[id];
  return s ? friendlyName(s) : id;
}

function phrase(e) {
  const s = app.model.screens[e.to];
  switch (e.type) {
    case "nav": return `${NAV_VERB[s?.kind] || "Opens"} ${screenName(e.to)}`;
    case "back": return { finish: "closes this screen", finishAffinity: "closes the app's screens", onBackPressed: "goes back", popBackStack: "goes back", navigateUp: "goes back", dismiss: "closes the pop-up", dismissAllowingStateLoss: "closes the pop-up" }[e.how] || "goes back";
    case "toast": return e.text ? `shows the message “${e.text}”` : e.error ? "shows the error message" : "shows a message";
    case "alert": return e.title ? `shows a pop-up “${e.title}”` : "shows a pop-up";
    case "dialog": {
      const d = Object.values(app.model.screens).find((x) => x.layout === e.layout && x.dialogOf);
      return `opens the “${d ? friendlyName(d) : e.layout}” pop-up`;
    }
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

// effects -> ["If X: opens A and closes this screen.", "Otherwise: shows the message “…”."]
function describeLines(effects) {
  const meaningful = effects.filter((e) => e.type !== "call");
  const calls = effects.filter((e) => e.type === "call" && !meaningful.some((m) => m.via && e.name.startsWith(m.via + "(")));
  if (!meaningful.length) {
    return [calls.length ? `Runs ${calls.map((c) => c.name).join(", ")}.` : "Doesn't change screens - it may only update this one."];
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
  return out;
}

function describe(effects) { return describeLines(effects).join(" "); }

// one sentence as a paragraph, several as a list
function describeEl(effects) {
  const lines = describeLines(effects);
  const el = h(lines.length > 1 ? "ul" : "p", "b-desc");
  if (lines.length > 1) for (const t of lines) { const li = h("li"); li.textContent = t; el.append(li); }
  else el.textContent = lines[0];
  return el;
}

// the screens a button leads to, as buttons that open them
function effectChips(effects) {
  const wrap = h("div", "h-effects");
  const seen = new Set();
  for (const e of effects) {
    let id = null;
    if (e.type === "nav" && app.model.screens[e.to]) id = e.to;
    if (e.type === "dialog") id = Object.keys(app.model.screens).find((k) => app.model.screens[k].layout === e.layout && app.model.screens[k].dialogOf);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const chip = h("button", "fx-nav");
    chip.innerHTML = `<span>Go to</span> ${esc(screenName(id))} →`;
    chip.onclick = () => { openScreen(id, null, true); app.chart?.focusNode(id); };
    if (e.cond && e.cond.length) chip.title = upperFirst(condText(e.cond));
    wrap.append(chip);
  }
  return wrap.children.length ? wrap : null;
}

function codeBlock(item) {
  if (!item.code) return null;
  const d = h("details", "code");
  const file = item.file ? item.file.split("/").pop() : "";
  d.innerHTML = `<summary>Show code <span>${esc(file)}${item.line ? ":" + item.line : ""}</span></summary><pre></pre>`;
  d.querySelector("pre").textContent = item.code;
  return d;
}

// ---------------------------------------------------------------- the screen viewer (opens over the chart)

const viewHistory = [];

function closeViewer() {
  $("viewer").hidden = true;
  viewHistory.length = 0;
  if (app) app.selected = null;
}

// a phone, scaled to fill the viewer's height
function bigPhone(phone, fullHeight) {
  const avail = window.innerWidth < 900 ? Math.min(window.innerWidth - 64, 380) / SCREEN_W : (window.innerHeight - 120) / SCREEN_H;
  const scale = Math.max(0.45, Math.min(1, avail));
  const shot = h("div", "v-shot", { width: SCREEN_W * scale + "px" });
  if (fullHeight) shot.style.height = SCREEN_H * scale + "px";
  const scaler = h("div", "shot-scale", { transform: `scale(${scale})` });
  scaler.append(phone);
  shot.append(scaler);
  return { shot, scale };
}

function viewerShell(title, tags, sub) {
  $("viewer").hidden = false;
  const body = $("viewerBody");
  body.innerHTML = "";
  $("viewerBack").hidden = viewHistory.length < 2;
  if (viewHistory.length >= 2) $("viewerBack").querySelector("span").textContent = screenName(viewHistory[viewHistory.length - 2]);
  const left = h("div", "v-left");
  const right = h("div", "v-right");
  body.append(left, right);
  const head = h("div", "v-head");
  head.innerHTML = `<div class="v-tags">${tags}</div><h2></h2><p class="v-sub"></p>`;
  head.querySelector("h2").textContent = title;
  head.querySelector(".v-sub").textContent = sub;
  right.append(head);
  $("viewerCard").scrollTop = 0;
  right.scrollTop = 0;
  return { left, right };
}

function openScreen(id, vid, fromLink) {
  const s = app.model.screens[id];
  if (!s) return;
  if (!fromLink) viewHistory.length = 0;
  if (viewHistory[viewHistory.length - 1] !== id) viewHistory.push(id);
  app.selected = id;

  const sub = [s.dialogOf ? `${s.layout}.xml` : s.cls, s.layout && !s.dialogOf ? `${s.layout}.xml` : "", s.host ? `inside ${screenName(s.host.host)}` : ""].filter(Boolean).join(" · ");
  const tags = `<span class="kind kind-${s.kind}">${KIND_LABEL[s.kind]}</span>${s.launcher ? '<span class="kind kind-start">App starts here</span>' : ""}`;
  const { left, right } = viewerShell(friendlyName(s), tags, sub);

  const phone = app.renderer.screen(s, { interactive: true });
  const { shot } = bigPhone(phone, true);
  left.append(shot);
  relayout(phone);

  // where you can come from / go to
  const incoming = [...new Set(app.model.edges.filter((e) => e.to === id && e.from !== id).map((e) => e.from))];
  const outgoing = [...new Set(app.model.edges.filter((e) => e.from === id && e.to !== id).map((e) => e.to))];
  const links = h("div", "v-links");
  const linkRow = (label, ids, empty) => {
    const row = h("div", "v-link-row");
    row.innerHTML = `<span class="v-link-label">${label}</span>`;
    for (const t of ids) {
      const b = h("button", "chip-link");
      b.textContent = screenName(t);
      b.onclick = () => { openScreen(t, null, true); app.chart?.focusNode(t); };
      row.append(b);
    }
    if (!ids.length) row.insertAdjacentHTML("beforeend", `<span class="muted">${empty}</span>`);
    links.append(row);
  };
  linkRow("Comes from", incoming, s.launcher ? "Nothing - the app opens here" : "Nothing in the code opens this screen");
  linkRow("Goes to", outgoing, "No other screens");
  right.append(links);

  // every button and what it does
  const sec = h("section", "v-section");
  sec.innerHTML = `<h3>What each button does</h3>`;
  const cards = new Map();
  const byId = new Map();
  for (const hd of s.handlers) {
    const key = hd.id || hd.label;
    if (!byId.has(key)) byId.set(key, []);
    byId.get(key).push(hd);
  }
  for (const list of byId.values()) {
    const first = list[0];
    const card = h("div", "b-card");
    const top = h("div", "b-top");
    const events = [...new Set(list.map((x) => x.event))].filter((ev) => ev && !/^(click|tap)$/i.test(ev));
    top.innerHTML = `<span class="b-name"></span>${events.length ? `<span class="b-event">${esc(events.join(", "))}</span>` : ""}`;
    top.querySelector(".b-name").textContent = first.label;
    card.append(top);
    for (const hd of list) {
      card.append(describeEl(hd.effects));
      const chips = effectChips(hd.effects);
      if (chips) card.append(chips);
    }
    for (const hd of list) { const code = codeBlock(hd); if (code) card.append(code); }
    if (first.id) {
      card.onmouseenter = () => markView(phone, first.id, true);
      card.onmouseleave = () => { if (!card.classList.contains("active")) markView(phone, first.id, false); };
      cards.set(first.id, card);
    }
    sec.append(card);
  }
  if (!s.handlers.length) sec.insertAdjacentHTML("beforeend", `<p class="muted">No buttons with code on this screen.</p>`);
  right.append(sec);

  // tapping a button on the phone jumps to its explanation
  const wiredIds = new Set(s.handlers.map((x) => x.id).filter(Boolean));
  for (const v of phone.querySelectorAll("[data-vid]")) {
    if (wiredIds.has(v.dataset.vid) && !v.closest("[data-copy]")) {
      v.classList.add("wired");
      v.onclick = (ev) => { ev.stopPropagation(); selectCard(cards, phone, v.dataset.vid); };
    }
  }

  // things that happen without a tap
  if (s.auto.length) {
    const sec3 = h("section", "v-section");
    sec3.innerHTML = `<h3>Happens on its own</h3>`;
    for (const a of s.auto) {
      const card = h("div", "b-card auto");
      card.innerHTML = `<div class="b-top"><span class="b-name auto"></span></div>`;
      card.querySelector(".b-name").textContent = a.trigger;
      card.append(describeEl(a.effects));
      const chips = effectChips(a.effects);
      if (chips) card.append(chips);
      const code = codeBlock(a);
      if (code) card.append(code);
      sec3.append(card);
    }
    right.append(sec3);
  }

  // button-looking views with no code behind them
  const loose = [...phone.querySelectorAll(".v-button, .v-imagebutton, .v-fab, .v-efab, .v-chip, .bn-item, [data-tag=ImageButton]")]
    .filter((v) => v.dataset.vid && !wiredIds.has(v.dataset.vid) && !v.closest("[data-copy]") && getComputedStyle(v).display !== "none");
  if (loose.length) {
    const sec2 = h("section", "v-section");
    sec2.innerHTML = `<h3>Buttons with no code found</h3>`;
    const list = h("div", "unwired");
    for (const v of [...new Map(loose.map((x) => [x.dataset.vid, x])).values()]) {
      const c = h("span", "fx");
      c.textContent = app.model.idInfo[v.dataset.vid]?.text || humanizeId(v.dataset.vid, s.cls);
      c.title = "#" + v.dataset.vid;
      list.append(c);
    }
    sec2.append(list);
    sec2.insertAdjacentHTML("beforeend", `<p class="muted">These look like buttons, but Screen Map couldn't find what they do.</p>`);
    right.append(sec2);
  }

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
    if (s.layout) note(s.layout, s.dialogOf ? `pop-up in ${screenName(s.dialogOf)}` : `${friendlyName(s)} screen`);
    for (const it of s.itemLayouts || []) note(it, `list row in ${friendlyName(s)}`);
  }
  for (const name of Object.keys(res.files.layout)) {
    const doc = res.doc("layout", name);
    if (!doc) continue;
    for (const inc of doc.getElementsByTagName("include")) note((inc.getAttribute("layout") || "").replace("@layout/", ""), `part of ${name}`);
  }
  const groups = { Screens: [], "List rows, pop-ups and parts": [], "Not used by any code": [] };
  for (const name of Object.keys(res.files.layout).sort()) {
    const u = usage[name] || [];
    const isScreen = u.some((t) => / screen$/.test(t));
    groups[isScreen ? "Screens" : u.length ? "List rows, pop-ups and parts" : "Not used by any code"].push(name);
  }
  for (const [title, names] of Object.entries(groups)) {
    if (!names.length) continue;
    const gh = h("div", "g-group");
    gh.textContent = `${title} · ${names.length}`;
    g.append(gh);
    for (const name of names) {
      const card = h("div", "g-card");
      const head = h("div", "g-head");
      head.innerHTML = `<b></b><small></small>`;
      head.querySelector("b").textContent = `${name}.xml`;
      head.querySelector("small").textContent = [...new Set(usage[name] || ["not used"])].join(" · ");
      const shot = h("div", "g-shot");
      const screen = Object.values(model.screens).find((s) => s.layout === name && !s.host);
      const phone = screen ? renderer.screen(screen) : renderer.standalone(name);
      const scaler = h("div", "shot-scale", { transform: `scale(${NODE_SCALE})` });
      scaler.append(phone);
      shot.append(scaler);
      card.append(shot, head);
      g.append(card);
      relayout(phone);
      const ph = phone.getBoundingClientRect().height || SCREEN_H * NODE_SCALE;
      shot.style.height = Math.min(ph, SCREEN_H * NODE_SCALE) + "px";
      shot.style.width = SCREEN_W * NODE_SCALE + "px";
      card.onclick = () => (screen ? openScreen(screen.id) : openLayout(name, usage[name]));
    }
  }
}

function openLayout(name, usage) {
  viewHistory.length = 0;
  const { left, right } = viewerShell(`${name}.xml`, `<span class="kind kind-fragment">Layout</span>`, [...new Set(usage || ["Not used by any code or layout"])].join(" · "));
  const phone = app.renderer.standalone(name, null, { interactive: true });
  const { shot } = bigPhone(phone, false);
  left.append(shot);
  relayout(phone);
  shot.style.height = phone.getBoundingClientRect().height + "px";
  const file = app.res.files.layout[name];
  if (file) {
    const d = h("details", "code");
    d.innerHTML = `<summary>Show XML <span>${esc(file.path)}</span></summary><pre></pre>`;
    d.querySelector("pre").textContent = file.text;
    right.append(d);
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
  closeViewer();
  $("projectName").textContent = "Your Android app as a flow chart";
  document.title = "Screen Map";
  show("landing");
};
for (const b of document.querySelectorAll(".tab-btn")) b.onclick = () => (b.dataset.view === "flow" ? showFlow() : showGallery());
$("viewerClose").onclick = closeViewer;
$("viewer").onclick = (e) => { if (e.target === $("viewer")) closeViewer(); };
$("viewerBack").onclick = () => { viewHistory.pop(); const id = viewHistory.pop(); if (id) { openScreen(id, null, true); app.chart?.focusNode(id); } };
$("zoomIn").onclick = () => app.chart.zoomBy(1.25);
$("zoomOut").onclick = () => app.chart.zoomBy(0.8);
$("fitBtn").onclick = () => app.chart.fit();
$("resetBtn").onclick = () => app.chart.resetLayout();
$("sharedCheck").onchange = (e) => app.chart.setHideShared(!e.target.checked);
$("search").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || !app) return;
  const q = e.target.value.trim().toLowerCase();
  if (!q) return;
  const hit = Object.values(app.model.screens).find((s) => screenName(s.id).toLowerCase().includes(q) || s.cls.toLowerCase().includes(q) || (s.layout || "").includes(q));
  if (!hit) return;
  showFlow();
  app.chart.focusNode(hit.id);
  openScreen(hit.id);
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && app) closeViewer(); });
window.addEventListener("resize", () => { if (app?.chart && !$("flowView").hidden) app.chart.apply(); });
