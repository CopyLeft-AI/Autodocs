// Ours
import { ref, STRING, BOOLEAN, UUID_STRING } from './builders';
import type { JsonSchema } from './types';

const DATE_TIME: JsonSchema = { type: 'string', format: 'date-time' };

/** Reusable request and response bodies, shared by the path descriptions. */
export const SCHEMAS: Record<string, JsonSchema> = {
  Message: {
    type: 'object',
    required: ['message'],
    properties: { message: { ...STRING, description: 'A sentence that can be shown to the user.' } },
  },
  User: {
    type: 'object',
    properties: { id: UUID_STRING, email: { type: 'string', format: 'email' }, name: STRING, createdAt: DATE_TIME },
  },
  UserResponse: { type: 'object', properties: { user: ref('User') } },
  Permissions: {
    type: 'object',
    properties: {
      isAdmin: BOOLEAN,
      canEditSettings: { ...BOOLEAN, description: 'True for administrators and for users an administrator allowed to edit settings.' },
      isHardcodedAdmin: { ...BOOLEAN, description: 'Built-in administrator account that cannot be demoted.' },
    },
  },
  AdminUser: {
    type: 'object',
    properties: {
      id: UUID_STRING, email: STRING, name: STRING, createdAt: DATE_TIME,
      role: { type: 'string', enum: ['user', 'admin'] },
      canEditSettings: { ...BOOLEAN, description: "The user's own right (used when rightsMode is 'own')." },
      rightsMode: { type: 'string', enum: ['own', 'groups'], description: "'own' uses the user's own rights, 'groups' the union of the rights of their groups." },
      groupIds: { type: 'array', items: UUID_STRING },
      isAdmin: { ...BOOLEAN, description: 'Effective administrator right.' },
      isHardcodedAdmin: BOOLEAN,
      effectiveCanEditSettings: BOOLEAN,
    },
  },
  UserRightsChange: {
    type: 'object',
    description: 'Send at least one field.',
    properties: {
      role: { type: 'string', enum: ['user', 'admin'] },
      canEditSettings: BOOLEAN,
      rightsMode: { type: 'string', enum: ['own', 'groups'] },
      groupIds: { type: 'array', items: UUID_STRING, description: 'Replaces the whole list of groups of the user.' },
    },
  },
  Group: {
    type: 'object',
    properties: { id: UUID_STRING, name: STRING, isAdmin: BOOLEAN, canEditSettings: BOOLEAN, memberIds: { type: 'array', items: UUID_STRING } },
  },
  GroupCreate: {
    type: 'object',
    required: ['name'],
    properties: { name: { ...STRING, maxLength: 50 }, isAdmin: BOOLEAN, canEditSettings: BOOLEAN },
  },
  GroupChange: {
    type: 'object',
    description: 'Send at least one field.',
    properties: {
      name: { ...STRING, maxLength: 50 }, isAdmin: BOOLEAN, canEditSettings: BOOLEAN,
      memberIds: { type: 'array', items: UUID_STRING, description: 'Replaces the whole list of members.' },
    },
  },
  TerminalSession: {
    type: 'object',
    properties: { id: UUID_STRING, title: STRING, durationSeconds: { type: 'number' }, content: { ...STRING, description: 'The analysed recording as stored by the app.' }, createdAt: DATE_TIME },
  },
  SharedTerminalSession: {
    allOf: [
      ref('TerminalSession'),
      { type: 'object', properties: { sharedAt: DATE_TIME, ownerId: UUID_STRING, ownerName: STRING, ownerEmail: STRING } },
    ],
  },
  TerminalSessionCreate: {
    type: 'object',
    required: ['title', 'content'],
    properties: { title: STRING, durationSeconds: { type: 'number', minimum: 0 }, content: { ...STRING, description: 'An asciinema recording.' } },
  },
  ShareRequest: {
    type: 'object',
    required: ['terminalSessionId'],
    description: 'Identify the person to share with by targetUserId or by targetUserEmail.',
    properties: { terminalSessionId: UUID_STRING, targetUserId: UUID_STRING, targetUserEmail: { type: 'string', format: 'email' } },
  },
  JobCreate: {
    type: 'object',
    required: ['title', 'content', 'durationSeconds'],
    properties: { title: STRING, content: { ...STRING, description: 'An asciinema recording.' }, durationSeconds: { type: 'integer', minimum: 0 } },
  },
  JobStage: {
    type: 'object',
    properties: {
      id: STRING, label: STRING, status: { type: 'string', enum: ['pending', 'running', 'completed'] },
      current: { type: 'number' }, total: { type: 'number' }, estimated: BOOLEAN, detail: STRING,
    },
  },
  Job: {
    type: 'object',
    description: 'An analysis job as reported by the ML service.',
    properties: {
      id: UUID_STRING, title: STRING,
      status: { type: 'string', enum: ['queued', 'running', 'paused', 'completed', 'failed', 'cancelled'] },
      percent: { type: 'number' }, createdAt: DATE_TIME, updatedAt: DATE_TIME,
      startedAt: { ...DATE_TIME, nullable: true },
      parallelRequests: { type: 'integer' },
      etaSeconds: { type: 'number', nullable: true },
      resources: { type: 'object', nullable: true, description: 'CPU and GPU usage; null for remote inference.' },
      stages: { type: 'array', items: ref('JobStage') },
      timeline: { type: 'array', items: { type: 'object', properties: { at: DATE_TIME, kind: STRING, message: STRING } } },
      error: { ...STRING, nullable: true },
    },
  },
  JobControl: {
    type: 'object',
    required: ['action'],
    properties: { action: { type: 'string', enum: ['pause', 'resume', 'cancel'] } },
  },
  InferenceSettings: {
    type: 'object',
    description:
      'The ML service configuration as returned by its GET /config: per-step stored and effective values, processing options and the allowed values (schema). API keys are never returned.',
    additionalProperties: true,
  },
  InferenceSettingsChange: {
    type: 'object',
    description:
      'Partial settings merged into the config file, for example {"steps": {"annotate": {"model": "llama3"}}}. A null value removes a stored setting. Same shape as the ML service PUT /config.',
    additionalProperties: true,
  },
  ProcessingSettings: {
    type: 'object',
    properties: {
      remoteApiConcurrency: { type: 'integer', nullable: true, description: "The user's own limit of parallel requests to a remote API; null means the default." },
      limits: { type: 'object', properties: { min: { type: 'integer' }, max: { type: 'integer' } } },
      message: STRING,
    },
  },
};
