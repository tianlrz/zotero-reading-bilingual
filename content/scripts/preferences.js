/* eslint-disable no-undef */
(() => {
  const PRESETS = {
    gemini: {
      baseUrl: "https://generativelanguage.googleapis.com",
      models: [
        { id: "gemini-flash-latest", displayName: "gemini-flash-latest (自动最新 Flash - 推荐)" },
        { id: "gemini-3.8-flash", displayName: "Gemini 3.8 Flash" },
        { id: "gemini-3.7-flash", displayName: "Gemini 3.7 Flash" },
        { id: "gemini-3.6-flash", displayName: "Gemini 3.6 Flash" },
        { id: "gemini-3.5-flash", displayName: "Gemini 3.5 Flash" },
        { id: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash" },
        { id: "gemini-pro-latest", displayName: "gemini-pro-latest" }
      ],
      defaultModel: "gemini-flash-latest",
      placeholder: "输入 Google AI Studio API Key (以 AIzaSy 开头)"
    },
    deepseek: {
      baseUrl: "https://api.deepseek.com/v1",
      models: [
        { id: "deepseek-chat", displayName: "deepseek-chat (DeepSeek-V3 推荐)" },
        { id: "deepseek-reasoner", displayName: "deepseek-reasoner (DeepSeek-R1 推理)" }
      ],
      defaultModel: "deepseek-chat",
      placeholder: "输入 DeepSeek API Key (以 sk- 开头)"
    },
    siliconflow: {
      baseUrl: "https://api.siliconflow.cn/v1",
      models: [
        { id: "deepseek-ai/DeepSeek-V3", displayName: "deepseek-ai/DeepSeek-V3 (推荐 / 送2000万Token)" },
        { id: "deepseek-ai/DeepSeek-R1", displayName: "deepseek-ai/DeepSeek-R1" },
        { id: "Qwen/Qwen2.5-72B-Instruct", displayName: "Qwen/Qwen2.5-72B-Instruct" }
      ],
      defaultModel: "deepseek-ai/DeepSeek-V3",
      placeholder: "输入硅基流动 API Key (以 sk- 开头)"
    },
    openrouter: {
      baseUrl: "https://openrouter.ai/api/v1",
      models: [
        { id: "deepseek/deepseek-chat", displayName: "deepseek/deepseek-chat" },
        { id: "google/gemini-2.5-flash", displayName: "google/gemini-2.5-flash" },
        { id: "openai/gpt-4o-mini", displayName: "openai/gpt-4o-mini" }
      ],
      defaultModel: "deepseek/deepseek-chat",
      placeholder: "输入 OpenRouter API Key (以 sk-or- 开头)"
    },
    moonshot: {
      baseUrl: "https://api.moonshot.cn/v1",
      models: [
        { id: "moonshot-v1-8k", displayName: "moonshot-v1-8k" },
        { id: "moonshot-v1-32k", displayName: "moonshot-v1-32k" }
      ],
      defaultModel: "moonshot-v1-8k",
      placeholder: "输入 Kimi / Moonshot API Key (以 sk- 开头)"
    },
    qwen: {
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      models: [
        { id: "qwen-plus", displayName: "qwen-plus (通义千问增强版)" },
        { id: "qwen-turbo", displayName: "qwen-turbo (极速版)" },
        { id: "qwen-max", displayName: "qwen-max (旗舰版)" }
      ],
      defaultModel: "qwen-plus",
      placeholder: "输入阿里云百炼 API Key (以 sk- 开头)"
    },
    openai: {
      baseUrl: "https://api.openai.com/v1",
      models: [
        { id: "gpt-4o-mini", displayName: "gpt-4o-mini (推荐)" },
        { id: "gpt-4o", displayName: "gpt-4o" }
      ],
      defaultModel: "gpt-4o-mini",
      placeholder: "输入 OpenAI API Key (以 sk- 开头)"
    },
    custom: {
      baseUrl: "https://",
      models: [
        { id: "default", displayName: "默认模型" }
      ],
      defaultModel: "default",
      placeholder: "输入自定义服务商 API Key"
    }
  };

  function initPrefs() {
    const providerSelect = document.getElementById("reading-bilingual-pref-provider");
    const baseUrlRow = document.getElementById("reading-bilingual-baseurl-row");
    const baseUrlInput = document.getElementById("reading-bilingual-pref-baseurl");
    const apikeyInput = document.getElementById("reading-bilingual-pref-apikey");
    const testBtn = document.getElementById("reading-bilingual-pref-test-key");
    const modelSelect = document.getElementById("reading-bilingual-pref-model");
    const customModelBox = document.getElementById("reading-bilingual-custom-model-box");
    const customModelInput = document.getElementById("reading-bilingual-pref-custom-model");
    const autoTransCheck = document.getElementById("reading-bilingual-pref-autotrans");
    const tablesCheck = document.getElementById("reading-bilingual-pref-tables");
    const concurrencySelect = document.getElementById("reading-bilingual-pref-concurrency");
    const promptArea = document.getElementById("reading-bilingual-pref-prompt");
    const resetBtn = document.getElementById("reading-bilingual-pref-reset-prompt");
    const saveBtn = document.getElementById("reading-bilingual-pref-save");
    const saveMsg = document.getElementById("reading-bilingual-save-msg");
    const keyStatus = document.getElementById("reading-bilingual-key-status");

    // Appearance elements
    const fontSelect = document.getElementById("reading-bilingual-pref-font");
    const customFontRow = document.getElementById("reading-bilingual-custom-font-row");
    const customFontInput = document.getElementById("reading-bilingual-pref-custom-font");
    const frameSelect = document.getElementById("reading-bilingual-pref-frame");
    const customColorRow = document.getElementById("reading-bilingual-custom-color-row");
    const customColorInput = document.getElementById("reading-bilingual-pref-custom-color");
    const customColorText = document.getElementById("reading-bilingual-pref-custom-color-text");
    const borderStyleSelect = document.getElementById("reading-bilingual-pref-border-style");
    const cardbgSelect = document.getElementById("reading-bilingual-pref-cardbg");
    const previewCard = document.getElementById("reading-bilingual-preview-card");

    if (!providerSelect || !apikeyInput || !modelSelect || !Zotero.ReadingBilingual) {
      return;
    }

    if (providerSelect._initialized) {
      return;
    }
    providerSelect._initialized = true;

    const plugin = Zotero.ReadingBilingual;

    function populateModels(models, selectedId) {
      modelSelect.innerHTML = "";
      const current = selectedId || plugin.getModel();
      let found = false;

      for (const m of models) {
        const opt = document.createElementNS("http://www.w3.org/1999/xhtml", "option");
        opt.value = m.id;
        opt.textContent = m.displayName || m.id;
        if (m.id === current) {
          opt.selected = true;
          found = true;
        }
        modelSelect.appendChild(opt);
      }

      const customOpt = document.createElementNS("http://www.w3.org/1999/xhtml", "option");
      customOpt.value = "custom";
      customOpt.textContent = "手动输入自定义模型名称...";
      modelSelect.appendChild(customOpt);

      if (!found && current) {
        customOpt.selected = true;
        if (customModelBox && customModelInput) {
          customModelBox.style.display = "block";
          customModelInput.value = current;
        }
      } else {
        if (customModelBox) {
          customModelBox.style.display = "none";
        }
      }
    }

    function applyProvider(providerKey, switchPresetDefaults = false) {
      const preset = PRESETS[providerKey] || PRESETS.custom;
      if (baseUrlRow) {
        baseUrlRow.style.display = (providerKey === "gemini") ? "none" : "flex";
      }
      if (apikeyInput) {
        apikeyInput.placeholder = preset.placeholder;
      }
      if (switchPresetDefaults) {
        if (baseUrlInput) {
          baseUrlInput.value = preset.baseUrl;
        }
        populateModels(preset.models, preset.defaultModel);
        plugin.setModel(preset.defaultModel);
      }
    }

    function updateKeyStatus(customHtml) {
      if (!keyStatus) return;
      if (customHtml) {
        keyStatus.innerHTML = customHtml;
        return;
      }
      const currentKey = (apikeyInput.value || "").trim();
      const currentProvider = providerSelect.value;
      if (!currentKey) {
        if (currentProvider === "gemini") {
          keyStatus.innerHTML = `
            <div style="color: #b45309; background: rgba(245, 158, 11, 0.08); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(245, 158, 11, 0.25);">
              尚未配置 API Key，插件不自带任何 Key。提示：若使用 Google AI Studio，请在全新普通项目中创建免费 Key，并在上方粘贴。
            </div>
          `;
        } else {
          keyStatus.innerHTML = `
            <div style="color: #b45309; background: rgba(245, 158, 11, 0.08); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(245, 158, 11, 0.25);">
              请输入该服务商的 API Key 并点击右侧测试按钮。
            </div>
          `;
        }
      } else {
        keyStatus.innerHTML = `
          <div style="color: #15803d; background: rgba(34, 197, 94, 0.08); padding: 7px 12px; border-radius: 6px; border: 1px solid rgba(34, 197, 94, 0.25);">
            已配置 API Key，点击右侧按钮可测试连接与模型列表。
          </div>
        `;
      }
    }

    // Load saved preferences
    const savedProvider = plugin.getProvider ? plugin.getProvider() : "gemini";
    providerSelect.value = savedProvider;

    const savedBaseUrl = plugin.getBaseUrl ? plugin.getBaseUrl() : (PRESETS[savedProvider]?.baseUrl || "");
    if (baseUrlInput) {
      baseUrlInput.value = savedBaseUrl;
    }

    const existingKey = plugin.getUserApiKey
      ? plugin.getUserApiKey()
      : plugin.getApiKey();
    apikeyInput.value = existingKey;

    applyProvider(savedProvider, false);

    const cached = plugin.getCachedModels ? plugin.getCachedModels() : (PRESETS[savedProvider]?.models || []);
    populateModels(cached, plugin.getModel());

    autoTransCheck.checked = plugin.getAutoTranslate();
    if (tablesCheck) tablesCheck.checked = plugin.getTranslateTables ? plugin.getTranslateTables() : true;
    if (concurrencySelect && plugin.getConcurrency) concurrencySelect.value = String(plugin.getConcurrency());
    promptArea.value = plugin.getCustomPrompt();
    updateKeyStatus();

    const FONT_MAP = {
      songti: `"Songti SC", "Source Han Serif SC", "Noto Serif CJK SC", "STSong", "SimSun", "Songti TC", serif`,
      sans: `-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`,
      kaiti: `"Kaiti SC", "STKaiti", "KaiTi", "BiauKai", serif`,
      fangsong: `"STFangsong", "FangSong", serif`,
      wenkai: `"LXGW WenKai", "LXGW WenKai Screen", "Kaiti SC", sans-serif`,
      inherit: "inherit"
    };

    const FRAME_COLOR_MAP = {
      crimson: "#a8202b",
      indigo: "#6366f1",
      slate: "#334155",
      emerald: "#059669",
      amber: "#d97706",
      minimal: "#9ca3af"
    };

    function hexToRgba(hex, alpha) {
      if (!hex || !hex.startsWith("#")) return `rgba(168, 32, 43, ${alpha})`;
      let c = hex.slice(1);
      if (c.length === 3) c = c.split("").map((x) => x + x).join("");
      const num = parseInt(c, 16);
      if (isNaN(num)) return `rgba(168, 32, 43, ${alpha})`;
      return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
    }

    function updatePreview() {
      if (!previewCard) return;

      const fontVal = fontSelect ? fontSelect.value : "songti";
      if (customFontRow) {
        customFontRow.style.display = (fontVal === "custom") ? "flex" : "none";
      }
      let fontStack = FONT_MAP[fontVal] || FONT_MAP.songti;
      if (fontVal === "custom" && customFontInput && customFontInput.value.trim()) {
        fontStack = `"${customFontInput.value.trim()}", serif`;
      }
      previewCard.style.fontFamily = fontStack;

      const frameVal = frameSelect ? frameSelect.value : "crimson";
      if (customColorRow) {
        customColorRow.style.display = (frameVal === "custom") ? "flex" : "none";
      }
      let color = FRAME_COLOR_MAP[frameVal] || "#a8202b";
      if (frameVal === "custom") {
        color = (customColorInput?.value || customColorText?.value || "#a8202b").trim();
      }
      previewCard.style.borderLeftColor = color;
      const borderVal = borderStyleSelect ? borderStyleSelect.value : "straight";
      if (borderVal === "straight") {
        previewCard.style.borderLeftWidth = "3.5px";
        previewCard.style.borderLeftStyle = "solid";
        previewCard.style.borderRadius = "0";
      } else if (borderVal === "pill") {
        previewCard.style.borderLeftWidth = "4px";
        previewCard.style.borderLeftStyle = "solid";
        previewCard.style.borderRadius = "4px 6px 6px 4px";
      } else if (borderVal === "dashed") {
        previewCard.style.borderLeftWidth = "2.5px";
        previewCard.style.borderLeftStyle = "dashed";
        previewCard.style.borderRadius = "0 6px 6px 0";
      } else if (borderVal === "double") {
        previewCard.style.borderLeftWidth = "4.5px";
        previewCard.style.borderLeftStyle = "double";
        previewCard.style.borderRadius = "0 6px 6px 0";
      } else if (borderVal === "thick") {
        previewCard.style.borderLeftWidth = "5px";
        previewCard.style.borderLeftStyle = "solid";
        previewCard.style.borderRadius = "0 6px 6px 0";
      } else if (borderVal === "minimal") {
        previewCard.style.borderLeftWidth = "1.5px";
        previewCard.style.borderLeftStyle = "solid";
        previewCard.style.borderRadius = "0 5px 5px 0";
      } else if (borderVal === "none") {
        previewCard.style.borderLeftStyle = "none";
        previewCard.style.borderRadius = "6px";
      }

      const bgVal = cardbgSelect ? cardbgSelect.value : "transparent";
      if (bgVal === "transparent") {
        previewCard.style.backgroundColor = "transparent";
        previewCard.style.boxShadow = "none";
      } else if (bgVal === "solid") {
        previewCard.style.backgroundColor = "var(--material-sidepane, #ffffff)";
        previewCard.style.boxShadow = "0 1px 3px rgba(0,0,0,0.06)";
      } else {
        previewCard.style.backgroundColor = hexToRgba(color, 0.05);
        previewCard.style.boxShadow = "none";
      }
    }

    // Load appearance preferences
    if (fontSelect && plugin.getFontFamily) {
      fontSelect.value = plugin.getFontFamily();
    }
    if (customFontInput && plugin.getCustomFont) {
      customFontInput.value = plugin.getCustomFont();
    }
    if (frameSelect && plugin.getFrameTheme) {
      frameSelect.value = plugin.getFrameTheme();
    }
    if (borderStyleSelect && plugin.getBorderStyle) {
      borderStyleSelect.value = plugin.getBorderStyle();
    }
    if (plugin.getCustomColor) {
      const col = plugin.getCustomColor();
      if (customColorInput) customColorInput.value = col;
      if (customColorText) customColorText.value = col;
    }
    if (cardbgSelect && plugin.getCardBgMode) {
      cardbgSelect.value = plugin.getCardBgMode();
    }
    updatePreview();

    function showSavedFeedback() {
      if (saveMsg) {
        saveMsg.style.display = "inline";
        clearTimeout(saveMsg._timer);
        saveMsg._timer = setTimeout(() => {
          saveMsg.style.display = "none";
        }, 2500);
      }
    }

    function getSelectedModel() {
      if (modelSelect.value === "custom") {
        return customModelInput ? customModelInput.value.trim() : (PRESETS[providerSelect.value]?.defaultModel || "deepseek-chat");
      }
      return modelSelect.value || (PRESETS[providerSelect.value]?.defaultModel || "deepseek-chat");
    }

    function saveAll() {
      const provider = providerSelect.value;
      const baseUrl = baseUrlInput ? baseUrlInput.value.trim() : "";
      const key = apikeyInput.value.trim();
      const model = getSelectedModel();
      const auto = autoTransCheck.checked;
      if (tablesCheck && plugin.setTranslateTables) plugin.setTranslateTables(tablesCheck.checked);
      if (concurrencySelect && plugin.setConcurrency) plugin.setConcurrency(concurrencySelect.value);
      const prompt = promptArea.value.trim();

      if (plugin.setProvider) plugin.setProvider(provider);
      if (plugin.setBaseUrl) plugin.setBaseUrl(baseUrl);
      plugin.setApiKey(key);
      if (model) plugin.setModel(model);
      plugin.setAutoTranslate(auto);
      if (prompt) plugin.setCustomPrompt(prompt);

      // Save appearance preferences
      if (fontSelect && plugin.setFontFamily) plugin.setFontFamily(fontSelect.value);
      if (customFontInput && plugin.setCustomFont) plugin.setCustomFont(customFontInput.value.trim());
      if (frameSelect && plugin.setFrameTheme) plugin.setFrameTheme(frameSelect.value);
      if (borderStyleSelect && plugin.setBorderStyle) plugin.setBorderStyle(borderStyleSelect.value);
      const customCol = customColorInput?.value || customColorText?.value || "#a8202b";
      if (plugin.setCustomColor) plugin.setCustomColor(customCol);
      if (cardbgSelect && plugin.setCardBgMode) plugin.setCardBgMode(cardbgSelect.value);

      // Re-style any active readers live
      if (plugin.updateAllReaderStyles) plugin.updateAllReaderStyles();

      showSavedFeedback();
    }

    // Provider changed
    providerSelect.addEventListener("change", () => {
      applyProvider(providerSelect.value, true);
      updateKeyStatus();
      saveAll();
    });

    if (baseUrlInput) {
      baseUrlInput.addEventListener("change", saveAll);
    }

    // Model select changed
    modelSelect.addEventListener("change", () => {
      if (modelSelect.value === "custom") {
        if (customModelBox) customModelBox.style.display = "block";
        if (customModelInput) customModelInput.focus();
      } else {
        if (customModelBox) customModelBox.style.display = "none";
        saveAll();
      }
    });

    if (customModelInput) {
      customModelInput.addEventListener("change", saveAll);
      customModelInput.addEventListener("blur", saveAll);
    }

    // Test API Key and Fetch Models
    if (testBtn) {
      const runTest = async () => {
        const key = apikeyInput.value.trim();
        const provider = providerSelect.value;
        const baseUrl = baseUrlInput ? baseUrlInput.value.trim() : "";

        if (!key) {
          updateKeyStatus(`
            <div style="color: #b91c1c; background: rgba(239, 68, 68, 0.08); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(239, 68, 68, 0.25);">
              请先输入 API Key，然后再点击测试。
            </div>
          `);
          return;
        }

        updateKeyStatus(`
          <div style="color: #2563eb; background: rgba(37, 99, 235, 0.08); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(37, 99, 235, 0.25);">
            正在通信测试连接并拉取可用模型...
          </div>
        `);

        try {
          const models = await plugin.fetchAvailableModels(key, provider, baseUrl);
          plugin.setApiKey(key);
          if (baseUrl && plugin.setBaseUrl) plugin.setBaseUrl(baseUrl);
          if (plugin.setProvider) plugin.setProvider(provider);

          let current = getSelectedModel();
          if (!current || current === "custom" || !models.some(m => m.id === current)) {
            current = models[0]?.id || (PRESETS[provider]?.defaultModel || "default");
          }

          populateModels(models, current);
          plugin.setModel(current);

          updateKeyStatus(`
            <div style="color: #15803d; background: rgba(34, 197, 94, 0.08); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(34, 197, 94, 0.25);">
              连接成功！已获取 ${models.length} 个模型，当前选用: <code>${current}</code>
            </div>
          `);
          showSavedFeedback();
        } catch (err) {
          let extra = "";
          const msg = err.message || "";
          if (msg.includes("prepayment") || msg.includes("depleted")) {
            extra = "<br/>提示：Google 提示该项目预付费额度耗尽。若使用免费额度，请在 Google AI Studio 新建一个普通项目（不要开启 Prepay）并重新获取 Key。";
          }
          updateKeyStatus(`
            <div style="color: #b91c1c; background: rgba(239, 68, 68, 0.08); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(239, 68, 68, 0.25);">
              连接失败: ${msg}${extra}
            </div>
          `);
        }
      };

      testBtn.addEventListener("command", runTest);
      testBtn.addEventListener("click", runTest);
    }

    // Event listeners
    apikeyInput.addEventListener("input", () => updateKeyStatus());
    apikeyInput.addEventListener("change", saveAll);

    autoTransCheck.addEventListener("command", saveAll);
    autoTransCheck.addEventListener("click", saveAll);
    autoTransCheck.addEventListener("change", saveAll);

    if (concurrencySelect) {
      concurrencySelect.addEventListener("change", saveAll);
      concurrencySelect.addEventListener("command", saveAll);
    }

    if (tablesCheck) {
      tablesCheck.addEventListener("command", saveAll);
      tablesCheck.addEventListener("click", saveAll);
      tablesCheck.addEventListener("change", saveAll);
    }

    promptArea.addEventListener("change", saveAll);

    // Appearance event listeners
    if (fontSelect) {
      fontSelect.addEventListener("change", () => {
        updatePreview();
        saveAll();
      });
    }
    if (customFontInput) {
      customFontInput.addEventListener("input", updatePreview);
      customFontInput.addEventListener("change", saveAll);
    }
    if (frameSelect) {
      frameSelect.addEventListener("change", () => {
        updatePreview();
        saveAll();
      });
    }
    if (customColorInput) {
      customColorInput.addEventListener("input", (e) => {
        if (customColorText) customColorText.value = e.target.value;
        updatePreview();
        saveAll();
      });
    }
    if (customColorText) {
      customColorText.addEventListener("input", (e) => {
        if (customColorInput && /^#[0-9a-fA-F]{6}$/.test(e.target.value)) {
          customColorInput.value = e.target.value;
        }
        updatePreview();
        saveAll();
      });
    }
    if (cardbgSelect) {
      cardbgSelect.addEventListener("change", () => {
        updatePreview();
        saveAll();
      });
    }
    if (borderStyleSelect) {
      borderStyleSelect.addEventListener("change", () => {
        updatePreview();
        saveAll();
      });
    }

    if (resetBtn) {
      const resetPrompt = () => {
        promptArea.value = plugin.DEFAULT_PROMPT;
        plugin.setCustomPrompt(plugin.DEFAULT_PROMPT);
        showSavedFeedback();
      };
      resetBtn.addEventListener("command", resetPrompt);
      resetBtn.addEventListener("click", resetPrompt);
    }

    if (saveBtn) {
      saveBtn.addEventListener("command", saveAll);
      saveBtn.addEventListener("click", saveAll);
    }
  }

  // Poll for pane insertion
  let attempts = 0;
  const pollTimer = setInterval(() => {
    attempts++;
    if (document.getElementById("reading-bilingual-pref-apikey")) {
      clearInterval(pollTimer);
      initPrefs();
    } else if (attempts > 50) {
      clearInterval(pollTimer);
    }
  }, 100);

  window.addEventListener("showing", initPrefs, true);
  window.addEventListener("focus", initPrefs);
  document.addEventListener("DOMContentLoaded", initPrefs);
})();
