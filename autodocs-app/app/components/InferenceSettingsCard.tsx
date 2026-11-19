"use client";

import { useEffect, useState } from 'react';
import { Cpu } from 'lucide-react';
import type { MlConfig, MlConfigStep } from '@/app/lib/server/ml-jobs';

type StepId = 'boundaries' | 'annotate';

const STEP_TITLES: Record<StepId, { title: string; help: string }> = {
  boundaries: { title: 'Event boundaries', help: 'Decides where one terminal event ends and the next begins.' },
  annotate: { title: 'Event summaries', help: 'Writes the depth and summary of every event.' },
};

const BACKEND_LABELS: Record<string, string> = {
  ollama: 'Ollama',
  llamacpp: 'llama.cpp server',
  openai: 'OpenAI-compatible API',
  cloudtemple: 'Cloud Temple API',
};

/** Text fields of a step as typed by the user; an empty string means "use the default". */
interface StepDraft {
  backend: string;
  model: string;
  baseUrl: string;
  timeoutSeconds: string;
  maxTokens: string;
  numThread: string;
  maxAttempts: string;
  reasoningEffort: string;
  summaryWordLimit: string;
  apiKey: string;
  removeApiKey: boolean;
}

interface ProcessingDraft {
  remoteApiConcurrency: string;
  maxConcurrentJobs: string;
  inferenceLocation: string;
}

const NUMBER_FIELDS = ['timeoutSeconds', 'maxTokens', 'numThread', 'maxAttempts', 'summaryWordLimit'] as const;
const TEXT_FIELDS = ['backend', 'model', 'baseUrl', 'reasoningEffort'] as const;

function toStepDraft(step: MlConfigStep): StepDraft {
  const stored = (name: string): string => (step.stored[name] === undefined ? '' : String(step.stored[name]));
  return {
    backend: stored('backend'), model: stored('model'), baseUrl: stored('baseUrl'),
    timeoutSeconds: stored('timeoutSeconds'), maxTokens: stored('maxTokens'), numThread: stored('numThread'),
    maxAttempts: stored('maxAttempts'), reasoningEffort: stored('reasoningEffort'),
    summaryWordLimit: stored('summaryWordLimit'), apiKey: '', removeApiKey: false,
  };
}

function toProcessingDraft(config: MlConfig): ProcessingDraft {
  const stored = (name: string): string => (config.processing.stored[name] === undefined ? '' : String(config.processing.stored[name]));
  return { remoteApiConcurrency: stored('remoteApiConcurrency'), maxConcurrentJobs: stored('maxConcurrentJobs'), inferenceLocation: stored('inferenceLocation') };
}

