#!/usr/bin/env node
import { readdirSync, statSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "samples");
const dst = join(root, "dist", "samples");

if (!existsSync(src)) {
  console.warn(`No samples/ directory at ${src} — nothing to copy.`);
  process.exit(0);
}

let copied = 0;
for (const name of readdirSync(src)) {
  const dir = join(src, name);
  if (!statSync(dir).isDirectory()) continue;
  for (const file of readdirSync(dir)) {
    if (!file.match(/\.(html|pdf)$/i)) continue;
    const fileSrc = join(dir, file);
    const fileDst = join(dst, name, file);
    mkdirSync(dirname(fileDst), { recursive: true });
    copyFileSync(fileSrc, fileDst);
    copied += 1;
  }
}
console.log(`copy-html: ${copied} file(s) copied to dist/samples/`);
