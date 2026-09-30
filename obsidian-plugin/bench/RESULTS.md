# JS vs native Obsidian reader: memory comparison

16 GiB Mac mini, Obsidian 1.13.7, one 41-page paper (425 source blocks, 232 translations, 20 crops). Four fresh profiles/vaults, order JS / native / native / JS. Same 1200 x 900 window and default GPU settings. Background throttling disabled only in both isolated test windows so scrolling executes.

Each scrolling phase: 3 down/up cycles, 36 positions per cycle, 100 ms per position. Three process RSS samples per phase; median per run, then mean of two runs. Units: MiB.

| Phase | JS renderer | Native renderer | JS GPU process | Native GPU process | JS all processes | Native all processes |
|---|---:|---:|---:|---:|---:|---:|
|empty|282|284|97|98|607|610|
|body-open|340|403|100|104|668|744|
|body-scrolled|382|456|110|122|722|816|
|split-open|463|595|152|160|845|994|
|split-scrolled|581|751|179|199|988|1187|
|pdf-closed|559|682|146|138|932|1057|

## Observations and limits

Native used more memory in this sample: after split scrolling, approximately 170 MiB more renderer RSS and 199 MiB more summed process RSS. Native retained 11 PDF page canvases; JS retained one. After closing PDF, native had zero canvases; JS kept one zero-sized placeholder.

GPU-process RSS increased while scrolling in both versions. This is a memory measurement, not GPU utilization. JavaScript heap was only about 27-56 MiB; the remainder cannot be attributed from this test alone. Page bitmaps, decoded images, fonts and browser caches can live outside that heap.

RSS includes shared pages and is not Activity Monitor physical footprint or uniquely owned RAM. Closing PDF did not immediately restore the baseline in either version; this alone does not prove a leak. Only two runs and one document in native reading mode were tested; live preview and long-term usage were not benchmarked.

Native offers native editing and reader functionality; this result does not support claiming it saves RAM. Raw per-run results: [memory-comparison.json](memory-comparison.json). Reproduction script: [compare.mjs](compare.mjs).
