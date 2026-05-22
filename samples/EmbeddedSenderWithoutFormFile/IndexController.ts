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
  DocumentEmbeddedSendingLinkPostRequest,
  type DocumentEmbeddedSendingLinkPostResponse,
} from "@signnow/api-client/api/embeddedSending";

const TEMPLATE_ID = "76713f00c106425ea8b673c49fd94c0145643c34";
const SAMPLE_NAME = "EmbeddedSenderWithoutFormFile";
const HERE = dirname(fileURLToPath(import.meta.url));

export class IndexController implements SampleController {
  async handleGet(req: Request, res: Response): Promise<void> {
    if (req.query.page === "download-with-status") {
      res.type("html").send(readFileSync(join(HERE, "index.html"), "utf8"));
      return;
    }

    const client = await getClient();

    const cloneResp = await client.send<CloneTemplatePostResponse>(
      new CloneTemplatePostRequest(TEMPLATE_ID),
    );
    const documentId = cloneResp.id;

    const redirectUrl =
      `${settings.APP_BASE_URL}/samples/${SAMPLE_NAME}` +
      `?page=download-with-status&document_id=${documentId}`;
    const linkResp = await client.send<DocumentEmbeddedSendingLinkPostResponse>(
      new DocumentEmbeddedSendingLinkPostRequest(
        documentId,
        "document",
        redirectUrl,
        16,
        "self",
      ),
    );
    res.redirect(302, linkResp.data.url);
  }

  async handlePost(req: Request, res: Response): Promise<void> {
    const documentId = String(req.body?.document_id ?? "");
    if (!documentId) {
      res.status(400).json({ error: "Missing document_id" });
      return;
    }

    const client = await getClient();

    if (req.body?.action === "invite-status") {
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

    const filePath = await client.send<string>(
      new DocumentDownloadGetRequest(documentId).withType("collapsed"),
    );
    res.download(filePath, basename(filePath));
  }
}
