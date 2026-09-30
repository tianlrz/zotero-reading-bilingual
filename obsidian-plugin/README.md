# Obsidian 原生双语同步（平行版本 0.2.0）

此版本只负责缓存导入和定位同步。正文是普通 `.reading.md`，使用 Obsidian 原生阅读模式 / 实时预览 / 源码编辑；右侧是 Obsidian 自带 PDF 阅读器。插件不打包 PDF.js，不创建自己的正文 DOM、阅读画布或 PDF worker。

原生版 ID 为 `zotero-bilingual-sync`，旧 JS 版 ID 为 `zotero-bilingual-reader`，可以同时安装。旧版源码在 `obsidian-custom-reader` 分支，发布标签为 `obsidian-v0.1.0`；包含段落编辑的中间构建另保留于 `legacy/custom-reader-0.1.1/` 和本地归档。构建原生版不会覆盖旧版产物。

## 安装与使用

1. 将原生安装包中的 `zotero-bilingual-sync` 目录放入库的 `.obsidian/plugins/`，在第三方插件设置中启用 **Zotero Bilingual Sync**。
2. 原有 `.reading.md` 可以直接用 Obsidian 打开、编辑。命令「Zotero Bilingual Sync: 打开双语阅读」只打开正文；「打开原生 PDF 分屏并同步」打开右侧 PDF。
3. 正文滚动定位 PDF 页，PDF 页码变化也会定位正文。阅读模式与实时预览都支持同步。命令「收起当前文献的 PDF 分屏」关闭 PDF 并解除监听。
4. 导入新文献时，在命令面板选择「导入 Zotero PDF 的阅读模式与已有译文」，选择 Zotero `storage/附件键/` 下的原 PDF。需要此前在 Zotero 中生成过阅读模式；译文复用 `.bilingual.json`，不调用翻译 API。

默认只开正文。设置中可以默认开分屏，或关闭同步。

## 文件与编辑

- `.reading.md` 为真实 Markdown，原文和译文可以直接编辑；新导入的译文使用标准 callout，保持宋体、学术蓝、无边线和浅色底。
- `<!-- block-…; PDF … -->` 是段落定位标记。可以修改正文并插入笔记，保留这些标记即可维持对应关系；删除标记会失去该段定位。
- `.md` 为独立笔记，`.zrb.json` 保存导入时的正文和坐标快照。Markdown 编辑不写回 Zotero 缓存，也不回写到旧 JS 阅读器。
- 重复导入已有文献会保留 `.reading.md` 的编辑内容，不覆盖；目前没有自动刷新新增译文的功能。
- `.assets/` 保存图表和公式裁图。导入时临时使用 Obsidian 自带 PDF 文档进行裁图，完成后关闭临时阅读页。

## PDF 与同步范围

原 PDF 留在 Zotero；在库中创建 `.pdf` **符号链接**，不复制内容。换电脑后先同步 Zotero 原附件，在设置中修改 Zotero 数据目录，打开分屏时会重新建立链接。不同同步工具对符号链接的处理不一致，建议不将这些 PDF 链接作为附件备份来源。

PDF 内容哈希不符时拒绝使用旧页码映射；哈希读取采用流式处理。段落自动跟随起始页，跨页段落仍有多页映射；同步精度是段落级，没有逐句定位、高亮覆盖层或标注回写。

原生阅读器仍属于 Obsidian 的 Electron 环境，PDF 仍需要页面、图片和字体缓存；本版本减少插件重复实现，并不保证比 JS 版省内存。内存对照报告随发布提供，指标为进程 RSS，不能直接等同于活动监视器的内存列或实际独占 RAM。

## 开发与验证

```sh
npm ci
npm test
npm run build:obsidian
```

产物在 `obsidian-plugin/dist-native/`，只需 `main.js`、`manifest.json`、`styles.css`。旧 JS 版构建请使用其独立源码分支。

对照测试脚本：

```sh
node obsidian-plugin/bench/compare.mjs FIXTURE_DIR LEGACY_ZIP OUTPUT_JSON 2
```

`FIXTURE_DIR` 为包含导入 bundle、Markdown 和图表目录的测试资料夹。脚本为两版建立独立库和配置，交替顺序启动四次，使用同一篇文献、1200×900 窗口、相同滚动次数；分别记录空白、正文、正文滚动后、PDF 分屏、分屏滚动后、关闭 PDF 的 renderer / GPU / 全部进程 RSS。测试窗口统一关闭后台节流，保持滚动执行，不修改用户应用的 GPU 设置。

仅支持桌面版。原生 PDF 和编辑器的部分定位接口未列入 Obsidian 公共 API，集中隔离在 `src/native-reader.js`；已在 Obsidian 1.13.7 验证，需要随 Obsidian 更新检查兼容性。

本机实测结果见 [内存对照](bench/RESULTS.md)：两轮平均分屏滚动后，JS Renderer 581 MiB、原生 Renderer 751 MiB。原生版在此样本下更重。
