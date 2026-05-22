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
  DocumentGetRequest,
  DocumentDownloadGetRequest,
  type DocumentGetResponse,
} from "@signnow/api-client/api/document";
import {
  DocumentPrefillPutRequest,
  type FieldRequestAttribute,
} from "@signnow/api-client/api/documentField";

// SDK v3.2.0 defect: "impoort" typo in package.json exports for embeddedInvite.
// Runtime classes must be loaded via createRequire to use the "require" condition.
import type {
  InviteRequestAttribute,
  DocumentInviteLinkPostResponse,
} from "@signnow/api-client/api/embeddedInvite";

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

// v3.2.0 ships an incorrect response type for DocumentInvitePost.
type InviteCreatedItem = { id: string; email: string; role_id: string };
type DocumentInvitePostResponseFixed = { data: InviteCreatedItem[] };

const TEMPLATE_ID = "34009a3d21b5468d86d886cd715658c453335c61";
const SAMPLE_NAME = "EVDemoSendingAnd3EmbeddedSigners";
const HERE = dirname(fileURLToPath(import.meta.url));

export class IndexController implements SampleController {
  async handleGet(req: Request, res: Response): Promise<void> {
    res.type("html").send(readFileSync(join(HERE, "index.html"), "utf8"));
  }

  async handlePost(req: Request, res: Response): Promise<void> {
    const action = String(req.body?.action ?? "");
    const client = await getClient();

    if (action === "start-workflow") {
      const agentName = String(req.body?.agent_name ?? "");
      const agentEmail = String(req.body?.agent_email ?? "");
      const signer1Name = String(req.body?.signer1_name ?? "");
      const signer1Email = String(req.body?.signer1_email ?? "");
      const signer2Name = String(req.body?.signer2_name ?? "");
      const signer2Email = String(req.body?.signer2_email ?? "");

      // 1. Clone template
      const cloneResp = await client.send<CloneTemplatePostResponse>(
        new CloneTemplatePostRequest(TEMPLATE_ID),
      );
      const documentId = cloneResp.id;

      // 2. Prefill fields
      await this.prefillFields(client, documentId, {
        "Signer 1 Name": signer1Name,
        "Text Field 18": signer1Name,
        "Signer 2 Name": signer2Name,
        "Text Field 19": signer2Name,
      });

      // 3. Fetch document to get role IDs
      const agentRoleId = await this.getRoleId(
        client,
        documentId,
        "Contract Preparer",
      );
      const signer1RoleId = await this.getRoleId(
        client,
        documentId,
        "Recipient 1",
      );
      const signer2RoleId = await this.getRoleId(
        client,
        documentId,
        "Recipient 2",
      );

      // 4. Create 3 sequential embedded invites
      const inviteMap = await this.createEmbeddedInvites(client, documentId, [
        { email: agentEmail, roleId: agentRoleId, order: 1, name: agentName },
        {
          email: signer1Email,
          roleId: signer1RoleId,
          order: 2,
          name: signer1Name,
        },
        {
          email: signer2Email,
          roleId: signer2RoleId,
          order: 3,
          name: signer2Name,
        },
      ]);

      // 5. Get invite link for the agent (first signer)
      const agentInviteId = inviteMap[agentRoleId];
      const redirectUrl = this.makeRedirectUrl(documentId, "signer1");
      const agentLink = await this.getInviteLink(
        client,
        documentId,
        agentInviteId,
        redirectUrl,
      );

      res.json({
        document_id: documentId,
        embedded_link: agentLink,
        message: "Agent embedded signing link created. Agent can now sign.",
      });
      return;
    }

    if (action === "next-signer") {
      const documentId = String(req.body?.document_id ?? "");
      const roleName = String(req.body?.roleName ?? "");
      const redirectKey = roleName === "Recipient 1" ? "signer2" : "finish";

      const inviteId = await this.getInviteIdForRoleName(
        client,
        documentId,
        roleName,
      );
      const redirectUrl = this.makeRedirectUrl(documentId, redirectKey);
      const signingLink = await this.getInviteLink(
        client,
        documentId,
        inviteId,
        redirectUrl,
      );

      res.json({
        embedded_link: signingLink,
        message: `Embedded link for ${roleName} created. Ready for signing.`,
      });
      return;
    }

    if (action === "download") {
      const documentId = String(req.body?.document_id ?? "");
      const filePath = await client.send<string>(
        new DocumentDownloadGetRequest(documentId).withType("collapsed"),
      );
      res.download(filePath, basename(filePath));
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
            email_statuses?: Array<{
              created_at?: string | number;
              status?: string;
            }>;
          }>;
        }
      ).field_invites ?? [];

      const statuses = fieldInvites.map((invite) => {
        const emailStatuses = invite.email_statuses ?? [];
        const first = emailStatuses[0] ?? null;
        let timestamp = "";
        if (first?.created_at) {
          const ts = Number(first.created_at);
          if (!isNaN(ts)) {
            timestamp = new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 19);
          }
        }
        return {
          email: invite.email ?? "",
          timestamp,
          status: first?.status ?? "Pending",
        };
      });

      res.json(statuses);
      return;
    }

    res.status(400).json({ error: "Invalid action" });
  }

  // --- helpers ---

  private async prefillFields(
    client: Awaited<ReturnType<typeof getClient>>,
    documentId: string,
    fields: Record<string, string>,
  ): Promise<void> {
    const fieldsToSet: FieldRequestAttribute[] = Object.entries(fields)
      .filter(([, v]) => v)
      .map(([k, v]) => ({ field_name: k, prefilled_text: v }));
    if (fieldsToSet.length > 0) {
      await client.send(new DocumentPrefillPutRequest(documentId, fieldsToSet));
    }
  }

  private async getRoleId(
    client: Awaited<ReturnType<typeof getClient>>,
    documentId: string,
    roleName: string,
  ): Promise<string> {
    const doc = await client.send<DocumentGetResponse>(
      new DocumentGetRequest(documentId),
    );
    const role = (doc.roles ?? []).find((r) => r.name === roleName);
    if (!role) {
      throw new Error(
        `Role '${roleName}' not found on document ${documentId}`,
      );
    }
    return role.unique_id;
  }

  private async createEmbeddedInvites(
    client: Awaited<ReturnType<typeof getClient>>,
    documentId: string,
    signers: Array<{
      email: string;
      roleId: string;
      order: number;
      name: string;
    }>,
  ): Promise<Record<string, string>> {
    const invites: InviteRequestAttribute[] = signers.map((s) => {
      const parts = (s.name ?? "").split(" ");
      const firstName = parts[0] ?? "";
      const lastName = parts[1] ?? firstName;
      return {
        email: s.email,
        role_id: s.roleId,
        order: s.order,
        auth_method: "none",
        first_name: firstName,
        last_name: lastName,
      };
    });

    const resp = await client.send<DocumentInvitePostResponseFixed>(
      new DocumentInvitePostRequest(documentId, invites),
    );

    const result: Record<string, string> = {};
    for (const item of resp.data ?? []) {
      if (item.role_id && item.id) {
        result[item.role_id] = item.id;
      }
    }
    return result;
  }

  private async getInviteLink(
    client: Awaited<ReturnType<typeof getClient>>,
    documentId: string,
    fieldInviteId: string,
    redirectUrl: string,
  ): Promise<string> {
    const linkResp = await client.send<DocumentInviteLinkPostResponse>(
      new DocumentInviteLinkPostRequest(documentId, fieldInviteId, "none", 15),
    );
    return `${linkResp.data.link}&redirect_uri=${encodeURIComponent(redirectUrl)}`;
  }

  private async getInviteIdForRoleName(
    client: Awaited<ReturnType<typeof getClient>>,
    documentId: string,
    roleName: string,
  ): Promise<string> {
    const roleId = await this.getRoleId(client, documentId, roleName);
    const doc = await client.send<DocumentGetResponse>(
      new DocumentGetRequest(documentId),
    );

    const fieldInvites = (
      doc as unknown as {
        field_invites?: Array<{
          id?: string;
          field_invite_unique_id?: string;
          role_unique_id?: string;
          role_id?: string;
        }>;
      }
    ).field_invites ?? [];

    const invite = fieldInvites.find(
      (inv) =>
        (inv.role_unique_id ?? inv.role_id) === roleId,
    );
    if (!invite) {
      throw new Error(`Invite for role '${roleName}' not found.`);
    }
    return invite.id ?? invite.field_invite_unique_id ?? "";
  }

  private makeRedirectUrl(documentId: string, nextStep: string): string {
    return (
      `${settings.APP_BASE_URL}/samples/${SAMPLE_NAME}` +
      `?document_id=${documentId}&step=${nextStep}`
    );
  }
}
