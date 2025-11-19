/**
 * Shared calendar domain types (WBS-017).
 */

export type WeekdayMask = number;

export interface WeeklyRule {
  ruleId: string;
  userId: string;
  roleCode: string;
  weekdayMask: WeekdayMask;
  startLocal: string;
  endLocal: string;
  timezone: string;
  minDurationMin: number;
  leadTimeHours: number;
  bookingWindowDays: number;
  bufferBeforeMin?: number;
  bufferAfterMin?: number;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type ExceptionKind = 'available' | 'unavailable';

export interface CalendarException {
  excId: string;
  userId: string;
  roleCode?: string;
  dateLocal: string;
  timezone: string;
  kind: ExceptionKind;
  startLocal?: string | null;
  endLocal?: string | null;
  note?: string | null;
  createdAt?: string;
}

export type HoldSource = 'checkout' | 'reschedule' | 'admin';

export interface CalendarHold {
  holdId: string;
  userId: string;
  roleCode: string;
  startUtc: string;
  endUtc: string;
  source: HoldSource;
  orderId?: string | null;
  ttlExpiresAt: string;
  createdAt?: string;
}

export type CalendarEventStatus = 'confirmed' | 'cancelled';

export interface CalendarEvent {
  eventId: string;
  userId: string;
  roleCode: string;
  orderId: string;
  startUtc: string;
  endUtc: string;
  status: CalendarEventStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface ExternalBusyEvent {
  extEventId: string;
  srcId: string;
  userId: string;
  startUtc: string;
  endUtc: string;
  busy: boolean;
  summary?: string | null;
  recurrenceId?: string | null;
  updatedAt?: string;
}

export interface FeasibleSlot {
  startUtc: string;
  endUtc: string;
  sourceRuleId?: string;
  confidence?: number;
}

export interface ComputeFeasibleSlotsInput {
  weeklyRules: WeeklyRule[];
  exceptions?: CalendarException[];
  holds?: CalendarHold[];
  confirmedEvents?: CalendarEvent[];
  externalBusy?: ExternalBusyEvent[];
  windowStartUtc: string;
  windowEndUtc: string;
  nowUtc?: string;
  durationMin: number;
  includeHolds?: boolean;
  maxSlots?: number;
}

export interface ComputeFeasibleSlotsResult {
  slots: FeasibleSlot[];
  metadata: {
    truncated: boolean;
    totalCandidateWindows: number;
    removedByLeadTime: number;
    removedByBookingWindow: number;
    removedByConflicts: number;
    removedByDuration: number;
  };
}

export interface IcsPollContext {
  sourceId: string;
  url: string;
  kind?: 'ics';
  etag?: string | null;
  lastModified?: string | null;
  now?: string;
  fetchImpl?: typeof fetch;
  abortSignal?: AbortSignal;
  maxContentLengthBytes?: number;
  timezone?: string;
}

export interface IcsComponentEvent {
  uid: string;
  startUtc: string;
  endUtc: string;
  summary?: string;
  recurrenceId?: string;
  busyType?: 'BUSY' | 'FREE' | 'TENTATIVE';
}

export interface IcsPollResult {
  status: 'unchanged' | 'updated';
  etag?: string | null;
  lastModified?: string | null;
  events: IcsComponentEvent[];
  rawBodyHash?: string;
  fetchedAt: string;
  error?: {
    message: string;
    retriable: boolean;
  };
}

export interface CalendarInviteOrganizer {
  email: string;
  name?: string;
}

export interface CalendarInviteAttendee {
  email: string;
  name?: string;
  role?: string;
  status?: string;
  rsvp?: boolean;
}

export interface CalendarAlarm {
  triggerMinutesBefore?: number;
  action?: 'DISPLAY' | 'EMAIL';
  description?: string;
}

export interface CalendarOutboundEvent {
  uid: string;
  startUtc: string;
  endUtc?: string;
  summary?: string;
  description?: string;
  location?: string;
  url?: string;
  status?: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
  transparency?: 'OPAQUE' | 'TRANSPARENT';
  organizer?: CalendarInviteOrganizer;
  attendees?: CalendarInviteAttendee[];
  categories?: string[];
  sequence?: number;
  createdAt?: string;
  updatedAt?: string;
  recurrenceId?: string;
  timezone?: string;
  allDay?: boolean;
  alarms?: CalendarAlarm[];
  extraProperties?: Record<string, string | number | boolean>;
  extra?: Record<string, string | number | boolean>;
}

export interface CalendarOutboundOptions {
  productId?: string;
  calendarName?: string;
  method?: 'PUBLISH' | 'REQUEST' | 'CANCEL';
  events: CalendarOutboundEvent[];
  defaultTimezone?: string;
  refreshIntervalMinutes?: number;
  ttlSeconds?: number;
  url?: string;
  generatedAtUtc?: string;
}
