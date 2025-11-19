import { DocsError, assertDocs } from './errors.js';

export const PACK_STATUSES = new Set(['draft', 'issued', 'signed', 'voided', 'superseded']);
export const ENVELOPE_STATUSES = new Set(['none', 'sent', 'completed', 'voided', 'expired']);
export const SIGN_EVENT_TYPES = new Set([
  'envelope_sent',
  'recipient_viewed',
  'recipient_signed',
  'envelope_completed',
  'envelope_declined',
  'envelope_voided',
  'envelope_expired'
]);

export function defaultIdFactory(prefix) {
  const base =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  return `${prefix}_${base}`;
}

export function normalizeIsoTimestamp(value, { field }) {
  const iso = typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new DocsError('DOC_TIMESTAMP_INVALID', `${field} must be a valid ISO-8601 timestamp.`, { value });
  }
  return date.toISOString();
}

export function computeRetentionTimestamp(createdAtIso, { years = 7 } = {}) {
  assertDocs(Number.isFinite(years) && years >= 1, 'DOC_RETENTION_INVALID', 'Retention years must be >= 1.', {
    years
  });
  const created = new Date(createdAtIso);
  assertDocs(!Number.isNaN(created.getTime()), 'DOC_TIMESTAMP_INVALID', 'createdAt must be a valid ISO timestamp.', {
    createdAt: createdAtIso
  });
  const retention = new Date(created);
  retention.setUTCFullYear(retention.getUTCFullYear() + Math.trunc(years));
  return retention.toISOString();
}

function normalizeArray(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return [value];
}

function matchesGate(gate, value) {
  if (!gate || gate.length === 0) {
    return true;
  }
  if (value === null || value === undefined) {
    return false;
  }
  const normalizedGate = gate.map((item) => String(item).toLowerCase());
  const normalizedValue = Array.isArray(value)
    ? value.map((item) => String(item).toLowerCase())
    : [String(value).toLowerCase()];
  return normalizedValue.some((entry) => normalizedGate.includes(entry));
}

function isTemplateApplicable(template, context) {
  const cityAllowed = matchesGate(template.cityGate, context.city);
  const roleAllowed = matchesGate(template.roleGate, context.roles ?? []);
  return template.isActive !== false && cityAllowed && roleAllowed;
}

export function filterTemplatesByGate(templates, context) {
  return templates.filter((template) => isTemplateApplicable(template, context));
}

function getSchemaEntries(schema = {}) {
  return Object.entries(schema ?? {});
}

function requiredVariablesFromSchema(schema = {}) {
  return getSchemaEntries(schema)
    .filter(([, definition]) => definition?.required !== false)
    .map(([key]) => key);
}

function normalizeEnumOptions(definition) {
  if (!definition.options) {
    return [];
  }
  return definition.options.map((value) => String(value));
}

function validateVariableValue(name, definition = {}, value) {
  if (value === undefined || value === null) {
    return null;
  }
  const kind = definition.kind ?? 'string';
  switch (kind) {
    case 'string': {
      if (typeof value !== 'string') {
        return `Expected string for ${name}.`;
      }
      if (definition.pattern) {
        const regex = new RegExp(definition.pattern);
        if (!regex.test(value)) {
          return `Value for ${name} does not match pattern ${definition.pattern}.`;
        }
      }
      return null;
    }
    case 'int':
    case 'money_cents': {
      if (!Number.isFinite(value)) {
        return `Expected numeric value for ${name}.`;
      }
      const intValue = Math.trunc(value);
      if (kind === 'money_cents' && intValue < 0) {
        return `${name} must be >= 0.`;
      }
      if (definition.min !== undefined && intValue < definition.min) {
        return `${name} must be >= ${definition.min}.`;
      }
      if (definition.max !== undefined && intValue > definition.max) {
        return `${name} must be <= ${definition.max}.`;
      }
      return null;
    }
    case 'datetime':
    case 'date': {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        return `Expected ISO timestamp for ${name}.`;
      }
      return null;
    }
    case 'duration': {
      if (!Number.isFinite(value) && typeof value !== 'string') {
        return `Expected numeric duration or ISO 8601 duration string for ${name}.`;
      }
      return null;
    }
    case 'enum': {
      const options = normalizeEnumOptions(definition);
      if (options.length > 0 && !options.includes(String(value))) {
        return `Value for ${name} must be one of ${options.join(', ')}.`;
      }
      return null;
    }
    case 'address': {
      if (typeof value !== 'object' || Array.isArray(value)) {
        return `Expected address object for ${name}.`;
      }
      return null;
    }
    default:
      return null;
  }
}

export function validateVariables(template, variables = {}) {
  const schema = template.variablesSchema ?? {};
  const required = new Set(requiredVariablesFromSchema(schema));
  const missing = [];
  const invalid = [];

  for (const key of required) {
    if (variables[key] === undefined || variables[key] === null || variables[key] === '') {
      missing.push(key);
    }
  }

  for (const [key, definition] of getSchemaEntries(schema)) {
    if (variables[key] === undefined || variables[key] === null) {
      continue;
    }
    const error = validateVariableValue(key, definition, variables[key]);
    if (error) {
      invalid.push({ field: key, reason: error });
    }
  }

  return { missing, invalid };
}

