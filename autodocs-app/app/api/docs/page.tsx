import type { Metadata } from 'next';
import SwaggerViewer from '@/app/components/SwaggerViewer';

export const metadata: Metadata = { title: 'AutoDocs app API' };

/** Interactive documentation of the app's HTTP API. */
export default function ApiDocsPage() {
  return <SwaggerViewer specUrl="/api/openapi.json" />;
}
