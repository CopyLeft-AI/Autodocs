import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/app/lib/server/db';
import { authorize, resolvePermissions, rowToStoredRights, RIGHTS_COLUMNS, type RightsRow } from '@/app/lib/server/permissions';

interface UserRow extends RightsRow {
  id: string;
  name: string;
  created_at: string;
  group_ids: string[];
}

/** List every user with their own rights, group memberships and effective rights (administrators only). */
export async function GET(request: NextRequest) {
  const auth = await authorize(request, 'admin');
  if (auth instanceof NextResponse) return auth;
  try {
    const result = await db.query<UserRow>(
      `SELECT u.id, u.name, u.created_at, ${RIGHTS_COLUMNS},
              COALESCE((SELECT json_agg(m.group_id) FROM user_group_members m WHERE m.user_id = u.id), '[]'::json) AS group_ids
       FROM users u ORDER BY u.created_at, u.email`,
    );
    const users = result.rows.map((row) => {
      const permissions = resolvePermissions(rowToStoredRights(row));
      return {
        id: row.id, email: row.email, name: row.name, createdAt: row.created_at,
        role: row.role, canEditSettings: row.can_edit_settings,
        rightsMode: row.rights_mode, groupIds: row.group_ids,
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
