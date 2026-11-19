import { NextRequest, NextResponse } from 'next/server';
import { getRequestUser } from '@/app/lib/server/request-auth';
import {
  DEFAULT_REMOTE_API_CONCURRENCY,
  MAX_REMOTE_API_CONCURRENCY,
  MIN_REMOTE_API_CONCURRENCY,
  readRemoteApiConcurrency,
  saveRemoteApiConcurrency,
} from '@/app/lib/server/user-settings';

interface ProcessingSettingsBody { remoteApiConcurrency?: unknown; }

function limits() {
  return { min: MIN_REMOTE_API_CONCURRENCY, max: MAX_REMOTE_API_CONCURRENCY, default: DEFAULT_REMOTE_API_CONCURRENCY };
}

export async function GET(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json({ remoteApiConcurrency: await readRemoteApiConcurrency(user.id), limits: limits() });
  } catch (error) {
    console.error('Could not read processing settings:', error);
    return NextResponse.json({ message: 'Could not read settings.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  try {
    const body = (await request.json()) as ProcessingSettingsBody;
    const value = body.remoteApiConcurrency;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < MIN_REMOTE_API_CONCURRENCY || value > MAX_REMOTE_API_CONCURRENCY) {
      return NextResponse.json({ message: `remoteApiConcurrency must be a whole number from ${MIN_REMOTE_API_CONCURRENCY} to ${MAX_REMOTE_API_CONCURRENCY}.` }, { status: 400 });
    }
    await saveRemoteApiConcurrency(user.id, value);
    return NextResponse.json({ remoteApiConcurrency: value, limits: limits(), message: 'Settings saved.' });
  } catch (error) {
    console.error('Could not save processing settings:', error);
    return NextResponse.json({ message: 'Could not save settings.' }, { status: 500 });
  }
}
