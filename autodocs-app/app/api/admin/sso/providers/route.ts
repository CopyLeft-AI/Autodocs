import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/app/lib/server/permissions';
import { resolvePublicBaseUrl } from '@/app/lib/server/sso/base-url';
import { buildAdminOverview } from '@/app/lib/server/sso/provider-service';

/** Every identity provider with its saved configuration; the client secrets are never included (administrators only). */
export async function GET(request: NextRequest) {
  const auth = await authorize(request, 'admin');
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await buildAdminOverview(resolvePublicBaseUrl(request)));
  } catch (error) {
    console.error('Could not read the single sign-on settings:', error);
    return NextResponse.json({ message: 'Could not read the single sign-on settings.' }, { status: 500 });
  }
}
