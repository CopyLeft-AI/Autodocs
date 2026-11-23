// Ours
import { errorResponse, jsonBody, jsonResponse, ref, RIGHTS_ERRORS, SIGNED_IN_ERRORS } from './builders';
import type { OpenApiPaths } from './types';

const TAG = 'Settings';

/** Settings: reading needs a signed-in user, writing needs the settings right. */
export const SETTINGS_PATHS: OpenApiPaths = {
  '/api/settings/inference': {
    get: {
      tags: [TAG],
      summary: 'Which model and inference source each analysis step uses',
      responses: {
        '200': jsonResponse('Stored and effective settings; API keys are never returned.', ref('InferenceSettings')),
        '502': errorResponse('The analysis service could not be reached.'),
        ...SIGNED_IN_ERRORS,
      },
    },
    put: {
      tags: [TAG],
      summary: 'Change inference settings (requires the settings right)',
      description: 'Applies to analyses started afterwards.',
      requestBody: jsonBody(ref('InferenceSettingsChange')),
      responses: {
        '200': jsonResponse('The settings after the change.', ref('InferenceSettings')),
        '400': errorResponse('The body is not JSON.'),
        '422': errorResponse('The analysis service rejected a value.'),
        '502': errorResponse('The analysis service could not be reached.'),
        ...RIGHTS_ERRORS,
      },
    },
  },
  '/api/settings/processing': {
    get: {
      tags: [TAG],
      summary: "The user's own limit of parallel requests to a remote API",
      responses: { '200': jsonResponse('Current value and limits.', ref('ProcessingSettings')), ...SIGNED_IN_ERRORS },
    },
    patch: {
      tags: [TAG],
      summary: 'Change the limit (requires the settings right)',
      requestBody: jsonBody({
        type: 'object',
        properties: { remoteApiConcurrency: { type: 'integer', nullable: true, description: 'null restores the default.' } },
      }),
      responses: {
        '200': jsonResponse('Saved.', ref('ProcessingSettings')),
        '400': errorResponse('Not a whole number within the limits.'),
        ...RIGHTS_ERRORS,
      },
    },
  },
};
