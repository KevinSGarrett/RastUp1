export type DocPackStatus = 'DRAFT' | 'ISSUED' | 'SIGNED' | 'VOIDED' | 'SUPERSEDED';

export type EnvelopeStatus = 'NONE' | 'SENT' | 'COMPLETED' | 'VOIDED' | 'EXPIRED';

export type SignEventType =
  | 'ENVELOPE_SENT'
  | 'RECIPIENT_VIEWED'
  | 'RECIPIENT_SIGNED'
  | 'ENVELOPE_COMPLETED'
  | 'ENVELOPE_DECLINED'
  | 'ENVELOPE_VOIDED'
  | 'ENVELOPE_EXPIRED';

export type DocVariableKind =
  | 'string'
  | 'int'
  | 'money_cents'
  | 'datetime'
  | 'date'
  | 'duration'
  | 'enum'
  | 'address';

export interface DocVariableDefinition {
  kind: DocVariableKind;
  description: string;
  example?: unknown;
  required?: boolean;
  options?: string[];
  min?: number;
  max?: number;
  pattern?: string;
  placeholder?: string;
}

export type DocVariableSchema = Record<string, DocVariableDefinition>;

export interface DocClauseVersionRef {
  clauseId: string;
  version: number;
}

export interface DocClause extends DocClauseVersionRef {
  name: string;
  cityGate?: string[] | null;
  roleGate?: string[] | null;
  isActive: boolean;
  bodyMarkdown: string;
  variablesSchema: DocVariableSchema;
  approvalState: 'draft' | 'awaiting_approval' | 'approved' | 'rejected';
  approvalMetadata: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  publishedAt?: string | null;
  retiredAt?: string | null;
}

export interface DocSignerRole {
  role: string;
  order: number;
  emailField?: string;
  userIdField?: string;
  required?: boolean;
  verificationRequirement?: 'NONE' | 'SMS_OTP' | 'IDV';
}

export interface DocTemplate {
  templateId: string;
  name: string;
  version: number;
  cityGate?: string[] | null;
  roleGate?: string[] | null;
  clauses: DocClauseVersionRef[];
  layout: Record<string, unknown>;
  signerRoles: DocSignerRole[];
  defaultVariables: Record<string, unknown>;
  variablesSchema: DocVariableSchema;
  isActive: boolean;
  requiresDualApproval: boolean;
  approvalState: 'draft' | 'awaiting_approval' | 'approved' | 'rejected';
  approvalMetadata: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  publishedAt?: string | null;
  retiredAt?: string | null;
}

export interface DocInstance {
  docId: string;
  packId: string;
  templateId: string;
  templateVersion: number;
  variablesResolved: Record<string, unknown>;
  renderPdfS3: string | null;
  renderPdfSha256Pre: string | null;
  renderPdfSha256Post: string | null;
  envelopeId: string | null;
  envelopeStatus: EnvelopeStatus;
  signerMap: Record<string, string>;
  metadata: Record<string, unknown>;
  wormRetainedUntil: string;
  legalHold: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface DocManifestEntry {
  docId: string;
  templateId: string;
  templateVersion: number;
  envelopeStatus: EnvelopeStatus;
  renderPdfSha256Pre: string | null;
  renderPdfSha256Post: string | null;
}

export interface DocPack {
  packId: string;
  legId: string;
  status: DocPackStatus;
  generatorVersion: string;
  city: string;
  docManifest: DocManifestEntry[];
  issuedAt: string | null;
  signedAt: string | null;
  supersededBy: string | null;
  legalHold: boolean;
  wormRetainedUntil: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface SignEvent {
  signEventId: string;
  docId: string;
  providerEventId?: string | null;
  event: SignEventType;
  actorRole: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
  occurredAt?: string | null;
  receivedAt: string;
  payload: Record<string, unknown>;
  signatureValid: boolean;
  createdAt: string;
}

export interface DocEvidenceRecord {
  docId: string;
  packId: string;
  renderPdfSha256Pre: string | null;
  renderPdfSha256Post: string | null;
  storageUrl: string | null;
  createdAt: string;
  verifiedAt?: string | null;
  verificationStatus: 'pending' | 'verified' | 'mismatch';
  mismatchReason?: string | null;
}

export interface DocPackAssemblyContext {
  lbgId: string;
  legId: string;
  legType: 'talent' | 'studio';
  city: string;
  roles: string[];
  buyerUserId: string;
  sellerUserId: string;
  studioOwnerId?: string | null;
  variables: Record<string, unknown>;
  signerOverrides?: Record<string, Record<string, string>>;
}

export interface VariableResolutionResult {
  variables: Record<string, unknown>;
  missing: string[];
  invalid: string[];
}

export interface VariableResolver {
  resolveVariables(input: {
    template: DocTemplate;
    context: DocPackAssemblyContext;
  }): VariableResolutionResult;
  resolveSignerMap(input: {
    template: DocTemplate;
    context: DocPackAssemblyContext;
  }): Record<string, string>;
}

export interface DocPackAssemblyResult {
  pack: DocPack;
  documents: DocInstance[];
}
