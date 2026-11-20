"use client";

import { IconAlertTriangle, IconCheck, IconCloudUpload, IconLoader2 } from '@tabler/icons-react';
import { useRef, useState } from 'react';
import { UploadProgressPanel } from '@/app/components/UploadProgressPanel';
import { useAnalysisJobs } from '@/app/lib/use-analysis-jobs';
import type { MlJobStatus } from '@/app/lib/server/ml-jobs';

/** `registering` = reading the file and handing it to the server; `processing` = legacy synchronous analysis. */
type UploadState = 'idle' | 'registering' | 'processing' | 'success' | 'error';

interface RecordingInput {
    title: string;
    durationSeconds: number;
    content: string;
}

interface LegacyUploadResponse {
    terminalSession?: { id: string };
    message?: string;
}

interface UploadTileProperties {
    onUploadSuccess?: () => void;
}

async function readRecording(file: File): Promise<RecordingInput> {
    if (file.name.split('.').pop()?.toLowerCase() !== 'cast') {
        throw new Error('Unsupported file type. Please upload a .cast file.');
    }

    const content = await file.text();
    const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);

    if (lines.length < 2) {
        throw new Error('Invalid .cast file format.');
    }

    const lastEvent = JSON.parse(lines.at(-1) ?? '');

    if (!Array.isArray(lastEvent) || typeof lastEvent[0] !== 'number') {
        throw new Error('Failed to parse duration from .cast file.');
    }

    return {
        title: file.name.replace(/\.[^/.]+$/, ''),
        durationSeconds: Math.round(lastEvent[0]),
        content,
    };
}

/**
 * Uploads recordings through the configured legacy or local-CPU protocol.
 * With the local-CPU protocol the drop zone never blocks: every upload becomes
 * its own job, shown with its own progress panel, so analyses can run in parallel.
 */
export function UploadTile({ onUploadSuccess }: UploadTileProperties) {
    const [isDragging, setIsDragging] = useState(false);
    const [uploadState, setUploadState] = useState<UploadState>('idle');
    const [uploadError, setUploadError] = useState<string | null>(null);
    const fileInputReference = useRef<HTMLInputElement>(null);

    const analysisJobs = useAnalysisJobs({ onJobSaved: onUploadSuccess });
    const { jobs, isEnabled, isResolved, isAuthenticationExpired } = analysisJobs;

    const uploadThroughLegacyEndpoint = async (input: RecordingInput): Promise<void> => {
        setUploadState('processing');

        const response = await fetch('/api/terminal-sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        });
        const body = await response.json().catch(() => ({})) as LegacyUploadResponse;

        if (!response.ok) {
            throw new Error(body.message ?? `Could not process upload (${response.status}).`);
        }

        setUploadState('success');
        onUploadSuccess?.();
    };

    const uploadThroughLocalCpuJobs = async (input: RecordingInput): Promise<void> => {
        const response = await fetch('/api/terminal-session-jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        });
        const body = await response.json().catch(() => ({})) as { job?: MlJobStatus; message?: string };

        if (!response.ok || !body.job) {
            throw new Error(body.message ?? `Could not start analysis (${response.status}).`);
        }

        analysisJobs.addJob(body.job);
        setUploadState('idle');
    };

    const handleFileUpload = async (file: File): Promise<void> => {
        setUploadState('registering');
        setUploadError(null);

        try {
            const input = await readRecording(file);

            if (isEnabled) {
                await uploadThroughLocalCpuJobs(input);
            } else {
                await uploadThroughLegacyEndpoint(input);
            }
        } catch (error) {
            setUploadError(error instanceof Error ? error.message : 'Upload failed.');
            setUploadState('error');
        }
    };

    const errorMessage = uploadError ?? analysisJobs.errorMessage;
    const hasError = errorMessage !== null && (uploadState === 'error' || jobs.length === 0 || isAuthenticationExpired);
    const isBusy = !isResolved || isAuthenticationExpired || uploadState === 'registering' || uploadState === 'processing';

    const title = !isResolved
        ? 'Checking upload configuration…'
        : uploadState === 'registering'
            ? 'Preparing upload…'
            : uploadState === 'processing'
                ? 'Processing upload…'
                : uploadState === 'success'
                    ? 'Session saved'
                    : isAuthenticationExpired
                        ? 'Sign in to resume progress'
                        : uploadState === 'error'
                            ? 'Upload failed'
                            : 'Upload Session';
    const subtitle = !isResolved
        ? 'Preparing the configured upload workflow.'
        : uploadState === 'registering'
            ? isEnabled ? 'Saving your upload as a durable analysis job.' : 'Reading your recording.'
            : uploadState === 'processing'
                ? 'The configured analyzer is processing this recording.'
                : uploadState === 'success'
                    ? 'Your annotated session is ready.'
                    : hasError
                        ? errorMessage
                        : isEnabled && jobs.length > 0
                            ? 'Analyses continue in the background. Drop another recording to start one in parallel.'
                            : 'Drop an asciinema .cast recording here or click to browse.';
    const icon = uploadState === 'success'
        ? <IconCheck className="text-emerald-400" size={30} />
        : uploadState === 'error' || isAuthenticationExpired
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
                    accept=".cast"
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
                    {!isBusy && uploadState !== 'success' && <span className="mt-4 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm">Choose .cast file</span>}
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
        </div>
    );
}
