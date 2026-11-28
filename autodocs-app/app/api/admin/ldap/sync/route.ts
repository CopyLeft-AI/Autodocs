import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/app/lib/server/permissions';
import { handled } from '@/app/lib/server/recordings/http';
import { syncAllUsers } from '@/app/lib/server/ldap/service';

/** Refresh every user's directory groups (administrators only). */
export async function POST(request: NextRequest) {
  const auth = await authorize(request, 'admin');
  if (auth instanceof NextResponse) return auth;
  return handled(async () => NextResponse.json(await syncAllUsers()));
}
