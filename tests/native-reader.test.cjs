const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { createHash } = require('node:crypto');
const { linkPDF, verifyPDF, readAnchors, anchorAtLine } = require('../obsidian-plugin/src/native-reader.js');

test('native PDF symlinks share the source without copying or overwriting ordinary files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zrb-native-link-'));
  try {
    const source = path.join(root, 'source.pdf'), linked = path.join(root, 'vault/paper.pdf');
    await fs.writeFile(source, 'original PDF'); await linkPDF(source, linked);
    assert.equal((await fs.lstat(linked)).isSymbolicLink(), true);
    assert.equal(await fs.realpath(linked), await fs.realpath(source));
    await linkPDF(source, linked); assert.equal(await fs.readFile(source, 'utf8'), 'original PDF');
    const ordinary = path.join(root, 'vault/existing.pdf'); await fs.writeFile(ordinary, 'user file');
    await assert.rejects(linkPDF(source, ordinary), /未覆盖/);
    assert.equal(await fs.readFile(ordinary, 'utf8'), 'user file');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('native PDF verifies original content before applying cached page anchors', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zrb-native-hash-'));
  try {
    const file = path.join(root, 'paper.pdf'); await fs.writeFile(file, 'original');
    await verifyPDF(file, createHash('md5').update('original').digest('hex'));
    await assert.rejects(verifyPDF(file, createHash('md5').update('changed').digest('hex')), /已变化/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('native anchors survive Markdown edits and distinguish paragraphs spanning pages', () => {
  const text = '# title\n<!-- block-0; PDF 1 -->\nsource\n译文\n<!-- block-1; PDF 2,3 -->\nnext';
  const anchors = readAnchors(text, 3);
  assert.deepEqual(anchorAtLine(anchors, 3).pages, [1]);
  assert.deepEqual(anchorAtLine(anchors, 5).pages, [2, 3]);
  const edited = readAnchors(text.replace('source', 'source\nnew text\n$x^2$'), 3);
  assert.equal(edited[1].line, anchors[1].line + 2);
  assert.equal(anchorAtLine(edited, edited[1].line + 1).id, 'block-1');
  assert.equal(readAnchors('<!-- block-9; PDF 999 -->', 3).length, 0);
});
