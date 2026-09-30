const { inflateRawSync } = require("node:zlib");

// Independent reader for the SDT pack v1 on-disk format. Zotero caches a
// DEFLATE-compressed metadata object, catalog, and indexed JSON block chunks.
function readSDTCache(input) {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const fail = () => { throw new Error("Zotero 阅读模式缓存损坏或格式不受支持，请在 Zotero 中重新打开阅读模式后再导入。"); };
  const range = (start, length) => {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0 || start + length > bytes.length) fail();
    return bytes.subarray(start, start + length);
  };
  if (bytes.length < 32 || !bytes.subarray(0, 8).equals(Buffer.from([137, 83, 68, 84, 13, 10, 26, 10])) || bytes[8] !== 1 || bytes[9] !== 1) fail();
  const indexSize = bytes.readUInt32LE(12);
  if (indexSize < 16 || (indexSize - 8) % 8) fail();
  const index = range(16, indexSize);
  const entries = (indexSize - 8) / 8;
  const offsets = [], starts = [];
  for (let i = 0; i < entries; i++) {
    offsets.push(index.readUInt32LE(8 + i * 4));
    starts.push(index.readUInt32LE(8 + entries * 4 + i * 4));
    if ((i === 0 && (offsets[i] || starts[i])) || (i && (offsets[i] <= offsets[i - 1] || starts[i] <= starts[i - 1]))) fail();
  }
  const metadataSize = index.readUInt32LE(0), catalogSize = index.readUInt32LE(4);
  const metadataStart = 16 + indexSize, catalogStart = metadataStart + metadataSize, contentStart = catalogStart + catalogSize;
  if (contentStart + offsets.at(-1) !== bytes.length || starts.at(-1) > 100000) fail();
  let expandedBytes = 0;
  const expand = (compressed) => {
    const result = inflateRawSync(compressed, { maxOutputLength: 64 * 1024 * 1024 });
    expandedBytes += result.length;
    if (expandedBytes > 128 * 1024 * 1024) fail();
    return result;
  };
  const metadata = JSON.parse(expand(range(metadataStart, metadataSize)).toString("utf8"));
  const catalog = JSON.parse(expand(range(catalogStart, catalogSize)).toString("utf8"));
  const content = [];
  for (let i = 0; i < entries - 1; i++) {
    const chunk = expand(range(contentStart + offsets[i], offsets[i + 1] - offsets[i]));
    const count = starts[i + 1] - starts[i], header = count * 4;
    if (header > chunk.length) fail();
    for (let j = 0; j < count; j++) {
      const begin = chunk.readUInt32LE(j * 4), end = j + 1 === count ? chunk.length - header : chunk.readUInt32LE((j + 1) * 4);
      if (begin > end || header + end > chunk.length || (j === 0 && begin !== 0)) fail();
      content.push(JSON.parse(chunk.subarray(header + begin, header + end).toString("utf8")));
    }
  }
  if (metadata.processor?.type !== "pdf" || !Array.isArray(catalog.pages)) throw new Error("当前仅支持 Zotero 的 PDF 阅读模式缓存。");
  return { schemaVersion: [bytes[9], bytes[10], bytes[11]].join("."), metadata, catalog, content };
}

module.exports = { readSDTCache };
