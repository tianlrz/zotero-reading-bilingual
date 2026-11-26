/* eslint-disable no-undef */

// Keep the source separate from the rendered DOM: KaTeX textContent includes
// layout/accessibility text and is not suitable for editing or caching.
var ZRBTranslationRenderer = {
  rootURI: "",
  init(rootURI) { this.rootURI = rootURI; },

  hasFormatting(text) {
    return /[$`*_~|]|\\[([]|(?:^|\n)[ \t]*(?:#{1,6}\s|[-+]\s|\d+[.)]\s|>)|\[[^\]\n]+\]\(/.test(text);
  },

  _loadLibrary(path, name) {
    // markdown-it's browser build decodes its entity table with atob. A plain
    // loadSubScript scope has no DOM globals, so provide this one explicitly.
    const scope = { atob: (input) => Services.appShell.hiddenDOMWindow.atob(input) };
    Services.scriptloader.loadSubScript(this.rootURI + path, scope);
    if (!scope[name]) throw new Error("Could not load " + name);
    return scope[name];
  },

  _readMath(source, start) {
    const rest = source.slice(start);
    let left, right, display;
    if (rest.startsWith("$$")) { left = right = "$$"; display = true; }
    else if (rest.startsWith("\\[")) { left = "\\["; right = "\\]"; display = true; }
    else if (rest.startsWith("\\(")) { left = "\\("; right = "\\)"; display = false; }
    else if (rest.startsWith("$")) { left = right = "$"; display = false; }
    else return null;

    const begin = start + left.length;
    if (left === "$" && /\s/.test(source[begin] || " ")) return null;
    let end = begin;
    while ((end = source.indexOf(right, end)) !== -1) {
      let backslashes = 0;
      for (let i = end - 1; i >= begin && source[i] === "\\"; i--) backslashes++;
      if (backslashes % 2) { end += right.length; continue; }
      const tex = source.slice(begin, end);
      // Do not interpret prices such as "$5 and $10" as mathematics.
      if (!tex.trim() || (left === "$" && (/\s$/.test(tex) || /[\n`]/.test(tex) || /\d/.test(source[end + 1] || "")))) return null;
      return { tex, display, raw: source.slice(start, end + right.length), end: end + right.length };
    }
    return null;
  },

  _renderMath(token, escape) {
    try {
      if (!this._katex) this._katex = this._loadLibrary("content/vendor/katex/katex.min.js", "katex");
      return this._katex.renderToString(token.content, {
        displayMode: token.meta.display,
        throwOnError: true,
        trust: false,
        strict: "ignore",
        maxExpand: 1000,
        maxSize: 10,
      });
    } catch (error) {
      // Unsupported or malformed TeX remains readable and editable.
      return escape(token.meta.raw);
    }
  },

  _getMarkdown() {
    if (this._markdown) return this._markdown;
    const MarkdownIt = this._loadLibrary("content/vendor/markdown-it.min.js", "markdownit");
    const md = new MarkdownIt({ html: false, breaks: true, linkify: false, typographer: false });
    // Model output must not initiate image downloads.
    md.disable("image");
    md.inline.ruler.before("escape", "zrb_math", (state, silent) => {
      const math = this._readMath(state.src.slice(0, state.posMax), state.pos);
      if (!math) return false;
      if (!silent) {
        const token = state.push("zrb_math", "", 0);
        token.content = math.tex;
        token.meta = math;
      }
      state.pos = math.end;
      return true;
    });
    md.block.ruler.before("fence", "zrb_math_block", (state, startLine, endLine, silent) => {
      if (state.sCount[startLine] - state.blkIndent >= 4) return false;
      const start = state.bMarks[startLine] + state.tShift[startLine];
      const math = this._readMath(state.src.slice(0, state.eMarks[endLine - 1]), start);
      if (!math || !math.display) return false;
      const lastLine = startLine + math.raw.split("\n").length - 1;
      if (state.src.slice(math.end, state.eMarks[lastLine]).trim()) return false;
      if (silent) return true;
      const token = state.push("zrb_math_block", "", 0);
      token.block = true;
      token.content = math.tex;
      token.meta = math;
      token.map = [startLine, lastLine + 1];
      state.line = lastLine + 1;
      return true;
    }, { alt: ["paragraph", "reference", "blockquote", "list"] });
    md.renderer.rules.zrb_math = (tokens, index) => this._renderMath(tokens[index], md.utils.escapeHtml);
    md.renderer.rules.zrb_math_block = (tokens, index) =>
      '<div class="zrb-math-block">' + this._renderMath(tokens[index], md.utils.escapeHtml) + "</div>\n";
    this._markdown = md;
    return md;
  },

  getSource(element) {
    return element?._zrbRawText ?? element?.textContent ?? "";
  },

  _splitTableRow(line) {
    const cells = [];
    let start = 0, lastPipe = -1;
    for (let i = 0; i < line.length; i++) {
      const math = (line[i] === "$" || line[i] === "\\") && this._readMath(line, i);
      if (math) { i = math.end - 1; continue; }
      if (line[i] === "\\") { i++; continue; }
      if (line[i] === "`") {
        const ticks = line.slice(i).match(/^`+/)[0];
        const end = line.indexOf(ticks, i + ticks.length);
        if (end !== -1) { i = end + ticks.length - 1; continue; }
      }
      if (line[i] !== "|") continue;
      cells.push(line.slice(start, i).trim());
      start = i + 1; lastPipe = i;
    }
    if (lastPipe === -1) return null;
    cells.push(line.slice(start).trim());
    if (line.startsWith("|")) cells.shift();
    if (lastPipe === line.length - 1) cells.pop();
    return cells;
  },

  _tableRows(text) {
    // Older table prompts returned pipe rows without a Markdown separator.
    // Parse only explicitly marked tables, and never guess missing cells.
    const body = text.trim().replace(/^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```$/i, "$1");
    const rows = body.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => this._splitTableRow(line));
    if (rows.length < 2 || rows.some(row => !row) || rows[0].length < 2) return null;
    if (rows.some(row => row.length !== rows[0].length)) return null;
    if (rows[1].every(cell => /^:?-{3,}:?$/.test(cell))) rows.splice(1, 1);
    return rows;
  },

  _renderTable(rows, md) {
    const header = rows[0].map(cell => '<th scope="col">' + md.renderInline(cell) + '</th>').join("");
    const body = rows.slice(1).map(row => '<tr>' + row.map((cell, i) =>
      (i ? '<td>' : '<th scope="row">') + md.renderInline(cell) + (i ? '</td>' : '</th>')
    ).join("") + '</tr>').join("");
    return '<div class="zrb-table-scroll" role="region" aria-label="表格译文，可横向滚动" tabindex="0">' +
      '<table class="zrb-translation-table" style="--zrb-table-columns:' + rows[0].length + '">' +
      '<thead><tr>' + header + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  },

  renderInto(element, source, { plain = false, inline = false, table = false } = {}) {
    const text = String(source ?? "");
    element._zrbRawText = text;
    element.classList.remove("zrb-rich-text");
    const rows = table && !plain ? this._tableRows(text) : null;
    // Most translations are ordinary text. This avoids loading or parsing the
    // libraries when they are unnecessary, including while a request is pending.
    if (plain || (table && !rows) || !this.hasFormatting(text)) {
      element.textContent = text;
      return;
    }
    try {
      const md = this._getMarkdown();
      const html = rows ? this._renderTable(rows, md) : inline ? md.renderInline(text) : md.render(text);
      element.innerHTML = html;
      element.classList.add("zrb-rich-text");
      if (html.includes('class="katex')) {
        const doc = element.ownerDocument;
        if (!doc.getElementById("zrb-katex-style")) {
          const link = doc.createElement("link");
          link.id = "zrb-katex-style";
          link.rel = "stylesheet";
          link.href = "chrome://readingbilingual-render/content/katex/katex.min.css";
          (doc.head || doc.documentElement).appendChild(link);
        }
      }
    } catch (error) {
      element.textContent = text;
      if (typeof Zotero !== "undefined") Zotero.debug("[ReadingBilingual] Render fallback: " + error);
    }
  },
};
