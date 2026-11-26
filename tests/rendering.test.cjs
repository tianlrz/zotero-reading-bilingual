const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
function setup() {
  const loads = [];
  const prefs = new Map();
  const scope = {
    Zotero: { debug() {}, Prefs: { get(key) { return prefs.get(key); }, set(key, value) { prefs.set(key, value); } } },
    Services: { appShell: { hiddenDOMWindow: { atob } }, scriptloader: { loadSubScript(filename, target) {
      loads.push(filename);
      vm.runInNewContext(fs.readFileSync(filename, "utf8"), target);
    } } },
    setTimeout() {},
    clearTimeout() {},
  };
  vm.createContext(scope);
  for (const file of ["translation-renderer.js", "reading-bilingual.js"]) {
    vm.runInContext(fs.readFileSync(path.join(root, "content/scripts", file), "utf8"), scope);
  }
  scope.ZRBTranslationRenderer.init(root + path.sep);
  const doc = new JSDOM("<!doctype html><html><head></head><body></body></html>").window.document;
  const renderer = scope.ZRBTranslationRenderer;
  const plugin = scope.ReadingBilingual;
  const render = (source) => {
    const card = plugin.createCardElement({}, doc, "original", source);
    doc.body.appendChild(card);
    return card.querySelector(".zrb-card-content");
  };
  return { doc, renderer, plugin, render, loads, prefs };
}

test("plain cached paragraphs keep line breaks without loading rendering libraries", () => {
  const { plugin, renderer, render, loads } = setup();
  const source = "第一行\n第二行\n\n第三行";
  const cleaned = plugin.cleanTypography(source);
  assert.equal(cleaned, source);
  const content = render(cleaned);
  assert.equal(content.textContent, source);
  assert.equal(renderer.getSource(content), source);
  assert.equal(loads.length, 0);
});

test("Markdown renders emphasis, hard breaks, lists, headings and tables", () => {
  const { render, renderer } = setup();
  const source = "## 标题\n\n**重点**\n下一行\n\n- 条目一\n- 条目二\n\n| 参数 | 值 |\n| --- | --- |\n| 学习率 | 0.01 |";
  const content = render(source);
  assert.equal(content.querySelector("h2").textContent, "标题");
  assert.equal(content.querySelector("strong").textContent, "重点");
  assert.ok(content.querySelector("br"));
  assert.equal(content.querySelectorAll("li").length, 2);
  assert.equal(content.querySelector("td").textContent, "学习率");
  assert.equal(renderer.getSource(content), source);
  assert.ok(render("参数 | 值\n--- | ---\n学习率 | 0.01").querySelector("table"));
});


