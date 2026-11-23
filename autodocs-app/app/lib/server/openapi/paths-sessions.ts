// Ours
import { errorResponse, jsonBody, jsonResponse, pathParameter, ref, SIGNED_IN_ERRORS } from './builders';
import type { OpenApiPaths } from './types';

const SESSIONS = 'Terminal sessions';
const JOBS = 'Analysis jobs';

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
      summary: 'Analyse a recording synchronously and store the result',
      description: 'Legacy path: the request stays open until the analysis finishes. Prefer the analysis jobs endpoints.',
      requestBody: jsonBody(ref('TerminalSessionCreate')),
      responses: {
        '201': jsonResponse('Stored.', { type: 'object', properties: { terminalSession: ref('TerminalSession') } }),
        '400': errorResponse('Missing title or content, or an invalid duration.'),
        '500': errorResponse('The recording could not be processed.'),
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
    post: {
      tags: [JOBS],
      summary: 'Queue a recording for analysis',
      requestBody: jsonBody(ref('JobCreate')),
      responses: {
        '202': jsonResponse('Queued.', { type: 'object', properties: { job: ref('Job') } }),
        '400': errorResponse('Missing title or content, or an invalid duration.'),
        '409': JOB_DISABLED,
        '502': errorResponse('The analysis service could not be reached.'),
        ...SIGNED_IN_ERRORS,
      },
    },
  },
  '/api/terminal-session-jobs/{jobId}': {
    get: {
      tags: [JOBS],
      summary: 'Progress of one job',
      description: 'When the job has completed, the result is saved as a terminal session and its id is returned.',
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
};
