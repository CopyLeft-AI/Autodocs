// Ours
import { errorResponse, jsonBody, jsonResponse, pathParameter, ref, SIGNED_IN_ERRORS, STRING } from './builders';
import type { OpenApiPaths } from './types';

const SESSIONS = 'Terminal sessions';
const JOBS = 'Analysis jobs';

const ANNOTATIONS = 'Annotations';

const SESSION_ID = pathParameter('terminalSessionId', 'The session id.');
const ACCESS_ERRORS = {
  ...SIGNED_IN_ERRORS,
  '403': errorResponse('The session is shared with you without the needed right.'),
  '404': errorResponse('Not found, or not shared with you.'),
};

const JOB_DISABLED = errorResponse('Analysis jobs are disabled on this deployment.');

/** Stored analyses, sharing, and the background analysis jobs that produce them. */
export const SESSION_PATHS: OpenApiPaths = {
  '/api/terminal-sessions': {
    get: {
      tags: [SESSIONS],
      summary: 'Sessions the signed-in user owns',
      responses: {
        '200': jsonResponse('Newest first.', { type: 'object', properties: { terminalSessions: { type: 'array', items: ref('TerminalSession') } } }),
        ...SIGNED_IN_ERRORS,
      },
    },
    post: {
      tags: [SESSIONS],
      summary: 'Store a recording without analysing it',
      description: 'Accepts asciicast v1, v2 and v3. Annotations in the header (librecode_annotations) are imported. Run a model afterwards with the analysis endpoint.',
      requestBody: jsonBody(ref('TerminalSessionCreate')),
      responses: {
        '201': jsonResponse('Stored.', { type: 'object', properties: { terminalSession: ref('TerminalSession') } }),
        '400': errorResponse('Missing title, or content that is not a recording.'),
        '413': errorResponse('The recording is larger than 50 MB.'),
        ...SIGNED_IN_ERRORS,
      },
    },
  },
  '/api/terminal-sessions/shared': {
    get: {
      tags: [SESSIONS],
      summary: 'Sessions other users shared with the signed-in user',
      responses: {
        '200': jsonResponse('Newest first.', { type: 'object', properties: { terminalSessions: { type: 'array', items: ref('SharedTerminalSession') } } }),
        ...SIGNED_IN_ERRORS,
      },
    },
  },
  '/api/terminal-sessions/share': {
    post: {
      tags: [SESSIONS],
      summary: 'Share a session with another user',
      requestBody: jsonBody(ref('ShareRequest')),
      responses: {
        '200': jsonResponse('Shared.', { type: 'object', properties: { message: { type: 'string' }, sharedWith: ref('User') } }),
        '400': errorResponse('Invalid ids, no target given, or sharing with yourself.'),
        '403': errorResponse('Only the owner can share a session.'),
        '404': errorResponse('The target user does not exist.'),
        ...SIGNED_IN_ERRORS,
      },
    },
  },
  '/api/terminal-sessions/{terminalSessionId}': {
    get: {
      tags: [SESSIONS],
      summary: 'A session with its timelines and annotations',
      parameters: [SESSION_ID],
      responses: { '200': jsonResponse('The session.', { type: 'object', properties: { session: ref('SessionDetail') } }), ...ACCESS_ERRORS },
    },
    delete: {
      tags: [SESSIONS],
      summary: 'Delete a session',
      parameters: [pathParameter('terminalSessionId', 'The session id.')],
      responses: {
        '200': errorResponse('Deleted.'),
        '400': errorResponse('Not a valid id.'),
        '403': errorResponse('Only the owner can delete a session.'),
        '404': errorResponse('Session not found.'),
        ...SIGNED_IN_ERRORS,
      },
    },
  },
  '/api/terminal-session-jobs': {
    get: {
      tags: [JOBS],
      summary: "The signed-in user's unfinished, failed or not yet saved analysis jobs",
      responses: {
        '200': jsonResponse('enabled is false when job processing is off.', {
          type: 'object', properties: { enabled: { type: 'boolean' }, jobs: { type: 'array', items: ref('Job') } },
        }),
        '502': errorResponse('The analysis service could not be reached.'),
        ...SIGNED_IN_ERRORS,
      },
    },
  },
  '/api/terminal-session-jobs/{jobId}': {
    get: {
      tags: [JOBS],
      summary: 'Progress of one job',
      description: 'When the job has completed, the result is saved as a new timeline of its session and the session id is returned.',
      parameters: [pathParameter('jobId', 'The job id.')],
      responses: {
        '200': jsonResponse('Current state.', {
          type: 'object', properties: { job: ref('Job'), terminalSessionId: { type: 'string', format: 'uuid', nullable: true } },
        }),
        '404': errorResponse('Job not found.'),
        '409': JOB_DISABLED,
        '502': errorResponse('The analysis service could not be reached.'),
        ...SIGNED_IN_ERRORS,
      },
    },
    delete: {
      tags: [JOBS],
      summary: 'Remove a finished job',
      parameters: [pathParameter('jobId', 'The job id.')],
      responses: {
        '200': jsonResponse('Removed.', { type: 'object', properties: { deleted: { type: 'boolean' } } }),
        '404': errorResponse('Job not found.'),
        '409': errorResponse('The job is still active, or analysis jobs are disabled.'),
        '502': errorResponse('The analysis service could not be reached.'),
        ...SIGNED_IN_ERRORS,
      },
    },
  },
  '/api/terminal-session-jobs/{jobId}/control': {
    post: {
      tags: [JOBS],
      summary: 'Pause, resume or cancel a job',
      parameters: [pathParameter('jobId', 'The job id.')],
      requestBody: jsonBody(ref('JobControl')),
      responses: {
        '200': jsonResponse('New state.', { type: 'object', properties: { job: ref('Job') } }),
        '400': errorResponse('Unknown action.'),
        '404': errorResponse('Job not found.'),
        '409': errorResponse('The action is not possible in the job state, or analysis jobs are disabled.'),
        '502': errorResponse('The analysis service could not be reached.'),
        ...SIGNED_IN_ERRORS,
      },
    },
  },
  '/api/analysis-options': {
    get: {
      tags: [JOBS],
      summary: 'Models and settings the signed-in user can choose for an analysis',
      responses: { '200': jsonResponse('Choices.', ref('AnalysisChoices')), ...SIGNED_IN_ERRORS },
    },
  },
  '/api/terminal-sessions/{terminalSessionId}/analysis': {
    post: {
      tags: [JOBS],
      summary: 'Run a model on a stored recording',
      description: 'The result is added as a new timeline; existing annotations are never replaced. Needs the right to annotate.',
      parameters: [SESSION_ID],
      requestBody: jsonBody({ type: 'object', properties: { options: ref('AnalysisOptions') } }),
      responses: {
        '201': jsonResponse('Finished (synchronous mode).', { type: 'object', properties: { completed: { type: 'boolean' } } }),
        '202': jsonResponse('Queued (job mode).', { type: 'object', properties: { job: ref('Job') } }),
        '400': errorResponse('Invalid options.'),
        '502': errorResponse('The analysis service failed or could not be reached.'),
        ...ACCESS_ERRORS,
      },
    },
  },
  '/api/terminal-sessions/{terminalSessionId}/recording': {
    get: {
      tags: [SESSIONS],
      summary: 'Download the recording as a .cast file',
      description: 'The original upload, byte for byte (rebuilt without colours for old sessions). With ?annotations=1 the current annotations are written into the header.',
      parameters: [SESSION_ID, { name: 'annotations', in: 'query', required: false, schema: { type: 'string', enum: ['1'] } }],
      responses: { '200': { description: 'The file.', content: { 'application/x-asciicast': { schema: { type: 'string' } } } }, ...ACCESS_ERRORS },
    },
  },
  '/api/terminal-sessions/{terminalSessionId}/history': {
    get: {
      tags: [ANNOTATIONS],
      summary: 'Who changed what, newest first',
      parameters: [SESSION_ID],
      responses: { '200': jsonResponse('Up to 500 entries.', { type: 'object', properties: { revisions: { type: 'array', items: ref('AnnotationRevision') } } }), ...ACCESS_ERRORS },
    },
  },
  '/api/terminal-sessions/{terminalSessionId}/annotations': {
    post: {
      tags: [ANNOTATIONS],
      summary: 'Add an annotation, recorded as written by the signed-in user',
      parameters: [SESSION_ID],
      requestBody: jsonBody(ref('AnnotationInput')),
      responses: { '201': jsonResponse('Created.', { type: 'object', properties: { annotation: ref('Annotation') } }), '400': errorResponse('Invalid fields.'), ...ACCESS_ERRORS },
    },
  },
  '/api/terminal-sessions/{terminalSessionId}/annotations/{annotationId}': {
    patch: {
      tags: [ANNOTATIONS],
      summary: 'Change an annotation',
      description: 'expectedVersion must be the version you read; the editor is recorded.',
      parameters: [SESSION_ID, pathParameter('annotationId', 'The annotation id.')],
      requestBody: jsonBody(ref('AnnotationChanges')),
      responses: { '200': jsonResponse('Changed.', { type: 'object', properties: { annotation: ref('Annotation') } }), '400': errorResponse('Invalid fields.'), '409': errorResponse('Someone else changed it first.'), ...ACCESS_ERRORS },
    },
    delete: {
      tags: [ANNOTATIONS],
      summary: 'Delete an annotation',
      parameters: [SESSION_ID, pathParameter('annotationId', 'The annotation id.')],
      responses: { '200': jsonResponse('Deleted.', { type: 'object', properties: { deleted: { type: 'boolean' } } }), ...ACCESS_ERRORS },
    },
  },
  '/api/terminal-sessions/{terminalSessionId}/layers': {
    post: {
      tags: [ANNOTATIONS],
      summary: 'Add a timeline',
      parameters: [SESSION_ID],
      requestBody: jsonBody({ type: 'object', required: ['title'], properties: { title: STRING } }),
      responses: { '201': jsonResponse('Created.', { type: 'object', properties: { layer: ref('AnnotationLayer') } }), '400': errorResponse('Invalid title.'), ...ACCESS_ERRORS },
    },
  },
  '/api/terminal-sessions/{terminalSessionId}/layers/{layerId}': {
    patch: {
      tags: [ANNOTATIONS],
      summary: 'Rename or move a timeline',
      parameters: [SESSION_ID, pathParameter('layerId', 'The timeline id.')],
      requestBody: jsonBody({ type: 'object', properties: { title: STRING, position: { type: 'integer', minimum: 0 } } }),
      responses: { '200': jsonResponse('All timelines in order.', { type: 'object', properties: { layers: { type: 'array', items: ref('AnnotationLayer') } } }), '400': errorResponse('Invalid fields.'), ...ACCESS_ERRORS },
    },
    delete: {
      tags: [ANNOTATIONS],
      summary: 'Delete a timeline and its annotations',
      parameters: [SESSION_ID, pathParameter('layerId', 'The timeline id.')],
      responses: { '200': jsonResponse('Deleted.', { type: 'object', properties: { deleted: { type: 'boolean' } } }), ...ACCESS_ERRORS },
    },
  },
};