test("reader display mode selector remembers translation-only mode and preserves figures", async () => {
  const { doc, plugin, prefs } = setup();
  const sdt = doc.createElement("div");
  sdt.id = "sdt-content";
  const source = doc.createElement("p");
  source.textContent = "Original paragraph ";
  const image = doc.createElement("img");
  image.alt = "chart";
  source.appendChild(image);
  sdt.appendChild(source);
  doc.body.appendChild(sdt);
  const card = plugin.createCardElement({}, doc, "Original paragraph", "译文");
  source.insertAdjacentElement("afterend", card);

  const toolbarDoc = new JSDOM("<!doctype html><html><head></head><body><div class='toolbar'><div class='end'><button class='toolbar-button find'></button></div></div></body></html>").window.document;
  const reader = { _iframeWindow: { document: toolbarDoc } };
  plugin.getRealContentDoc = () => doc;
  const displayStyle = doc.createElement("style");
  displayStyle.textContent = plugin.getGeneratedCSS();
  doc.head.appendChild(displayStyle);
  plugin.injectToolbarButton(reader, toolbarDoc);

  const selector = toolbarDoc.getElementById("zrb-display-mode");
  assert.ok(selector);
  assert.deepEqual(Array.from(selector.options).map((option) => option.value), ["original", "bilingual", "translation"]);
  selector.value = "translation";
  selector.dispatchEvent(new toolbarDoc.defaultView.Event("change", { bubbles: true }));
  await new Promise(setImmediate);

  assert.equal(prefs.get(plugin.PREF_READER_DISPLAY_MODE), "translation");
  assert.equal(doc.documentElement.dataset.zrbDisplayMode, "translation");
  assert.ok(doc.documentElement.classList.contains("zrb-translation-only"));
  assert.equal(source.querySelector(".zrb-original-text").textContent, "Original paragraph ");
  assert.equal(doc.defaultView.getComputedStyle(source.querySelector(".zrb-original-text")).display, "none");
  assert.equal(source.querySelector("img"), image);
  assert.notEqual(doc.defaultView.getComputedStyle(image).display, "none");
  assert.equal(selector.value, "translation");

  const reopened = new JSDOM("<!doctype html><html><body><div id='sdt-content'><p>Reopened PDF text</p></div></body></html>").window.document;
  plugin.restoreReaderDisplayMode(reopened);
  assert.equal(reopened.documentElement.dataset.zrbDisplayMode, "translation");
  assert.ok(reopened.documentElement.classList.contains("zrb-translation-only"));

  await plugin.setReaderDisplayMode(reader, "bilingual");
  assert.equal(doc.documentElement.classList.contains("zrb-translation-only"), false);
  assert.notEqual(doc.defaultView.getComputedStyle(source.querySelector(".zrb-original-text")).display, "none");
  await plugin.setReaderDisplayMode(reader, "original");
  assert.equal(doc.documentElement.classList.contains("zrb-display-original"), true);
  assert.equal(doc.defaultView.getComputedStyle(card).display, "none");
  assert.equal(prefs.get(plugin.PREF_READER_DISPLAY_MODE), "original");
});


test("reader mode returns to original when translation yields no cards", async () => {
  const { doc, plugin, prefs } = setup();
  const sdt = doc.createElement("div");
  sdt.id = "sdt-content";
  doc.body.appendChild(sdt);
  const reader = {};
  plugin.getRealContentDoc = () => doc;
  plugin.syncToolbarDisplayMode = () => {};
  plugin.translateActiveReader = async () => {};

  const applied = await plugin.setReaderDisplayMode(reader, "translation");
  assert.equal(applied, false);
  assert.equal(doc.documentElement.dataset.zrbDisplayMode, "original");
  assert.equal(prefs.get(plugin.PREF_READER_DISPLAY_MODE), "original");
});

test("card styles preserve plain line breaks and allow rendered Markdown and editing", () => {
  const { doc, render, plugin } = setup();
  const style = doc.createElement("style");
  style.textContent = plugin.getGeneratedCSS();
  doc.head.appendChild(style);
  const plain = render("第一行\n第二行");
  const rich = render("**重点**\n第二行");
  assert.equal(doc.defaultView.getComputedStyle(plain).whiteSpace, "pre-wrap");
  assert.equal(doc.defaultView.getComputedStyle(rich).whiteSpace, "normal");
  rich.parentElement.querySelector(".zrb-btn-edit").click();
  assert.equal(doc.defaultView.getComputedStyle(rich).display, "none");
});

test("all four math delimiters render locally and preserve TeX through typography cleanup", () => {
  const { render, renderer, plugin, doc, loads } = setup();
  const source = "损失 $L_i = \\alpha_i^2$ 与 \\(x+y\\)。\n\n$$\n\\sum_{i=1}^{n} i\n$$\n\n\\[\\frac{a}{b}\\]";
  assert.equal(plugin.cleanTypography(source), source);
  const content = render(source);
  assert.equal(content.querySelectorAll(".katex").length, 4);
  assert.equal(content.querySelectorAll(".katex-display").length, 2);
  assert.equal(renderer.getSource(content), source);
  assert.equal(doc.querySelectorAll("#zrb-katex-style").length, 1);
  assert.equal(doc.querySelector("#zrb-katex-style").getAttribute("href"), "chrome://readingbilingual-render/content/katex/katex.min.css");
  render("缓存中的公式 $a_1+b_2$。");
  assert.equal(doc.querySelectorAll("#zrb-katex-style").length, 1);
  assert.equal(loads.length, 2);
});

