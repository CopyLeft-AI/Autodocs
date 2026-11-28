// Ours
import { errorResponse, jsonBody, jsonResponse, ref, SIGNED_IN_ERRORS, STRING } from './builders';
import type { OpenApiPaths } from './types';

const TAG = 'Account';
const COOKIES_SET = { 'Set-Cookie': { description: 'Replaces the access_token and refresh_token cookies.', schema: STRING } };

/** Sign-up, sign-in and the signed-in user's own profile. */
export const AUTH_PATHS: OpenApiPaths = {
  '/api/auth/signup': {
    post: {
      tags: [TAG],
      summary: 'Create an account and sign in',
      requestBody: jsonBody({
        type: 'object', required: ['name', 'email', 'password'],
        properties: { name: STRING, email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 8 } },
      }),
      responses: {
        '200': { ...jsonResponse('Account created; the session cookies are set.', ref('UserResponse')), headers: COOKIES_SET },
        '400': errorResponse('A field is missing or the password is shorter than 8 characters.'),
        '409': errorResponse('An account with this email already exists.'),
      },
    },
  },
  '/api/auth/login': {
    post: {
      tags: [TAG],
      summary: 'Sign in',
      requestBody: jsonBody({
        type: 'object', required: ['email', 'password'],
        properties: { email: { type: 'string', format: 'email' }, password: STRING },
      }),
      responses: {
        '200': { ...jsonResponse('Signed in; the session cookies are set.', ref('UserResponse')), headers: COOKIES_SET },
        '400': errorResponse('Email or password missing.'),
        '401': errorResponse('Invalid email or password.'),
      },
    },
  },
  '/api/auth/logout': {
    post: {
      tags: [TAG],
      summary: 'Sign out and clear the session cookies',
      responses: { '200': jsonResponse('Signed out.', { type: 'object', properties: { ok: { type: 'boolean' } } }) },
    },
  },
  '/api/auth/me': {
    get: {
      tags: [TAG],
      summary: 'The signed-in user',
      description: 'Also renews an expired access token from the refresh token, so clients call it to keep a session alive.',
      responses: { '200': jsonResponse('The current user.', ref('UserResponse')), ...SIGNED_IN_ERRORS },
    },
  },
  '/api/auth/permissions': {
    get: {
      tags: [TAG],
      summary: "The signed-in user's rights",
      responses: { '200': jsonResponse('Effective rights.', ref('Permissions')), ...SIGNED_IN_ERRORS },
    },
  },
  '/api/auth/name': {
    patch: {
      tags: [TAG],
      summary: 'Change the display name',
      requestBody: jsonBody({ type: 'object', required: ['name'], properties: { name: STRING } }),
      responses: {
        '200': jsonResponse('Name updated.', { type: 'object', properties: { message: STRING, user: ref('User') } }),
        '400': errorResponse('Missing name, or the same as the current one.'),
        ...SIGNED_IN_ERRORS,
      },
    },
  },
  '/api/auth/email': {
    patch: {
      tags: [TAG],
      summary: 'Change the email address',
      requestBody: jsonBody({
        type: 'object', required: ['email', 'currentPassword'],
        properties: { email: { type: 'string', format: 'email' }, currentPassword: STRING },
      }),
      responses: {
        '200': jsonResponse('Email updated.', { type: 'object', properties: { message: STRING, user: ref('User') } }),
        '400': errorResponse('Invalid address, or the same as the current one.'),
        '401': errorResponse('Not signed in, or the current password is wrong.'),
        '403': errorResponse('The account takes rights from the directory, which matches by email.'),
        '409': errorResponse('Another account already uses this email.'),
      },
    },
  },
  '/api/auth/password': {
    patch: {
      tags: [TAG],
      summary: 'Change the password',
      requestBody: jsonBody({
        type: 'object', required: ['currentPassword', 'newPassword'],
        properties: { currentPassword: STRING, newPassword: { type: 'string', minLength: 8 } },
      }),
      responses: {
        '200': errorResponse('Password updated.'),
        '400': errorResponse('New password too short or equal to the current one.'),
        '401': errorResponse('Not signed in, or the current password is wrong.'),
      },
    },
  },
};
