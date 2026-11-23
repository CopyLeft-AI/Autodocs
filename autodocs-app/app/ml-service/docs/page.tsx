import type { Metadata } from 'next';
import SwaggerViewer from '@/app/components/SwaggerViewer';

export const metadata: Metadata = { title: 'AutoDocs analysis service API' };

/** Interactive documentation of the ML service, reached through this app (administrators only). */
export default function MlServiceDocsPage() {
  return <SwaggerViewer specUrl="/ml-service/openapi.json" adminOnly />;
}
