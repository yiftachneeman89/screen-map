// Screen Map: turns the project's Java/Kotlin classes into a PlantUML class diagram (.puml).
// Classes with their fields and methods, inheritance, interfaces, inner classes,
// "has a" links (a field whose type is another class of the app) and which screen opens which.

const UML_STEREO = { activity: "Activity", fragment: "Fragment", dialog: "Dialog", adapter: "Adapter" };
const UML_VIS = { public: "+", private: "-", protected: "#", internal: "~", package: "~" };

// the text of a body at its own level only: anything inside nested { } is dropped (the braces stay)
function topLevel(s, open, close) {
  let out = "", depth = 0;
  for (let i = open + 1; i < close; i++) {
    const ch = s[i];
    if (ch === "{") { if (!depth) out += "{"; depth++; continue; }
    if (ch === "}") { depth--; if (!depth) out += "}"; continue; }
    if (!depth) out += ch;
  }
  return out;
}

function stripAnnotations(t) {
  return t.replace(/@[\w.]+(\s*\([^()]*(\([^()]*\)[^()]*)*\))?/g, " ");
}

function simpleType(t) {
  return (t || "").replace(/\s+/g, " ").replace(/\b(?:[a-z]\w*\.)+(?=[A-Z])/g, "").trim();
}

// type names in a type, with their qualifier: "List<PlanData.Lesson>" -> [["List", null], ["Lesson", "PlanData"]]
function typeNames(t) {
  return [...(t || "").matchAll(/\b((?:[A-Z]\w*\.)*)([A-Z]\w*)/g)].map((m) => [m[2], m[1] ? m[1].slice(0, -1).split(".").pop() : null]);
}

function javaMembers(c) {
  const f = c.file;
  const body = topLevel(f.masked, c.open, c.close);
  const fields = [], methods = [];
  for (let chunk of body.split(/[;}]/)) {
    chunk = stripAnnotations(chunk).replace(/\s+/g, " ").trim();
    if (!chunk || /\b(class|interface|enum|record)\s+\w+/.test(chunk) || /^(static\s*)?\{$/.test(chunk)) continue;
    const eq = chunk.indexOf("="), paren = chunk.indexOf("(");
    if (chunk.endsWith("{") && paren >= 0 && (eq < 0 || eq > paren)) {
      const m = chunk.match(/^((?:(?:public|private|protected|static|final|abstract|synchronized|native|default|strictfp)\s+)*)(?:<[^>]*>\s*)?([\w.<>\[\]?, ]+?\s+)?(\w+)\s*\(([^)]*)\)/);
      if (!m) continue;
      const mods = m[1].trim().split(/\s+/);
      const ret = (m[2] || "").trim();
      if (!ret && m[3] !== c.name) continue;
      methods.push({ vis: mods.find((x) => UML_VIS[x]) || "", isStatic: mods.includes("static"), isAbstract: mods.includes("abstract"), name: m[3], params: javaParams(m[4]), ret: ret ? simpleType(ret) : "" });
    } else if (paren < 0 || eq >= 0 && eq < paren) {
      const decl = (eq >= 0 ? chunk.slice(0, eq) : chunk).trim();
      const m = decl.match(/^((?:(?:public|private|protected|static|final|transient|volatile)\s+)*)([\w.<>\[\]?, ]+?)\s+(\w+(?:\s*,\s*\w+)*)$/);
      if (!m || /^(return|throw|new)$/.test(m[2])) continue;
      const mods = m[1].trim().split(/\s+/);
      for (const name of m[3].split(/\s*,\s*/)) {
        fields.push({ vis: mods.find((x) => UML_VIS[x]) || "", isStatic: mods.includes("static"), name, type: simpleType(m[2]) });
      }
    }
  }
  return { fields, methods };
}

function javaParams(p) {
  return stripAnnotations(p).split(",").map((x) => x.replace(/\bfinal\b/g, "").trim()).filter(Boolean)
    .map((x) => { const m = x.match(/^(.+?)\s+(\w+)$/); return m ? `${m[2]}: ${simpleType(m[1])}` : x; });
}

