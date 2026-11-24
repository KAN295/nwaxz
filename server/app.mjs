import packageInfo from "../package.json" with { type: "json" };
const { version } = packageInfo;
import express from "express";
import path from "node:path";
import fs from "node:fs";
import { mountCoopRoutes,resolveCoopClientIp } from "./coop-service.mjs";
import {SocialService,mountSocialRoutes} from './social-service.mjs';
export function createApp({ distDir, revision = "development", coopService, socialService, profilePath=':memory:', lan = false } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use((req, res, next) => {
    const host=req.get('host')??'';
    const sockets=/^[a-z\d.\-:[\]]+$/i.test(host)?` ws://${host} wss://${host}`:'';
    const direct=host==='nwaxz.bzlom.cn'?' wss://play.bzlom.cn':'';
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'${sockets}${direct}; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'`,
    });
    next();
  });
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.get("/api/health", (_req, res) => {
    const ready = Boolean(
      distDir && fs.existsSync(path.join(distDir, "index.html")),
    );
    res
      .status(ready ? 200 : 503)
      .json({
        status: ready ? "ok" : "unavailable",
        version,
        revision,
      });
  });
  const clientIp = lan ? req => req.socket.remoteAddress : resolveCoopClientIp;
  app.locals.social=mountSocialRoutes(app,{express,service:socialService??new SocialService({filename:profilePath}),clientIp});
  app.locals.coop = mountCoopRoutes(app, { express, service: coopService, lan, clientIp });
  app.use("/api", (_req, res) => res.status(404).json({ error: "接口不存在" }));
  // No extension: public .js responses previously carried month-long caching.
  // The bundled worker controls the root scope and must bypass static JS caches.
  app.get(["/game-worker", "/sw.js"], (_req, res) => {
    res.set({ "Cache-Control": "no-store, max-age=0", "Service-Worker-Allowed": "/", "Content-Type": "text/javascript; charset=utf-8" });
    if (!distDir) return res.status(503).end();
    res.sendFile(path.join(distDir, "sw.js"), { cacheControl: false }, error => { if (error && !res.headersSent) res.status(503).end(); });
  });
  if (distDir) {
    const inventory = path.join(distDir, "preload-manifest.json");
    const fingerprints = new Map(fs.existsSync(inventory)
      ? JSON.parse(fs.readFileSync(inventory, "utf8")).filter(entry => entry.revision).map(entry => [`/${entry.url}`, entry.revision])
      : []);
    app.get("/assets/*asset", (req, res, next) => {
      if (req.query.nwaxz_v === undefined) { next(); return; }
      // A request for retired bytes must never put the current file under the old cache key.
      if (req.query.nwaxz_v !== fingerprints.get(req.path)) {
        res.set("Cache-Control", "no-store").status(404).end();
        return;
      }
      res.set("Cache-Control", "public, max-age=31536000, immutable, no-transform");
      next();
    });
    app.use(
      express.static(distDir, {
        dotfiles: "deny",
        setHeaders(res, filename) {
          if (res.hasHeader("Cache-Control")) return;
          res.set(
            "Cache-Control",
            /[\\/]assets[\\/].+\.png$/.test(filename)
              ? "no-cache, no-transform"
              : /[\\/]assets[\\/][^\\/]+-[A-Za-z0-9_-]{8}\.(?:js|css)$/.test(filename)
              ? "public, max-age=31536000, immutable"
              : "no-cache",
          );
        },
      }),
    );
  }
  app.use((_req, res) => res.status(404).send("Not found"));
  return app;
}
