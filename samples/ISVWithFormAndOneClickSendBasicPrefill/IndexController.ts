import type { Request, Response } from "express";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { SampleController } from "../../src/sampleInterface.js";
import { getClient } from "../../src/sdk/sdkClient.js";
import { settings } from "../../src/settings.js";

import {
  DocumentGetRequest,
  DocumentDownloadGetRequest,
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
  GroupInvitePostRequest,
  GroupInviteGetRequest,
  type GroupInviteGetResponse,
  type InviteStepRequestAttribute,
  type InviteStepInviteActionRequestAttribute,
  type InviteStepInviteEmailRequestAttribute,
} from "@signnow/api-client/api/documentGroupInvite";
import {
  DocumentGroupTemplatePostRequest,
  type DocumentGroupTemplatePostResponse,
} from "@signnow/api-client/api/documentGroupTemplate";

const DOCUMENT_GROUP_TEMPLATE_ID = "6e79b9e6f9624984a7f054a7171d1644d0fb9934";
const SAMPLE_NAME = "ISVWithFormAndOneClickSendBasicPrefill";
const NAME_FIELD = "Name";
const EMAIL_FIELD = "Email";
const HERE = dirname(fileURLToPath(import.meta.url));

export class IndexController implements SampleController {
  async handleGet(_req: Request, res: Response): Promise<void> {
    res.type("html").send(readFileSync(join(HERE, "index.html"), "utf8"));
  }

  async handlePost(req: Request, res: Response): Promise<void> {
    const action = String(req.body?.action ?? "");
    const client = await getClient();

    if (action === "prepare_dg") {
      const name = String(req.body?.name ?? "");
      const email = String(req.body?.email ?? "");

      if (!name || !email) {
        res
          .status(400)
          .json({ success: false, message: "Name and email are required" });
        return;
      }

      // 1. Create document group from template
      const dgResp =
        await client.send<DocumentGroupTemplatePostResponse>(
          new DocumentGroupTemplatePostRequest(
            DOCUMENT_GROUP_TEMPLATE_ID,
            "ISV Form Document Group",
          ),
        );
      const dgId = dgResp.data.unique_id;

      // 2. Prefill fields in each document of the group
      const dg = await client.send<DocumentGroupGetResponse>(
        new DocumentGroupGetRequest(dgId),
      );
      for (const doc of dg.documents ?? []) {
        const docData = await client.send<DocumentGetResponse>(
          new DocumentGetRequest(doc.id),
        );
        const fieldNames = this.extractFieldNames(docData);

        const fields: FieldRequestAttribute[] = [];
        if (fieldNames.includes(NAME_FIELD)) {
          fields.push({ field_name: NAME_FIELD, prefilled_text: name });
        }
        if (fieldNames.includes(EMAIL_FIELD)) {
          fields.push({ field_name: EMAIL_FIELD, prefilled_text: email });
        }

        if (fields.length > 0) {
          await client.send(new DocumentPrefillPutRequest(doc.id, fields));
        }
      }

      // 3. Send group invite
      const dg2 = await client.send<DocumentGroupGetResponse>(
        new DocumentGroupGetRequest(dgId),
      );
      const redirectBase =
        `${settings.APP_BASE_URL}/samples/${SAMPLE_NAME}`;
      const inviteActions: InviteStepInviteActionRequestAttribute[] = (
        dg2.documents ?? []
      ).map((doc) => ({
        email: email,
        role_name: "Recipient 1",
        action: "sign",
        document_id: doc.id,
        redirect_uri: `${redirectBase}?page=status-page&document_group_id=${dgId}`,
        redirect_target: "self",
      }));

      const inviteEmails: InviteStepInviteEmailRequestAttribute[] = [
        {
          email: email,
          subject: "Review and sign documents",
          message: "Please review and sign the documents",
          expiration_days: 30,
          reminder: 10,
        },
      ];

      const inviteSteps: InviteStepRequestAttribute[] = [
        {
          order: 1,
          invite_actions: inviteActions,
          invite_emails: inviteEmails,
        },
      ];

      await client.send(
        new GroupInvitePostRequest(dgId, inviteSteps, [], [], [], true, 100),
      );

      res.json({ success: true, document_group_id: dgId });
      return;
    }

    if (action === "invite-status") {
      const dgId = String(req.body?.document_group_id ?? "");
      if (!dgId) {
        res
          .status(400)
          .json({ success: false, message: "document_group_id is required" });
        return;
      }

      const recipientsResp =
        await client.send<DocumentGroupRecipientsGetResponse>(
          new DocumentGroupRecipientsGetRequest(dgId),
        );
      const dg = await client.send<DocumentGroupGetResponse>(
        new DocumentGroupGetRequest(dgId),
      );
      const inviteId = dg.invite_id ?? null;

      if (!inviteId) {
        const signers = (recipientsResp.data.recipients ?? []).map((r) => ({
          name: r.name,
          email: r.email,
          status: "not_invited",
          order: r.order,
          timestamp: null,
        }));
        res.json(signers);
        return;
      }

      const inviteResp = await client.send<GroupInviteGetResponse>(
        new GroupInviteGetRequest(dgId, inviteId),
      );
      const statuses: Record<string, string> = {};
      for (const step of inviteResp.invite.steps ?? []) {
        for (const act of step.actions ?? []) {
          statuses[act.role_name] = act.status;
        }
      }

      const signers = (recipientsResp.data.recipients ?? []).map((r) => ({
        name: r.name,
        email: r.email,
        status: statuses[r.name] ?? "unknown",
        order: r.order,
        timestamp: null,
      }));
      res.json(signers);
      return;
    }

    if (action === "download-doc-group") {
      const dgId = String(req.body?.document_group_id ?? "");
      if (!dgId) {
        res
          .status(400)
          .json({ success: false, message: "Document group ID is required" });
        return;
      }

      const filePath = await client.send<string>(
        new DownloadDocumentGroupPostRequest(dgId, "merged", "no"),
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

  private extractFieldNames(doc: DocumentGetResponse): string[] {
    const names: string[] = [];
    for (const field of doc.fields ?? []) {
      const name = field.json_attributes?.name;
      if (name != null) {
        names.push(name);
      }
    }
    return names;
  }
}
