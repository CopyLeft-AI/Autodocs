import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/app/lib/server/permissions';
import { resolvePublicBaseUrl } from '@/app/lib/server/sso/base-url';
import { getProviderDefinition } from '@/app/lib/server/sso/provider-definitions';
import { parseProviderUpdate } from '@/app/lib/server/sso/provider-input';
import { buildAdminOverview, readStoredProvider, removeProvider, saveProviderUpdate } from '@/app/lib/server/sso/provider-service';
import { isSsoProviderId } from '@/app/lib/server/sso/types';

type Context = { params: Promise<{ provider: string }> };

/** Save one provider's credentials and options (administrators only). */
export async function PUT(request: NextRequest, context: Context) {
  const auth = await authorize(request, 'admin');
  if (auth instanceof NextResponse) return auth;
  const { provider } = await context.params;
  if (!isSsoProviderId(provider)) return NextResponse.json({ message: 'Unknown provider.' }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'The request body must be JSON.' }, { status: 400 });
  }
  try {
    const parsed = parseProviderUpdate(getProviderDefinition(provider), body, await readStoredProvider(provider));
    if (!parsed.ok) return NextResponse.json({ message: parsed.message }, { status: 400 });
    await saveProviderUpdate(provider, parsed.value, auth.user.id);
    const overview = await buildAdminOverview(resolvePublicBaseUrl(request));
    return NextResponse.json({ provider: overview.providers.find((entry) => entry.id === provider), message: 'Settings saved.' });
  } catch (error) {
    console.error(`Could not save the ${provider} single sign-on settings:`, error);
    return NextResponse.json({ message: 'Could not save the settings.' }, { status: 500 });
  }
}

/** Forget one provider's configuration (administrators only). Accounts already linked to it stay linked. */
export async function DELETE(request: NextRequest, context: Context) {
  const auth = await authorize(request, 'admin');
  if (auth instanceof NextResponse) return auth;
  const { provider } = await context.params;
  if (!isSsoProviderId(provider)) return NextResponse.json({ message: 'Unknown provider.' }, { status: 404 });
  try {
    await removeProvider(provider);
    const overview = await buildAdminOverview(resolvePublicBaseUrl(request));
    return NextResponse.json({ provider: overview.providers.find((entry) => entry.id === provider), message: 'Configuration removed.' });
  } catch (error) {
    console.error(`Could not remove the ${provider} single sign-on settings:`, error);
    return NextResponse.json({ message: 'Could not remove the settings.' }, { status: 500 });
  }
}
