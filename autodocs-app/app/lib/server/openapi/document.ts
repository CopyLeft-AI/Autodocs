// Ours
import { ADMIN_PATHS } from './paths-admin';
import { LDAP_PATHS } from './paths-ldap';
import { AUTH_PATHS } from './paths-auth';
import { SESSION_PATHS } from './paths-sessions';
import { SETTINGS_PATHS } from './paths-settings';
import { SCHEMAS } from './schemas';
import { SSO_PATHS } from './paths-sso';
import type { OpenApiDocument, OpenApiPaths } from './types';

/** The description of this document itself, so it is visible in the list. */
const SPEC_PATHS: OpenApiPaths = {
  '/api/openapi.json': {
    get: {
      tags: ['Documentation'],
      summary: 'This OpenAPI description',
      responses: { '200': { description: 'The OpenAPI 3 document.', content: { 'application/json': { schema: { type: 'object' } } } } },
    },
  },
};

/**
 * OpenAPI description of the Next.js app's HTTP API.
 *
 * It is written by hand, one module per area. tests/openapi.test.ts fails when a
 * route file and this description disagree, so the two cannot drift silently.
 */
export const OPENAPI_DOCUMENT: OpenApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'AutoDocs app API',
    version: '1.0.0',
    description:
      'HTTP API of the AutoDocs web app. Sign in with POST /api/auth/login in this same browser first: the session is a cookie, and "Try it out" sends it automatically. ' +
      'Errors are JSON of the form {"message": "..."}. The analysis service has its own documentation at /ml-service/docs (administrators only).',
  },
  servers: [{ url: '/' }],
  tags: [
    { name: 'Account', description: 'Sign-up, sign-in and the signed-in user.' },
    { name: 'Single sign-on', description: 'Sign-in through identity providers.' },
    { name: 'Settings', description: 'Inference and processing settings.' },
    { name: 'Users and groups (administrators)', description: 'Rights management. Requires the administrator right.' },
    { name: 'Terminal sessions', description: 'Stored analyses and sharing.' },
    { name: 'Analysis jobs', description: 'Background analysis of an uploaded recording.' },
    { name: 'Annotations', description: 'Timelines and annotations of a recording, with their history.' },
    { name: 'Documentation', description: 'This description.' },
  ],
  paths: { ...AUTH_PATHS, ...SSO_PATHS, ...SETTINGS_PATHS, ...ADMIN_PATHS, ...LDAP_PATHS, ...SESSION_PATHS, ...SPEC_PATHS },
  components: {
    schemas: SCHEMAS,
  },
};
