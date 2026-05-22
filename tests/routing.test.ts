import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { buildRouter } from "../src/routing.js";
import type { SampleRegistry } from "../src/sampleRegistry.js";

function makeRegistry(overrides: Partial<SampleRegistry> = {}): SampleRegistry {
  const items: Record<string, any> = {
    Hello: {
      handleGet: (_req: any, res: any) => res.type("text/plain").send("ok"),
      handlePost: (_req: any, res: any) => res.json({ got: _req.body }),
    },
  };
  return {
    list: () => Object.keys(items).sort(),
    get: (name) => items[name],
    ...overrides,
  };
}

function makeApp(registry: SampleRegistry) {
  const app = express();
  app.use(express.json());
  app.use(buildRouter(registry));
  return app;
}

describe("routing", () => {
  it("lists samples as JSON", async () => {
    const res = await request(makeApp(makeRegistry())).get("/api/samples");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ samples: ["Hello"] });
  });

  it("dispatches GET /samples/:name", async () => {
    const res = await request(makeApp(makeRegistry())).get("/samples/Hello");
    expect(res.status).toBe(200);
    expect(res.text).toBe("ok");
  });

  it("dispatches POST /api/samples/:name with JSON body", async () => {
    const res = await request(makeApp(makeRegistry()))
      .post("/api/samples/Hello")
      .send({ x: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ got: { x: 1 } });
  });

  it("returns 404 for unknown sample", async () => {
    const res = await request(makeApp(makeRegistry())).get("/samples/Nope");
    expect(res.status).toBe(404);
  });

  it("returns 404 for invalid sample name", async () => {
    const res = await request(makeApp(makeRegistry())).get("/samples/bad-name!");
    expect(res.status).toBe(404);
  });

  it("renders /samples index HTML", async () => {
    const res = await request(makeApp(makeRegistry())).get("/samples");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Hello");
  });
});
