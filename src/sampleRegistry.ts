import { readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import {
  isSampleController,
  isValidSampleName,
  type SampleController,
} from "./sampleInterface.js";

export interface SampleRegistry {
  list(): string[];
  get(name: string): SampleController | undefined;
}

const DEFAULT_SAMPLES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "samples",
);

export async function buildRegistry(
  samplesDir: string = DEFAULT_SAMPLES_DIR,
): Promise<SampleRegistry> {
  if (!existsSync(samplesDir)) {
    return { list: () => [], get: () => undefined };
  }

  const entries = readdirSync(samplesDir)
    .filter((name) => !name.startsWith(".") && !name.startsWith("_"))
    .filter((name) => isValidSampleName(name))
    .filter((name) => {
      const abs = join(samplesDir, name);
      if (!statSync(abs).isDirectory()) return false;
      return (
        existsSync(join(abs, "IndexController.js")) ||
        existsSync(join(abs, "IndexController.ts"))
      );
    })
    .sort();

  const map = new Map<string, SampleController>();
  for (const name of entries) {
    // Prefer whichever file exists on disk — lets the same code run under
    // Vitest (where only .ts exists) and in production (where only .js exists).
    const jsPath = join(samplesDir, name, "IndexController.js");
    const tsPath = join(samplesDir, name, "IndexController.ts");
    const diskPath = existsSync(jsPath) ? jsPath : tsPath;
    const modulePath = pathToFileURL(diskPath).href;
    let mod: unknown;
    try {
      mod = await import(modulePath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to load sample '${name}': ${message}`);
    }
    const Ctor = (mod as { IndexController?: new () => unknown })
      .IndexController;
    if (!Ctor) {
      throw new Error(
        `Sample '${name}' does not export a named 'IndexController'`,
      );
    }
    const instance = new Ctor();
    if (!isSampleController(instance)) {
      throw new Error(
        `Sample '${name}' IndexController does not implement SampleController`,
      );
    }
    map.set(name, instance);
  }

  return {
    list: () => Array.from(map.keys()),
    get: (name) => map.get(name),
  };
}
