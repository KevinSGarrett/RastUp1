import { normalizeGraphqlBooking } from '../../../tools/frontend/booking/index.mjs';

const structuredCloneFn =
  typeof globalThis.structuredClone === 'function'
    ? globalThis.structuredClone.bind(globalThis)
    : undefined;

function clone(value) {
  if (structuredCloneFn) {
    return structuredCloneFn(value);
  }
  return JSON.parse(JSON.stringify(value));
}

const STUB_BOOKING = Object.freeze({
  serviceProfile: {
    id: 'srv_mdl_avery',
    handle: 'avery-harper',
    displayName: 'Avery Harper',
    role: 'MODEL',
    heroImage: {
      url: 'https://images.rastup.stub/avery-hero.jpg',
      alt: 'Portrait of Avery Harper'
    },
    city: 'Austin'
  },
  packages: [
    {
      packageId: 'pkg-1',
      name: 'Editorial Half Day',
      description: '4-hour editorial shoot with up to 3 looks and creative direction support.',
      priceCents: 45000,
      durationMinutes: 240,
      includes: ['3 looks', 'Creative direction consult', 'Usage license 12 months digital'],
      addons: [
        { addonId: 'addon-moodboard', name: 'Concept Moodboard', priceCents: 5000 },
        { addonId: 'addon-retouch', name: 'Retouch Package (10 images)', priceCents: 8000 }
      ]
    },
    {
      packageId: 'pkg-2',
      name: 'Runway Event',
      description: 'Runway or live event appearance with rehearsal support.',
      priceCents: 32000,
      durationMinutes: 180,
      includes: ['Pre-event rehearsal', 'Event walkthrough', 'Social amplification']
    }
  ],
  availability: [
    { date: '2025-12-01', slots: ['09:00', '13:00', '16:00'] },
    { date: '2025-12-02', slots: ['10:00', '14:00'] },
    { date: '2025-12-05', slots: ['11:00', '15:00'] }
  ],
  documents: [
    { documentId: 'doc-sow', name: 'Statement of Work', required: true },
    { documentId: 'doc-release', name: 'Model Release', required: true },
    { documentId: 'doc-house-rules', name: 'House Rules', required: false }
  ]
});

export const BOOKING_QUERY = `
  query BookingConfiguration($serviceProfileId: ID!) {
    bookingConfiguration(serviceProfileId: $serviceProfileId) {
      serviceProfile {
        id
        handle
        displayName
        role
        heroImage {
          url
          alt
        }
        city
      }
      packages {
        packageId
        name
        description
        priceCents
        durationMinutes
        includes
        addons {
          addonId
          name
          priceCents
        }
      }
      availability {
        date
        slots
      }
      documents {
        documentId
        name
        required
      }
    }
  }
`;

export function createBookingDataSource({ executeQuery } = {}) {
  async function fetchBooking({ serviceProfileId } = {}) {
    if (typeof executeQuery === 'function') {
      const response = await executeQuery({
        query: BOOKING_QUERY,
        variables: { serviceProfileId }
      });
      return normalizeGraphqlBooking(response?.data?.bookingConfiguration ?? response?.bookingConfiguration ?? response);
    }
    return normalizeGraphqlBooking(clone(STUB_BOOKING));
  }

  return {
    fetchBooking
  };
}
