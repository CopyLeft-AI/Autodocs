import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/app/lib/server/db';
import { authorize, resolvePermissions, type UserRole } from '@/app/lib/server/permissions';

/** List every user with their rights (administrators only). */
export async function GET(request: NextRequest) {
  const auth = await authorize(request, 'admin');
  if (auth instanceof NextResponse) return auth;
  try {
    const result = await db.query<{ id: string; email: string; name: string; created_at: string; role: UserRole; can_edit_settings: boolean }>(
      'SELECT id, email, name, created_at, role, can_edit_settings FROM users ORDER BY created_at, email',
    );
    const users = result.rows.map((row) => {
      const permissions = resolvePermissions({ email: row.email, role: row.role, canEditSettings: row.can_edit_settings });
      return {
        id: row.id, email: row.email, name: row.name, createdAt: row.created_at,
        role: row.role, canEditSettings: row.can_edit_settings,
        isAdmin: permissions.isAdmin, isHardcodedAdmin: permissions.isHardcodedAdmin,
        effectiveCanEditSettings: permissions.canEditSettings,
      };
    });
    return NextResponse.json({ users });
  } catch (error) {
    console.error('Could not list users:', error);
    return NextResponse.json({ message: 'Could not list users.' }, { status: 500 });
  }
}
