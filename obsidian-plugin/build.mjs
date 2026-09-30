import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.dirname(fileURLToPath(import.meta.url)), out = path.join(root, "dist-native");
await mkdir(out, { recursive: true });
await build({ entryPoints: [path.join(root, "src/main.js")], outfile: path.join(out, "main.js"), bundle: true, format: "cjs", platform: "node", target: "es2022", external: ["obsidian", "electron", "@electron/remote"], minify: false, logLevel: "warning" });
for (const file of ["manifest.json", "styles.css"]) await cp(path.join(root, file), path.join(out, file));
console.log("Obsidian plugin built:", out);
