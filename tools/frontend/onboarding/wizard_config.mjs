const PROVIDER_STEPS = [
  {
    id: 'identity',
    title: 'Identity & Basics',
    weight: 0.18,
    requires: [],
    autosaveKey: 'profile.identity',
  },
  {
    id: 'roles',
    title: 'Roles & Tags',
    weight: 0.1,
    requires: ['identity'],
    autosaveKey: 'profile.roles',
  },
  {
    id: 'portfolio',
    title: 'Portfolio Media',
    weight: 0.22,
    requires: ['identity'],
    autosaveKey: 'profile.portfolio',
  },
  {
    id: 'pricing',
    title: 'Packages & Pricing',
    weight: 0.16,
    requires: ['roles'],
    autosaveKey: 'profile.pricing',
  },
  {
    id: 'availability',
    title: 'Availability',
    weight: 0.14,
    requires: ['pricing'],
    autosaveKey: 'profile.availability',
  },
  {
    id: 'verification',
    title: 'Verification',
    weight: 0.12,
    requires: ['identity'],
    autosaveKey: 'profile.verification',
  },
  {
    id: 'review',
    title: 'Review & Publish',
    weight: 0.08,
    requires: ['portfolio', 'pricing', 'verification'],
    terminal: true,
  },
];

const HOST_STEPS = [
  {
    id: 'basics',
    title: 'Studio Basics',
    weight: 0.2,
    requires: [],
    autosaveKey: 'studio.basics',
  },
  {
    id: 'policies',
    title: 'Amenities & Policies',
    weight: 0.16,
    requires: ['basics'],
    autosaveKey: 'studio.policies',
  },
  {
    id: 'pricing',
    title: 'Pricing & Deposits',
    weight: 0.18,
    requires: ['basics'],
    autosaveKey: 'studio.pricing',
  },
  {
    id: 'availability',
    title: 'Availability & Buffers',
    weight: 0.16,
    requires: ['pricing'],
    autosaveKey: 'studio.availability',
  },
  {
    id: 'verification',
    title: 'Verification',
    weight: 0.18,
    requires: ['basics'],
    autosaveKey: 'studio.verification',
  },
  {
    id: 'publish',
    title: 'Publish Preview',
    weight: 0.12,
    requires: ['policies', 'verification'],
    terminal: true,
  },
];

const STEP_CONFIG = {
  provider: PROVIDER_STEPS,
  host: HOST_STEPS,
};

/**
 * Returns a cloned step array for the given role.
 * @param {'provider'|'host'} role
 */
export function getWizardConfig(role) {
  const steps = STEP_CONFIG[role];
  if (!steps) return [];
  return steps.map((step) => ({ ...step, requires: [...(step.requires ?? [])] }));
}

export function getStep(role, stepId) {
  return getWizardConfig(role).find((step) => step.id === stepId) ?? null;
}

/**
 * Determines the next step that is incomplete.
 * @param {'provider'|'host'} role
 * @param {Set<string>|string[]} completedSteps
 * @returns {string|null}
 */
export function getNextIncompleteStep(role, completedSteps = []) {
  const completed = completedSteps instanceof Set ? completedSteps : new Set(completedSteps);
  const steps = getWizardConfig(role);
  for (const step of steps) {
    const dependenciesMet = (step.requires ?? []).every((req) => completed.has(req));
    if (!completed.has(step.id) && dependenciesMet) {
      return step.id;
    }
  }
  return null;
}

/**
 * Calculates overall progress.
 * @param {'provider'|'host'} role
 * @param {Set<string>|string[]} completedSteps
 * @returns {{percentage: number, completed: number, total: number}}
 */
export function getProgress(role, completedSteps = []) {
  const steps = getWizardConfig(role);
  const completed = completedSteps instanceof Set ? completedSteps : new Set(completedSteps);
  const totalWeight = steps.reduce((sum, step) => sum + (step.weight ?? 0), 0) || 1;
  const acquired = steps.filter((step) => completed.has(step.id)).reduce(
    (sum, step) => sum + (step.weight ?? 0),
    0,
  );

  return {
    percentage: Math.round((acquired / totalWeight) * 100),
    completed: completed.size,
    total: steps.length,
  };
}

export const WIZARD_CONFIG = STEP_CONFIG;
