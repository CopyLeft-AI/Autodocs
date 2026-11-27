"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MlJobControlAction, MlJobStatus } from '@/app/lib/server/ml-jobs';

const POLL_INTERVAL_MILLISECONDS = 1000;
const SETTLED_STATES: ReadonlyArray<MlJobStatus['status']> = ['completed', 'failed', 'cancelled'];

/** True while the ML service may still change this job's progress. */
export function isJobSettled(job: MlJobStatus): boolean {
    return SETTLED_STATES.includes(job.status);
}

interface JobListResponse {
    enabled?: boolean;
    jobs?: MlJobStatus[];
    message?: string;
}

interface AnalysisJobsOptions {
    /** Called once per job when its finished result has been saved as a session. */
    onJobSaved?: () => void;
}

export interface AnalysisJobs {
    jobs: MlJobStatus[];
    /** True when the server runs the durable local-CPU job protocol. */
    isEnabled: boolean;
    /** False until the first server answer says which protocol is active. */
    isResolved: boolean;
    isAuthenticationExpired: boolean;
    errorMessage: string | null;
    /** Job ids with a control or delete request in flight. */
    busyJobIds: ReadonlySet<string>;
    addJob: (job: MlJobStatus) => void;
    controlJob: (jobId: string, action: MlJobControlAction) => Promise<void>;
    deleteJob: (jobId: string) => Promise<void>;
    /** Hides a finished job from the list without touching the server. */
    dismissJob: (jobId: string) => void;
}

/** fetch() that retries once after refreshing an expired access token. */
async function fetchWithRefresh(url: string, init?: RequestInit): Promise<Response> {
    const response = await fetch(url, { cache: 'no-store', ...init });
    if (response.status !== 401) return response;

    const refresh = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
    if (!refresh.ok) return response;
    return fetch(url, { cache: 'no-store', ...init });
}

async function readMessage(response: Response, fallback: string): Promise<string> {
    const body = await response.json().catch(() => ({})) as { message?: string };
    return body.message ?? fallback;
}

/**
 * Owns the list of analysis jobs: restores them after a reload, polls the
 * unfinished ones, and sends pause/resume/cancel/delete requests. Several jobs
 * can be active at once; each is tracked independently.
 */
