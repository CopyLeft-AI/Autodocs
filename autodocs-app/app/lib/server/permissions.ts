import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/app/lib/server/db';
import { getRequestUser } from '@/app/lib/server/request-auth';
import type { SessionUser } from '@/app/lib/server/session-auth';

/** Accounts that are always administrators, whatever the database says. */
export const HARDCODED_ADMIN_EMAILS: readonly string[] = ['wolf.arthur@gmail.com', 'julia.longtin@gmail.com'];

export type UserRole = 'user' | 'admin';

export interface Permissions {
  isAdmin: boolean;
  /** True for admins, and for users an admin allowed to edit settings. */
  canEditSettings: boolean;
  /** The account is an administrator through the hardcoded list and cannot be demoted. */
  isHardcodedAdmin: boolean;
}

export type RightsMode = 'own' | 'groups';

export interface GroupRights {
  isAdmin: boolean;
  canEditSettings: boolean;
}

export interface StoredRights {
  email: string;
  role: UserRole;
  canEditSettings: boolean;
  rightsMode: RightsMode;
  /** Rights of each group the user belongs to. */
  groups: GroupRights[];
}

/** Whether this email is on the hardcoded administrator list (case-insensitive). */
export function isHardcodedAdminEmail(email: string): boolean {
  return HARDCODED_ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

/**
 * Combine stored rights with the hardcoded administrator list.
 * In 'own' mode the user's own columns count; in 'groups' mode the user gets
 * every right that at least one of their groups has.
 */
export function resolvePermissions(rights: StoredRights): Permissions {
  const isHardcodedAdmin = isHardcodedAdminEmail(rights.email);
  const own = rights.rightsMode === 'own';
  const isAdmin = isHardcodedAdmin || (own ? rights.role === 'admin' : rights.groups.some((group) => group.isAdmin));
  const canEdit = own ? rights.canEditSettings : rights.groups.some((group) => group.canEditSettings);
  return { isAdmin, canEditSettings: isAdmin || canEdit, isHardcodedAdmin };
}

/** Select list that loads what resolvePermissions needs, one row per user. */
export const RIGHTS_COLUMNS = `u.email, u.role, u.can_edit_settings, u.rights_mode,
  COALESCE((SELECT json_agg(json_build_object('isAdmin', g.is_admin, 'canEditSettings', g.can_edit_settings))
            FROM user_group_members m JOIN user_groups g ON g.id = m.group_id WHERE m.user_id = u.id), '[]'::json) AS groups`;

export interface RightsRow {
  email: string;
  role: UserRole;
  can_edit_settings: boolean;
  rights_mode: RightsMode;
  groups: GroupRights[];
}

/** Convert a row selected with RIGHTS_COLUMNS to the input of resolvePermissions. */
export function rowToStoredRights(row: RightsRow): StoredRights {
  return { email: row.email, role: row.role, canEditSettings: row.can_edit_settings, rightsMode: row.rights_mode, groups: row.groups };
}

/** Load the current permissions of a user from the database. */
export async function getPermissions(userId: string): Promise<Permissions | null> {
  const result = await db.query<RightsRow>(`SELECT ${RIGHTS_COLUMNS} FROM users u WHERE u.id = $1`, [userId]);
  const row = result.rows[0];
  return row ? resolvePermissions(rowToStoredRights(row)) : null;
}

/** Validate a group name; returns the trimmed name or an error message. */
export function checkGroupName(value: unknown): { name: string } | { error: string } {
  if (typeof value !== 'string' || value.trim() === '') return { error: 'The group needs a name.' };
  if (value.trim().length > 50) return { error: 'The group name can have at most 50 characters.' };
  return { name: value.trim() };
}

export interface AuthorizedUser {
  user: SessionUser;
  permissions: Permissions;
}

/** Authenticate the request and require a right; returns the user or the error response to send. */
export async function authorize(
  request: NextRequest,
  right: 'signedIn' | 'editSettings' | 'admin',
): Promise<AuthorizedUser | NextResponse> {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  const permissions = await getPermissions(user.id);
  if (!permissions) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  if (right === 'admin' && !permissions.isAdmin) {
    return NextResponse.json({ message: 'Only administrators can do this.' }, { status: 403 });
  }
  if (right === 'editSettings' && !permissions.canEditSettings) {
    return NextResponse.json({ message: 'You do not have the right to edit settings.' }, { status: 403 });
  }
  return { user, permissions };
}
