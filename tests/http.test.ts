import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRegistry } from "../src/sampleRegistry.js";
import { buildRouter } from "../src/routing.js";

const STATIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "static");

async function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  for (const mount of ["css", "js", "img", "fonts", "assets"]) {
    app.use(`/${mount}`, express.static(join(STATIC_DIR, mount)));
  }

  const registry = await buildRegistry();
  app.use(buildRouter(registry));

  app.use((_req, res) => {
    res
      .status(404)
      .type("html")
      .send(readFileSync(join(STATIC_DIR, "error.html"), "utf8"));
  });

  return { app, registry };
}

describe("http integration", () => {
  let app: express.Express;

  beforeAll(async () => {
    ({ app } = await makeApp());
  });

  it("GET / returns 404", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(404);
  });

  it("GET /samples returns HTML listing", async () => {
    const res = await request(app).get("/samples");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Available Samples");
  });

  it("GET /css/styles.css serves the stylesheet", async () => {
    const res = await request(app).get("/css/styles.css");
    expect(res.status).toBe(200);
  });

  it("GET /img/sign-now.png serves the logo", async () => {
    const res = await request(app).get("/img/sign-now.png");
    expect(res.status).toBe(200);
  });

  it("GET /samples/Unknown returns 404", async () => {
    const res = await request(app).get("/samples/Unknown");
    expect(res.status).toBe(404);
  });

  it("GET /samples/bad-name! returns 404", async () => {
    const res = await request(app).get("/samples/bad-name!");
    expect(res.status).toBe(404);
  });

  it("POST /api/samples/Unknown returns 404", async () => {
    const res = await request(app).post("/api/samples/Unknown").send({});
    expect(res.status).toBe(404);
  });
});
