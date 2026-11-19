import type { MlJobResources } from '@/app/lib/server/ml-jobs';

/** Formats whole seconds as "45s", "3m 05s" or "1h 02m". */
export function formatSeconds(totalSeconds: number): string {
    const seconds = Math.max(0, Math.round(totalSeconds));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** One-line label for the remaining-time estimate, or null when none exists yet. */
export function formatEta(etaSeconds: number | null): string | null {
    if (etaSeconds === null) return null;
    return etaSeconds < 5 ? 'almost done' : `about ${formatSeconds(etaSeconds)} left`;
}

export interface ResourceReading {
    label: string;
    percent: number;
    detail: string;
}

/** Turns raw usage figures into labelled readings for the progress panel. */
export function describeResources(resources: MlJobResources): ResourceReading[] {
    const readings: ResourceReading[] = [{
        label: 'CPU',
        percent: resources.cpu.percent,
        detail: `${resources.cpu.busyCores} of ${resources.cpu.cores} cores`,
    }];
    if (resources.gpu) {
        readings.push({
            label: 'GPU',
            percent: resources.gpu.percent,
            detail: resources.gpu.count === 1 ? '1 GPU' : `${resources.gpu.count} GPUs`,
        });
    }
    return readings;
}
