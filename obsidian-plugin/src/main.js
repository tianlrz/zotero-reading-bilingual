const { Plugin, ItemView, Modal, Setting, PluginSettingTab, MarkdownRenderer, Notice, normalizePath, TFile } = require("obsidian");
const os = require("node:os"), path = require("node:path");
const { importPDF, bundleToMarkdown, validateBundle } = require("../../bridge/reading-bundle.cjs");
const { PDFSession, viewportRectangle } = require("./pdf-session.js");

const VIEW = "zotero-bilingual-reading";
const DEFAULTS = { zoteroDirectory: path.join(os.homedir(), "Zotero"), exportFolder: "Zotero 阅读", defaultPDF: false, syncPDF: true };
const safeFilename = (text) => text.replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").slice(0, 110).trim() || "文献";

class ReadingView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf); this.plugin = plugin; this.state = {}; this.visible = new Set(); this.generation = 0; this.pageGeneration = 0; this.pdfVisible = false; this.pdfChain = Promise.resolve();
  }
  getViewType() { return VIEW; }
  getDisplayText() { return this.bundle?.title || "Zotero 双语阅读"; }
  getIcon() { return "book-open"; }
  getState() { return { ...this.state, blockId: this.activeBlock?.id, pdfVisible: this.pdfVisible }; }
  async setState(state, result) {
    this.state = { ...state };
    if (state.bundlePath) await this.openBundle(state.bundlePath, state.notePath);
    await super.setState(state, result);
  }
  async onOpen() { this.contentEl.addClass("zrb-reader"); }
  async onClose() {
    this.generation++; this.pageGeneration++; this.pdfVisible = false;
    this.observer?.disconnect(); this.resizeObserver?.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.savePosition(); await this.pdfSession?.close(); this.pdfSession = null;
    if (this.canvas) this.canvas.width = this.canvas.height = 0;
  }
  async openBundle(bundlePath, notePath) {
    const generation = ++this.generation;
    this.observer?.disconnect(); this.resizeObserver?.disconnect();
    await this.pdfSession?.close(); this.pdfSession = null;
    this.bundle = validateBundle(JSON.parse(await this.app.vault.adapter.read(bundlePath)));
    if (generation !== this.generation) return;
    this.state.bundlePath = bundlePath; this.state.notePath = notePath;
    this.contentEl.empty(); this.visible.clear(); this.activeBlock = null; this.currentPage = null; this.pdfVisible = false;
    const toolbar = this.contentEl.createDiv({ cls: "zrb-toolbar" });
    toolbar.createSpan({ text: this.bundle.title, cls: "zrb-title" });
    this.pdfButton = toolbar.createEl("button", { text: "展开 PDF" });
    this.pdfButton.onclick = () => this.togglePDF();
    toolbar.createEl("a", { text: "回到 Zotero", href: this.bundle.zoteroURI, cls: "zrb-zotero-link" });
    const notes = toolbar.createEl("button", { text: "写笔记" });
    notes.onclick = async () => {
      const file = this.app.vault.getAbstractFileByPath(this.state.notePath);
      if (file instanceof TFile) await this.app.workspace.getLeaf("split").openFile(file);
    };
    this.layout = this.contentEl.createDiv({ cls: "zrb-layout" });
    this.reading = this.layout.createDiv({ cls: "zrb-reading" }); this.reading.setAttribute("tabindex", "0");
    this.reading.createDiv({ cls: "zrb-summary", text: `${this.bundle.stats?.translated || 0} 段已有译文 · ${this.bundle.pages.length} 页` });
    this.blockElements = new Map();
    for (const block of this.bundle.blocks) {
      const element = this.reading.createEl("section", { cls: "zrb-block" });
      element.dataset.blockId = block.id; element._zrbBlock = block; this.blockElements.set(block.id, element);
      const locator = element.createDiv({ cls: "zrb-locator" });
      for (const page of block.pages) {
        const button = locator.createEl("button", { text: `PDF ${page}` });
        button.onclick = async () => { this.activeBlock = block; if (!this.pdfVisible) await this.togglePDF(true); await this.showPage(page, block); };
      }
      if (block.crops?.length) {
        const figures = element.createDiv({ cls: "zrb-figures" });
        for (const crop of block.crops) {
          if (crop.image) {
            const image = figures.createEl("img");
            image.src = this.app.vault.adapter.getResourcePath(crop.image);
            image.alt = block.type === "math" ? "原文公式" : (block.original.slice(0, 100) || "原文图表");
            image.loading = "lazy"; image.decoding = "async";
          } else {
            const button = figures.createEl("button", { text: `查看${block.type === "math" ? "公式" : "图表"}（PDF ${crop.page}）` });
            button.onclick = async () => { if (!this.pdfVisible) await this.togglePDF(true); await this.showPage(crop.page, block); };
          }
        }
      } else {
        const source = element.createDiv({ cls: "zrb-original" });
        const markdown = block.type === "heading" ? "#".repeat(block.level || 2) + " " + block.markdown : block.markdown;
        await MarkdownRenderer.render(this.app, markdown || block.original, source, bundlePath, this);
      }
      if (block.translated) await MarkdownRenderer.render(this.app, block.translated, element.createDiv({ cls: "zrb-translation" }), bundlePath, this);
      if (generation !== this.generation) return;
    }
    this.pdfPane = this.layout.createDiv({ cls: "zrb-pdf-pane" }); this.pdfPane.hidden = true;
    const controls = this.pdfPane.createDiv({ cls: "zrb-pdf-controls" });
    const previous = controls.createEl("button", { text: "上一页" }), next = controls.createEl("button", { text: "下一页" });
    this.pageLabel = controls.createSpan();
    const follow = controls.createEl("label", { cls: "zrb-follow" });
    this.follow = follow.createEl("input", { type: "checkbox" }); this.follow.checked = this.plugin.settings.syncPDF; follow.appendText("随正文翻页");
    this.follow.onchange = () => { if (this.follow.checked && this.activeBlock?.pages.length) this.showPage(this.activeBlock.pages[0], this.activeBlock); };
    previous.onclick = () => this.navigatePage((this.currentPage || 1) - 1); next.onclick = () => this.navigatePage((this.currentPage || 1) + 1);
    this.pdfStatus = this.pdfPane.createDiv({ cls: "zrb-pdf-status" });
    this.canvasBox = this.pdfPane.createDiv({ cls: "zrb-canvas-box" });
    this.canvas = this.canvasBox.createEl("canvas"); this.highlight = this.canvasBox.createDiv({ cls: "zrb-highlight" });
    this.registerDomEvent(this.reading, "scroll", () => this.scheduleSync());
    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) { if (entry.isIntersecting) this.visible.add(entry.target); else this.visible.delete(entry.target); }
      this.scheduleSync();
    }, { root: this.reading, rootMargin: "0px 0px -55% 0px" });
    for (const element of this.blockElements.values()) this.observer.observe(element);
    this.resizeObserver = new ResizeObserver(() => {
      if (this.pdfVisible && this.currentPage && Math.abs(this.pdfPane.clientWidth - (this.lastPaneWidth || 0)) > 15) this.showPage(this.currentPage, this.activeBlock, true);
    }); this.resizeObserver.observe(this.pdfPane);
    const saved = this.state.blockId || this.plugin.positions[bundlePath];
    const first = this.bundle.blocks.find((block) => block.id === saved) || this.bundle.blocks[0];
    if (first) { this.activeBlock = first; this.blockElements.get(first.id)?.scrollIntoView({ block: "start" }); }
    if (this.state.pdfVisible ?? this.plugin.settings.defaultPDF) await this.togglePDF(true);
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
      clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.savePosition(), 500);
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
    this.pdfVisible = visible; this.layout.toggleClass("zrb-split", visible); this.pdfPane.hidden = !visible;
    this.pdfButton.textContent = visible ? "收起 PDF" : "展开 PDF";
    if (visible) await this.showPage(this.activeBlock?.pages[0] || 1, this.activeBlock, true);
    else {
      this.pageGeneration++;
      const session = this.pdfSession; this.pdfSession = null; await session?.close();
      this.currentPage = null; this.canvas.width = this.canvas.height = 0; this.highlight.empty();
    }
  }
  navigatePage(page) {
    page = Math.min(this.bundle.pages.length, Math.max(1, page));
    const block = this.bundle.blocks.find((block) => block.pages.includes(page));
    if (block && this.follow.checked) { this.activeBlock = block; this.blockElements.get(block.id)?.scrollIntoView({ block: "start" }); }
    this.showPage(page, block);
  }
  drawHighlight(block, page) {
    this.highlight.empty(); if (!this.viewport || !block) return;
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
    if (this.currentPage === page && !force) { this.drawHighlight(block, page); return; }
    const request = ++this.pageGeneration;
    this.pdfSession?.renderTask?.cancel();
    const run = async () => {
      if (request !== this.pageGeneration || !this.pdfVisible) return;
      try {
        this.pdfStatus.textContent = "正在加载原 PDF…";
        if (!this.pdfSession) { const session = new PDFSession(this.plugin); this.pdfSession = session; await session.open(this.bundle); }
        const session = this.pdfSession;
        if (!session || request !== this.pageGeneration || !this.pdfVisible) return;
        this.lastPaneWidth = this.pdfPane.clientWidth;
        const width = Math.max(300, Math.min(1400, (this.lastPaneWidth - 24) * Math.min(window.devicePixelRatio || 1, 1.5)));
        const viewport = await session.paint(page, this.canvas, width);
        if (!viewport || request !== this.pageGeneration || !this.pdfVisible) return;
        this.viewport = viewport; this.currentPage = page;
        this.pageLabel.textContent = `${page} / ${this.bundle.pages.length}`;
        this.pdfStatus.textContent = ""; this.drawHighlight(block, page); await session.releasePageResources();
      } catch (error) {
        if (request === this.pageGeneration && this.pdfVisible) { this.pdfStatus.textContent = error.message; const session = this.pdfSession; this.pdfSession = null; await session?.close(); }
      }
    };
    this.pdfChain = this.pdfChain.then(run, run); return this.pdfChain;
  }
}

