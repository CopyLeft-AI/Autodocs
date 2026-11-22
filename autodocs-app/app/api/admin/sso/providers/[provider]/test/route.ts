import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/app/lib/server/permissions';
import { testProviderConnection } from '@/app/lib/server/sso/connection-test';
import { isSsoProviderId } from '@/app/lib/server/sso/types';

/** Check a saved provider configuration without signing in (administrators only). */
export async function POST(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const auth = await authorize(request, 'admin');
  if (auth instanceof NextResponse) return auth;
  const { provider } = await context.params;
  if (!isSsoProviderId(provider)) return NextResponse.json({ message: 'Unknown provider.' }, { status: 404 });
  try {
    return NextResponse.json(await testProviderConnection(provider));
  } catch (error) {
    console.error(`Could not test the ${provider} single sign-on settings:`, error);
    return NextResponse.json({ message: 'Could not run the test.' }, { status: 500 });
  }
}
