// Android resources: values (colors, strings, dimens, styles), themes, drawables, fonts,
// layouts, menus and navigation graphs - everything the renderer needs to look things up.

const ANDROID_COLORS = {
  white: "#ffffff", black: "#000000", transparent: "transparent", darker_gray: "#aaaaaa",
  holo_blue_light: "#33b5e5", holo_blue_dark: "#0099cc", holo_blue_bright: "#00ddff",
  holo_red_light: "#ff4444", holo_red_dark: "#cc0000", holo_green_light: "#99cc00", holo_green_dark: "#669900",
  holo_orange_light: "#ffbb33", holo_orange_dark: "#ff8800", holo_purple: "#aa66cc",
  background_dark: "#000000", background_light: "#ffffff", primary_text_dark: "#ffffff",
  primary_text_light: "#000000", secondary_text_dark: "#bebebe", secondary_text_light: "#323232",
  tertiary_text_dark: "#808080", tertiary_text_light: "#808080",
};
const ANDROID_STRINGS = { ok: "OK", cancel: "Cancel", yes: "Yes", no: "No", copy: "Copy", paste: "Paste", search_go: "Search" };

// Framework theme defaults, by theme family and light/dark.
const THEME_DEFAULTS = {
  m3: {
    light: {
      colorPrimary: "#6750a4", colorOnPrimary: "#ffffff", colorPrimaryContainer: "#eaddff", colorOnPrimaryContainer: "#21005d",
      colorSecondary: "#625b71", colorOnSecondary: "#ffffff", colorSecondaryContainer: "#e8def8", colorOnSecondaryContainer: "#1d192b",
      colorSurface: "#fef7ff", colorOnSurface: "#1d1b20", colorSurfaceVariant: "#e7e0ec", colorOnSurfaceVariant: "#49454f",
      colorSurfaceContainer: "#f3edf7", colorOutline: "#79747e", colorOutlineVariant: "#cac4d0", colorError: "#b3261e",
      colorBackground: "#fef7ff", textColorPrimary: "#1d1b20", textColorSecondary: "#49454f", textColorHint: "#49454f99",
      colorControlNormal: "#49454f",
    },
    dark: {
      colorPrimary: "#d0bcff", colorOnPrimary: "#381e72", colorPrimaryContainer: "#4f378b", colorOnPrimaryContainer: "#eaddff",
      colorSecondary: "#ccc2dc", colorOnSecondary: "#332d41", colorSecondaryContainer: "#4a4458", colorOnSecondaryContainer: "#e8def8",
      colorSurface: "#141218", colorOnSurface: "#e6e0e9", colorSurfaceVariant: "#49454f", colorOnSurfaceVariant: "#cac4d0",
      colorSurfaceContainer: "#211f26", colorOutline: "#938f99", colorOutlineVariant: "#49454f", colorError: "#f2b8b5",
      colorBackground: "#141218", textColorPrimary: "#e6e0e9", textColorSecondary: "#cac4d0", textColorHint: "#cac4d099",
      colorControlNormal: "#cac4d0",
    },
  },
  mc: {
    light: {
      colorPrimary: "#6200ee", colorOnPrimary: "#ffffff", colorPrimaryVariant: "#3700b3", colorSecondary: "#03dac6",
      colorOnSecondary: "#000000", colorSurface: "#ffffff", colorOnSurface: "#000000", colorError: "#b00020",
      colorBackground: "#ffffff", textColorPrimary: "#000000de", textColorSecondary: "#00000099", textColorHint: "#00000061",
      colorControlNormal: "#0000008a", colorOutline: "#0000001f",
    },
    dark: {
      colorPrimary: "#bb86fc", colorOnPrimary: "#000000", colorPrimaryVariant: "#3700b3", colorSecondary: "#03dac6",
      colorOnSecondary: "#000000", colorSurface: "#121212", colorOnSurface: "#ffffff", colorError: "#cf6679",
      colorBackground: "#121212", textColorPrimary: "#ffffffde", textColorSecondary: "#ffffff99", textColorHint: "#ffffff61",
      colorControlNormal: "#ffffffb3", colorOutline: "#ffffff1f",
    },
  },
  appcompat: {
    light: {
      colorPrimary: "#3f51b5", colorPrimaryDark: "#303f9f", colorAccent: "#ff4081", colorBackground: "#fafafa",
      textColorPrimary: "#000000de", textColorSecondary: "#0000008a", textColorHint: "#00000061", colorControlNormal: "#0000008a",
    },
    dark: {
      colorPrimary: "#212121", colorPrimaryDark: "#000000", colorAccent: "#80cbc4", colorBackground: "#303030",
      textColorPrimary: "#ffffff", textColorSecondary: "#ffffffb3", textColorHint: "#ffffff80", colorControlNormal: "#ffffffb3",
    },
  },
};

