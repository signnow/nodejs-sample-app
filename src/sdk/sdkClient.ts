import { Sdk } from "@signnow/api-client/core";
import { settings } from "../settings.js";

// Derive the ApiClient type from the SDK's getClient return type.
type ApiClient = ReturnType<Sdk["getClient"]>;

let clientPromise: Promise<ApiClient> | null = null;

/**
 * Shared authenticated SignNow ApiClient. The OAuth round-trip happens
 * on first call; subsequent callers receive the same promise, so one
 * bearer token is shared across the process.
 */
export function getClient(): Promise<ApiClient> {
  if (!clientPromise) {
    clientPromise = new Sdk({
      apiHost: settings.SIGNNOW_API_HOST,
      basicToken: settings.SIGNNOW_API_BASIC_TOKEN,
      downloadDirectory: settings.SIGNNOW_DOWNLOADS_DIR,
    })
      .authenticate(settings.SIGNNOW_API_USERNAME, settings.SIGNNOW_API_PASSWORD)
      .then((sdk: Sdk) => sdk.getClient());
  }
  return clientPromise as Promise<ApiClient>;
}

/**
 * Clears the cached client so the next getClient() re-authenticates.
 * Day-1 samples don't use this — it's here for long-running deployments
 * that want to recover from a stale token.
 */
export function resetClient(): void {
  clientPromise = null;
}
