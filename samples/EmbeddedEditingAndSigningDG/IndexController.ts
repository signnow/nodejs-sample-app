import { createRequire } from "node:module";
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

// SDK v3.2.0 defect: "imoport" typo for embeddedEditor and embeddedGroupInvite.
// Must use createRequire to load runtime classes.
import type {
  DocumentGroupEmbeddedEditorLinkPostResponse,
} from "@signnow/api-client/api/embeddedEditor";
import type {
  InviteRequestAttribute as EmbeddedGroupInviteAttribute,
  GroupInviteLinkPostResponse,
} from "@signnow/api-client/api/embeddedGroupInvite";

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
  DocumentGroupEmbeddedEditorLinkPostRequest: new (
    documentGroupId: string,
    redirectUri?: string,
    redirectTarget?: string,
    linkExpiration?: number,
  ) => SdkRequest;
};
const { DocumentGroupEmbeddedEditorLinkPostRequest } = embeddedEditor;

const embeddedGroupInvite = require(
  "@signnow/api-client/api/embeddedGroupInvite",
) as {
  GroupInvitePostRequest: new (
    documentGroupId: string,
    invites: EmbeddedGroupInviteAttribute[],
    signAsMerged?: boolean,
  ) => SdkRequest;
  GroupInviteLinkPostRequest: new (
    documentGroupId: string,
    embeddedInviteId: string,
    email?: string,
    authMethod?: string,
    linkExpiration?: number,
  ) => SdkRequest;
};
const { GroupInvitePostRequest, GroupInviteLinkPostRequest } =
  embeddedGroupInvite;

type EmbeddedGroupInvitePostResponse = { data: { id: string } };

const DOCUMENT_GROUP_TEMPLATE_ID = "0d7fb734e962418bad79d8fb80bbdaaf1f8e8cd9";
const ROLE_CONTRACT_PREPARER = "Contract Preparer";
const ROLE_RECIPIENT_1 = "Recipient 1";
const ROLE_RECIPIENT_2 = "Recipient 2";
const SAMPLE_NAME = "EmbeddedEditingAndSigningDG";
const HERE = dirname(fileURLToPath(import.meta.url));

type Recipients = Array<{
  name?: string;
  email?: string | null;
  order?: number;
  documents?: Array<{ id?: string; role?: string; action?: string }>;
}>;

export class IndexController implements SampleController {
  async handleGet(_req: Request, res: Response): Promise<void> {
    res.type("html").send(readFileSync(join(HERE, "index.html"), "utf8"));
  }

  async handlePost(req: Request, res: Response): Promise<void> {
    const action = String(req.body?.action ?? "");
    const client = await getClient();

    if (action === "submit-signer-info") {
      const signer1Name = String(req.body?.signer_1_name ?? "");
      const signer1Email = String(req.body?.signer_1_email ?? "");
      const signer2Name = String(req.body?.signer_2_name ?? "");
      const signer2Email = String(req.body?.signer_2_email ?? "");

      // 1. Create document group from template
      const dgResp = await client.send<DocumentGroupTemplatePostResponse>(
        new DocumentGroupTemplatePostRequest(
          DOCUMENT_GROUP_TEMPLATE_ID,
          "Embedded Editing & Signing Group",
        ),
      );
      const dgId = dgResp.data.unique_id;

      // 2. Prefill fields in documents
      await this.prefillDocGroupFields(client, dgId, {
        "Signer 1 Name": signer1Name,
        "Signer 2 Name": signer2Name,
      });

      // NOTE: DocumentGroupRecipientsPutRequest does NOT exist in Node SDK v3.2.0.
      // The _update_document_group_recipients step from Python is skipped here.
      // Recipients remain as template defaults; the embedded editor allows the sender to update them.

      // 3. Create embedded editor link for sender
      const redirectUrl =
        `${settings.APP_BASE_URL}/samples/${SAMPLE_NAME}` +
        `?page=page3-create-invite&document_group_id=${dgId}`;
      const editLinkResp =
        await client.send<DocumentGroupEmbeddedEditorLinkPostResponse>(
          new DocumentGroupEmbeddedEditorLinkPostRequest(
            dgId,
            redirectUrl,
            "self",
            15,
          ),
        );
      const editLink = (editLinkResp as unknown as { data: { url: string } })
        .data.url;

      res.json({ document_group_id: dgId, edit_link: editLink });
      return;
    }

    if (action === "create-embedded-invite") {
      const dgId = String(req.body?.document_group_id ?? "");
      const contractPreparerEmail = String(
        req.body?.contract_preparer_email ?? "",
      );

      const signingLink = await this.createEmbeddedInviteLink(
        client,
        dgId,
        contractPreparerEmail,
      );
      res.json({ document_group_id: dgId, signing_link: signingLink });
      return;
    }

    if (action === "invite-status") {
      const dgId = String(req.body?.document_group_id ?? "");
      const statuses = await this.getDocumentGroupSignersStatus(client, dgId);
      res.json(statuses);
      return;
    }

    if (action === "download-doc-group") {
      const dgId = String(req.body?.document_group_id ?? "");
      const filePath = await client.send<string>(
        new DownloadDocumentGroupPostRequest(dgId, "merged", "no", []),
      );
      res.download(filePath, basename(filePath));
      return;
    }

    res.status(400).json({ success: false, message: "Invalid action" });
  }

  // --- helpers ---

