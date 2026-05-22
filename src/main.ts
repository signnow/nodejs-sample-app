import express from "express";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { settings } from "./settings.js";
import { buildRegistry } from "./sampleRegistry.js";
import { buildRouter } from "./routing.js";

const STATIC_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "static",
);

async function bootstrap(): Promise<void> {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true, limit: "2mb" }));

  // Static mounts (mirror Python)
  for (const mount of ["css", "js", "img", "fonts", "assets"] as const) {
    app.use(`/${mount}`, express.static(join(STATIC_DIR, mount)));
  }
  for (const file of [
    "favicon.ico",
    "icon.svg",
    "icon.png",
    "robots.txt",
  ] as const) {
    app.get(`/${file}`, (_req, res) => {
      res.sendFile(join(STATIC_DIR, file));
    });
  }

  const registry = await buildRegistry();
  app.use(buildRouter(registry));

  // Root → 404 (parity with Python)
  app.get("/", (_req, res) => {
    const html = readFileSync(join(STATIC_DIR, "error.html"), "utf8");
    res.status(404).type("html").send(html);
  });

  // Trailing 404
  app.use((_req, res) => {
    const html = readFileSync(join(STATIC_DIR, "error.html"), "utf8");
    res.status(404).type("html").send(html);
  });

  app.listen(settings.PORT, () => {
    console.log(
      `SignNow Node.js sample app listening on http://localhost:${settings.PORT}`,
    );
  });
}

bootstrap().catch((err) => {
  console.error("Fatal boot error:", err);
  process.exit(1);
});
