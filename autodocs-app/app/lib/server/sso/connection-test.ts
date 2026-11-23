// Ours
import type { SsoConnectionTestResult } from '@/app/lib/server/sso/admin-view';
import { fetchDiscovery } from '@/app/lib/server/sso/oidc-client';
import { loadRuntimeProvider } from '@/app/lib/server/sso/provider-service';
import type { SsoProviderId } from '@/app/lib/server/sso/types';

/**
 * Check what can be checked without a person signing in: that the saved configuration is complete and, for
 * OpenID Connect, that the provider's discovery document is reachable and consistent.
 */
export async function testProviderConnection(id: SsoProviderId): Promise<SsoConnectionTestResult> {
  const runtime = await loadRuntimeProvider(id, { requireEnabled: false });
  if (!runtime) return { ok: false, message: 'Save the client ID, the client secret and every required field first.' };
  if (runtime.definition.protocol !== 'oidc') {
    return { ok: true, message: 'The configuration is complete. This provider\'s endpoints can only be checked by signing in.' };
  }
  const issuer = runtime.definition.issuerFor(runtime.settings);
  const discovery = await fetchDiscovery(issuer, { fresh: true });
  if (!discovery.ok) return { ok: false, message: discovery.message };
  return { ok: true, message: `Reached ${issuer}: the provider's endpoints and signing keys are published.` };
}