class ImportModal extends Modal {
  constructor(plugin) { super(plugin.app); this.plugin = plugin; }
  onOpen() {
    this.contentEl.createEl("h2", { text: "导入 Zotero 双语阅读内容" });
    this.contentEl.createEl("p", { text: "选择已在 Zotero 中打开过阅读模式的 PDF。会读取已有译文，不调用翻译 API。" });
    let filename = "";
    const row = new Setting(this.contentEl).setName("原 PDF 路径").addText((text) => text.setPlaceholder("/…/Zotero/storage/…/paper.pdf").onChange((value) => { filename = value.trim(); }));
    const input = row.controlEl.querySelector("input");
    new Setting(this.contentEl).addButton((button) => button.setButtonText("选择 PDF").onClick(() => {
      const picker = this.contentEl.createEl("input", { type: "file" }); picker.accept = ".pdf"; picker.hidden = true;
      picker.onchange = () => {
        const file = picker.files?.[0];
        if (file) { filename = require("electron").webUtils?.getPathForFile(file) || file.path || ""; input.value = filename; }
        picker.remove();
      }; picker.click();
    })).addButton((button) => button.setButtonText("导入并阅读").setCta().onClick(async () => {
      if (!filename) return new Notice("请先选择原 PDF。");
      button.setDisabled(true);
      try { const result = await this.plugin.importFile(filename); this.close(); await this.plugin.openReading(result.bundlePath, result.notePath); }
      catch (error) { new Notice(error.code === "ENOENT" ? "未找到 PDF 或阅读模式缓存，请先在 Zotero 中打开这篇 PDF 的阅读模式。" : error.message, 10000); button.setDisabled(false); }
    }));
  }
  onClose() { this.contentEl.empty(); }
}

