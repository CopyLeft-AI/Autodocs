// Ours
import type { AnalysisChoices, AnalysisOptions, ModelStepChoices } from '@/app/lib/annotations/analysis';
import { readMlConfig, type MlConfigStep } from '@/app/lib/server/ml-jobs';
import { getPermissions } from '@/app/lib/server/permissions';
import { isLocalCpuJobsEnabled } from '@/app/lib/server/processing-mode';
import { RequestError } from './errors';

function stepChoices(step: MlConfigStep | undefined): ModelStepChoices {
  if (!step) return { backend: null, defaultModel: null, models: [] };
  const listed = String(step.stored.alternativeModels ?? '').split(',').map((name) => name.trim()).filter(Boolean);
  return { backend: step.effective.backend, defaultModel: step.effective.model, models: [...new Set([step.effective.model, ...listed])] };
}

/** The models a user may pick: the configured ones, or any name for settings editors. */
export async function readAnalysisChoices(userId: string): Promise<AnalysisChoices> {
  const permissions = await getPermissions(userId);
  // The hosted synchronous service has no /config; its defaults still work.
  const config = await readMlConfig().catch((error: unknown) => {
    console.warn('Could not read the analysis service settings:', error instanceof Error ? error.message : error);
    return null;
  });
  return {
    mode: isLocalCpuJobsEnabled() ? 'jobs' : 'direct',
    serviceReachable: config !== null,
    canUseAnyModel: permissions?.canEditSettings ?? false,
    boundaries: stepChoices(config?.steps.boundaries),
    annotate: stepChoices(config?.steps.annotate),
  };
}

const EFFORTS = ['low', 'medium', 'high'] as const;

/**
 * Validate requested options against what this user may choose. Only model names
 * and summary settings pass: a request can never set a server address or key.
 */
export function checkAnalysisOptions(value: unknown, choices: AnalysisChoices): AnalysisOptions {
  const requested = (value ?? {}) as Record<string, unknown>;
  const options: AnalysisOptions = {};
  for (const [field, step] of [['boundaryModel', choices.boundaries], ['annotateModel', choices.annotate]] as const) {
    const model = requested[field];
    if (model === undefined || model === '') continue;
    if (typeof model !== 'string' || model.length > 200) throw new RequestError(400, `Invalid ${field}.`);
    if (!choices.canUseAnyModel && !step.models.includes(model)) throw new RequestError(403, `The model "${model}" is not one you can choose.`);
    options[field] = model;
  }
  const limit = requested.summaryWordLimit;
  if (limit !== undefined) {
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 5 || limit > 500) throw new RequestError(400, 'summaryWordLimit must be a whole number from 5 to 500.');
    options.summaryWordLimit = limit;
  }
  const effort = requested.reasoningEffort;
  if (effort !== undefined) {
    if (!EFFORTS.includes(effort as typeof EFFORTS[number])) throw new RequestError(400, 'reasoningEffort must be low, medium or high.');
    options.reasoningEffort = effort as typeof EFFORTS[number];
  }
  return options;
}
