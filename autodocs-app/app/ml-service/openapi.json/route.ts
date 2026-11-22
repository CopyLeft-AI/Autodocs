import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/app/lib/server/permissions';
import { readMlOpenApi } from '@/app/lib/server/ml-proxy';

/** The ML service's OpenAPI description, rewritten to call back through this app (administrators only). */
export async function GET(request: NextRequest) {
  const auth = await authorize(request, 'admin');
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await readMlOpenApi());
  } catch (error) {
    console.error('Could not read the ML service OpenAPI document:', error);
    return NextResponse.json({ message: 'Could not reach the analysis service.' }, { status: 502 });
  }
}
