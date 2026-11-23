import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';

/**
 * Swagger UI's prebuilt files, served from the swagger-ui-dist package.
 *
 * They are served as plain files instead of being imported into the page because
 * the bundler drops code of the OpenAPI 3.1 parser that Swagger UI needs, which
 * breaks the documentation of the ML service. Only the two files below are
 * served, so the file name can never reach another path. The path is resolved
 * from the working directory, which is the app folder under `npm start`.
 */
const ASSETS: Record<string, string> = {
  'swagger-ui-bundle.js': 'application/javascript; charset=utf-8',
  'swagger-ui.css': 'text/css; charset=utf-8',
};

export async function GET(_request: Request, context: { params: Promise<{ file: string }> }) {
  const { file } = await context.params;
  const contentType = Object.hasOwn(ASSETS, file) ? ASSETS[file] : undefined;
  if (!contentType) return NextResponse.json({ message: 'Unknown file.' }, { status: 404 });
  try {
    const body = await readFile(join(process.cwd(), 'node_modules', 'swagger-ui-dist', file));
    return new Response(new Uint8Array(body), { headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=86400' } });
  } catch (error) {
    console.error('Could not read a Swagger UI file:', error);
    return NextResponse.json({ message: 'Swagger UI is not installed.' }, { status: 500 });
  }
}
