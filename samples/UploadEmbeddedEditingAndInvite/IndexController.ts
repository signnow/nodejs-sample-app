import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { writeFileSync, unlinkSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Request, Response } from "express";

import type { SampleController } from "../../src/sampleInterface.js";
import { getClient } from "../../src/sdk/sdkClient.js";
import { settings } from "../../src/settings.js";

import {
  DocumentGetRequest,
  DocumentDownloadGetRequest,
  DocumentPostRequest,
  type DocumentGetResponse,
  type DocumentPostResponse,
} from "@signnow/api-client/api/document";
import {
  SendInvitePostRequest,
  type ToRequestAttribute,
} from "@signnow/api-client/api/documentInvite";

// SDK v3.2.0 defect: "imoport" typo for embeddedEditor.
// Runtime class must be loaded via createRequire to use the "require" condition.
import type {
  DocumentEmbeddedEditorLinkPostResponse,
} from "@signnow/api-client/api/embeddedEditor";

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
const embeddedEditor = require(
  "@signnow/api-client/api/embeddedEditor",
) as {
  DocumentEmbeddedEditorLinkPostRequest: new (
    documentId: string,
    redirectUri?: string,
    redirectTarget?: string,
    linkExpiration?: number,
  ) => SdkRequest;
};
const { DocumentEmbeddedEditorLinkPostRequest } = embeddedEditor;

const SAMPLE_NAME = "UploadEmbeddedEditingAndInvite";
const SENDER_EMAIL = "sender@signnow.com";
const HERE = dirname(fileURLToPath(import.meta.url));

export class IndexController implements SampleController {
  async handleGet(_req: Request, res: Response): Promise<void> {
    res.type("html").send(readFileSync(join(HERE, "index.html"), "utf8"));
  }

