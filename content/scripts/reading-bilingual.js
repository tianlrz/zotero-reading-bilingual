/* eslint-disable no-undef */

var ReadingBilingual = {
  id: "reading-bilingual@lrz.org",
  name: "Zotero Reading Bilingual",
  rootURI: null,
  addedElementIDs: [],
  windowListeners: new Map(),
  observedDocs: new WeakSet(),
  // Re-evaluated on every load of this script, so anything left in a reader
  // tab by a previous load can be told apart from what this load injected
  sessionId: String(Date.now()) + "-" + Math.random().toString(36).slice(2, 8),
  _observers: [],

  // Preferences
  PREF_PROVIDER: "extensions.zotero.reading-bilingual.provider",
  PREF_BASE_URL: "extensions.zotero.reading-bilingual.baseUrl",
  PREF_API_KEY: "extensions.zotero.reading-bilingual.apiKey",
  PREF_MODEL: "extensions.zotero.reading-bilingual.model",
  PREF_AUTO_TRANSLATE: "extensions.zotero.reading-bilingual.autoTranslate",
  PREF_CUSTOM_PROMPT: "extensions.zotero.reading-bilingual.customPrompt",
  PREF_FONT_FAMILY: "extensions.zotero.reading-bilingual.fontFamily",
  PREF_CUSTOM_FONT: "extensions.zotero.reading-bilingual.customFont",
  PREF_FRAME_THEME: "extensions.zotero.reading-bilingual.frameTheme",
  PREF_CUSTOM_COLOR: "extensions.zotero.reading-bilingual.customColor",
  PREF_CARD_BG: "extensions.zotero.reading-bilingual.cardBg",
  PREF_FONT_SIZE: "extensions.zotero.reading-bilingual.fontSize",
  PREF_LINE_HEIGHT: "extensions.zotero.reading-bilingual.lineHeight",
  PREF_BORDER_STYLE: "extensions.zotero.reading-bilingual.borderStyle",
  PREF_TRANSLATE_TABLES: "extensions.zotero.reading-bilingual.translateTables",
  DEFAULT_PROVIDER: "gemini",
  DEFAULT_MODEL: "gemini-flash-latest",
  DEFAULT_BORDER_STYLE: "straight",
  DEFAULT_PROMPT: `你是一名顶尖的计算机科学与人工智能领域资深学者兼专业学术译者。请将以下按标号分隔的英文论文段落翻译为地道、严谨、纯正的高质量学术中文。

【核心翻译规范】：
1. 语言自然学术：行文必须符合中文学术论文规范，文笔凝练严谨，逻辑连贯，杜绝机械生硬的逐字机翻腔。
2. 术语地道本地化：学术词汇请采用学界通用的自然表达。例如将 first-class components 译为“核心组件”或“核心要素”（切忌死板直译为“一等公民”）。
3. 【严格禁止中文后用括号附带英文】：严禁在中文翻译后用括号补充英文原文（例如严禁输出“基座模型 (foundation models)”或“技能（skills）”，直接输出“基座模型”、“技能”即可）。
4. 专有名词保留：仅行业公认通用的英文缩写与专有名词保持原样（如 LLM、Agent、AI、GPU、API、Transformer、GPT、PyTorch 等）。
5. 保持数学符号、公式、参数变量名及代码标记原样不变。

【输出格式要求】：
严格按【P1】、【P2】、【P3】...标号对应输出各段纯中文译文，不要遗漏标号，不要输出任何额外的前言、开场白或分析说明。`,

  init(rootURI) {
    this.rootURI = rootURI;
    Zotero.debug("[ReadingBilingual] Initializing plugin...");

    if (Zotero.Reader && Zotero.Reader.registerEventListener) {
      try {
        Zotero.Reader.registerEventListener(
          "renderToolbar",
          this.handleRenderToolbar.bind(this),
          this.id
        );
      } catch (err) {
        Zotero.logError(err);
      }
    }

    // Register native Zotero Settings preference pane
    try {
      if (Zotero.PreferencePanes && Zotero.PreferencePanes.register) {
        if (Zotero.PreferencePanes.pluginPanes?.some((p) => p.id === "reading-bilingual-preferences")) {
          Zotero.PreferencePanes.unregister("reading-bilingual-preferences");
        }
        Zotero.PreferencePanes.register({
          pluginID: this.id,
          src: "chrome://readingbilingual/content/preferences.xhtml",
          id: "reading-bilingual-preferences",
          label: "沉浸式双语",
          image: "chrome://readingbilingual/content/icons/icon.svg",
          scripts: ["chrome://readingbilingual/content/scripts/preferences.js"],
        }).catch((err) => {
          Zotero.logError(err);
        });
      }
    } catch (e) {
      Zotero.logError(e);
    }

    // Tab switch observer to ensure FAB & observer exist on tab restore
    try {
      if (typeof Zotero_Tabs !== "undefined" && Zotero_Tabs.addObserver) {
        this._tabObserver = {
          onTabSelect: (tab) => {
            this.handleTabSelect(tab);
          },
        };
        Zotero_Tabs.addObserver(this._tabObserver);
      }
    } catch (e) {}

    // Multi-stage scan to attach to restored session tabs on restart
    setTimeout(() => this.scanExistingReaders(), 300);
    setTimeout(() => this.scanExistingReaders(), 1200);
    setTimeout(() => this.scanExistingReaders(), 2500);
  },

  scanExistingReaders() {
    if (!Zotero.Reader || !Zotero.Reader._readers) return;
    for (let reader of Object.values(Zotero.Reader._readers)) {
      try {
        const doc = reader._iframeWindow?.document || reader._iframe?.contentDocument;
        if (doc) {
          this.injectToolbarButton(reader, doc);
          this.setupReadingModeObserver(reader, doc);
        }
      } catch (e) {}
    }
  },

  handleTabSelect(tab) {
    if (!tab) return;
    try {
      let reader = null;
      if (tab.reader) reader = tab.reader;
      else if (tab.data?.reader) reader = tab.data.reader;
      else if (typeof Zotero.Reader?.getByTabID === "function") {
        reader = Zotero.Reader.getByTabID(tab.id);
      }
      if (!reader && Zotero.Reader?._readers) {
        const readers = Object.values(Zotero.Reader._readers);
        reader = readers.find((r) => r.tabID === tab.id || r._tabID === tab.id || r._tab?.id === tab.id);
      }
      if (reader) {
        const doc = reader._iframeWindow?.document || reader._iframe?.contentDocument;
        if (doc) {
          this.injectToolbarButton(reader, doc);
          this.setupReadingModeObserver(reader, doc);
        }
      }
    } catch (e) {}
  },

  getProvider() {
    try {
      const p = Zotero.Prefs.get(this.PREF_PROVIDER, true);
      if (p && typeof p === "string" && p.trim()) return p.trim();
    } catch (e) {}
    return this.DEFAULT_PROVIDER;
  },

  setProvider(provider) {
    Zotero.Prefs.set(this.PREF_PROVIDER, (provider || this.DEFAULT_PROVIDER).trim(), true);
  },

  getBaseUrl() {
    try {
      const url = Zotero.Prefs.get(this.PREF_BASE_URL, true);
      if (url && typeof url === "string" && url.trim()) return url.trim();
    } catch (e) {}
    return "";
  },

  setBaseUrl(url) {
    Zotero.Prefs.set(this.PREF_BASE_URL, (url || "").trim(), true);
  },

  getUserApiKey() {
    try {
      const key = Zotero.Prefs.get(this.PREF_API_KEY, true);
      if (key && typeof key === "string" && key.trim().length > 0) {
        return key.trim();
      }
    } catch (e) {}
    return "";
  },

  // The plugin ships with no key of its own. Every request uses the key the
  // user configured in Settings, and an empty string means "not configured".
  getApiKey() {
    return this.getUserApiKey();
  },

  setApiKey(key) {
    Zotero.Prefs.set(this.PREF_API_KEY, (key || "").trim(), true);
  },

  getModel() {
    try {
      const model = Zotero.Prefs.get(this.PREF_MODEL, true);
      if (model && typeof model === "string" && model.trim().length > 0) {
        return model.trim();
      }
    } catch (e) {}
    return this.DEFAULT_MODEL;
  },

  setModel(model) {
    Zotero.Prefs.set(this.PREF_MODEL, (model || "").trim(), true);
  },

  async fetchAvailableModels(apiKey, provider = "gemini", baseUrl = "") {
    const key = (apiKey || this.getApiKey() || "").trim();
    if (!key) throw new Error("请先填写 API Key");

    const targetProvider = provider || this.getProvider();

    if (targetProvider === "gemini") {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
      const response = await fetch(url, {
        method: "GET",
        headers: { "Content-Type": "application/json" }
      });

      if (!response.ok) {
        let errText = "";
        try {
          const errJson = await response.json();
          errText = errJson.error?.message || response.statusText;
        } catch (e) {
          errText = response.statusText;
        }
        throw new Error(`HTTP ${response.status}: ${errText}`);
      }

      const data = await response.json();
      const rawModels = data.models || [];
      const models = rawModels
        .filter((m) => {
          const name = (m.name || "").replace(/^models\//, "");
          const methods = m.supportedGenerationMethods || [];
          const isGenerate = methods.includes("generateContent");
          const isNotSpecial = !name.includes("embedding") &&
                               !name.includes("tts") &&
                               !name.includes("image") &&
                               !name.includes("transcribe") &&
                               !name.includes("robotics") &&
                               !name.includes("computer-use") &&
                               !name.includes("veo") &&
                               !name.includes("lyria");
          return isGenerate && isNotSpecial;
        })
        .map((m) => {
          const id = (m.name || "").replace(/^models\//, "");
          let label = m.displayName || id;
          if (id === "gemini-flash-latest") {
            label = "gemini-flash-latest (自动最新 Flash - 推荐)";
          } else if (id === "gemini-pro-latest") {
            label = "gemini-pro-latest (自动最新 Pro)";
          }
          return {
            id: id,
            displayName: label,
            description: m.description || ""
          };
        });

      // Ensure gemini-flash-latest is always in the list and at the top if present
      const flashLatestIndex = models.findIndex((m) => m.id === "gemini-flash-latest");
      if (flashLatestIndex > 0) {
        const [item] = models.splice(flashLatestIndex, 1);
        models.unshift(item);
      } else if (flashLatestIndex === -1) {
        models.unshift({
          id: "gemini-flash-latest",
          displayName: "gemini-flash-latest (自动最新 Flash - 推荐)",
          description: "Google 动态指向最新的极速 Flash 模型"
        });
      }

      try {
        Zotero.Prefs.set(
          "extensions.zotero.reading-bilingual.cachedModels",
          JSON.stringify(models),
          true
        );
      } catch (e) {}

      return models;
    }

    // OpenAI-compatible providers: DeepSeek, SiliconFlow, OpenRouter, Moonshot, Qwen, OpenAI, Custom
    let effectiveUrl = (baseUrl || this.getBaseUrl() || "").trim();
    if (!effectiveUrl) {
      const defaultUrls = {
        deepseek: "https://api.deepseek.com/v1",
        siliconflow: "https://api.siliconflow.cn/v1",
        openrouter: "https://openrouter.ai/api/v1",
        moonshot: "https://api.moonshot.cn/v1",
        qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        openai: "https://api.openai.com/v1"
      };
      effectiveUrl = defaultUrls[targetProvider] || "https://api.deepseek.com/v1";
    }

    const modelsEndpoint = `${effectiveUrl.replace(/\/+$/, "")}/models`;
    const response = await fetch(modelsEndpoint, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`
      }
    });

    if (!response.ok) {
      let errText = "";
      try {
        const errJson = await response.json();
        errText = errJson.error?.message || response.statusText;
      } catch (e) {
        errText = response.statusText;
      }
      throw new Error(`HTTP ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const rawList = Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);
    const models = rawList
      .filter(m => m && m.id && typeof m.id === "string")
      .map(m => ({
        id: m.id,
        displayName: m.id,
        description: m.description || ""
      }));

    if (models.length === 0) {
      models.push({ id: "default", displayName: "默认模型", description: "" });
    }

    try {
      Zotero.Prefs.set(
        "extensions.zotero.reading-bilingual.cachedModels",
        JSON.stringify(models),
        true
      );
    } catch (e) {}

    return models;
  },

  getCachedModels() {
    try {
      const raw = Zotero.Prefs.get("extensions.zotero.reading-bilingual.cachedModels", true);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return [
      { id: "gemini-flash-latest", displayName: "gemini-flash-latest (自动最新 Flash - 推荐)" },
      { id: "gemini-3.8-flash", displayName: "Gemini 3.8 Flash" },
      { id: "gemini-3.7-flash", displayName: "Gemini 3.7 Flash" },
      { id: "gemini-3.6-flash", displayName: "Gemini 3.6 Flash" },
      { id: "gemini-3.5-flash", displayName: "Gemini 3.5 Flash" },
      { id: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash" },
      { id: "gemini-pro-latest", displayName: "gemini-pro-latest (自动最新 Pro)" },
    ];
  },

  getAutoTranslate() {
    try {
      const val = Zotero.Prefs.get(this.PREF_AUTO_TRANSLATE, true);
      if (typeof val === "boolean") return val;
    } catch (e) {}
    return true; // 默认开启：进入阅读模式自动翻译
  },

  getTranslateTables() {
    try {
      const val = Zotero.Prefs.get(this.PREF_TRANSLATE_TABLES, true);
      if (typeof val === "boolean") return val;
    } catch (e) {}
    return true; // 默认开启：表格与图块整体翻译
  },

  setTranslateTables(val) {
    Zotero.Prefs.set(this.PREF_TRANSLATE_TABLES, !!val, true);
  },

  setAutoTranslate(val) {
    Zotero.Prefs.set(this.PREF_AUTO_TRANSLATE, !!val, true);
  },

  getCustomPrompt() {
    try {
      const prompt = Zotero.Prefs.get(this.PREF_CUSTOM_PROMPT, true);
      if (prompt && typeof prompt === "string" && prompt.trim().length > 10) {
        return prompt.trim();
      }
    } catch (e) {}
    return this.DEFAULT_PROMPT;
  },

  setCustomPrompt(prompt) {
    Zotero.Prefs.set(this.PREF_CUSTOM_PROMPT, (prompt || "").trim(), true);
  },

  getFontFamily() {
    try {
      const v = Zotero.Prefs.get(this.PREF_FONT_FAMILY, true);
      if (v) return v;
    } catch (e) {}
    return "songti";
  },

  setFontFamily(v) {
    Zotero.Prefs.set(this.PREF_FONT_FAMILY, v || "songti", true);
  },

  getCustomFont() {
    try {
      const v = Zotero.Prefs.get(this.PREF_CUSTOM_FONT, true);
      if (v) return v;
    } catch (e) {}
    return "";
  },

  setCustomFont(v) {
    Zotero.Prefs.set(this.PREF_CUSTOM_FONT, (v || "").trim(), true);
  },

  getFrameTheme() {
    try {
      const v = Zotero.Prefs.get(this.PREF_FRAME_THEME, true);
      if (v) return v;
    } catch (e) {}
    return "crimson";
  },

  setFrameTheme(v) {
    Zotero.Prefs.set(this.PREF_FRAME_THEME, v || "crimson", true);
  },

  getCustomColor() {
    try {
      const v = Zotero.Prefs.get(this.PREF_CUSTOM_COLOR, true);
      if (v) return v;
    } catch (e) {}
    return "#a8202b";
  },

  setCustomColor(v) {
    Zotero.Prefs.set(this.PREF_CUSTOM_COLOR, (v || "#a8202b").trim(), true);
  },

  getCardBgMode() {
    try {
      const v = Zotero.Prefs.get(this.PREF_CARD_BG, true);
      if (v) return v;
    } catch (e) {}
    return "transparent";
  },

  setCardBgMode(v) {
    Zotero.Prefs.set(this.PREF_CARD_BG, v || "transparent", true);
  },

  getFontSize() {
    try {
      const v = Zotero.Prefs.get(this.PREF_FONT_SIZE, true);
      if (v) return v;
    } catch (e) {}
    return "0.95em";
  },

  setFontSize(v) {
    Zotero.Prefs.set(this.PREF_FONT_SIZE, v || "0.95em", true);
  },

  getLineHeight() {
    try {
      const v = Zotero.Prefs.get(this.PREF_LINE_HEIGHT, true);
      if (v) return v;
    } catch (e) {}
    return "1.75";
  },

  setLineHeight(v) {
    Zotero.Prefs.set(this.PREF_LINE_HEIGHT, v || "1.75", true);
  },

  getBorderStyle() {
    try {
      const v = Zotero.Prefs.get(this.PREF_BORDER_STYLE, true);
      if (v && typeof v === "string" && v.trim()) return v.trim();
    } catch (e) {}
    return this.DEFAULT_BORDER_STYLE;
  },

  setBorderStyle(v) {
    Zotero.Prefs.set(this.PREF_BORDER_STYLE, (v || this.DEFAULT_BORDER_STYLE).trim(), true);
  },

  getGeneratedCSS() {
    const fontChoice = this.getFontFamily();
    const customFont = this.getCustomFont();
    const themeChoice = this.getFrameTheme();
    const customColor = this.getCustomColor();
    const fontSize = this.getFontSize();
    const lineHeight = this.getLineHeight();
    const bgMode = this.getCardBgMode();
    const borderStyle = this.getBorderStyle();

    let borderCss = `border-left: 3.5px solid ${themeChoice === "custom" && customColor ? customColor : "#a8202b"} !important; border-radius: 0 6px 6px 0 !important;`;
    if (borderStyle === "straight") {
      borderCss = `border-left: 3.5px solid ${themeChoice === "custom" && customColor ? customColor : "#a8202b"} !important; border-radius: 0 !important;`;
    } else if (borderStyle === "pill") {
      borderCss = `border-left: 4px solid ${themeChoice === "custom" && customColor ? customColor : "#a8202b"} !important; border-radius: 4px 6px 6px 4px !important;`;
    } else if (borderStyle === "dashed") {
      borderCss = `border-left: 2.5px dashed ${themeChoice === "custom" && customColor ? customColor : "#a8202b"} !important; border-radius: 0 6px 6px 0 !important;`;
    } else if (borderStyle === "double") {
      borderCss = `border-left: 4.5px double ${themeChoice === "custom" && customColor ? customColor : "#a8202b"} !important; border-radius: 0 6px 6px 0 !important;`;
    } else if (borderStyle === "thick") {
      borderCss = `border-left: 5px solid ${themeChoice === "custom" && customColor ? customColor : "#a8202b"} !important; border-radius: 0 6px 6px 0 !important;`;
    } else if (borderStyle === "minimal") {
      borderCss = `border-left: 1.5px solid ${themeChoice === "custom" && customColor ? customColor : "#a8202b"} !important; border-radius: 0 5px 5px 0 !important;`;
    } else if (borderStyle === "none") {
      borderCss = `border-left: none !important; border-radius: 6px !important;`;
    }

    let fontFamily = `"Songti SC", "Source Han Serif SC", "Noto Serif CJK SC", "STSong", "SimSun", "Songti TC", serif`;
    if (fontChoice === "sans") {
      fontFamily = `-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`;
    } else if (fontChoice === "kaiti") {
      fontFamily = `"Kaiti SC", "STKaiti", "KaiTi", "BiauKai", serif`;
    } else if (fontChoice === "fangsong") {
      fontFamily = `"STFangsong", "FangSong", serif`;
    } else if (fontChoice === "wenkai") {
      fontFamily = `"LXGW WenKai", "LXGW WenKai Screen", "Kaiti SC", sans-serif`;
    } else if (fontChoice === "inherit") {
      fontFamily = `inherit`;
    } else if (fontChoice === "custom" && customFont) {
      fontFamily = `"${customFont}", serif`;
    }

    const THEME_MAP = {
      crimson: { border: "#a8202b", bgTint: "rgba(168, 32, 43, 0.04)", badgeColor: "#a8202b", badgeBg: "rgba(168, 32, 43, 0.1)" },
      indigo: { border: "#6366f1", bgTint: "rgba(99, 102, 241, 0.06)", badgeColor: "#4338ca", badgeBg: "rgba(99, 102, 241, 0.12)" },
      slate: { border: "#334155", bgTint: "rgba(15, 23, 42, 0.04)", badgeColor: "#1e293b", badgeBg: "rgba(15, 23, 42, 0.08)" },
      emerald: { border: "#059669", bgTint: "rgba(16, 185, 129, 0.05)", badgeColor: "#047857", badgeBg: "rgba(16, 185, 129, 0.12)" },
      amber: { border: "#d97706", bgTint: "rgba(245, 158, 11, 0.05)", badgeColor: "#b45309", badgeBg: "rgba(245, 158, 11, 0.12)" },
      minimal: { border: "#9ca3af", bgTint: "rgba(0, 0, 0, 0.02)", badgeColor: "#4b5563", badgeBg: "rgba(0, 0, 0, 0.05)" }
    };

    let theme = THEME_MAP[themeChoice] || THEME_MAP.crimson;
    if (themeChoice === "custom" && customColor) {
      theme = {
        border: customColor,
        bgTint: `${customColor}0d`,
        badgeColor: customColor,
        badgeBg: `${customColor}1f`
      };
    }

    // Recalculate borderCss with actual theme.border
    if (borderStyle === "straight") {
      borderCss = `border-left: 3.5px solid ${theme.border} !important; border-radius: 0 !important;`;
    } else if (borderStyle === "pill") {
      borderCss = `border-left: 4px solid ${theme.border} !important; border-radius: 4px 6px 6px 4px !important;`;
    } else if (borderStyle === "dashed") {
      borderCss = `border-left: 2.5px dashed ${theme.border} !important; border-radius: 0 6px 6px 0 !important;`;
    } else if (borderStyle === "double") {
      borderCss = `border-left: 4.5px double ${theme.border} !important; border-radius: 0 6px 6px 0 !important;`;
    } else if (borderStyle === "thick") {
      borderCss = `border-left: 5px solid ${theme.border} !important; border-radius: 0 6px 6px 0 !important;`;
    } else if (borderStyle === "minimal") {
      borderCss = `border-left: 1.5px solid ${theme.border} !important; border-radius: 0 5px 5px 0 !important;`;
    } else if (borderStyle === "none") {
      borderCss = `border-left: none !important; border-radius: 6px !important;`;
    }

    let bgColor = theme.bgTint;
    if (bgMode === "transparent") {
      bgColor = "transparent";
    } else if (bgMode === "solid") {
      bgColor = "var(--material-sidepane, #ffffff)";
    }

    return `
      .zotero-bilingual-card {
        position: relative !important;
        display: block !important;
        margin: 8px 0 16px 0 !important;
        padding: 10px 16px !important;
        background-color: ${bgColor} !important;
        ${borderCss}
        color: inherit !important;
        opacity: 0.95 !important;
        font-size: ${fontSize || "0.95em"} !important;
        line-height: ${lineHeight || "1.75"} !important;
        font-family: ${fontFamily} !important;
        box-shadow: ${bgMode === "solid" ? "0 1px 4px rgba(0,0,0,0.06)" : "none"} !important;
        transition: background-color 0.2s ease !important;
        text-align: left !important;
        text-justify: none !important;
        word-break: break-word !important;
        overflow-wrap: break-word !important;
        white-space: normal !important;
        letter-spacing: normal !important;
        word-spacing: normal !important;
        hyphens: auto !important;
      }
      .zotero-bilingual-card:hover {
        background-color: ${bgMode === "transparent" ? "rgba(0,0,0,0.02)" : theme.bgTint} !important;
      }
      .zotero-bilingual-card.translating {
        opacity: 0.65 !important;
        font-style: italic !important;
      }
      .zrb-card-content {
        display: block !important;
        width: 100% !important;
      }
      .zrb-card-actions {
        position: absolute !important;
        top: 6px !important;
        right: 8px !important;
        display: flex !important;
        gap: 5px !important;
        opacity: 0 !important;
        pointer-events: none !important;
        transition: opacity 0.18s ease-in-out !important;
        z-index: 10 !important;
      }
      .zotero-bilingual-card:hover .zrb-card-actions {
        opacity: 1 !important;
        pointer-events: auto !important;
      }
      .zotero-bilingual-card.translating .zrb-card-actions,
      .zotero-bilingual-card.zrb-in-edit .zrb-card-actions {
        display: none !important;
      }
      .zrb-card-action-btn {
        background: var(--material-sidepane, #ffffff) !important;
        color: inherit !important;
        border: 1px solid rgba(0, 0, 0, 0.15) !important;
        border-radius: 4px !important;
        padding: 2px 7px !important;
        font-size: 11px !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        font-weight: 500 !important;
        cursor: pointer !important;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08) !important;
        line-height: 1.4 !important;
        transition: all 0.15s ease !important;
        user-select: none !important;
      }
      .zrb-card-action-btn:hover {
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.14) !important;
      }
      .zrb-btn-edit:hover {
        color: #2563eb !important;
        border-color: #93c5fd !important;
        background: rgba(37, 99, 235, 0.08) !important;
      }
      .zrb-btn-copy:hover {
        color: #059669 !important;
        border-color: #86efac !important;
        background: rgba(16, 185, 129, 0.08) !important;
      }
      .zrb-btn-delete:hover {
        color: #dc2626 !important;
        border-color: #fca5a5 !important;
        background: rgba(239, 68, 68, 0.08) !important;
      }
      .zrb-card-edit-box {
        display: flex !important;
        flex-direction: column !important;
        gap: 8px !important;
        width: 100% !important;
        margin-top: 2px !important;
      }
      .zrb-edit-textarea {
        width: 100% !important;
        box-sizing: border-box !important;
        padding: 8px 10px !important;
        font-family: ${fontFamily} !important;
        font-size: ${fontSize || "0.95em"} !important;
        line-height: ${lineHeight || "1.75"} !important;
        border: 1.5px solid ${theme.border} !important;
        border-radius: 4px !important;
        background: var(--material-sidepane, #ffffff) !important;
        color: inherit !important;
        resize: vertical !important;
        outline: none !important;
      }
      .zrb-edit-actions-bar {
        display: flex !important;
        gap: 8px !important;
        justify-content: flex-end !important;
        align-items: center !important;
      }
      .zrb-edit-tip {
        font-size: 11px !important;
        color: var(--fill-secondary, #64748b) !important;
        margin-right: auto !important;
      }
      .zrb-save-edit-btn {
        background: ${theme.border} !important;
        color: #ffffff !important;
        border: none !important;
        border-radius: 4px !important;
        padding: 4px 12px !important;
        font-size: 11.5px !important;
        cursor: pointer !important;
        font-weight: 600 !important;
      }
      .zrb-cancel-edit-btn {
        background: transparent !important;
        color: var(--fill-secondary, #64748b) !important;
        border: 1px solid rgba(0, 0, 0, 0.15) !important;
        border-radius: 4px !important;
        padding: 4px 10px !important;
        font-size: 11.5px !important;
        cursor: pointer !important;
      }
      .zrb-selection-menu {
        position: absolute !important;
        background: var(--material-sidepane, #ffffff) !important;
        border: 1px solid rgba(0, 0, 0, 0.15) !important;
        border-radius: 8px !important;
        padding: 6px 0 !important;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2), 0 2px 5px rgba(0, 0, 0, 0.08) !important;
        min-width: 240px !important;
        z-index: 999999 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
        animation: zrbMenuFadeIn 0.12s ease-out !important;
      }
      @keyframes zrbMenuFadeIn {
        from { opacity: 0; transform: scale(0.96); }
        to { opacity: 1; transform: scale(1); }
      }
      .zrb-menu-item {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        padding: 8px 14px !important;
        font-size: 12.5px !important;
        color: inherit !important;
        cursor: pointer !important;
        transition: background-color 0.12s ease !important;
        user-select: none !important;
      }
      .zrb-menu-item:hover {
        background-color: rgba(0, 0, 0, 0.06) !important;
      }
      .zrb-menu-item-primary {
        font-weight: 600 !important;
        color: ${theme.badgeColor || theme.border} !important;
      }
      .zrb-menu-separator {
        height: 1px !important;
        background-color: rgba(0, 0, 0, 0.08) !important;
        margin: 4px 0 !important;
      }
      .zotero-bilingual-hidden {
        display: none !important;
      }
      .zotero-bilingual-ref-notice {
        display: inline-block !important;
        margin: 6px 0 14px 0 !important;
        padding: 5px 12px !important;
        background: ${theme.bgTint} !important;
        border-left: 3px solid ${theme.border} !important;
        border-radius: 4px !important;
        font-size: 11.5px !important;
        color: var(--fill-secondary, #666) !important;
        font-style: italic !important;
      }
      .zotero-bilingual-table-card .zrb-card-content {
        white-space: pre-wrap !important;
        font-variant-numeric: tabular-nums !important;
      }
      .zotero-bilingual-toc-card {
        margin: 12px 0 20px 0 !important;
        padding: 14px 18px !important;
        background: ${bgColor} !important;
        ${borderCss}
        font-family: ${fontFamily} !important;
      }
      .zotero-bilingual-toc-title {
        font-size: 13px !important;
        font-weight: 600 !important;
        color: ${theme.badgeColor} !important;
        margin-bottom: 12px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
      }
      .zotero-bilingual-toc-badge {
        display: inline-block !important;
        font-size: 11.5px !important;
        font-weight: 600 !important;
        padding: 2px 8px !important;
        border-radius: 4px !important;
        background-color: ${theme.badgeBg} !important;
        color: ${theme.badgeColor} !important;
      }
      .zotero-bilingual-toc-item {
        font-size: 12px !important;
        line-height: 1.6 !important;
        padding: 2px 0 !important;
        color: inherit !important;
      }
      .zrb-toc-container {
        display: flex !important;
        flex-direction: column !important;
        gap: 3px !important;
      }
      .zrb-toc-row {
        display: flex !important;
        justify-content: space-between !important;
        align-items: baseline !important;
        padding: 3px 0 !important;
        font-size: 12.5px !important;
        line-height: 1.6 !important;
        color: inherit !important;
      }
      .zrb-toc-sub {
        padding-left: 18px !important;
        opacity: 0.92 !important;
      }
      .zrb-toc-title {
        display: inline-flex !important;
        align-items: baseline !important;
        gap: 6px !important;
        max-width: 82% !important;
      }
      .zrb-toc-sec {
        font-weight: 600 !important;
        color: ${theme.badgeColor} !important;
        margin-right: 2px !important;
      }
      .zrb-toc-zh {
        font-weight: 500 !important;
      }
      .zrb-toc-orig {
        font-size: 0.88em !important;
        opacity: 0.7 !important;
        margin-left: 4px !important;
      }
      .zrb-toc-dots {
        flex: 1 !important;
        border-bottom: 1px dotted rgba(120, 120, 120, 0.35) !important;
        margin: 0 8px !important;
        min-width: 15px !important;
        height: 1px !important;
        align-self: center !important;
      }
      .zrb-toc-page {
        font-weight: 600 !important;
        font-size: 12px !important;
        opacity: 0.85 !important;
        font-variant-numeric: tabular-nums !important;
        white-space: nowrap !important;
      }
      .zotero-bilingual-roadmap-card {
        margin: 12px 0 20px 0 !important;
        padding: 13px 18px !important;
        background: ${bgColor} !important;
        ${borderCss}
        font-family: ${fontFamily} !important;
      }
      .zotero-bilingual-roadmap-header {
        display: flex !important;
        align-items: center !important;
        margin-bottom: 8px !important;
      }
      .zotero-bilingual-roadmap-badge {
        display: inline-block !important;
        font-size: 11.5px !important;
        font-weight: 600 !important;
        padding: 2px 8px !important;
        border-radius: 4px !important;
        background-color: ${theme.badgeBg} !important;
        color: ${theme.badgeColor} !important;
      }
      .zotero-bilingual-roadmap-lead {
        font-size: 13px !important;
        font-weight: 600 !important;
        color: inherit !important;
        margin-bottom: 8px !important;
        line-height: 1.6 !important;
      }
      .zotero-bilingual-roadmap-list {
        display: flex !important;
        flex-direction: column !important;
        gap: 6px !important;
      }
      .zotero-bilingual-roadmap-item {
        font-size: 12.5px !important;
        line-height: 1.65 !important;
        color: inherit !important;
        padding-left: 2px !important;
      }
      .zrb-outline-zh {
        color: ${theme.border} !important;
        font-size: 0.9em !important;
        margin-left: 6px !important;
        font-weight: normal !important;
        font-family: ${fontFamily} !important;
      }
    `;
  },

  updateAllReaderStyles() {
    const css = this.getGeneratedCSS();
    if (!Zotero.Reader || !Zotero.Reader._readers) return;
    const readers = Object.values(Zotero.Reader._readers);
    for (let r of readers) {
      const doc = this.getRealContentDoc(r);
      if (doc) {
        let style = doc.getElementById("zotero-bilingual-style");
        if (!style) {
          style = doc.createElement("style");
          style.id = "zotero-bilingual-style";
          (doc.head || doc.body).appendChild(style);
        }
        style.textContent = css;
      }
    }
  },

  cleanTypography(text) {
    if (!text) return "";
    return text
      // Replace multi-spaces / tabs with single space
      .replace(/[ \t]+/g, " ")
      // Remove spaces between Chinese characters
      .replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, "$1$2")
      // Remove spaces before Chinese closing punctuation
      .replace(/\s+([，。！？；：、）》】”’%])/g, "$1")
      // Remove spaces after Chinese opening punctuation
      .replace(/([（《【“‘])\s+/g, "$1")
      // Ensure clean single space between Chinese and English / Numbers
      .replace(/([\u4e00-\u9fa5])([a-zA-Z0-9])/g, "$1 $2")
      .replace(/([a-zA-Z0-9])([\u4e00-\u9fa5])/g, "$1 $2")
      .trim();
  },

  isReferenceHeading(text) {
    if (!text) return false;
    const clean = this.stripSectionLabel(text);
    return /^(?:References?|Bibliography|Literature Cited|Works Cited|Selected References?|参\s*考\s*文\s*献)$/i.test(clean);
  },

  isAppendixHeading(text) {
    if (!text) return false;
    const clean = this.stripSectionLabel(text);
    return /^(?:Appendix|Appendices|Supplementary|Supplementary Material|附\s*录)\b/i.test(clean);
  },

  isBodySectionHeading(text) {
    if (!text) return false;
    const clean = this.stripSectionLabel(text);
    return /^(?:Methods?|Materials?\s+(?:and|&)\s+Methods?|Online\s+Methods?|Experimental\s+(?:Section|Procedures?|Methods?)|Extended\s+Data|Discussion|Results|Author\s+Contributions?|Data\s+Availability|Code\s+Availability|Acknowledgements?|方\s*法|材\s*料\s*与\s*方\s*法|实\s*验\s*流\s*程|附\s*件)\b/i.test(clean);
  },

  isCitationEntry(text) {
    if (!text) return false;
    const trimmed = text.trim();
    if (/^\[\d+\]/.test(trimmed)) return true;
    if (/^\[[A-Za-z]+(?:\s+et\s+al\.)?,?\s*\d{4}\]/.test(trimmed)) return true;
    if (/^\d+\.\s+[A-Z][a-zA-Z]+,\s+[A-Z]/.test(trimmed)) return true;
    if (/^[A-Z][a-zA-Z\s\.\-]+,\s+(?:[A-Z]\.\s*)+\(\d{4}\)/.test(trimmed)) return true;
    if (/\b(?:pp\.\s*\d+[-–]\d+|doi:\s*10\.\d+|arXiv:\d+\.\d+|In\s+Proc\.|In\s+Proceedings\s+of)\b/i.test(trimmed)) {
      if (/^[A-Z][a-z]+,\s+[A-Z]\./.test(trimmed) || /^\[\d+\]/.test(trimmed)) return true;
    }
    return false;
  },

  isRoadmapHeading(text) {
    if (!text) return false;
    const clean = text.replace(/^(?:Section|Sec\.|[0-9IVXLCDM\.\s])+/i, "").trim();
    return /^(?:(?:Paper\s+)?Organization|Structure\s+of\s+(?:the|this)\s+Paper|Roadmap|Paper\s+Outline|Overview\s+and\s+Roadmap|文章架构|篇章结构|组织结构)$/i.test(clean);
  },

  isRoadmapLead(text) {
    if (!text) return false;
    const t = text.trim();
    if (t.length > 500) return false;
    const enPatterns = [
      /(?:organized|structured|arranged|divided|outlined|proceeds|summarized)\s+as\s+follows/i,
      /(?:organization|structure|outline|overview|roadmap|plan)\s+of\s+(?:this|the|our)\s+(?:paper|survey|article|report|study|review|manuscript|document|section|chapter)/i,
      /(?:rest|remainder)\s+of\s+(?:this|the|our)\s+(?:paper|survey|article|report|study|review|manuscript|document|section)\s+(?:is|will\s+be|proceeds)/i,
      /(?:in\s+summary|to\s+summarize|in\s+brief)[,\s]+(?:this|the|our)\s+(?:survey|paper|article)\s+is\s+organized/i,
      /(?:this|the|our)\s+(?:paper|survey|article)\s+is\s+(?:organized|structured)\s+(?:into|around)/i,
      /we\s+(?:structure|organize|divide|outline)\s+(?:this|the|our)\s+(?:paper|survey|article)\s+as\s+follows/i,
      /sections?\s+are\s+organized\s+as\s+follows/i,
      /paper\s+proceeds\s+as\s+follows/i,
      /(?:overview|roadmap)\s+of\s+the\s+remainder/i,
      /(?:paper|survey|article)\s+is\s+organized\s+according\s+to/i,
      /organization\s+is\s+as\s+follows/i,
    ];
    const zhPatterns = [
      /(?:本文|本综述|本研究|本报告|文章|全篇|本章)(?:的)?(?:结构|架构|组织|章节|内容)?(?:安排|组织|架构|划分|概述)?(?:如下|安排为)/,
      /(?:余下|后续|后续章节|其余)(?:部分|内容)(?:安排|组织)?如下/,
    ];
    return enPatterns.some((rgx) => rgx.test(t)) || zhPatterns.some((rgx) => rgx.test(t));
  },

  isSelfContainedRoadmap(text) {
    if (!text || text.length < 80) return false;
    const hasLead = /(?:organized|structured|arranged|divided|outlined|proceeds|summarized)\s+as\s+follows|remainder\s+of\s+(?:this|the|our)\s+paper/i.test(text);
    if (!hasLead) return false;
    const bulletMatches = text.match(/(?:[•\-\*·\–\—\u2022\u2023\u25E6\u2043\u25AA\u25CF\u2219]|\([§\s]*\d+\)|\b(?:Section|Sec\.|§)\s*\d+\b)/g);
    return bulletMatches && bulletMatches.length >= 2;
  },

  extractRoadmapBullets(text) {
    if (!text) return [];
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const items = [];
    for (let line of lines) {
      // Split on bullet characters (•, \u2022, \u2219, etc.) or section marks followed by Section/Sec./§
      const subParts = line
        .split(/(?=[•\u2022\u2219\u2023\u25E6\u2043\u25AA\u25CF])|(?<=\.\s+)(?=(?:Section|Sec\.|§)\s*\d+)/g)
        .map((s) => s.trim())
        .filter((s) => s.length > 5);
      if (subParts.length > 1) {
        items.push(...subParts);
      } else {
        items.push(line);
      }
    }
    return items;
  },

  splitSelfContainedRoadmap(text) {
    const leadMatch = text.match(/^(.*?(?:organized|structured|arranged|divided|outlined|proceeds|summarized)\s+as\s+follows[:\.]?|.*?remainder\s+of\s+(?:this|the|our)\s+paper\s+(?:is|will\s+be|proceeds)[^:\.]*[:\.]?)\s*(.*)$/is);
    if (leadMatch) {
      const leadText = leadMatch[1].trim();
      const rest = leadMatch[2].trim();
      const items = this.extractRoadmapBullets(rest);
      return { leadText, items };
    }
    return { leadText: text, items: [] };
  },

  isRoadmapItem(text, el) {
    if (!text) return false;
    const t = text.trim();
    if (t.length < 3 || t.length > 700) return false;

    // Inside a list item element (li)
    if (el && el.tagName && el.tagName.toLowerCase() === "li") return true;

    // Bullet characters: •, -, *, ·, –, —, ◦, ‣, ⁃, etc.
    if (/^[•\-\*·\–\—\u2022\u2023\u25E6\u2043\u25AA\u25CF\u2219]\s*/.test(t)) return true;

    // Numbered item: 1., (1), 1), [1], (a), a)
    if (/^(?:\(?\d+[\.\)]|\([a-z]\))\s+/i.test(t)) return true;

    // Starts with section indicator: Section 2, Sec. 2, §2, Chapter 2, Part 2
    if (/^(?:Section|Sec\.|Chapter|Part|§)\s*(?:\d+|[IVXLCDM]+|[A-Z])\b/i.test(t)) return true;

    // Contains section reference: (§2), (§ 2), (Section 2), in Section 2, in §2, [Section 2], [§2]
    if (/[\(\[][§\s]*\d+[\)\]]/.test(t) || /\b(?:Section|Sec\.|§)\s*\d+\b/i.test(t)) return true;

    // Common roadmap transition words
    if (/^(?:First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth|Next|Then|Finally|Lastly)[,\s]/i.test(t)) return true;

    // Academic section summary verbs ("We define...", "We review...", "We examine...", "We survey...", "We evaluate...")
    if (/^We\s+(?:define|review|examine|survey|separate|map|close|present|discuss|introduce|describe|propose|evaluate|investigate|analyze|conclude)\b/i.test(t)) return true;

    // Direct section start: In Section 2, In §2
    if (/^In\s+(?:Section|Sec\.|§)\s*\d+/i.test(t)) return true;

    // List item attributes or classes
    if (el && (el.classList?.contains("list-item") || el.classList?.contains("bullet") || el.getAttribute?.("role") === "listitem")) return true;

    return false;
  },

  parseRoadmapResponse(rawText, count) {
    let leadZh = "";
    const itemsZh = new Array(count).fill("");

    const leadMatch = rawText.match(/(?:【引导】|\[引导\]|引导[:：])\s*([^\n\r]+)/i);
    if (leadMatch && leadMatch[1]) {
      leadZh = leadMatch[1].trim();
    }

    for (let i = 0; i < count; i++) {
      const idx = i + 1;
      const regex = new RegExp(`(?:【分项${idx}】|\\[分项${idx}\\]|分项${idx}[:：]|【项${idx}】|\\[项${idx}\\]|项${idx}[:：]|【P${idx}】|\\[P${idx}\\])\\s*([\\s\\S]*?)(?=(?:【分项\\d+】|\\[分项\\d+\\]|分项\\d+[:：]|【项\\d+】|\\[项\\d+\\]|项\\d+[:：]|【P\\d+】|\\[P\\d+\\]|$))`, "i");
      const m = rawText.match(regex);
      if (m && m[1]) {
        itemsZh[i] = m[1].trim();
      }
    }

    const hasEmpty = itemsZh.some((s) => !s);
    if (hasEmpty) {
      const cleanLines = rawText
        .split(/\r?\n/)
        .map((l) => l.replace(/^(?:【引导】|\[引导\]|引导[:：]|【分项\d+】|\[分项\d+\]|分项\d+[:：]|【项\d+】|\[项\d+\]|项\d+[:：]|【P\d+】|\[P\d+\]|[•\-\*·])\s*/, "").trim())
        .filter((l) => l.length > 0);

      if (!leadZh && cleanLines.length > 0) {
        leadZh = cleanLines[0];
        cleanLines.shift();
      }

      for (let i = 0; i < count; i++) {
        if (!itemsZh[i] && cleanLines[i]) {
          itemsZh[i] = cleanLines[i];
        }
      }
    }

    return { leadZh, itemsZh };
  },

  hashText(str) {
    if (!str) return "0";
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  },

  escapeHTML(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  },

  // Strip a leading section label ("2.", "IV.", "Section 3.") without eating the
  // first letter of the title, which the old [0-9IVXLCDM] character class did:
  // "Contents" became "ontents", "Methods" became "ethods", "Discussion"
  // became "iscussion".
  stripSectionLabel(text) {
    return (text || "")
      .replace(/^\s*(?:Section|Sec\.)\s*/i, "")
      .replace(/^\s*(?:\d+(?:\.\d+)*|[IVXLCDM]+)[.、)\]]?\s+/, "")
      .trim();
  },

  isTocHeading(text) {
    if (!text) return false;
    // Strip only a leading section label ("1", "2.", "IV.", "Section 3.").
    // The old pattern used a character class that also ate the first letter of
    // the title itself, so a plain "Contents" heading became "ontents".
    const clean = this.stripSectionLabel(text);
    return /^(?:(?:Table of|Brief)\s+)?Contents\b/i.test(clean) ||
           /^(?:Outline|Paper Outline|Overview)\b/i.test(clean) ||
           /^(?:目\s*录|目\s*次|內\s*容|内\s*容目录)/.test(clean);
  },

  isTocItemText(text) {
    if (!text) return false;
    const trimmed = text.trim();
    if (trimmed.length < 2 || trimmed.length > 250) return false;

    // 1. Explicit dot leaders with trailing page number: "2.1 Agent Skill . . . . . . . . 6" or "...... 12"
    if (/(?:[\.·•\-\s]{3,}|…+)\s*\d+$/.test(trimmed)) return true;

    // 2. Section number followed by title and ending in page number:
    // e.g. "1 Introduction 4", "1. Introduction 4", "2 Definition 6", "3 Skill Representation8", "5.1 Skill Selection 11"
    const numPageMatch = trimmed.match(/^((?:\d+(?:\.\d+)*|[IVXLCDM]+|[A-Z])[\.\s]+)(.*?)(\s*\d+)$/i);
    if (numPageMatch) {
      const body = numPageMatch[2].trim();
      if (!body.endsWith(".") && !body.endsWith(";") && !/(?:\.|\?|\!)\s+[A-Z]/.test(body)) {
        return true;
      }
    }

    // 3. Section number with short title inside TOC context (e.g. "2.1 Agent Skill", "2.1.3 Architecture")
    if (/^(?:\d+\.\d+(?:\.\d+)*)\s+[A-Za-z\u4e00-\u9fa5]/.test(trimmed) && trimmed.length < 90 && !/(?:\.|\?|\!)\s+[A-Z]/.test(trimmed)) {
      return true;
    }

    // 4. Special sections with page numbers: "References 14", "Appendix A 18", "Index 22", "Abstract 2"
    if (/^(?:Abstract|Contents|Introduction|Conclusion|References|Bibliography|Appendix(?:\s+[A-Z0-9]+)?|Index)\s+[\.·\s]*\d+$/i.test(trimmed)) {
      return true;
    }

    return false;
  },

  isCaptionText(text) {
    if (!text) return false;
    const trimmed = text.trim();
    return /^(?:Figure|Fig\.|Table|Tab\.|Scheme|Box|Extended Data (?:Figure|Table)|Supplementary (?:Figure|Table)|图|表)\s*\d+[\s:\|\.\-–—]/i.test(trimmed);
  },

  parseTocRow(rawText, zhText) {
    const raw = (rawText || "").trim();
    let zh = (zhText || raw).trim();

    // Extract page number from the end
    let page = "";
    const pageMatch = raw.match(/\s*(\d+)$/);
    if (pageMatch) {
      page = pageMatch[1];
    }

    // Remove dot leaders and trailing page number from both raw and zh
    let cleanRaw = raw.replace(/(?:[\.·•\-\s]{2,}|…+)\s*\d+$/, "").replace(/\s*\d+$/, "").trim();
    let cleanZh = zh.replace(/(?:[\.·•\-\s]{2,}|…+)\s*\d+$/, "").replace(/\s*\d+$/, "").trim();

    // Strip any LLM prompt prefix like [T1], 【T1】, T1:
    cleanZh = cleanZh.replace(/^(?:\[T\d+\]|【T\d+】|T\d+[:：])\s*/i, "").trim();

    // Extract section number from beginning (e.g. "1", "2.1", "IV", "A.1")
    let secNum = "";
    const secMatch = cleanRaw.match(/^((?:\d+(?:\.\d+)*|[IVXLCDM]+|[A-Z])[\.\s]+)/i);
    if (secMatch) {
      secNum = secMatch[1].trim();
      cleanRaw = cleanRaw.slice(secMatch[0].length).trim();
      cleanZh = cleanZh.replace(new RegExp(`^${secNum}[\\.\\s]*`), "").trim();
    }

    const isSub = /(?:\.|\b[a-z]\b)/.test(secNum);

    return {
      secNum: secNum,
      rawTitle: cleanRaw,
      zhTitle: cleanZh || cleanRaw,
      page: page,
      isSub: isSub
    };
  },

  parseIndexedTranslations(rawText, count, prefix = "P") {
    const results = new Array(count).fill("");
    for (let i = 0; i < count; i++) {
      const idx = i + 1;
      const regex = new RegExp(`(?:\\[${prefix}${idx}\\]|【${prefix}${idx}】|${prefix}${idx}[:：])\\s*([^\\n\\r]+)`, "i");
      const m = rawText.match(regex);
      if (m && m[1]) {
        results[i] = m[1].trim();
      }
    }
    return results;
  },

  // Main Window Hooks
  onMainWindowLoad(win) {
    this.injectMenus(win);
    this.injectShortcuts(win);
  },

  onMainWindowUnload(win) {
    this.removeMenus(win);
    this.removeShortcuts(win);
  },

  shutdown() {
    for (let win of Zotero.getMainWindows()) {
      this.removeMenus(win);
      this.removeShortcuts(win);
    }

    for (const observer of this._observers) {
      try { observer.disconnect(); } catch (e) {}
    }
    this._observers = [];

    if (this._autoTranslateTimer) {
      clearTimeout(this._autoTranslateTimer);
      this._autoTranslateTimer = null;
    }

    try {
      if (this._tabObserver && typeof Zotero_Tabs !== "undefined" && Zotero_Tabs.removeObserver) {
        Zotero_Tabs.removeObserver(this._tabObserver);
      }
    } catch (e) {}
    this._tabObserver = null;

    // Strip the toolbar button out of every open reader. Leaving it there is
    // what made an in-place upgrade look like a dead button: the next load saw
    // a button already present and skipped injecting its own.
    try {
      if (Zotero.Reader && Zotero.Reader._readers) {
        for (let reader of Object.values(Zotero.Reader._readers)) {
          try {
            const doc = reader._iframeWindow?.document || reader._iframe?.contentDocument;
            if (!doc) continue;
            const btn = doc.getElementById("zotero-reading-bilingual-btn");
            if (btn) btn.remove();
            const style = doc.getElementById("zotero-reading-bilingual-btn-style");
            if (style) style.remove();
          } catch (e) {}
        }
      }
    } catch (e) {}
  },

  injectMenus(win) {
    const doc = win.document;
    if (!doc) return;

    const toolsPopup = doc.getElementById("menu_ToolsPopup");
    if (toolsPopup && !doc.getElementById("reading-bilingual-tools-translate")) {
      const transItem = doc.createXULElement("menuitem");
      transItem.id = "reading-bilingual-tools-translate";
      transItem.setAttribute("label", "重新翻译当前文献 (Cmd/Ctrl+Shift+T)");
      transItem.addEventListener("command", () => {
        this.retranslateActiveReader(null, win);
      });
      toolsPopup.appendChild(transItem);
      this.addedElementIDs.push(transItem.id);

      const toggleItem = doc.createXULElement("menuitem");
      toggleItem.id = "reading-bilingual-tools-toggle";
      toggleItem.setAttribute("label", "显示/隐藏双语译文 (Cmd/Ctrl+Shift+H)");
      toggleItem.addEventListener("command", () => {
        this.toggleVisibility(null, win);
      });
      toolsPopup.appendChild(toggleItem);
      this.addedElementIDs.push(toggleItem.id);
    }

    const itemMenu = doc.getElementById("zotero-itemmenu");
    if (itemMenu && !doc.getElementById("reading-bilingual-item-translate")) {
      const contextItem = doc.createXULElement("menuitem");
      contextItem.id = "reading-bilingual-item-translate";
      contextItem.setAttribute("label", "阅读模式沉浸式双语翻译");
      contextItem.addEventListener("command", () => {
        this.translateActiveReader(null, win);
      });
      itemMenu.appendChild(contextItem);
      this.addedElementIDs.push(contextItem.id);
    }
  },

  removeMenus(win) {
    const doc = win.document;
    if (!doc) return;
    for (let id of this.addedElementIDs) {
      const el = doc.getElementById(id);
      if (el) el.remove();
    }
  },

  injectShortcuts(win) {
    const keyHandler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
        if (e.key === "T" || e.key === "t") {
          e.preventDefault();
          this.retranslateActiveReader(null, win);
        } else if (e.key === "H" || e.key === "h") {
          e.preventDefault();
          this.toggleVisibility(null, win);
        }
      }
    };
    win.addEventListener("keydown", keyHandler, true);
    this.windowListeners.set(win, keyHandler);
  },

  removeShortcuts(win) {
    const keyHandler = this.windowListeners.get(win);
    if (keyHandler) {
      win.removeEventListener("keydown", keyHandler, true);
      this.windowListeners.delete(win);
    }
  },

  // Reader Toolbar, FAB & Auto-Translate Observers
  handleRenderToolbar(event) {
    try {
      const { reader, doc } = event;
      if (!doc) return;
      this.injectToolbarButton(reader, doc);
      this.setupReadingModeObserver(reader, doc);
    } catch (e) {
      Zotero.logError(e);
    }
  },

  injectToolbarButton(reader, doc) {
    if (!doc) return;

    // Clean up any legacy floating FAB
    const oldFab = doc.getElementById("zotero-reading-bilingual-fab");
    if (oldFab) oldFab.remove();

    // A button left behind by a previous load of the plugin still carries a
    // click handler bound to a script that has since been unloaded, so it
    // silently does nothing. Upgrading in place used to leave exactly that
    // behind: bail out here and the toolbar button stops responding until the
    // tab is closed and reopened.
    const staleBtn = doc.getElementById("zotero-reading-bilingual-btn");
    if (staleBtn) {
      if (staleBtn.dataset.zrbSession === this.sessionId) return;
      staleBtn.remove();
      const staleStyle = doc.getElementById("zotero-reading-bilingual-btn-style");
      if (staleStyle) staleStyle.remove();
    }

    // Inject toolbar button CSS if not already present
    if (!doc.getElementById("zotero-reading-bilingual-btn-style")) {
      const style = doc.createElement("style");
      style.id = "zotero-reading-bilingual-btn-style";
      style.textContent = `
        .reading-bilingual-toolbar-btn {
          width: auto !important;
          min-width: 28px !important;
          height: 28px !important;
          padding: 0 7px !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 4px !important;
          border: none !important;
          border-radius: 5px !important;
          background: transparent !important;
          color: var(--fill-secondary, #444) !important;
          cursor: pointer !important;
          font-size: 12px !important;
          font-weight: 500 !important;
          user-select: none !important;
          transition: all 0.15s ease !important;
          box-sizing: border-box !important;
          margin: 0 2px !important;
          vertical-align: middle !important;
        }
        .reading-bilingual-toolbar-btn:hover {
          background-color: var(--fill-quinary, rgba(0, 0, 0, 0.06)) !important;
          color: #4f46e5 !important;
        }
        .reading-bilingual-toolbar-btn.active {
          background-color: rgba(99, 102, 241, 0.12) !important;
          color: #4f46e5 !important;
          font-weight: 600 !important;
        }
        .reading-bilingual-toolbar-btn.translating {
          background-color: rgba(245, 158, 11, 0.15) !important;
          color: #d97706 !important;
        }
        .reading-bilingual-toolbar-btn.success {
          background-color: rgba(16, 185, 129, 0.15) !important;
          color: #059669 !important;
        }
        .reading-bilingual-toolbar-btn.error {
          background-color: rgba(239, 68, 68, 0.15) !important;
          color: #dc2626 !important;
        }
        .reading-bilingual-toolbar-btn svg {
          flex-shrink: 0;
        }
      `;
      (doc.head || doc.body).appendChild(style);
    }

    // Locate the search button (.toolbar-button.find) in the toolbar
    const findBtn =
      doc.querySelector(".toolbar-button.find") ||
      doc.querySelector(".toolbar-button[title*='Find']") ||
      doc.querySelector(".toolbar-button[title*='查找']") ||
      doc.querySelector(".toolbar-button[title*='搜索']");

    const toolbarEnd = doc.querySelector(".toolbar .end") || doc.querySelector(".toolbar");

    // If toolbar is not ready yet, retry in 200ms
    if (!findBtn && !toolbarEnd) {
      setTimeout(() => this.injectToolbarButton(reader, doc), 250);
      return;
    }

    const btn = doc.createElement("button");
    btn.id = "zotero-reading-bilingual-btn";
    btn.dataset.zrbSession = this.sessionId;
    btn.className = "toolbar-button reading-bilingual-toolbar-btn";
    btn.setAttribute("tabindex", "-1");
    btn.setAttribute("title", "沉浸式双语阅读：左键显示/隐藏译文，Shift/Alt+左键重新翻译，右键打开操作菜单");
    btn.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m5 8 6 6"/>
        <path d="m4 14 6-6 2-3"/>
        <path d="M2 5h12"/>
        <path d="M7 2h1"/>
        <path d="m22 22-5-10-5 10"/>
        <path d="M14 18h6"/>
      </svg>
      <span id="zrb-btn-text" style="font-size: 12px; font-weight: 500; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">双语</span>
    `;

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (e.shiftKey || e.altKey) {
        this.retranslateActiveReader(reader);
        return;
      }
      const contentDoc = this.getRealContentDoc(reader);
      const hasCards = contentDoc && contentDoc.querySelector(".zotero-bilingual-card");
      if (hasCards) {
        this.toggleVisibility(reader);
      } else {
        this.translateActiveReader(reader);
      }
    });

    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showButtonContextMenu(e, reader, doc);
    });

    // Place directly to the left of the Search button!
    if (findBtn && findBtn.parentNode) {
      findBtn.parentNode.insertBefore(btn, findBtn);
    } else if (toolbarEnd) {
      toolbarEnd.appendChild(btn);
    }
  },

  showButtonContextMenu(e, reader, doc) {
    const existing = doc.getElementById("zrb-button-context-menu");
    if (existing) existing.remove();

    const menu = doc.createElement("div");
    menu.id = "zrb-button-context-menu";
    const x = Math.max(10, Math.min(e.clientX - 100, (doc.defaultView?.innerWidth || 800) - 230));
    const y = e.clientY + 12;

    const isDarkMode =
      doc.documentElement.getAttribute("data-theme") === "dark" ||
      doc.documentElement.classList.contains("dark") ||
      (doc.defaultView?.matchMedia && doc.defaultView.matchMedia("(prefers-color-scheme: dark)").matches);

    const bgMenu = isDarkMode ? "#24242c" : "#ffffff";
    const textMenu = isDarkMode ? "#f1f5f9" : "#1e293b";
    const borderMenu = isDarkMode ? "#3f3f4e" : "rgba(0, 0, 0, 0.12)";
    const hoverBg = isDarkMode ? "rgba(99, 102, 241, 0.25)" : "rgba(99, 102, 241, 0.1)";

    menu.style.cssText = `
      position: fixed;
      top: ${y}px;
      left: ${x}px;
      z-index: 2147483647;
      background: ${bgMenu};
      color: ${textMenu};
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 1px solid ${borderMenu};
      border-radius: 8px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
      padding: 6px;
      min-width: 210px;
      font-size: 12.5px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      gap: 2px;
      box-sizing: border-box;
    `;

    const addItem = (icon, label, shortcut, onClick) => {
      const item = doc.createElement("div");
      item.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 7px 10px;
        border-radius: 5px;
        cursor: pointer;
        transition: background 0.15s ease;
      `;
      item.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          ${icon ? `<span style="font-size: 14px;">${icon}</span>` : ""}
          <span style="font-weight: 500;">${label}</span>
        </div>
        ${shortcut ? `<span style="font-size: 11px; opacity: 0.6;">${shortcut}</span>` : ""}
      `;
      item.addEventListener("mouseenter", () => (item.style.background = hoverBg));
      item.addEventListener("mouseleave", () => (item.style.background = "transparent"));
      item.addEventListener("click", (evt) => {
        evt.stopPropagation();
        menu.remove();
        onClick();
      });
      menu.appendChild(item);
    };

    addItem("", "重新翻译当前文献", "Cmd+Shift+T", () => {
      this.retranslateActiveReader(reader);
    });

    addItem("", "切换显示/隐藏译文", "Cmd+Shift+H", () => {
      this.toggleVisibility(reader);
    });

    const hr = doc.createElement("div");
    hr.style.cssText = `height: 1px; background: ${borderMenu}; margin: 4px 0;`;
    menu.appendChild(hr);

    addItem("", "双语翻译设置...", "", () => {
      const win = Zotero.getMainWindow();
      this.openSettings(win);
    });

    const closeHandler = (evt) => {
      if (!menu.contains(evt.target)) {
        menu.remove();
        doc.removeEventListener("click", closeHandler, true);
      }
    };
    setTimeout(() => doc.addEventListener("click", closeHandler, true), 10);

    doc.body.appendChild(menu);
  },

  // Watch for Zotero 10 SDT Reading Mode entering
  setupReadingModeObserver(reader, doc) {
    const cDoc = this.getRealContentDoc(reader);
    if (cDoc) this.setupSelectionContextMenu(reader, cDoc);

    if (this.observedDocs.has(doc)) return;
    this.observedDocs.add(doc);

    // Initial check in case already loaded
    this.scheduleAutoTranslate(reader);

    // No bare `window` fallback here either -- same missing-global problem
    const win = doc.defaultView;
    if (!win) return;
    if (!win.MutationObserver) return;

    const observer = new win.MutationObserver(() => {
      this.injectToolbarButton(reader, doc);
      const curContentDoc = this.getRealContentDoc(reader);
      if (curContentDoc) this.setupSelectionContextMenu(reader, curContentDoc);
      this.scheduleAutoTranslate(reader);
    });

    const targetNode = doc.getElementById("split-view") || doc.getElementById("primary-view") || doc.body;
    if (targetNode) {
      observer.observe(targetNode, { childList: true, subtree: true });
      this._observers.push(observer);
    }
  },

  scheduleAutoTranslate(reader) {
    if (!this.getAutoTranslate()) return;
    if (this._autoTranslateTimer) clearTimeout(this._autoTranslateTimer);

    this._autoTranslateTimer = setTimeout(async () => {
      const internal = reader._internalReader || reader;
      const isSDT = !!(
        internal._primarySDTView ||
        (typeof internal._getActiveView === "function" && internal._getActiveView(true)?._iframeDocument?.querySelector("#sdt-content"))
      );
      if (!isSDT) return;

      const contentDoc = this.getRealContentDoc(reader);
      if (!contentDoc) return;

      // Avoid duplicate run if cards already exist or in progress
      if (contentDoc.querySelector(".zotero-bilingual-card")) return;
      const paragraphs = contentDoc.querySelectorAll("#sdt-content p, #sdt-content > p");
      if (paragraphs.length === 0) return;

      Zotero.debug("[ReadingBilingual] Auto-translating reading mode...");
      await this.translateReader(reader, contentDoc, true /* isAuto */);
    }, 450);
  },

  // Active Reader Detection with robust multi-tab & multi-window support
  getActiveReader(win = null) {
    const targetWin = win || Zotero.getMainWindow?.() || (typeof window !== "undefined" ? window : null);

    // 1. If targetWin itself is a standalone reader window
    if (targetWin?.reader) return targetWin.reader;
    if (targetWin?._reader) return targetWin._reader;

    // 2. Native Zotero 7/10 Reader activeReader property
    if (Zotero.Reader?.activeReader) {
      return Zotero.Reader.activeReader;
    }
    if (Zotero.Reader?._activeReader) {
      return Zotero.Reader._activeReader;
    }

    // 3. Check Zotero_Tabs in targetWin or main window
    const mainWin = Zotero.getMainWindow?.() || targetWin;
    const tabs = targetWin?.Zotero_Tabs || mainWin?.Zotero_Tabs || (typeof Zotero_Tabs !== "undefined" ? Zotero_Tabs : null);
    const selectedID = tabs?.selectedID;
    const selectedTab = tabs?.selectedTab || (typeof tabs?.getTab === "function" ? tabs.getTab(tabs.selectedIndex) : null);

    if (selectedTab?.reader) return selectedTab.reader;
    if (selectedTab?.data?.reader) return selectedTab.data.reader;

    // 4. If Zotero.Reader.getByTabID is available and works
    if (selectedID && typeof Zotero.Reader?.getByTabID === "function") {
      try {
        const r = Zotero.Reader.getByTabID(selectedID);
        if (r) return r;
      } catch (e) {}
    }

    // 5. Inspect all readers in Zotero.Reader._readers
    if (Zotero.Reader?._readers) {
      const readers = Array.isArray(Zotero.Reader._readers)
        ? Zotero.Reader._readers
        : Object.values(Zotero.Reader._readers);

      // 5a. Match by tab ID
      if (selectedID) {
        for (let r of readers) {
          if (r.tabID === selectedID || r._tabID === selectedID || r._tab?.id === selectedID) {
            return r;
          }
        }
      }

      // 5b. Match by window association
      if (targetWin) {
        for (let r of readers) {
          if (r.window === targetWin || r._window === targetWin || r._iframeWindow === targetWin) {
            return r;
          }
        }
      }

      // 5c. Match by visibility or focus
      for (let r of readers) {
        try {
          if (r.visible === true || r._visible === true || r.focused === true || r._focused === true) {
            return r;
          }
          const iframe = r._iframe || r._internalReader?._iframe;
          if (iframe && !iframe.hidden && iframe.style.display !== "none" && iframe.offsetParent !== null) {
            return r;
          }
        } catch (e) {}
      }

      // 5d. Match by DOM active tab in mainWin
      if (mainWin?.document) {
        const activeTabEl = mainWin.document.querySelector("tab[selected='true'], .tab[selected='true'], [role='tab'][aria-selected='true']");
        const activeTabId = activeTabEl?.getAttribute("id") || activeTabEl?.id;
        if (activeTabId) {
          for (let r of readers) {
            if (r.tabID === activeTabId || r._tabID === activeTabId || r._tab?.id === activeTabId) {
              return r;
            }
          }
        }
      }

      // 5e. Only fall back to readers[0] if there is exactly 1 reader open!
      if (readers.length === 1) {
        return readers[0];
      }
    }

    return null;
  },

  // Deep Document Resolver for Zotero 10 SDT Reading Mode & PDF Views
  getRealContentDoc(reader) {
    if (!reader) return null;
    const internal = reader._internalReader || reader;

    // 1. Zotero 10 SDT View (阅读模式专有视图)
    if (internal._primarySDTView) {
      const doc = internal._primarySDTView._iframeDocument || 
                  internal._primarySDTView._iframe?.contentDocument ||
                  internal._primarySDTView._iframeWindow?.document;
      if (doc && doc.querySelector("#sdt-content, p")) {
        return doc;
      }
    }

    // 2. Active View via _getActiveView(true)
    if (typeof internal._getActiveView === "function") {
      const active = internal._getActiveView(true);
      if (active) {
        const doc = active._iframeDocument || 
                    active._iframe?.contentDocument || 
                    active._iframeWindow?.document;
        if (doc && doc.querySelector("#sdt-content, p, article")) {
          return doc;
        }
      }
    }

    // 3. Inspect internal._views array
    if (internal._views && Array.isArray(internal._views)) {
      for (let v of internal._views) {
        const d = v._iframeDocument || v._iframe?.contentDocument || v._iframeWindow?.document;
        if (d && d.querySelector("#sdt-content, p")) {
          return d;
        }
      }
    }

    // 4. Primary View document (PDF viewer or web viewer)
    if (internal._primaryView) {
      const pdoc = internal._primaryView._iframeWindow?.document ||
                   internal._primaryView._iframe?.contentDocument ||
                   internal._primaryView._iframeDocument;
      if (pdoc && pdoc.querySelector("p, .textLayer > div")) {
        return pdoc;
      }
    }

    // 5. Recursive traversal of all nested iframes
    let candidates = [];
    function scan(win) {
      if (!win) return;
      try {
        const d = win.document;
        if (d) {
          const count = d.querySelectorAll("#sdt-content p, #sdt-content > *, article > p, p, .textLayer > div").length;
          if (count > 0) {
            candidates.push({ doc: d, count });
          }
          const iframes = d.querySelectorAll("iframe");
          for (let ifr of iframes) {
            try {
              if (ifr.contentWindow) scan(ifr.contentWindow);
            } catch (e) {}
          }
        }
      } catch (e) {}
    }

    scan(reader._iframeWindow || internal._iframeWindow);
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.count - a.count);
      return candidates[0].doc;
    }

    // Fallback
    return (
      reader._internalReader?._primarySDTView?._iframeDocument ||
      reader._internalReader?._primaryView?._iframeWindow?.document ||
      reader._iframeWindow?.document ||
      reader._iframe?.contentDocument
    );
  },

  // Cache Management: Stores alongside original PDF in its folder
  async getCacheFilePath(reader) {
    try {
      if (!reader || !reader.itemID) return null;
      const item = await Zotero.Items.getAsync(reader.itemID);
      if (!item) return null;
      const filePath = await item.getFilePathAsync();
      if (!filePath) return null;

      const dir = (typeof PathUtils !== "undefined" && PathUtils.parent)
        ? PathUtils.parent(filePath)
        : OS.Path.dirname(filePath);

      const filename = (typeof PathUtils !== "undefined" && PathUtils.filename)
        ? PathUtils.filename(filePath)
        : OS.Path.basename(filePath);

      const baseName = filename.replace(/\.[^/.]+$/, "");
      const joinFunc = (typeof PathUtils !== "undefined" && PathUtils.join)
        ? PathUtils.join
        : OS.Path.join;

      // E.g. /path/to/storage/XYZ/He_et_al.bilingual.json
      return joinFunc(dir, `${baseName}.bilingual.json`);
    } catch (e) {
      Zotero.debug("[ReadingBilingual] getCacheFilePath error: " + e);
      return null;
    }
  },

  async loadCache(reader) {
    const path = await this.getCacheFilePath(reader);
    if (!path) return {};
    try {
      let content = null;
      if (typeof IOUtils !== "undefined" && IOUtils.readUTF8) {
        if (await IOUtils.exists(path)) {
          content = await IOUtils.readUTF8(path);
        }
      } else if (typeof Zotero.File !== "undefined" && Zotero.File.getContentsAsync) {
        content = await Zotero.File.getContentsAsync(path);
      }

      if (content) {
        const data = JSON.parse(content);
        return data.translations || {};
      }
    } catch (e) {
      Zotero.debug("[ReadingBilingual] Cache load note: " + e.message);
    }
    return {};
  },

  async deleteCache(reader) {
    try {
      const path = await this.getCacheFilePath(reader);
      if (!path) return;
      if (typeof IOUtils !== "undefined" && IOUtils.remove) {
        if (await IOUtils.exists(path)) {
          await IOUtils.remove(path);
          Zotero.debug("[ReadingBilingual] Cleared previous cache file: " + path);
        }
      } else if (typeof OS !== "undefined" && OS.File && OS.File.remove) {
        if (await OS.File.exists(path)) {
          await OS.File.remove(path);
        }
      }
    } catch (e) {
      Zotero.debug("[ReadingBilingual] deleteCache note: " + e.message);
    }
  },

  async deleteCacheEntry(reader, key) {
    if (!key) return;
    const path = await this.getCacheFilePath(reader);
    if (!path) return;
    try {
      let existing = await this.loadCache(reader);
      if (existing && existing[key] !== undefined) {
        delete existing[key];
        const payload = JSON.stringify(
          {
            version: 1,
            itemID: reader.itemID,
            model: this.getModel(),
            updatedAt: new Date().toISOString(),
            translations: existing,
          },
          null,
          2
        );
        if (typeof IOUtils !== "undefined" && IOUtils.writeUTF8) {
          await IOUtils.writeUTF8(path, payload, { tmpPath: path + ".tmp" });
        } else if (typeof Zotero.File !== "undefined" && Zotero.File.putContentsAsync) {
          await Zotero.File.putContentsAsync(path, payload);
        }
        Zotero.debug("[ReadingBilingual] Deleted cache entry: " + key.slice(0, 30));
      }
    } catch (e) {
      Zotero.debug("[ReadingBilingual] deleteCacheEntry note: " + e.message);
    }
  },

  async saveCache(reader, newTranslations, overwrite = false) {
    const path = await this.getCacheFilePath(reader);
    if (!path) return;
    try {
      let existing = overwrite ? {} : (await this.loadCache(reader));
      const merged = Object.assign(existing, newTranslations);
      const payload = JSON.stringify(
        {
          version: 1,
          itemID: reader.itemID,
          model: this.getModel(),
          updatedAt: new Date().toISOString(),
          translations: merged,
        },
        null,
        2
      );

      if (typeof IOUtils !== "undefined" && IOUtils.writeUTF8) {
        await IOUtils.writeUTF8(path, payload, { tmpPath: path + ".tmp" });
      } else if (typeof Zotero.File !== "undefined" && Zotero.File.putContentsAsync) {
        await Zotero.File.putContentsAsync(path, payload);
      }
      Zotero.debug("[ReadingBilingual] Translations cached to: " + path);
    } catch (e) {
      Zotero.debug("[ReadingBilingual] Cache save note: " + e.message);
    }
  },

  async translateActiveReader(targetReader = null, win = null) {
    const reader = targetReader || this.getActiveReader(win);
    if (!reader) {
      Services.prompt.alert(
        null,
        "沉浸式双语翻译",
        "请先在 Zotero 中打开一篇文献（支持阅读模式与 PDF 页面），然后再点击翻译。"
      );
      return;
    }

    let contentDoc = this.getRealContentDoc(reader);
    if (!contentDoc || contentDoc.querySelectorAll("#sdt-content p, #sdt-content li, p, .textLayer > div").length === 0) {
      await new Promise((r) => setTimeout(r, 400));
      contentDoc = this.getRealContentDoc(reader);
    }

    if (!contentDoc) {
      Services.prompt.alert(
        null,
        "沉浸式双语翻译",
        "未能获取到当前阅读器的正文内容，请等待页面完全加载。"
      );
      return;
    }

    // If cards already exist on page, just unhide if hidden
    const cards = contentDoc.querySelectorAll(".zotero-bilingual-card");
    if (cards.length > 0) {
      let anyHidden = false;
      cards.forEach((c) => {
        if (c.classList.contains("zotero-bilingual-hidden")) {
          c.classList.remove("zotero-bilingual-hidden");
          anyHidden = true;
        }
      });
      const outerDoc = reader._iframeWindow?.document || reader._iframe?.contentDocument;
      const btn = outerDoc?.getElementById("zotero-reading-bilingual-btn");
      const btnText = outerDoc?.getElementById("zrb-btn-text");
      if (btnText) btnText.textContent = "隐藏译文";
      if (btn) btn.classList.add("active");
      return;
    }

    await this.translateReader(reader, contentDoc, false /* isAuto */, false /* forceReTranslate */);
  },

  async retranslateActiveReader(targetReader = null, win = null) {
    const reader = targetReader || this.getActiveReader(win);
    if (!reader) {
      Services.prompt.alert(
        null,
        "沉浸式双语翻译",
        "请先在 Zotero 中打开一篇文献（支持阅读模式与 PDF 页面），然后再点击翻译。"
      );
      return;
    }

    let contentDoc = this.getRealContentDoc(reader);
    if (!contentDoc || contentDoc.querySelectorAll("#sdt-content p, #sdt-content li, p, .textLayer > div").length === 0) {
      await new Promise((r) => setTimeout(r, 400));
      contentDoc = this.getRealContentDoc(reader);
    }

    if (!contentDoc) {
      Services.prompt.alert(
        null,
        "沉浸式双语翻译",
        "未能获取到当前阅读器的正文内容，请等待页面完全加载。"
      );
      return;
    }

    const hasCards = !!contentDoc.querySelector(".zotero-bilingual-card");
    const localCache = await this.loadCache(reader);
    const hasCache = localCache && Object.keys(localCache).length > 0;

    if (hasCards || hasCache) {
      const confirmed = Services.prompt.confirm(
        null,
        "重新翻译确认",
        "当前文献已存在双语译文。\n\n重新翻译将清除现有全部译文与本地缓存，并重新调用 AI 接口生成新译文。\n\n是否确认重新翻译？"
      );
      if (!confirmed) {
        return;
      }
    }

    await this.translateReader(reader, contentDoc, false /* isAuto */, true /* forceReTranslate */);
  },

  // Toggle visibility of existing translated cards (Cmd/Ctrl+Shift+H)
  toggleVisibility(targetReader = null, win = null) {
    const activeReader = targetReader || this.getActiveReader(win);
    if (!activeReader) {
      Services.prompt.alert(null, "沉浸式双语", "请先在 Zotero 中打开文献阅读界面。");
      return;
    }
    const contentDoc = this.getRealContentDoc(activeReader);
    if (!contentDoc) return;
    const cards = contentDoc.querySelectorAll(".zotero-bilingual-card");
    if (cards.length === 0) {
      Services.prompt.alert(null, "沉浸式双语", "当前页面暂无译文可供切换显示。");
      return;
    }
    const isCurrentlyHidden = cards[0].classList.contains("zotero-bilingual-hidden");
    cards.forEach((c) => {
      if (isCurrentlyHidden) {
        c.classList.remove("zotero-bilingual-hidden");
      } else {
        c.classList.add("zotero-bilingual-hidden");
      }
    });
    const outerDoc = activeReader._iframeWindow?.document || activeReader._iframe?.contentDocument;
    const btn = outerDoc?.getElementById("zotero-reading-bilingual-btn");
    const btnText = outerDoc?.getElementById("zrb-btn-text");
    if (btnText) btnText.textContent = isCurrentlyHidden ? "隐藏译文" : "显示译文";
    if (btn) {
      if (isCurrentlyHidden) btn.classList.add("active");
      else btn.classList.remove("active");
    }
  },

  createCardElement(reader, doc, origText, zhText, isTranslating = false) {
    const card = doc.createElement("div");
    card.className = "zotero-bilingual-card" + (isTranslating ? " translating" : "");
    card.dataset.origText = origText || "";

    const content = doc.createElement("div");
    content.className = "zrb-card-content";
    content.textContent = zhText || (isTranslating ? "正在翻译…" : "");
    card.appendChild(content);

    const actions = doc.createElement("div");
    actions.className = "zrb-card-actions";

    const editBtn = doc.createElement("button");
    editBtn.type = "button";
    editBtn.className = "zrb-card-action-btn zrb-btn-edit";
    editBtn.title = "编辑译文 (双击译文也可直接编辑)";
    editBtn.textContent = "✎ 编辑";
    actions.appendChild(editBtn);

    const copyBtn = doc.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "zrb-card-action-btn zrb-btn-copy";
    copyBtn.title = "复制译文";
    copyBtn.textContent = "📋 复制";
    actions.appendChild(copyBtn);

    const delBtn = doc.createElement("button");
    delBtn.type = "button";
    delBtn.className = "zrb-card-action-btn zrb-btn-delete";
    delBtn.title = "删除此段译文并移出缓存";
    delBtn.textContent = "🗑 删除";
    actions.appendChild(delBtn);

    card.appendChild(actions);

    if (!isTranslating) {
      this.attachCardActionHandlers(card, reader, doc, origText);
    }

    return card;
  },

  attachCardActionHandlers(card, reader, doc, origText) {
    if (!card || card._zrbHandlersAttached) return;
    card._zrbHandlersAttached = true;

    const startEdit = () => {
      if (card.classList.contains("zrb-in-edit")) return;
      card.classList.add("zrb-in-edit");
      const contentEl = card.querySelector(".zrb-card-content");
      const currentZh = contentEl ? contentEl.textContent.trim() : card.textContent.trim();

      if (contentEl) contentEl.style.display = "none";
      const actionsEl = card.querySelector(".zrb-card-actions");
      if (actionsEl) actionsEl.style.display = "none";

      const editBox = doc.createElement("div");
      editBox.className = "zrb-card-edit-box";

      const textarea = doc.createElement("textarea");
      textarea.className = "zrb-edit-textarea";
      textarea.value = currentZh;
      textarea.rows = Math.min(12, Math.max(3, Math.ceil(currentZh.length / 32)));
      editBox.appendChild(textarea);

      const btnBar = doc.createElement("div");
      btnBar.className = "zrb-edit-actions-bar";

      const tipSpan = doc.createElement("span");
      tipSpan.className = "zrb-edit-tip";
      tipSpan.textContent = "Cmd/Ctrl+Enter 保存，Esc 取消";
      btnBar.appendChild(tipSpan);

      const cancelBtn = doc.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "zrb-cancel-edit-btn";
      cancelBtn.textContent = "取消";

      const saveBtn = doc.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "zrb-save-edit-btn";
      saveBtn.textContent = "保存修改";

      btnBar.appendChild(cancelBtn);
      btnBar.appendChild(saveBtn);
      editBox.appendChild(btnBar);

      card.appendChild(editBox);
      textarea.focus();

      const finishEdit = async (saved) => {
        if (saved) {
          const newZh = textarea.value.trim();
          if (newZh && contentEl) {
            contentEl.textContent = newZh;
            const key = card.dataset.origText || origText;
            if (key) {
              await this.saveCache(reader, { [key]: newZh });
            }
          }
        }
        editBox.remove();
        if (contentEl) contentEl.style.display = "";
        if (actionsEl) actionsEl.style.display = "";
        card.classList.remove("zrb-in-edit");
      };

      saveBtn.onclick = (e) => {
        e.stopPropagation();
        finishEdit(true);
      };

      cancelBtn.onclick = (e) => {
        e.stopPropagation();
        finishEdit(false);
      };

      textarea.onkeydown = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          finishEdit(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finishEdit(false);
        }
      };
    };

    const contentEl = card.querySelector(".zrb-card-content");
    if (contentEl) {
      contentEl.ondblclick = (e) => {
        e.stopPropagation();
        startEdit();
      };
    }

    const editBtn = card.querySelector(".zrb-btn-edit");
    if (editBtn) {
      editBtn.onclick = (e) => {
        e.stopPropagation();
        startEdit();
      };
    }

    const copyBtn = card.querySelector(".zrb-btn-copy");
    if (copyBtn) {
      copyBtn.onclick = (e) => {
        e.stopPropagation();
        const cEl = card.querySelector(".zrb-card-content");
        const textToCopy = cEl ? cEl.textContent.trim() : card.textContent.trim();
        if (!textToCopy) return;

        const fallbackCopy = () => {
          try {
            const ta = doc.createElement("textarea");
            ta.value = textToCopy;
            doc.body.appendChild(ta);
            ta.select();
            doc.execCommand("copy");
            ta.remove();
            return true;
          } catch (err) {
            return false;
          }
        };

        if (doc.defaultView?.navigator?.clipboard?.writeText) {
          doc.defaultView.navigator.clipboard.writeText(textToCopy).catch(() => fallbackCopy());
        } else {
          fallbackCopy();
        }

        const origLabel = copyBtn.textContent;
        copyBtn.textContent = "✓ 已复制";
        copyBtn.style.color = "#059669";
        setTimeout(() => {
          copyBtn.textContent = origLabel;
          copyBtn.style.color = "";
        }, 1500);
      };
    }

    const delBtn = card.querySelector(".zrb-btn-delete");
    if (delBtn) {
      delBtn.onclick = async (e) => {
        e.stopPropagation();
        const key = card.dataset.origText || origText;
        card.style.transition = "opacity 0.2s ease, transform 0.2s ease";
        card.style.opacity = "0";
        card.style.transform = "translateY(-4px)";
        setTimeout(() => {
          card.remove();
        }, 200);
        if (key) {
          await this.deleteCacheEntry(reader, key);
        }
      };
    }
  },

  setupSelectionContextMenu(reader, contentDoc) {
    if (!contentDoc || !contentDoc.body) return;
    if (contentDoc._zrbContextMenuSetup) return;
    contentDoc._zrbContextMenuSetup = true;

    contentDoc.addEventListener(
      "contextmenu",
      (e) => {
        const selection = contentDoc.getSelection();
        const selectedText = selection ? selection.toString().trim() : "";
        if (!selectedText || selectedText.length < 2) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        this.showSelectionContextMenu(e, reader, contentDoc, selectedText, selection);
      },
      true
    );
  },

  showSelectionContextMenu(e, reader, contentDoc, selectedText, selection) {
    contentDoc.querySelectorAll(".zrb-selection-menu").forEach((m) => m.remove());

    const menu = contentDoc.createElement("div");
    menu.className = "zrb-selection-menu";

    const docWidth = contentDoc.documentElement?.clientWidth || contentDoc.body?.clientWidth || 800;
    let posX = (e.pageX || e.clientX) + 6;
    let posY = (e.pageY || e.clientY) + 6;
    if (posX + 260 > docWidth) {
      posX = Math.max(10, docWidth - 270);
    }
    menu.style.left = `${posX}px`;
    menu.style.top = `${posY}px`;

    // 1. Translate item
    const transItem = contentDoc.createElement("div");
    transItem.className = "zrb-menu-item zrb-menu-item-primary";
    transItem.innerHTML = `<span>🌐</span><span>翻译所选文本为双语对照卡片</span>`;

    // Separator
    const sep = contentDoc.createElement("div");
    sep.className = "zrb-menu-separator";

    // 2. Copy item
    const copyItem = contentDoc.createElement("div");
    copyItem.className = "zrb-menu-item";
    copyItem.innerHTML = `<span>📋</span><span>复制所选文本</span>`;

    menu.appendChild(transItem);
    menu.appendChild(sep);
    menu.appendChild(copyItem);
    contentDoc.body.appendChild(menu);

    const cleanup = () => {
      menu.remove();
      contentDoc.removeEventListener("click", onDocClick, true);
      contentDoc.removeEventListener("keydown", onDocKey, true);
    };

    const onDocClick = (evt) => {
      if (!menu.contains(evt.target)) cleanup();
    };
    const onDocKey = (evt) => {
      if (evt.key === "Escape") cleanup();
    };

    setTimeout(() => {
      contentDoc.addEventListener("click", onDocClick, true);
      contentDoc.addEventListener("keydown", onDocKey, true);
    }, 20);

    transItem.onclick = (evt) => {
      evt.stopPropagation();
      cleanup();
      this.translateSelectedText(reader, contentDoc, selectedText, selection);
    };

    copyItem.onclick = (evt) => {
      evt.stopPropagation();
      cleanup();
      try {
        if (contentDoc.defaultView?.navigator?.clipboard?.writeText) {
          contentDoc.defaultView.navigator.clipboard.writeText(selectedText);
        } else {
          const ta = contentDoc.createElement("textarea");
          ta.value = selectedText;
          contentDoc.body.appendChild(ta);
          ta.select();
          contentDoc.execCommand("copy");
          ta.remove();
        }
      } catch (err) {}
    };
  },

  async translateSelectedText(reader, contentDoc, selectedText, selection) {
    if (!selectedText || !contentDoc) return;

    // Ensure CSS styles are present
    let style = contentDoc.getElementById("zotero-bilingual-style");
    if (!style) {
      style = contentDoc.createElement("style");
      style.id = "zotero-bilingual-style";
      (contentDoc.head || contentDoc.body).appendChild(style);
      style.textContent = this.getGeneratedCSS();
    }

    // Locate insertion anchor element
    let targetEl = null;
    let node = selection?.focusNode;
    if (node && node.nodeType === 3) node = node.parentElement;
    if (node) {
      targetEl = node.closest("p, li, blockquote, div, section, article, h1, h2, h3, h4, h5, h6, tr") || node;
    }
    if (!targetEl || targetEl === contentDoc.body) {
      const range = selection?.rangeCount > 0 ? selection.getRangeAt(0) : null;
      if (range) {
        let common = range.commonAncestorContainer;
        if (common.nodeType === 3) common = common.parentElement;
        targetEl = common.closest("p, li, blockquote, div, section, article") || common;
      }
    }

    if (!targetEl) {
      Services.prompt.alert(null, "沉浸式双语", "未能定位选中文本的段落位置，请重新选取。");
      return;
    }

    const provider = this.getProvider();
    const pLabel = provider === "gemini" ? "Gemini" : provider;
    const placeholder = this.createCardElement(
      reader,
      contentDoc,
      selectedText,
      `正在调用 ${pLabel} 翻译所选文本…`,
      true
    );

    if (targetEl.tagName && targetEl.tagName.toLowerCase() === "li") {
      targetEl.appendChild(placeholder);
    } else {
      targetEl.insertAdjacentElement("afterend", placeholder);
    }

    try {
      const systemPrompt = `你是一位顶尖的学术论文翻译专家。请将用户选中的学术论文英文内容翻译为通顺、严谨、优雅的中文。
翻译要求：
1. 保持严谨客观的学术语气，忠实原文，符合中文学术期刊规范；
2. 专有名词采用学术界通用译法（必要时可保留英文原名于括号中）；
3. 仅输出最终的中文译文，绝对不要包含任何前缀、解释、引言、分析或 Markdown 格式包裹。`;

      const prompt = `请将以下学术论文内容精准翻译为中文：\n\n${selectedText}`;
      const rawResult = await this.callModelText(prompt, systemPrompt);
      const cleanResult = this.cleanTypography(rawResult);

      placeholder.classList.remove("translating");
      const contentEl = placeholder.querySelector(".zrb-card-content");
      if (contentEl) contentEl.textContent = cleanResult;
      placeholder.dataset.origText = selectedText;

      this.attachCardActionHandlers(placeholder, reader, contentDoc, selectedText);
      await this.saveCache(reader, { [selectedText]: cleanResult });
    } catch (err) {
      Zotero.debug("[ReadingBilingual] Manual selection translation error: " + err);
      placeholder.classList.remove("translating");
      placeholder.style.borderLeftColor = "#ef4444";
      const contentEl = placeholder.querySelector(".zrb-card-content");
      if (contentEl) contentEl.textContent = `[翻译失败: ${err.message}]`;
      this.attachCardActionHandlers(placeholder, reader, contentDoc, selectedText);
    }
  },

  // Core Translation Method with Instant Cache & Batching
  async translateReader(reader, doc, isAuto = false, forceReTranslate = false) {
    const outerDoc = reader._iframeWindow?.document || reader._iframe?.contentDocument || doc;
    const btn = outerDoc.getElementById("zotero-reading-bilingual-btn") || doc.getElementById("zotero-reading-bilingual-btn");
    const btnText = outerDoc.getElementById("zrb-btn-text") || doc.getElementById("zrb-btn-text");

    // Say so once, up front, when no key is configured -- otherwise every
    // paragraph comes back as its own HTTP error card. A document that is
    // already fully cached still renders, so this only blocks new requests.
    if (!this.getApiKey()) {
      const existingCache = await this.loadCache(reader);
      if (!existingCache || Object.keys(existingCache).length === 0) {
        if (!isAuto) {
          Services.prompt.alert(
            null,
            "沉浸式双语翻译",
            "尚未配置 API Key。\n\n请打开 Zotero 设置 → 沉浸式双语，填写你自己的 API Key 后再试。"
          );
        }
        return;
      }
    }

    // Inject dynamic CSS styles into the target content document
    let style = doc.getElementById("zotero-bilingual-style");
    if (!style) {
      style = doc.createElement("style");
      style.id = "zotero-bilingual-style";
      (doc.head || doc.body).appendChild(style);
    }
    style.textContent = this.getGeneratedCSS();

    // Setup selection context menu on document for right-click manual translation
    this.setupSelectionContextMenu(reader, doc);

    // 1. AUTO vs MANUAL vs RE-TRANSLATE CONTROL:
    if (forceReTranslate) {
      // User explicitly confirmed re-translation:
      // Wipe clean any existing cards and delete disk cache so we re-translate from scratch!
      const oldCards = doc.querySelectorAll(".zotero-bilingual-card, .zotero-bilingual-ref-notice, .zotero-bilingual-roadmap-card, .zotero-bilingual-toc-card");
      if (oldCards.length > 0) {
        oldCards.forEach((c) => c.remove());
      }
      await this.deleteCache(reader);
    } else {
      // If cards already exist on page and not forcing re-translation, do not repeat
      if (doc.querySelector(".zotero-bilingual-card")) {
        return;
      }
    }

    // Helper for cleanly inserting translation cards (foolproof against duplicate cards)
    const insertCard = (el, card) => {
      if (el.tagName && el.tagName.toLowerCase() === "li") {
        el.querySelectorAll(".zotero-bilingual-card").forEach((c) => c.remove());
        el.appendChild(card);
      } else {
        while (el.nextElementSibling && el.nextElementSibling.classList.contains("zotero-bilingual-card")) {
          el.nextElementSibling.remove();
        }
        el.insertAdjacentElement("afterend", card);
      }
    };

    // Find candidate paragraph and list elements, including headings and figure/table captions
    const selector = [
      "#sdt-content p",
      "#sdt-content li",
      "#sdt-content h1, #sdt-content h2, #sdt-content h3, #sdt-content h4, #sdt-content h5, #sdt-content h6",
      "#sdt-content blockquote",
      "#sdt-content figcaption",
      "#sdt-content caption",
      "#sdt-content [class*='caption']",
      "#sdt-content [class*='figure']",
      "#sdt-content figure > *",
      ".reader-paragraph",
      "figcaption",
      "caption",
      "[class*='caption']",
      ".sdt-caption",
      "figure > p",
      "figure > div",
      "figure > span",
      "p",
      "li",
      ".textLayer > div"
    ].join(", ");

    let candidateNodes = Array.from(doc.querySelectorAll(selector)).filter((el) => {
      if (el.classList.contains("zotero-bilingual-card") || el.classList.contains("zotero-bilingual-ref-notice")) return false;
      if (el.closest(".zotero-bilingual-card, .zotero-bilingual-ref-notice")) return false;
      if (el.tagName && el.tagName.toLowerCase() === "li" && el.querySelector("p, div")) return false;
      return true;
    });

    // Also pick up any missed figure/table captions from custom containers
    const extraCaptions = Array.from(doc.querySelectorAll("figcaption, caption, [class*='caption'], .sdt-caption, figure > p, figure > div"));
    for (const cap of extraCaptions) {
      if (!candidateNodes.includes(cap) && !cap.closest(".zotero-bilingual-card, .zotero-bilingual-ref-notice")) {
        candidateNodes.push(cap);
      }
    }

    // Sort candidate nodes by document position to maintain natural top-to-bottom reading order
    candidateNodes.sort((a, b) => {
      if (a === b) return 0;
      const pos = a.compareDocumentPosition(b);
      // Numeric masks, not the DOM Node interface: this file is loaded with
      // loadSubScript into a plain scope that has no `Node` global, so touching
      // it threw "Node is not defined" here and killed every translation run
      // before a single card could be inserted.
      if (pos & 4 /* DOCUMENT_POSITION_FOLLOWING */) return -1;
      if (pos & 2 /* DOCUMENT_POSITION_PRECEDING */) return 1;
      return 0;
    });

    const tocBlocks = [];
    const tocHandledNodes = new Set();

    // First pass A0: Group whole <ul>/<ol> containers that are really a table of
    // contents. Reading mode renders a PDF contents page as one list of <li>
    // rows, so grouping by container is much more reliable than scanning for a
    // run of sibling candidates, and it keeps a contents page that spans two
    // printed pages in a single card.
    const tocLists = [];
    for (const list of Array.from(doc.querySelectorAll("#sdt-content ul, #sdt-content ol, ul, ol"))) {
      if (list.closest(".zotero-bilingual-card, .zotero-bilingual-ref-notice")) continue;
      const rows = Array.from(list.children)
        .filter((li) => li.tagName && li.tagName.toLowerCase() === "li")
        .map((li) => ({ element: li, text: (li.innerText || "").trim() }))
        .filter((row) => row.text.length > 0);
      if (rows.length < 3) continue;
      const hits = rows.filter((row) => this.isTocItemText(row.text)).length;
      if (hits >= 3 && hits / rows.length >= 0.6) {
        tocLists.push({ list: list, rows: rows });
      }
    }

    // Only a page number or a running header may sit between two halves of the
    // same contents page.
    const isPageFurniture = (el) => {
      const t = (el.innerText || "").trim();
      if (!t) return true;
      if (/^\d{1,4}$/.test(t)) return true;
      return t.length <= 140 && !/[。.!?！？]\s+\S/.test(t);
    };

    let tocListIdx = 0;
    while (tocListIdx < tocLists.length) {
      const group = [tocLists[tocListIdx]];
      let next = tocListIdx + 1;
      while (next < tocLists.length) {
        const between = [];
        let cur = group[group.length - 1].list.nextElementSibling;
        while (cur && cur !== tocLists[next].list && between.length <= 3) {
          between.push(cur);
          cur = cur.nextElementSibling;
        }
        if (cur !== tocLists[next].list || !between.every(isPageFurniture)) break;
        group.push(tocLists[next]);
        next++;
      }

      const items = [];
      group.forEach((g) => g.rows.forEach((row) => items.push(row)));
      tocBlocks.push({
        // Anchor the stray-card sweep on the list containers so it covers every
        // half of a contents page that a page break split apart
        headingElement: group[0].list,
        headingText: "Table of Contents",
        items: items,
        lastElement: group[group.length - 1].list,
      });
      items.forEach((row) => tocHandledNodes.add(row.element));
      tocListIdx = next;
    }

    // First pass A: Detect Table of Contents (TOC) blocks to translate as cohesive units
    for (let i = 0; i < candidateNodes.length; i++) {
      const el = candidateNodes[i];
      if (tocHandledNodes.has(el)) continue;

      const text = (el.innerText || "").trim();

      // Case 1: Heading is TOC (e.g. "Contents", "Table of Contents", "目 录", "Brief Contents")
      if (this.isTocHeading(text)) {
        const items = [];
        let j = i + 1;
        while (j < candidateNodes.length) {
          const nextEl = candidateNodes[j];
          if (tocHandledNodes.has(nextEl)) break;
          const nextText = (nextEl.innerText || "").trim();
          if (!nextText) {
            j++;
            continue;
          }
          const isHeading = /^H[1-6]$/i.test(nextEl.tagName) || nextEl.classList.contains("heading");
          if (this.isTocItemText(nextText)) {
            items.push({ element: nextEl, text: nextText });
            j++;
            continue;
          }
          // Stop if next element is a body section heading without page number (like "Abstract" or "1. Introduction")
          if (isHeading && !this.isTocItemText(nextText)) {
            break;
          }
          // Stop if long body paragraph (> 120 chars) and not TOC item
          if (nextText.length > 120) {
            break;
          }
          // Lookahead: if subsequent item is a TOC item, include this intermediate line
          if (j + 1 < candidateNodes.length && this.isTocItemText((candidateNodes[j + 1].innerText || "").trim())) {
            items.push({ element: nextEl, text: nextText });
            j++;
            continue;
          }
          break;
        }

        if (items.length >= 2) {
          tocBlocks.push({
            headingElement: el,
            headingText: text,
            items: items,
            lastElement: candidateNodes[j - 1],
          });
          tocHandledNodes.add(el);
          for (let k = i + 1; k < j; k++) {
            tocHandledNodes.add(candidateNodes[k]);
          }
          i = j - 1;
          continue;
        }
      }

      // Case 2: Consecutive sequence of TOC items without explicit TOC heading
      // (e.g. "1 Introduction 4", "2 Definition 6", "2.1 Agent Skill ... 6", ...)
      if (this.isTocItemText(text)) {
        const items = [{ element: el, text: text }];
        let j = i + 1;
        while (j < candidateNodes.length) {
          const nextEl = candidateNodes[j];
          if (tocHandledNodes.has(nextEl)) break;
          const nextText = (nextEl.innerText || "").trim();
          if (!nextText) {
            j++;
            continue;
          }
          if (this.isTocItemText(nextText)) {
            items.push({ element: nextEl, text: nextText });
            j++;
          } else {
            break;
          }
        }

        if (items.length >= 3) {
          tocBlocks.push({
            headingElement: null,
            headingText: "Table of Contents",
            items: items,
            lastElement: candidateNodes[j - 1],
          });
          for (let k = i; k < j; k++) {
            tocHandledNodes.add(candidateNodes[k]);
          }
          i = j - 1;
          continue;
        }
      }
    }

    // First pass B: Detect Paper Organization / Roadmap / Outline blocks to translate as cohesive units
    const roadmapBlocks = [];
    const roadmapHandledNodes = new Set();

    for (let i = 0; i < candidateNodes.length; i++) {
      const el = candidateNodes[i];
      if (tocHandledNodes.has(el) || roadmapHandledNodes.has(el)) continue;

      const text = (el.innerText || "").trim();

      // Case A: Self-contained roadmap in a single paragraph
      if (this.isSelfContainedRoadmap(text)) {
        const parts = this.splitSelfContainedRoadmap(text);
        if (parts.items.length >= 2) {
          roadmapBlocks.push({
            leadElement: el,
            leadText: parts.leadText,
            items: parts.items.map((t) => ({ element: el, text: t })),
            lastElement: el,
            isSelfContained: true,
          });
          roadmapHandledNodes.add(el);
          continue;
        }
      }

      // Case B: Roadmap lead paragraph or heading followed by consecutive bullet/section items
      if (this.isRoadmapLead(text) || this.isRoadmapHeading(text)) {
        const items = [];
        let j = i + 1;
        while (j < candidateNodes.length) {
          const nextEl = candidateNodes[j];
          const nextText = (nextEl.innerText || "").trim();
          if (!nextText) {
            j++;
            continue;
          }
          const isHeading = /^H[1-6]$/i.test(nextEl.tagName) || nextEl.classList.contains("heading");
          if (isHeading || this.isReferenceHeading(nextText) || this.isTocHeading(nextText)) {
            break;
          }

          if (this.isRoadmapItem(nextText, nextEl)) {
            const subBullets = this.extractRoadmapBullets(nextText);
            if (subBullets.length > 1) {
              subBullets.forEach((bulletText) => {
                items.push({ element: nextEl, text: bulletText });
              });
            } else {
              items.push({ element: nextEl, text: nextText });
            }
            j++;
          } else {
            break;
          }
        }

        if (items.length >= 2 || (items.length === 1 && /[\(\[][§\s]*\d+[\)\]]/.test(items[0].text))) {
          roadmapBlocks.push({
            leadElement: el,
            leadText: text,
            items: items,
            lastElement: candidateNodes[j - 1],
            isSelfContained: false,
          });
          roadmapHandledNodes.add(el);
          for (let k = i + 1; k < j; k++) {
            roadmapHandledNodes.add(candidateNodes[k]);
          }
          i = j - 1;
        }
      }
    }

    // First pass C: whole tables and image-cropped blocks. Reading mode draws a
    // PDF table as a picture and keeps its text in a hidden node, so nothing
    // inside one can be picked up cell by cell -- it has to be translated as a
    // single unit anchored on the table itself.
    const tableBlocks = [];
    const translateTables = this.getTranslateTables();
    const tableUnitSelector = "#sdt-content table, #sdt-content figure.sdt-source-crop, table, figure.sdt-source-crop";
    for (const el of (translateTables ? Array.from(doc.querySelectorAll(tableUnitSelector)) : [])) {
      if (el.closest(".zotero-bilingual-card, .zotero-bilingual-ref-notice")) continue;
      if (el.classList.contains("sdt-math") || el.querySelector(".sdt-math")) continue;
      if (tableBlocks.some((b) => b.element.contains(el))) continue;
      const raw = (el.getAttribute && el.getAttribute("aria-label")) || el.innerText || el.textContent || "";
      const text = raw.replace(/\s+/g, " ").trim();
      if (text.length < 25) continue;
      const words = text.split(" ").filter((w) => /[A-Za-z\u4e00-\u9fa5]{2,}/.test(w));
      if (words.length < 6) continue;
      tableBlocks.push({ element: el, text: text });
    }

    // Filter candidate nodes with References skipping and TOC grouping
    let isInsideReferences = false;
    let skippedReferencesCount = 0;
    let paragraphs = [];

    for (let el of candidateNodes) {
      if (el.classList.contains("zotero-bilingual-card") || el.classList.contains("zotero-bilingual-ref-notice")) continue;
      if (el.closest(".zotero-bilingual-card")) continue;

      // Skip elements that are part of TOC or Roadmap blocks (they are translated together as cohesive units!)
      if (tocHandledNodes.has(el)) continue;
      if (roadmapHandledNodes.has(el)) continue;

      // Table interiors (cells, and the hidden text node of an image crop) are
      // covered by the table pass instead. With that option off, skip them
      // outright rather than letting the flattened table text leak into the
      // per-paragraph pass as one unreadable card.
      if (el.closest("table, figure.sdt-source-crop")) continue;

      // Avoid duplicating <p> inside <li>
      if (el.tagName && el.tagName.toLowerCase() === "li" && el.querySelector("p")) continue;

      const text = (el.innerText || "").trim();
      const isHeading = /^H[1-6]$/i.test(el.tagName) || el.classList.contains("heading");
      const isCaption = this.isCaptionText(text) || el.tagName?.toLowerCase() === "figcaption" || el.tagName?.toLowerCase() === "caption" || el.closest("figcaption") || el.classList.contains("caption");

      // Check section boundaries
      if (isHeading || (text.length < 60 && !text.includes("."))) {
        if (this.isReferenceHeading(text)) {
          isInsideReferences = true;
          // Mark heading with subtle notice
          if (!el.nextElementSibling?.classList?.contains("zotero-bilingual-ref-notice")) {
            const notice = doc.createElement("div");
            notice.className = "zotero-bilingual-ref-notice";
            notice.textContent = "已自动识别为参考文献章节，跳过翻译以节约额度";
            el.insertAdjacentElement("afterend", notice);
          }
          continue;
        } else if (this.isAppendixHeading(text) || this.isBodySectionHeading(text)) {
          isInsideReferences = false;
        }
      }

      // If inside References, check if current element marks subsequent section like Methods/Extended Data
      if (isInsideReferences) {
        if (this.isBodySectionHeading(text) || this.isAppendixHeading(text)) {
          isInsideReferences = false;
        }
      }

      // Check DOM attributes for references section
      if (el.id?.toLowerCase().includes("reference") || el.closest("section#references, .references, .bibliography, [data-section='references'], .sdt-references")) {
        if (!this.isBodySectionHeading(text)) {
          isInsideReferences = true;
        }
      }

      // If inside References -> skip! (Unless it is an explicit figure/table caption)
      if (isInsideReferences && !isCaption) {
        skippedReferencesCount++;
        continue;
      }

      // Native Zotero SDT reference tag -> skip!
      if (!isCaption && (el.classList.contains("sdt-reference") || el.closest(".sdt-reference"))) {
        skippedReferencesCount++;
        continue;
      }

      // Citation entry format -> skip! (Captions are never skipped as citation entries)
      if (!isCaption && this.isCitationEntry(text)) {
        skippedReferencesCount++;
        continue;
      }

      // Check if already has translation card
      let hasCard = false;
      if (el.tagName && el.tagName.toLowerCase() === "li") {
        hasCard = !!el.querySelector(":scope > .zotero-bilingual-card");
      } else {
        hasCard = el.nextElementSibling?.classList?.contains("zotero-bilingual-card");
      }

      // The 15-character floor exists to drop page numbers and stray
      // fragments, but section headings are short by nature -- "10.Conclusion"
      // is 13 characters and "2.Definition" is 12 -- so it was silently eating
      // them while longer headings on the same page came through. Headings get
      // their own floor plus a "must contain real words" check instead.
      const hasWords = /[A-Za-z\u4e00-\u9fa5]{2,}/.test(text);
      const minLen = isCaption ? 6 : (isHeading ? 3 : 15);
      if (text.length >= minLen && !hasCard && (!isHeading || hasWords)) {
        paragraphs.push(el);
      }
    }

    // Translate detected Table of Contents blocks together
    for (let block of tocBlocks) {
      try {
        await this.translateTocBlock(block, reader, doc, isAuto, forceReTranslate);
      } catch (e) {
        Zotero.debug("[ReadingBilingual] TOC translation error: " + e);
      }
    }

    // Translate detected roadmap / paper structure blocks together
    for (let block of roadmapBlocks) {
      try {
        await this.translateRoadmapTogether(block, reader, doc, isAuto, forceReTranslate);
      } catch (e) {
        Zotero.debug("[ReadingBilingual] Roadmap translation error: " + e);
      }
    }

    // Translate whole tables / cropped blocks as single units
    for (let block of tableBlocks) {
      try {
        await this.translateTableBlock(block, reader, doc, forceReTranslate);
      } catch (e) {
        Zotero.debug("[ReadingBilingual] Table translation error: " + e);
      }
    }

    // Translate sidebar outline titles if available
    this.translateSidebarOutline(reader, outerDoc).catch((e) =>
      Zotero.debug("[ReadingBilingual] Sidebar outline translation: " + e)
    );

    if (paragraphs.length === 0) {
      if (roadmapBlocks.length === 0 && tocBlocks.length === 0 && tableBlocks.length === 0) {
        if (!isAuto) {
          Services.prompt.alert(
            null,
            "沉浸式双语翻译",
            "当前页面未发现可翻译的段落。请确认文献正文是否已完全显示在阅读模式中。"
          );
        }
      } else {
        if (btnText) btnText.textContent = "隐藏译文";
        if (btn) btn.classList.add("active");
      }
      return;
    }

    let cachedCount = 0;
    let paragraphsToTranslate = [];

    // 2. CACHE HANDLING:
    if (!forceReTranslate) {
      // Load from local cache first to avoid consuming API quota!
      const localCache = await this.loadCache(reader);
      paragraphs.forEach((p) => {
        const text = p.innerText.trim();
        if (localCache[text]) {
          // Cache hit! Instant injection with 0 API cost
          const zh = this.cleanTypography(localCache[text]);
          const card = this.createCardElement(reader, doc, text, zh, false);
          insertCard(p, card);
          cachedCount++;
        } else {
          // Cache miss: needs translation
          paragraphsToTranslate.push(p);
        }
      });

      if (paragraphsToTranslate.length === 0) {
        // 100% cache hit!
        if (btnText) btnText.textContent = "隐藏译文";
        if (btn) btn.classList.add("active");
        const progress = new Zotero.ProgressWindow({ closeOnClick: true });
        progress.changeHeadline("沉浸式双语 (本地缓存)");
        const refNote = skippedReferencesCount > 0 ? ` (已排除 ${skippedReferencesCount} 条参考文献)` : "";
        const progressItem = new progress.ItemProgress(
          "chrome://readingbilingual/content/icons/icon.svg",
          `已从 PDF 目录缓存极速载入全部 ${cachedCount} 个段落${refNote} (0 API 消耗)`
        );
        progress.show();
        progressItem.setProgress(100);
        progress.startCloseTimer(2000);
        return;
      }
    } else {
      // User explicitly confirmed re-translation from scratch!
      paragraphsToTranslate = paragraphs;
    }

    // 2. TRANSLATE REMAINING PARAGRAPHS WITH MULTI-PROVIDER BATCHING
    const provider = this.getProvider();
    const baseUrl = this.getBaseUrl();
    const apiKey = this.getApiKey();
    const model = this.getModel();

    if (btn) {
      btn.classList.add("translating");
      btn.classList.remove("success", "error", "active");
    }
    if (btnText) btnText.textContent = "翻译中…";

    const progress = new Zotero.ProgressWindow({ closeOnClick: true });
    progress.changeHeadline("沉浸式双语翻译");
    const skipNotice = skippedReferencesCount > 0 ? ` (已智能跳过 ${skippedReferencesCount} 条参考文献)` : "";
    const progressItem = new progress.ItemProgress(
      "chrome://readingbilingual/content/icons/icon.svg",
      `正在翻译正文 (${paragraphsToTranslate.length} 段待翻, ${cachedCount} 段来自缓存)${skipNotice}...`
    );
    progress.show();

    let completedCount = cachedCount;
    const newlyTranslatedMap = {};
    const batchSize = 5; // 5 paragraphs per API call

    try {
      for (let i = 0; i < paragraphsToTranslate.length; i += batchSize) {
        const batch = paragraphsToTranslate.slice(i, i + batchSize);

        const placeholders = batch.map((p) => {
          const pLabel = provider === "gemini" ? "Gemini" : provider;
          const origText = p.innerText.trim();
          const card = this.createCardElement(reader, doc, origText, `正在调用 ${pLabel} 翻译…`, true);
          insertCard(p, card);
          return { element: p, card: card, text: origText };
        });

        try {
          const texts = placeholders.map((item) => item.text);
          let results;
          if (provider === "gemini") {
            results = await this.callGeminiBatch(texts, apiKey, model);
          } else {
            results = await this.callOpenAIBatch(texts, apiKey, model, baseUrl);
          }

          results.forEach((res, idx) => {
            if (placeholders[idx]) {
              const rawResult = res || "[译文解析空，请重试]";
              const textResult = this.cleanTypography(rawResult);
              const card = placeholders[idx].card;
              card.classList.remove("translating");
              const contentEl = card.querySelector(".zrb-card-content");
              if (contentEl) contentEl.textContent = textResult;
              else card.textContent = textResult;
              this.attachCardActionHandlers(card, reader, doc, placeholders[idx].text);
              newlyTranslatedMap[placeholders[idx].text] = textResult;
              completedCount++;
            }
          });
        } catch (err) {
          placeholders.forEach((item) => {
            const card = item.card;
            card.classList.remove("translating");
            card.style.borderLeftColor = "#ef4444";
            const contentEl = card.querySelector(".zrb-card-content");
            const errMsg = `[翻译失败: ${err.message}]`;
            if (contentEl) contentEl.textContent = errMsg;
            else card.textContent = errMsg;
            this.attachCardActionHandlers(card, reader, doc, item.text);
          });
        }

        const totalAll = paragraphs.length;
        const pct = Math.round((completedCount / totalAll) * 100);
        progressItem.setProgress(pct);
        progressItem.setText(`已完成 ${completedCount} / ${totalAll} 个段落 (${pct}%)`);
        if (btnText) btnText.textContent = `翻译中 ${pct}%`;

        // Pacing delay between batches
        if (i + batchSize < paragraphsToTranslate.length) {
          await new Promise((r) => setTimeout(r, 600));
        }
      }

      // Persist newly translated paragraphs to PDF folder cache!
      if (Object.keys(newlyTranslatedMap).length > 0) {
        // The cache file was already deleted at the start of a forced
        // re-translation, so never overwrite here: doing so discarded the
        // TOC / roadmap / table entries written earlier in this same run.
        await this.saveCache(reader, newlyTranslatedMap, false);
      }

      const refSummary = skippedReferencesCount > 0 ? `，已自动排除 ${skippedReferencesCount} 条参考文献` : "";
      const finishMsg = forceReTranslate
        ? `重新翻译完成！已按最新 Prompt 刷新全部 ${completedCount} 个段落${refSummary} (本地缓存已更新)`
        : `完成！已成功注入 ${completedCount} 个段落双语对照${refSummary} (已缓存至PDF目录)`;
      progressItem.setText(finishMsg);
      progressItem.setProgress(100);
      progress.startCloseTimer(3500);

      if (btn) {
        btn.classList.remove("translating", "error");
        btn.classList.add("success", "active");
      }
      if (btnText) btnText.textContent = "隐藏译文";

      setTimeout(() => {
        if (btn) btn.classList.remove("success");
      }, 3000);
    } catch (globalErr) {
      progressItem.setText(`翻译中断: ${globalErr.message}`);
      progress.startCloseTimer(4000);
      if (btn) {
        btn.classList.remove("translating", "success", "active");
        btn.classList.add("error");
      }
      if (btnText) btnText.textContent = "翻译异常";
    }
  },

  parseBatchedTranslations(rawText, count) {
    const results = new Array(count).fill("");
    for (let i = 0; i < count; i++) {
      const idx = i + 1;
      const regex = new RegExp(`(?:【P${idx}】|\\[P${idx}\\]|P${idx}[:：])\\s*([\\s\\S]*?)(?=(?:【P\\d+】|\\[P\\d+\\]|P\\d+[:：]|$))`, "i");
      const m = rawText.match(regex);
      if (m && m[1]) {
        results[i] = m[1].trim();
      }
    }
    const hasEmpty = results.some((r) => !r);
    if (hasEmpty) {
      const cleanLines = rawText
        .split(/\n{2,}/)
        .map((s) => s.replace(/^(?:【P\d+】|\[P\d+\]|P\d+[:：])\s*/, "").trim())
        .filter(Boolean);
      for (let i = 0; i < count; i++) {
        if (!results[i] && cleanLines[i]) {
          results[i] = cleanLines[i];
        }
      }
    }
    return results;
  },

  async callGeminiBatch(paragraphsText, apiKey, model) {
    if (!(apiKey || "").trim()) throw new Error("请先配置 API Key");
    let targetModel = model || "gemini-flash-latest";

    let prompt = this.getCustomPrompt().trim() + "\n\n";

    paragraphsText.forEach((text, i) => {
      prompt += `【P${i + 1}】\n${text}\n\n`;
    });

    const modelsToTry = [targetModel, "gemini-flash-latest", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"];
    const queue = [...new Set(modelsToTry)];

    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      for (let m of queue) {
        try {
          const bodyObj = {
            contents: [{ parts: [{ text: prompt }] }],
          };
          if (m.includes("3.7")) {
            bodyObj.generationConfig = {
              thinkingConfig: { thinkingBudget: 0 },
            };
          }

          const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
          const resp = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bodyObj),
          });

          if (resp.ok) {
            const data = await resp.json();
            const parts = data.candidates?.[0]?.content?.parts || [];
            const textPart = parts.find((p) => p.text) || parts[0];
            if (textPart && textPart.text) {
              return this.parseBatchedTranslations(textPart.text, paragraphsText.length);
            }
          } else {
            let errMsg = `HTTP ${resp.status}`;
            try {
              const errData = await resp.json();
              if (errData.error?.message) {
                errMsg += `: ${errData.error.message}`;
              }
            } catch (e) {}
            lastError = new Error(errMsg);
            continue;
          }
        } catch (err) {
          lastError = err;
        }
      }

      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 2500));
      }
    }

    throw lastError || new Error("翻译请求失败");
  },

  async callOpenAIBatch(paragraphsText, apiKey, model, baseUrl) {
    let targetModel = model || "deepseek-chat";
    const key = (apiKey || "").trim();
    if (!key) throw new Error("请先配置 API Key");

    let effectiveUrl = (baseUrl || this.getBaseUrl() || "").trim();
    if (!effectiveUrl) {
      const provider = this.getProvider();
      const defaultUrls = {
        deepseek: "https://api.deepseek.com/v1",
        siliconflow: "https://api.siliconflow.cn/v1",
        openrouter: "https://openrouter.ai/api/v1",
        moonshot: "https://api.moonshot.cn/v1",
        qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        openai: "https://api.openai.com/v1"
      };
      effectiveUrl = defaultUrls[provider] || "https://api.deepseek.com/v1";
    }

    const endpoint = `${effectiveUrl.replace(/\/+$/, "")}/chat/completions`;
    const userPrompt = paragraphsText.map((t, i) => `【P${i + 1}】\n${t}`).join("\n\n");

    const bodyObj = {
      model: targetModel,
      messages: [
        { role: "system", content: this.getCustomPrompt().trim() },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.3
    };

    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${key}`
          },
          body: JSON.stringify(bodyObj)
        });

        if (resp.ok) {
          const data = await resp.json();
          const content = data.choices?.[0]?.message?.content || "";
          if (content) {
            return this.parseBatchedTranslations(content, paragraphsText.length);
          }
        } else {
          let errMsg = `HTTP ${resp.status}`;
          try {
            const errData = await resp.json();
            if (errData.error?.message) {
              errMsg += `: ${errData.error.message}`;
            }
          } catch (e) {}
          lastError = new Error(errMsg);
        }
      } catch (err) {
        lastError = err;
      }

      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    throw lastError || new Error("API 请求失败");
  },

  async callModelText(prompt, systemPrompt = "") {
    const provider = this.getProvider();
    const apiKey = this.getApiKey();
    const model = this.getModel();
    const baseUrl = this.getBaseUrl();

    if (!apiKey) {
      throw new Error("请先配置 API Key");
    }

    if (provider === "gemini") {
      let targetModel = model || "gemini-flash-latest";
      const modelsToTry = [targetModel, "gemini-flash-latest", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"];
      const queue = [...new Set(modelsToTry)];

      let lastError = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        for (let m of queue) {
          try {
            const bodyObj = {
              contents: [{ parts: [{ text: (systemPrompt ? systemPrompt + "\n\n" : "") + prompt }] }],
            };
            if (m.includes("3.7")) {
              bodyObj.generationConfig = { thinkingBudget: 0 };
            }

            const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
            const resp = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(bodyObj),
            });

            if (resp.ok) {
              const data = await resp.json();
              const parts = data.candidates?.[0]?.content?.parts || [];
              const textPart = parts.find((p) => p.text) || parts[0];
              if (textPart && textPart.text) {
                return textPart.text.trim();
              }
            } else {
              let errMsg = `HTTP ${resp.status}`;
              try {
                const errData = await resp.json();
                if (errData.error?.message) errMsg += `: ${errData.error.message}`;
              } catch (e) {}
              lastError = new Error(errMsg);
            }
          } catch (err) {
            lastError = err;
          }
        }
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      throw lastError || new Error("Gemini 请求失败");
    } else {
      let effectiveUrl = (baseUrl || this.getBaseUrl() || "").trim();
      if (!effectiveUrl) {
        const defaultUrls = {
          deepseek: "https://api.deepseek.com/v1",
          siliconflow: "https://api.siliconflow.cn/v1",
          openrouter: "https://openrouter.ai/api/v1",
          moonshot: "https://api.moonshot.cn/v1",
          qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          openai: "https://api.openai.com/v1"
        };
        effectiveUrl = defaultUrls[provider] || "https://api.deepseek.com/v1";
      }
      const endpoint = `${effectiveUrl.replace(/\/+$/, "")}/chat/completions`;
      const messages = [];
      if (systemPrompt) {
        messages.push({ role: "system", content: systemPrompt });
      }
      messages.push({ role: "user", content: prompt });

      let lastError = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const resp = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: model || "deepseek-chat",
              messages: messages,
              temperature: 0.3
            })
          });
          if (resp.ok) {
            const data = await resp.json();
            const content = data.choices?.[0]?.message?.content || "";
            if (content) return content.trim();
          } else {
            let errMsg = `HTTP ${resp.status}`;
            try {
              const errData = await resp.json();
              if (errData.error?.message) errMsg += `: ${errData.error.message}`;
            } catch (e) {}
            lastError = new Error(errMsg);
          }
        } catch (e) {
          lastError = e;
        }
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      throw lastError || new Error("API 请求失败");
    }
  },

  async translateTableBlock(block, reader, doc, forceReTranslate = false) {
    if (!block || !block.element || !block.text) return;
    const el = block.element;
    const text = block.text;

    if (!forceReTranslate && el.nextElementSibling?.classList?.contains("zotero-bilingual-card")) {
      return;
    }
    while (el.nextElementSibling?.classList?.contains("zotero-bilingual-card")) {
      el.nextElementSibling.remove();
    }

    const cache = await this.loadCache(reader);
    let zh = (!forceReTranslate && cache[text]) ? this.cleanTypography(cache[text]) : null;

    const card = this.createCardElement(reader, doc, text, zh || "正在整体翻译表格…", !zh);
    card.classList.add("zotero-bilingual-table-card");
    const titleRow = doc.createElement("div");
    titleRow.className = "zotero-bilingual-toc-title";
    const badge = doc.createElement("span");
    badge.className = "zotero-bilingual-toc-badge";
    badge.textContent = "📊 表格整体译文 / Table";
    titleRow.appendChild(badge);
    card.insertBefore(titleRow, card.firstChild);
    el.insertAdjacentElement("afterend", card);

    if (zh) return;

    const prompt = `你是一名顶尖学术学者兼专业科技翻译。
以下是一篇学术文献中一张表格的全部文字内容，由于原文是版面排版，文字已被拉平为一行，列与列之间只以空格分隔。

【翻译要求】：
1. 先按语义还原表格结构：识别表头与各行，按“表头行 / 每行一行”的形式逐行输出。
2. 每一行内，各单元格之间用竖线符号（|）分隔，保持原有的列顺序。
3. 数字、符号（✓、✗、—、%、±）、公式、变量名、引用编号一律原样保留。
4. 术语专业地道；严禁在中文后用括号附带英文原文。
5. 只输出还原后的中文表格文本，不要输出任何前言、说明或 Markdown 代码块标记。

【表格原文】：
${text}
`;

    try {
      const raw = await this.callModelText(prompt);
      zh = this.cleanTypography((raw || "").trim());
      if (!zh) throw new Error("译文为空");
      card.classList.remove("translating");
      const contentEl = card.querySelector(".zrb-card-content");
      if (contentEl) contentEl.textContent = zh;
      this.attachCardActionHandlers(card, reader, doc, text);
      await this.saveCache(reader, { [text]: zh });
    } catch (err) {
      Zotero.debug("[ReadingBilingual] Table block translation error: " + err.message);
      card.classList.remove("translating");
      card.style.borderLeftColor = "#ef4444";
      const contentEl = card.querySelector(".zrb-card-content");
      if (contentEl) contentEl.textContent = `[表格翻译失败: ${err.message}]`;
      this.attachCardActionHandlers(card, reader, doc, text);
    }
  },

  async translateTocBlock(block, reader, doc, isAuto = false, forceReTranslate = false) {
    if (!block || !block.items || block.items.length === 0) return;

    const hashKey = this.hashText("toc::" + block.items.map((it) => it.text).join("::"));
    const existingCard = doc.querySelector(`[data-toc-id="${hashKey}"]`);

    if (forceReTranslate) {
      if (existingCard) existingCard.remove();
      while (block.lastElement.nextElementSibling?.classList?.contains("zotero-bilingual-card")) {
        block.lastElement.nextElementSibling.remove();
      }
    } else {
      if (existingCard || block.lastElement.nextElementSibling?.classList?.contains("zotero-bilingual-toc-card")) {
        return;
      }
    }

    // Clean any stray individual cards between first and last element
    let cleanNode = block.headingElement || block.items[0].element;
    while (cleanNode) {
      if (cleanNode.nextElementSibling?.classList?.contains("zotero-bilingual-card")) {
        cleanNode.nextElementSibling.remove();
      }
      cleanNode.querySelectorAll?.(".zotero-bilingual-card")?.forEach((c) => c.remove());
      if (cleanNode === block.lastElement) break;
      cleanNode = cleanNode.nextElementSibling;
    }

    // Check cache
    const cache = await this.loadCache(reader);
    const tocCacheKey = "toc_block_" + hashKey;
    let data = (!forceReTranslate && cache[tocCacheKey]) ? cache[tocCacheKey] : null;

    if (!data) {
      // Show temporary translating placeholder card
      const tempCard = doc.createElement("div");
      tempCard.className = "zotero-bilingual-card zotero-bilingual-toc-card translating";
      tempCard.setAttribute("data-toc-id", hashKey);
      tempCard.innerHTML = `
        <div class="zotero-bilingual-toc-title">
          <span class="zotero-bilingual-toc-badge">📑 正在整体解析并翻译学术目录…</span>
        </div>
      `;
      while (block.lastElement.nextElementSibling && block.lastElement.nextElementSibling.classList.contains("zotero-bilingual-card")) {
        block.lastElement.nextElementSibling.remove();
      }
      block.lastElement.insertAdjacentElement("afterend", tempCard);

      const prompt = `你是一名顶尖学术学者兼专业科技翻译。
以下是一篇学术文献/技术报告的完整目录（Table of Contents）。包含各个章节条目（带章节编号、章节标题、引导虚线或页码）。
请将其作为一个完整的目录逻辑体系，将每一行条目准确、精炼、专业地翻译为规范学术中文。

【核心翻译规范】：
1. 完整翻译每一条目录项，严禁遗漏任何一行。
2. 保持原条目的章节标号（例如 1、2.1、IV、A 等）与末尾页码（若有）。
3. 术语专业地道，严禁在中文后加英文反括（例如不要输出“智能体技能 (Agent Skill)”，直接输出“智能体技能”）。
4. 严格按照 【T1】、【T2】... 格式对应输出每一行的纯中文翻译。严禁输出前言或额外解释。

【目录原文】：
${block.items.map((it, idx) => `【T${idx + 1}】${it.text}`).join("\n")}
`;

      try {
        const rawOutput = await this.callModelText(prompt);
        const results = this.parseIndexedTranslations(rawOutput, block.items.length, "T");
        data = {
          itemsZh: results.map((zh, idx) => zh || block.items[idx].text)
        };
        await this.saveCache(reader, { [tocCacheKey]: data });
      } catch (err) {
        Zotero.debug("[ReadingBilingual] TOC block translation error: " + err.message);
        if (tempCard && tempCard.parentNode) {
          tempCard.classList.remove("translating");
          tempCard.style.borderLeftColor = "#ef4444";
          tempCard.textContent = `[学术目录整体翻译失败: ${err.message}]`;
        }
        return;
      }
    }

    // Render the final unified bilingual TOC card
    const existing = doc.querySelector(`[data-toc-id="${hashKey}"]`);
    if (existing) existing.remove();
    while (block.lastElement.nextElementSibling && block.lastElement.nextElementSibling.classList.contains("zotero-bilingual-card")) {
      block.lastElement.nextElementSibling.remove();
    }

    const card = doc.createElement("div");
    card.className = "zotero-bilingual-card zotero-bilingual-toc-card";
    card.setAttribute("data-toc-id", hashKey);

    let rowsHtml = "";
    block.items.forEach((it, idx) => {
      const zh = (data.itemsZh && data.itemsZh[idx]) ? data.itemsZh[idx] : it.text;
      const row = this.parseTocRow(it.text, zh);
      const subClass = row.isSub ? "zrb-toc-sub" : "";
      rowsHtml += `
        <div class="zrb-toc-row ${subClass}">
          <div class="zrb-toc-title">
            ${row.secNum ? `<span class="zrb-toc-sec">${this.escapeHTML(row.secNum)}</span>` : ""}
            <span class="zrb-toc-zh">${this.escapeHTML(row.zhTitle)}</span>
            <span class="zrb-toc-orig">(${this.escapeHTML(row.rawTitle)})</span>
          </div>
          <span class="zrb-toc-dots"></span>
          <span class="zrb-toc-page">${this.escapeHTML(row.page)}</span>
        </div>
      `;
    });

    card.innerHTML = `
      <div class="zotero-bilingual-toc-title">
        <span class="zotero-bilingual-toc-badge">📑 目录双语速览 / Table of Contents</span>
      </div>
      <div class="zrb-toc-container">
        ${rowsHtml}
      </div>
    `;

    // Add action buttons (Copy & Delete)
    const actions = doc.createElement("div");
    actions.className = "zrb-card-actions";

    const copyBtn = doc.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "zrb-card-action-btn zrb-btn-copy";
    copyBtn.title = "复制目录译文";
    copyBtn.textContent = "📋 复制";
    copyBtn.onclick = (e) => {
      e.stopPropagation();
      const lines = block.items.map((it, idx) => {
        const zh = (data.itemsZh && data.itemsZh[idx]) ? data.itemsZh[idx] : it.text;
        const row = this.parseTocRow(it.text, zh);
        const pageStr = row.page ? ` (P. ${row.page})` : "";
        return `${row.secNum ? row.secNum + ' ' : ''}${row.zhTitle} [${row.rawTitle}]${pageStr}`;
      });
      const textToCopy = lines.join("\n");
      try {
        if (doc.defaultView?.navigator?.clipboard?.writeText) {
          doc.defaultView.navigator.clipboard.writeText(textToCopy);
        } else {
          const ta = doc.createElement("textarea");
          ta.value = textToCopy;
          doc.body.appendChild(ta);
          ta.select();
          doc.execCommand("copy");
          ta.remove();
        }
        copyBtn.textContent = "✓ 已复制";
        setTimeout(() => { copyBtn.textContent = "📋 复制"; }, 1500);
      } catch (err) {
        Zotero.debug("[ReadingBilingual] Copy TOC error: " + err);
      }
    };

    const delBtn = doc.createElement("button");
    delBtn.type = "button";
    delBtn.className = "zrb-card-action-btn zrb-btn-delete";
    delBtn.title = "删除此目录翻译卡片";
    delBtn.textContent = "🗑️ 删除";
    delBtn.onclick = async (e) => {
      e.stopPropagation();
      card.remove();
      try {
        await this.deleteCacheEntry(reader, tocCacheKey);
      } catch (err) {
        Zotero.debug("[ReadingBilingual] Delete TOC cache error: " + err);
      }
    };

    actions.appendChild(copyBtn);
    actions.appendChild(delBtn);
    card.appendChild(actions);

    block.lastElement.insertAdjacentElement("afterend", card);
  },

  async translateTocTogether(tocHeadingEl, tocItems, reader, doc, isAuto = false, forceReTranslate = false) {
    if (!tocItems || tocItems.length === 0) return;
    const block = {
      headingElement: tocHeadingEl,
      headingText: (tocHeadingEl?.innerText || "Table of Contents").trim(),
      items: tocItems,
      lastElement: tocItems[tocItems.length - 1]?.element || tocHeadingEl
    };
    return this.translateTocBlock(block, reader, doc, isAuto, forceReTranslate);
  },

  async translateRoadmapTogether(block, reader, doc, isAuto = false, forceReTranslate = false) {
    if (!block || !block.leadElement || !block.items || block.items.length === 0) return;

    const hashKey = this.hashText(block.leadText + "::" + block.items.map((it) => it.text).join("::"));
    const existingCard = doc.querySelector(`[data-roadmap-id="${hashKey}"]`);

    if (forceReTranslate) {
      if (existingCard) existingCard.remove();
      while (block.lastElement.nextElementSibling?.classList?.contains("zotero-bilingual-card")) {
        block.lastElement.nextElementSibling.remove();
      }
    } else {
      if (existingCard || block.lastElement.nextElementSibling?.classList?.contains("zotero-bilingual-roadmap-card")) {
        return;
      }
    }

    // Clean any accidental leftover fragmented cards between lead and last element
    let cleanNode = block.leadElement;
    while (cleanNode) {
      if (cleanNode.nextElementSibling?.classList?.contains("zotero-bilingual-card")) {
        cleanNode.nextElementSibling.remove();
      }
      cleanNode.querySelectorAll?.(".zotero-bilingual-card")?.forEach((c) => c.remove());
      if (cleanNode === block.lastElement) break;
      cleanNode = cleanNode.nextElementSibling;
    }

    // Check cache
    const cache = await this.loadCache(reader);
    const roadmapCacheKey = "roadmap_" + hashKey;
    let data = (!forceReTranslate && cache[roadmapCacheKey]) ? cache[roadmapCacheKey] : null;

    if (!data) {
      // Show temporary translating placeholder card
      const tempCard = doc.createElement("div");
      tempCard.className = "zotero-bilingual-card zotero-bilingual-roadmap-card translating";
      tempCard.setAttribute("data-roadmap-id", hashKey);
      tempCard.innerHTML = `
        <div class="zotero-bilingual-roadmap-header">
          <span class="zotero-bilingual-roadmap-badge">正在整体解析论文目录与篇章架构…</span>
        </div>
      `;
      while (block.lastElement.nextElementSibling && block.lastElement.nextElementSibling.classList.contains("zotero-bilingual-card")) {
        block.lastElement.nextElementSibling.remove();
      }
      block.lastElement.insertAdjacentElement("afterend", tempCard);

      const prompt = `你是一名顶尖的计算机科学与人工智能领域资深学者兼专业学术译者。
以下是一篇学术论文的篇章结构/目录导引（Paper Organization / 目录架构），包含引导句以及各个章节分项。
请将其作为一个完整的逻辑整体，连贯、严谨、地道地翻译为高质量学术中文。

【核心翻译规范】：
1. 完整翻译引导句和每一个分项，严禁遗漏任何一项。
2. 保持各分项对应的章节标号（如 §2、第 2 节、第 3-4 节等）。
3. 行文严谨流畅，术语准确，杜绝死板机翻。严禁在中文后带英文括号（例如不要输出“智能体技能 (agent skill)”，直接输出“智能体技能”）。

【原文内容】：
【引导】${block.leadText}
${block.items.map((it, idx) => `【分项${idx + 1}】${it.text}`).join("\n")}

【输出格式要求】：
请严格按如下格式对应输出每一行的中文翻译：
【引导】引导句中文译文
【分项1】分项1的中文译文
【分项2】分项2的中文译文
...
不要输出任何前言、开场白或额外解释。`;

      try {
        const rawOutput = await this.callModelText(prompt);
        data = this.parseRoadmapResponse(rawOutput, block.items.length);
        if (data.leadZh || data.itemsZh.some(Boolean)) {
          await this.saveCache(reader, { [roadmapCacheKey]: data });
        }
      } catch (err) {
        Zotero.debug("[ReadingBilingual] Roadmap translation error: " + err.message);
        if (tempCard && tempCard.parentNode) {
          tempCard.classList.remove("translating");
          tempCard.style.borderLeftColor = "#ef4444";
          tempCard.textContent = `[篇章架构整体翻译失败: ${err.message}]`;
        }
        return;
      }
    }

    // Render the final unified bilingual roadmap card
    const existing = doc.querySelector(`[data-roadmap-id="${hashKey}"]`);
    if (existing) existing.remove();

    while (block.lastElement.nextElementSibling && block.lastElement.nextElementSibling.classList.contains("zotero-bilingual-card")) {
      block.lastElement.nextElementSibling.remove();
    }

    const card = doc.createElement("div");
    card.className = "zotero-bilingual-card zotero-bilingual-roadmap-card";
    card.setAttribute("data-roadmap-id", hashKey);

    const leadZh = this.cleanTypography(data.leadZh || block.leadText);
    let itemsHtml = "";
    block.items.forEach((it, idx) => {
      let zh = data.itemsZh?.[idx] || "";
      if (!zh) zh = it.text;
      zh = this.cleanTypography(zh);
      if (!zh.startsWith("•") && !zh.startsWith("·") && !/^\d+\./.test(zh)) {
        zh = "• " + zh;
      }
      itemsHtml += `<div class="zotero-bilingual-roadmap-item">${this.escapeHTML(zh)}</div>`;
    });

    card.innerHTML = `
      <div class="zotero-bilingual-roadmap-header">
        <span class="zotero-bilingual-roadmap-badge">论文目录与篇章架构</span>
      </div>
      <div class="zotero-bilingual-roadmap-lead">${this.escapeHTML(leadZh)}</div>
      <div class="zotero-bilingual-roadmap-list">
        ${itemsHtml}
      </div>
    `;

    const actions = doc.createElement("div");
    actions.className = "zrb-card-actions";
    
    const copyBtn = doc.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "zrb-card-action-btn zrb-btn-copy";
    copyBtn.title = "复制架构译文";
    copyBtn.textContent = "📋 复制";
    copyBtn.onclick = (e) => {
      e.stopPropagation();
      const textToCopy = [leadZh, ...block.items.map((it, idx) => data.itemsZh?.[idx] || it.text)].join("\n");
      try {
        if (doc.defaultView?.navigator?.clipboard?.writeText) {
          doc.defaultView.navigator.clipboard.writeText(textToCopy);
        } else {
          const ta = doc.createElement("textarea");
          ta.value = textToCopy;
          doc.body.appendChild(ta);
          ta.select();
          doc.execCommand("copy");
          ta.remove();
        }
      } catch (err) {}
      copyBtn.textContent = "✓ 已复制";
      setTimeout(() => { copyBtn.textContent = "📋 复制"; }, 1500);
    };
    actions.appendChild(copyBtn);

    const delBtn = doc.createElement("button");
    delBtn.type = "button";
    delBtn.className = "zrb-card-action-btn zrb-btn-delete";
    delBtn.title = "删除架构卡片并从缓存移除";
    delBtn.textContent = "🗑 删除";
    delBtn.onclick = async (e) => {
      e.stopPropagation();
      card.style.transition = "opacity 0.2s, transform 0.2s";
      card.style.opacity = "0";
      card.style.transform = "translateY(-4px)";
      setTimeout(() => card.remove(), 200);
      await this.deleteCacheEntry(reader, roadmapCacheKey);
    };
    actions.appendChild(delBtn);
    card.appendChild(actions);

    block.lastElement.insertAdjacentElement("afterend", card);
  },

  async translateSidebarOutline(reader, doc) {
    if (!doc) return;
    const outlineView = doc.getElementById("outlineView");
    if (!outlineView) return;

    const titleNodes = Array.from(outlineView.querySelectorAll(".title"));
    if (titleNodes.length === 0) return;

    const itemsToTranslate = [];
    titleNodes.forEach((node, idx) => {
      if (node.querySelector(".zrb-outline-zh")) return;
      const raw = (node.textContent || "").replace(/\[URL\]/g, "").trim();
      if (raw.length >= 2) {
        itemsToTranslate.push({ node, text: raw, index: idx });
      }
    });

    if (itemsToTranslate.length === 0) return;

    const cache = await this.loadCache(reader);
    const outlineCache = cache.__outline__ || {};
    const unCached = itemsToTranslate.filter((item) => !outlineCache[item.text]);

    if (unCached.length > 0) {
      const promptLines = unCached.map((item, i) => `[O${i + 1}] ${item.text}`);
      const prompt = `你是一名学术译者。请将以下论文侧边栏大纲标题翻译为精炼准确的中文（例如 "1. Introduction" 翻译为 "1. 引言"）。
严格按照 [O1]、[O2]... 编号输出每一行的纯中文翻译，保留数字编号。不要输出任何多余解释。

【大纲标题】：
${promptLines.join("\n")}`;

      try {
        const rawOutput = await this.callModelText(prompt);
        const results = this.parseIndexedTranslations(rawOutput, unCached.length, "O");

        results.forEach((zh, i) => {
          if (zh && unCached[i]) {
            outlineCache[unCached[i].text] = this.cleanTypography(zh);
          }
        });

        await this.saveCache(reader, { __outline__: outlineCache });
      } catch (e) {
        Zotero.debug("[ReadingBilingual] Outline translation note: " + e.message);
      }
    }

    // Apply translations to DOM
    itemsToTranslate.forEach((item) => {
      const zh = outlineCache[item.text];
      if (zh && !item.node.querySelector(".zrb-outline-zh")) {
        const span = doc.createElement("span");
        span.className = "zrb-outline-zh";
        const cleanZh = zh.replace(/^[0-9IVXLCDM\.\s]+/, "").trim();
        span.textContent = ` (${cleanZh || zh})`;
        item.node.appendChild(span);
      }
    });
  },

  openSettings(win) {
    try {
      if (Zotero.Utilities?.Internal?.openPreferences) {
        Zotero.Utilities.Internal.openPreferences("reading-bilingual-preferences");
        return;
      }
    } catch (e) {
      Zotero.logError(e);
    }

    try {
      const targetWin = win || Zotero.getMainWindow();
      if (targetWin?.openPreferences) {
        targetWin.openPreferences("reading-bilingual-preferences");
        return;
      }
    } catch (e) {
      Zotero.logError(e);
    }

    try {
      const targetWin = win || Zotero.getMainWindow();
      if (targetWin?.openDialog) {
        targetWin.openDialog(
          "chrome://zotero/content/preferences/preferences.xhtml",
          "preferences",
          "chrome,titlebar,toolbar,centerscreen,dialog=yes",
          { pane: "reading-bilingual-preferences" }
        );
      }
    } catch (e) {
      Zotero.logError(e);
    }
  },
};
