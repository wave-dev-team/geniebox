import { z } from 'zod';

export const metricKeys = ['visits', 'users', 'pageviews'] as const;
export const metricKeySchema = z.enum(metricKeys);
export const metricSchema = z.object({
  key: metricKeySchema,
  label: z.string().trim().min(1).max(120),
});
export const metricsSchema = metricSchema.array();

export const metricPeriodSchema = z.object({ from: z.iso.date(), to: z.iso.date() });
const day = 86_400_000;
export const periodDays = ({ from, to }: z.infer<typeof metricPeriodSchema>) =>
  (Date.parse(to) - Date.parse(from)) / day + 1;

const criterionSchema = z.object({
  direction: z.enum(['atLeast', 'atMost']),
  target: z.number().min(-100).max(10_000),
});

const reportFields = {
  title: z.string().trim().min(1).max(120),
  metric: metricKeySchema,
  baseline: metricPeriodSchema,
  comparison: metricPeriodSchema,
  criterion: criterionSchema.optional(),
};

export const metricsReportInputSchema = z.strictObject(reportFields).refine((input) => {
  const days = periodDays(input.baseline);
  return (
    days > 0 &&
    days <= 92 &&
    days === periodDays(input.comparison) &&
    input.baseline.to < input.comparison.from &&
    input.comparison.to <= new Date().toISOString().slice(0, 10)
  );
});

export const metricsReportSchema = z.object({
  ...reportFields,
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  label: z.string(),
  source: z.enum(['demo', 'live']),
  sourceUrl: z.url().nullable(),
  sampled: z.boolean(),
  before: z.number(),
  after: z.number(),
  change: z.number().nullable(),
  criterionMet: z.boolean().nullable(),
});

export const metricsReportsSchema = z.object({
  reports: metricsReportSchema.array(),
  next: z.uuid().nullable(),
});

export type MetricKey = z.infer<typeof metricKeySchema>;
export type MetricsReportInput = z.infer<typeof metricsReportInputSchema>;
export type MetricsReport = z.infer<typeof metricsReportSchema>;
