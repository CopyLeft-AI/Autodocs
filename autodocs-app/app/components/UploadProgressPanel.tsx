"use client";

import {
    IconAlertTriangle, IconBan, IconCheck, IconCircleDashed, IconActivity, IconClock, IconListDetails,
    IconPlayerPause, IconPlayerPlay, IconPlayerStop, IconTimelineEvent, IconTrash, IconX,
} from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { describeResources, formatEta, formatSeconds } from '@/app/lib/job-format';
import type { MlJobControlAction, MlJobStatus } from '@/app/lib/server/ml-jobs';

function elapsed(job: MlJobStatus): string {
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(job.createdAt).getTime()) / 1000));
    return formatSeconds(seconds);
}

function headline(job: MlJobStatus): string {
    switch (job.status) {
        case 'failed': return 'Analysis failed';
        case 'cancelled': return 'Analysis cancelled';
        case 'completed': return 'Analysis complete';
        case 'paused': return 'Analysis paused';
        case 'queued':
            return job.nextRetryAt
                ? 'Analysis retry scheduled'
                : 'Analysis queued';
        default: return 'Analysis in progress';
    }
}

function subline(job: MlJobStatus): string {
    if (job.status === 'failed') return job.error ?? 'The analysis failed.';
    if (job.status === 'cancelled') return 'Stopped before it finished. Nothing was saved.';
    if (job.status === 'paused' && job.nextRetryAt) {
        return 'Connection retry paused. Resume to continue automatically.';
    }
    if (job.status === 'queued' && job.nextRetryAt) {
        const remaining = Math.ceil(
            (Date.parse(job.nextRetryAt) - Date.now()) / 1000
        );
        const retry = job.retryCount ?? 1;

        if (!Number.isFinite(remaining)) {
            return 'Connection temporarily unavailable. Automatic retry scheduled.';
        }
        if (remaining > 0) {
            return `Connection temporarily unavailable · retry ${retry} in ${formatSeconds(remaining)}.`;
        }
        return `Connection temporarily unavailable · retry ${retry} waiting for a worker.`;
    }
    if (job.status === 'queued') return 'Waiting for a free inference worker.';
    const eta = job.status === 'running' ? formatEta(job.etaSeconds) : null;
    return [`${job.title}`, `${elapsed(job)} since upload`, `${job.percent}% complete`, eta].filter(Boolean).join(' · ');
}

interface ControlButtonProperties {
    label: string;
    icon: ReactNode;
    onClick: () => void;
    disabled: boolean;
    tone?: 'default' | 'danger';
}