function kotlinMembers(c) {
  const f = c.file;
  const fields = [], methods = [];
  // properties in the primary constructor: class X(val a: Int, private var b: String)
  const ctor = (c.header || "").match(/^[^(]*\(([\s\S]*)\)/);
  if (ctor) {
    for (const m of ctor[1].matchAll(/(?:(private|protected|internal|public)\s+)?(?:override\s+)?(val|var)\s+(\w+)\s*:\s*([\w.<>?, ]+)/g)) {
      fields.push({ vis: m[1] || "public", name: m[3], type: simpleType(m[4]) });
    }
  }
  if (c.close <= c.open) return { fields, methods };
  const body = topLevel(f.masked, c.open, c.close);
  for (let line of body.split(/\n|;/)) {
    line = stripAnnotations(line).replace(/\s+/g, " ").trim();
    if (!line || /\b(class|object|interface)\s+\w+/.test(line) || /^companion object/.test(line)) continue;
    let m = line.match(/^((?:\w+\s+)*?)fun\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?(\w+)\s*\(([^)]*)\)\s*(?::\s*([\w.<>?, ]+?))?\s*(?:[{=]|$)/);
    if (m) {
      const mods = m[1].trim().split(/\s+/);
      const params = m[3].split(",").map((x) => x.trim()).filter(Boolean).map((x) => { const p = x.match(/(\w+)\s*:\s*([^=]+)/); return p ? `${p[1]}: ${simpleType(p[2])}` : x; });
      methods.push({ vis: mods.find((x) => UML_VIS[x]) || "public", isAbstract: mods.includes("abstract"), name: m[2], params, ret: simpleType(m[4] || "") });
      continue;
    }
    m = line.match(/^((?:\w+\s+)*?)(val|var)\s+(\w+)\s*(?::\s*([\w.<>?, ]+?))?\s*(?:=\s*(.*)|by\s+(.*))?$/);
    if (m) {
      const mods = m[1].trim().split(/\s+/);
      let type = m[4] || "";
      if (!type && m[5]) { const t = m[5].match(/^([A-Z]\w*)\s*\(/); if (t) type = t[1]; }
      fields.push({ vis: mods.find((x) => UML_VIS[x]) || "public", name: m[3], type: simpleType(type) });
    }
  }
  return { fields, methods };
}

// interfaces aren't in the analyzer's class list - find them here
function findInterfaces(files) {
  const out = {};
  for (const f of files) {
    for (const m of f.masked.matchAll(/\b(?:fun\s+)?interface\s+(\w+)(?:\s*<[^>{]*>)?([^{;]*)\{/g)) {
      const open = m.index + m[0].length - 1;
      const close = matchClose(f.masked, open);
      const ext = (m[2].match(/(?:extends|:)\s*([\w.,<> ]+)/) || [])[1];
      out[m[1]] = { name: m[1], file: f, open, close, header: m[2], interface: true, parents: ext ? ext.split(",").map((x) => x.trim().split(/[<\s]/)[0].split(".").pop()).filter(Boolean) : [] };
    }
  }
  return out;
}

// names this class implements (Java "implements A, B"; Kotlin ": Base(), A, B")
function implementsOf(c, ifaces) {
  const h = (c.header || "").replace(/\([^()]*(\([^()]*\)[^()]*)*\)/g, "");
  const list = c.file.kotlin ? (h.match(/:\s*([^{]*)/) || [])[1] : (h.match(/\bimplements\s+([^{]*)/) || [])[1];
  if (!list) return [];
  return list.split(",").map((x) => x.trim().split(/[<\s]/)[0].split(".").pop()).filter((n) => n && ifaces[n] && n !== c.superName);
}

// every class in the code, each with a unique diagram id. The analyzer keeps one class per name,
// so a nested class sharing a name with another (PlanData.Lesson vs the Lesson screen) is added here.
function collectClasses(model, ifaces) {
  const list = Object.values(model.classes).map((c) => ({ ...c }));
  const seen = new Set(list.map((c) => c.file.path + ":" + c.start));
  for (const f of model.files || []) {
    for (const m of f.masked.matchAll(/\b(class|object)\s+(\w+)(?:\s*<[^>{]*>)?([^{;]*?)\{/g)) {
      if (seen.has(f.path + ":" + m.index) || !model.classes[m[2]]) continue;
      if (f.kotlin && /\n\s*(class|fun|val|var|object|@)\b/.test(m[3])) continue;
      const open = m.index + m[0].length - 1;
      const ext = m[3].match(/\bextends\s+([\w.]+)/) || (f.kotlin && m[3].replace(/\([^()]*(\([^()]*\)[^()]*)*\)/, "").match(/:\s*([\w.]+)/));
      list.push({ name: m[2], file: f, start: m.index, open, close: matchClose(f.masked, open), header: m[3], superName: ext ? ext[1].split(".").pop() : null, kind: "other", inner: [] });
    }
  }
  const all = [...list, ...Object.values(ifaces)];
  for (const c of all) {
    const outer = all.filter((o) => o !== c && o.file === c.file && o.open < c.start && o.close > c.open).sort((a, b) => b.open - a.open)[0];
    c.outerRef = outer || null;
  }
  const count = {};
  for (const c of all) count[c.name] = (count[c.name] || 0) + 1;
  for (const c of all) {
    c.label = count[c.name] > 1 && c.outerRef ? `${c.outerRef.name}.${c.name}` : c.name;
    c.uid = c.label.replace(/\W/g, "_");
  }
  return all;
}

// a type name used inside class c -> the class it means (nested siblings first, then the app-wide one)
function resolveType(name, c, all, qualifier) {
  if (qualifier) return all.find((x) => x.name === name && x.outerRef?.name === qualifier) || null;
  for (let scope = c; scope; scope = scope.outerRef) {
    const hit = all.find((x) => x.name === name && x.outerRef === scope);
    if (hit) return hit;
  }
  return all.find((x) => x.name === name && x.label === name) || all.find((x) => x.name === name) || null;
}

function packageOf(file) {
  const m = file.masked.match(/^\s*package\s+([\w.]+)/m);
  return m ? m[1] : "";
}

function memberLine(vis, text, isStatic, isAbstract) {
  return `  ${UML_VIS[vis] || ""}${isStatic ? "{static} " : ""}${isAbstract ? "{abstract} " : ""}${text}`;
}

function buildUml(model, projectName) {
  const ifaces = findInterfaces(model.files || [...new Set(Object.values(model.classes).map((c) => c.file))]);
  const all = collectClasses(model, ifaces);
  const lines = [
    "@startuml",
    `title ${projectName} - class diagram`,
    `' Made by Screen Map from the project's Java/Kotlin code.`,
    `' Open it with PlantUML: the PlantUML plugin in Android Studio or VS Code, or plantuml.com.`,
    "skinparam classAttributeIconSize 0",
    "skinparam shadowing false",
    "hide empty members",
    "",
  ];
  const rel = [];
  const external = new Set();

  const byPkg = new Map();
  for (const c of all) {
    const pkg = packageOf(c.file);
    if (!byPkg.has(pkg)) byPkg.set(pkg, []);
    byPkg.get(pkg).push(c);
  }
  for (const [pkg, list] of [...byPkg].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (pkg) lines.push(`package ${pkg} {`);
    for (const c of list.sort((a, b) => a.label.localeCompare(b.label))) {
      const { fields, methods } = c.file.kotlin ? kotlinMembers(c) : javaMembers(c);
      const before = c.file.masked.slice(Math.max(0, c.start - 40), c.start);
      const isAbstract = !c.interface && /\babstract\s+$/.test(before);
      const isObject = /^object\b/.test(c.file.masked.slice(c.start, c.start + 7));
      const stereo = UML_STEREO[c.kind] ? ` <<${UML_STEREO[c.kind]}>>` : isObject ? " <<object>>" : "";
      const kw = c.interface ? "interface" : isAbstract ? "abstract class" : "class";
      const defaultVis = c.file.kotlin || c.interface ? "public" : "package";
      lines.push(`${kw} "${c.label}" as ${c.uid}${stereo} {`);
      for (const fl of fields) lines.push(memberLine(fl.vis || defaultVis, `${fl.name}${fl.type ? ": " + fl.type : ""}`, fl.isStatic));
      for (const m of methods) lines.push(memberLine(m.vis || defaultVis, `${m.name}(${m.params.join(", ")})${m.ret && m.ret !== "Unit" && m.ret !== "void" ? ": " + m.ret : ""}`, m.isStatic, m.isAbstract));
      lines.push("}");

      // relationships
      const parents = c.interface ? c.parents : [c.superName].filter(Boolean);
      for (const p of parents) {
        const hit = resolveType(p, c, all);
        if (!hit) external.add(p);
        rel.push(`${hit ? hit.uid : p} <|-- ${c.uid}`);
      }
      if (!c.interface) for (const i of implementsOf(c, ifaces)) rel.push(`${ifaces[i].uid} <|.. ${c.uid}`);
      if (c.outerRef) rel.push(`${c.outerRef.uid} +-- ${c.uid}`);
      const has = new Map();
      for (const fl of fields) {
        for (const [t, q] of typeNames(fl.type)) {
          const hit = resolveType(t, c, all, q);
          if (!hit || hit === c || hit === c.outerRef || hit.outerRef === c || (q && hit.name !== t)) continue;
          if (!has.has(hit.uid)) has.set(hit.uid, []);
          has.get(hit.uid).push(fl.name);
        }
      }
      for (const [uid, names] of has) rel.push(`${c.uid} --> ${uid} : ${[...new Set(names)].join(", ")}`);
    }
    if (pkg) lines.push("}");
    lines.push("");
  }
  if (external.size) {
    lines.push("' Android / library classes the app builds on");
    for (const e of [...external].sort()) lines.push(`class ${e} <<library>> #EEEEEE`);
    lines.push("");
  }
  lines.push("' inheritance, interfaces, inner classes and fields");
  lines.push(...new Set(rel));

  // which screen opens which (dialogs made from a layout aren't classes, so they're left out)
  const uidOf = (name) => (all.find((x) => x.name === name && x.label === name) || {}).uid;
  const opens = new Map();  // "A ..> B" -> opened by a tap at least once?
  for (const e of model.edges) {
    const a = uidOf(e.from), b = uidOf(e.to);
    if (!a || !b || a === b) continue;
    const key = `${a} ..> ${b}`;
    opens.set(key, opens.get(key) || !e.auto);
  }
  if (opens.size) {
    lines.push("", "' navigation: which screen opens which");
    for (const [key, tapped] of opens) lines.push(`${key} : ${tapped ? "opens" : "opens on its own"}`);
  }
  lines.push("@enduml", "");
  return lines.join("\n");
}

function downloadUml() {
  if (!app) return;
  const text = buildUml(app.model, app.name);
  const blob = new Blob([text], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${app.name.replace(/[^\w.-]+/g, "_") || "project"}.puml`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
