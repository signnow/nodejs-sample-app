import type { Request, Response } from "express";

export interface SampleController {
  handleGet(req: Request, res: Response): Promise<void> | void;
  handlePost(req: Request, res: Response): Promise<void> | void;
}

export function isSampleController(value: unknown): value is SampleController {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.handleGet === "function" && typeof v.handlePost === "function";
}

export const SAMPLE_NAME_RE = /^[a-zA-Z0-9_]+$/;

export function isValidSampleName(name: string): boolean {
  return SAMPLE_NAME_RE.test(name);
}
