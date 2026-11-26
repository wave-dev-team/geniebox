import { type Insertable, type Selectable, sql, type Transaction, type Updateable } from 'kysely';

import { Injectable } from '@nestjs/common';

import type { DB, MetricDefinitions } from '../../../database/types.js';
import { json, parsed } from '../../work/repositories/json.js';
import type { GoodDirection, MetricAggregation, MetricSource, MetricUnit } from '../metrics.constants.js';

export type MetricRow = Omit<
  Selectable<MetricDefinitions>,
  'source' | 'unit' | 'aggregation' | 'good_direction'
> & {
  unit: MetricUnit;
  aggregation: MetricAggregation;
  good_direction: GoodDirection;
  source: MetricSource | null;
};

export type MetricInsert = Omit<Insertable<MetricDefinitions>, 'source'> & {
  source?: MetricSource | null;
};
export type MetricUpdate = Omit<Updateable<MetricDefinitions>, 'source'> & {
  source?: MetricSource | null;
};

export interface Point {
  day: string;
  value: number;
}

const asMetric = (row: Selectable<MetricDefinitions>): MetricRow => ({
  ...row,
  unit: row.unit as MetricUnit,
  aggregation: row.aggregation as MetricAggregation,
  good_direction: row.good_direction as GoodDirection,
  source: parsed<MetricSource | null>(row.source, null),
});

// DATE is parsed as "YYYY-MM-DD" (create-kysely), typed as Date by codegen.
const day = (value: unknown): string => String(value).slice(0, 10);

@Injectable()
export class MetricsRepository {
  async list(db: Transaction<DB>, projectId: string): Promise<MetricRow[]> {
    const rows = await db
      .selectFrom('metric_definitions')
      .selectAll()
      .where('project_id', '=', projectId)
      .orderBy('position')
      .orderBy('created_at')
      .execute();
    return rows.map(asMetric);
  }

  async find(db: Transaction<DB>, projectId: string, id: string): Promise<MetricRow | undefined> {
    const row = await db
      .selectFrom('metric_definitions')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? asMetric(row) : undefined;
  }

  async findById(db: Transaction<DB>, id: string): Promise<MetricRow | undefined> {
    const row = await db.selectFrom('metric_definitions').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? asMetric(row) : undefined;
  }

  async findByKey(db: Transaction<DB>, projectId: string, key: string): Promise<MetricRow | undefined> {
    const row = await db
      .selectFrom('metric_definitions')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('key', '=', key)
      .executeTakeFirst();
    return row ? asMetric(row) : undefined;
  }

  async insert(db: Transaction<DB>, input: MetricInsert): Promise<MetricRow> {
    const { source, ...rest } = input;
    const row = await db
      .insertInto('metric_definitions')
      .values({ ...rest, source: source ? json(source) : null })
      .returningAll()
      .executeTakeFirstOrThrow();
    return asMetric(row);
  }

  /** Default metrics: a key that already exists is left as the person set it. */
  async insertMissing(db: Transaction<DB>, inputs: MetricInsert[]): Promise<number> {
    if (inputs.length === 0) return 0;
    const result = await db
      .insertInto('metric_definitions')
      .values(inputs.map(({ source, ...rest }) => ({ ...rest, source: source ? json(source) : null })))
      .onConflict((oc) => oc.columns(['project_id', 'key']).doNothing())
      .executeTakeFirst();
    return Number(result.numInsertedOrUpdatedRows ?? 0);
  }

  async update(db: Transaction<DB>, id: string, patch: MetricUpdate): Promise<MetricRow | undefined> {
    const { source, ...rest } = patch;
    const row = await db
      .updateTable('metric_definitions')
      .set({
        ...rest,
        ...(source !== undefined ? { source: source ? json(source) : null } : {}),
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    return row ? asMetric(row) : undefined;
  }

  async delete(db: Transaction<DB>, id: string): Promise<void> {
    await db.deleteFrom('metric_definitions').where('id', '=', id).execute();
  }

  async upsertPoints(
    db: Transaction<DB>,
    accountId: string,
    metricId: string,
    points: Point[],
  ): Promise<void> {
    if (points.length === 0) return;
    await db
      .insertInto('metric_points')
      .values(
        points.map((point) => ({
          account_id: accountId,
          metric_id: metricId,
          day: point.day,
          value: String(point.value),
        })),
      )
      .onConflict((oc) =>
        oc.columns(['metric_id', 'day']).doUpdateSet({
          value: (eb) => eb.ref('excluded.value'),
          collected_at: new Date(),
        }),
      )
      .execute();
  }

  /** Points from `from` to `to` inclusive (ISO days), ordered by day. */
  async points(db: Transaction<DB>, metricId: string, from: string, to: string): Promise<Point[]> {
    const rows = await db
      .selectFrom('metric_points')
      .select(['day', 'value'])
      .where('metric_id', '=', metricId)
      .where('day', '>=', sql<Date>`${from}::date`)
      .where('day', '<=', sql<Date>`${to}::date`)
      .orderBy('day')
      .execute();
    return rows.map((row) => ({ day: day(row.day), value: Number(row.value) }));
  }
}
