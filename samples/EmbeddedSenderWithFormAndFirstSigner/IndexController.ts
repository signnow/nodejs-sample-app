import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Request, Response } from "express";

import type { SampleController } from "../../src/sampleInterface.js";
import { getClient } from "../../src/sdk/sdkClient.js";
import { settings } from "../../src/settings.js";

import {
  DocumentGetRequest,
  type DocumentGetResponse,
} from "@signnow/api-client/api/document";
import {
  DocumentPrefillPutRequest,
  type FieldRequestAttribute,
} from "@signnow/api-client/api/documentField";
import {
  DocumentGroupGetRequest,
  DocumentGroupRecipientsGetRequest,
  DownloadDocumentGroupPostRequest,
  type DocumentGroupGetResponse,
  type DocumentGroupRecipientsGetResponse,
} from "@signnow/api-client/api/documentGroup";
import {
  GroupInviteGetRequest,
  type GroupInviteGetResponse,
} from "@signnow/api-client/api/documentGroupInvite";
import {
  DocumentGroupTemplatePostRequest,
  type DocumentGroupTemplatePostResponse,
} from "@signnow/api-client/api/documentGroupTemplate";
import {
  DocumentGroupEmbeddedSendingLinkPostRequest,
  type DocumentGroupEmbeddedSendingLinkPostResponse,
} from "@signnow/api-client/api/embeddedSending";
import {
  TokenPostRequest,
  type TokenPostResponse,
} from "@signnow/api-client/api/auth";

// NOTE: DocumentGroupRecipientsPutRequest does NOT exist in Node SDK v3.2.0.
// The _update_document_group_recipients step from Python is documented below but cannot be executed.
// Recipients remain as template defaults; embedded sender UI handles assignment.

const DOCUMENT_GROUP_TEMPLATE_ID = "8e36720a436041ea837dc543ec00a3bc3559df45";
const CUSTOMER_NAME_FIELD = "CustomerName";
const CUSTOMER_FN_FIELD = "CustomerFN";
const PREPARE_CONTRACT_ROLE = "Prepare Contract";
const CUSTOMER_SIGN_ROLE = "Customer to Sign";
const SAMPLE_NAME = "EmbeddedSenderWithFormAndFirstSigner";
const SIGNING_URL_BASE = "https://app.signnow.com/webapp/documentgroup/signing";
const HERE = dirname(fileURLToPath(import.meta.url));

type Recipients = Array<{
  name?: string;
  email?: string | null;
  order?: number;
  documents?: Array<{ id?: string; role?: string; action?: string }>;
}>;

export class IndexController implements SampleController {
  async handleGet(req: Request, res: Response): Promise<void> {
    let html = readFileSync(join(HERE, "index.html"), "utf8");
    const page = req.query["page"];
    if (page && typeof page === "string") {
      html = html.replace(
        "<!-- DEMO_PAGE_CONTENT -->",
        `<div class='demo-note'>Showing demo page: ${page}</div>`,
      );
    }
    res.type("text/html").send(html);
  }

  async handlePost(req: Request, res: Response): Promise<void> {
    const action = String(req.body?.action ?? "");
    const client = await getClient();

    if (action === "prepare_dg") {
      const name = String(req.body?.name ?? "");
      const email = String(req.body?.email ?? "");

      if (!name || !email) {
        res.status(400).json({
          success: false,
          message: "Name and email are required",
        });
        return;
      }

      // 1. Create document group from template
      const dgResp = await client.send<DocumentGroupTemplatePostResponse>(
        new DocumentGroupTemplatePostRequest(
          DOCUMENT_GROUP_TEMPLATE_ID,
          "Embedded Sender Form Document Group",
        ),
      );
      const dgId = dgResp.data.unique_id;

      // 2. Prefill fields in each document
      await this.updateDocumentFields(client, dgId, name);

      // NOTE: DocumentGroupRecipientsPutRequest not available in SDK v3.2.0.
      // Python: _update_document_group_recipients would set preparer_email=USER_EMAIL,
      //         customer_email=email. Skipped — embedded sender UI handles this.

      // 3. Create embedded sending link (sender acts as first signer)
      const redirectUrl =
        `${settings.APP_BASE_URL}/samples/${SAMPLE_NAME}` +
        `?page=signing-page&document_group_id=${dgId}`;
      const linkResp =
        await client.send<DocumentGroupEmbeddedSendingLinkPostResponse>(
          new DocumentGroupEmbeddedSendingLinkPostRequest(
            dgId,
            redirectUrl,
            15,
            "self",
            "send-invite",
          ),
        );

      res.json({
        success: true,
        message:
          "Document group prepared and embedded sending link created successfully",
        embedded_url: linkResp.data.url,
      });
      return;
    }

    if (action === "create_signing_url") {
      const dgId = String(req.body?.document_group_id ?? "");
      const signingUrl = await this.createSigningLink(client, dgId);
      res.json({ success: true, signing_url: signingUrl });
      return;
    }

    if (action === "invite-status") {
      const dgId = String(req.body?.document_group_id ?? "");
      const signers = await this.getDocumentGroupSignersStatus(client, dgId);
      res.json(signers);
      return;
    }

    if (action === "download-doc-group") {
      const dgId = String(req.body?.document_group_id ?? "");
      if (!dgId) {
        res.status(400).json({ success: false, message: "Document group ID is required" });
        return;
      }
      const filePath = await client.send<string>(
        new DownloadDocumentGroupPostRequest(dgId, "merged", "no", []),
      );
      res.download(filePath, basename(filePath));
      return;
    }

    res.status(400).json({
      success: false,
      message: `Invalid action: ${action}`,
      available_actions: [
        "prepare_dg",
        "create_signing_url",
        "invite-status",
        "download-doc-group",
      ],
    });
  }

