import type { Request, Response } from "express";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
import {
  DocumentEmbeddedSendingLinkPostRequest,
  type DocumentEmbeddedSendingLinkPostResponse,
} from "@signnow/api-client/api/embeddedSending";

const TEMPLATE_ID = "de45a9a2a6014c2c8ac0a4d9057b17a2108e77e7";
const SAMPLE_NAME = "EmbeddedSenderWithFormCreditLoanAgreement";
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

      // 1. Clone template -> new document
      const cloneResp = await client.send<CloneTemplatePostResponse>(
        new CloneTemplatePostRequest(TEMPLATE_ID),
      );
      const documentId = cloneResp.id;

      // 2. Prefill fields
      const fields: FieldRequestAttribute[] = [
        { field_name: "Name", prefilled_text: fullName },
      ];
      await client.send(new DocumentPrefillPutRequest(documentId, fields));

      // 3. Create embedded sending link
      const redirectUrl =
        `${settings.APP_BASE_URL}/samples/${SAMPLE_NAME}` +
        `?page=download-with-status&document_id=${documentId}`;
      const linkResp =
        await client.send<DocumentEmbeddedSendingLinkPostResponse>(
          new DocumentEmbeddedSendingLinkPostRequest(
            documentId,
            "invite",
            redirectUrl,
            16,
            "self",
          ),
        );

      res.json({ link: linkResp.data.url });
      return;
    }

    if (action === "invite-status") {
      const documentId = String(req.body?.document_id ?? "");
      if (!documentId) {
        res.status(400).json({ error: "Missing document_id" });
        return;
      }

      const doc = await client.send<DocumentGetResponse>(
        new DocumentGetRequest(documentId),
      );
      const statuses = (doc.field_invites ?? []).map((inv) => ({
        name: inv.email,
        status: inv.status,
      }));
      res.json(statuses);
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
