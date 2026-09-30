var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// bridge/sdt-cache.cjs
var require_sdt_cache = __commonJS({
  "bridge/sdt-cache.cjs"(exports2, module2) {
    var { inflateRawSync } = require("node:zlib");
    function readSDTCache(input) {
      const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
      const fail = () => {
        throw new Error("Zotero \u9605\u8BFB\u6A21\u5F0F\u7F13\u5B58\u635F\u574F\u6216\u683C\u5F0F\u4E0D\u53D7\u652F\u6301\uFF0C\u8BF7\u5728 Zotero \u4E2D\u91CD\u65B0\u6253\u5F00\u9605\u8BFB\u6A21\u5F0F\u540E\u518D\u5BFC\u5165\u3002");
      };
      const range = (start, length) => {
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0 || start + length > bytes.length) fail();
        return bytes.subarray(start, start + length);
      };
      if (bytes.length < 32 || !bytes.subarray(0, 8).equals(Buffer.from([137, 83, 68, 84, 13, 10, 26, 10])) || bytes[8] !== 1 || bytes[9] !== 1) fail();
      const indexSize = bytes.readUInt32LE(12);
      if (indexSize < 16 || (indexSize - 8) % 8) fail();
      const index = range(16, indexSize);
      const entries = (indexSize - 8) / 8;
      const offsets = [], starts = [];
      for (let i = 0; i < entries; i++) {
        offsets.push(index.readUInt32LE(8 + i * 4));
        starts.push(index.readUInt32LE(8 + entries * 4 + i * 4));
        if (i === 0 && (offsets[i] || starts[i]) || i && (offsets[i] <= offsets[i - 1] || starts[i] <= starts[i - 1])) fail();
      }
      const metadataSize = index.readUInt32LE(0), catalogSize = index.readUInt32LE(4);
      const metadataStart = 16 + indexSize, catalogStart = metadataStart + metadataSize, contentStart = catalogStart + catalogSize;
      if (contentStart + offsets.at(-1) !== bytes.length || starts.at(-1) > 1e5) fail();
      let expandedBytes = 0;
      const expand = (compressed) => {
        const result = inflateRawSync(compressed, { maxOutputLength: 64 * 1024 * 1024 });
        expandedBytes += result.length;
        if (expandedBytes > 128 * 1024 * 1024) fail();
        return result;
      };
      const metadata = JSON.parse(expand(range(metadataStart, metadataSize)).toString("utf8"));
      const catalog = JSON.parse(expand(range(catalogStart, catalogSize)).toString("utf8"));
      const content = [];
      for (let i = 0; i < entries - 1; i++) {
        const chunk = expand(range(contentStart + offsets[i], offsets[i + 1] - offsets[i]));
        const count = starts[i + 1] - starts[i], header = count * 4;
        if (header > chunk.length) fail();
        for (let j = 0; j < count; j++) {
          const begin = chunk.readUInt32LE(j * 4), end = j + 1 === count ? chunk.length - header : chunk.readUInt32LE((j + 1) * 4);
          if (begin > end || header + end > chunk.length || j === 0 && begin !== 0) fail();
          content.push(JSON.parse(chunk.subarray(header + begin, header + end).toString("utf8")));
        }
      }
      if (metadata.processor?.type !== "pdf" || !Array.isArray(catalog.pages)) throw new Error("\u5F53\u524D\u4EC5\u652F\u6301 Zotero \u7684 PDF \u9605\u8BFB\u6A21\u5F0F\u7F13\u5B58\u3002");
      return { schemaVersion: [bytes[9], bytes[10], bytes[11]].join("."), metadata, catalog, content };
    }
    module2.exports = { readSDTCache };
  }
});