  // --- helpers ---

  private async updateDocumentFields(
    client: Awaited<ReturnType<typeof getClient>>,
    dgId: string,
    name: string,
  ): Promise<void> {
    const dg = await client.send<DocumentGroupGetResponse>(
      new DocumentGroupGetRequest(dgId),
    );
    for (const docEntry of dg.documents ?? []) {
      const docId = (docEntry as { id: string }).id;
      const doc = await client.send<DocumentGetResponse>(
        new DocumentGetRequest(docId),
      );
      const existingFields = this.extractFieldNames(doc);

      const fields: FieldRequestAttribute[] = [];
      if (existingFields.includes(CUSTOMER_NAME_FIELD)) {
        fields.push({ field_name: CUSTOMER_NAME_FIELD, prefilled_text: name });
      } else if (existingFields.includes(CUSTOMER_FN_FIELD)) {
        fields.push({ field_name: CUSTOMER_FN_FIELD, prefilled_text: name });
      }
      if (fields.length > 0) {
        await client.send(new DocumentPrefillPutRequest(docId, fields));
      }
    }
  }

  private extractFieldNames(doc: DocumentGetResponse): string[] {
    const names: string[] = [];
    for (const field of doc.fields ?? []) {
      const n = field.json_attributes?.name;
      if (n != null) names.push(n);
    }
    return names;
  }

  private async createSigningLink(
    client: Awaited<ReturnType<typeof getClient>>,
    dgId: string,
  ): Promise<string> {
    const accessToken = await this.generateLimitedToken(client, dgId);
    const redirectUrl =
      `${settings.APP_BASE_URL}/samples/${SAMPLE_NAME}` +
      `?page=status-page&document_group_id=${dgId}`;
    const encodedRedirect = encodeURIComponent(redirectUrl);
    return (
      `${SIGNING_URL_BASE}` +
      `?document_group_id=${dgId}` +
      `&access_token=${accessToken}` +
      `&sign=1` +
      `&embedded=1` +
      `&redirect_uri=${encodedRedirect}`
    );
  }

  private async generateLimitedToken(
    client: Awaited<ReturnType<typeof getClient>>,
    dgId: string,
  ): Promise<string> {
    const scope = `limited_signer_scope_token_for_document_group_invite/${dgId}`;
    const resp = await client.send<TokenPostResponse>(
      new TokenPostRequest(
        settings.SIGNNOW_API_USERNAME,
        settings.SIGNNOW_API_PASSWORD,
        "password",
        scope,
      ),
    );
    return (resp as unknown as { access_token: string }).access_token ?? "";
  }

  private async getDocumentGroupSignersStatus(
    client: Awaited<ReturnType<typeof getClient>>,
    dgId: string,
  ): Promise<
    Array<{
      name?: string;
      email?: string | null;
      status: string;
      order?: number;
      timestamp: null;
    }>
  > {
    const recipientsResp =
      await client.send<DocumentGroupRecipientsGetResponse>(
        new DocumentGroupRecipientsGetRequest(dgId),
      );
    const recipients: Recipients =
      (
        recipientsResp as unknown as { data: { recipients: Recipients } }
      ).data.recipients ?? [];

    const dg = await client.send<DocumentGroupGetResponse>(
      new DocumentGroupGetRequest(dgId),
    );
    const inviteId = dg.invite_id ?? null;

    if (!inviteId) {
      return recipients.map((r) => ({
        name: r.name,
        email: r.email,
        status: "not_invited",
        order: r.order,
        timestamp: null,
      }));
    }

    const statusResp = await client.send<GroupInviteGetResponse>(
      new GroupInviteGetRequest(dgId, inviteId),
    );

    const invite =
      (
        statusResp as unknown as {
          invite?: {
            steps?: Array<{
              actions?: Array<{ role_name: string; status: string }>;
            }>;
          };
        }
      ).invite ?? {};
    const statuses: Record<string, string> = {};
    for (const step of invite.steps ?? []) {
      for (const a of step.actions ?? []) {
        statuses[a.role_name] = a.status;
      }
    }

    return recipients.map((r) => ({
      name: r.name,
      email: r.email,
      status: r.name ? (statuses[r.name] ?? "unknown") : "unknown",
      order: r.order,
      timestamp: null,
    }));
  }
}
