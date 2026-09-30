const { Plugin, Modal, Setting, PluginSettingTab, Notice, normalizePath, TFile } = require('obsidian');
const os = require('node:os'), path = require('node:path');
const { importPDF, bundleToMarkdown, validateBundle } = require('../../bridge/reading-bundle.cjs');
const { resolvePDF, verifyPDF, linkPDF, readAnchors, anchorAtLine, nativePDF, waitForPDF, visibleMarkdownLine, scrollMarkdownToLine } = require('./native-reader.js');
const DEFAULTS = { zoteroDirectory: path.join(os.homedir(), 'Zotero'), exportFolder: 'Zotero 阅读', defaultPDF: false, syncPDF: true };
const safeFilename = text => text.replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').slice(0,110).trim() || '文献';
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
    new Setting(this.containerEl).setName('Zotero 数据目录').setDesc('原 PDF 保留在此目录，通过符号链接交给 Obsidian 原生阅读器。').addText(t => t.setValue(this.plugin.settings.zoteroDirectory).onChange(async value => { this.plugin.settings.zoteroDirectory = value.trim(); await this.plugin.persist(); }));
    new Setting(this.containerEl).setName('阅读内容存放目录').addText(t => t.setValue(this.plugin.settings.exportFolder).onChange(async value => { this.plugin.settings.exportFolder = normalizePath(value.trim() || DEFAULTS.exportFolder); await this.plugin.persist(); }));
    new Setting(this.containerEl).setName('默认打开 PDF 分屏').addToggle(t => t.setValue(this.plugin.settings.defaultPDF).onChange(async value => { this.plugin.settings.defaultPDF = value; await this.plugin.persist(); }));
    new Setting(this.containerEl).setName('正文与 PDF 同步').addToggle(t => t.setValue(this.plugin.settings.syncPDF).onChange(async value => { this.plugin.settings.syncPDF = value; await this.plugin.persist(); }));
  }
}
module.exports = class BilingualReaderPlugin extends Plugin {
  async onload() {
    const data = await this.loadData() || {}; this.settings = { ...DEFAULTS, ...data.settings }; this.pairs = new Map();
    this.addSettingTab(new ReaderSettings(this));
    this.addRibbonIcon('book-open', 'Zotero 原生双语阅读', () => this.openLibrary());
    this.addCommand({ id: 'import-zotero-pdf', name: '导入 Zotero PDF 的阅读模式与已有译文', callback: () => new ImportModal(this).open() });
    this.addCommand({ id: 'open-bilingual-reading', name: '打开双语阅读', callback: () => this.openCurrent(false) });
    this.addCommand({ id: 'open-synchronized-pdf', name: '打开原生 PDF 分屏并同步', callback: () => this.openCurrent(true) });
    this.addCommand({ id: 'close-synchronized-pdf', name: '收起当前文献的 PDF 分屏', callback: () => {
      const leaf = this.app.workspace.getMostRecentLeaf(), pair = [...this.pairs.values()].find(p => p.markdown === leaf || p.pdf === leaf);
      if (pair) { this.releasePair(pair); pair.pdf.detach(); }
    } });
    this.registerObsidianProtocolHandler('zrb-native', async params => { if (params.bundle) await this.openReading(normalizePath(params.bundle)); });
    this.registerEvent(this.app.workspace.on('layout-change', () => {
      for (const pair of this.pairs.values()) if (pair.markdown.view.file?.path !== pair.readingPath || pair.pdf.view.file?.path !== pair.pdfPath || !pair.markdown.containerEl.isConnected || !pair.pdf.containerEl.isConnected) this.releasePair(pair);
    }));
    this.registerEvent(this.app.vault.on('modify', file => {
      const pair = this.pairs.get(file.path);
      if (pair) this.app.vault.cachedRead(file).then(text => { if (!pair.closed) pair.anchors = readAnchors(text, pair.pageCount); });
    }));
    // The legacy plugin keeps its own views; native sync only opens Markdown/PDF leaves.
  }
  onunload() { for (const pair of this.pairs.values()) this.releasePair(pair); }
  persist() { return this.saveData({ settings: this.settings }); }
  async ensureDirectory(folder) {
    let current = '';
    for (const segment of normalizePath(folder).split('/')) { current = current ? current + '/' + segment : segment; if (!(await this.app.vault.adapter.exists(current))) await this.app.vault.createFolder(current); }
  }
  async pdfFile(bundle, bundlePath) {
    const filename = await resolvePDF(bundle, this.settings.zoteroDirectory); await verifyPDF(filename, bundle.pdf.hash);
    const relative = bundlePath.replace(/\.zrb\.json$/, '.pdf');
    await linkPDF(filename, path.join(this.app.vault.adapter.basePath, relative));
    for (let i = 0; i < 50; i++) { const file = this.app.vault.getAbstractFileByPath(relative); if (file instanceof TFile) return file; await new Promise(r => setTimeout(r,100)); }
    throw new Error('Obsidian 尚未识别 PDF 链接，请稍后重试。');
  }
  async importFile(filename, metadata = {}) {
    const bundle = await importPDF(filename, metadata), folder = normalizePath(this.settings.exportFolder); await this.ensureDirectory(folder);
    const base = normalizePath(folder + '/' + safeFilename(bundle.title) + '-' + bundle.pdf.attachmentKey);
    const bundlePath = base + '.zrb.json', notePath = base + '.md', readingPath = base + '.reading.md', assets = base + '.assets';
    if (await this.app.vault.adapter.exists(readingPath)) {
      const existing = validateBundle(JSON.parse(await this.app.vault.adapter.read(bundlePath)));
      if (existing.pdf.hash !== bundle.pdf.hash) throw new Error('已有阅读正文对应另一版 PDF，请选择新的导入名称。');
      new Notice('已有阅读正文已保留，未覆盖你的 Markdown 修改。'); return { bundlePath, notePath, readingPath, bundle: existing };
    }
    await this.ensureDirectory(assets);
    const cropped = bundle.blocks.filter(b => b.crops?.length);
    if (cropped.length) {
      const file = await this.pdfFile(bundle, bundlePath), leaf = this.app.workspace.getLeaf('tab'), canvas = document.createElement('canvas');
      const notice = new Notice('正在导入图表与公式…', 0);
      try {
        await leaf.openFile(file, { active: false }); const viewer = await waitForPDF(leaf.view);
        for (const block of cropped) for (let i = 0; i < block.crops.length; i++) {
          const crop = block.crops[i], page = await viewer.pdfDocument.getPage(crop.page);
          try {
            const viewport = page.getViewport({ scale: Math.min(2, 1000 / Math.max(1, crop.rect[2] - crop.rect[0])) });
            const [a,b,c,d] = [...viewport.convertToViewportPoint(crop.rect[0],crop.rect[1]), ...viewport.convertToViewportPoint(crop.rect[2],crop.rect[3])];
            canvas.width = Math.max(1,Math.ceil(Math.abs(c-a))); canvas.height = Math.max(1,Math.ceil(Math.abs(d-b)));
            await page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: [1,0,0,1,-Math.min(a,c),-Math.min(b,d)] }).promise;
            const blob = await new Promise(r => canvas.toBlob(r,'image/png')); if (!blob) throw new Error('无法保存图表。');
            crop.image = normalizePath(assets + '/' + block.id + '-' + i + '.png'); await this.app.vault.adapter.writeBinary(crop.image,await blob.arrayBuffer());
          } finally { page.cleanup(); }
        }
      } finally { canvas.width = canvas.height = 0; leaf.detach(); notice.hide(); }
    }
    await this.app.vault.adapter.write(bundlePath,JSON.stringify(bundle));
    await this.app.vault.adapter.write(readingPath,bundleToMarkdown(bundle,bundlePath));
    if (!(await this.app.vault.adapter.exists(notePath))) {
      const uri = `obsidian://zrb-native?vault=${encodeURIComponent(this.app.vault.getName())}&bundle=${encodeURIComponent(bundlePath)}`;
      await this.app.vault.create(notePath,`---\ntitle: ${JSON.stringify(bundle.title)}\nzrb_bundle: ${JSON.stringify(bundlePath)}\nzotero: ${JSON.stringify(bundle.zoteroURI)}\n---\n\n# ${bundle.title}\n\n[打开双语阅读](${uri}) · [回到 Zotero](${bundle.zoteroURI}) · [[${readingPath}|阅读全文]]\n\n## 阅读笔记\n\n`);
    }
    new Notice(`已导入 ${bundle.stats.translated} 段已有译文。`); return { bundlePath,notePath,readingPath,bundle };
  }
  async openCurrent(pdf) {
    const file = this.app.workspace.getActiveFile();
    const bundlePath = file && this.app.metadataCache.getFileCache(file)?.frontmatter?.zrb_bundle;
    if (typeof bundlePath === 'string') await this.openReading(bundlePath,undefined,pdf); else await this.openLibrary();
  }
  async openReading(bundlePath, _notePath, showPDF = this.settings.defaultPDF) {
    try {
      const readingPath = bundlePath.replace(/\.zrb\.json$/,'.reading.md'), file = this.app.vault.getAbstractFileByPath(readingPath);
      if (!(file instanceof TFile)) throw new Error('未找到 Markdown 正文。');
      let markdown = this.app.workspace.getLeavesOfType('markdown').find(l => l.view.file?.path === readingPath);
      if (!markdown) { markdown = this.app.workspace.getLeaf('tab'); await markdown.openFile(file,{ active:true,state:{ mode:'source',source:false } }); }
      if (showPDF) await this.openPDF(markdown,bundlePath,readingPath);
      await this.app.workspace.revealLeaf(markdown);
    } catch (error) { new Notice(error.message,10000); console.error(error); }
  }
  async openPDF(markdown,bundlePath,readingPath) {
    const existing = this.pairs.get(readingPath);
    if (existing) { await this.app.workspace.revealLeaf(existing.pdf); return; }
    const bundle = validateBundle(JSON.parse(await this.app.vault.adapter.read(bundlePath))), file = await this.pdfFile(bundle,bundlePath);
    const previousPDF = this.app.workspace.getLeavesOfType('pdf').find(leaf => leaf.view.file?.path === file.path);
    const pdf = previousPDF || this.app.workspace.createLeafBySplit(markdown,'vertical');
    try {
      await pdf.openFile(file,{active:false}); const viewer = await waitForPDF(pdf.view);
      const pair = { markdown,pdf,readingPath,pdfPath:file.path,pageCount:bundle.pages.length,anchors:readAnchors(await this.app.vault.cachedRead(markdown.view.file),bundle.pages.length),viewer,lastPage:null,closed:false,lockUntil:0 };
      this.pairs.set(readingPath,pair);
      pair.scroll = () => {
        if (pair.closed) return;
        clearTimeout(pair.scrollTimer);
        pair.scrollTimer = setTimeout(() => this.followMarkdown(pair), 100);
      };
      markdown.view.contentEl.addEventListener('scroll',pair.scroll,true);
      pair.pageChanged = event => {
        if (pair.closed || !this.settings.syncPDF || Date.now() < pair.lockUntil) return;
        const anchor = pair.anchors.find(a => a.pages.includes(event.pageNumber)); if (!anchor) return;
        pair.lastPage = event.pageNumber; pair.lockUntil = Date.now()+350; scrollMarkdownToLine(markdown.view,anchor.line+1);
      };
      viewer.eventBus.on('pagechanging',pair.pageChanged);
      this.followMarkdown(pair);
    } catch (error) { if (!previousPDF) pdf.detach(); throw error; }
  }
  followMarkdown(pair) {
    if (pair.closed || !this.settings.syncPDF) return;
    if (Date.now() < pair.lockUntil) { clearTimeout(pair.scrollTimer); pair.scrollTimer = setTimeout(() => this.followMarkdown(pair), pair.lockUntil-Date.now()+20); return; }
    const line = visibleMarkdownLine(pair.markdown.view); if (line == null) return;
    const anchor = anchorAtLine(pair.anchors,line), page = anchor?.pages[0];
    if (!page || page === pair.lastPage) return;
    pair.lastPage = page; pair.lockUntil = Date.now()+350;
    const viewer = nativePDF(pair.pdf.view); if (!viewer) return;
    viewer.pdfViewer.currentPageNumber = page;
  }
  releasePair(pair) {
    pair.closed = true; pair.markdown.view.contentEl.removeEventListener('scroll',pair.scroll,true);
    pair.viewer.eventBus.off('pagechanging',pair.pageChanged); if (pair.frame) cancelAnimationFrame(pair.frame);
    clearTimeout(pair.scrollTimer); this.pairs.delete(pair.readingPath);
  }
  async openLibrary() {
    try { const listing = await this.app.vault.adapter.list(this.settings.exportFolder), files = listing.files.filter(f => f.endsWith('.zrb.json')); if (!files.length) return new ImportModal(this).open(); new LibraryModal(this,files).open(); }
    catch (_) { new ImportModal(this).open(); }
  }
};
