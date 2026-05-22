# SignNow Node.js Sample App

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

| Variable | Description |
|---|---|
| `SIGNNOW_API_HOST` | `https://api.signnow.com` (production) or sandbox URL |
| `SIGNNOW_API_BASIC_TOKEN` | Base64 basic token from your SignNow API dashboard |
| `SIGNNOW_API_USERNAME` | Your SignNow account email |
| `SIGNNOW_API_PASSWORD` | Your SignNow account password |
| `SIGNNOW_DOWNLOADS_DIR` | Where downloaded documents are cached (default `/tmp/signnow-downloads`) |
| `SN_SIGNER_EMAIL` | Default embedded signer email |
| `APP_BASE_URL` | Public base URL used in `redirect_uri` (default `http://localhost:8080`) |
| `PORT` | HTTP port (default `8080`) |

### 3. Run with Docker

```bash
docker build -t nodejs-sample-app .
docker run --env-file .env -p 8080:8080 nodejs-sample-app
```

### 4. Run locally (no Docker)

```bash
npm install
npm run dev          # tsx watch — auto-reload on source change
# or, for production-like:
npm run build && npm start
```

### 5. Open a sample

Navigate to `http://localhost:8080/samples/<SampleName>`, e.g.:

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
  sampleRegistry.ts     eager-load samples at boot
  settings.ts           zod-validated .env loader
  sdk/
    sdkClient.ts        lazy-singleton authenticated ApiClient
samples/
  <SampleName>/
    IndexController.ts  named-export class implementing SampleController
    index.html          Thank-you / download UI
static/                 Shared CSS, JS, images, error.html
scripts/copy-html.mjs   Post-tsc step: copies HTML and PDF fixtures into dist/
tests/                  Vitest smoke suite (40 tests)
```

## SDK Coverage

This app uses `@signnow/api-client` v3.2+, which ships TypeScript declarations and Promise-based request/response classes under per-module subpaths (`@signnow/api-client/api/template`, `/api/embeddedSending`, etc.). Every controller imports the request classes it needs and dispatches via `client.send<ResponseType>(request)`.

### Known SDK v3.2.0 defects

The published v3.2.0 `package.json` has typos (`"imoport"`, `"impoort"` instead of `"import"`) in the ESM `exports` conditions for three subpaths: `api/embeddedInvite`, `api/embeddedEditor`, `api/embeddedGroupInvite`. Controllers that use classes from those modules use a `createRequire` workaround to load via the `"require"` condition — see `samples/EmbeddedSignerConsentForm/IndexController.ts` for the pattern.

The v3.2.0 type declaration for `DocumentInvitePostResponse` incorrectly maps `data[]` items to `{ link: string }`; the server actually returns `{ id, email, role_id, ... }`. Affected controllers correct this with a local `DocumentInvitePostResponseFixed` type.

`DocumentGroupRecipientsPutRequest` is not wrapped by v3.2.0 (only `Get` is exported). Controllers that need to update DG recipients (e.g., some DG Sender samples) skip this step and let the embedded editor UI handle it. Documented in affected controllers.

## Routing

| Method | Path | Handler |
|---|---|---|
| GET | `/` | 404 error page |
| GET | `/samples` | HTML list of samples |
| GET | `/api/samples` | `{ samples: string[] }` |
| GET | `/samples/:name` | Dispatch to `samples/<name>/IndexController.handleGet` |
| POST | `/api/samples/:name` | Dispatch to `samples/<name>/IndexController.handlePost` |
| GET | `/css/*`, `/js/*`, `/img/*`, `/fonts/*`, `/assets/*` | Shared static files |

Sample names must match `^[a-zA-Z0-9_]+$`. Anything else → 404. Sample discovery is by convention: any folder under `samples/` whose `IndexController.ts` exports a class implementing `SampleController` is loaded at boot by `sampleRegistry.ts`.

## Add a New Sample

1. `mkdir samples/MyNewSample`
2. Create `samples/MyNewSample/IndexController.ts`:
   ```ts
   import type { Request, Response } from "express";
   import type { SampleController } from "../../src/sampleInterface.js";

   export class IndexController implements SampleController {
     async handleGet(req: Request, res: Response) {
       /* ... */
     }
     async handlePost(req: Request, res: Response) {
       /* ... */
     }
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
- 3 settings defaults/overrides
- 6 routing layer (name regex, dispatch, 404 responses)
- 24 registry (3 unit + 1 list of all samples + 20 per-sample module loads)
- 7 HTTP integration (root, unknown, invalid name, static CSS/img)

Tests are smoke-level only: they confirm the Express app starts, routes dispatch to each sample's controller, and 404 pages render correctly. They do NOT exercise real SignNow API calls (those require live credentials).

Additional helper scripts:

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint over src/, tests/, samples/
```

## Tech Stack

- Node.js 20 LTS, TypeScript 5, ESM
- Express 5
- `@signnow/api-client` 3.2.0+ (from npm)
- `dotenv` + `zod` for `.env` loading and validation
- `tsx` (dev), `tsc` (build), `scripts/copy-html.mjs` (post-build fixture copy)
- Vitest + supertest (tests)
- Docker: multi-stage `node:20-slim`

## License

See repository root.
