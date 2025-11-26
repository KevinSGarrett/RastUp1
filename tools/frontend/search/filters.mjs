const ROLE_SPECIFIC_FILTERS = {
  MODEL: [
    {
      key: 'height',
      label: 'Height (cm)',
      type: 'range',
      min: 120,
      max: 210,
      step: 1
    },
    {
      key: 'genres',
      label: 'Genres',
      type: 'multi-select',
      options: ['fashion', 'editorial', 'commercial', 'beauty', 'runway']
    }
  ],
  PHOTOGRAPHER: [
    {
      key: 'specialties',
      label: 'Specialties',
      type: 'multi-select',
      options: ['portrait', 'fashion', 'editorial', 'wedding', 'event', 'product']
    },
    {
      key: 'studioAccess',
      label: 'Studio Access',
      type: 'boolean'
    }
  ],
  VIDEOGRAPHER: [
    {
      key: 'specialties',
      label: 'Specialties',
      type: 'multi-select',
      options: ['music', 'commercial', 'wedding', 'documentary']
    },
    {
      key: 'deliverableFormats',
      label: 'Deliverable Formats',
      type: 'multi-select',
      options: ['mp4', 'mov', 'prores', 'raw']
    }
  ],
  CREATOR: [
    {
      key: 'platforms',
      label: 'Platforms',
      type: 'multi-select',
      options: ['instagram', 'tiktok', 'youtube', 'x', 'snap']
    },
    {
      key: 'categories',
      label: 'Categories',
      type: 'multi-select',
      options: ['fashion', 'beauty', 'lifestyle', 'gaming', 'travel']
    }
  ],
  FANSUB: [
    {
      key: 'ageGate',
      label: '18+ Required',
      type: 'boolean'
    },
    {
      key: 'platforms',
      label: 'Platforms',
      type: 'multi-select',
      options: ['fansub', 'patreon', 'onlyfans', 'fansly']
    }
  ]
};

const GLOBAL_FILTERS = [
  {
    key: 'city',
    label: 'City',
    type: 'search-select',
    placeholder: 'City, Region'
  },
  {
    key: 'priceRange',
    label: 'Budget',
    type: 'range',
    min: 0,
    max: 100000,
    step: 500
  },
  {
    key: 'instantBook',
    label: 'Instant Book',
    type: 'boolean'
  },
  {
    key: 'verified',
    label: 'Verified',
    type: 'multi-select',
    options: ['ID', 'BACKGROUND', 'SOCIAL']
  },
  {
    key: 'availability',
    label: 'Availability',
    type: 'date-range'
  }
];

const STUDIO_FILTERS = [
  {
    key: 'amenities',
    label: 'Amenities',
    type: 'multi-select',
    options: [
      'natural light',
      'backdrops',
      'props',
      'makeup area',
      'changing room',
      'parking',
      'equipment rental'
    ]
  },
  {
    key: 'depositRequired',
    label: 'Deposit Required',
    type: 'boolean'
  },
  {
    key: 'verifiedStudio',
    label: 'Verified Studio',
    type: 'boolean'
  }
];

export function listFiltersForSurface(surface, role) {
  const normalizedSurface = typeof surface === 'string' ? surface.toUpperCase() : 'PEOPLE';
  if (normalizedSurface === 'STUDIOS') {
    return [...GLOBAL_FILTERS, ...STUDIO_FILTERS];
  }
  const normalizedRole = typeof role === 'string' ? role.toUpperCase() : null;
  const roleFilters = normalizedRole && ROLE_SPECIFIC_FILTERS[normalizedRole];
  return roleFilters ? [...GLOBAL_FILTERS, ...roleFilters] : [...GLOBAL_FILTERS];
}

export function serializeFilters(filters = {}) {
  const params = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      params[key] = value.join(',');
    } else if (typeof value === 'object') {
      params[key] = JSON.stringify(value);
    } else {
      params[key] = String(value);
    }
  }
  return params;
}

