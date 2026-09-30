# Bundled rendering libraries

- markdown-it 15.0.2: `dist/browser/markdown-it.umd.min.js` (saved as
  `markdown-it.min.js`), MIT license.
- KaTeX 0.18.9: `dist/katex.min.js`, `dist/katex.min.css`, and `dist/fonts`, MIT license.

Files are copied from the corresponding npm packages. Licenses are included
alongside the libraries. All resources load locally; no CDN is used. JavaScript
is loaded once on demand, and formula fonts load only in readers displaying math.
