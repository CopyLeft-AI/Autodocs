// Ours
import { errorResponse, jsonBody, jsonResponse, pathParameter, ref, RIGHTS_ERRORS } from './builders';
import type { OpenApiPaths } from './types';

const USERS = 'Users and groups (administrators)';

/** User rights and groups; every operation requires the administrator right. */
export const ADMIN_PATHS: OpenApiPaths = {
  '/api/admin/users': {
    get: {
      tags: [USERS],
      summary: 'List all users with their rights',
      responses: {
        '200': jsonResponse('All users.', { type: 'object', properties: { users: { type: 'array', items: ref('AdminUser') } } }),
        ...RIGHTS_ERRORS,
      },
    },
  },
  '/api/admin/users/{id}': {
    patch: {
      tags: [USERS],
      summary: "Change a user's role, rights mode, settings right or groups",
      parameters: [pathParameter('id', 'The user id.')],
      requestBody: jsonBody(ref('UserRightsChange')),
      responses: {
        '200': errorResponse('Saved.'),
        '400': errorResponse('Invalid value, unknown group, or nothing to change.'),
        '404': errorResponse('Unknown user.'),
        '409': errorResponse('The account is a built-in administrator and cannot be changed.'),
        ...RIGHTS_ERRORS,
      },
    },
  },
  '/api/admin/groups': {
    get: {
      tags: [USERS],
      summary: 'List groups with their rights and members',
      responses: {
        '200': jsonResponse('All groups.', { type: 'object', properties: { groups: { type: 'array', items: ref('Group') } } }),
        ...RIGHTS_ERRORS,
      },
    },
    post: {
      tags: [USERS],
      summary: 'Create a group',
      requestBody: jsonBody(ref('GroupCreate')),
      responses: {
        '201': jsonResponse('Group created.', { type: 'object', properties: { group: ref('Group') } }),
        '400': errorResponse('Invalid name or flag.'),
        '409': errorResponse('A group with this name already exists (case-insensitive).'),
        ...RIGHTS_ERRORS,
      },
    },
  },
  '/api/admin/groups/{id}': {
    patch: {
      tags: [USERS],
      summary: "Change a group's name, rights or members",
      parameters: [pathParameter('id', 'The group id.')],
      requestBody: jsonBody(ref('GroupChange')),
      responses: {
        '200': errorResponse('Saved.'),
        '400': errorResponse('Invalid value, unknown user, or nothing to change.'),
        '404': errorResponse('Unknown group.'),
        '409': errorResponse('A group with this name already exists.'),
        ...RIGHTS_ERRORS,
      },
    },
    delete: {
      tags: [USERS],
      summary: 'Delete a group (its members keep their accounts)',
      parameters: [pathParameter('id', 'The group id.')],
      responses: { '200': errorResponse('Deleted.'), '404': errorResponse('Unknown group.'), ...RIGHTS_ERRORS },
    },
  },
};
