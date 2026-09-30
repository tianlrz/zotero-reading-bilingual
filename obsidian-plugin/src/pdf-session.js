const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
let libraryPromise;
function viewportRectangle(viewport, rect) {
  return [...viewport.convertToViewportPoint(rect[0], rect[1]), ...viewport.convertToViewportPoint(rect[2], rect[3])];
}
async function loadPDFLibrary(plugin) {
  if (!libraryPromise) {
    const base = plugin.assetURL("");
    // Import in the browser realm, where Obsidian's app:// protocol is valid.
    libraryPromise = new Function("url", "return import(url)")(base + "pdf.min.mjs").then((library) => {
      library.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.mjs";
      return library;
    }).catch((error) => { libraryPromise = null; throw error; });
  }
  return libraryPromise;
}
async function resolvePDF(bundle, zoteroDirectory) {
  const candidates = [path.join(zoteroDirectory, "storage", bundle.pdf.attachmentKey, bundle.pdf.filename), bundle.pdf.path].filter(Boolean);
  for (const filename of candidates) {
    try { if ((await fs.stat(filename)).isFile()) return filename; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  throw new Error("未找到原 PDF。请在插件设置中指定这台电脑的 Zotero 数据目录。");
}
class PDFSession {
  constructor(plugin) { this.plugin = plugin; this.document = null; this.task = null; this.renderTask = null; this.closed = false; }
  async open(bundle) {
    const filename = await resolvePDF(bundle, this.plugin.settings.zoteroDirectory);
    const [library, buffer] = await Promise.all([loadPDFLibrary(this.plugin), fs.readFile(filename)]);
    if (this.closed) throw new Error("PDF 阅读器已关闭。");
    if (bundle.pdf.hash && createHash("md5").update(buffer).digest("hex") !== bundle.pdf.hash) throw new Error("原 PDF 已变化，请重新导入以更新页码定位。");
    const base = this.plugin.assetURL("");
    this.task = library.getDocument({ data: new Uint8Array(buffer), cMapUrl: base + "cmaps/", cMapPacked: true, standardFontDataUrl: base + "standard_fonts/", wasmUrl: base + "wasm/", isEvalSupported: false });
    const document = await this.task.promise;
    if (this.closed) throw new Error("PDF 阅读器已关闭。");
    this.document = document; return this;
  }
  async cancelRender() {
    const task = this.renderTask;
    if (!task) return;
    task.cancel(); try { await task.promise; } catch (_) {}
    if (this.renderTask === task) this.renderTask = null;
  }
  async paint(pageNumber, canvas, width, crop = null) {
    if (this.closed || !this.document) return null;
    await this.cancelRender();
    const page = await this.document.getPage(pageNumber);
    if (this.closed) return null;
    const scale = Math.min(2, width / Math.max(1, crop ? crop[2] - crop[0] : page.getViewport({ scale: 1 }).width));
    const viewport = page.getViewport({ scale });
    const outputRect = crop ? viewportRectangle(viewport, crop) : [0, 0, viewport.width, viewport.height];
    const x = Math.min(outputRect[0], outputRect[2]), y = Math.min(outputRect[1], outputRect[3]);
    canvas.width = Math.max(1, Math.ceil(Math.abs(outputRect[2] - outputRect[0])));
    canvas.height = Math.max(1, Math.ceil(Math.abs(outputRect[3] - outputRect[1])));
    const task = page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport, transform: crop ? [1, 0, 0, 1, -x, -y] : undefined });
    this.renderTask = task;
    try { await task.promise; }
    finally { if (this.renderTask === task) this.renderTask = null; page.cleanup(); }
    return viewport;
  }
  async releasePageResources() { if (!this.renderTask && this.document && !this.closed) await this.document.cleanup(); }
  close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.closePromise = (async () => { await this.cancelRender(); if (this.task) await this.task.destroy(); this.task = this.document = null; })();
    return this.closePromise;
  }
}
module.exports = { PDFSession, resolvePDF, viewportRectangle };
