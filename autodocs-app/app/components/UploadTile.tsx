"use client";

import { IconAlertTriangle, IconCloudUpload, IconLoader2 } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { AnalysisDialog } from '@/app/components/AnalysisDialog';
import { UploadProgressPanel } from '@/app/components/UploadProgressPanel';
import { useAnalysisJobs } from '@/app/lib/use-analysis-jobs';
import { parseCast, titleFromFileName } from '@/app/lib/cast/parse';
import { messageOf, request } from '@/app/lib/editor/api';

const MAX_FILE_BYTES = 50 * 1024 * 1024;

type UploadState = 'idle' | 'registering' | 'error';

interface UploadedSession { id: string; title: string; }

interface UploadTileProperties {
    /** Called when a recording is stored or an analysis result arrives. */
    onUploadSuccess?: () => void;
}

/** Recognised by content, so a recording without the .cast extension also works. */
async function readRecording(file: File): Promise<{ title: string; content: string }> {
    if (file.size > MAX_FILE_BYTES) {
        throw new Error('This file is larger than 50 MB.');
    }

    const content = await file.text();
    const parsed = parseCast(content);

    if (!parsed.ok) {
        throw new Error(parsed.error);
    }

    return { title: titleFromFileName(file.name, parsed.recording.header.timestamp), content };
}

/**
 * Stores a recording, then asks how to annotate it: by hand or with a chosen
 * model. Background analyses each get their own progress panel.
 */
export function UploadTile({ onUploadSuccess }: UploadTileProperties) {
    const router = useRouter();
    const [isDragging, setIsDragging] = useState(false);
    const [uploadState, setUploadState] = useState<UploadState>('idle');
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [uploaded, setUploaded] = useState<UploadedSession | null>(null);
    const fileInputReference = useRef<HTMLInputElement>(null);

    const analysisJobs = useAnalysisJobs({ onJobSaved: onUploadSuccess });
    const { jobs, isAuthenticationExpired } = analysisJobs;

    const handleFileUpload = async (file: File): Promise<void> => {
        setUploadState('registering');
        setUploadError(null);

        try {
            const input = await readRecording(file);
            const { terminalSession } = await request<{ terminalSession: UploadedSession }>('POST', '/api/terminal-sessions', input);
            setUploaded({ id: terminalSession.id, title: input.title });
            setUploadState('idle');
            onUploadSuccess?.();
        } catch (error) {
            setUploadError(messageOf(error));
            setUploadState('error');
        }
    };

    const errorMessage = uploadError ?? analysisJobs.errorMessage;
    const hasError = errorMessage !== null && (uploadState === 'error' || jobs.length === 0 || isAuthenticationExpired);
    const isBusy = isAuthenticationExpired || uploadState === 'registering';

    const title = uploadState === 'registering'
        ? 'Saving the recording…'
        : isAuthenticationExpired
            ? 'Sign in to resume progress'
            : uploadState === 'error' ? 'Upload failed' : 'Upload Session';
    const subtitle = uploadState === 'registering'
        ? 'Reading and storing your file.'
        : hasError
            ? errorMessage
            : 'Drop an asciinema recording here or click to browse. You then choose how to annotate it.';
    const icon = uploadState === 'error' || isAuthenticationExpired
        ? <IconAlertTriangle className="text-destructive" size={30} />
        : isBusy
            ? <IconLoader2 className="text-primary animate-spin" size={30} />
            : <IconCloudUpload className="text-primary" size={30} />;

    return (
        <div className="space-y-4">
            <div
                className={`bg-card rounded-xl border-2 border-dashed p-6 transition-all ${isBusy ? 'cursor-wait border-primary/50' : isDragging ? 'cursor-copy border-primary bg-primary/5' : 'cursor-pointer border-border hover:border-primary'}`}
                onDragOver={(event) => {
                    event.preventDefault();
                    setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(event) => {
                    event.preventDefault();
                    setIsDragging(false);

                    if (!isBusy && event.dataTransfer.files[0]) {
                        void handleFileUpload(event.dataTransfer.files[0]);
                    }
                }}
                onClick={() => !isBusy && fileInputReference.current?.click()}
            >
                <input
                    ref={fileInputReference}
                    type="file"
                    className="hidden"
                    onChange={(event) => {
                        const file = event.target.files?.[0];

                        if (file) {
                            void handleFileUpload(file);
                        }

                        event.target.value = '';
                    }}
                />
                <div className="flex flex-col items-center justify-center min-h-[200px]">
                    <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">{icon}</div>
                    <h3 className="text-foreground mb-2">{title}</h3>
                    <p className={`text-sm text-center max-w-sm ${hasError ? 'text-destructive' : 'text-muted-foreground'}`}>{subtitle}</p>
                    {!isBusy && <span className="mt-4 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm">Choose .cast file</span>}
                </div>
            </div>
            {analysisJobs.errorMessage && jobs.length > 0 && !isAuthenticationExpired && (
                <p className="text-xs text-destructive font-mono">{analysisJobs.errorMessage}</p>
            )}
            {jobs.map((job) => (
                <UploadProgressPanel
                    key={job.id}
                    job={job}
                    isBusy={analysisJobs.busyJobIds.has(job.id)}
                    onControl={(action) => void analysisJobs.controlJob(job.id, action)}
                    onDelete={() => void analysisJobs.deleteJob(job.id)}
                    onDismiss={() => analysisJobs.dismissJob(job.id)}
                />
            ))}
            {uploaded && (
                <AnalysisDialog
                    sessionId={uploaded.id}
                    title={uploaded.title}
                    onAnnotateManually={() => router.push(`/sessions/${uploaded.id}`)}
                    onStarted={(job) => {
                        setUploaded(null);
                        // A background job shows its progress here; a finished analysis opens the editor.
                        if (job) analysisJobs.addJob(job);
                        else router.push(`/sessions/${uploaded.id}`);
                    }}
                    onClose={() => setUploaded(null)}
                />
            )}
        </div>
    );
}
