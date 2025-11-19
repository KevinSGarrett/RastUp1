import { headers } from 'next/headers';
import type { Metadata } from 'next';

import { CalendarDashboardClient } from './CalendarDashboardClient';
import { createCalendarDataSource } from '../../lib/calendar/dataSource.mjs';

const DEFAULT_ROLE = process.env.CALENDAR_DEFAULT_ROLE ?? 'MODEL';

export const metadata: Metadata = {
  title: 'Calendar Availability Dashboard',
  description:
    'Configure availability rules, calendar sync, and booking feasibility with real-time previews.'
};

function resolveViewerTimeZone(): string | null {
  try {
    const headerStore = headers();
    const tz = headerStore.get('x-viewer-timezone');
    if (tz) {
      return tz;
    }
  } catch {
    // headers() not available (static generation) — ignore.
  }
  return null;
}

function resolveDataSourceMode(endpoint: string | null, apiKey: string | null): 'stub' | 'graphql' {
  if (!endpoint || !apiKey) {
    return 'stub';
  }
  return 'graphql';
}

export default async function CalendarPage() {
  const endpoint = process.env.CALENDAR_GRAPHQL_ENDPOINT ?? null;
  const apiKey = process.env.CALENDAR_GRAPHQL_API_KEY ?? null;
  const dataSourceMode = resolveDataSourceMode(endpoint, apiKey);

  const dataSource = createCalendarDataSource({
    endpoint,
    apiKey,
    headers: (() => {
      if (!apiKey) {
        return {};
      }
      if (process.env.CALENDAR_GRAPHQL_HEADER === 'x-api-key') {
        return { 'x-api-key': apiKey };
      }
      return {};
    })(),
    useStubData: dataSourceMode === 'stub'
  });

  const role = DEFAULT_ROLE;
  const viewerTimeZone = resolveViewerTimeZone();

  const initialDashboard = await dataSource.fetchDashboard({
    role,
    durationMin: 60
  });

  return (
    <CalendarDashboardClient
      initialRole={role}
      initialDashboard={initialDashboard}
      dataSourceMode={dataSourceMode}
      viewerTimeZone={viewerTimeZone}
    />
  );
}
