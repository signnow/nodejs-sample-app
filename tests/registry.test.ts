import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRegistry } from "../src/sampleRegistry.js";

describe("sampleRegistry", () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "sn-reg-"));

    // Valid sample
    const a = join(tmp, "SampleA");
    mkdirSync(a, { recursive: true });
    writeFileSync(
      join(a, "IndexController.js"),
      `export class IndexController { handleGet(){} handlePost(){} }`,
    );

    // Invalid name (should be skipped)
    const bad = join(tmp, "bad-name!");
    mkdirSync(bad);
    writeFileSync(
      join(bad, "IndexController.js"),
      `export class IndexController { handleGet(){} handlePost(){} }`,
    );

    // Folder with no controller file (should be skipped)
    const empty = join(tmp, "Empty");
    mkdirSync(empty);
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("loads valid samples and skips invalid ones", async () => {
    const registry = await buildRegistry(tmp);
    expect(registry.list()).toEqual(["SampleA"]);
    const ctrl = registry.get("SampleA");
    expect(ctrl).toBeDefined();
    expect(typeof ctrl?.handleGet).toBe("function");
    expect(typeof ctrl?.handlePost).toBe("function");
  });

  it("returns undefined for unknown names", async () => {
    const registry = await buildRegistry(tmp);
    expect(registry.get("Nope")).toBeUndefined();
  });

  it("exits with error if a sample module fails to load", async () => {
    const broken = join(tmp, "Broken");
    mkdirSync(broken);
    writeFileSync(
      join(broken, "IndexController.js"),
      `throw new Error("boom")`,
    );
    await expect(buildRegistry(tmp)).rejects.toThrow(/Broken.*boom/);
  });
});

const REAL_SAMPLES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "samples",
);

const ALL_SAMPLES = [
  "EVDemoSendingAnd3EmbeddedSigners",
  "EmbeddedEditingAndSigningDG",
  "EmbeddedSenderWithFormAndFirstSigner",
  "EmbeddedSenderWithFormCreditLoanAgreement",
  "EmbeddedSenderWithFormDG",
  "EmbeddedSenderWithFormDGAdjunct",
  "EmbeddedSenderWithFormDGConstr",
  "EmbeddedSenderWithoutFormFile",
  "EmbeddedSignerConsentForm",
  "EmbeddedSignerConsumerServices",
  "EmbeddedSignerPatientIntakeForm",
  "EmbeddedSignerWithFormInsurance",
  "HROnboardingSystem",
  "ISVWithFormAndOneClickSendBasicPrefill",
  "ISVWithFormAndOneClickSendMergeFields",
  "MedicalInsuranceClaimForm",
  "PrefillAndEmbeddedSendingAgreement",
  "PrefillAndOneClickSendingAgreement",
  "UploadEmbeddedEditingAndInvite",
  "UploadEmbeddedSender",
];

describe("sampleRegistry — real samples", () => {
  it("loads every expected sample", async () => {
    const registry = await buildRegistry(REAL_SAMPLES_DIR);
    expect(registry.list().sort()).toEqual([...ALL_SAMPLES].sort());
  });

  describe.each(ALL_SAMPLES)("%s", (name) => {
    it("has handleGet and handlePost", async () => {
      const registry = await buildRegistry(REAL_SAMPLES_DIR);
      const ctrl = registry.get(name);
      expect(ctrl).toBeDefined();
      expect(typeof ctrl?.handleGet).toBe("function");
      expect(typeof ctrl?.handlePost).toBe("function");
    });
  });
});
