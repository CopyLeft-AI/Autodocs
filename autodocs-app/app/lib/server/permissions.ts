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

export interface StoredRights {
  email: string;
  role: UserRole;
  canEditSettings: boolean;
}

/** Whether this email is on the hardcoded administrator list (case-insensitive). */
export function isHardcodedAdminEmail(email: string): boolean {
  return HARDCODED_ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

/** Combine the stored rights with the hardcoded administrator list. */
export function resolvePermissions(rights: StoredRights): Permissions {
  const isHardcodedAdmin = isHardcodedAdminEmail(rights.email);
  const isAdmin = isHardcodedAdmin || rights.role === 'admin';
  return { isAdmin, canEditSettings: isAdmin || rights.canEditSettings, isHardcodedAdmin };
}

/** Load the current permissions of a user from the database. */
export async function getPermissions(userId: string): Promise<Permissions | null> {
  const result = await db.query<{ email: string; role: UserRole; can_edit_settings: boolean }>(
    'SELECT email, role, can_edit_settings FROM users WHERE id = $1',
    [userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return resolvePermissions({ email: row.email, role: row.role, canEditSettings: row.can_edit_settings });
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
