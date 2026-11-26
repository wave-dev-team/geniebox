import { Injectable } from '@nestjs/common';

import { probe, type ProbeResponse } from './egress.js';

export interface ProviderRequest {
  headers?: Record<string, string>;
  timeoutMs: number;
  /** Hosts typed in by a person are checked against private ranges; fixed provider APIs are not. */
  checkHost: boolean;
  allowPrivate: boolean;
}

/**
 * Outbound GETs of the worker to provider APIs (data tools, metric collectors). One injectable
 * seam so integration tests can answer for YooKassa or Metrika without the network.
 */
@Injectable()
export class ProviderHttp {
  get(url: string, request: ProviderRequest): Promise<ProbeResponse> {
    return probe(url, request);
  }
}
