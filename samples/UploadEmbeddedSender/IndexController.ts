import type { Request, Response } from "express";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { SampleController } from "../../src/sampleInterface.js";
import { getClient } from "../../src/sdk/sdkClient.js";
import { settings } from "../../src/settings.js";

import {
  DocumentPostRequest,
  type DocumentPostResponse,
} from "@signnow/api-client/api/document";
import {
  DocumentGroupGetRequest,
  type DocumentGroupGetResponse,
  DocumentGroupPostRequest,
  type DocumentGroupPostResponse,
  DocumentGroupRecipientsGetRequest,
  type DocumentGroupRecipientsGetResponse,
  DownloadDocumentGroupPostRequest,
} from "@signnow/api-client/api/documentGroup";
import {
  GroupInviteGetRequest,
  type GroupInviteGetResponse,
} from "@signnow/api-client/api/documentGroupInvite";
import {
  DocumentGroupEmbeddedSendingLinkPostRequest,
  type DocumentGroupEmbeddedSendingLinkPostResponse,
} from "@signnow/api-client/api/embeddedSending";

const SAMPLE_NAME = "UploadEmbeddedSender";
const PDF_FILE_NAME = "Sales Proposal.pdf";
const HERE = dirname(fileURLToPath(import.meta.url));

export class IndexController implements SampleController {
  async handleGet(_req: Request, res: Response): Promise<void> {
    // This sample's entry point is the HTML page — the upload happens via
    // the "Upload" button, which POSTs action=upload_and_create_dg.
    res.sendFile(join(HERE, "index.html"));
  }

  async handlePost(req: Request, res: Response): Promise<void> {
    const action = String(req.body?.action ?? "");
    const client = await getClient();

    if (action === "upload_and_create_dg") {
      const uploadResp = await client.send<DocumentPostResponse>(
        new DocumentPostRequest(join(HERE, PDF_FILE_NAME), "Sales Proposal"),
      );
      const documentId = uploadResp.id;

      const dgResp = await client.send<DocumentGroupPostResponse>(
        new DocumentGroupPostRequest([documentId], "Uploaded Document Group"),
      );
      const dgId = dgResp.id;

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
            "edit",
          ),
        );

      res.json({
        success: true,
        message:
          "Document uploaded and embedded sending link created successfully",
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

      type Recipient = { name?: string; email?: string; order?: number };
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

    res.status(400).json({ success: false, message: "Invalid action" });
  }
}
