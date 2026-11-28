"use client";

import { useParams } from 'next/navigation';
import { SessionEditorView } from '@/app/components/editor/SessionEditorView';

export default function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return <SessionEditorView key={sessionId} sessionId={sessionId} />;
}