  private async prefillDocGroupFields(
    client: Awaited<ReturnType<typeof getClient>>,
    dgId: string,
    fieldsToFill: Record<string, string>,
  ): Promise<void> {
    const dg = await client.send<DocumentGroupGetResponse>(
      new DocumentGroupGetRequest(dgId),
    );

    for (const docEntry of dg.documents ?? []) {
      const docId = (docEntry as { id: string }).id;
      const doc = await client.send<DocumentGetResponse>(
        new DocumentGetRequest(docId),
      );

      const fields: FieldRequestAttribute[] = [];
      for (const field of doc.fields ?? []) {
        const fieldName = field.json_attributes?.name;
        if (fieldName != null && fieldName in fieldsToFill) {
          fields.push({
            field_name: fieldName,
            prefilled_text: fieldsToFill[fieldName],
          });
        }
      }
      if (fields.length > 0) {
        await client.send(new DocumentPrefillPutRequest(docId, fields));
      }
    }
  }

  private async createEmbeddedInviteLink(
    client: Awaited<ReturnType<typeof getClient>>,
    dgId: string,
    contractPreparerEmail: string,
  ): Promise<string> {
    const recipientsResp =
      await client.send<DocumentGroupRecipientsGetResponse>(
        new DocumentGroupRecipientsGetRequest(dgId),
      );

    const recipients: Recipients =
      (
        recipientsResp as unknown as { data: { recipients: Recipients } }
      ).data.recipients ?? [];

    const recipient1Email = this.findEmailByRoleName(
      recipients,
      ROLE_RECIPIENT_1,
    );
    const recipient2Email = this.findEmailByRoleName(
      recipients,
      ROLE_RECIPIENT_2,
    );

    const redirectUrl =
      `${settings.APP_BASE_URL}/samples/${SAMPLE_NAME}` +
      `?page=page4-status-download&document_group_id=${dgId}`;

    const invites: EmbeddedGroupInviteAttribute[] = [
      {
        order: 1,
        signers: [
          {
            email: contractPreparerEmail,
            auth_method: "none",
            documents: await this.buildDocumentsForRole(
              client,
              dgId,
              ROLE_CONTRACT_PREPARER,
            ),
            redirect_uri: redirectUrl,
            redirect_target: "self",
          },
        ],
      },
      {
        order: 2,
        signers: [
          {
            email: recipient1Email ?? "",
            auth_method: "none",
            documents: await this.buildDocumentsForRole(
              client,
              dgId,
              ROLE_RECIPIENT_1,
            ),
            redirect_uri: redirectUrl,
            redirect_target: "self",
          },
        ],
      },
      {
        order: 3,
        signers: [
          {
            email: recipient2Email ?? "",
            auth_method: "none",
            documents: await this.buildDocumentsForRole(
              client,
              dgId,
              ROLE_RECIPIENT_2,
            ),
            redirect_uri: redirectUrl,
            redirect_target: "self",
          },
        ],
      },
    ];

    const inviteResp = await client.send<EmbeddedGroupInvitePostResponse>(
      new GroupInvitePostRequest(dgId, invites, true),
    );
    const embeddedInviteId = inviteResp.data.id;

    const linkResp = await client.send<GroupInviteLinkPostResponse>(
      new GroupInviteLinkPostRequest(
        dgId,
        embeddedInviteId,
        contractPreparerEmail,
        "none",
        30,
      ),
    );
    return (linkResp as unknown as { data: { link: string } }).data.link;
  }

  private async buildDocumentsForRole(
    client: Awaited<ReturnType<typeof getClient>>,
    dgId: string,
    roleName: string,
  ): Promise<Array<{ id: string; action: string; role: string }>> {
    const dg = await client.send<DocumentGroupGetResponse>(
      new DocumentGroupGetRequest(dgId),
    );

    return (dg.documents ?? []).map((doc) => {
      const roles = (
        doc as unknown as { roles?: string[] }
      ).roles ?? [];
      const rolePresent = roles.includes(roleName);
      return {
        id: (doc as unknown as { id: string }).id,
        action: rolePresent ? "sign" : "view",
        role: roleName,
      };
    });
  }

  private findEmailByRoleName(
    recipients: Recipients,
    roleName: string,
  ): string | null {
    const r = recipients.find((rec) => rec.name === roleName);
    return r?.email ?? null;
  }

  private async getDocumentGroupSignersStatus(
    client: Awaited<ReturnType<typeof getClient>>,
    dgId: string,
  ): Promise<
    Array<{
      name?: string;
      email?: string | null;
      order?: number;
      status: string;
      timestamp: null;
    }>
  > {
    const dg = await client.send<DocumentGroupGetResponse>(
      new DocumentGroupGetRequest(dgId),
    );
    const inviteId = dg.invite_id ?? null;

    const recipientsResp =
      await client.send<DocumentGroupRecipientsGetResponse>(
        new DocumentGroupRecipientsGetRequest(dgId),
      );
    const recipients: Recipients =
      (
        recipientsResp as unknown as { data: { recipients: Recipients } }
      ).data.recipients ?? [];

    if (!inviteId) {
      return recipients.map((r) => ({
        name: r.name,
        email: r.email,
        order: r.order,
        status: "unknown",
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
            steps?: Array<{ order?: number; status?: string }>;
          };
        }
      ).invite ?? {};
    const stepStatuses: Record<number, string> = {};
    for (const step of invite.steps ?? []) {
      if (step.order != null && step.status != null) {
        stepStatuses[step.order] = step.status;
      }
    }

    return recipients.map((r) => ({
      name: r.name,
      email: r.email,
      order: r.order,
      status: r.order != null ? (stepStatuses[r.order] ?? "unknown") : "unknown",
      timestamp: null,
    }));
  }
}
