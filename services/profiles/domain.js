const ROLE_ALLOWLISTS = {
  modelGenres: new Set(['fashion', 'editorial', 'commercial', 'runway', 'beauty', 'fitness', 'swim']),
  photographerSpecialties: new Set(['portrait', 'fashion', 'editorial', 'wedding', 'music', 'commercial', 'product']),
  videographerSpecialties: new Set(['music', 'commercial', 'wedding', 'documentary', 'event']),
  creatorPlatforms: new Set(['instagram', 'tiktok', 'youtube', 'x', 'twitch', 'kick']),
  creatorCategories: new Set(['fashion', 'beauty', 'lifestyle', 'gaming', 'travel', 'education'])
};

const ROLE_RANGES = {
  model: {
    height_cm: [120, 210],
    bust_cm: [40, 150],
    waist_cm: [40, 150],
    hips_cm: [40, 150],
    experience_years: [0, 50]
  },
  photographer: {
    editing_turnaround_days: [0, 30]
  },
  videographer: {
    editing_turnaround_days: [0, 45]
  }
};

const DEFAULT_COMPLETENESS_THRESHOLD = 70;
const SAFE_MODE_ALLOWED_BAND = 1;

function pushIssue(collection, issue) {
  collection.push({
    severity: 'error',
    ...issue,
    path: issue.path ?? []
  });
}

function pushWarning(collection, issue) {
  collection.push({
    severity: 'warning',
    ...issue,
    path: issue.path ?? []
  });
}

