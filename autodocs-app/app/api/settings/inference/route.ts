import { NextRequest, NextResponse } from 'next/server';
import { getRequestUser } from '@/app/lib/server/request-auth';
import { MlConfigRejectedError, readMlConfig, writeMlConfig } from '@/app/lib/server/ml-jobs';

/** Which model and inference source each analysis step uses; stored in the ML service's config file. */
export async function GET(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await readMlConfig());
  } catch (error) {
    console.error('Could not read inference settings:', error);
    return NextResponse.json({ message: 'Could not reach the analysis service to read its settings.' }, { status: 502 });
  }
}

export async function PUT(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
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
