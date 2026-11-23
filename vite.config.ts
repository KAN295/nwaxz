import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const extraPrecacheEntries: { url: string; revision: string | null; bytes?: number; integrity?: string }[] = [];
function startupFiles() {
  const files = new Set(["index.html", "boot.css", "boot-gallery.js", "assets/loading/playlist.json", "icon.svg", "assets/scenes/bath-cover-v2.webp", "assets/scenes/escape-cover-v1.webp"]);
  const graph = JSON.parse(readFileSync(resolve("dist/.vite/manifest.json"), "utf8")) as Record<string, { isEntry?: boolean; file: string; imports?: string[]; css?: string[] }>;
  const visited = new Set<string>();
  function visit(key: string) { if (visited.has(key)) return; visited.add(key); const item = graph[key]; if (!item) throw new Error(`Missing build entry ${key}`); files.add(item.file); item.css?.forEach(file => files.add(file)); item.imports?.forEach(visit); }
  for (const [key, item] of Object.entries(graph)) if (item.isEntry) visit(key);
  return files;
}
function resourceInfo(url: string) {
  const file = resolve("dist", url);
  return { bytes: statSync(file).size, integrity: `sha256-${createHash("sha256").update(readFileSync(file)).digest("base64")}` };
}

export default defineConfig({
  build: { manifest: true },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": {target:"http://127.0.0.1:3000",ws:true} },
  },
  plugins: [
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "prompt",
      injectRegister: false,
      // The glob below already includes the icon and character files.
      includeManifestIcons: false,
      manifest: {
        name: "奶蛙爱洗澡",
        short_name: "nwaxz",
        lang: "zh-CN",
        description: "泡泡浴场、午夜浴场、下水道逃生。选择你的冒险。",
        theme_color: "#286f70",
        background_color: "#286f70",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
      injectManifest: {
        additionalManifestEntries: extraPrecacheEntries,
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,svg,png,webp,json,woff2,mp3,mp4,glb}", "assets/runner/qs2027/*.jpg"],
        // Legacy sprite masters stay published; the new map surfaces use original PNGs.
        globIgnores: [
          "assets/character/milk-frog-atlas.png",
          "assets/models/extreme-milk-frog-v1.glb",
          "assets/props/bath-props-v1.png",
          "assets/props/garden-props-v1.png",
          "preload-manifest.json",
        ],
        // Only Vite's content-hashed bundles can omit a cache revision.
        dontCacheBustURLsMatching: /^assets\/[^/]+-[A-Za-z0-9_-]{8}\.(?:js|css)$/,
        manifestTransforms: [async entries => {
          // Workbox removes its own `size` field after transforms; retain bytes for runtime progress.
          const startup = startupFiles();
          const manifest = entries.map(entry => ({ ...entry, ...resourceInfo(entry.url), ...(startup.has(entry.url) ? { startup: true } : {}) }));
          for (const entry of extraPrecacheEntries) Object.assign(entry, resourceInfo(entry.url));
          // Release audit data. The client gets its manifest from the worker itself.
          writeFileSync(resolve("dist/preload-manifest.json"), JSON.stringify([...manifest, ...extraPrecacheEntries]));
          return { manifest, warnings: [] };
        }],
      },
    }),
  ],
});