  async handlePost(req: Request, res: Response): Promise<void> {
    const action = String(req.body?.action ?? "");
    const client = await getClient();

    if (action === "upload_and_create_dg") {
      const upload = (
        req as unknown as {
          files?: {
            document_file?: {
              name: string;
              data: Buffer;
              mimetype: string;
              size: number;
            };
          };
        }
      ).files?.document_file;

      if (!upload) {
        res
          .status(400)
          .json({ success: false, message: "No file uploaded" });
        return;
      }

      const filename = upload.name || "document.pdf";
      if (!filename.toLowerCase().endsWith(".pdf")) {
        res
          .status(400)
          .json({ success: false, message: "Only PDF files are allowed" });
        return;
      }

      const mimeType = upload.mimetype || "";
      if (mimeType && mimeType !== "application/pdf") {
        res
          .status(400)
          .json({ success: false, message: "Invalid PDF file format" });
        return;
      }

      const fileData: Buffer = upload.data;
      if (fileData.length > 50 * 1024 * 1024) {
        res.status(400).json({
          success: false,
          message: "File size too large. Maximum 50MB allowed",
        });
        return;
      }

      const tmpPath = join(tmpdir(), `sn-upload-${Date.now()}.pdf`);
      writeFileSync(tmpPath, fileData);

      let documentId: string;
      try {
        const uploadResp = await client.send<DocumentPostResponse>(
          new DocumentPostRequest(tmpPath, filename),
        );
        documentId = uploadResp.id;
      } finally {
        try {
          unlinkSync(tmpPath);
        } catch {
          // ignore cleanup errors
        }
      }

      res.json({
        success: true,
        message: "Document uploaded successfully",
        document_id: documentId,
      });
      return;
    }

    if (action === "create_embedded_edit") {
      const documentId = String(req.body?.document_id ?? "");
      if (!documentId) {
        res
          .status(400)
          .json({ success: false, message: "Document ID is required" });
        return;
      }

      const redirectUrl =
        `${settings.APP_BASE_URL}/samples/${SAMPLE_NAME}` +
        `?page=invite-page&document_id=${encodeURIComponent(documentId)}`;

      const editLinkResp =
        await client.send<DocumentEmbeddedEditorLinkPostResponse>(
          new DocumentEmbeddedEditorLinkPostRequest(
            documentId,
            redirectUrl,
            "self",
            15,
          ),
        );
      const editLink = (
        editLinkResp as unknown as { data: { url?: string } }
      ).data?.url ?? null;

      res.json({ success: true, edit_link: editLink });
      return;
    }

    if (action === "create_invite") {
      const documentId = String(req.body?.document_id ?? "");
      const signerEmail = String(req.body?.signer_email ?? "");
      const signerName = String(req.body?.signer_name ?? "");

      if (!documentId || !signerEmail || !signerName) {
        res.status(400).json({
          success: false,
          message: "Document ID, signer email and name are required",
        });
        return;
      }

      const docResp = await client.send<DocumentGetResponse>(
        new DocumentGetRequest(documentId),
      );
      const recipients = this.extractRecipientsFromDoc(docResp);
      const redirectUri =
        `${settings.APP_BASE_URL}/samples/${SAMPLE_NAME}` +
        `?page=status-page&document_id=${documentId}`;

      const toList: ToRequestAttribute[] = (docResp.roles ?? []).map(
        (role) => {
          const roleId = role.unique_id;
          const roleName = role.name;
          const signingOrder = Number(
            (role as unknown as { signing_order?: string | number })
              .signing_order ?? 1,
          );
          const matched = recipients.find((r) => r.role_id === roleId);
          const emailToUse = matched?.email ?? signerEmail;
          const nameToUse = matched?.role ?? signerName;
          return {
            email: emailToUse,
            role_id: roleId,
            role: roleName,
            order: signingOrder,
            subject: "Document Signing Request - Action Required",
            message: `Dear ${nameToUse}, please review and sign the uploaded document.`,
            redirect_uri: redirectUri,
          };
        },
      );

      await client.send(
        new SendInvitePostRequest(
          documentId,
          toList,
          SENDER_EMAIL,
          "Document Signing Request - Action Required",
          `Dear ${signerName}, please review and sign the uploaded document.`,
        ),
      );

      res.json({ success: true, message: "Invite sent successfully" });
      return;
    }

    if (action === "invite-status") {
      const documentId = String(req.body?.document_id ?? "");
      const docResp = await client.send<DocumentGetResponse>(
        new DocumentGetRequest(documentId),
      );

      const fieldInvites = (
        docResp as unknown as {
          field_invites?: Array<{
            email?: string;
            updated?: string | number;
            status?: string;
          }>;
        }
      ).field_invites ?? [];

      const statuses = fieldInvites.map((invite) => {
        let timestamp = "";
        if (invite.updated) {
          try {
            const ts = Number(invite.updated);
            if (!isNaN(ts)) {
              timestamp = new Date(ts * 1000)
                .toISOString()
                .replace("T", " ")
                .slice(0, 19);
            }
          } catch {
            // ignore
          }
        }
        return {
          name: invite.email ?? "",
          timestamp,
          status: invite.status ?? "",
        };
      });

      res.json(statuses);
      return;
    }

    if (action === "download-document") {
      const documentId = String(req.body?.document_id ?? "");
      const filePath = await client.send<string>(
        new DocumentDownloadGetRequest(documentId).withType("collapsed"),
      );
      res.download(filePath, "final_document.pdf");
      return;
    }

    if (action === "get-recipients") {
      const documentId = String(req.body?.document_id ?? "");
      if (!documentId) {
        res
          .status(400)
          .json({ success: false, message: "Document ID is required" });
        return;
      }
      const docResp = await client.send<DocumentGetResponse>(
        new DocumentGetRequest(documentId),
      );
      const recipients = this.extractRecipientsFromDoc(docResp);
      res.json({ success: true, recipients });
      return;
    }

    if (action === "add-recipient") {
      const documentId = String(req.body?.document_id ?? "");
      const recipientName = String(req.body?.recipient_name ?? "");
      const recipientEmail = String(req.body?.recipient_email ?? "");
      const recipientRole = String(req.body?.recipient_role ?? "");

      if (!documentId || !recipientName || !recipientEmail || !recipientRole) {
        res
          .status(400)
          .json({ success: false, message: "All fields are required" });
        return;
      }

      const docResp = await client.send<DocumentGetResponse>(
        new DocumentGetRequest(documentId),
      );
      const targetRole = (docResp.roles ?? []).find(
        (r) => r.name === recipientRole,
      );
      if (!targetRole) {
        const available = (docResp.roles ?? [])
          .map((r) => r.name)
          .join(", ");
        res.status(400).json({
          success: false,
          message: `Role '${recipientRole}' not found in document. Available roles: ${available}`,
        });
        return;
      }

      const redirectUri =
        `${settings.APP_BASE_URL}/samples/${SAMPLE_NAME}` +
        `?page=status-page&document_id=${documentId}`;
      const toList: ToRequestAttribute[] = [
        {
          email: recipientEmail,
          role_id: targetRole.unique_id,
          role: targetRole.name,
          order: Number(
            (
              targetRole as unknown as { signing_order?: string | number }
            ).signing_order ?? 1,
          ),
          subject: "Document Signing Request - Action Required",
          message: `Dear ${recipientName}, please review and sign the uploaded document.`,
          redirect_uri: redirectUri,
        },
      ];

      await client.send(
        new SendInvitePostRequest(
          documentId,
          toList,
          SENDER_EMAIL,
          "Document Signing Request - Action Required",
          `Dear ${recipientName}, please review and sign the uploaded document.`,
        ),
      );

      res.json({
        success: true,
        message: "Recipient added and invite sent successfully",
      });
      return;
    }

    if (action === "get-document-roles") {
      const documentId = String(req.body?.document_id ?? "");
      if (!documentId) {
        res
          .status(400)
          .json({ success: false, message: "Document ID is required" });
        return;
      }
      const docResp = await client.send<DocumentGetResponse>(
        new DocumentGetRequest(documentId),
      );
      const rolesData = (docResp.roles ?? []).map((r) => ({
        name: r.name,
        unique_id: r.unique_id,
        signing_order: (r as unknown as { signing_order?: string | number })
          .signing_order,
      }));
      res.json({ success: true, roles: rolesData });
      return;
    }

    res
      .status(400)
      .json({ success: false, message: "Invalid action" });
  }

  // --- helpers ---

  private extractRecipientsFromDoc(
    docResp: DocumentGetResponse,
  ): Array<{
    email: string | null;
    role: string | null;
    role_id: string | null;
    signing_order: unknown;
    inviter_role: unknown;
  }> {
    const recipients: Array<{
      email: string | null;
      role: string | null;
      role_id: string | null;
      signing_order: unknown;
      inviter_role: unknown;
    }> = [];

    const routingDetails =
      (
        docResp as unknown as { routing_details?: unknown[] }
      ).routing_details ?? [];

    for (const routingDetail of routingDetails) {
      const dataCollection: unknown[] =
        (
          typeof routingDetail === "object" && routingDetail !== null
            ? (routingDetail as { data?: unknown[] }).data
            : null
        ) ?? [];

      for (const data of dataCollection) {
        if (typeof data === "object" && data !== null) {
          const d = data as Record<string, unknown>;
          recipients.push({
            email: (d.default_email as string | null) ?? null,
            role: (d.name as string | null) ?? null,
            role_id: (d.role_id as string | null) ?? null,
            signing_order: d.signing_order ?? null,
            inviter_role: d.inviter_role ?? null,
          });
        }
      }
    }
    return recipients;
  }
}