// bridge/reading-bundle.cjs
var require_reading_bundle = __commonJS({
  "bridge/reading-bundle.cjs"(exports2, module2) {
    var { readSDTCache } = require_sdt_cache();
    var path2 = require("node:path");
    var fs = require("node:fs/promises");
    var { createHash } = require("node:crypto");
    var normalize = (text) => text.normalize("NFC").replace(/\s+/g, " ").trim();
    var plainText = (node) => typeof node?.text === "string" ? node.text : (node?.content || []).map(plainText).join("");
    var inlineNodes = (block) => Array.isArray(block?.content) && block.content.every((node) => typeof node?.text === "string");
    var cleanCacheKey = (text) => text.split(/\n(?:正在调用 [^\n]*翻译…|\[翻译失败:|\[译文解析空|✎ 编辑)/)[0];
    function cacheHash(text) {
      let result = 0;
      for (let i = 0; i < text.length; i++) result = result * 31 + text.charCodeAt(i) | 0;
      return Math.abs(result).toString(36);
    }
    var validRects = (node) => (node?.anchor?.pageRects || []).filter((r) => Array.isArray(r) && r.length === 5 && r.every(Number.isFinite) && Number.isInteger(r[0]) && r[0] >= 0 && r[1] < r[3] && r[2] < r[4]);
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
        const previousText = i ? plainText(parts[i - 1]) : "", nextText = plainText(part);
        const dehyphenate = /[-\u00ad]$/.test(previousText) && /^[a-z]/.test(nextText);
        if (dehyphenate) text = text.replace(/[-\u00ad]([*_`]*)$/, "$1");
        if (i && !dehyphenate && /[\p{L}\p{N}]$/u.test(previousText) && /^[\p{L}\p{N}]/u.test(nextText)) text += " ";
        text += next;
      }
      return text;
    }
    function buildReadingBundle(structure, translations, metadata = {}) {
      const matches = /* @__PURE__ */ new Map();
      for (const [key, value] of Object.entries(translations || {})) {
        if (typeof value === "string" && value && !/^\[(?:翻译失败|译文解析空)/.test(value)) matches.set(normalize(cleanCacheKey(key)), value);
      }
      const blocks = [], consumed = /* @__PURE__ */ new Set();
      const headingLevels = /* @__PURE__ */ new Map();
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
          const seen = /* @__PURE__ */ new Set([ref[0]]);
          while (Array.isArray(current.nextPart) && current.nextPart.length === 1) {
            const index = current.nextPart[0], next = structure.content[index];
            if (seen.has(index) || consumed.has(index) || !next || next.flowClass === "excluded" || !inlineNodes(next) || next.type !== node.type) break;
            seen.add(index);
            consumed.add(index);
            parts.push(next);
            refs.push([index]);
            current = next;
          }
        }
        const text = joinParts(parts, plainText).trim();
        let translated = matches.get(normalize(text)) || null;
        if (typeof translated !== "string") translated = null;
        let rects = parts.flatMap(validRects);
        if (!rects.length) rects = inherited;
        if (!rects.length) {
          const pageIndex = structure.catalog.pages.findIndex((page) => ref[0] >= page.contentRange?.[0]?.[0] && ref[0] < page.contentRange?.[1]?.[0]);
          if (pageIndex >= 0) rects = [[pageIndex, ...structure.catalog.pages[pageIndex].viewRect]];
        }
        const pages = [...new Set(rects.map((r) => r[0] + 1))].sort((a, b) => a - b);
        const isCrop = ["image", "math", "table"].includes(node.type);
        if (!text && !isCrop) return;
        blocks.push({
          id: "block-" + ref.join("-"),
          ref,
          type: node.type || "paragraph",
          level: headingLevels.get(ref.join(".")) || 2,
          original: text,
          markdown: joinParts(parts, blockToMarkdown).trim(),
          translated,
          pages,
          rects,
          reference: !!node.reference,
          sourceParts: parts.map((part, i) => ({ ref: refs[i], text: plainText(part), pages: [...new Set(validRects(part).map((r) => r[0] + 1))] })),
          crops: isCrop ? rects.map((rect) => ({ page: rect[0] + 1, rect: rect.slice(1), image: null })) : []
        });
      }
      structure.content.forEach((block, index) => {
        if (!consumed.has(index)) add(block, [index]);
      });
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
      const title = metadata.title || blocks.find((b) => b.type === "heading")?.original || "Zotero \u6587\u732E";
      const attachmentKey = /^[A-Z0-9]{8}$/.test(metadata.attachmentKey || "") ? metadata.attachmentKey : "";
      return {
        format: "zotero-bilingual-reading",
        version: 1,
        title,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        zoteroURI: metadata.zoteroURI || (attachmentKey ? "zotero://select/library/items/" + attachmentKey : ""),
        pdf: { attachmentKey, filename: metadata.filename || "", path: metadata.pdfPath || "", hash: structure.metadata.source?.hash || "" },
        pages: structure.catalog.pages.map((p, i) => ({ page: i + 1, label: p.label || String(i + 1), viewRect: p.viewRect })),
        blocks,
        stats: { blocks: blocks.length, translated: blocks.filter((b) => b.translated).length, pages: structure.catalog.pages.length, figures: blocks.filter((b) => b.crops.length).length }
      };
    }
    async function importPDF2(pdfPath, metadata = {}) {
      const filename = path2.basename(pdfPath), dir = path2.dirname(pdfPath);
      const cachePath = path2.join(dir, filename.replace(/\.pdf$/i, "") + ".bilingual.json");
      const [pack, bytes] = await Promise.all([fs.readFile(path2.join(dir, ".zotero-sdt-cache")), fs.readFile(pdfPath)]);
      const structure = readSDTCache(pack);
      const hash = createHash("md5").update(bytes).digest("hex");
      if (structure.metadata.source?.hash && hash !== structure.metadata.source.hash) throw new Error("PDF \u4E0E\u9605\u8BFB\u6A21\u5F0F\u7F13\u5B58\u4E0D\u4E00\u81F4\uFF0C\u8BF7\u5728 Zotero \u4E2D\u91CD\u65B0\u751F\u6210\u9605\u8BFB\u6A21\u5F0F\u3002");
      let translations = {};
      try {
        translations = JSON.parse(await fs.readFile(cachePath, "utf8")).translations || {};
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      return buildReadingBundle(structure, translations, {
        attachmentKey: path2.basename(dir),
        filename,
        pdfPath,
        ...metadata
      });
    }
    function bundleToMarkdown2(bundle, bundlePath) {
      const lines = ["---", "title: " + JSON.stringify(bundle.title), "zrb_bundle: " + JSON.stringify(bundlePath), "zotero: " + JSON.stringify(bundle.zoteroURI), "---", "", "# " + bundle.title, "", `[\u5728 Zotero \u4E2D\u6253\u5F00](${bundle.zoteroURI})`, ""];
      for (const block of bundle.blocks) {
        lines.push(`<!-- ${block.id}; PDF ${block.pages.join(",")} -->`);
        if (block.type === "heading") lines.push("#".repeat(block.level) + " " + block.markdown);
        else if (block.crops.length) {
          for (const crop of block.crops) lines.push(crop.image ? `![[${crop.image}]]` : `> ${block.type === "math" ? "\u516C\u5F0F" : "\u56FE\u8868"}\uFF1A\u539F PDF \u7B2C ${crop.page} \u9875`);
        } else lines.push(block.markdown);
        if (block.translated) lines.push("", block.translated);
        lines.push("");
      }
      return lines.join("\n");
    }
    function validateBundle2(bundle) {
      if (bundle?.format !== "zotero-bilingual-reading" || bundle.version !== 1 || !Array.isArray(bundle.blocks) || !bundle.pdf || !Array.isArray(bundle.pages)) throw new Error("\u4E0D\u662F\u53D7\u652F\u6301\u7684\u53CC\u8BED\u9605\u8BFB\u6587\u4EF6\u3002");
      for (const block of bundle.blocks) {
        if (typeof block.id !== "string" || typeof block.original !== "string" || !Array.isArray(block.pages) || !block.pages.every((n) => Number.isInteger(n) && n >= 1 && n <= bundle.pages.length)) throw new Error("\u53CC\u8BED\u9605\u8BFB\u6587\u4EF6\u7684\u6BB5\u843D\u5B9A\u4F4D\u65E0\u6548\u3002");
      }
      return bundle;
    }
    module2.exports = { readSDTCache, buildReadingBundle, importPDF: importPDF2, bundleToMarkdown: bundleToMarkdown2, validateBundle: validateBundle2, cacheHash };
  }
});

// obsidian-plugin/src/pdf-session.js
var require_pdf_session = __commonJS({
  "obsidian-plugin/src/pdf-session.js"(exports2, module2) {
    var fs = require("node:fs/promises");
    var path2 = require("node:path");
    var { createHash } = require("node:crypto");
    var libraryPromise;
    function viewportRectangle2(viewport, rect) {
      return [...viewport.convertToViewportPoint(rect[0], rect[1]), ...viewport.convertToViewportPoint(rect[2], rect[3])];
    }
    async function loadPDFLibrary(plugin) {
      if (!libraryPromise) {
        const base = plugin.assetURL("");
        libraryPromise = new Function("url", "return import(url)")(base + "pdf.min.mjs").then((library) => {
          library.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.mjs";
          return library;
        }).catch((error) => {
          libraryPromise = null;
          throw error;
        });
      }
      return libraryPromise;
    }
    async function resolvePDF(bundle, zoteroDirectory) {
      const candidates = [path2.join(zoteroDirectory, "storage", bundle.pdf.attachmentKey, bundle.pdf.filename), bundle.pdf.path].filter(Boolean);
      for (const filename of candidates) {
        try {
          if ((await fs.stat(filename)).isFile()) return filename;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      throw new Error("\u672A\u627E\u5230\u539F PDF\u3002\u8BF7\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u6307\u5B9A\u8FD9\u53F0\u7535\u8111\u7684 Zotero \u6570\u636E\u76EE\u5F55\u3002");
    }
    var PDFSession2 = class {
      constructor(plugin) {
        this.plugin = plugin;
        this.document = null;
        this.task = null;
        this.renderTask = null;
        this.closed = false;
      }
      async open(bundle) {
        const filename = await resolvePDF(bundle, this.plugin.settings.zoteroDirectory);
        const [library, buffer] = await Promise.all([loadPDFLibrary(this.plugin), fs.readFile(filename)]);
        if (this.closed) throw new Error("PDF \u9605\u8BFB\u5668\u5DF2\u5173\u95ED\u3002");
        if (bundle.pdf.hash && createHash("md5").update(buffer).digest("hex") !== bundle.pdf.hash) throw new Error("\u539F PDF \u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u5BFC\u5165\u4EE5\u66F4\u65B0\u9875\u7801\u5B9A\u4F4D\u3002");
        const base = this.plugin.assetURL("");
        this.task = library.getDocument({ data: new Uint8Array(buffer), cMapUrl: base + "cmaps/", cMapPacked: true, standardFontDataUrl: base + "standard_fonts/", wasmUrl: base + "wasm/", isEvalSupported: false });
        const document2 = await this.task.promise;
        if (this.closed) throw new Error("PDF \u9605\u8BFB\u5668\u5DF2\u5173\u95ED\u3002");
        this.document = document2;
        return this;
      }
      async cancelRender() {
        const task = this.renderTask;
        if (!task) return;
        task.cancel();
        try {
          await task.promise;
        } catch (_) {
        }
        if (this.renderTask === task) this.renderTask = null;
      }
      async paint(pageNumber, canvas, width, crop = null) {
        if (this.closed || !this.document) return null;
        await this.cancelRender();
        const page = await this.document.getPage(pageNumber);
        if (this.closed) return null;
        const scale = Math.min(2, width / Math.max(1, crop ? crop[2] - crop[0] : page.getViewport({ scale: 1 }).width));
        const viewport = page.getViewport({ scale });
        const outputRect = crop ? viewportRectangle2(viewport, crop) : [0, 0, viewport.width, viewport.height];
        const x = Math.min(outputRect[0], outputRect[2]), y = Math.min(outputRect[1], outputRect[3]);
        canvas.width = Math.max(1, Math.ceil(Math.abs(outputRect[2] - outputRect[0])));
        canvas.height = Math.max(1, Math.ceil(Math.abs(outputRect[3] - outputRect[1])));
        const task = page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport, transform: crop ? [1, 0, 0, 1, -x, -y] : void 0 });
        this.renderTask = task;
        try {
          await task.promise;
        } finally {
          if (this.renderTask === task) this.renderTask = null;
          page.cleanup();
        }
        return viewport;
      }
      async releasePageResources() {
        if (!this.renderTask && this.document && !this.closed) await this.document.cleanup();
      }
      close() {
        if (this.closePromise) return this.closePromise;
        this.closed = true;
        this.closePromise = (async () => {
          await this.cancelRender();
          if (this.task) await this.task.destroy();
          this.task = this.document = null;
        })();
        return this.closePromise;
      }
    };
    module2.exports = { PDFSession: PDFSession2, resolvePDF, viewportRectangle: viewportRectangle2 };
  }
});

// obsidian-plugin/src/main.js
var { Plugin, ItemView, Component, Modal, Setting, PluginSettingTab, MarkdownRenderer, Notice, normalizePath, TFile } = require("obsidian");
var os = require("node:os");
var path = require("node:path");
var { importPDF, bundleToMarkdown, validateBundle } = require_reading_bundle();
var { PDFSession, viewportRectangle } = require_pdf_session();
var VIEW = "zotero-bilingual-reading";
var DEFAULTS = { zoteroDirectory: path.join(os.homedir(), "Zotero"), exportFolder: "Zotero \u9605\u8BFB", defaultPDF: false, syncPDF: true };
var safeFilename = (text) => text.replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").slice(0, 110).trim() || "\u6587\u732E";
var ReadingView = class extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.state = {};
    this.visible = /* @__PURE__ */ new Set();
    this.generation = 0;
    this.pageGeneration = 0;
    this.pdfVisible = false;
    this.pdfChain = Promise.resolve();
  }
  getViewType() {
    return VIEW;
  }
  getDisplayText() {
    return this.bundle?.title || "Zotero \u53CC\u8BED\u9605\u8BFB";
  }
  getIcon() {
    return "book-open";
  }
  getState() {
    return { ...this.state, blockId: this.activeBlock?.id, pdfVisible: this.pdfVisible };
  }
  async setState(state, result) {
    this.state = { ...state };
    if (state.bundlePath) await this.openBundle(state.bundlePath, state.notePath);
    await super.setState(state, result);
  }
  async onOpen() {
    this.contentEl.addClass("zrb-reader");
  }
  async onClose() {
    this.generation++;
    this.pageGeneration++;
    this.pdfVisible = false;
    this.observer?.disconnect();
    this.renderObserver?.disconnect();
    this.resizeObserver?.disconnect();
    for (const element of this.blockElements?.values() || []) this.releaseBlock(element);
    if (this.frame) cancelAnimationFrame(this.frame);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.savePosition();
    await this.pdfSession?.close();
    this.pdfSession = null;
    if (this.canvas) this.canvas.width = this.canvas.height = 0;
  }
  async openBundle(bundlePath, notePath) {
    const generation = ++this.generation;
    this.observer?.disconnect();
    this.renderObserver?.disconnect();
    this.resizeObserver?.disconnect();
    for (const element of this.blockElements?.values() || []) this.releaseBlock(element);
    await this.pdfSession?.close();
    this.pdfSession = null;
    this.bundle = validateBundle(JSON.parse(await this.app.vault.adapter.read(bundlePath)));
    if (generation !== this.generation) return;
    this.state.bundlePath = bundlePath;
    this.state.notePath = notePath;
    this.contentEl.empty();
    this.visible.clear();
    this.activeBlock = null;
    this.currentPage = null;
    this.pdfVisible = false;
    const toolbar = this.contentEl.createDiv({ cls: "zrb-toolbar" });
    toolbar.createSpan({ text: this.bundle.title, cls: "zrb-title" });
    this.pdfButton = toolbar.createEl("button", { text: "\u5C55\u5F00 PDF" });
    this.pdfButton.onclick = () => this.togglePDF();
    toolbar.createEl("a", { text: "\u56DE\u5230 Zotero", href: this.bundle.zoteroURI, cls: "zrb-zotero-link" });
    const notes = toolbar.createEl("button", { text: "\u5199\u7B14\u8BB0" });
    notes.onclick = async () => {
      const file = this.app.vault.getAbstractFileByPath(this.state.notePath);
      if (file instanceof TFile) await this.app.workspace.getLeaf("split").openFile(file);
    };
    this.layout = this.contentEl.createDiv({ cls: "zrb-layout" });
    this.reading = this.layout.createDiv({ cls: "zrb-reading" });
    this.reading.setAttribute("tabindex", "0");
    this.reading.createDiv({ cls: "zrb-summary", text: `${this.bundle.stats?.translated || 0} \u6BB5\u5DF2\u6709\u8BD1\u6587 \xB7 ${this.bundle.pages.length} \u9875` });
    this.blockElements = /* @__PURE__ */ new Map();
    for (const block of this.bundle.blocks) {
      const element = this.reading.createEl("section", { cls: "zrb-block" });
      element.dataset.blockId = block.id;
      element._zrbBlock = block;
      this.blockElements.set(block.id, element);
      const locator = element.createDiv({ cls: "zrb-locator" });
      for (const page of block.pages) {
        const button = locator.createEl("button", { text: `PDF ${page}` });
        button.onclick = async () => {
          this.activeBlock = block;
          if (!this.pdfVisible) await this.togglePDF(true);
          await this.showPage(page, block);
        };
      }
      element.style.minHeight = "130px";
      if (generation !== this.generation) return;
    }
    this.pdfPane = this.layout.createDiv({ cls: "zrb-pdf-pane" });
    this.pdfPane.hidden = true;
    const controls = this.pdfPane.createDiv({ cls: "zrb-pdf-controls" });
    const previous = controls.createEl("button", { text: "\u4E0A\u4E00\u9875" }), next = controls.createEl("button", { text: "\u4E0B\u4E00\u9875" });
    this.pageLabel = controls.createSpan();
    const follow = controls.createEl("label", { cls: "zrb-follow" });
    this.follow = follow.createEl("input", { type: "checkbox" });
    this.follow.checked = this.plugin.settings.syncPDF;
    follow.appendText("\u968F\u6B63\u6587\u7FFB\u9875");
    this.follow.onchange = () => {
      if (this.follow.checked && this.activeBlock?.pages.length) this.showPage(this.activeBlock.pages[0], this.activeBlock);
    };
    previous.onclick = () => this.navigatePage((this.currentPage || 1) - 1);
    next.onclick = () => this.navigatePage((this.currentPage || 1) + 1);
    this.pdfStatus = this.pdfPane.createDiv({ cls: "zrb-pdf-status" });
    this.canvasBox = this.pdfPane.createDiv({ cls: "zrb-canvas-box" });
    this.canvas = this.canvasBox.createEl("canvas");
    this.highlight = this.canvasBox.createDiv({ cls: "zrb-highlight" });
    this.reading.onscroll = () => this.scheduleSync();
    this.renderObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) this.renderBlock(entry.target);
        else this.releaseBlock(entry.target);
      }
    }, { root: this.reading, rootMargin: "800px 0px" });
    for (const element of this.blockElements.values()) this.renderObserver.observe(element);
    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) this.visible.add(entry.target);
        else this.visible.delete(entry.target);
      }
      this.scheduleSync();
    }, { root: this.reading, rootMargin: "0px 0px -55% 0px" });
    for (const element of this.blockElements.values()) this.observer.observe(element);
    this.resizeObserver = new ResizeObserver(() => {
      if (this.pdfVisible && this.currentPage && Math.abs(this.pdfPane.clientWidth - (this.lastPaneWidth || 0)) > 15) this.showPage(this.currentPage, this.activeBlock, true);
    });
    this.resizeObserver.observe(this.pdfPane);
    const saved = this.state.blockId || this.plugin.positions[bundlePath];
    const first = this.bundle.blocks.find((block) => block.id === saved) || this.bundle.blocks[0];
    if (first) {
      this.activeBlock = first;
      const element = this.blockElements.get(first.id);
      await this.renderBlock(element);
      element.scrollIntoView({ block: "start" });
    }
    if (this.state.pdfVisible ?? this.plugin.settings.defaultPDF) await this.togglePDF(true);
  }
  async renderBlock(element) {
    if (element._zrbComponent) return;
    const block = element._zrbBlock, component = new Component();
    element._zrbComponent = component;
    this.addChild(component);
    const generation = this.generation;
    const content = element.createDiv({ cls: "zrb-block-content" });
    element._zrbContent = content;
    try {
      if (block.crops?.length) {
        const figures = content.createDiv({ cls: "zrb-figures" });
        for (const crop of block.crops) {
          if (crop.image) {
            const image = figures.createEl("img");
            image.src = this.app.vault.adapter.getResourcePath(crop.image);
            image.alt = block.type === "math" ? "\u539F\u6587\u516C\u5F0F" : block.original.slice(0, 100) || "\u539F\u6587\u56FE\u8868";
            image.loading = "lazy";
            image.decoding = "async";
          } else {
            const button = figures.createEl("button", { text: `\u67E5\u770B${block.type === "math" ? "\u516C\u5F0F" : "\u56FE\u8868"}\uFF08PDF ${crop.page}\uFF09` });
            button.onclick = async () => {
              if (!this.pdfVisible) await this.togglePDF(true);
              await this.showPage(crop.page, block);
            };
          }
        }
      } else {
        const source = content.createDiv({ cls: "zrb-original" });
        const markdown = block.type === "heading" ? "#".repeat(block.level || 2) + " " + block.markdown : block.markdown;
        await MarkdownRenderer.render(this.app, markdown || block.original, source, this.state.bundlePath, component);
      }
      if (generation !== this.generation || element._zrbComponent !== component) return;
      if (block.translated) await MarkdownRenderer.render(this.app, block.translated, content.createDiv({ cls: "zrb-translation" }), this.state.bundlePath, component);
      if (generation !== this.generation || element._zrbComponent !== component) return;
      const edit = content.createEl("button", { text: "\u7F16\u8F91 Markdown", cls: "zrb-edit-block" });
      edit.onclick = () => new BlockEditModal(this.app, this, element).open();
      element.style.minHeight = "";
    } catch (error) {
      if (element._zrbComponent === component) content.createDiv({ text: "\u6E32\u67D3\u5931\u8D25\uFF1A" + error.message });
    } finally {
      if (element._zrbComponent !== component) component.unload();
    }
  }
  releaseBlock(element) {
    const component = element._zrbComponent;
    if (!component) return;
    const height = element.getBoundingClientRect().height;
    if (height > 0) element.style.minHeight = `${height}px`;
    element._zrbComponent = null;
    this.removeChild(component);
    element._zrbContent?.remove();
    element._zrbContent = null;
  }
  scheduleSync() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      const top = this.reading.getBoundingClientRect().top + 35;
      const candidates = [...this.visible].map((element) => ({ element, rect: element.getBoundingClientRect() })).filter(({ rect }) => rect.bottom > top);
      candidates.sort((a, b) => (a.rect.top <= top ? 0 : a.rect.top - top) - (b.rect.top <= top ? 0 : b.rect.top - top));
      const block = candidates[0]?.element._zrbBlock;
      if (!block || block.id === this.activeBlock?.id) return;
      this.activeBlock = block;
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.savePosition(), 500);
      if (this.pdfVisible && this.follow.checked && block.pages.length) this.showPage(block.pages[0], block);
    });
  }
  savePosition() {
    if (!this.state.bundlePath || !this.activeBlock) return;
    this.plugin.positions[this.state.bundlePath] = this.activeBlock.id;
    this.plugin.persist().catch(console.error);
  }
  async togglePDF(force) {
    const visible = force ?? !this.pdfVisible;
    if (visible === this.pdfVisible) return;
    this.pdfVisible = visible;
    this.layout.toggleClass("zrb-split", visible);
    this.pdfPane.hidden = !visible;
    this.pdfButton.textContent = visible ? "\u6536\u8D77 PDF" : "\u5C55\u5F00 PDF";
    if (visible) await this.showPage(this.activeBlock?.pages[0] || 1, this.activeBlock, true);
    else {
      this.pageGeneration++;
      const session = this.pdfSession;
      this.pdfSession = null;
      await session?.close();
      this.currentPage = null;
      this.canvas.width = this.canvas.height = 0;
      this.highlight.empty();
    }
  }
  navigatePage(page) {
    page = Math.min(this.bundle.pages.length, Math.max(1, page));
    const block = this.bundle.blocks.find((block2) => block2.pages.includes(page));
    if (block && this.follow.checked) {
      this.activeBlock = block;
      this.blockElements.get(block.id)?.scrollIntoView({ block: "start" });
    }
    this.showPage(page, block);
  }
  drawHighlight(block, page) {
    this.highlight.empty();
    if (!this.viewport || !block) return;
    for (const rect of block.rects || []) {
      if (rect[0] + 1 !== page) continue;
      const converted = viewportRectangle(this.viewport, rect.slice(1));
      const mark = this.highlight.createDiv({ cls: "zrb-highlight-rect" });
      mark.style.left = `${Math.min(converted[0], converted[2]) / this.viewport.width * 100}%`;
      mark.style.top = `${Math.min(converted[1], converted[3]) / this.viewport.height * 100}%`;
      mark.style.width = `${Math.abs(converted[2] - converted[0]) / this.viewport.width * 100}%`;
      mark.style.height = `${Math.abs(converted[3] - converted[1]) / this.viewport.height * 100}%`;
    }
  }
  async showPage(page, block, force = false) {
    if (!this.pdfVisible) return;
    if (this.currentPage === page && !force) {
      this.drawHighlight(block, page);
      return;
    }
    const request = ++this.pageGeneration;
    this.pdfSession?.renderTask?.cancel();
    const run = async () => {
      if (request !== this.pageGeneration || !this.pdfVisible) return;
      try {
        this.pdfStatus.textContent = "\u6B63\u5728\u52A0\u8F7D\u539F PDF\u2026";
        if (!this.pdfSession) {
          const session2 = new PDFSession(this.plugin);
          this.pdfSession = session2;
          await session2.open(this.bundle);
        }
        const session = this.pdfSession;
        if (!session || request !== this.pageGeneration || !this.pdfVisible) return;
        this.lastPaneWidth = this.pdfPane.clientWidth;
        const width = Math.max(300, Math.min(1400, (this.lastPaneWidth - 24) * Math.min(window.devicePixelRatio || 1, 1.5)));
        const viewport = await session.paint(page, this.canvas, width);
        if (!viewport || request !== this.pageGeneration || !this.pdfVisible) return;
        this.viewport = viewport;
        this.currentPage = page;
        this.pageLabel.textContent = `${page} / ${this.bundle.pages.length}`;
        this.pdfStatus.textContent = "";
        this.drawHighlight(block, page);
        await session.releasePageResources();
      } catch (error) {
        if (request === this.pageGeneration && this.pdfVisible) {
          this.pdfStatus.textContent = error.message;
          const session = this.pdfSession;
          this.pdfSession = null;
          await session?.close();
        }
      }
    };
    this.pdfChain = this.pdfChain.then(run, run);
    return this.pdfChain;
  }
};
var BlockEditModal = class extends Modal {
  constructor(app, view, element) {
    super(app);
    this.view = view;
    this.element = element;
  }
  onOpen() {
    const block = this.element._zrbBlock;
    this.contentEl.createEl("h3", { text: "\u7F16\u8F91\u6BB5\u843D Markdown" });
    this.contentEl.createEl("p", { text: "\u4FEE\u6539\u4FDD\u5B58\u5728 Obsidian \u9605\u8BFB\u5185\u5BB9\u4E2D\u3002\u539F PDF \u548C Zotero \u7684\u7FFB\u8BD1\u7F13\u5B58\u4FDD\u6301\u539F\u6837\u3002" });
    this.contentEl.createEl("label", { text: "\u539F\u6587" });
    const original = this.contentEl.createEl("textarea", { cls: "zrb-editor" });
    original.value = block.markdown || block.original;
    original.disabled = Boolean(block.crops?.length);
    this.contentEl.createEl("label", { text: "\u8BD1\u6587" });
    const translated = this.contentEl.createEl("textarea", { cls: "zrb-editor" });
    translated.value = block.translated || "";
    const save = this.contentEl.createEl("button", { text: "\u4FDD\u5B58", cls: "mod-cta" });
    save.onclick = async () => {
      save.disabled = true;
      const previous = { markdown: block.markdown, original: block.original, translated: block.translated };
      const generation = this.view.generation, bundlePath = this.view.state.bundlePath;
      try {
        if (!original.disabled) {
          block.markdown = original.value;
          block.original = original.value;
        }
        block.translated = translated.value || null;
        this.view.bundle.stats.translated = this.view.bundle.blocks.filter((item) => item.translated).length;
        await this.app.vault.adapter.write(bundlePath, JSON.stringify(this.view.bundle));
        await this.app.vault.adapter.write(bundlePath.replace(/\.zrb\.json$/, ".reading.md"), bundleToMarkdown(this.view.bundle, bundlePath));
        if (generation === this.view.generation) {
          this.view.releaseBlock(this.element);
          await this.view.renderBlock(this.element);
        }
        this.close();
      } catch (error) {
        Object.assign(block, previous);
        new Notice(error.message, 1e4);
        save.disabled = false;
      }
    };
  }
  onClose() {
    this.contentEl.empty();
  }
};
var ImportModal = class extends Modal {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
  }
  onOpen() {
    this.contentEl.createEl("h2", { text: "\u5BFC\u5165 Zotero \u53CC\u8BED\u9605\u8BFB\u5185\u5BB9" });
    this.contentEl.createEl("p", { text: "\u9009\u62E9\u5DF2\u5728 Zotero \u4E2D\u6253\u5F00\u8FC7\u9605\u8BFB\u6A21\u5F0F\u7684 PDF\u3002\u4F1A\u8BFB\u53D6\u5DF2\u6709\u8BD1\u6587\uFF0C\u4E0D\u8C03\u7528\u7FFB\u8BD1 API\u3002" });
    let filename = "";
    const row = new Setting(this.contentEl).setName("\u539F PDF \u8DEF\u5F84").addText((text) => text.setPlaceholder("/\u2026/Zotero/storage/\u2026/paper.pdf").onChange((value) => {
      filename = value.trim();
    }));
    const input = row.controlEl.querySelector("input");
    new Setting(this.contentEl).addButton((button) => button.setButtonText("\u9009\u62E9 PDF").onClick(() => {
      const picker = this.contentEl.createEl("input", { type: "file" });
      picker.accept = ".pdf";
      picker.hidden = true;
      picker.onchange = () => {
        const file = picker.files?.[0];
        if (file) {
          filename = require("electron").webUtils?.getPathForFile(file) || file.path || "";
          input.value = filename;
        }
        picker.remove();
      };
      picker.click();
    })).addButton((button) => button.setButtonText("\u5BFC\u5165\u5E76\u9605\u8BFB").setCta().onClick(async () => {
      if (!filename) return new Notice("\u8BF7\u5148\u9009\u62E9\u539F PDF\u3002");
      button.setDisabled(true);
      try {
        const result = await this.plugin.importFile(filename);
        this.close();
        await this.plugin.openReading(result.bundlePath, result.notePath);
      } catch (error) {
        new Notice(error.code === "ENOENT" ? "\u672A\u627E\u5230 PDF \u6216\u9605\u8BFB\u6A21\u5F0F\u7F13\u5B58\uFF0C\u8BF7\u5148\u5728 Zotero \u4E2D\u6253\u5F00\u8FD9\u7BC7 PDF \u7684\u9605\u8BFB\u6A21\u5F0F\u3002" : error.message, 1e4);
        button.setDisabled(false);
      }
    }));
  }
  onClose() {
    this.contentEl.empty();
  }
};
var LibraryModal = class extends Modal {
  constructor(plugin, files) {
    super(plugin.app);
    this.plugin = plugin;
    this.files = files;
  }
  onOpen() {
    this.contentEl.createEl("h2", { text: "\u53CC\u8BED\u9605\u8BFB\u6587\u732E" });
    const search = this.contentEl.createEl("input", { type: "search", placeholder: "\u641C\u7D22\u6807\u9898" });
    const list = this.contentEl.createDiv({ cls: "zrb-library" });
    const draw = () => {
      list.empty();
      for (const file of this.files.filter((file2) => file2.toLowerCase().includes(search.value.toLowerCase()))) {
        const button = list.createEl("button", { text: path.basename(file, ".zrb.json") });
        button.onclick = () => {
          this.close();
          this.plugin.openReading(file, file.replace(/\.zrb\.json$/, ".md"));
        };
      }
    };
    search.oninput = draw;
    draw();
    search.focus();
  }
};
var ReaderSettings = class extends PluginSettingTab {
  constructor(plugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }
  display() {
    this.containerEl.empty();
    new Setting(this.containerEl).setName("Zotero \u6570\u636E\u76EE\u5F55").setDesc("\u7528\u4E8E\u67E5\u627E\u539F PDF\uFF1B\u6362\u7535\u8111\u540E\u53EF\u4EE5\u91CD\u65B0\u6307\u5B9A\u76EE\u5F55\uFF0CPDF \u65E0\u9700\u590D\u5236\u8FDB Obsidian\u3002").addText((text) => text.setValue(this.plugin.settings.zoteroDirectory).onChange(async (value) => {
      this.plugin.settings.zoteroDirectory = value.trim();
      await this.plugin.persist();
    }));
    new Setting(this.containerEl).setName("\u9605\u8BFB\u5185\u5BB9\u5B58\u653E\u76EE\u5F55").addText((text) => text.setValue(this.plugin.settings.exportFolder).onChange(async (value) => {
      this.plugin.settings.exportFolder = normalizePath(value.trim() || DEFAULTS.exportFolder);
      await this.plugin.persist();
    }));
    new Setting(this.containerEl).setName("\u9ED8\u8BA4\u5DE6\u53F3\u5206\u5C4F").setDesc("\u5173\u95ED\u65F6\u5148\u663E\u793A\u6B63\u6587\uFF0C\u9700\u8981\u6838\u5BF9\u65F6\u518D\u5C55\u5F00 PDF\u3002").addToggle((toggle) => toggle.setValue(this.plugin.settings.defaultPDF).onChange(async (value) => {
      this.plugin.settings.defaultPDF = value;
      await this.plugin.persist();
    }));
    new Setting(this.containerEl).setName("PDF \u968F\u6B63\u6587\u7FFB\u9875").addToggle((toggle) => toggle.setValue(this.plugin.settings.syncPDF).onChange(async (value) => {
      this.plugin.settings.syncPDF = value;
      await this.plugin.persist();
    }));
  }
};
module.exports = class BilingualReaderPlugin extends Plugin {
  async onload() {
    const data = await this.loadData() || {};
    this.settings = { ...DEFAULTS, ...data.settings };
    this.positions = data.positions || {};
    this.registerView(VIEW, (leaf) => new ReadingView(leaf, this));
    this.addSettingTab(new ReaderSettings(this));
    this.addRibbonIcon("book-open", "Zotero \u53CC\u8BED\u9605\u8BFB", () => this.openLibrary());
    this.addCommand({ id: "import-zotero-pdf", name: "\u5BFC\u5165 Zotero PDF \u7684\u9605\u8BFB\u6A21\u5F0F\u4E0E\u5DF2\u6709\u8BD1\u6587", callback: () => new ImportModal(this).open() });
    this.addCommand({ id: "open-bilingual-reading", name: "\u6253\u5F00\u53CC\u8BED\u9605\u8BFB", callback: async () => {
      const file = this.app.workspace.getActiveFile();
      const bundlePath = file && this.app.metadataCache.getFileCache(file)?.frontmatter?.zrb_bundle;
      if (typeof bundlePath === "string") await this.openReading(bundlePath, file.path);
      else await this.openLibrary();
    } });
    this.registerObsidianProtocolHandler("zrb", async (params) => {
      if (params.bundle) await this.openReading(normalizePath(params.bundle), params.note ? normalizePath(params.note) : void 0);
    });
  }
  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW);
  }
  persist() {
    const save = () => this.saveData({ settings: this.settings, positions: this.positions });
    this.saveQueue = (this.saveQueue || Promise.resolve()).then(save, save);
    return this.saveQueue;
  }
  assetURL(file) {
    const url = new URL(this.app.vault.adapter.getResourcePath(normalizePath(this.app.vault.configDir + "/plugins/" + this.manifest.id + "/" + file)));
    if (!file) {
      url.search = "";
      url.pathname = url.pathname.replace(/\/?$/, "/");
    }
    return url.href;
  }
  async ensureDirectory(folder) {
    const segments = normalizePath(folder).split("/");
    let current = "";
    for (const segment of segments) {
      current = current ? current + "/" + segment : segment;
      if (!await this.app.vault.adapter.exists(current)) await this.app.vault.createFolder(current);
    }
  }
  async importFile(filename, metadata = {}) {
    const bundle = await importPDF(filename, metadata), folder = normalizePath(this.settings.exportFolder);
    await this.ensureDirectory(folder);
    const base = normalizePath(folder + "/" + safeFilename(bundle.title) + "-" + bundle.pdf.attachmentKey);
    const bundlePath = base + ".zrb.json", notePath = base + ".md", readingPath = base + ".reading.md", assets = base + ".assets";
    await this.ensureDirectory(assets);
    const cropped = bundle.blocks.filter((block) => block.crops?.length);
    if (cropped.length) {
      const notice = new Notice("\u6B63\u5728\u4FDD\u5B58\u9605\u8BFB\u6A21\u5F0F\u7684\u56FE\u8868\u4E0E\u516C\u5F0F\u2026", 0), session = new PDFSession(this), canvas = document.createElement("canvas");
      try {
        await session.open(bundle);
        for (let i = 0; i < cropped.length; i++) {
          const block = cropped[i];
          notice.setMessage(`\u4FDD\u5B58\u56FE\u8868\u4E0E\u516C\u5F0F ${i + 1} / ${cropped.length}`);
          for (let j = 0; j < block.crops.length; j++) {
            const crop = block.crops[j];
            await session.paint(crop.page, canvas, 1e3, crop.rect);
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
            if (!blob) throw new Error("\u65E0\u6CD5\u4FDD\u5B58\u56FE\u8868\u56FE\u7247\u3002");
            crop.image = normalizePath(assets + "/" + block.id + "-" + j + ".png");
            await this.app.vault.adapter.writeBinary(crop.image, await blob.arrayBuffer());
            await session.releasePageResources();
          }
        }
      } finally {
        await session.close();
        canvas.width = canvas.height = 0;
        notice.hide();
      }
    }
    await this.app.vault.adapter.write(bundlePath, JSON.stringify(bundle));
    await this.app.vault.adapter.write(readingPath, bundleToMarkdown(bundle, bundlePath));
    if (!await this.app.vault.adapter.exists(notePath)) {
      const uri = `obsidian://zrb?vault=${encodeURIComponent(this.app.vault.getName())}&bundle=${encodeURIComponent(bundlePath)}&note=${encodeURIComponent(notePath)}`;
      await this.app.vault.create(notePath, `---
title: ${JSON.stringify(bundle.title)}
zrb_bundle: ${JSON.stringify(bundlePath)}
zotero: ${JSON.stringify(bundle.zoteroURI)}
---

# ${bundle.title}

[\u6253\u5F00\u53CC\u8BED\u9605\u8BFB](${uri}) \xB7 [\u56DE\u5230 Zotero](${bundle.zoteroURI}) \xB7 [[${readingPath}|\u9605\u8BFB\u5168\u6587]]

## \u9605\u8BFB\u7B14\u8BB0

`);
    }
    new Notice(`\u5DF2\u5BFC\u5165 ${bundle.stats.translated} \u6BB5\u8BD1\u6587\uFF0C\u539F PDF \u672A\u590D\u5236\u3002`);
    return { bundlePath, notePath, readingPath, bundle };
  }
  async openReading(bundlePath, notePath) {
    try {
      const existing = this.app.workspace.getLeavesOfType(VIEW).find((leaf2) => leaf2.view.state?.bundlePath === bundlePath);
      if (existing) {
        this.app.workspace.revealLeaf(existing);
        return;
      }
      const leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW, active: true, state: { bundlePath, notePath: notePath || bundlePath.replace(/\.zrb\.json$/, ".md") } });
      this.app.workspace.revealLeaf(leaf);
    } catch (error) {
      new Notice(error.message, 1e4);
      console.error(error);
    }
  }
  async openLibrary() {
    try {
      const listing = await this.app.vault.adapter.list(this.settings.exportFolder), files = listing.files.filter((file) => file.endsWith(".zrb.json"));
      if (!files.length) return new ImportModal(this).open();
      new LibraryModal(this, files).open();
    } catch (_) {
      new ImportModal(this).open();
    }
  }
};