const DENSITY = { ldpi: 0.75, mdpi: 1, tvdpi: 1.33, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4, nodpi: 1, anydpi: 1 };
const IMAGE_PREF = ["xxhdpi", "xxxhdpi", "xhdpi", "hdpi", "nodpi", "", "anydpi", "mdpi", "ldpi", "tvdpi"];

function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  return doc.getElementsByTagName("parsererror").length ? null : doc;
}

// ".../res/<type>-<qualifiers>/<file>" -> { type, quals, name, ext } (null for anything else)
function resInfo(path) {
  const parts = path.split("/");
  const i = parts.lastIndexOf("res");
  if (i < 0 || i !== parts.length - 3) return null;
  const [type, ...quals] = parts[i + 1].split("-");
  const file = parts[i + 2];
  const ext = file.split(".").pop().toLowerCase();
  return { type, quals, name: file.replace(/\.9\.png$/i, "").replace(/\.[^.]+$/, ""), ext };
}

// Lower wins. Plain folders and API-level folders are what a phone in portrait would use.
function qualScore(quals, image) {
  const density = quals.find((q) => q in DENSITY) || "";
  const other = quals.filter((q) => !(q in DENSITY) && !/^v\d+$/.test(q));
  const version = quals.some((q) => /^v\d+$/.test(q)) ? 1 : 0;
  const d = image ? IMAGE_PREF.indexOf(density) : density ? 3 : 0;
  return other.length * 100 + d * 2 + version;
}

function attrName(qualified) {
  return qualified.includes(":") ? qualified.split(":").pop() : qualified;
}

