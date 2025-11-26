import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BookingPage } from '../../../components/Booking';
import { createBookingDataSource } from '../../../lib/booking';

type BookingPageParams = {
  params: {
    serviceProfileId: string;
  };
};

export async function generateMetadata({ params }: BookingPageParams): Promise<Metadata> {
  const dataSource = createBookingDataSource();
  const payload = await dataSource.fetchBooking({ serviceProfileId: params.serviceProfileId });

  if (!payload.serviceProfile) {
    return {
      title: 'Booking not found | RastUp'
    };
  }

  const title = `Book ${payload.serviceProfile.displayName} | RastUp`;
  const description = `Request a booking with ${payload.serviceProfile.displayName} for your next project.`;
  const canonical = `https://rastup.com/booking/${params.serviceProfileId}`;

  return {
    title,
    description,
    alternates: {
      canonical
    },
    openGraph: {
      title,
      description,
      url: canonical,
      type: 'website'
    }
  };
}

export default async function BookingRoute({ params }: BookingPageParams) {
  const dataSource = createBookingDataSource();
  const payload = await dataSource.fetchBooking({ serviceProfileId: params.serviceProfileId });

  if (!payload.serviceProfile) {
    notFound();
  }

  return (
    <BookingPage
      initialBooking={payload}
      serviceProfileId={params.serviceProfileId}
    />
  );
}