function normalizeLanguages(languages = []) {
  if (!Array.isArray(languages)) return [];
  return Array.from(
    new Set(
      languages
        .filter((value) => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ).slice(0, 5);
}

function normalizeTags(tags = []) {
  if (!Array.isArray(tags)) return [];
  return Array.from(
    new Set(
      tags
        .filter((value) => typeof value === 'string')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    )
  ).slice(0, 12);
}

function validatePricingPackages(packages, issues) {
  if (!Array.isArray(packages) || packages.length === 0) {
    pushIssue(issues, {
      code: 'PRICING_REQUIRED',
      message: 'At least one pricing package must be provided.',
      path: ['pricing_fields']
    });
    return;
  }

  let meetsFloor = false;
  let durationOk = false;

  packages.forEach((pkg, index) => {
    if (typeof pkg !== 'object' || pkg === null) {
      pushIssue(issues, {
        code: 'PRICING_NOT_OBJECT',
        message: 'Pricing entries must be JSON objects.',
        path: ['pricing_fields', String(index)]
      });
      return;
    }

    if (typeof pkg.price_cents !== 'number' || pkg.price_cents < 1000) {
      pushIssue(issues, {
        code: 'PRICING_FLOOR',
        message: 'Package price must be at least 1000 cents ($10).',
        path: ['pricing_fields', String(index), 'price_cents'],
        meta: { value: pkg.price_cents }
      });
    } else {
      meetsFloor = true;
    }

    if (typeof pkg.duration_min !== 'number' || pkg.duration_min < 30) {
      pushIssue(issues, {
        code: 'DURATION_MINIMUM',
        message: 'Package duration must be at least 30 minutes.',
        path: ['pricing_fields', String(index), 'duration_min'],
        meta: { value: pkg.duration_min }
      });
    } else {
      durationOk = true;
    }

    if (Array.isArray(pkg.addons)) {
      pkg.addons.forEach((addon, addonIndex) => {
        if (typeof addon.price_cents !== 'number' || addon.price_cents < 100) {
          pushIssue(issues, {
            code: 'ADDON_FLOOR',
            message: 'Addon price must be at least 100 cents ($1).',
            path: ['pricing_fields', String(index), 'addons', String(addonIndex), 'price_cents'],
            meta: { value: addon.price_cents }
          });
        }
      });
    }
  });

  if (!meetsFloor) {
    pushIssue(issues, {
      code: 'PRICING_NO_FLOOR_PACKAGE',
      message: 'At least one package must meet the minimum price threshold.',
      path: ['pricing_fields']
    });
  }
  if (!durationOk) {
    pushIssue(issues, {
      code: 'PRICING_NO_DURATION_PACKAGE',
      message: 'At least one package must meet the minimum duration threshold.',
      path: ['pricing_fields']
    });
  }
}

function validateSocialFields(socialFields, issues, warnings) {
  if (!socialFields || typeof socialFields !== 'object') {
    return;
  }

  Object.entries(socialFields).forEach(([platform, value]) => {
    if (value === null || typeof value !== 'object') {
      pushWarning(warnings, {
        code: 'SOCIAL_NOT_OBJECT',
        message: 'Social entries should be JSON objects; ignoring malformed entry.',
        path: ['social_fields', platform]
      });
      return;
    }

    Object.entries(value).forEach(([key, metric]) => {
      if (typeof metric === 'number' && metric < 0) {
        pushIssue(issues, {
          code: 'SOCIAL_NEGATIVE_METRIC',
          message: 'Social metrics must be non-negative numbers.',
          path: ['social_fields', platform, key],
          meta: { value: metric }
        });
      }
    });
  });
}

function validateRoleAboutFields(role, aboutFields, issues) {
  if (!aboutFields || typeof aboutFields !== 'object') {
    pushIssue(issues, {
      code: 'ABOUT_REQUIRED',
      message: 'About fields are required and must be an object.',
      path: ['about_fields']
    });
    return;
  }

  if (typeof aboutFields.bio !== 'string' || aboutFields.bio.trim().length === 0) {
    pushIssue(issues, {
      code: 'BIO_REQUIRED',
      message: 'Bio is required and cannot be empty.',
      path: ['about_fields', 'bio']
    });
  } else if (aboutFields.bio.length > 600) {
    pushIssue(issues, {
      code: 'BIO_TOO_LONG',
      message: 'Bio must be 600 characters or fewer.',
      path: ['about_fields', 'bio'],
      meta: { length: aboutFields.bio.length }
    });
  }

  if (role === 'model') {
    validateNumericRange(aboutFields, 'height_cm', ROLE_RANGES.model.height_cm, issues);
    ['bust_cm', 'waist_cm', 'hips_cm'].forEach((field) => {
      validateNumericRange(aboutFields, field, ROLE_RANGES.model[field], issues);
    });
    validateNumericRange(aboutFields, 'experience_years', ROLE_RANGES.model.experience_years, issues);
    validateAllowlistArray(aboutFields, 'genres', ROLE_ALLOWLISTS.modelGenres, issues);
  }

  if (role === 'photographer') {
    validateAllowlistArray(aboutFields, 'specialties', ROLE_ALLOWLISTS.photographerSpecialties, issues);
    validateBooleanField(aboutFields, 'insurance', issues);
    validateBooleanField(aboutFields, 'studio_access', issues);
    validateNumericRange(aboutFields, 'editing_turnaround_days', ROLE_RANGES.photographer.editing_turnaround_days, issues);
  }

  if (role === 'videographer') {
    validateAllowlistArray(aboutFields, 'specialties', ROLE_ALLOWLISTS.videographerSpecialties, issues);
    validateBooleanField(aboutFields, 'audio_capability', issues);
    validateNumericRange(aboutFields, 'editing_turnaround_days', ROLE_RANGES.videographer.editing_turnaround_days, issues);
    if (!Array.isArray(aboutFields.deliverable_formats) || aboutFields.deliverable_formats.length === 0) {
      pushIssue(issues, {
        code: 'DELIVERABLE_FORMATS_REQUIRED',
        message: 'At least one deliverable format must be provided.',
        path: ['about_fields', 'deliverable_formats']
      });
    }
  }

  if (role === 'creator' || role === 'fansub') {
    validateAllowlistArray(aboutFields, 'platforms', ROLE_ALLOWLISTS.creatorPlatforms, issues);
    validateAllowlistArray(aboutFields, 'categories', ROLE_ALLOWLISTS.creatorCategories, issues);
    if (role === 'fansub' && aboutFields['18_plus'] !== true) {
      pushIssue(issues, {
        code: 'FANSUB_AGE_GATE_REQUIRED',
        message: 'FanSub profiles must explicitly set the 18+ flag.',
        path: ['about_fields', '18_plus']
      });
    }
  }
}

function validateNumericRange(subject, field, [min, max], issues) {
  const value = subject[field];
  if (typeof value !== 'number') {
    pushIssue(issues, {
      code: 'NUMERIC_REQUIRED',
      message: `${field} must be a number.`,
      path: ['about_fields', field]
    });
    return;
  }
  if (value < min || value > max) {
    pushIssue(issues, {
      code: 'NUMERIC_OUT_OF_RANGE',
      message: `${field} must be between ${min} and ${max}.`,
      path: ['about_fields', field],
      meta: { min, max, value }
    });
  }
}

function validateAllowlistArray(subject, field, allowlist, issues) {
  const values = subject[field];
  if (!Array.isArray(values) || values.length === 0) {
    pushIssue(issues, {
      code: 'ARRAY_REQUIRED',
      message: `${field} must be a non-empty array.`,
      path: ['about_fields', field]
    });
    return;
  }
  values.forEach((value, index) => {
    if (typeof value !== 'string' || !allowlist.has(value)) {
      pushIssue(issues, {
        code: 'VALUE_NOT_ALLOWED',
        message: `${value} is not an allowed value for ${field}.`,
        path: ['about_fields', field, String(index)],
        meta: { value }
      });
    }
  });
}

function validateBooleanField(subject, field, issues) {
  if (typeof subject[field] !== 'boolean') {
    pushIssue(issues, {
      code: 'BOOLEAN_REQUIRED',
      message: `${field} must be a boolean.`,
      path: ['about_fields', field]
    });
  }
}

export function validateServiceProfile(profileInput) {
  const issues = [];
  const warnings = [];

  const normalized = {
    role: profileInput.role,
    displayName: typeof profileInput.displayName === 'string' ? profileInput.displayName.trim() : '',
    slug: typeof profileInput.slug === 'string' ? profileInput.slug.trim().toLowerCase() : '',
    city: typeof profileInput.city === 'string' ? profileInput.city.trim() : '',
    region: typeof profileInput.region === 'string' ? profileInput.region.trim() : null,
    country: typeof profileInput.country === 'string' ? profileInput.country.trim() : '',
    aboutFields: profileInput.aboutFields ?? {},
    pricingFields: profileInput.pricingFields ?? [],
    socialFields: profileInput.socialFields ?? undefined,
    languages: normalizeLanguages(profileInput.languages),
    tags: normalizeTags(profileInput.tags),
    safeModeBand: typeof profileInput.safeModeBand === 'number' ? profileInput.safeModeBand : 0,
    verification: profileInput.verification ?? {},
    instantBook: Boolean(profileInput.instantBook)
  };

  if (!['model', 'photographer', 'videographer', 'creator', 'fansub'].includes(normalized.role)) {
    pushIssue(issues, {
      code: 'ROLE_UNSUPPORTED',
      message: 'Role must be one of model, photographer, videographer, creator, or fansub.',
      path: ['role'],
      meta: { role: normalized.role }
    });
  }

  if (normalized.displayName.length === 0) {
    pushIssue(issues, {
      code: 'DISPLAY_NAME_REQUIRED',
      message: 'Display name is required.',
      path: ['displayName']
    });
  }

  if (!/^[a-z0-9-]{3,64}$/.test(normalized.slug)) {
    pushIssue(issues, {
      code: 'SLUG_INVALID',
      message: 'Slug must be 3-64 characters, lowercase alphanumeric or hyphen.',
      path: ['slug'],
      meta: { slug: normalized.slug }
    });
  }

  if (normalized.city.length === 0 || normalized.country.length === 0) {
    pushIssue(issues, {
      code: 'LOCATION_REQUIRED',
      message: 'City and country are required.',
      path: ['city']
    });
  }

  if (profileInput.languages && profileInput.languages.length > 5) {
    pushWarning(warnings, {
      code: 'LANGUAGE_TRIMMED',
      message: 'Languages list trimmed to 5 entries.',
      path: ['languages']
    });
  }

  if (profileInput.tags && profileInput.tags.length > 12) {
    pushWarning(warnings, {
      code: 'TAGS_TRIMMED',
      message: 'Tags list trimmed to 12 entries.',
      path: ['tags']
    });
  }

  validateRoleAboutFields(normalized.role, normalized.aboutFields, issues);
  validatePricingPackages(normalized.pricingFields, issues);
  validateSocialFields(normalized.socialFields, issues, warnings);

  return {
    ok: issues.length === 0,
    issues,
    warnings,
    normalized
  };
}

export function computeCompletenessScore(profile, signals = {}) {
  const breakdown = new Map();
  let total = 0;

  const addScore = (key, value) => {
    if (value <= 0) return;
    breakdown.set(key, value);
    total += value;
  };

  // Identity verification
  if (signals.hasIdVerification) {
    addScore('identity', 20);
  }

  if (signals.hasBackgroundCheck) {
    addScore('backgroundCheck', 10);
  }

  const bioFilled = typeof profile.aboutFields?.bio === 'string' && profile.aboutFields.bio.trim().length >= 120;
  addScore('bioDepth', bioFilled ? 10 : 5);

  if (Array.isArray(profile.pricingFields) && profile.pricingFields.length > 0) {
    addScore('pricingCoverage', Math.min(20, 10 + profile.pricingFields.length * 3));
  }

  if (typeof signals.portfolioCount === 'number' && signals.portfolioCount > 0) {
    const normalized = Math.min(signals.portfolioCount, 12);
    addScore('portfolio', 5 + normalized * 2);
  }

  if (signals.primaryMediaApproved) {
    addScore('mediaModeration', 8);
  }

  if (signals.availabilityDays && signals.availabilityDays > 0) {
    addScore('availability', Math.min(10, signals.availabilityDays));
  }

  if (signals.reviewCount && signals.reviewCount > 0) {
    const ratingWeight = Math.min(signals.reviewCount, 15);
    addScore('reviews', ratingWeight);
    if (signals.reviewAverage && signals.reviewAverage >= 4.8 && signals.reviewCount >= 5) {
      addScore('topRatedBonus', 5);
    }
  }

  if (signals.hasInstantBook) {
    addScore('instantBook', 5);
  }

  if (signals.hasStudioLink) {
    addScore('studioLink', 4);
  }

  if (signals.socialFollowers && signals.socialFollowers > 0) {
    const followerBands = Math.min(Math.floor(Math.log10(signals.socialFollowers + 1)), 5);
    addScore('audience', followerBands * 2);
  }

  if (signals.docStatus === 'signed') {
    addScore('docsComplete', 4);
  }

  if (signals.payoutOnboarded) {
    addScore('payoutReady', 4);
  }

  const capped = total > 100;
  const score = Math.min(total, 100);

  return {
    score,
    capped,
    components: Object.fromEntries(breakdown)
  };
}

export function determinePublishReadiness(profileInput, signals = {}, options = {}) {
  const { ok, issues, warnings, normalized } = validateServiceProfile(profileInput);
  const completeness = computeCompletenessScore(normalized, signals);

  const blockingReasons = [...issues];
  const recommendedActions = new Set();
  const minScore = typeof options.minScore === 'number' ? options.minScore : DEFAULT_COMPLETENESS_THRESHOLD;
  const safeModeBand = typeof normalized.safeModeBand === 'number' ? normalized.safeModeBand : 0;
  const allowedBand = typeof options.maxSafeModeBand === 'number' ? options.maxSafeModeBand : SAFE_MODE_ALLOWED_BAND;

  if (completeness.score < minScore) {
    blockingReasons.push({
      code: 'LOW_COMPLETENESS',
      message: `Completeness score ${completeness.score} is below minimum threshold ${minScore}.`,
      path: ['completeness'],
      severity: 'error',
      meta: { score: completeness.score, threshold: minScore }
    });
    recommendedActions.add('Complete missing onboarding steps to raise completeness score.');
  }

  if (safeModeBand > allowedBand) {
    blockingReasons.push({
      code: 'SAFE_MODE_BLOCK',
      message: `Safe-Mode band ${safeModeBand} exceeds allowed band ${allowedBand} for publication.`,
      path: ['safeModeBand'],
      severity: 'error',
      meta: { safeModeBand, allowedBand }
    });
    recommendedActions.add('Submit SFW media or appeal moderation decision.');
  }

  if (options.requireSignedDocs && signals.docStatus !== 'signed') {
    blockingReasons.push({
      code: 'DOCS_NOT_SIGNED',
      message: 'Required legal documents must be signed before publishing.',
      path: ['docStatus'],
      severity: 'error'
    });
    recommendedActions.add('Sign required legal agreements.');
  }

  if (options.requirePayoutOnboarding && !signals.payoutOnboarded) {
    blockingReasons.push({
      code: 'PAYOUT_NOT_ONBOARDED',
      message: 'Stripe Connect onboarding must be completed before publishing.',
      path: ['payoutOnboarded'],
      severity: 'error'
    });
    recommendedActions.add('Complete payout onboarding in finance settings.');
  }

  return {
    publishable: ok && blockingReasons.length === 0,
    blockingReasons,
    warnings,
    score: completeness,
    recommendedActions: Array.from(recommendedActions),
    safeModeBand
  };
}

export function applySafeMode(mediaItems, profileSafeModeBand = 0, options = {}) {
  if (!Array.isArray(mediaItems) || mediaItems.length === 0) {
    return {
      visible: [],
      filtered: [],
      reason: undefined
    };
  }

  const safeModeEnabled = options.safeModeEnabled !== false;
  const allowedBand = options.allowedBand ?? (safeModeEnabled ? SAFE_MODE_ALLOWED_BAND : 2);
  const blurKey = options.blurVariantKey ?? 'blurUrl';
  const defaultPlaceholder = options.defaultPlaceholder ?? null;

  const visible = [];
  const filtered = [];

  mediaItems.forEach((item) => {
    const band = typeof item?.nsfwBand === 'number' ? item.nsfwBand : profileSafeModeBand;
    if (!safeModeEnabled || band <= allowedBand) {
      const clone = { ...item };
      if (safeModeEnabled && band === 1) {
        const blurVariant = clone[blurKey];
        if (typeof blurVariant === 'string') {
          clone.url = blurVariant;
        } else if (typeof clone.safePlaceholder === 'string') {
          clone.url = clone.safePlaceholder;
        } else if (defaultPlaceholder) {
          clone.url = defaultPlaceholder;
        }
        clone.safeModeApplied = true;
      }
      visible.push(clone);
    } else {
      filtered.push(item);
    }
  });

  let reason;
  if (filtered.length > 0 && safeModeEnabled) {
    reason = 'SAFE_MODE_FILTERED';
  }

  return { visible, filtered, reason };
}

export { DEFAULT_COMPLETENESS_THRESHOLD, SAFE_MODE_ALLOWED_BAND };
