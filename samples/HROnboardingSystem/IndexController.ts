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
  DocumentGetRequest,
  type DocumentGetResponse,
} from "@signnow/api-client/api/document";
import {
  DocumentPrefillPutRequest,
  type FieldRequestAttribute,
} from "@signnow/api-client/api/documentField";
import {
  DocumentGroupGetRequest,
  DocumentGroupPostRequest,
  DownloadDocumentGroupPostRequest,
  type DocumentGroupGetResponse,
  type DocumentGroupPostResponse,
} from "@signnow/api-client/api/documentGroup";
import {
  GroupInvitePostRequest,
  GroupInviteGetRequest,
  type GroupInviteGetResponse,
  type InviteStepRequestAttribute,
  type InviteStepInviteActionRequestAttribute,
  type InviteStepInviteEmailRequestAttribute,
} from "@signnow/api-client/api/documentGroupInvite";

const I9_FORM_TEMPLATE_ID = "940989288b8b4c62a950b908333b5b21efd6a174";
const NDA_TEMPLATE_ID = "a4f523d0cb234ffc99b0badc9e6f59111f76abc2";
const EMPLOYEE_CONTRACT_TEMPLATE_ID =
  "1a12d3e00a54457ca1bf7bde5fa37d38ede866ed";

const NAME_FIELD = "Name";
const TEXT_FIELD_2 = "Text Field 2";
const TEXT_FIELD_156 = "Text Field 156";
const EMAIL_FIELD = "Email";

const SAMPLE_NAME = "HROnboardingSystem";
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

    if (action === "create-invite") {
      const employeeName = String(req.body?.employee_name ?? "");
      const employeeEmail = String(req.body?.employee_email ?? "");
      const hrManagerEmail = String(req.body?.hr_manager_email ?? "");
      const employerEmail = String(req.body?.employer_email ?? "");
      const templateIds = req.body?.template_ids as string[] | undefined;

      if (
        !employeeName ||
        !employeeEmail ||
        !hrManagerEmail ||
        !employerEmail ||
        !templateIds ||
        templateIds.length === 0
      ) {
        res.status(400).json({
          success: false,
          message: "All fields are required",
        });
        return;
      }

      const dgId = await this.createDocumentGroup(client, templateIds, {
        [NAME_FIELD]: employeeName,
        [TEXT_FIELD_2]: employeeName,
        [TEXT_FIELD_156]: employeeName,
        [EMAIL_FIELD]: employeeEmail,
      });

      await this.sendInvite(
        client,
        dgId,
        employeeEmail,
        hrManagerEmail,
        employerEmail,
      );

      res.json({ success: true, document_group_id: dgId });
      return;
    }

    if (action === "invite-status") {
      const dgId = String(req.body?.document_group_id ?? "");
      const status = await this.getDocumentGroupSignersStatus(client, dgId);
      res.json(status);
      return;
    }

    if (action === "download-doc-group") {
      const dgId = String(req.body?.document_group_id ?? "");
      if (!dgId) {
        res.status(400).json({
          success: false,
          message: "Document group ID is required",
        });
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
      available_actions: ["create-invite", "invite-status", "download-doc-group"],
    });
  }

  // --- helpers ---

  private async createDocumentGroup(
    client: Awaited<ReturnType<typeof getClient>>,
    templateIds: string[],
    fieldsValue: Record<string, string>,
  ): Promise<string> {
    const documentIds: string[] = [];
    for (const templateId of templateIds) {
      const cloneResp = await client.send<CloneTemplatePostResponse>(
        new CloneTemplatePostRequest(templateId),
      );
      documentIds.push(cloneResp.id);
    }

    for (const docId of documentIds) {
      await this.prefillFields(client, docId, fieldsValue);
    }

    const dgResp = await client.send<DocumentGroupPostResponse>(
      new DocumentGroupPostRequest(documentIds, "HR Onboarding System"),
    );
    return dgResp.id;
  }

  private async sendInvite(
    client: Awaited<ReturnType<typeof getClient>>,
    dgId: string,
    employeeEmail: string,
    hrManagerEmail: string,
    employerEmail: string,
  ): Promise<void> {
    const dg = await client.send<DocumentGroupGetResponse>(
      new DocumentGroupGetRequest(dgId),
    );

    const roleMappings: Record<string, string> = {
      "Contract Preparer": hrManagerEmail,
      Employee: employeeEmail,
      Employer: employerEmail,
    };

    const inviteActions: InviteStepInviteActionRequestAttribute[] = [];
    const redirectBase = `${settings.APP_BASE_URL}/samples/${SAMPLE_NAME}`;

    for (const docEntry of dg.documents ?? []) {
      const docId = (docEntry as { id: string }).id;
      const docRoles = await this.getDocumentRoles(client, docId);

      for (const [roleName, email] of Object.entries(roleMappings)) {
        if (docRoles.includes(roleName)) {
          inviteActions.push({
            email,
            role_name: roleName,
            action: "sign",
            document_id: docId,
            redirect_uri: `${redirectBase}?page=status-page&document_group_id=${dgId}`,
            redirect_target: "self",
          });
        } else {
          inviteActions.push({
            email,
            role_name: roleName,
            action: "view",
            document_id: docId,
          });
        }
      }
    }

    const inviteEmails: InviteStepInviteEmailRequestAttribute[] =
      Object.entries(roleMappings).map(([roleName, email]) => ({
        email,
        subject: "HR Onboarding Documents - Action Required",
        message: `Please review and sign the onboarding documents as ${roleName}.`,
        expiration_days: 30,
        reminder: 10,
      }));

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
  }

  private async getDocumentRoles(
    client: Awaited<ReturnType<typeof getClient>>,
    documentId: string,
  ): Promise<string[]> {
    const doc = await client.send<DocumentGetResponse>(
      new DocumentGetRequest(documentId),
    );
    const roles: string[] = [];
    for (const role of doc.roles ?? []) {
      const roleName = role.name;
      if (roleName && !roles.includes(roleName)) {
        roles.push(roleName);
      }
    }
    return roles;
  }

  private async prefillFields(
    client: Awaited<ReturnType<typeof getClient>>,
    documentId: string,
    fieldsValue: Record<string, string>,
  ): Promise<void> {
    const doc = await client.send<DocumentGetResponse>(
      new DocumentGetRequest(documentId),
    );
    const existingFields = this.extractFieldNames(doc);

    const fields: FieldRequestAttribute[] = [];
    for (const [fieldName, fieldValue] of Object.entries(fieldsValue)) {
      if (existingFields.includes(fieldName) && fieldValue) {
        fields.push({ field_name: fieldName, prefilled_text: fieldValue });
      }
    }
    if (fields.length > 0) {
      await client.send(new DocumentPrefillPutRequest(documentId, fields));
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

  private async getDocumentGroupSignersStatus(
    client: Awaited<ReturnType<typeof getClient>>,
    dgId: string,
  ): Promise<{ status: string | null }> {
    const dg = await client.send<DocumentGroupGetResponse>(
      new DocumentGroupGetRequest(dgId),
    );
    const inviteId = dg.invite_id ?? null;

    if (!inviteId) {
      return { status: "pending" };
    }

    const statusResp = await client.send<GroupInviteGetResponse>(
      new GroupInviteGetRequest(dgId, inviteId),
    );

    const invite =
      (
        statusResp as unknown as {
          invite?: { status?: string };
        }
      ).invite ?? {};
    return { status: invite.status ?? null };
  }
}