export function parseFilters(paramSource = {}) {
  const filters = {};
  for (const [key, rawValue] of Object.entries(paramSource)) {
    if (rawValue == null) continue;
    if (key === 'priceRange') {
      const [minStr, maxStr] = String(rawValue).split(':');
      const min = Number(minStr);
      const max = Number(maxStr);
      if (!Number.isNaN(min) || !Number.isNaN(max)) {
        filters[key] = {
          min: Number.isNaN(min) ? undefined : min,
          max: Number.isNaN(max) ? undefined : max
        };
      }
      continue;
    }
    if (key === 'availability') {
      try {
        if (typeof rawValue === 'string') {
          const parsed = JSON.parse(rawValue);
          if (parsed && typeof parsed === 'object') {
            filters[key] = parsed;
          }
        } else if (rawValue && typeof rawValue === 'object') {
          filters[key] = { ...rawValue };
        }
      } catch {
        // ignore malformed availability filters
      }
      continue;
    }
    if (typeof rawValue === 'string' && rawValue.includes(',')) {
      filters[key] = rawValue.split(',').map((value) => value.trim()).filter(Boolean);
      continue;
    }
    if (typeof rawValue === 'string') {
      try {
        const parsed = JSON.parse(rawValue);
        if (parsed && typeof parsed === 'object') {
          filters[key] = parsed;
          continue;
        }
      } catch {
        // fall through to plain string assignment
      }
      filters[key] = rawValue.trim();
      continue;
    }
    if (typeof rawValue === 'boolean') {
      filters[key] = rawValue;
      continue;
    }
    if (typeof rawValue === 'number') {
      filters[key] = rawValue;
    }
  }
  return filters;
}

export function applyFilterMetadata(selection = {}, filtersList = []) {
  const enriched = {};
  for (const descriptor of filtersList) {
    const value = selection[descriptor.key];
    if (value == null) continue;
    if (descriptor.type === 'multi-select') {
      const normalized = Array.isArray(value) ? value : String(value).split(',');
      enriched[descriptor.key] = {
        type: 'multi-select',
        values: normalized.map((item) => String(item))
      };
    } else if (descriptor.type === 'range') {
      enriched[descriptor.key] = {
        type: 'range',
        min: value.min ?? value[0] ?? descriptor.min ?? null,
        max: value.max ?? value[1] ?? descriptor.max ?? null
      };
    } else if (descriptor.type === 'boolean') {
      enriched[descriptor.key] = {
        type: 'boolean',
        value: Boolean(value)
      };
    } else if (descriptor.type === 'date-range') {
      enriched[descriptor.key] = {
        type: 'date-range',
        start: value.start ?? value.dateFrom ?? value.from ?? null,
        end: value.end ?? value.dateTo ?? value.to ?? null
      };
    } else {
      enriched[descriptor.key] = {
        type: descriptor.type,
        value
      };
    }
  }
  return enriched;
}

export function describeFilterValue(key, value) {
  if (value == null) return null;
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'number') {
    return value.toLocaleString();
  }
  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      return value.join(', ');
    }
    if (value.min !== undefined || value.max !== undefined) {
      const min = value.min != null ? value.min.toLocaleString() : '';
      const max = value.max != null ? value.max.toLocaleString() : '';
      if (min && max) return `${min} – ${max}`;
      if (min) return `≥ ${min}`;
      if (max) return `≤ ${max}`;
      return null;
    }
    if (value.start || value.end) {
      const start = value.start ?? value.dateFrom ?? value.from ?? '';
      const end = value.end ?? value.dateTo ?? value.to ?? '';
      if (start && end) return `${start} → ${end}`;
      return start || end || null;
    }
    return JSON.stringify(value);
  }
  return String(value);
}

export function defaultFilters() {
  return {
    instantBook: false,
    verified: [],
    priceRange: null,
    availability: null
  };
}