class LibraryModal extends Modal {
  constructor(plugin, files) { super(plugin.app); this.plugin = plugin; this.files = files; }
  onOpen() {
    this.contentEl.createEl("h2", { text: "双语阅读文献" });
    const search = this.contentEl.createEl("input", { type: "search", placeholder: "搜索标题" });
    const list = this.contentEl.createDiv({ cls: "zrb-library" });
    const draw = () => {
      list.empty();
      for (const file of this.files.filter((file) => file.toLowerCase().includes(search.value.toLowerCase()))) {
        const button = list.createEl("button", { text: path.basename(file, ".zrb.json") });
        button.onclick = () => { this.close(); this.plugin.openReading(file, file.replace(/\.zrb\.json$/, ".md")); };
      }
    }; search.oninput = draw; draw(); search.focus();
  }
}

class ReaderSettings extends PluginSettingTab {
  constructor(plugin) { super(plugin.app, plugin); this.plugin = plugin; }
  display() {
    this.containerEl.empty();
    new Setting(this.containerEl).setName("Zotero 数据目录").setDesc("用于查找原 PDF；换电脑后可以重新指定目录，PDF 无需复制进 Obsidian。").addText((text) => text.setValue(this.plugin.settings.zoteroDirectory).onChange(async (value) => { this.plugin.settings.zoteroDirectory = value.trim(); await this.plugin.persist(); }));
    new Setting(this.containerEl).setName("阅读内容存放目录").addText((text) => text.setValue(this.plugin.settings.exportFolder).onChange(async (value) => { this.plugin.settings.exportFolder = normalizePath(value.trim() || DEFAULTS.exportFolder); await this.plugin.persist(); }));
    new Setting(this.containerEl).setName("默认左右分屏").setDesc("关闭时先显示正文，需要核对时再展开 PDF。").addToggle((toggle) => toggle.setValue(this.plugin.settings.defaultPDF).onChange(async (value) => { this.plugin.settings.defaultPDF = value; await this.plugin.persist(); }));
    new Setting(this.containerEl).setName("PDF 随正文翻页").addToggle((toggle) => toggle.setValue(this.plugin.settings.syncPDF).onChange(async (value) => { this.plugin.settings.syncPDF = value; await this.plugin.persist(); }));
  }
}

