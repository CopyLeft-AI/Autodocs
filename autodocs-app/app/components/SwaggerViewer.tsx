'use client';

import { useEffect, useState } from 'react';

const ASSET_BASE = '/swagger-ui-assets';

/** The part of Swagger UI's browser global that this page uses. */
interface SwaggerUiGlobal {
  (options: Record<string, unknown>): unknown;
}

declare global {
  interface Window {
    SwaggerUIBundle?: SwaggerUiGlobal;
  }
}

interface SwaggerViewerProps {
  /** URL of the OpenAPI document to show. */
  specUrl: string;
  /** Show the page to administrators only (the server enforces this too). */
  adminOnly?: boolean;
}

type Access = 'checking' | 'allowed' | 'signedOut' | 'notAdmin';

/** Load Swagger UI's script once; resolves when `window.SwaggerUIBundle` exists. */
function loadSwaggerUi(): Promise<SwaggerUiGlobal> {
  if (window.SwaggerUIBundle) return Promise.resolve(window.SwaggerUIBundle);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${ASSET_BASE}/swagger-ui-bundle.js`;
    script.onload = () => (window.SwaggerUIBundle ? resolve(window.SwaggerUIBundle) : reject(new Error('Swagger UI did not start.')));
    script.onerror = () => reject(new Error('Swagger UI could not be loaded.'));
    document.head.appendChild(script);
  });
}

/** Swagger UI for one OpenAPI document, shown once the visitor's access is known. */
export default function SwaggerViewer({ specUrl, adminOnly = false }: SwaggerViewerProps) {
  const [access, setAccess] = useState<Access>(adminOnly ? 'checking' : 'allowed');
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!adminOnly) return;
    let cancelled = false;
    (async () => {
      // /api/auth/me also renews an expired access token from the refresh token.
      const me = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (!me.ok) return cancelled ? undefined : setAccess('signedOut');
      const rights = await fetch('/api/auth/permissions', { credentials: 'same-origin' });
      const permissions = rights.ok ? ((await rights.json()) as { isAdmin?: boolean }) : null;
      if (!cancelled) setAccess(permissions?.isAdmin ? 'allowed' : 'notAdmin');
    })().catch(() => { if (!cancelled) setAccess('signedOut'); });
    return () => { cancelled = true; };
  }, [adminOnly]);

  useEffect(() => {
    if (access !== 'allowed') return;
    let cancelled = false;
    loadSwaggerUi()
      .then((SwaggerUIBundle) => {
        if (cancelled) return;
        SwaggerUIBundle({ url: specUrl, dom_id: '#swagger-ui', persistAuthorization: true, tryItOutEnabled: true });
      })
      .catch((error: unknown) => { if (!cancelled) setFailure(error instanceof Error ? error.message : 'Swagger UI could not be loaded.'); });
    return () => { cancelled = true; };
  }, [access, specUrl]);

  if (access === 'checking') return <p className="p-6">Checking your access…</p>;
  if (access === 'signedOut') return <p className="p-6">Sign in first: <a className="underline" href="/login">go to the login page</a>, then come back.</p>;
  if (access === 'notAdmin') return <p className="p-6">Only administrators can open this documentation.</p>;
  return (
    <div className="bg-white">
      <link rel="stylesheet" href={`${ASSET_BASE}/swagger-ui.css`} />
      {failure ? <p className="p-6" role="alert">{failure}</p> : <div id="swagger-ui" />}
    </div>
  );
}
