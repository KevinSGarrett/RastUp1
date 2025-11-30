'use client';

interface ProfilePackage {
  packageId?: string | null;
  name?: string | null;
  description?: string | null;
  priceCents?: number | null;
  durationMinutes?: number | null;
  includes?: string[];
  addons?: Array<{ name?: string; priceCents?: number }>;
}

interface ProfilePackagesProps {
  packages: ProfilePackage[];
}

function formatPrice(priceCents?: number | null) {
  if (priceCents == null) return 'Custom quote';
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
  return formatter.format(priceCents / 100);
}

function formatDuration(durationMinutes?: number | null) {
  if (!durationMinutes) return null;
  if (durationMinutes % 60 === 0) {
    const hours = durationMinutes / 60;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${durationMinutes} minutes`;
}

export function ProfilePackages({ packages }: ProfilePackagesProps) {
  if (!packages.length) {
    return null;
  }

  return (
    <section className="profile-packages" aria-label="Packages and pricing">
      <h2 className="profile-packages__title">Packages & Pricing</h2>
      <ul className="profile-packages__list">
        {packages.map((pkg) => (
          <li key={pkg.packageId ?? pkg.name ?? 'pkg'} className="profile-packages__item">
            <div className="profile-packages__header">
              <h3 className="profile-packages__name">{pkg.name ?? 'Package'}</h3>
              <span className="profile-packages__price">{formatPrice(pkg.priceCents)}</span>
            </div>
            {pkg.description ? (
              <p className="profile-packages__description">{pkg.description}</p>
            ) : null}
            <ul className="profile-packages__includes">
              {pkg.includes?.map((item) => (
                <li key={item} className="profile-packages__include">
                  {item}
                </li>
              ))}
              {pkg.durationMinutes ? (
                <li className="profile-packages__include">
                  Duration: {formatDuration(pkg.durationMinutes)}
                </li>
              ) : null}
            </ul>
            {pkg.addons?.length ? (
              <div className="profile-packages__addons">
                <h4 className="profile-packages__addons-title">Add-ons</h4>
                <ul>
                  {pkg.addons.map((addon) => (
                    <li key={`${pkg.packageId ?? pkg.name}-${addon.name}`} className="profile-packages__addon">
                      <span>{addon.name}</span>
                      <span>{formatPrice(addon.priceCents ?? null)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
