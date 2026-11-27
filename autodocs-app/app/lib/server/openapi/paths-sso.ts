// Ours
import { errorResponse, jsonResponse, RIGHTS_ERRORS } from './builders';
import type { OpenApiPaths } from './types';

const SIGN_IN = 'Single sign-on';
const PROVIDER = { name: 'provider', in: 'path', required: true, description: 'The provider id, for example "google".', schema: { type: 'string' } };
const OBJECT = { type: 'object' };
const REDIRECT = { '307': { description: 'Redirect to the next page; failures go to /login?sso_error=code.' } };

/** Single sign-on: the browser redirects and the administrator settings. */
export const SSO_PATHS: OpenApiPaths = {
  '/api/auth/sso/providers': {
    get: { tags: [SIGN_IN], summary: 'Providers offered on the login page', responses: { '200': jsonResponse('Ids and button labels.', OBJECT) } },
  },
  '/api/auth/sso/{provider}/start': {
    get: { tags: [SIGN_IN], summary: "Send the browser to the provider's login page", parameters: [PROVIDER], responses: REDIRECT },
  },
  '/api/auth/sso/{provider}/callback': {
    get: { tags: [SIGN_IN], summary: 'Finish the sign-in after the provider redirects back', parameters: [PROVIDER], responses: REDIRECT },
  },
  '/api/admin/sso/providers': {
    get: { tags: [SIGN_IN], summary: 'Every provider and its saved configuration, without secrets', responses: { '200': jsonResponse('Overview.', OBJECT), ...RIGHTS_ERRORS } },
  },
  '/api/admin/sso/providers/{provider}': {
    put: { tags: [SIGN_IN], summary: "Save a provider's configuration", parameters: [PROVIDER], responses: { '200': jsonResponse('Saved.', OBJECT), '400': errorResponse('Invalid settings.'), '404': errorResponse('Unknown provider.'), ...RIGHTS_ERRORS } },
    delete: { tags: [SIGN_IN], summary: "Forget a provider's configuration", parameters: [PROVIDER], responses: { '200': jsonResponse('Removed.', OBJECT), '404': errorResponse('Unknown provider.'), ...RIGHTS_ERRORS } },
  },
  '/api/admin/sso/providers/{provider}/test': {
    post: { tags: [SIGN_IN], summary: 'Check a saved configuration', parameters: [PROVIDER], responses: { '200': jsonResponse('Test result.', OBJECT), '404': errorResponse('Unknown provider.'), ...RIGHTS_ERRORS } },
  },
};