export function useAnalysisJobs({ onJobSaved }: AnalysisJobsOptions = {}): AnalysisJobs {
    const [jobs, setJobs] = useState<MlJobStatus[]>([]);
    const [isEnabled, setIsEnabled] = useState(false);
    const [isResolved, setIsResolved] = useState(false);
    const [isAuthenticationExpired, setIsAuthenticationExpired] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [busyJobIds, setBusyJobIds] = useState<ReadonlySet<string>>(new Set());

    const isPollingReference = useRef(false);
    const savedJobIdsReference = useRef<Set<string>>(new Set());
    const onJobSavedReference = useRef(onJobSaved);

    useEffect(() => {
        onJobSavedReference.current = onJobSaved;
    }, [onJobSaved]);

    const replaceJob = useCallback((updated: MlJobStatus): void => {
        setJobs((current) => current.map((job) => (job.id === updated.id ? { ...updated, sessionId: updated.sessionId ?? job.sessionId } : job)));
    }, []);

    const setBusy = useCallback((jobId: string, isBusy: boolean): void => {
        setBusyJobIds((current) => {
            const next = new Set(current);
            if (isBusy) next.add(jobId); else next.delete(jobId);
            return next;
        });
    }, []);

    /** Reads one job; the server also saves a finished result as a session. */
    const pollJob = useCallback(async (jobId: string): Promise<void> => {
        const response = await fetchWithRefresh(`/api/terminal-session-jobs/${encodeURIComponent(jobId)}`);

        if (response.status === 401) {
            setIsAuthenticationExpired(true);
            throw new Error('Your login expired. Sign in again to view progress. Analyses may still be running.');
        }
        if (!response.ok) {
            throw new Error(await readMessage(response, `Progress check failed with status ${response.status}`));
        }

        const { job } = await response.json() as { job: MlJobStatus };
        replaceJob(job);

        if (job.status === 'completed' && !savedJobIdsReference.current.has(job.id)) {
            savedJobIdsReference.current.add(job.id);
            onJobSavedReference.current?.();
        }
    }, [replaceJob]);

    useEffect(() => {
        let isDisposed = false;

        const restoreJobs = async (): Promise<void> => {
            try {
                const response = await fetchWithRefresh('/api/terminal-session-jobs');

                if (isDisposed) return;
                if (response.status === 401) {
                    setIsAuthenticationExpired(true);
                    setErrorMessage('Your login expired. Sign in again to resume progress.');
                    return;
                }
                // Older deployments may not provide the job API at all.
                if (response.status === 404) return;
                if (!response.ok) throw new Error(`Could not restore analyses (${response.status}).`);

                const body = await response.json() as JobListResponse;
                if (isDisposed) return;

                setIsEnabled(body.enabled === true);
                const restored = body.jobs ?? [];
                setJobs(restored);
                // Finished-but-unsaved jobs are saved by the detail endpoint.
                await Promise.all(restored.filter((job) => job.status === 'completed').map((job) => pollJob(job.id)));
            } catch (error) {
                if (!isDisposed) setErrorMessage(error instanceof Error ? error.message : 'Could not restore analysis status.');
            } finally {
                if (!isDisposed) setIsResolved(true);
            }
        };

        void restoreJobs();
        return () => {
            isDisposed = true;
        };
    }, [pollJob]);

    const hasUnsettledJob = jobs.some((job) => !isJobSettled(job));
    const unsettledIds = jobs.filter((job) => !isJobSettled(job)).map((job) => job.id).join(',');

    useEffect(() => {
        if (!hasUnsettledJob || isAuthenticationExpired) return;

        const timer = setInterval(() => {
            if (isPollingReference.current) return;
            isPollingReference.current = true;

            void Promise.all(unsettledIds.split(',').map((jobId) => pollJob(jobId).catch((error: unknown) => {
                setErrorMessage(error instanceof Error ? error.message : 'Unable to read analysis progress.');
            }))).finally(() => {
                isPollingReference.current = false;
            });
        }, POLL_INTERVAL_MILLISECONDS);

        return () => clearInterval(timer);
    }, [hasUnsettledJob, unsettledIds, isAuthenticationExpired, pollJob]);

    const addJob = useCallback((job: MlJobStatus): void => {
        setIsEnabled(true);
        setJobs((current) => [job, ...current.filter((existing) => existing.id !== job.id)]);
    }, []);

    const controlJob = useCallback(async (jobId: string, action: MlJobControlAction): Promise<void> => {
        setBusy(jobId, true);
        setErrorMessage(null);
        try {
            const response = await fetchWithRefresh(`/api/terminal-session-jobs/${encodeURIComponent(jobId)}/control`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action }),
            });
            if (!response.ok) throw new Error(await readMessage(response, `Could not ${action} the analysis.`));
            replaceJob((await response.json() as { job: MlJobStatus }).job);
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : `Could not ${action} the analysis.`);
        } finally {
            setBusy(jobId, false);
        }
    }, [replaceJob, setBusy]);

    const deleteJob = useCallback(async (jobId: string): Promise<void> => {
        setBusy(jobId, true);
        setErrorMessage(null);
        try {
            const response = await fetchWithRefresh(`/api/terminal-session-jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
            if (!response.ok) throw new Error(await readMessage(response, 'Could not delete the analysis.'));
            setJobs((current) => current.filter((job) => job.id !== jobId));
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : 'Could not delete the analysis.');
        } finally {
            setBusy(jobId, false);
        }
    }, [setBusy]);

    const dismissJob = useCallback((jobId: string): void => {
        setJobs((current) => current.filter((job) => job.id !== jobId));
    }, []);

    return { jobs, isEnabled, isResolved, isAuthenticationExpired, errorMessage, busyJobIds, addJob, controlJob, deleteJob, dismissJob };
}
