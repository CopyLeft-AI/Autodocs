/** Browser-side calls of the app API; every failure carries a readable message. */
export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/** fetch() that retries once after refreshing an expired access token. */
export async function fetchSignedIn(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  if (response.status !== 401) return response;
  const refresh = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
  return refresh.ok ? fetch(url, { cache: 'no-store', ...init }) : response;
}

async function checked(response: Response): Promise<Response> {
  if (response.ok) return response;
  const body = await response.json().catch(() => ({})) as { message?: string };
  throw new ApiError(response.status, body.message ?? `Request failed with status ${response.status}.`);
}

export async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await fetchSignedIn(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (await checked(response)).json() as Promise<T>;
}

export async function requestText(url: string): Promise<string> {
  return (await checked(await fetchSignedIn(url))).text();
}

export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : 'Something went wrong.');