function ensureSignerMap(template, signerMap) {
  assertDocs(signerMap && typeof signerMap === 'object' && !Array.isArray(signerMap), 'DOC_SIGNER_MISSING', 'Signer map must be an object.', {
    templateId: template.templateId
  });
  const requiredRoles = (template.signerRoles ?? []).filter((role) => role.required !== false).map((role) => role.role);
  const missingRoles = requiredRoles.filter((role) => !signerMap[role]);
  assertDocs(missingRoles.length === 0, 'DOC_SIGNER_MISSING', 'Signer map missing required roles.', {
    templateId: template.templateId,
    missingRoles
  });
}

function buildManifestEntry(doc) {
  return {
    docId: doc.docId,
    templateId: doc.templateId,
    templateVersion: doc.templateVersion,
    envelopeStatus: doc.envelopeStatus,
    renderPdfSha256Pre: doc.renderPdfSha256Pre,
    renderPdfSha256Post: doc.renderPdfSha256Post
  };
}

export function assembleDocPack({
  context,
  templates,
  resolver,
  generatorVersion,
  nowIso = new Date().toISOString(),
  retentionYears = 7,
  idFactory = defaultIdFactory
}) {
  assertDocs(context, 'DOC_CONTEXT_REQUIRED', 'Doc pack assembly context is required.');
  assertDocs(context.legId, 'DOC_CONTEXT_REQUIRED', 'legId is required in context.', { context });
  assertDocs(context.city, 'DOC_CONTEXT_REQUIRED', 'city is required in context.', { context });
  assertDocs(generatorVersion, 'DOC_GENERATOR_REQUIRED', 'generatorVersion is required.');
  assertDocs(resolver && typeof resolver.resolveVariables === 'function', 'DOC_RESOLVER_INVALID', 'Variable resolver must implement resolveVariables.');
  assertDocs(typeof resolver.resolveSignerMap === 'function', 'DOC_RESOLVER_INVALID', 'Variable resolver must implement resolveSignerMap.');

  const createdAt = normalizeIsoTimestamp(nowIso, { field: 'nowIso' });
  const packId = idFactory('dpk');
  const applicableTemplates = filterTemplatesByGate(Array.isArray(templates) ? templates : [], context);

  assertDocs(applicableTemplates.length > 0, 'DOC_TEMPLATE_GATED', 'No applicable templates for leg context.', {
    city: context.city,
    roles: context.roles,
    legId: context.legId
  });

  const documents = [];
  for (const template of applicableTemplates) {
    const resolution = resolver.resolveVariables({ template, context }) ?? { variables: {}, missing: [], invalid: [] };
    const variables = resolution.variables ?? {};
    const validation = validateVariables(template, variables);
    const missing = [...(resolution.missing ?? []), ...validation.missing];
    const invalid = [...(resolution.invalid ?? []), ...(validation.invalid ?? [])];

    if (missing.length > 0) {
      throw new DocsError('DOC_VARS_MISSING', 'Template variables missing.', {
        templateId: template.templateId,
        missing: Array.from(new Set(missing))
      });
    }
    if (invalid.length > 0) {
      throw new DocsError('DOC_VARS_INVALID', 'Template variables invalid.', {
        templateId: template.templateId,
        invalid
      });
    }

    const signerMap = resolver.resolveSignerMap({ template, context }) ?? {};
    ensureSignerMap(template, signerMap);

    const docId = idFactory('doc');
    const wormRetainedUntil = computeRetentionTimestamp(createdAt, { years: retentionYears });

    documents.push({
      docId,
      packId,
      templateId: template.templateId,
      templateVersion: template.version,
      variablesResolved: variables,
      renderPdfS3: null,
      renderPdfSha256Pre: null,
      renderPdfSha256Post: null,
      envelopeId: null,
      envelopeStatus: 'none',
      signerMap,
      metadata: {
        clauseVersions: normalizeArray(template.clauses).map((clause) => ({
          clauseId: clause.clauseId ?? clause.clause_id ?? null,
          version: clause.version ?? null
        }))
      },
      wormRetainedUntil,
      legalHold: false,
      createdAt,
      updatedAt: createdAt,
      version: 0
    });
  }

  const docManifest = documents.map((doc) => buildManifestEntry(doc));
  const pack = {
    packId,
    legId: context.legId,
    status: 'draft',
    generatorVersion,
    city: context.city,
    docManifest,
    issuedAt: null,
    signedAt: null,
    supersededBy: null,
    legalHold: false,
    wormRetainedUntil: computeRetentionTimestamp(createdAt, { years: retentionYears }),
    createdAt,
    updatedAt: createdAt,
    version: 0
  };

  return { pack, documents };
}

export function transitionPackStatus(pack, nextStatus, { nowIso = new Date().toISOString(), supersededBy = null } = {}) {
  assertDocs(pack, 'DOC_PACK_REQUIRED', 'Pack is required for status transition.');
  assertDocs(PACK_STATUSES.has(nextStatus), 'DOC_STATUS_INVALID', 'Unsupported pack status transition.', {
    nextStatus
  });
  const updatedAt = normalizeIsoTimestamp(nowIso, { field: 'nowIso' });
  const next = { ...pack, status: nextStatus, updatedAt };

  if (nextStatus === 'issued') {
    next.issuedAt = updatedAt;
  }
  if (nextStatus === 'signed') {
    next.signedAt = updatedAt;
  }
  if (nextStatus === 'superseded') {
    next.supersededBy = supersededBy;
  }

  return next;
}
