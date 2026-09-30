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

  renderInto(element, source, { plain = false, inline = false } = {}) {
    const text = String(source ?? "");
    element._zrbRawText = text;
    element.classList.remove("zrb-rich-text");
    // Most translations are ordinary text. This avoids loading or parsing the
    // libraries when they are unnecessary, including while a request is pending.
    if (plain || !this.hasFormatting(text)) {
      element.textContent = text;
      return;
    }
    try {
      const md = this._getMarkdown();
      const html = inline ? md.renderInline(text) : md.render(text);
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
