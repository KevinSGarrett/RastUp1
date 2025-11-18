import type { PoolClient } from 'pg';
import { setTimeout as sleep } from 'node:timers/promises';
import type { SearchDocument } from './types';

export interface OutboxEvent {
  eventId: number;
  entity: 'person' | 'studio' | 'work' | 'help';
  entityId: string;
  op: 'upsert' | 'delete';
  payload: Record<string, unknown>;
  retryCount: number;
  lastError?: string | null;
  createdAt: string;
}

export interface SearchClient {
  upsert(surface: string, docs: SearchDocument[]): Promise<void>;
  delete(surface: string, ids: string[]): Promise<void>;
  health(): Promise<{ ok: boolean; latencyMs: number }>;
}

export interface IndexerTelemetry {
  onBatchStart(meta: { size: number; attempt: number }): void;
  onBatchComplete(meta: { processed: number; latencyMs: number; retries: number }): void;
  onBatchError(meta: { error: Error; event: OutboxEvent }): void;
  onPoisonRecord(meta: { event: OutboxEvent }): void;
}

export interface IndexerConfig {
  batchSize: number;
  maxRetries: number;
  backoffMs: number;
  maxBackoffMs: number;
  surfaces: Record<string, string>;
}

export class SearchIndexer {
  constructor(
    private readonly db: PoolClient,
    private readonly client: SearchClient,
    private readonly telemetry: IndexerTelemetry,
    private readonly config: IndexerConfig
  ) {}

  async runOnce(): Promise<void> {
    const events = await this.fetchPendingEvents();
    if (events.length === 0) {
      return;
    }

    const grouped = this.groupBySurface(events);

    for (const [surface, surfaceEvents] of Object.entries(grouped)) {
      const attemptStartedAt = performance.now();
      this.telemetry.onBatchStart({ size: surfaceEvents.length, attempt: 1 });
      const retryable: OutboxEvent[] = [];
      const poison: OutboxEvent[] = [];

      const upserts: SearchDocument[] = [];
      const deletes: string[] = [];

      for (const event of surfaceEvents) {
        if (event.op === 'upsert') {
          try {
            upserts.push(this.normalizeDocument(surface, event.payload));
          } catch (error) {
            event.lastError = (error as Error).message;
            poison.push(event);
          }
        } else if (event.op === 'delete') {
          deletes.push(event.entityId);
        }
      }

      try {
        if (upserts.length > 0) {
          await this.client.upsert(surface, upserts);
        }
        if (deletes.length > 0) {
          await this.client.delete(surface, deletes);
        }
        const latencyMs = performance.now() - attemptStartedAt;
        this.telemetry.onBatchComplete({
          processed: surfaceEvents.length,
          latencyMs,
          retries: surfaceEvents.reduce((sum, ev) => sum + ev.retryCount, 0)
        });
        await this.markProcessed(surfaceEvents.map((event) => event.eventId));
      } catch (error) {
        for (const event of surfaceEvents) {
          event.retryCount += 1;
          event.lastError = (error as Error).message;
          if (event.retryCount >= this.config.maxRetries) {
            poison.push(event);
          } else {
            retryable.push(event);
          }
        }
        for (const item of retryable) {
          await this.scheduleRetry(item);
        }
        for (const item of poison) {
          await this.moveToDeadLetter(item);
          this.telemetry.onPoisonRecord({ event: item });
        }
      }
    }
  }

  private async fetchPendingEvents(): Promise<OutboxEvent[]> {
    const response = await this.db.query<OutboxEvent>(
      `
        select event_id as "eventId",
               entity,
               entity_id as "entityId",
               op,
               payload,
               retry_count as "retryCount",
               last_error as "lastError",
               created_at as "createdAt"
          from search.outbox
         where processed = false
         order by created_at asc
         limit $1
      `,
      [this.config.batchSize]
    );
    return response.rows;
  }

  private groupBySurface(events: OutboxEvent[]): Record<string, OutboxEvent[]> {
    const buckets: Record<string, OutboxEvent[]> = {};
    for (const event of events) {
      const surface = this.config.surfaces[event.entity];
      if (!surface) {
        this.telemetry.onPoisonRecord({ event });
        continue;
      }
      buckets[surface] ??= [];
      buckets[surface].push(event);
    }
    return buckets;
  }

  private normalizeDocument(surface: string, payload: Record<string, unknown>): SearchDocument {
    if (surface === 'people_v1') {
      return this.normalizePeopleDocument(payload);
    }
    if (surface === 'studios_v1') {
      return this.normalizeStudiosDocument(payload);
    }
    return this.normalizeGenericDocument(surface, payload);
  }

