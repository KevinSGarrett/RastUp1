'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition
} from 'react';

import {
  BOOKING_STATUS,
  createBookingStore
} from '../../../tools/frontend/booking/index.mjs';
import { createBookingDataSource } from '../../lib/booking';
import { emitTelemetry } from '../../lib/telemetry';
import { BookingPackageStep } from './BookingPackageStep';
import { BookingReviewStep } from './BookingReviewStep';
import { BookingScheduleStep } from './BookingScheduleStep';

type BookingStore = ReturnType<typeof createBookingStore>;
type BookingState = ReturnType<BookingStore['getState']>;
type NormalizedBooking = Parameters<typeof createBookingStore>[0];

type BookingDocumentLike = {
  required?: boolean | null;
  documentId?: string | null;
  name?: string | null;
};

export interface BookingPageProps {
  initialBooking: NormalizedBooking;
  serviceProfileId: string;
  dataSource?: ReturnType<typeof createBookingDataSource>;
}

function buildKey(serviceProfileId: string) {
  return serviceProfileId;
}

export function BookingPage({
  initialBooking,
  serviceProfileId,
  dataSource: injectedDataSource
}: BookingPageProps) {
  const initialKey = useMemo(() => buildKey(serviceProfileId), [serviceProfileId]);

  const [store] = useState<BookingStore>(() => createBookingStore(initialBooking));

  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(listener),
    [store]
  );
  const getSnapshot = useCallback<() => BookingState>(() => store.getState(), [store]);

  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const [pending, startTransition] = useTransition();
  const dataSource = useMemo(
    () => injectedDataSource ?? createBookingDataSource(),
    [injectedDataSource]
  );
  const [acceptedDocuments, setAcceptedDocuments] = useState<Set<string>>(new Set());
  const [paymentMethod, setPaymentMethod] = useState('card');
  const lastFetchKeyRef = useRef<string | null>(initialKey);

  useEffect(() => {
    store.hydrate(initialBooking);
    lastFetchKeyRef.current = initialKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey]);

  useEffect(() => {
    const key = buildKey(serviceProfileId);
    if (lastFetchKeyRef.current === key) {
      return;
    }
    lastFetchKeyRef.current = key;
    store.setStatus(BOOKING_STATUS.LOADING);

    startTransition(() => {
      dataSource
        .fetchBooking({ serviceProfileId })
        .then((payload: NormalizedBooking) => {
          store.hydrate(payload);
        })
        .catch((error: unknown) => {
          const safeMessage =
            error instanceof Error
              ? error.message
              : typeof error === 'string'
              ? error
              : 'booking_load_failed';
          store.setError(safeMessage);
        });
    });
  }, [dataSource, serviceProfileId, store, startTransition]);

  const handlePackageSelect = useCallback(
    (packageId: string) => {
      store.setPackage(packageId);
      emitTelemetry('booking:package_select', { packageId });
    },
    [store]
  );

  const handleAddonToggle = useCallback(
    (addonId: string) => {
      store.toggleAddon(addonId);
      emitTelemetry('booking:addon_toggle', { addonId });
    },
    [store]
  );

  const handleSlotSelect = useCallback(
    (date: string, slot: string) => {
      store.selectSlot(date, slot);
      emitTelemetry('booking:slot_select', { date, slot });
    },
    [store]
  );

  const handleNextStep = useCallback(() => {
    const snapshot = store.getState();
    store.setStep(snapshot.step + 1);
  }, [store]);

  const handlePrevStep = useCallback(() => {
    const snapshot = store.getState();
    store.setStep(snapshot.step - 1);
  }, [store]);

  const handleDocumentToggle = useCallback((documentId: string) => {
    setAcceptedDocuments((prev) => {
      const next = new Set(prev);
      if (next.has(documentId)) {
        next.delete(documentId);
      } else {
        next.add(documentId);
      }
      return next;
    });
  }, []);

  const handlePaymentMethodChange = useCallback((method: string) => {
    setPaymentMethod(method);
    emitTelemetry('booking:payment_method_select', { method });
  }, []);

  const handleSubmit = useCallback(() => {
    const snapshot = store.getState();
    emitTelemetry('booking:submit', {
      packageId: snapshot.selectedPackageId,
      addons: Array.from(snapshot.selectedAddonIds),
      slot: snapshot.selectedSlot,
      paymentMethod
    });
    // In future, trigger actual mutation. For now show toast/alert.
    alert('Booking submitted! (stub)');
  }, [paymentMethod, store]);

  const documents = (state.documents ?? []) as BookingDocumentLike[];

  const requiresDocuments = documents.some((doc) => doc.required);
  const missingRequiredDocuments =
    requiresDocuments &&
    documents
      .filter((doc) => doc.required)
      .some((doc) => !acceptedDocuments.has(doc.documentId ?? doc.name ?? ''));

  const isSubmitDisabled = missingRequiredDocuments || !state.selectedSlot;

  return (
    <div className="booking-page">
      <header className="booking-page__header">
        <h1 className="booking-page__title">
          Book {state.serviceProfile?.displayName ?? 'Service Profile'}
        </h1>
        <p className="booking-page__subtitle">
          Complete the booking flow in three steps: choose package, schedule time, and confirm
          documents &amp; payment.
        </p>
      </header>

      {state.status === BOOKING_STATUS.ERROR ? (
        <div className="booking-page__banner" role="alert">
          We hit a problem loading booking data. {state.error}
        </div>
      ) : null}

      {pending || state.status === BOOKING_STATUS.LOADING ? (
        <div className="booking-page__loading" role="status" aria-live="polite">
          Loading booking details…
        </div>
      ) : null}

      <div className="booking-page__layout">
        <main className="booking-page__main">
          <nav className="booking-page__steps" aria-label="Booking progress">
            <ol>
              <li className={state.step === 1 ? 'active' : state.step > 1 ? 'completed' : ''}>
                Package
              </li>
              <li className={state.step === 2 ? 'active' : state.step > 2 ? 'completed' : ''}>
                Schedule
              </li>
              <li className={state.step === 3 ? 'active' : ''}>Review</li>
            </ol>
          </nav>

          {state.step === 1 ? (
            <BookingPackageStep
              packages={state.packages}
              selectedPackageId={state.selectedPackageId}
              selectedAddonIds={state.selectedAddonIds}
              onSelectPackage={handlePackageSelect}
              onToggleAddon={handleAddonToggle}
            />
          ) : null}

          {state.step === 2 ? (
            <BookingScheduleStep
              availability={state.availability}
              selectedSlot={state.selectedSlot}
              onSelectSlot={handleSlotSelect}
            />
          ) : null}

          {state.step === 3 ? (
            <BookingReviewStep
              serviceProfile={state.serviceProfile}
              price={state.price}
              documents={state.documents}
              acceptedDocuments={acceptedDocuments}
              onToggleDocument={handleDocumentToggle}
              paymentMethod={paymentMethod}
              onChangePaymentMethod={handlePaymentMethodChange}
            />
          ) : null}

          <div className="booking-page__controls">
            <button type="button" disabled={state.step === 1} onClick={handlePrevStep}>
              Back
            </button>
            {state.step < 3 ? (
              <button
                type="button"
                onClick={handleNextStep}
                disabled={state.step === 2 && !state.selectedSlot}
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                className="booking-page__submit"
                onClick={handleSubmit}
                disabled={isSubmitDisabled}
              >
                Confirm booking
              </button>
            )}
          </div>
        </main>

        <aside className="booking-page__summary">
          <h2 className="booking-page__summary-title">Summary</h2>
          <dl className="booking-page__pricing">
            <dt>Package</dt>
            <dd>{state.selectedPackageId ?? 'Not selected'}</dd>
            <dt>Base</dt>
            <dd>{state.price.base ? `$${(state.price.base / 100).toLocaleString()}` : '—'}</dd>
            <dt>Add-ons</dt>
            <dd>
              {state.price.addons ? `$${(state.price.addons / 100).toLocaleString()}` : '—'}
            </dd>
            <dt>Subtotal</dt>
            <dd>${(state.price.subtotal / 100).toLocaleString()}</dd>
            <dt>Taxes</dt>
            <dd>${(state.price.taxes / 100).toLocaleString()}</dd>
            <dt>Platform fees</dt>
            <dd>${(state.price.fees / 100).toLocaleString()}</dd>
            <dt className="booking-page__pricing-total">Total due</dt>
            <dd className="booking-page__pricing-total">
              ${(state.price.total / 100).toLocaleString()}
            </dd>
          </dl>

          <div className="booking-page__slot-summary">
            <h3>Selected slot</h3>
            {state.selectedSlot ? (
              <p>
                {state.selectedSlot.date} at {state.selectedSlot.slot}
              </p>
            ) : (
              <p>No slot selected.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
