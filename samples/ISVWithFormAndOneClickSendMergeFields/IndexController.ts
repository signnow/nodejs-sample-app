import type { Request, Response } from "express";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { SampleController } from "../../src/sampleInterface.js";
import { getClient } from "../../src/sdk/sdkClient.js";
import { settings } from "../../src/settings.js";

import {
  DocumentGetRequest,
  DocumentPutRequest,
  type DocumentGetResponse,
  type TextRequestAttribute,
} from "@signnow/api-client/api/document";
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

const DOCUMENT_GROUP_TEMPLATE_ID = "8e36720a436041ea837dc543ec00a3bc3559df45";
const SAMPLE_NAME = "ISVWithFormAndOneClickSendMergeFields";
const CUSTOMER_NAME_FIELD = "CustomerName";
const COMPANY_NAME_FIELD = "CompanyName";
const PREPARE_CONTRACT_ROLE = "Prepare Contract";
const USER_EMAIL = "example@example.com";
const HERE = dirname(fileURLToPath(import.meta.url));

export class IndexController implements SampleController {
  async handleGet(_req: Request, res: Response): Promise<void> {
    res.type("html").send(readFileSync(join(HERE, "index.html"), "utf8"));
  }

  async handlePost(req: Request, res: Response): Promise<void> {
    const action = String(req.body?.action ?? "");
    const client = await getClient();

    if (action === "prepare_dg") {
      const customerName = String(req.body?.customer_name ?? "");
      const companyName = String(req.body?.company_name ?? "");
      const email = String(req.body?.email ?? "");

      // 1. Create document group from template
      const dgResp =
        await client.send<DocumentGroupTemplatePostResponse>(
          new DocumentGroupTemplatePostRequest(
            DOCUMENT_GROUP_TEMPLATE_ID,
            "ISV Form Document Group",
          ),
        );
      const dgId = dgResp.data.unique_id;

      // 2. Process merge fields in each document
      const dg = await client.send<DocumentGroupGetResponse>(
        new DocumentGroupGetRequest(dgId),
      );
      for (const doc of dg.documents ?? []) {
        const docData = await client.send<DocumentGetResponse>(
          new DocumentGetRequest(doc.id),
        );

        const texts: TextRequestAttribute[] = [];

        for (const field of docData.fields ?? []) {
          const attrs = field.json_attributes;
          const fieldName = attrs?.name;

          if (fieldName === CUSTOMER_NAME_FIELD) {
            texts.push({
              x: Math.trunc(attrs.x ?? 0),
              y: Math.trunc(attrs.y ?? 0),
              size: attrs.height ?? 25,
              width: Math.trunc(attrs.width ?? 0),
              height: Math.trunc(attrs.height ?? 0),
              subtype: "text",
              page_number: attrs.page_number ?? 0,
              data: customerName,
              font: "Arial",
              line_height: attrs.height ?? 25,
            });
          } else if (fieldName === COMPANY_NAME_FIELD) {
            texts.push({
              x: Math.trunc(attrs.x ?? 0),
              y: Math.trunc(attrs.y ?? 0),
              size: attrs.height ?? 20,
              width: Math.trunc(attrs.width ?? 0),
              height: Math.trunc(attrs.height ?? 0),
              subtype: "text",
              page_number: attrs.page_number ?? 0,
              data: companyName,
              font: "Arial",
              line_height: attrs.height ?? 20,
            });
          }
        }

        if (texts.length > 0) {
          await client.send(
            new DocumentPutRequest(
              doc.id,
              [],
              [],
              [],
              [],
              [],
              texts,
              [],
              [],
              [],
              [],
              "ISV Form Document Group",
              "",
            ),
          );
        }
      }

      // 3. Send group invite
      const dg2 = await client.send<DocumentGroupGetResponse>(
        new DocumentGroupGetRequest(dgId),
      );
      const recipientsResp =
        await client.send<DocumentGroupRecipientsGetResponse>(
          new DocumentGroupRecipientsGetRequest(dgId),
        );
      const recipients = recipientsResp.data.recipients ?? [];

      const redirectBase =
        `${settings.APP_BASE_URL}/samples/${SAMPLE_NAME}`;
      const inviteActions: InviteStepInviteActionRequestAttribute[] = [];
      const inviteEmails: InviteStepInviteEmailRequestAttribute[] = [];

      for (const recipient of recipients) {
        const rname = recipient.name;
        const emailToUse =
          rname === PREPARE_CONTRACT_ROLE ? email : USER_EMAIL;

        inviteEmails.push({
          email: emailToUse,
          subject: "Review and sign documents",
          message: "Please review and sign the documents",
          expiration_days: 30,
          reminder: 10,
        });

        for (const doc of dg2.documents ?? []) {
          inviteActions.push({
            email: emailToUse,
            role_name: rname,
            action: "sign",
            document_id: doc.id,
            redirect_uri: `${redirectBase}?page=status-page&document_group_id=${dgId}`,
            redirect_target: "self",
          });
        }
      }

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
}
