import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/app/lib/server/db';
import { authorize, checkGroupName } from '@/app/lib/server/permissions';

interface GroupRow {
  id: string;
  name: string;
  is_admin: boolean;
  can_edit_settings: boolean;
  member_ids: string[];
}

function toClient(row: GroupRow) {
  return { id: row.id, name: row.name, isAdmin: row.is_admin, canEditSettings: row.can_edit_settings, memberIds: row.member_ids };
}

/** List all groups with their rights and members (administrators only). */
export async function GET(request: NextRequest) {
  const auth = await authorize(request, 'admin');
  if (auth instanceof NextResponse) return auth;
  try {
    const result = await db.query<GroupRow>(
      `SELECT g.id, g.name, g.is_admin, g.can_edit_settings,
              COALESCE((SELECT json_agg(m.user_id) FROM user_group_members m WHERE m.group_id = g.id), '[]'::json) AS member_ids
       FROM user_groups g ORDER BY lower(g.name)`,
    );
    return NextResponse.json({ groups: result.rows.map(toClient) });
  } catch (error) {
    console.error('Could not list groups:', error);
    return NextResponse.json({ message: 'Could not list groups.' }, { status: 500 });
  }
}

/** Create a group (administrators only). */
export async function POST(request: NextRequest) {
  const auth = await authorize(request, 'admin');
  if (auth instanceof NextResponse) return auth;
  let body: { name?: unknown; isAdmin?: unknown; canEditSettings?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ message: 'The request body must be JSON.' }, { status: 400 });
  }
  const name = checkGroupName(body.name);
  if ('error' in name) return NextResponse.json({ message: name.error }, { status: 400 });
  for (const key of ['isAdmin', 'canEditSettings'] as const) {
    if (body[key] !== undefined && typeof body[key] !== 'boolean') {
      return NextResponse.json({ message: `${key} must be true or false.` }, { status: 400 });
    }
  }
  try {
    const result = await db.query<GroupRow>(
      `INSERT INTO user_groups (name, is_admin, can_edit_settings) VALUES ($1, $2, $3)
       RETURNING id, name, is_admin, can_edit_settings, '[]'::json AS member_ids`,
      [name.name, body.isAdmin ?? false, body.canEditSettings ?? false],
    );
    return NextResponse.json({ group: toClient(result.rows[0]) }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ message: 'A group with this name already exists.' }, { status: 409 });
    }
    console.error('Could not create group:', error);
    return NextResponse.json({ message: 'Could not create the group.' }, { status: 500 });
  }
}