function ControlButton({ label, icon, onClick, disabled, tone = 'default' }: ControlButtonProperties) {
    const toneClasses = tone === 'danger'
        ? 'border-destructive/40 text-destructive hover:bg-destructive/10'
        : 'border-border text-foreground hover:bg-accent/20';
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50 ${toneClasses}`}
        >
            {icon}
            {label}
        </button>
    );
}

interface UploadProgressPanelProperties {
    job: MlJobStatus;
    /** True while a control or delete request for this job is in flight. */
    isBusy: boolean;
    onControl: (action: MlJobControlAction) => void;
    onDelete: () => void;
    onDismiss: () => void;
}

/** Live progress of one analysis job, with its pause/resume/cancel/delete controls. */
export function UploadProgressPanel({ job, isBusy, onControl, onDelete, onDismiss }: UploadProgressPanelProperties) {
    const failed = job.status === 'failed';
    const cancelled = job.status === 'cancelled';
    const complete = job.status === 'completed';
    const paused = job.status === 'paused';
    const isActive = job.status === 'queued' || job.status === 'running' || paused;
    const canPause = job.status === 'running' || (job.status === 'queued' && Boolean(job.nextRetryAt));
    const barColor = failed ? 'bg-destructive' : complete ? 'bg-emerald-400' : cancelled || paused ? 'bg-muted-foreground' : 'bg-primary';
    const border = failed ? 'border-destructive/40 bg-destructive/5'
        : complete ? 'border-emerald-500/40 bg-emerald-500/5'
            : cancelled ? 'border-border bg-secondary/20'
                : 'border-primary/30 bg-secondary/40';
    const resourceReadings = job.resources && !paused ? describeResources(job.resources) : [];
    const icon = failed ? <IconAlertTriangle size={22} />
        : cancelled ? <IconBan size={22} />
            : complete ? <IconCheck size={22} />
                : paused ? <IconPlayerPause size={22} />
                    : <IconActivity size={22} className="animate-pulse" />;

    return (
        <section className={`rounded-xl border p-4 ${border}`} aria-live="polite" aria-label={`${headline(job)}: ${job.title}`}>
            <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-start gap-3 min-w-0">
                    <div className="mt-0.5 text-primary">{icon}</div>
                    <div className="min-w-0">
                        <h3 className="text-sm">{headline(job)}</h3>
                        <p className="text-xs text-muted-foreground mt-1 break-words">{subline(job)}</p>
                    </div>
                </div>
                <span className="font-mono text-sm text-primary">{job.percent}%</span>
            </div>

            <div className="flex flex-wrap items-center gap-2 mb-4">
                {canPause && <ControlButton label="Pause" icon={<IconPlayerPause size={14} />} disabled={isBusy} onClick={() => onControl('pause')} />}
                {paused && <ControlButton label="Resume" icon={<IconPlayerPlay size={14} />} disabled={isBusy} onClick={() => onControl('resume')} />}
                {isActive && (
                    <ControlButton
                        label="Cancel"
                        icon={<IconPlayerStop size={14} />}
                        tone="danger"
                        disabled={isBusy}
                        onClick={() => { if (window.confirm(`Cancel the analysis of "${job.title}"? Its progress is lost.`)) onControl('cancel'); }}
                    />
                )}
                {(failed || cancelled) && (
                    <ControlButton
                        label="Delete"
                        icon={<IconTrash size={14} />}
                        tone="danger"
                        disabled={isBusy}
                        onClick={() => { if (window.confirm(`Delete this analysis and its uploaded recording?`)) onDelete(); }}
                    />
                )}
                {complete && <ControlButton label="Dismiss" icon={<IconX size={14} />} disabled={false} onClick={onDismiss} />}
            </div>

            <div className="h-2 rounded-full bg-muted overflow-hidden mb-3">
                <div className={`h-full transition-[width] duration-500 ${barColor}`} style={{ width: `${job.percent}%` }} />
            </div>

            {resourceReadings.length > 0 && (
                <div className="flex flex-wrap gap-x-5 gap-y-1 mb-4 text-[11px] text-muted-foreground font-mono" aria-label="Local resource usage">
                    {resourceReadings.map((reading) => (
                        <span key={reading.label} title={`Machine-wide ${reading.label} load while this job runs`}>
                            {reading.label} {reading.percent}% <span className="text-muted-foreground/70">({reading.detail})</span>
                        </span>
                    ))}
                </div>
            )}

            <div className="space-y-2 mb-5">
                {job.stages.map((stage) => (
                    <div key={stage.id} className="rounded-lg border border-border/70 bg-card/60 p-2.5">
                        <div className="flex items-center gap-2 text-xs">
                            <span className={stage.status === 'completed' ? 'text-emerald-400' : stage.status === 'running' ? 'text-primary' : 'text-muted-foreground'}>
                                {stage.status === 'completed' ? <IconCheck size={15} /> : stage.status === 'running' ? <IconCircleDashed size={15} className={isActive && !paused ? 'animate-spin' : ''} /> : <IconClock size={15} />}
                            </span>
                            <span className="text-foreground flex-1">{stage.label}</span>
                            {stage.total > 0 && <span className="font-mono text-muted-foreground">{stage.current}/{stage.total}</span>}
                        </div>
                        {stage.status !== 'pending' && (
                            <>
                                <p className="text-[11px] text-muted-foreground mt-1.5">{stage.detail}</p>
                                {stage.total > 1 && (
                                    <div className="h-1 mt-2 rounded-full bg-muted overflow-hidden">
                                        <div className="h-full bg-primary/80" style={{ width: `${Math.round(stage.current / stage.total * 100)}%` }} />
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                ))}
            </div>

            <div className="border-t border-border/70 pt-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                    <IconTimelineEvent size={15} />
                    <span>Detailed progress log</span>
                    <span className="ml-auto"><IconListDetails size={15} /></span>
                </div>
                <ol className="max-h-56 overflow-y-auto space-y-2 pr-1">
                    {[...job.timeline].reverse().map((event, index) => (
                        <li key={`${event.at}-${index}`} className="flex gap-2 text-[11px]">
                            <time className="font-mono text-muted-foreground whitespace-nowrap">{new Date(event.at).toLocaleTimeString()}</time>
                            <span className="text-foreground/90">{event.message}</span>
                        </li>
                    ))}
                </ol>
            </div>
        </section>
    );
}
