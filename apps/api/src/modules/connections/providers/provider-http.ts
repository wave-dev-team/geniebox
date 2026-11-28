import { Injectable } from '@nestjs/common';

import { type HttpMethod, probe, type ProbeResponse, request as egressRequest } from './egress.js';

export interface ProviderRequest {
  headers?: Record<string, string>;
  timeoutMs: number;
  /** Hosts typed in by a person are checked against private ranges; fixed provider APIs are not. */
  checkHost: boolean;
  allowPrivate: boolean;
}

export interface ProviderMutateRequest extends ProviderRequest {
  method: HttpMethod;
  body?: unknown;
}

/**
 * Outbound HTTP calls of the worker to provider APIs. One injectable seam so integration
 * tests can answer for YooKassa, Metrika or HTTP APIs without the network.
 */
@Injectable()
export class ProviderHttp {
  get(url: string, request: ProviderRequest): Promise<ProbeResponse> {
    return probe(url, request);
  }

  request(url: string, options: ProviderMutateRequest): Promise<ProbeResponse> {
    return egressRequest(url, options);
  }
}
