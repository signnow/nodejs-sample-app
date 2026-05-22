import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

function loadSettings() {
  vi.resetModules();
  return import("../src/settings.js");
}

const REQUIRED = [
  "SIGNNOW_API_BASIC_TOKEN",
  "SIGNNOW_API_USERNAME",
  "SIGNNOW_API_PASSWORD",
];

describe("settings", () => {
  const original = { ...process.env };

  beforeEach(() => {
    // Wipe only env keys we care about
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("SIGNNOW_") || k === "SN_SIGNER_EMAIL" || k === "APP_BASE_URL" || k === "PORT") {
        delete process.env[k];
      }
    }
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("applies defaults when only required vars are set", async () => {
    process.env.SIGNNOW_API_BASIC_TOKEN = "basic";
    process.env.SIGNNOW_API_USERNAME = "user@example.com";
    process.env.SIGNNOW_API_PASSWORD = "pw";

    const { settings } = await loadSettings();

    expect(settings.SIGNNOW_API_HOST).toBe("https://api.signnow.com");
    expect(settings.SIGNNOW_DOWNLOADS_DIR).toBe("/tmp/signnow-downloads");
    expect(settings.SN_SIGNER_EMAIL).toBe("signer@signnow.com");
    expect(settings.APP_BASE_URL).toBe("http://localhost:8080");
    expect(settings.PORT).toBe(8080);
  });

  it("honors overrides", async () => {
    process.env.SIGNNOW_API_BASIC_TOKEN = "basic";
    process.env.SIGNNOW_API_USERNAME = "user@example.com";
    process.env.SIGNNOW_API_PASSWORD = "pw";
    process.env.SIGNNOW_API_HOST = "https://api-eval.signnow.com";
    process.env.APP_BASE_URL = "https://demo.example.com";
    process.env.PORT = "9000";

    const { settings } = await loadSettings();

    expect(settings.SIGNNOW_API_HOST).toBe("https://api-eval.signnow.com");
    expect(settings.APP_BASE_URL).toBe("https://demo.example.com");
    expect(settings.PORT).toBe(9000);
  });

  it("throws on missing required env", async () => {
    await expect(loadSettings()).rejects.toThrow();
  });
});
