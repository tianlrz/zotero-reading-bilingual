const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');

async function resolvePDF(bundle, root) {
  for (const filename of [path.join(root, 'storage', bundle.pdf.attachmentKey, bundle.pdf.filename), bundle.pdf.path].filter(Boolean)) {
    try { if ((await fs.stat(filename)).isFile()) return filename; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  throw new Error('未找到原 PDF，请检查 Zotero 数据目录。');
}
async function verifyPDF(filename, expected) {
  if (!expected) return;
  const hash = createHash('md5');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  if (hash.digest('hex') !== expected) throw new Error('原 PDF 已变化，请重新导入，避免页码对应错误。');
}
async function linkPDF(filename, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  try {
    const stat = await fs.lstat(destination);
    if (!stat.isSymbolicLink()) throw new Error('PDF 链接位置已有普通文件，未覆盖。');
    if ((await fs.readlink(destination)) === filename) return;
    await fs.unlink(destination); // Only replace the plugin-owned symbolic link, never its target.
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.symlink(filename, destination, 'file');
}
function readAnchors(text, pageCount) {
  const anchors = [];
  text.split('\n').forEach((line, index) => {
    const match = /^<!--\s*(block-[\w-]+); PDF ([\d,]+)\s*-->\s*$/.exec(line);
    if (!match) return;
    const pages = match[2].split(',').map(Number).filter(n => Number.isInteger(n) && n > 0 && n <= pageCount);
    if (pages.length) anchors.push({ id: match[1], line: index, pages });
  });
  return anchors;
}
function anchorAtLine(anchors, line) {
  let low = 0, high = anchors.length;
  while (low < high) { const mid = (low + high) >>> 1; if (anchors[mid].line <= line) low = mid + 1; else high = mid; }
  return anchors[Math.max(0, low - 1)];
}
// All access to Obsidian's non-public reader internals lives here.
function nativePDF(view) {
  const app = view?.viewer?.child?.pdfViewer;
  return app?.pdfDocument && app?.pdfViewer ? app : null;
}
async function waitForPDF(view) {
  for (let i = 0; i < 100; i++) {
    const viewer = nativePDF(view); if (viewer) return viewer;
    if (!view?.file || !view?.containerEl?.isConnected) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('原生 PDF 阅读器未准备好，当前 Obsidian 版本可能不兼容。');
}
function visibleMarkdownLine(view) {
  if (view.getMode() === 'preview') {
    const line = view.previewMode?.getScroll?.(); return typeof line === 'number' ? Math.floor(line) : null;
  }
  const cm = view.editor?.cm;
  if (!cm?.scrollDOM || !cm.state?.doc) return null;
  const rect = cm.scrollDOM.getBoundingClientRect();
  const position = cm.posAtCoords({ x: rect.left + Math.min(90, rect.width / 3), y: rect.top + 20 }, false);
  return position == null ? null : cm.state.doc.lineAt(position).number - 1;
}
function scrollMarkdownToLine(view, line) {
  if (view.getMode() === 'preview') view.previewMode?.applyScroll?.(line);
  else {
    const cm = view.editor?.cm;
    if (cm?.lineBlockAt && cm.scrollDOM && cm.state?.doc) {
      const position = cm.state.doc.line(Math.min(cm.state.doc.lines, Math.max(1, line + 1))).from;
      const top = cm.lineBlockAt(position).top + cm.documentTop - cm.scrollDOM.getBoundingClientRect().top + cm.scrollDOM.scrollTop - 10;
      view.editor.scrollTo(null, Math.max(0, top));
    } else view.editor?.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, false);
  }
}
module.exports = { resolvePDF, verifyPDF, linkPDF, readAnchors, anchorAtLine, nativePDF, waitForPDF, visibleMarkdownLine, scrollMarkdownToLine };
