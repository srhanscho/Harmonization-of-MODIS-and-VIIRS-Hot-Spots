// MapLibre GL v6 ships its web worker as a separate ES module that bundlers do
// not copy. Copy it into public/vendor so it is served as a static file.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const pkgDir = path.dirname(require.resolve("maplibre-gl/package.json"));
const outDir = path.join(process.cwd(), "public", "vendor");
mkdirSync(outDir, { recursive: true });
copyFileSync(path.join(pkgDir, "dist", "maplibre-gl-worker.mjs"), path.join(outDir, "maplibre-gl-worker.mjs"));
console.log("copied maplibre-gl-worker.mjs -> public/vendor/");
