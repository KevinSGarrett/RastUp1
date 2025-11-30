'use client';

interface BookingAddon {
  addonId?: string | null;
  name?: string | null;
  priceCents?: number | null;
}

interface BookingPackage {
  packageId?: string | null;
  name?: string | null;
  description?: string | null;
  priceCents?: number | null;
  durationMinutes?: number | null;
  includes?: string[];
  addons?: BookingAddon[];
}

interface BookingPackageStepProps {
  packages: BookingPackage[];
  selectedPackageId: string | null;
  selectedAddonIds: Set<string>;
  onSelectPackage: (packageId: string) => void;
  onToggleAddon: (addonId: string) => void;
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

export function BookingPackageStep({
  packages,
  selectedPackageId,
  selectedAddonIds,
  onSelectPackage,
  onToggleAddon
}: BookingPackageStepProps) {
  return (
    <section className="booking-step booking-step--packages" aria-labelledby="booking-step-packages-title">
      <h2 id="booking-step-packages-title" className="booking-step__title">
        Choose your package
      </h2>
      <p className="booking-step__description">
        Select the package that matches your project. Add-ons can be toggled for additional services.
      </p>
      <div className="booking-packages">
        {packages.map((pkg) => {
          const isSelected = pkg.packageId === selectedPackageId;
          const addons = pkg.addons ?? [];
          return (
            <article
              key={pkg.packageId ?? pkg.name ?? 'package'}
              className={`booking-packages__card${isSelected ? ' booking-packages__card--selected' : ''}`}
            >
              <header className="booking-packages__header">
                <div className="booking-packages__header-main">
                  <input
                    type="radio"
                    id={`package-${pkg.packageId}`}
                    name="booking-package"
                    checked={isSelected}
                    onChange={() => onSelectPackage(pkg.packageId ?? '')}
                  />
                  <label htmlFor={`package-${pkg.packageId}`} className="booking-packages__name">
                    {pkg.name ?? 'Package'}
                  </label>
                </div>
                <span className="booking-packages__price">{formatPrice(pkg.priceCents)}</span>
              </header>
              {pkg.description ? (
                <p className="booking-packages__description">{pkg.description}</p>
              ) : null}
              <ul className="booking-packages__includes">
                {pkg.includes?.map((item) => (
                  <li key={item}>{item}</li>
                ))}
                {formatDuration(pkg.durationMinutes) ? (
                  <li>Duration: {formatDuration(pkg.durationMinutes)}</li>
                ) : null}
              </ul>
              {addons.length ? (
                <div className="booking-packages__addons">
                  <h3 className="booking-packages__addons-title">Add-ons</h3>
                  <ul>
                    {addons.map((addon) => {
                      const addonId = addon.addonId ?? addon.name ?? '';
                      const addonSelected = selectedAddonIds.has(addonId);
                      return (
                        <li key={addonId} className="booking-packages__addon">
                          <label className="booking-packages__addon-label">
                            <input
                              type="checkbox"
                              checked={addonSelected}
                              onChange={() => onToggleAddon(addonId)}
                              disabled={!isSelected}
                            />
                            <span>{addon.name ?? 'Add-on'}</span>
                          </label>
                          <span className="booking-packages__addon-price">
                            {formatPrice(addon.priceCents)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
