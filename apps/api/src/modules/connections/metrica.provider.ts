import { z } from 'zod';

import { BadGatewayException, Injectable, UnprocessableEntityException } from '@nestjs/common';

const origin = 'https://api-metrika.yandex.net';
const report = z.object({
  totals: z.array(z.number().nonnegative()).length(3),
  sampled: z.boolean().default(false),
});

export interface MetricaPeriod {
  from: string;
  to: string;
}

@Injectable()
export class MetricaProvider {
  async totals(counterId: string, token: string, period: MetricaPeriod) {
    const url = new URL('/stat/v1/data', origin);
    url.search = new URLSearchParams({
      ids: counterId,
      metrics: 'ym:s:visits,ym:s:users,ym:s:pageviews',
      date1: period.from,
      date2: period.to,
    }).toString();

    try {
      const response = await fetch(url, {
        headers: { Authorization: `OAuth ${token}`, Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if ([400, 401, 403, 404].includes(response.status)) throw new UnprocessableEntityException();
        throw new BadGatewayException();
      }
      const parsed = report.parse(await response.json());
      const [visits, users, pageviews] = parsed.totals;
      return {
        visits: visits ?? 0,
        users: users ?? 0,
        pageviews: pageviews ?? 0,
        sampled: parsed.sampled,
        url: `https://metrika.yandex.ru/dashboard?id=${counterId}`,
      };
    } catch (error) {
      if (error instanceof UnprocessableEntityException) throw error;
      throw new BadGatewayException();
    }
  }
}
