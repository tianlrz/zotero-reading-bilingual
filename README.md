# Zotero 阅读模式沉浸式双语

专为 Zotero 阅读模式打造的中英双语对照翻译插件。译文以卡片形式插在原文段落之下，原文保持不动。

![version](https://img.shields.io/badge/version-1.3.0-blue) ![license](https://img.shields.io/badge/license-MIT-green)

## 功能

- **段落级对照**：正文按段成批翻译，译文卡片插在原文下方，可编辑、复制、单独删除。
- **目录整体翻译**：把整页目录识别成一个单元翻译成一张卡片，跨页断开的目录会自动合并，不会被切成几十条碎片。
- **表格整体翻译**：阅读模式把 PDF 表格渲染成图片、文字藏在隐藏节点里，插件会把整张表当一个单元翻译并还原成分行分列的中文。此项可在设置中关闭以节约额度。
- **跳过参考文献**：自动识别参考文献章节并跳过，不浪费额度。
- **本地缓存**：译文以 `<文献名>.bilingual.json` 存在附件同目录，重开秒级载入，不重复消耗 API。
- **多服务商**：Gemini、DeepSeek、SiliconFlow、OpenRouter、Moonshot、Qwen、OpenAI，以及任意 OpenAI 兼容接口。
- **排版可调**：字体、字号、行高、主题色、卡片底色、边栏线条样式。

## 安装

1. 从 [Releases](https://github.com/tianlrz/zotero-reading-bilingual/releases) 下载 `zotero-reading-bilingual.xpi`。
2. Zotero 菜单：工具 → 插件 → 右上角齿轮 → Install Plugin From File，选择该 xpi。
3. 打开一篇文献，**切换到阅读模式**，点击工具栏的「双语」按钮。

> 插件只在阅读模式下工作。PDF 原始视图没有可供插入译文的段落结构，按钮不会有反应。阅读模式的开关在阅读器工具栏上。

## 配置

Zotero 设置 → 沉浸式双语。

插件**不自带任何 API Key**，需要自己填写。Gemini 可在 Google AI Studio 免费申请。填好后点「测试连接」拉取可用模型列表。

其余选项：主力模型、进入阅读模式时自动翻译、翻译表格与图块、排版样式、自定义翻译提示词。

## 快捷操作

- 工具栏「双语」按钮：翻译 / 显示 / 隐藏译文
- Shift 或 Alt + 点击该按钮：清空缓存并重新翻译
- 右键该按钮：更多操作
- 正文中选中文本右键：只翻译选中部分

## 已知限制

- 仅支持阅读模式，不支持 PDF 原始视图与网页快照。
- 表格文字在阅读模式中已被拉平为一行，还原出的行列结构依赖模型推断，复杂表格可能不完全准确。
- 目录识别基于「章节号 + 标题 + 页码」的排版特征，非常规排版的目录可能识别不到，会退回逐条翻译。

## 开发

无需构建步骤，仓库结构即插件结构。打包：

```bash
zip -r -X zotero-reading-bilingual.xpi manifest.json bootstrap.js prefs.js content
```

## License

MIT
