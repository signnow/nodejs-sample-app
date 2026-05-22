import { Router, type Request, type Response } from "express";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidSampleName } from "./sampleInterface.js";
import type { SampleRegistry } from "./sampleRegistry.js";

const STATIC_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "static",
);

function send404(res: Response): void {
  let html: string;
  try {
    html = readFileSync(join(STATIC_DIR, "error.html"), "utf8");
  } catch {
    html = "<h1>404 Not Found</h1>";
  }
  res.status(404).type("html").send(html);
}

export function buildRouter(registry: SampleRegistry): Router {
  const router = Router();

  router.get("/api/samples", (_req, res) => {
    res.json({ samples: registry.list() });
  });

  router.get("/samples", (_req, res) => {
    const names = registry.list();
    const items = names
      .map((n) => `      <li><a href="/samples/${n}">${n}</a></li>`)
      .join("\n");
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>SignNow Node.js Sample App — Samples</title>
  <link href="/css/bootstrap.min.css" rel="stylesheet">
  <link href="/css/styles.css" rel="stylesheet">
  <link rel="icon" href="/img/sign-now.png">
  <style>
    body { padding: 2rem; font-family: "Open Sans", system-ui, sans-serif; }
    .wrap { max-width: 720px; margin: 0 auto; }
    h1 { margin-bottom: 0.25rem; }
    .sub { color: #666; margin-bottom: 1.5rem; }
    ul { list-style: none; padding: 0; }
    li { padding: 0.5rem 0; border-bottom: 1px solid #eee; }
    a { color: #047cc0; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .count { color: #888; font-size: 0.9em; }
    img.logo { height: 36px; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="wrap">
    <img class="logo" src="/img/sign-now.png" alt="SignNow">
    <h1>Available Samples</h1>
    <p class="sub"><span class="count">${names.length} samples</span> · JSON at <code>/api/samples</code></p>
    <ul>
${items}
    </ul>
  </div>
</body>
</html>`;
    res.type("html").send(html);
  });

  router.get("/samples/:name", async (req: Request, res: Response) => {
    const name = req.params.name as string;
    if (!isValidSampleName(name)) return send404(res);
    const ctrl = registry.get(name);
    if (!ctrl) return send404(res);
    try {
      await ctrl.handleGet(req, res);
    } catch (err) {
      console.error(`handleGet(${name}) failed:`, err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/api/samples/:name", async (req: Request, res: Response) => {
    const name = req.params.name as string;
    if (!isValidSampleName(name)) return send404(res);
    const ctrl = registry.get(name);
    if (!ctrl) return send404(res);
    try {
      await ctrl.handlePost(req, res);
    } catch (err) {
      console.error(`handlePost(${name}) failed:`, err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
