import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Request, Response } from "express";

import type { SampleController } from "../../src/sampleInterface.js";
import { getClient } from "../../src/sdk/sdkClient.js";
import { settings } from "../../src/settings.js";

import {
  CloneTemplatePostRequest,
  type CloneTemplatePostResponse,
} from "@signnow/api-client/api/template";
import {
  DocumentDownloadGetRequest,
  DocumentGetRequest,
  type DocumentGetResponse,
} from "@signnow/api-client/api/document";
import {
  DocumentPrefillPutRequest,
  type FieldRequestAttribute,
} from "@signnow/api-client/api/documentField";

// SDK v3.2.0 defect: "impoort" typo in package.json exports for embeddedInvite.
// Import response types (type-only) still resolve via "types" condition — no defect there.
// Runtime classes must be loaded via createRequire to use the "require" condition.
import type {
  DocumentInviteLinkPostResponse,
  InviteRequestAttribute,
} from "@signnow/api-client/api/embeddedInvite";

// Mirror of the SDK's internal BaseClass interface (not publicly exported).
// Used so that our createRequire-constructed instances satisfy client.send()'s
// parameter type without needing to reference the private dist path.
interface SdkRequest {
  getPayload(): Record<string, unknown> | null;
  getMethod(): string;
  getUrl(): string;
  getUriParams(): Record<string, string> | null;
  getQueryParams(): Record<string, string>;
  getAuthMethod(): string;
  getContentType(): string;
}

const require = createRequire(import.meta.url);
const embeddedInvite = require("@signnow/api-client/api/embeddedInvite") as {
  DocumentInvitePostRequest: new (
    documentId: string,
    invites: InviteRequestAttribute[],
    nameFormula?: string,
  ) => SdkRequest;
  DocumentInviteLinkPostRequest: new (
    documentId: string,
    fieldInviteId: string,
    authMethod?: string,
    linkExpiration?: number,
  ) => SdkRequest;
};
const { DocumentInvitePostRequest, DocumentInviteLinkPostRequest } =
  embeddedInvite;

// v3.2.0 ships an incorrect response type for DocumentInvitePost (claims
// `{ data: Array<{ link: string }> }` per-item, but the server returns
// `{ data: Array<{ id, email, role_id, ... }> }`). Local correction:
type InviteCreatedItem = { id: string; email: string; role_id: string };
type DocumentInvitePostResponseFixed = { data: InviteCreatedItem[] };

// ACTION_TEMPLATE_ID is the template cloned for create-embedded-invite.
// (Python also declares TEMPLATE_ID but does not use it in the action flow.)
const ACTION_TEMPLATE_ID = "c78e902aa6834af6ba92e8a6f92b603108e1bbbb";
const SAMPLE_NAME = "MedicalInsuranceClaimForm";
const ROLE_NAME = "Recipient 1";
const HERE = dirname(fileURLToPath(import.meta.url));

export class IndexController implements SampleController {
  async handleGet(_req: Request, res: Response): Promise<void> {
    res.type("html").send(readFileSync(join(HERE, "index.html"), "utf8"));
  }

  async handlePost(req: Request, res: Response): Promise<void> {
    const action = String(req.body?.action ?? "");
    const client = await getClient();

    if (action === "create-embedded-invite") {
      const fullName = String(req.body?.full_name ?? "");
      const email = String(req.body?.email ?? "");

      // 1. Clone ACTION_TEMPLATE_ID -> new document
      const cloneResp = await client.send<CloneTemplatePostResponse>(
        new CloneTemplatePostRequest(ACTION_TEMPLATE_ID),
      );
      const documentId = cloneResp.id;

      // 2. Prefill fields
      const fields: FieldRequestAttribute[] = [];
      if (fullName) {
        fields.push({ field_name: "Name", prefilled_text: fullName });
      }
      if (email) {
        fields.push({ field_name: "Email", prefilled_text: email });
      }
      if (fields.length > 0) {
        await client.send(new DocumentPrefillPutRequest(documentId, fields));
      }

      // 3. Look up the role by name
      const docResp = await client.send<DocumentGetResponse>(
        new DocumentGetRequest(documentId),
      );
      const role = (docResp.roles ?? []).find((r) => r.name === ROLE_NAME);
      if (!role) {
        throw new Error(
          `Role '${ROLE_NAME}' not found on document ${documentId}`,
        );
      }

      // 4. Create the embedded invite (using settings.SN_SIGNER_EMAIL)
      const invite: InviteRequestAttribute = {
        email: settings.SN_SIGNER_EMAIL,
        role_id: role.unique_id,
        order: 1,
        auth_method: "none",
      };
      const inviteResp = await client.send<DocumentInvitePostResponseFixed>(
        new DocumentInvitePostRequest(documentId, [invite]),
      );
      const fieldInviteId = inviteResp.data[0].id;

      // 5. Generate the signing link
      const linkResp = await client.send<DocumentInviteLinkPostResponse>(
        new DocumentInviteLinkPostRequest(documentId, fieldInviteId, "none", 15),
      );

      const redirectUri =
        `${settings.APP_BASE_URL}/samples/${SAMPLE_NAME}` +
        `?page=download-container&document_id=${documentId}`;
      const signingLink =
        `${linkResp.data.link}&redirect_uri=${encodeURIComponent(redirectUri)}`;

      res.json({ link: signingLink });
      return;
    }

    // download-document (default)
    const documentId = String(req.body?.document_id ?? "");
    if (!documentId) {
      res.status(400).json({ error: "Missing document_id" });
      return;
    }

    const filePath = await client.send<string>(
      new DocumentDownloadGetRequest(documentId).withType("collapsed"),
    );
    res.download(filePath, basename(filePath));
  }
}
