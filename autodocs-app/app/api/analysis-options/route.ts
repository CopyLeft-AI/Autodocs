import { NextRequest, NextResponse } from 'next/server';
import { readAnalysisChoices } from '@/app/lib/server/recordings/analysis-options';
import { signedIn } from '@/app/lib/server/recordings/http';

export async function GET(request: NextRequest) {
  return signedIn(request, async (user) => NextResponse.json(await readAnalysisChoices(user.id)));
}