function hexToCss(hex) {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  if (h.length === 6) return "#" + h.toLowerCase();
  if (h.length === 8) {  // Android is #AARRGGBB
    const a = parseInt(h.slice(0, 2), 16) / 255;
    const [r, g, b] = [2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${+a.toFixed(3)})`;
  }
  return null;
}

// "#rrggbb" / "rgba()" / "#rrggbbaa" (theme defaults) -> rgba with an extra alpha multiplier
function withAlpha(css, alpha) {
  if (!css || alpha == null || alpha >= 1) return css;
  let m = css.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (m) {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    const a = (m[2] ? parseInt(m[2], 16) / 255 : 1) * alpha;
    return `rgba(${r}, ${g}, ${b}, ${+a.toFixed(3)})`;
  }
  m = css.match(/^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/);
  if (m) return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${+(m[4] * alpha).toFixed(3)})`;
  return css;
}

// "#rrggbbaa" (used in THEME_DEFAULTS for brevity) -> css
function cssColor(v) {
  const m = v.match(/^#([0-9a-f]{6})([0-9a-f]{2})$/i);
  return m ? withAlpha("#" + m[1], parseInt(m[2], 16) / 255) : v;
}

// Relative luminance 0..1 of a css color, for picking light/dark status-bar icons.
function luminance(css) {
  const ctx = luminance.ctx || (luminance.ctx = document.createElement("canvas").getContext("2d"));
  ctx.fillStyle = "#000";
  ctx.fillStyle = css;
  const v = ctx.fillStyle;
  const m = v.match(/^#(..)(..)(..)$/) || v.match(/rgba?\((\d+), (\d+), (\d+)/);
  if (!m) return 0;
  const [r, g, b] = m.slice(1, 4).map((x) => (v.startsWith("#") ? parseInt(x, 16) : +x) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

class Theme {
  constructor(res, name) {
    this.res = res;
    this.name = name;
    this.items = name ? res.styleItems(name) : {};
    const chain = name ? res.styleChain(name).join(" ") : "";
    this.family = /Material3/.test(chain) ? "m3" : /MaterialComponents/.test(chain) ? "mc" : chain ? "appcompat" : "m3";
    // "DayNight" previews light; "DarkActionBar" only darkens the bar
    this.dark = (/\.Dark(?!ActionBar)|\.Black|\.Night/.test(chain.replace(/DayNight/g, "")) || (/Holo/.test(chain) && !/Light/.test(chain)));
    this.noActionBar = /NoActionBar|NoTitleBar|Fullscreen|SplashScreen/.test(chain)
      || this.items.windowActionBar === "false" || this.items.windowNoTitle === "true";
    this.defaults = THEME_DEFAULTS[this.family][this.dark ? "dark" : "light"];
  }
  attr(name) {
    name = attrName(name);
    if (name in this.items) return this.items[name];
    if (name === "colorAccent") return this.attr("colorSecondary");
    if (name === "colorSecondary" && "colorAccent" in this.items) return this.items.colorAccent;
    if (name === "colorPrimaryDark" || name === "colorPrimaryVariant") return this.items.colorPrimaryDark ?? this.items.colorPrimaryVariant ?? this.defaults[name];
    if (name === "colorControlActivated") return this.attr("colorAccent");
    if (name === "colorBackground") return this.items.windowBackground ?? this.defaults.colorBackground;
    if (name === "windowBackground") return this.attr("colorBackground");
    if (name === "actionBarSize") return "56dp";
    const d = this.defaults[name] ?? THEME_DEFAULTS.m3[this.dark ? "dark" : "light"][name];
    return d == null ? undefined : cssColor(d);
  }
}

class Resources {
  constructor() {
    this.values = { color: {}, string: {}, dimen: {}, integer: {}, bool: {}, style: {}, array: {}, fraction: {} };
    this.files = { drawable: {}, mipmap: {}, color: {}, layout: {}, menu: {}, navigation: {}, font: {}, anim: {}, xml: {} };
    this.fontFamilies = {};  // res font name -> css font-family
    this._docs = new Map();
  }

  addValues(text, score) {
    const doc = parseXml(text);
    if (!doc) return;
    for (const el of doc.documentElement.children) {
      const name = el.getAttribute("name");
      if (!name) continue;
      let type = el.tagName;
      if (type === "item") type = el.getAttribute("type");
      if (type === "string-array" || type === "integer-array") type = "array";
      if (type === "plurals") { type = "string"; }
      const table = this.values[type];
      if (!table) continue;
      const prev = table[name];
      if (prev && prev.score <= score) continue;
      let value;
      if (type === "style") {
        const items = {};
        for (const it of el.getElementsByTagName("item")) items[attrName(it.getAttribute("name"))] = it.textContent.trim();
        value = { parent: el.getAttribute("parent"), items };
      } else if (type === "array") {
        value = [...el.getElementsByTagName("item")].map((it) => cleanString(it.textContent));
      } else if (el.tagName === "plurals") {
        const item = el.querySelector("item[quantity=other]") || el.querySelector("item");
        value = item ? cleanString(item.textContent) : "";
      } else {
        value = type === "string" ? cleanString(el.textContent) : el.textContent.trim();
      }
      table[name] = { value, score };
    }
  }

  addFile(info, entry, score) {
    const table = this.files[info.type];
    if (!table) return;
    const prev = table[info.name];
    if (prev && prev.score <= score) return;
    const density = DENSITY[info.quals.find((q) => q in DENSITY)] || 1;
    table[info.name] = { ...entry, ext: info.ext, density, score };
  }

  doc(type, name) {
    const f = this.files[type]?.[name];
    if (!f || f.text == null) return null;
    if (!this._docs.has(f)) this._docs.set(f, parseXml(f.text));
    return this._docs.get(f);
  }

  // ---- styles

  styleRef(v) {
    if (!v) return null;
    return v.replace(/^@(\+)?(android:)?(style\/)?/, "").replace(/^\?(android:)?(attr\/)?/, "");
  }

  // Style names from the given one up through its parents (project and framework names alike).
  styleChain(name, seen = new Set()) {
    name = this.styleRef(name);
    if (!name || seen.has(name)) return [];
    seen.add(name);
    const s = this.values.style[name]?.value;
    let parent = s?.parent;
    if (parent == null && name.includes(".")) parent = name.slice(0, name.lastIndexOf("."));  // implicit parent
    if (parent === "") return [name];
    return [name, ...this.styleChain(parent, seen)];
  }

  styleItems(name) {
    const out = {};
    for (const n of this.styleChain(name).reverse()) Object.assign(out, this.values.style[n]?.value.items);
    return out;
  }

  // ---- values

  // Follows @type/name and ?attr references down to a literal (file references are returned as-is).
  resolve(v, theme, depth = 0) {
    if (v == null || depth > 15) return v;
    v = String(v).trim();
    let m = v.match(/^@\+?(?:([\w.]+):)?([\w-]+)\/([\w.]+)$/);
    if (m) {
      const [, pkg, type, name] = m;
      if (pkg === "android") {
        if (type === "color") return ANDROID_COLORS[name] ?? v;
        if (type === "string") return ANDROID_STRINGS[name] ?? name.replace(/_/g, " ");
        return v;
      }
      const entry = this.values[type]?.[name];
      if (entry && type !== "style" && type !== "array") return this.resolve(entry.value, theme, depth + 1);
      return v;
    }
    m = v.match(/^\?(?:([\w.]+):)?(?:attr\/)?([\w.]+)$/);
    if (m) {
      const x = theme?.attr(m[2]);
      return x == null ? null : this.resolve(x, theme, depth + 1);
    }
    return v;
  }

  string(v, theme) {
    if (v == null) return null;
    const r = this.resolve(v, theme);
    if (r == null) return null;
    return /^@\w+\//.test(r) ? r.replace(/^@\w+\//, "").replace(/_/g, " ") : r;
  }

  array(v) {
    const m = v && v.match(/^@(?:array|string-array)\/(\w+)$/);
    return m ? this.values.array[m[1]]?.value || [] : [];
  }

  // -> css color or null. Handles #hex, @color/x (incl. state lists), ?attr, @android:color.
  color(v, theme, depth = 0) {
    const r = this.resolve(v, theme);
    if (r == null || depth > 8) return null;
    if (r.startsWith("#")) return hexToCss(r);
    if (/^(rgba?\(|transparent)/.test(r)) return r;
    if (r === "@null") return "transparent";
    const m = r.match(/^@color\/(\w+)$/);
    if (m) {
      const doc = this.doc("color", m[1]);
      if (!doc) return null;
      const items = [...doc.documentElement.getElementsByTagName("item")];
      const item = items.find((it) => ![...it.attributes].some((a) => /state_/.test(a.name))) || items[items.length - 1];
      if (!item) return null;
      const c = this.color(item.getAttribute("android:color"), theme, depth + 1);
      const alpha = parseFloat(this.resolve(item.getAttribute("android:alpha") ?? item.getAttribute("app:alpha"), theme));
      return isNaN(alpha) ? c : withAlpha(c, alpha);
    }
    return null;
  }

  // -> dp number or null. "16dp", "@dimen/x", "?attr/actionBarSize", "8px"...
  dp(v, theme) {
    const r = this.resolve(v, theme);
    if (r == null) return null;
    const m = String(r).match(/^(-?[\d.]+)\s*(dp|dip|sp|px|pt|in|mm)?$/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    switch (m[2]) {
      case "px": return n / 3;
      case "pt": return n * 160 / 72;
      case "in": return n * 160;
      case "mm": return n * 160 / 25.4;
      default: return n;
    }
  }

  number(v, theme) {
    const r = this.resolve(v, theme);
    const n = parseFloat(r);
    return isNaN(n) ? null : n;
  }

  // ---- drawables

  // "@drawable/x" | "@mipmap/x" -> { kind: "image", url, w, h } | { kind: "xml", doc, name } | null
  drawable(v, theme) {
    const r = this.resolve(v, theme);
    if (!r) return null;
    const m = r.match(/^@(drawable|mipmap|color)\/(\w+)$/);
    if (!m) return null;
    const f = this.files[m[1]]?.[m[2]];
    if (!f) return null;
    if (f.url) return { kind: "image", url: f.url, w: f.w / f.density, h: f.h / f.density, name: m[2] };
    const doc = this.doc(m[1], m[2]);
    return doc ? { kind: "xml", doc, name: m[2], type: m[1] } : null;
  }

  // "@font/x" -> css family name ("" when not a project font)
  font(v, theme) {
    const r = this.resolve(v, theme);
    const m = r && r.match(/^@font\/(\w+)$/);
    return m ? this.fontFamilies[m[1]] || "" : "";
  }
}

// String resources: strip surrounding quotes and Android escapes.
function cleanString(s) {
  s = s.trim();
  if (s.length > 1 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  return s.replace(/\\n/g, "\n").replace(/\\t/g, "  ").replace(/\\(['"@?\\])/g, "$1").replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// Fills a Resources from the uploaded files (images get object URLs, fonts get registered).
async function loadResources(project) {
  const res = new Resources();
  for (const f of project.texts) {
    const info = resInfo(f.path);
    if (!info || info.ext !== "xml") continue;
    const score = qualScore(info.quals, false);
    if (info.type === "values") res.addValues(f.text, score);
    else res.addFile(info, { text: f.text, path: f.path }, score);
  }
  const fontLoads = [];
  for (const f of project.binaries) {
    const info = resInfo(f.path);
    if (!info) continue;
    if (info.type === "font") {
      const family = `res_${info.name}`;
      res.fontFamilies[info.name] = family;
      fontLoads.push(f.file.arrayBuffer().then((buf) => new FontFace(family, buf).load()).then((face) => document.fonts.add(face)).catch(() => {}));
      continue;
    }
    if (info.type !== "drawable" && info.type !== "mipmap") continue;
    const score = qualScore(info.quals, true);
    const prev = res.files[info.type][info.name];
    if (prev && prev.score <= score) continue;
    const url = URL.createObjectURL(f.file);
    const size = await new Promise((ok) => {
      const img = new Image();
      img.onload = () => ok([img.naturalWidth, img.naturalHeight]);
      img.onerror = () => ok([0, 0]);
      img.src = url;
    });
    res.addFile(info, { url, path: f.path, w: size[0], h: size[1] }, score);
  }
  // <font-family> XML: map to the first listed font file (and register weights under one family)
  for (const [name, f] of Object.entries(res.files.font)) {
    const doc = res.doc("font", name);
    if (!doc) continue;
    const fonts = [...doc.getElementsByTagName("font")];
    const first = fonts.map((x) => (x.getAttribute("android:font") || x.getAttribute("app:font") || "").replace("@font/", "")).find((n) => res.fontFamilies[n]);
    if (first) res.fontFamilies[name] = res.fontFamilies[first];
  }
  await Promise.all(fontLoads);
  return res;
}
