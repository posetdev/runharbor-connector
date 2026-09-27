import { activateRequestSchema, activateResponseSchema } from '@runharbor/contracts';
import { AppError } from '../../domain/errors.js';
import type { ActivateRequest, SaasPort } from '../../ports/saas.js';

export class SaasActivateClient implements SaasPort {
  constructor(private readonly origin: string, private readonly fetchImpl: typeof fetch = fetch) {}
  async activate(deploymentId: string, token: string, payload: ActivateRequest): Promise<void> {
    const body = activateRequestSchema.parse(payload);
    let response: Response;
    try {
      response = await this.fetchImpl(new URL(`/api/v1/deployments/${encodeURIComponent(deploymentId)}/activate`, this.origin), { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'error' });
    } catch (error) { throw new AppError('UPSTREAM_UNAVAILABLE', { cause: error }); }
    if (response.status !== 200) throw new AppError('UPSTREAM_UNAVAILABLE');
    let parsed: unknown;
    try { parsed = await response.json(); } catch { throw new AppError('UPSTREAM_UNAVAILABLE'); }
    try { activateResponseSchema.parse(parsed); } catch { throw new AppError('UPSTREAM_UNAVAILABLE'); }
  }
}
