// Ours
import { errorResponse, jsonResponse, RIGHTS_ERRORS } from './builders';
import type { OpenApiPaths } from './types';

const TAG = 'Users and groups (administrators)';
const OBJECT = { type: 'object' };
const body = (properties: Record<string, unknown>) => ({ required: true, content: { 'application/json': { schema: { type: 'object', properties } } } });
const UNREACHABLE = { '502': errorResponse('The directory did not answer or refused the request.') };

/** Group information from an LDAP directory. */
export const LDAP_PATHS: OpenApiPaths = {
  '/api/admin/ldap': {
    get: { tags: [TAG], summary: 'Directory settings, without the bind password', responses: { '200': jsonResponse('Settings.', OBJECT), ...RIGHTS_ERRORS } },
    put: {
      tags: [TAG], summary: 'Save the directory settings',
      requestBody: body({ enabled: { type: 'boolean' }, settings: OBJECT, bindPassword: { type: 'string', description: 'Omit to keep the saved one; empty removes it.' } }),
      responses: { '200': jsonResponse('Saved.', OBJECT), '400': errorResponse('Invalid settings.'), ...RIGHTS_ERRORS },
    },
  },
  '/api/admin/ldap/test': {
    post: { tags: [TAG], summary: 'Look an email up, changing nothing', requestBody: body({ email: { type: 'string' } }), responses: { '200': jsonResponse('Whether found, and the group names.', OBJECT), '400': errorResponse('Email missing.'), ...UNREACHABLE, ...RIGHTS_ERRORS } },
  },
  '/api/admin/ldap/sync': {
    post: { tags: [TAG], summary: "Refresh every user's directory groups", responses: { '200': jsonResponse('Counts and skipped group names.', OBJECT), '409': errorResponse('The directory is not enabled.'), ...UNREACHABLE, ...RIGHTS_ERRORS } },
  },
};
