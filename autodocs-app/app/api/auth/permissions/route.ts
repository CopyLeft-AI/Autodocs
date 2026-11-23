import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/app/lib/server/permissions';

/** The signed-in user's own rights, so the UI can show or hide controls. */
export async function GET(request: NextRequest) {
  const auth = await authorize(request, 'signedIn');
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json(auth.permissions);
}
