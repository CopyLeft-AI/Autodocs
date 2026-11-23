import { NextResponse } from 'next/server';
import { OPENAPI_DOCUMENT } from '@/app/lib/server/openapi/document';

/** OpenAPI description of this app's API; public because it exposes no data. */
export async function GET() {
  return NextResponse.json(OPENAPI_DOCUMENT);
}
