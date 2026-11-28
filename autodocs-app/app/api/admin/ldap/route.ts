import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/app/lib/server/permissions';
import { handled, readBody } from '@/app/lib/server/recordings/http';
import { readLdapView, saveLdapSettings } from '@/app/lib/server/ldap/service';

/** The LDAP directory settings, without the password (administrators only). */
export async function GET(request: NextRequest) {
  const auth = await authorize(request, 'admin');
  if (auth instanceof NextResponse) return auth;
  return handled(async () => NextResponse.json(await readLdapView()));
}

/** Save the LDAP directory settings (administrators only). */
export async function PUT(request: NextRequest) {
  const auth = await authorize(request, 'admin');
  if (auth instanceof NextResponse) return auth;
  return handled(async () => NextResponse.json(await saveLdapSettings(auth.user.id, await readBody(request))));
}