module.exports = class BilingualReaderPlugin extends Plugin {
  async onload() {
    const data = await this.loadData() || {};
    this.settings = { ...DEFAULTS, ...data.settings }; this.positions = data.positions || {};
    this.registerView(VIEW, (leaf) => new ReadingView(leaf, this)); this.addSettingTab(new ReaderSettings(this));
    this.addRibbonIcon("book-open", "Zotero 双语阅读", () => this.openLibrary());
    this.addCommand({ id: "import-zotero-pdf", name: "导入 Zotero PDF 的阅读模式与已有译文", callback: () => new ImportModal(this).open() });
    this.addCommand({ id: "open-bilingual-reading", name: "打开双语阅读", callback: async () => {
      const file = this.app.workspace.getActiveFile();
      const bundlePath = file && this.app.metadataCache.getFileCache(file)?.frontmatter?.zrb_bundle;
      if (typeof bundlePath === "string") await this.openReading(bundlePath, file.path); else await this.openLibrary();
    } });
    this.registerObsidianProtocolHandler("zrb", async (params) => { if (params.bundle) await this.openReading(normalizePath(params.bundle), params.note ? normalizePath(params.note) : undefined); });
  }
  onunload() { this.app.workspace.detachLeavesOfType(VIEW); }
  persist() {
    const save = () => this.saveData({ settings: this.settings, positions: this.positions });
    this.saveQueue = (this.saveQueue || Promise.resolve()).then(save, save); return this.saveQueue;
  }
  assetURL(file) {
    const url = new URL(this.app.vault.adapter.getResourcePath(normalizePath(this.app.vault.configDir + "/plugins/" + this.manifest.id + "/" + file)));
    if (!file) { url.search = ""; url.pathname = url.pathname.replace(/\/?$/, "/"); }
    return url.href;
  }
  async ensureDirectory(folder) {
    const segments = normalizePath(folder).split("/"); let current = "";
    for (const segment of segments) { current = current ? current + "/" + segment : segment; if (!(await this.app.vault.adapter.exists(current))) await this.app.vault.createFolder(current); }
  }
  async importFile(filename, metadata = {}) {
    const bundle = await importPDF(filename, metadata), folder = normalizePath(this.settings.exportFolder);
    await this.ensureDirectory(folder);
    const base = normalizePath(folder + "/" + safeFilename(bundle.title) + "-" + bundle.pdf.attachmentKey);
    const bundlePath = base + ".zrb.json", notePath = base + ".md", readingPath = base + ".reading.md", assets = base + ".assets";
    await this.ensureDirectory(assets);
    const cropped = bundle.blocks.filter((block) => block.crops?.length);
    if (cropped.length) {
      const notice = new Notice("正在保存阅读模式的图表与公式…", 0), session = new PDFSession(this), canvas = document.createElement("canvas");
      try {
        await session.open(bundle);
        for (let i = 0; i < cropped.length; i++) {
          const block = cropped[i]; notice.setMessage(`保存图表与公式 ${i + 1} / ${cropped.length}`);
          for (let j = 0; j < block.crops.length; j++) {
            const crop = block.crops[j]; await session.paint(crop.page, canvas, 1000, crop.rect);
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png")); if (!blob) throw new Error("无法保存图表图片。");
            crop.image = normalizePath(assets + "/" + block.id + "-" + j + ".png");
            await this.app.vault.adapter.writeBinary(crop.image, await blob.arrayBuffer()); await session.releasePageResources();
          }
        }
      } finally { await session.close(); canvas.width = canvas.height = 0; notice.hide(); }
    }
    await this.app.vault.adapter.write(bundlePath, JSON.stringify(bundle));
    await this.app.vault.adapter.write(readingPath, bundleToMarkdown(bundle, bundlePath));
    if (!(await this.app.vault.adapter.exists(notePath))) {
      const uri = `obsidian://zrb?vault=${encodeURIComponent(this.app.vault.getName())}&bundle=${encodeURIComponent(bundlePath)}&note=${encodeURIComponent(notePath)}`;
      await this.app.vault.create(notePath, `---\ntitle: ${JSON.stringify(bundle.title)}\nzrb_bundle: ${JSON.stringify(bundlePath)}\nzotero: ${JSON.stringify(bundle.zoteroURI)}\n---\n\n# ${bundle.title}\n\n[打开双语阅读](${uri}) · [回到 Zotero](${bundle.zoteroURI}) · [[${readingPath}|阅读全文]]\n\n## 阅读笔记\n\n`);
    }
    new Notice(`已导入 ${bundle.stats.translated} 段译文，原 PDF 未复制。`); return { bundlePath, notePath, readingPath, bundle };
  }
  async openReading(bundlePath, notePath) {
    try {
      const leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW, active: true, state: { bundlePath, notePath: notePath || bundlePath.replace(/\.zrb\.json$/, ".md") } }); this.app.workspace.revealLeaf(leaf);
    } catch (error) { new Notice(error.message, 10000); console.error(error); }
  }
  async openLibrary() {
    try {
      const listing = await this.app.vault.adapter.list(this.settings.exportFolder), files = listing.files.filter((file) => file.endsWith(".zrb.json"));
      if (!files.length) return new ImportModal(this).open(); new LibraryModal(this, files).open();
    } catch (_) { new ImportModal(this).open(); }
  }
};
