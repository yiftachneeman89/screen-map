// Turns an uploaded folder into the files Screen Map needs: Java/Kotlin/XML as text,
// and images + fonts from res/ as Files (they become object URLs / FontFaces later).

const SKIP_DIRS = new Set([
  ".git", ".svn", ".hg", "node_modules", "build", "dist", "out", "target", ".gradle", ".idea", ".vscode",
  ".vs", "bin", "obj", "generated", "intermediates", ".cxx", ".externalNativeBuild", "tmp", "captures",
]);
const TEST_DIRS = new Set(["test", "androidTest", "testDebug", "testRelease"]);
const TEXT_EXT = new Set(["java", "kt", "xml"]);
const BINARY_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "ttf", "otf"]);
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_BINARY_BYTES = 6 * 1024 * 1024;

function skippedPath(path) {
  const parts = path.split("/").slice(0, -1);
  return parts.some((part, i) => SKIP_DIRS.has(part) || (part.startsWith(".") && part.length > 1)
    || (TEST_DIRS.has(part) && parts[i - 1] === "src"));
}

function extOf(path) {
  const name = path.split("/").pop();
  return name.includes(".") ? name.split(".").pop().toLowerCase() : "";
}

// Every File from a drag-and-drop, walking into dropped folders.
async function filesFromDrop(dataTransfer) {
  const entries = [...dataTransfer.items].map((it) => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
  if (!entries.length) return [...dataTransfer.files].map((f) => ({ file: f, path: f.name }));
  const out = [];
  async function walk(entry, prefix) {
    if (entry.isFile) {
      const file = await new Promise((ok, fail) => entry.file(ok, fail));
      out.push({ file, path: prefix + entry.name });
    } else if (entry.isDirectory) {
      if (SKIP_DIRS.has(entry.name)) return;
      const reader = entry.createReader();
      let batch;
      do {  // readEntries returns at most 100 at a time
        batch = await new Promise((ok, fail) => reader.readEntries(ok, fail));
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      } while (batch.length);
    }
  }
  for (const e of entries) await walk(e, "");
  return out;
}

function filesFromInput(fileList) {
  return [...fileList].map((f) => ({ file: f, path: f.webkitRelativePath || f.name }));
}

// [{file, path}] -> { name, texts: [{path, text}], binaries: [{path, file}] }
async function readProject(items) {
  const texts = [], binaries = [];
  for (const { file, path } of items) {
    if (skippedPath(path)) continue;
    const ext = extOf(path);
    if (TEXT_EXT.has(ext) && file.size <= MAX_TEXT_BYTES) {
      texts.push({ path, text: (await file.text()).replace(/\r\n?/g, "\n") });
    } else if (BINARY_EXT.has(ext) && path.includes("/res/") && file.size <= MAX_BINARY_BYTES) {
      binaries.push({ path, file });
    }
  }
  // a picked folder gives every path the same first segment - use it as the project name
  const all = [...texts, ...binaries];
  const roots = new Set(all.map((f) => f.path.split("/")[0]));
  const nested = all.length && all.every((f) => f.path.includes("/"));
  const name = nested && roots.size === 1 ? [...roots][0] : "Project";
  if (nested && roots.size === 1) for (const f of all) f.path = f.path.slice(name.length + 1);
  return { name, texts, binaries };
}
