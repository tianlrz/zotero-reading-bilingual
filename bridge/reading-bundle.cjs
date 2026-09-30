const { readSDTCache } = require("./sdt-cache.cjs");
const path = require("node:path");
const fs = require("node:fs/promises");
const { createHash } = require("node:crypto");

const normalize = (text) => text.normalize("NFC").replace(/\s+/g, " ").trim();
const plainText = (node) => typeof node?.text === "string" ? node.text : (node?.content || []).map(plainText).join("");
const inlineNodes = (block) => Array.isArray(block?.content) && block.content.every((node) => typeof node?.text === "string");
const cleanCacheKey = (text) => text.split(/\n(?:正在调用 [^\n]*翻译…|\[翻译失败:|\[译文解析空|✎ 编辑)/)[0];
function cacheHash(text) {
  let result = 0;
  for (let i = 0; i < text.length; i++) result = (result * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(result).toString(36);
}
const validRects = (node) => (node?.anchor?.pageRects || []).filter((r) => Array.isArray(r) && r.length === 5 && r.every(Number.isFinite) && Number.isInteger(r[0]) && r[0] >= 0 && r[1] < r[3] && r[2] < r[4]);

function blockToMarkdown(node) {
  if (typeof node.text === "string") {
    let text = node.text;
    if (node.style?.monospace) text = "`" + text.replace(/`/g, "\\`") + "`";
    else {
      if (node.style?.italic) text = "*" + text + "*";
      if (node.style?.bold) text = "**" + text + "**";
    }
    if (node.style?.sup) text = "<sup>" + text + "</sup>";
    if (node.style?.sub) text = "<sub>" + text + "</sub>";
    return text;
  }
  return (node.content || []).map(blockToMarkdown).join("");
}

function joinParts(parts, getter) {
  let text = "";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    let next = getter(part);
    // Zotero joins words broken by a printed line/page-end hyphen.
    const previousText = i ? plainText(parts[i - 1]) : "", nextText = plainText(part);
    const dehyphenate = /[-\u00ad]$/.test(previousText) && /^[a-z]/.test(nextText);
    if (dehyphenate) text = text.replace(/[-\u00ad]([*_`]*)$/, "$1");
    if (i && !dehyphenate && /[\p{L}\p{N}]$/u.test(previousText) && /^[\p{L}\p{N}]/u.test(nextText)) text += " ";
    text += next;
  }
  return text;
}

function buildReadingBundle(structure, translations, metadata = {}) {
  const matches = new Map();
  for (const [key, value] of Object.entries(translations || {})) {
    if (typeof value === "string" && value && !/^\[(?:翻译失败|译文解析空)/.test(value)) matches.set(normalize(cleanCacheKey(key)), value);
  }
  const blocks = [], consumed = new Set();
  const headingLevels = new Map();
  const visitOutline = (entries, level = 1) => {
    for (const entry of entries || []) {
      const ref = entry.ref || entry.position?.start;
      if (Array.isArray(ref)) headingLevels.set(ref.join("."), Math.min(6, level));
      visitOutline(entry.items || entry.children, level + 1);
    }
  };
  visitOutline(structure.catalog.outline);
  function add(node, ref, inherited = []) {
    if (!node || node.flowClass === "excluded") return;
    if (!inlineNodes(node) && !["image", "math"].includes(node.type)) {
      (node.content || []).forEach((child, i) => {
        if (typeof child.text !== "string") add(child, [...ref, i], validRects(node).length ? validRects(node) : inherited);
      });
      return;
    }
    const parts = [node], refs = [ref];
    if (ref.length === 1 && inlineNodes(node) && !["image", "table", "math"].includes(node.type)) {
      let current = node;
      const seen = new Set([ref[0]]);
      while (Array.isArray(current.nextPart) && current.nextPart.length === 1) {
        const index = current.nextPart[0], next = structure.content[index];
        if (seen.has(index) || consumed.has(index) || !next || next.flowClass === "excluded" || !inlineNodes(next) || next.type !== node.type) break;
        seen.add(index); consumed.add(index); parts.push(next); refs.push([index]); current = next;
      }
    }
    const text = joinParts(parts, plainText).trim();
    let translated = matches.get(normalize(text)) || null;
    if (typeof translated !== "string") translated = null;
    let rects = parts.flatMap(validRects);
    if (!rects.length) rects = inherited;
    if (!rects.length) {
      // Exact SDT catalog ranges provide a fallback when a leaf has no anchor.
      const pageIndex = structure.catalog.pages.findIndex((page) => ref[0] >= page.contentRange?.[0]?.[0] && ref[0] < page.contentRange?.[1]?.[0]);
      if (pageIndex >= 0) rects = [[pageIndex, ...structure.catalog.pages[pageIndex].viewRect]];
    }
    const pages = [...new Set(rects.map((r) => r[0] + 1))].sort((a, b) => a - b);
    const isCrop = ["image", "math", "table"].includes(node.type);
    if (!text && !isCrop) return;
    blocks.push({
      id: "block-" + ref.join("-"), ref, type: node.type || "paragraph", level: headingLevels.get(ref.join(".")) || 2,
      original: text, markdown: joinParts(parts, blockToMarkdown).trim(), translated,
      pages, rects, reference: !!node.reference,
      sourceParts: parts.map((part, i) => ({ ref: refs[i], text: plainText(part), pages: [...new Set(validRects(part).map((r) => r[0] + 1))] })),
      crops: isCrop ? rects.map((rect) => ({ page: rect[0] + 1, rect: rect.slice(1), image: null })) : [],
    });
  }
  structure.content.forEach((block, index) => { if (!consumed.has(index)) add(block, [index]); });
  // Reuse grouped entries only if a unique contiguous source sequence has
  // the exact TOC/roadmap cache hash. Never infer translations from order alone.
  for (const [key, group] of Object.entries(translations || {})) {
    if (!group || typeof group !== "object" || !Array.isArray(group.itemsZh)) continue;
    const isRoadmap = key.startsWith("roadmap_"), isToc = key.startsWith("toc_block_");
    if (!isRoadmap && !isToc) continue;
    const size = group.itemsZh.length, candidates = [];
    for (let i = 0; i + size + Number(isRoadmap) <= blocks.length; i++) {
      const rows = blocks.slice(i + Number(isRoadmap), i + Number(isRoadmap) + size);
      const source = (isRoadmap ? blocks[i].original + "::" : "toc::") + rows.map((b) => b.original).join("::");
      if (key === (isRoadmap ? "roadmap_" : "toc_block_") + cacheHash(source)) candidates.push(i);
    }
    if (candidates.length !== 1) continue;
    const start = candidates[0];
    if (isRoadmap && typeof group.leadZh === "string") blocks[start].translated = group.leadZh;
    group.itemsZh.forEach((translation, index) => {
      if (typeof translation === "string") blocks[start + Number(isRoadmap) + index].translated = translation;
    });
  }
  const title = metadata.title || blocks.find((b) => b.type === "heading")?.original || "Zotero 文献";
  const attachmentKey = /^[A-Z0-9]{8}$/.test(metadata.attachmentKey || "") ? metadata.attachmentKey : "";
  return {
    format: "zotero-bilingual-reading", version: 1, title, createdAt: new Date().toISOString(),
    zoteroURI: metadata.zoteroURI || (attachmentKey ? "zotero://select/library/items/" + attachmentKey : ""),
    pdf: { attachmentKey, filename: metadata.filename || "", path: metadata.pdfPath || "", hash: structure.metadata.source?.hash || "" },
    pages: structure.catalog.pages.map((p, i) => ({ page: i + 1, label: p.label || String(i + 1), viewRect: p.viewRect })),
    blocks,
    stats: { blocks: blocks.length, translated: blocks.filter((b) => b.translated).length, pages: structure.catalog.pages.length, figures: blocks.filter((b) => b.crops.length).length },
  };
}

async function importPDF(pdfPath, metadata = {}) {
  const filename = path.basename(pdfPath), dir = path.dirname(pdfPath);
  const cachePath = path.join(dir, filename.replace(/\.pdf$/i, "") + ".bilingual.json");
  const [pack, bytes] = await Promise.all([fs.readFile(path.join(dir, ".zotero-sdt-cache")), fs.readFile(pdfPath)]);
  const structure = readSDTCache(pack);
  const hash = createHash("md5").update(bytes).digest("hex");
  if (structure.metadata.source?.hash && hash !== structure.metadata.source.hash) throw new Error("PDF 与阅读模式缓存不一致，请在 Zotero 中重新生成阅读模式。");
  let translations = {};
  try { translations = JSON.parse(await fs.readFile(cachePath, "utf8")).translations || {}; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  return buildReadingBundle(structure, translations, {
    attachmentKey: path.basename(dir), filename, pdfPath, ...metadata,
  });
}

function bundleToMarkdown(bundle, bundlePath) {
  const lines = ["---", "title: " + JSON.stringify(bundle.title), "zrb_bundle: " + JSON.stringify(bundlePath), "zotero: " + JSON.stringify(bundle.zoteroURI), "cssclasses: [zrb-native-reading]", "---", "", "# " + bundle.title, "", `[在 Zotero 中打开](${bundle.zoteroURI})`, ""];
  for (const block of bundle.blocks) {
    lines.push(`<!-- ${block.id}; PDF ${block.pages.join(",")} -->`);
    if (block.type === "heading") lines.push("#".repeat(block.level) + " " + block.markdown);
    else if (block.crops.length) {
      for (const crop of block.crops) lines.push(crop.image ? `![[${crop.image}]]` : `> ${block.type === "math" ? "公式" : "图表"}：原 PDF 第 ${crop.page} 页`);
    } else lines.push(block.markdown);
    if (block.translated) lines.push("", "> [!zrb-translation] 译文", ...block.translated.split("\n").map(line => "> " + line));
    lines.push("");
  }
  return lines.join("\n");
}

function validateBundle(bundle) {
  if (bundle?.format !== "zotero-bilingual-reading" || bundle.version !== 1 || !Array.isArray(bundle.blocks) || !bundle.pdf || !Array.isArray(bundle.pages)) throw new Error("不是受支持的双语阅读文件。");
  for (const block of bundle.blocks) {
    if (typeof block.id !== "string" || typeof block.original !== "string" || !Array.isArray(block.pages) || !block.pages.every((n) => Number.isInteger(n) && n >= 1 && n <= bundle.pages.length)) throw new Error("双语阅读文件的段落定位无效。");
  }
  return bundle;
}

module.exports = { readSDTCache, buildReadingBundle, importPDF, bundleToMarkdown, validateBundle, cacheHash };
