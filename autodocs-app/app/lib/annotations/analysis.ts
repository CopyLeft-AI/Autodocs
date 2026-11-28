/** What the analysis service returns, and the choices offered before running it. */
import type { SessionEvent } from '../session-content';

export interface ModelUse { backend: string; model: string; }

/** Which models produced an analysis; null when the service did not say. */
export interface AnalysisModels { boundaries: ModelUse | null; annotate: ModelUse | null; }

export interface AnalysisOptions {
  boundaryModel?: string;
  annotateModel?: string;
  summaryWordLimit?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
}

export interface ModelStepChoices {
  backend: string | null;
  defaultModel: string | null;
  models: string[];
}

export interface AnalysisChoices {
  /** 'jobs' runs in the background with progress; 'direct' keeps the request open. */
  mode: 'jobs' | 'direct';
  /** False when the analysis service did not answer; only its defaults can be used then. */
  serviceReachable: boolean;
  /** Users who may edit settings can type any model name. */
  canUseAnyModel: boolean;
  boundaries: ModelStepChoices;
  annotate: ModelStepChoices;
}

/** Read the service's result lines; throws when a line is not a usable event. */
export function readResultEvents(lines: string[]): SessionEvent[] {
  return lines.map((line) => {
    const item = JSON.parse(line) as { summary?: unknown; depth?: unknown; xml?: unknown };
    const depth = Number(item.depth);
    if (!Number.isInteger(depth) || typeof item.summary !== 'string') throw new Error('Invalid event annotation returned by ML service.');
    return { label: item.summary, depth, content: typeof item.xml === 'string' ? item.xml : null };
  });
}

export function readModels(value: unknown): AnalysisModels {
  const modelUse = (entry: unknown): ModelUse | null => {
    const candidate = entry as Partial<ModelUse> | null | undefined;
    return typeof candidate?.model === 'string' && typeof candidate.backend === 'string' ? { backend: candidate.backend, model: candidate.model } : null;
  };
  const models = value as Partial<Record<keyof AnalysisModels, unknown>> | null | undefined;
  return { boundaries: modelUse(models?.boundaries), annotate: modelUse(models?.annotate) };
}