/** Build the update body: empty fields become null (reset to default); the API key is sent only when changed. */
export function buildUpdate(steps: Record<StepId, StepDraft>, processing: ProcessingDraft): unknown {
  const stepBody = (draft: StepDraft): Record<string, string | number | null> => {
    const body: Record<string, string | number | null> = {};
    for (const name of TEXT_FIELDS) body[name] = draft[name].trim() === '' ? null : draft[name].trim();
    for (const name of NUMBER_FIELDS) body[name] = draft[name].trim() === '' ? null : Number(draft[name]);
    if (draft.removeApiKey) body.apiKey = '';
    else if (draft.apiKey !== '') body.apiKey = draft.apiKey;
    return body;
  };
  const asNumber = (value: string): number | null => (value.trim() === '' ? null : Number(value));
  return {
    steps: { boundaries: stepBody(steps.boundaries), annotate: stepBody(steps.annotate) },
    processing: {
      remoteApiConcurrency: asNumber(processing.remoteApiConcurrency),
      maxConcurrentJobs: asNumber(processing.maxConcurrentJobs),
      inferenceLocation: processing.inferenceLocation === '' ? null : processing.inferenceLocation,
    },
  };
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="block text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground">{label}</label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

const inputClass = 'w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary disabled:opacity-60';

/** See and edit which model and inference source each analysis step uses (stored in the service's config file). */
export function InferenceSettingsCard() {
  const [config, setConfig] = useState<MlConfig | null>(null);
  const [steps, setSteps] = useState<Record<StepId, StepDraft> | null>(null);
  const [processing, setProcessing] = useState<ProcessingDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const adopt = (data: MlConfig) => {
    setConfig(data);
    setSteps({ boundaries: toStepDraft(data.steps.boundaries), annotate: toStepDraft(data.steps.annotate) });
    setProcessing(toProcessingDraft(data));
  };

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch('/api/settings/inference', { credentials: 'include' });
        const data = (await response.json().catch(() => ({}))) as MlConfig & { message?: string };
        if (!response.ok) throw new Error(data.message ?? `Request failed with status ${response.status}`);
        adopt(data);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to load inference settings.');
      }
    };
    void load();
  }, []);

  const updateStep = (id: StepId, changes: Partial<StepDraft>) =>
    setSteps((current) => (current ? { ...current, [id]: { ...current[id], ...changes } } : current));

  const handleSave = async () => {
    if (!steps || !processing) return;
    setIsSaving(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const response = await fetch('/api/settings/inference', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(buildUpdate(steps, processing)),
      });
      const data = (await response.json().catch(() => ({}))) as MlConfig & { message?: string };
      if (!response.ok) throw new Error(data.message ?? `Request failed with status ${response.status}`);
      adopt(data);
      setStatusMessage('Saved to the configuration file. It applies to analyses you start from now on.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save inference settings.');
    } finally {
      setIsSaving(false);
    }
  };

  const limit = (name: string, edge: 'min' | 'max'): number | undefined => config?.schema.limits[name]?.[edge];

  const numberInput = (id: string, value: string, onChange: (value: string) => void, name: string, placeholder: string) => (
    <input
      id={id} type="number" inputMode="numeric" value={value} placeholder={placeholder}
      min={limit(name, 'min')} max={limit(name, 'max')} disabled={isSaving}
      onChange={(event) => onChange(event.target.value)} className={inputClass}
    />
  );

  return (
    <div className="bg-card rounded-xl border border-border p-6 hover:bg-accent/10 transition-colors">
      <p className="mb-5 text-xs font-mono uppercase tracking-[0.24em] text-muted-foreground">Inference</p>

      {statusMessage && (
        <div className="mb-5 rounded-lg border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary">{statusMessage}</div>
      )}

      <div className="flex gap-4 items-start">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Cpu className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1 space-y-6">
          <p className="text-xs text-muted-foreground">
            Choose the model and inference source for each analysis step. Values are saved in the analysis service&apos;s
            configuration file{config ? ` (${config.path})` : ''}. A field left empty uses the default shown in it.
          </p>

          {!config && !errorMessage && <p className="text-sm text-muted-foreground">Loading...</p>}

          {config && steps && processing && (
            <>
              {(['boundaries', 'annotate'] as StepId[]).map((id) => {
                const draft = steps[id];
                const view = config.steps[id];
                const backend = draft.backend || view.effective.backend;
                const isChat = config.schema.chatBackends.includes(backend);
                return (
                  <fieldset key={id} className="rounded-lg border border-border/70 p-4" disabled={isSaving}>
                    <legend className="px-2 text-sm text-foreground">{STEP_TITLES[id].title}</legend>
                    <p className="mb-3 text-[11px] text-muted-foreground">{STEP_TITLES[id].help}</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Inference source" htmlFor={`${id}-backend`}>
                        <select id={`${id}-backend`} className={inputClass} value={draft.backend} onChange={(event) => updateStep(id, { backend: event.target.value })}>
                          <option value="">Default ({BACKEND_LABELS[view.effective.backend] ?? view.effective.backend})</option>
                          {config.schema.backends.map((name) => <option key={name} value={name}>{BACKEND_LABELS[name] ?? name}</option>)}
                        </select>
                      </Field>
                      <Field label="Model" htmlFor={`${id}-model`}>
                        <input id={`${id}-model`} className={inputClass} value={draft.model} placeholder={view.effective.model} onChange={(event) => updateStep(id, { model: event.target.value })} />
                      </Field>
                      <Field label="Base URL" htmlFor={`${id}-baseUrl`} hint={backend === 'llamacpp' ? 'Required for llama.cpp, for example http://127.0.0.1:8080' : undefined}>
                        <input id={`${id}-baseUrl`} className={inputClass} value={draft.baseUrl} placeholder={view.effective.baseUrl || 'http://host:port'} onChange={(event) => updateStep(id, { baseUrl: event.target.value })} />
                      </Field>
                      {isChat && (
                        <Field
                          label="API key" htmlFor={`${id}-apiKey`}
                          hint={view.apiKeySet ? (view.apiKeyInFile ? 'A key is stored. Type to replace it.' : 'A key comes from the service environment. Type to override it.') : 'No key is set.'}
                        >
                          <input id={`${id}-apiKey`} type="password" autoComplete="off" className={inputClass} value={draft.apiKey} placeholder={view.apiKeySet ? 'Unchanged' : 'Paste a key'} disabled={draft.removeApiKey} onChange={(event) => updateStep(id, { apiKey: event.target.value })} />
                          {view.apiKeyInFile && (
                            <label className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                              <input type="checkbox" checked={draft.removeApiKey} onChange={(event) => updateStep(id, { removeApiKey: event.target.checked, apiKey: '' })} />
                              Remove the stored key
                            </label>
                          )}
                        </Field>
                      )}
                      <Field label="Timeout (seconds)" htmlFor={`${id}-timeoutSeconds`}>
                        {numberInput(`${id}-timeoutSeconds`, draft.timeoutSeconds, (value) => updateStep(id, { timeoutSeconds: value }), 'timeoutSeconds', String(view.effective.timeoutSeconds))}
                      </Field>
                      <Field label="Max output tokens" htmlFor={`${id}-maxTokens`}>
                        {numberInput(`${id}-maxTokens`, draft.maxTokens, (value) => updateStep(id, { maxTokens: value }), 'maxTokens', String(view.effective.maxTokens))}
                      </Field>
                      {backend === 'ollama' && (
                        <Field label="Threads (Ollama)" htmlFor={`${id}-numThread`}>
                          {numberInput(`${id}-numThread`, draft.numThread, (value) => updateStep(id, { numThread: value }), 'numThread', String(view.effective.numThread))}
                        </Field>
                      )}
                      {isChat && (
                        <Field label="Attempts per request" htmlFor={`${id}-maxAttempts`} hint="Retries on rate limits and server errors.">
                          {numberInput(`${id}-maxAttempts`, draft.maxAttempts, (value) => updateStep(id, { maxAttempts: value }), 'maxAttempts', String(view.effective.maxAttempts))}
                        </Field>
                      )}
                      {id === 'annotate' && backend === 'ollama' && (
                        <Field label="Reasoning effort (Ollama)" htmlFor={`${id}-reasoningEffort`}>
                          <select id={`${id}-reasoningEffort`} className={inputClass} value={draft.reasoningEffort} onChange={(event) => updateStep(id, { reasoningEffort: event.target.value })}>
                            <option value="">Default ({view.effective.reasoningEffort})</option>
                            {config.schema.reasoningEfforts.map((name) => <option key={name} value={name}>{name}</option>)}
                          </select>
                        </Field>
                      )}
                      {id === 'annotate' && (
                        <Field label="Summary length (words)" htmlFor={`${id}-summaryWordLimit`}>
                          {numberInput(`${id}-summaryWordLimit`, draft.summaryWordLimit, (value) => updateStep(id, { summaryWordLimit: value }), 'summaryWordLimit', String(view.effective.summaryWordLimit))}
                        </Field>
                      )}
                    </div>
                  </fieldset>
                );
              })}

              <fieldset className="rounded-lg border border-border/70 p-4" disabled={isSaving}>
                <legend className="px-2 text-sm text-foreground">Processing</legend>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Parallel API requests" htmlFor="processing-remoteApiConcurrency" hint="Service default for remote APIs. Your own value below overrides it.">
                    {numberInput('processing-remoteApiConcurrency', processing.remoteApiConcurrency, (value) => setProcessing({ ...processing, remoteApiConcurrency: value }), 'remoteApiConcurrency', String(config.processing.effective.remoteApiConcurrency))}
                  </Field>
                  <Field label="Analyses at once" htmlFor="processing-maxConcurrentJobs" hint="Takes effect after the service restarts.">
                    {numberInput('processing-maxConcurrentJobs', processing.maxConcurrentJobs, (value) => setProcessing({ ...processing, maxConcurrentJobs: value }), 'maxConcurrentJobs', String(config.processing.effective.maxConcurrentJobs))}
                  </Field>
                  <Field label="Where models run" htmlFor="processing-inferenceLocation" hint="Auto treats a loopback address as this machine.">
                    <select id="processing-inferenceLocation" className={inputClass} value={processing.inferenceLocation} onChange={(event) => setProcessing({ ...processing, inferenceLocation: event.target.value })}>
                      <option value="">Default ({config.processing.effective.inferenceLocation})</option>
                      {config.schema.locations.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                  </Field>
                </div>
              </fieldset>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button" onClick={() => void handleSave()} disabled={isSaving}
                  className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSaving ? 'Saving...' : 'Save inference settings'}
                </button>
              </div>
            </>
          )}

          {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
        </div>
      </div>
    </div>
  );
}
