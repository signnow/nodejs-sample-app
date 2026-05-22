import type { Request, Response } from "express";
import { basename, dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
  type DocumentGroupGetResponse,
  DocumentGroupRecipientsGetRequest,
  type DocumentGroupRecipientsGetResponse,
  DownloadDocumentGroupPostRequest,
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

const SAMPLE_NAME = "EmbeddedSenderWithFormDG";
const DOCUMENT_GROUP_TEMPLATE_ID = "c8040bbc40804b89b63a0fa8c79b42a7ae4818c1";
const GROUP_NAME = "ISV Form Document Group";
const HERE = dirname(fileURLToPath(import.meta.url));

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

      // 1. Clone DG template
      const templateResp =
        await client.send<DocumentGroupTemplatePostResponse>(
          new DocumentGroupTemplatePostRequest(
            DOCUMENT_GROUP_TEMPLATE_ID,
            GROUP_NAME,
          ),
        );
      const dgId = templateResp.data.unique_id;

      // 2. Prefill fields in each document
      const dg = await client.send<DocumentGroupGetResponse>(
        new DocumentGroupGetRequest(dgId),
      );
      for (const docEntry of dg.documents ?? []) {
        const docId = (docEntry as { id: string }).id;
        const doc = await client.send<DocumentGetResponse>(
          new DocumentGetRequest(docId),
        );
        const fieldsToSet: FieldRequestAttribute[] = [];
        for (const field of doc.fields ?? []) {
          const fieldName = field.json_attributes?.name;
          if (fieldName === "Name") {
            fieldsToSet.push({ field_name: "Name", prefilled_text: name });
          }
        }
        if (fieldsToSet.length > 0) {
          await client.send(
            new DocumentPrefillPutRequest(docId, fieldsToSet),
          );
        }
      }

      // 3. Create embedded sending link
      const redirectUrl =
        `${settings.APP_BASE_URL}/samples/${SAMPLE_NAME}` +
        `?page=status-page&document_group_id=${dgId}`;
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

    if (action === "invite-status") {
      const dgId = String(req.body?.document_group_id ?? "");
      if (!dgId) {
        res.status(400).json({ error: "Missing document_group_id" });
        return;
      }

      const recipientsResp =
        await client.send<DocumentGroupRecipientsGetResponse>(
          new DocumentGroupRecipientsGetRequest(dgId),
        );
      const dg = await client.send<DocumentGroupGetResponse>(
        new DocumentGroupGetRequest(dgId),
      );
      const inviteId = dg.invite_id;

      type Recipient = { name?: string; email?: string | null; order?: number };
      const recipients =
        (recipientsResp as { data: { recipients: Recipient[] } }).data
          .recipients ?? [];

      if (!inviteId) {
        res.json(
          recipients.map((r) => ({
            name: r.name,
            email: r.email,
            status: "not_invited",
            order: r.order,
            timestamp: null as string | null,
          })),
        );
        return;
      }

      const statusResp = await client.send<GroupInviteGetResponse>(
        new GroupInviteGetRequest(dgId, inviteId),
      );

      const invite =
        (statusResp as {
          invite?: {
            steps?: Array<{
              actions?: Array<{ role_name: string; status: string }>;
            }>;
          };
        }).invite ?? {};
      const roleStatus: Record<string, string> = {};
      for (const step of invite.steps ?? []) {
        for (const a of step.actions ?? []) {
          roleStatus[a.role_name] = a.status;
        }
      }

      res.json(
        recipients.map((r) => ({
          name: r.name,
          email: r.email,
          status: r.name ? roleStatus[r.name] ?? "unknown" : "unknown",
          order: r.order,
          timestamp: null as string | null,
        })),
      );
      return;
    }

    if (action === "download-doc-group") {
      const dgId = String(req.body?.document_group_id ?? "");
      if (!dgId) {
        res.status(400).json({ error: "Missing document_group_id" });
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
      available_actions: ["prepare_dg", "invite-status", "download-doc-group"],
    });
  }
}
