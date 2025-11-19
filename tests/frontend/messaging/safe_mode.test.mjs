import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  computeSafeModeState,
  getAttachmentDisplayState,
  filterMessageBody
} from '../../../tools/frontend/messaging/safe_mode.mjs';

test('computeSafeModeState enforces required threads and allows overrides for verified adults', () => {
  let state = computeSafeModeState({
    threadSafeModeRequired: true,
    threadBandMax: 1,
    userIsVerifiedAdult: true,
    userOverrideRequested: true,
    allowOverride: true
  });
  assert.equal(state.enabled, true);
  assert.equal(state.overrideAllowed, false);

  state = computeSafeModeState({
    threadSafeModeRequired: false,
    threadBandMax: 1,
    userIsVerifiedAdult: true,
    allowOverride: true,
    userOverrideRequested: true
  });
  assert.equal(state.enabled, false);
  assert.equal(state.bandMax, 2);
  assert.equal(state.reason, 'OVERRIDE_ACTIVE');
});

test('getAttachmentDisplayState returns pending/quarantined states', () => {
  let display = getAttachmentDisplayState({
    status: 'UPLOADING',
    nsfwBand: 0,
    safeMode: { enabled: true, bandMax: 1 }
  });
  assert.equal(display.displayState, 'pending');

  display = getAttachmentDisplayState({
    status: 'QUARANTINED'
  });
  assert.equal(display.displayState, 'quarantined');
});

test('getAttachmentDisplayState applies Safe-Mode thresholds', () => {
  let display = getAttachmentDisplayState({
    nsfwBand: 0,
    safeMode: { enabled: true, bandMax: 1 },
    status: 'READY'
  });
  assert.equal(display.displayState, 'visible');

  display = getAttachmentDisplayState({
    nsfwBand: 2,
    safeMode: { enabled: true, bandMax: 1 },
    status: 'READY'
  });
  assert.equal(display.displayState, 'blurred');

  display = getAttachmentDisplayState({
    nsfwBand: 5,
    safeMode: { enabled: true, bandMax: 1 },
    status: 'READY'
  });
  assert.equal(display.displayState, 'blocked');

  display = getAttachmentDisplayState({
    nsfwBand: 2,
    safeMode: { enabled: false, bandMax: 1 },
    status: 'READY'
  });
  assert.equal(display.displayState, 'visible');
});

test('filterMessageBody redacts text when Safe-Mode requires it', () => {
  const safe = { enabled: true, bandMax: 1 };
  let result = filterMessageBody('Safe content', { safeMode: safe, nsfwBand: 1 });
  assert.equal(result.body, 'Safe content');
  assert.equal(result.redacted, false);

  result = filterMessageBody('Spicy content', { safeMode: safe, nsfwBand: 3 });
  assert.equal(result.redacted, true);
  assert.ok(result.body.includes('Safe-Mode'));
});

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));
const SAFE_MODE_FIXTURE = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'fixtures', 'safe_mode_matrix.json'), 'utf-8')
);

test('safe mode matrix fixture aligns with helper outputs', () => {
  for (const entry of SAFE_MODE_FIXTURE.bandMatrix) {
    const safe = {
      enabled: entry.safeModeEnabled ?? true,
      bandMax: entry.safeModeBandMax
    };
    const display = getAttachmentDisplayState({
      nsfwBand: entry.nsfwBand,
      safeMode: safe
    });
    assert.equal(display.displayState, entry.expectedDisplay);
  }

  for (const scenario of SAFE_MODE_FIXTURE.overrideCases) {
    const state = computeSafeModeState({
      threadSafeModeRequired: scenario.threadSafeModeRequired,
      userIsVerifiedAdult: scenario.userIsVerifiedAdult,
      allowOverride: scenario.allowOverride,
      userOverrideRequested: scenario.userOverrideRequested
    });
    assert.equal(state.enabled, scenario.expectedEnabled);
  }
});