test("display formulas can contain blank lines and Markdown markup inside TeX", () => {
  const { render } = setup();
  const content = render("$$\n\\begin{aligned}\na_1 &= b_2 \\\\\n\n c_3 &= d_4\n\\end{aligned}\n$$");
  assert.equal(content.querySelectorAll(".katex-display").length, 1);
});

test("currency, escaped dollars and inline/fenced code remain literal", () => {
  const { render, plugin } = setup();
  const source = "价格 $5 and $10；转义 \\$x\\$；代码 `$x_i$`。\n\n```python\nif ok:\n    value = '$a$'\n```";
  assert.equal(plugin.cleanTypography(source), source);
  const content = render(source);
  assert.equal(content.querySelectorAll(".katex").length, 0);
  assert.ok(content.textContent.includes("$5 and $10"));
  assert.ok(content.textContent.includes("$x$"));
  assert.equal(content.querySelector("code").textContent, "$x_i$");
  assert.ok(content.querySelector("pre code").textContent.includes("    value"));
});

test("invalid formulas remain readable and HTML, image and TeX input cannot inject active content", () => {
  const { render } = setup();
  const invalid = "$\\unknowncommand{a}$";
  assert.ok(render(invalid).textContent.includes(invalid));
  const content = render('<script>alert(1)</script>\n<img src="https://example.com/leak">\n![remote](https://example.com/image)\n[bad](javascript:alert(1))\n$\\href{javascript:alert(1)}{x}$');
  assert.equal(content.querySelectorAll("script, img, iframe").length, 0);
  assert.equal(content.querySelectorAll('[href^="javascript:"]').length, 0);
});

test("editing and copying a rendered card preserve source and save re-rendered changes", async () => {
  const { doc, plugin, renderer } = setup();
  const source = "**损失** $L_i=\\alpha_i$\n第二行";
  const card = plugin.createCardElement({}, doc, "original", source);
  doc.body.appendChild(card);
  const saved = [];
  plugin.saveCache = async (_reader, entries) => saved.push(entries);
  let copied;
  Object.defineProperty(doc.defaultView.navigator, "clipboard", { value: {
    writeText: async (text) => { copied = text; },
  } });
  card.querySelector(".zrb-btn-copy").click();
  assert.equal(copied, source);
  card.querySelector(".zrb-btn-edit").click();
  const textarea = card.querySelector("textarea");
  assert.equal(textarea.value, source);
  const changed = "第一行\n第二行 $x_1^2$";
  textarea.value = changed;
  card.querySelector(".zrb-save-edit-btn").click();
  await new Promise(setImmediate);
  const content = card.querySelector(".zrb-card-content");
  assert.equal(renderer.getSource(content), changed);
  assert.equal(content.querySelectorAll(".katex").length, 1);
  assert.equal(saved[0].original, changed);
  assert.equal(card.querySelector("textarea"), null);
  card.querySelector(".zrb-btn-copy").click();
  assert.equal(copied, changed);
});

test("a pending card renders the completed result without leaking rendered text into the cache", () => {
  const { doc, plugin, renderer } = setup();
  const card = plugin.createCardElement({}, doc, "original", "正在翻译…", true);
  const content = card.querySelector(".zrb-card-content");
  const result = "结果 $x_1$\n新的一行";
  plugin.setTranslationContent(content, result);
  assert.equal(content.querySelectorAll(".katex").length, 1);
  assert.equal(renderer.getSource(content), result);
  plugin.setTranslationContent(content, "[翻译失败: 错误]", true);
  assert.equal(content.querySelectorAll(".katex").length, 0);
  assert.equal(renderer.getSource(content), "[翻译失败: 错误]");
});
