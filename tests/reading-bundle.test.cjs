const assert = require("node:assert/strict");
const { test } = require("node:test");
const { deflateRawSync } = require("node:zlib");
const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os");
const { createHash } = require("node:crypto");
const { readSDTCache, buildReadingBundle, importPDF, bundleToMarkdown, cacheHash, validateBundle } = require("../bridge/reading-bundle.cjs");
const { PDFSession, resolvePDF, viewportRectangle } = require("../obsidian-plugin/src/pdf-session.js");

const paragraph = (text, page = 0) => ({ type: "paragraph", anchor: { pageRects: [[page, 10, 20, 100, 40]] }, content: [{ text }] });
const structure = (content) => ({ metadata: { processor: { type: "pdf" }, source: {} }, catalog: { pages: [0, 1].map((i) => ({ label: String(i + 1), viewRect: [0, 0, 200, 300], contentRange: [[0], [content.length]] })), outline: [] }, content });
function pack(document) {
  const metadata = deflateRawSync(Buffer.from(JSON.stringify(document.metadata))), catalog = deflateRawSync(Buffer.from(JSON.stringify(document.catalog)));
  const blocks = document.content.map((b) => Buffer.from(JSON.stringify(b))), table = Buffer.alloc(blocks.length * 4);
  let offset = 0; blocks.forEach((b, i) => { table.writeUInt32LE(offset, i * 4); offset += b.length; });
  const chunk = deflateRawSync(Buffer.concat([table, ...blocks])), index = Buffer.alloc(24), header = Buffer.alloc(16);
  index.writeUInt32LE(metadata.length, 0); index.writeUInt32LE(catalog.length, 4);
  index.writeUInt32LE(0, 8); index.writeUInt32LE(chunk.length, 12); index.writeUInt32LE(0, 16); index.writeUInt32LE(blocks.length, 20);
  Buffer.from([137, 83, 68, 84, 13, 10, 26, 10, 1, 1, 2, 0]).copy(header); header.writeUInt32LE(index.length, 12);
  return Buffer.concat([header, index, metadata, catalog, chunk]);
}

test("SDT pack reader reconstructs source anchors and rejects corrupt/unsupported packs", () => {
  const document = structure([paragraph("A paragraph.")]), bytes = pack(document);
  assert.deepEqual(readSDTCache(bytes).content, document.content);
  const corrupt = Buffer.from(bytes); corrupt[0] = 0;
  assert.throws(() => readSDTCache(corrupt));
  const unsupported = Buffer.from(bytes); unsupported[9] = 2;
  assert.throws(() => readSDTCache(unsupported));
  assert.throws(() => readSDTCache(bytes.subarray(0, bytes.length - 1)));
});

test("cross-page logical paragraphs keep exact anchors, join split words and reuse cached TeX", () => {
  const first = paragraph("inter-", 0), second = paragraph("national work", 1);
  first.nextPart = [1]; second.previousPart = [0];
  const translation = "国际工作 $x_1^2$\n第二行";
  const bundle = buildReadingBundle(structure([first, second]), { "international work": translation });
  assert.equal(bundle.blocks.length, 1);
  assert.equal(bundle.blocks[0].original, "international work");
  assert.equal(bundle.blocks[0].translated, translation);
  assert.deepEqual(bundle.blocks[0].pages, [1, 2]);
  assert.equal(bundle.blocks[0].sourceParts.length, 2);
});

test("old UI-contaminated cache keys recover only the same source paragraph", () => {
  const bundle = buildReadingBundle(structure([paragraph("A source paragraph."), paragraph("Another source paragraph.")]), { "A source paragraph.\n正在调用 Gemini 翻译…": "第一行\n第二行", "Another source paragraph.": "[翻译失败: HTTP 429]" });
  assert.equal(bundle.blocks[0].translated, "第一行\n第二行");
  assert.equal(bundle.blocks[1].translated, null);
});

