# SignNow Node.js Sample App

[![Node.js](https://img.shields.io/badge/node-20_LTS-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/typescript-5-blue)](https://www.typescriptlang.org/)
[![SignNow SDK](https://img.shields.io/badge/SignNow_SDK-3.2+-light)](https://www.npmjs.com/package/@signnow/api-client)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

An Express 5 + TypeScript application demonstrating the SignNow API via the official [`@signnow/api-client`](https://www.npmjs.com/package/@signnow/api-client) package from npm.

## Quick Start

### 1. Enter the directory

```bash
cd SampleApps/nodejs-sample-app
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in your SignNow credentials:

| Variable | Example | Description |
|---|---|---|
| `SIGNNOW_API_HOST` | `https://api.signnow.com` | Production or sandbox URL |
| `SIGNNOW_API_BASIC_TOKEN` | `c2lnbk5vdy4...` | Base64 token from [API Dashboard](https://app.signnow.com/webapp/api-dashboard/keys) |
| `SIGNNOW_API_USERNAME` | `you@example.com` | Your SignNow account email |
| `SIGNNOW_API_PASSWORD` | `••••••` | Your SignNow account password |
| `SIGNNOW_DOWNLOADS_DIR` | `/tmp/signnow-downloads` | Where downloaded documents are cached |
| `SN_SIGNER_EMAIL` | `signer@example.com` | Default embedded signer email |
| `APP_BASE_URL` | `http://localhost:8080` | Public base URL used in `redirect_uri` |
| `PORT` | `8080` | HTTP port |

### 3. Run with Docker

```bash
docker build -t nodejs-sample-app .
docker run --env-file .env -p 8080:8080 nodejs-sample-app
```

### 4. Run locally (no Docker)

```bash
npm install
npm run dev          # tsx watch — auto-reload on source change
# or production-like:
npm run build && npm start
```

### 5. Open a sample

```
http://localhost:8080/samples/EmbeddedSignerConsentForm
```

`http://localhost:8080/samples` lists all available samples.

## Available Samples (20)

| Sample | Description |
|---|---|
| EmbeddedSignerConsentForm | Consent form with single embedded signer |
| EmbeddedSenderWithoutFormFile | Sales proposal — embedded sender |
| EmbeddedSenderWithFormCreditLoanAgreement | Credit loan agreement |
| EmbeddedSignerConsumerServices | Veterinary intake form |
| EmbeddedSignerPatientIntakeForm | Patient intake (healthcare) |
| EmbeddedSignerWithFormInsurance | Insurance claim form |
| MedicalInsuranceClaimForm | Medical insurance claim |
| EmbeddedEditingAndSigningDG | Document generation: edit + sign |
| EmbeddedSenderWithFormAndFirstSigner | Sender is also first signer |
| EmbeddedSenderWithFormDG | Document generation variant |
| EmbeddedSenderWithFormDGAdjunct | DG adjunct form |
| EmbeddedSenderWithFormDGConstr | DG construction form |
| ISVWithFormAndOneClickSendBasicPrefill | ISV one-click send, basic prefill |
| ISVWithFormAndOneClickSendMergeFields | ISV one-click send, merge fields |
| HROnboardingSystem | HR onboarding multi-document flow |
| UploadEmbeddedSender | Upload PDF + embedded sender |
| PrefillAndEmbeddedSendingAgreement | Prefill + embedded send |
| PrefillAndOneClickSendingAgreement | Prefill + one-click send |
| EVDemoSendingAnd3EmbeddedSigners | Real estate: 3 sequential embedded signers |
| UploadEmbeddedEditingAndInvite | Upload PDF, embedded edit, invite |

## Project Structure

```
src/
  main.ts               Express bootstrap
  routing.ts            /samples/:name and /api/samples/:name dispatch
  sampleInterface.ts    SampleController contract
  sampleRegistry.ts     Eager-loads samples at boot
  settings.ts           zod-validated .env loader
  sdk/
    sdkClient.ts        Lazy-singleton authenticated ApiClient
samples/
  <SampleName>/
    IndexController.ts  Named-export class implementing SampleController
    index.html          UI served on GET /samples/<SampleName>
static/                 Shared CSS, JS, images, error.html
scripts/copy-html.mjs   Post-tsc step: copies HTML and PDF fixtures into dist/
tests/                  Vitest smoke suite (40 tests)
```

## Routing

| Method | Path | Handler |
|---|---|---|
| GET | `/` | 404 error page |
| GET | `/samples` | HTML list of all samples |
| GET | `/api/samples` | `{ samples: string[] }` |
| GET | `/samples/:name` | `samples/<name>/IndexController.handleGet` |
| POST | `/api/samples/:name` | `samples/<name>/IndexController.handlePost` |
| GET | `/css/*`, `/js/*`, `/img/*`, etc. | Shared static files |

Sample names must match `^[a-zA-Z0-9_]+$`. Anything else → 404. Sample discovery is by convention: any folder under `samples/` whose `IndexController.ts` exports a class implementing `SampleController` is loaded at boot by `sampleRegistry.ts`.

## Add a New Sample

1. `mkdir samples/MyNewSample`
2. Create `samples/MyNewSample/IndexController.ts`:
   ```ts
   import type { Request, Response } from "express";
   import type { SampleController } from "../../src/sampleInterface.js";

   export class IndexController implements SampleController {
     async handleGet(req: Request, res: Response) { /* ... */ }
     async handlePost(req: Request, res: Response) { /* ... */ }
   }
   ```
3. Create `samples/MyNewSample/index.html`.
4. Add `"MyNewSample"` to the `ALL_SAMPLES` list in `tests/registry.test.ts`.
5. `npm test` — confirms the controller loads.

No JSON whitelist, no registration file — the registry discovers samples at boot.

## Tests

```bash
npm test
```

40 smoke-level tests:
- 3 settings defaults / overrides
- 6 routing layer (name regex, dispatch, 404 responses)
- 24 registry (3 unit + 1 full sample list + 20 per-sample module loads)
- 7 HTTP integration (root, unknown, invalid name, static CSS/img)

Tests confirm the app starts and each sample's controller loads correctly.
They do **not** exercise real SignNow API calls (live credentials required).

Additional checks:

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint over src/, tests/, samples/
```

## SDK Notes

Known quirks in `@signnow/api-client` v3.2.0 that affect this codebase:

**ESM export typos** — The published `package.json` has `"imoport"`/`"impoort"` instead of `"import"` in the `exports` conditions for `api/embeddedInvite`, `api/embeddedEditor`, and `api/embeddedGroupInvite`. Controllers importing from those paths use a `createRequire` workaround to load via the `"require"` condition. See `EmbeddedSignerConsentForm/IndexController.ts` for the pattern.

**`DocumentInvitePostResponse.data[]` shape** — The type declaration maps items to `{ link: string }`, but the server returns `{ id, email, role_id, ... }`. Affected controllers use a local `DocumentInvitePostResponseFixed` type to correct this.

**`DocumentGroupRecipientsPutRequest` missing** — Only the `Get` variant is exported. Controllers that need to update DG recipients skip this step and let the embedded editor UI handle it instead.

## Tech Stack

- Node.js 20 LTS, TypeScript 5, ESM
- Express 5
- `@signnow/api-client` 3.2.0+ (from npm)
- `dotenv` + `zod` for `.env` loading and validation
- `tsx` (dev), `tsc` (build)
- Vitest + supertest (tests)
- Docker: multi-stage `node:20-slim`

## GitHub Copilot Extension

Get AI-powered SignNow code suggestions in your IDE:
[github.com/apps/signnow](https://github.com/apps/signnow) — start prompts with `@signnow`.

## License

See [LICENSE](./LICENSE).
