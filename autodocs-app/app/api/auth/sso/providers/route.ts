import { NextResponse } from 'next/server';
import { listLoginProviders } from '@/app/lib/server/sso/provider-service';

/** The identity providers the login and signup pages offer. Public: only ids and button labels. */
export async function GET() {
  try {
    return NextResponse.json({ providers: await listLoginProviders() });
  } catch (error) {
    console.error('Could not list single sign-on providers:', error);
    return NextResponse.json({ providers: [] });
  }
}
