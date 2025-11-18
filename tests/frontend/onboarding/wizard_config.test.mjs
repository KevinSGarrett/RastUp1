import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getWizardConfig,
  getNextIncompleteStep,
  getProgress,
} from '../../../tools/frontend/onboarding/wizard_config.mjs';

test('getNextIncompleteStep respects dependencies', () => {
  const steps = getWizardConfig('provider');
  assert.ok(steps.length > 0);
  const next = getNextIncompleteStep('provider', new Set(['identity', 'roles']));
  assert.equal(next, 'portfolio');
});

test('getProgress calculates weighted percentage', () => {
  const progress = getProgress('provider', ['identity', 'roles', 'portfolio']);
  assert.ok(progress.percentage > 30 && progress.percentage < 80);
  assert.equal(progress.completed, 3);
});
