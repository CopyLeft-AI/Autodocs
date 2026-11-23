import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/app/lib/server/permissions';
import { MlConfigRejectedError, readMlConfig, writeMlConfig } from '@/app/lib/server/ml-jobs';

/** Which model and inference source each analysis step uses; stored in the ML service's config file. */
export async function GET(request: NextRequest) {
  const auth = await authorize(request, 'signedIn');
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await readMlConfig());
  } catch (error) {
    console.error('Could not read inference settings:', error);
    return NextResponse.json({ message: 'Could not reach the analysis service to read its settings.' }, { status: 502 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await authorize(request, 'editSettings');
  if (auth instanceof NextResponse) return auth;
  let changes: unknown;
  try {
    changes = await request.json();
  } catch {
    return NextResponse.json({ message: 'The request body must be JSON.' }, { status: 400 });
  }
  try {
    return NextResponse.json(await writeMlConfig(changes));
  } catch (error) {
    if (error instanceof MlConfigRejectedError) return NextResponse.json({ message: error.message }, { status: 422 });
    console.error('Could not save inference settings:', error);
    return NextResponse.json({ message: 'Could not reach the analysis service to save its settings.' }, { status: 502 });
  }
}
