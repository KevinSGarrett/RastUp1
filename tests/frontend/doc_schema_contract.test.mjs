import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const schemaPath = join(__dirname, '..', '..', 'api', 'schema', 'booking.graphql');

let schema;

test('load booking schema for DocPack contract assertions', async () => {
  schema = await readFile(schemaPath, 'utf-8');
  assert.ok(schema.includes('enum DocPackStatus'));
});

test('DocPackStatus enum exposes required values', () => {
  const match = schema.match(/enum DocPackStatus\s*\{([^}]+)\}/);
  assert.ok(match, 'DocPackStatus enum missing');
  const values = match[1].trim().split(/\s+/).filter(Boolean);
  assert.deepEqual(values, ['DRAFT', 'ISSUED', 'SIGNED', 'VOIDED', 'SUPERSEDED']);
});

test('DocEnvelopeStatus enum exposes required values', () => {
  const match = schema.match(/enum DocEnvelopeStatus\s*\{([^}]+)\}/);
  assert.ok(match, 'DocEnvelopeStatus enum missing');
  const values = match[1].trim().split(/\s+/).filter(Boolean);
  assert.deepEqual(values, ['NONE', 'SENT', 'COMPLETED', 'VOIDED', 'EXPIRED']);
});

test('DocPack type surfaces manifest and retention fields', () => {
  assert.ok(schema.includes('type DocManifestEntry'));
  assert.ok(schema.includes('manifest: [DocManifestEntry!]!'));
  assert.ok(schema.includes('wormRetainedUntil: AWSDateTime!'));
  assert.ok(schema.includes('legalHold: Boolean!'));
});

test('createDocPack mutation adopts structured input', () => {
  assert.ok(schema.includes('createDocPack(input: CreateDocPackInput!)'));
  assert.ok(schema.includes('input CreateDocPackInput'));
});

test('docPack queries are exposed under booking Query extension', () => {
  assert.ok(schema.includes('docPack(packId: ID!): DocPack!'));
  assert.ok(schema.includes('docPacks(lbgId: ID!): [DocPack!]!'));
});
