export function normalizeGraphqlBooking(payload = {}) {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  const serviceProfile = payload.serviceProfile ?? payload.profile ?? null;
  const packages = Array.isArray(payload.packages) ? payload.packages : [];
  const availability = Array.isArray(payload.availability)
    ? payload.availability
    : Array.isArray(payload.calendar)
    ? payload.calendar
    : [];

  return {
    serviceProfile: serviceProfile
      ? {
          id: serviceProfile.id ?? null,
          handle: serviceProfile.handle ?? null,
          displayName: serviceProfile.displayName ?? serviceProfile.name ?? 'Service Profile',
          role: serviceProfile.role ?? null,
          heroImage: serviceProfile.heroImage ?? null,
          city: serviceProfile.city ?? serviceProfile.location?.city ?? null
        }
      : null,
    packages: packages.map((pkg) => ({
      packageId: pkg.packageId ?? pkg.id ?? null,
      name: pkg.name ?? 'Package',
      description: pkg.description ?? null,
      priceCents: pkg.priceCents ?? pkg.price ?? null,
      durationMinutes: pkg.durationMinutes ?? pkg.duration ?? null,
      includes: Array.isArray(pkg.includes) ? pkg.includes : [],
      addons: Array.isArray(pkg.addons)
        ? pkg.addons.map((addon) => ({
            addonId: addon.addonId ?? addon.id ?? addon.name ?? null,
            name: addon.name ?? 'Add-on',
            priceCents: addon.priceCents ?? addon.price ?? null
          }))
        : []
    })),
    availability: availability.map((entry) => ({
      date: entry.date ?? entry.day ?? null,
      slots: Array.isArray(entry.slots)
        ? entry.slots
        : Array.isArray(entry.times)
        ? entry.times
        : []
    })),
    documents: Array.isArray(payload.documents)
      ? payload.documents.map((doc) => ({
          documentId: doc.documentId ?? doc.id ?? null,
          name: doc.name ?? 'Document',
          required: doc.required ?? true
        }))
      : []
  };
}
