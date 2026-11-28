"use client";

import { IconLoader2, IconPencil, IconSparkles } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { Modal } from '@/app/components/Modal';
import type { AnalysisChoices, AnalysisOptions, ModelStepChoices } from '@/app/lib/annotations/analysis';
import { messageOf, request } from '@/app/lib/editor/api';
import type { MlJobStatus } from '@/app/lib/server/ml-jobs';

interface AnalysisDialogProps {
  sessionId: string;
  title: string;
  /** Offered right after an upload: go to the editor without running a model. */
  onAnnotateManually?: () => void;
  /** `job` is null when the analysis already finished within the request. */
  onStarted: (job: MlJobStatus | null) => void;
  onClose: () => void;
}

const field = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm';

function ModelField({ label, step, anyModel, value, onChange }: { label: string; step: ModelStepChoices; anyModel: boolean; value: string; onChange: (value: string) => void }) {
  const list = `models-${label.replaceAll(' ', '-')}`;
  const fallback = step.defaultModel ? `Default: ${step.defaultModel}` : 'Service default';
  return (
    <label className="block space-y-1">
      <span className="text-sm">{label}{step.backend && <span className="text-muted-foreground"> ({step.backend})</span>}</span>
      {anyModel ? (
        <>
          <input list={list} value={value} maxLength={200} placeholder={fallback} onChange={(event) => onChange(event.target.value)} className={field} />
          <datalist id={list}>{step.models.map((model) => <option key={model} value={model} />)}</datalist>
        </>
      ) : (
        <select value={value} onChange={(event) => onChange(event.target.value)} className={field}>
          <option value="">{fallback}</option>
          {step.models.filter((model) => model !== step.defaultModel).map((model) => <option key={model}>{model}</option>)}
        </select>
      )}
    </label>
  );
}

/** Choose the model and settings of an analysis, or none at all. */
export function AnalysisDialog({ sessionId, title, onAnnotateManually, onStarted, onClose }: AnalysisDialogProps) {
  const [choices, setChoices] = useState<AnalysisChoices | null>(null);
  const [boundaryModel, setBoundaryModel] = useState('');
  const [annotateModel, setAnnotateModel] = useState('');
  const [wordLimit, setWordLimit] = useState('');
  const [effort, setEffort] = useState('');
  const [starting, setStarting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    request<AnalysisChoices>('GET', '/api/analysis-options')
      .then(setChoices)
      .catch((error: unknown) => setErrorMessage(messageOf(error)));
  }, []);

  const start = async () => {
    setStarting(true);
    setErrorMessage(null);
    const options: AnalysisOptions = {
      ...(boundaryModel.trim() && { boundaryModel: boundaryModel.trim() }),
      ...(annotateModel.trim() && { annotateModel: annotateModel.trim() }),
      ...(wordLimit && { summaryWordLimit: Number(wordLimit) }),
      ...(effort && { reasoningEffort: effort as AnalysisOptions['reasoningEffort'] }),
    };
    try {
      const started = await request<{ job?: MlJobStatus }>('POST', `/api/terminal-sessions/${sessionId}/analysis`, { options });
      onStarted(started.job ?? null);
    } catch (error) {
      setErrorMessage(messageOf(error));
      setStarting(false);
    }
  };

  return (
    <Modal title={`Annotate "${title}"`} onClose={onClose}>
      <div className="space-y-5">
        {onAnnotateManually && (
          <>
            <button type="button" onClick={onAnnotateManually} className="flex w-full items-center gap-3 rounded-lg border border-emerald-400/60 bg-emerald-500/10 p-4 text-left hover:bg-emerald-500/20">
              <IconPencil className="shrink-0 text-emerald-300" />
              <span><span className="block">Annotate it myself</span><span className="text-sm text-muted-foreground">Open the editor without running a model.</span></span>
            </button>
            <p className="text-center text-xs text-muted-foreground">or let a model do a first pass, which you can then correct</p>
          </>
        )}

        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void start(); }}>
          {!choices && !errorMessage && <p className="text-sm text-muted-foreground">Reading the available models…</p>}
          {choices && (
            <>
              {!choices.serviceReachable && <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">The analysis service did not report its models. Only its defaults can be used.</p>}
              <ModelField label="Model that finds the events" step={choices.boundaries} anyModel={choices.canUseAnyModel} value={boundaryModel} onChange={setBoundaryModel} />
              <ModelField label="Model that describes them" step={choices.annotate} anyModel={choices.canUseAnyModel} value={annotateModel} onChange={setAnnotateModel} />
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-sm">Longest description (words)</span>
                  <input type="number" min={5} max={500} value={wordLimit} placeholder="Default" onChange={(event) => setWordLimit(event.target.value)} className={field} />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm">Reasoning effort</span>
                  <select value={effort} onChange={(event) => setEffort(event.target.value)} className={field}>
                    <option value="">Default</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
                  </select>
                </label>
              </div>
            </>
          )}
          {errorMessage && <p role="alert" className="text-sm text-destructive">{errorMessage}</p>}
          <button type="submit" disabled={starting || (!choices && !errorMessage)} className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">
            {starting ? <IconLoader2 size={18} className="animate-spin" /> : <IconSparkles size={18} />}
            {starting ? (choices?.mode === 'direct' ? 'Analysing, this can take a while…' : 'Starting…') : 'Run the model'}
          </button>
        </form>
      </div>
    </Modal>
  );
}
