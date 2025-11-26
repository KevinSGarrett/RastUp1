'use client';

interface BookingReviewStepProps {
  serviceProfile?: { displayName?: string | null; role?: string | null; city?: string | null } | null;
  price: { base: number; addons: number; subtotal: number; taxes: number; fees: number; total: number };
  documents: Array<{ documentId?: string | null; name?: string | null; required?: boolean }>;
  acceptedDocuments: Set<string>;
  onToggleDocument: (documentId: string) => void;
  paymentMethod: string;
  onChangePaymentMethod: (method: string) => void;
}

function formatCurrency(value: number) {
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
  return formatter.format(value / 100);
}

export function BookingReviewStep({
  serviceProfile,
  price,
  documents,
  acceptedDocuments,
  onToggleDocument,
  paymentMethod,
  onChangePaymentMethod
}: BookingReviewStepProps) {
  return (
    <section className="booking-step booking-step--review" aria-labelledby="booking-step-review-title">
      <h2 id="booking-step-review-title" className="booking-step__title">
        Review & confirm
      </h2>
      <p className="booking-step__description">
        Sign required documents and choose your payment method. Payment is authorized at confirmation and captured once deliverables are complete.
      </p>

      <div className="booking-review">
        <div className="booking-review__section">
          <h3 className="booking-review__section-title">Service summary</h3>
          <dl className="booking-review__summary">
            <dt>Talent</dt>
            <dd>{serviceProfile?.displayName ?? 'Service profile'}</dd>
            <dt>Role</dt>
            <dd>{serviceProfile?.role ?? 'N/A'}</dd>
            <dt>City</dt>
            <dd>{serviceProfile?.city ?? 'N/A'}</dd>
          </dl>
        </div>

        <div className="booking-review__section">
          <h3 className="booking-review__section-title">Pricing breakdown</h3>
          <dl className="booking-review__pricing">
            <dt>Package</dt>
            <dd>{formatCurrency(price.base)}</dd>
            <dt>Add-ons</dt>
            <dd>{formatCurrency(price.addons)}</dd>
            <dt>Subtotal</dt>
            <dd>{formatCurrency(price.subtotal)}</dd>
            <dt>Taxes</dt>
            <dd>{formatCurrency(price.taxes)}</dd>
            <dt>Platform fees</dt>
            <dd>{formatCurrency(price.fees)}</dd>
            <dt className="booking-review__total">Total due</dt>
            <dd className="booking-review__total">{formatCurrency(price.total)}</dd>
          </dl>
        </div>

        <div className="booking-review__section">
          <h3 className="booking-review__section-title">Documents</h3>
          <ul className="booking-review__documents">
            {documents.map((doc) => {
              const id = doc.documentId ?? doc.name ?? '';
              const checked = acceptedDocuments.has(id);
              return (
                <li key={id} className="booking-review__document">
                  <label>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleDocument(id)}
                    />
                    <span>
                      {doc.name ?? 'Document'} {doc.required ? '(required)' : '(optional)'}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="booking-review__section">
          <h3 className="booking-review__section-title">Payment method</h3>
          <div className="booking-review__payment-options">
            <label>
              <input
                type="radio"
                name="booking-payment-method"
                value="card"
                checked={paymentMethod === 'card'}
                onChange={(event) => onChangePaymentMethod(event.target.value)}
              />
              Credit / Debit Card
            </label>
            <label>
              <input
                type="radio"
                name="booking-payment-method"
                value="ach"
                checked={paymentMethod === 'ach'}
                onChange={(event) => onChangePaymentMethod(event.target.value)}
              />
              ACH Transfer
            </label>
          </div>
        </div>
      </div>
    </section>
  );
}
