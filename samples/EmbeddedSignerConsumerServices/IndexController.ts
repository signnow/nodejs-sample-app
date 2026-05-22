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

const TEMPLATE_ID = "b6797f3437db4c818256560e4f68143cb99c7bc9";
const SAMPLE_NAME = "EmbeddedSignerConsumerServices";
const ROLE_NAME = "Recipient 1";
const HERE = dirname(fileURLToPath(import.meta.url));

export class IndexController implements SampleController {
  async handleGet(req: Request, res: Response): Promise<void> {
    if (req.query.page === "finish") {
      res.type("html").send(readFileSync(join(HERE, "index.html"), "utf8"));
      return;
    }

    const client = await getClient();

    // 1. Clone template -> new document
    const cloneResp = await client.send<CloneTemplatePostResponse>(
      new CloneTemplatePostRequest(TEMPLATE_ID),
    );
    const documentId = cloneResp.id;

    // 2. Look up the role by name
    const docResp = await client.send<DocumentGetResponse>(
      new DocumentGetRequest(documentId),
    );
    const role = (docResp.roles ?? []).find((r) => r.name === ROLE_NAME);
    if (!role) {
      throw new Error(
        `Role '${ROLE_NAME}' not found on document ${documentId}`,
      );
    }

    // 3. Create the embedded invite
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

    // 4. Generate the signing link
    const linkResp = await client.send<DocumentInviteLinkPostResponse>(
      new DocumentInviteLinkPostRequest(documentId, fieldInviteId, "none", 15),
    );

    const redirectUri =
      `${settings.APP_BASE_URL}/samples/${SAMPLE_NAME}` +
      `?page=finish&document_id=${documentId}`;
    const signingLink =
      `${linkResp.data.link}&redirect_uri=${encodeURIComponent(redirectUri)}`;
    res.redirect(302, signingLink);
  }

  async handlePost(req: Request, res: Response): Promise<void> {
    const documentId = String(req.body?.document_id ?? "");
    if (!documentId) {
      res.status(400).json({ error: "Missing document_id" });
      return;
    }

    const client = await getClient();
    const downloadReq = new DocumentDownloadGetRequest(documentId).withType(
      "collapsed",
    );
    // The SDK writes the PDF to disk (under downloadDirectory from the Sdk
    // config) and returns the file path.
    const filePath = await client.send<string>(downloadReq);

    res.download(filePath, basename(filePath));
  }
}