  private normalizePeopleDocument(payload: Record<string, unknown>): SearchDocument {
    const availabilityScore = this.computeAvailabilityScore(payload['availabilityBuckets'] as string[] | undefined);
    return {
      id: String(payload['id']),
      surface: 'PEOPLE',
      ownerId: String(payload['userId']),
      city: String(payload['city']),
      region: payload['region'] as string | undefined,
      country: String(payload['country'] ?? 'US'),
      geo: payload['geo_lat']
        ? {
            lat: Number(payload['geo_lat']),
            lon: Number(payload['geo_lng'])
          }
        : undefined,
      role: payload['role'] as string | undefined,
      safeModeBandMax: Number(payload['safeModeBandMax'] ?? 1),
      ratingAvg: payload['ratingAvg'] as number | undefined,
      ratingCount: payload['ratingCount'] as number | undefined,
      priceFromCents: payload['priceFromCents'] as number | undefined,
      priceToCents: payload['priceMedianCents'] as number | undefined,
      priceBucket: payload['priceBucket'] as string | undefined,
      availabilityBuckets: (payload['availabilityBuckets'] as string[] | undefined) ?? [],
      availabilityScore,
      instantBook: payload['instantBook'] as boolean | undefined,
      verifiedId: payload['verification_id'] as boolean | undefined,
      verifiedBg: payload['verification_bg'] as boolean | undefined,
      verifiedSocial: payload['verification_social'] as boolean | undefined,
      boosts: payload['boosts'] as Record<string, number> | undefined,
      policySignals: payload['policySignals'] as SearchDocument['policySignals'],
      promotionSlot: (payload['promotionSlot'] as 'FEATURED' | 'BOOST' | null) ?? null,
      promotionPriority: payload['promotionPriority'] as number | undefined,
      createdAtEpoch: Number(payload['created_at']),
      updatedAtEpoch: Number(payload['updated_at']),
      handle: payload['handle'] as string | undefined,
      slug: payload['slug'] as string | undefined,
      ownerGroupId: payload['ownerGroupId'] as string | undefined,
      newSellerScore: payload['newSellerScore'] as number | undefined
    };
  }

  private normalizeStudiosDocument(payload: Record<string, unknown>): SearchDocument {
    return {
      id: String(payload['id']),
      surface: 'STUDIOS',
      ownerId: String(payload['ownerUserId']),
      city: String(payload['city']),
      region: payload['region'] as string | undefined,
      country: String(payload['country'] ?? 'US'),
      geo: payload['geo_lat']
        ? {
            lat: Number(payload['geo_lat']),
            lon: Number(payload['geo_lng'])
          }
        : undefined,
      safeModeBandMax: Number(payload['safeModeBandMax'] ?? 1),
      ratingAvg: payload['ratingAvg'] as number | undefined,
      ratingCount: payload['ratingCount'] as number | undefined,
      priceFromCents: payload['hourlyMinCents'] as number | undefined,
      priceBucket: payload['priceBucket'] as string | undefined,
      availabilityBuckets: (payload['availabilityBuckets'] as string[] | undefined) ?? [],
      availabilityScore: this.computeAvailabilityScore(payload['availabilityBuckets'] as string[] | undefined),
      instantBook: payload['instantBook'] as boolean | undefined,
      verifiedId: payload['verifiedStudio'] as boolean | undefined,
      policySignals: payload['policySignals'] as SearchDocument['policySignals'],
      promotionSlot: (payload['promotionSlot'] as 'FEATURED' | 'BOOST' | null) ?? null,
      promotionPriority: payload['promotionPriority'] as number | undefined,
      createdAtEpoch: Number(payload['created_at']),
      updatedAtEpoch: Number(payload['updated_at']),
      handle: payload['slug'] as string | undefined,
      slug: payload['slug'] as string | undefined,
      ownerGroupId: payload['ownerGroupId'] as string | undefined,
      newSellerScore: payload['newSellerScore'] as number | undefined
    };
  }

  private normalizeGenericDocument(surface: string, payload: Record<string, unknown>): SearchDocument {
    return {
      id: String(payload['id']),
      surface: surface === 'work_v1' ? 'WORK' : 'HELP',
      ownerId: String(payload['ownerUserId'] ?? payload['authorId'] ?? payload['id']),
      city: String(payload['city'] ?? ''),
      region: payload['region'] as string | undefined,
      country: String(payload['country'] ?? 'US'),
      safeModeBandMax: Number(payload['safeModeBandMax'] ?? payload['nsfw_band'] ?? 0),
      ratingAvg: payload['rating'] as number | undefined,
      ratingCount: payload['review_count'] as number | undefined,
      availabilityBuckets: [],
      availabilityScore: 0,
      createdAtEpoch: Number(payload['created_at'] ?? payload['published_at'] ?? Date.now()),
      updatedAtEpoch: Number(payload['updated_at'] ?? payload['created_at'] ?? Date.now())
    };
  }

  private computeAvailabilityScore(buckets: string[] | undefined): number {
    if (!buckets || buckets.length === 0) {
      return 0;
    }
    const uniqueDays = new Set(buckets);
    const horizon = 14;
    return Math.min(uniqueDays.size / horizon, 1);
  }

  private async markProcessed(ids: number[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.db.query(
      `
        update search.outbox
           set processed = true,
               processed_at = now(),
               updated_at = now()
         where event_id = any($1::bigint[])
      `,
      [ids]
    );
  }

  private async scheduleRetry(event: OutboxEvent): Promise<void> {
    const backoff = Math.min(
      this.config.backoffMs * Math.pow(2, event.retryCount - 1),
      this.config.maxBackoffMs
    );
    await this.db.query(
      `
        update search.outbox
           set retry_count = $2,
               last_error = $3,
               updated_at = now()
         where event_id = $1
      `,
      [event.eventId, event.retryCount, event.lastError ?? null]
    );
    await sleep(backoff);
  }

  private async moveToDeadLetter(event: OutboxEvent): Promise<void> {
    await this.db.query(
      `
        insert into search.outbox_dlq (event_id, entity, entity_id, op, payload, source_version, correlation_id, retry_count, last_error)
        values ($1, $2, $3, $4, $5, 0, null, $6, $7)
        on conflict (event_id) do nothing
      `,
      [
        event.eventId,
        event.entity,
        event.entityId,
        event.op,
        event.payload,
        event.retryCount,
        event.lastError ?? 'unknown'
      ]
    );
    await this.db.query(
      `
        update search.outbox
           set processed = true,
               processed_at = now(),
               updated_at = now()
         where event_id = $1
      `,
      [event.eventId]
    );
  }
}
