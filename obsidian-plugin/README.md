# Obsidian 双语阅读器（桌面原型 0.1.0）

Zotero 负责文献库、生成阅读模式和翻译；Obsidian 负责日常阅读与笔记。导入直接读取 Zotero 已有的 `.zotero-sdt-cache` 和 `.bilingual.json`，不会调用翻译 API，也不要求 Zotero 正在运行。

## 安装和使用

1. 将构建产物放入库目录的 `.obsidian/plugins/zotero-bilingual-reader/`。该目录应包含 `main.js`、`manifest.json`、`styles.css` 和 PDF.js 资源。
2. 在 Obsidian「设置 → 第三方插件」启用 **Zotero Bilingual Reader**。尚未允许第三方插件的库需先关闭受限模式。
3. 命令面板运行「导入 Zotero PDF 的阅读模式与已有译文」，选择 Zotero `storage/附件键/` 下的原 PDF。此前需在 Zotero 中打开过此文献的阅读模式；已有翻译会被复用。
4. 使用左侧书本按钮或「打开双语阅读」命令。默认只显示正文；点击「展开 PDF」显示右侧原文。「回到 Zotero」定位原条目，「写笔记」打开独立笔记。

新导入文献的链接默认定位 Zotero 附件；调用导入接口时可以提供父条目的 `zoteroURI`。设置页可修改 Zotero 数据目录，以及是否默认左右分屏。

## 文件和资源

- `Zotero 阅读/*.zrb.json` 保存正文、译文和 PDF 坐标；`*.reading.md` 提供可以搜索、离线查看的 Markdown 正文。
- `*.md` 是独立笔记，重复导入会保留已有笔记；生成的阅读正文和缓存文件会更新。
- `*.assets/` 只保存阅读模式所需的图表与公式裁图，不复制原 PDF。
- 宋体译文、学术蓝、无边线、浅色底；Markdown、换行和 LaTeX 由 Obsidian 渲染。
- PDF 按需加载，画布只显示当前页；收起 PDF 或关闭阅读页会释放 PDF 文档与 worker。这里只验证了资源释放，尚未测量两款应用的整体内存差值。

## 同步范围

正文滚动按段落的原始坐标切换 PDF 页并高亮原文位置；右侧上一页、下一页也会定位正文。跨页段落提供多个页码按钮，自动跟随其起始页。当前没有逐句同步、Zotero 标注回写或 Obsidian 内新翻译功能。

同步库到另一台电脑时，原 PDF 仍需通过 Zotero 附件同步到当地，再设置 Zotero 数据目录。PDF 内容哈希与阅读缓存不符时会拒绝关联，避免显示错误的页码。

## 开发和验证

```sh
npm ci
npm test
npm run build:obsidian
```

产物位于 `obsidian-plugin/dist/`。仅支持桌面版；不依赖社区 PDF 插件。

在 macOS Obsidian 1.13.7 的独立测试库验证：41 页文献导入 425 个正文块、复用 232 个译文块、保存 20 个图表/公式裁图；正文定位第 15 页、快速跳转后的第 10 页、原文高亮和阅读位置保存均通过。收起 PDF 后会话为空、画布归零，图表仍可加载；插件卸载后重载只有一个阅读页。自动检查共 17 项通过。