test("grouped TOC and roadmap translations require the exact source hash", () => {
  const content = [paragraph("1 Intro 1"), paragraph("2 Methods 2"), paragraph("Organized as follows:"), paragraph("First item."), paragraph("Second item.")];
  const cache = {
    ["toc_block_" + cacheHash("toc::1 Intro 1::2 Methods 2")]: { itemsZh: ["1 引言 1", "2 方法 2"] },
    ["roadmap_" + cacheHash("Organized as follows:::First item.::Second item.")]: { leadZh: "结构如下：", itemsZh: ["第一项。", "第二项。"] },
  };
  const bundle = buildReadingBundle(structure(content), cache);
  assert.deepEqual(bundle.blocks.map((b) => b.translated), ["1 引言 1", "2 方法 2", "结构如下：", "第一项。", "第二项。"]);
  content[0].content[0].text = "1 A different source 1";
  assert.equal(buildReadingBundle(structure(content), cache).blocks[0].translated, null);
});

test("Markdown export is searchable, embeds crop files and links back to the source", () => {
  const image = { ...paragraph("Chart description"), type: "image" };
  const bundle = buildReadingBundle(structure([paragraph("Source text"), image]), { "Source text": "$L_i$\n下一行" }, { attachmentKey: "ABCDEFGH" });
  bundle.blocks[1].crops[0].image = "Zotero 阅读/images/chart.png";
  const markdown = bundleToMarkdown(bundle, "Zotero 阅读/paper.zrb.json");
  assert.ok(markdown.includes("> $L_i$\n> 下一行"));
  assert.ok(markdown.includes("> [!zrb-translation] 译文"));
  assert.ok(markdown.includes("![[Zotero 阅读/images/chart.png]]"));
  assert.ok(markdown.includes("zotero://select/library/items/ABCDEFGH"));
  assert.equal(validateBundle(bundle), bundle);
  bundle.blocks[0].pages = [99]; assert.throws(() => validateBundle(bundle));
});

test("import uses existing caches without copying PDF and refuses a stale source", async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "zrb-import-test-"));
  try {
    const pdf = path.join(folder, "paper.pdf"), bytes = Buffer.from("sample PDF source for cache hashing");
    const document = structure([paragraph("Source")]); document.metadata.source.hash = createHash("md5").update(bytes).digest("hex");
    await fs.writeFile(pdf, bytes); await fs.writeFile(path.join(folder, ".zotero-sdt-cache"), pack(document));
    await fs.writeFile(path.join(folder, "paper.bilingual.json"), JSON.stringify({ translations: { Source: "译文" } }));
    const bundle = await importPDF(pdf);
    assert.equal(bundle.blocks[0].translated, "译文");
    assert.equal((await fs.readdir(folder)).filter((f) => f.endsWith(".pdf")).length, 1);
    await fs.writeFile(pdf, "changed source"); await assert.rejects(importPDF(pdf), /不一致/);
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});

test("PDF path resolves on a different computer using its configured Zotero root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zrb-root-test-"));
  try {
    const target = path.join(root, "storage/ABCDEFGH/paper.pdf"); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, "pdf");
    assert.equal(await resolvePDF({ pdf: { attachmentKey: "ABCDEFGH", filename: "paper.pdf", path: "/old-computer/paper.pdf" } }, root), target);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("PDF close cancels rendering and destroys the document exactly once", async () => {
  const session = new PDFSession({}); let cancelled = 0, destroyed = 0;
  session.renderTask = { cancel() { cancelled++; }, promise: Promise.resolve() };
  session.task = { async destroy() { destroyed++; } }; session.document = {};
  await Promise.all([session.close(), session.close()]);
  assert.equal(cancelled, 1); assert.equal(destroyed, 1); assert.equal(session.document, null);
  assert.deepEqual(viewportRectangle({ convertToViewportPoint(x, y) { return [2 * x, 600 - 2 * y]; } }, [10, 20, 100, 40]), [20, 560, 200, 520]);
});
