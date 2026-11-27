import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/app/lib/server/permissions';
import { RequestError } from '@/app/lib/server/recordings/errors';
import { handled, readBody } from '@/app/lib/server/recordings/http';
import { testLdapLookup } from '@/app/lib/server/ldap/service';

/** Look an email up in the saved directory (administrators only). */
export async function POST(request: NextRequest) {
  const auth = await authorize(request, 'admin');
  if (auth instanceof NextResponse) return auth;
  return handled(async () => {
    const { email } = await readBody(request);
    if (typeof email !== 'string' || !email.trim() || email.length > 320) throw new RequestError(400, 'An email is required.');
    return NextResponse.json(await testLdapLookup(email.trim().toLowerCase()));
  });
}
