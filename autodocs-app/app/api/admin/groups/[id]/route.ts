import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/app/lib/server/db';
import { authorize, checkGroupName } from '@/app/lib/server/permissions';

const UUID = /^[0-9a-f-]{36}$/i;

/** Rename a group, change its rights, and/or replace its member list (administrators only). */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await authorize(request, 'admin');
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ message: 'Unknown group.' }, { status: 404 });
  let body: { name?: unknown; isAdmin?: unknown; canEditSettings?: unknown; memberIds?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ message: 'The request body must be JSON.' }, { status: 400 });
  }
  if (Object.values(body).every((value) => value === undefined)) {
    return NextResponse.json({ message: 'Nothing to change.' }, { status: 400 });
  }
  let name: string | null = null;
  if (body.name !== undefined) {
    const checked = checkGroupName(body.name);
    if ('error' in checked) return NextResponse.json({ message: checked.error }, { status: 400 });
    name = checked.name;
  }
  for (const key of ['isAdmin', 'canEditSettings'] as const) {
    if (body[key] !== undefined && typeof body[key] !== 'boolean') {
      return NextResponse.json({ message: `${key} must be true or false.` }, { status: 400 });
    }
  }
  let memberIds: string[] | null = null;
  if (body.memberIds !== undefined) {
    if (!Array.isArray(body.memberIds) || !body.memberIds.every((value) => typeof value === 'string' && UUID.test(value))) {
      return NextResponse.json({ message: 'memberIds must be a list of user ids.' }, { status: 400 });
    }
    memberIds = [...new Set(body.memberIds as string[])];
  }

  const client = await db.connect();
  try {
    const exists = await client.query('SELECT 1 FROM user_groups WHERE id = $1', [id]);
    if (!exists.rowCount) return NextResponse.json({ message: 'Unknown group.' }, { status: 404 });
    if (memberIds) {
      const known = await client.query('SELECT 1 FROM users WHERE id = ANY($1::uuid[])', [memberIds]);
      if (known.rowCount !== memberIds.length) return NextResponse.json({ message: 'Unknown user.' }, { status: 400 });
    }
    await client.query('BEGIN');
    await client.query(
      `UPDATE user_groups SET name = COALESCE($2, name), is_admin = COALESCE($3, is_admin),
              can_edit_settings = COALESCE($4, can_edit_settings) WHERE id = $1`,
      [id, name, body.isAdmin ?? null, body.canEditSettings ?? null],
    );
    if (memberIds) {
      await client.query('DELETE FROM user_group_members WHERE group_id = $1', [id]);
      await client.query('INSERT INTO user_group_members (group_id, user_id) SELECT $1, u FROM unnest($2::uuid[]) AS u', [id, memberIds]);
    }
    await client.query('COMMIT');
    return NextResponse.json({ message: 'Saved.' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ message: 'A group with this name already exists.' }, { status: 409 });
    }
    console.error('Could not update group:', error);
    return NextResponse.json({ message: 'Could not update the group.' }, { status: 500 });
  } finally {
    client.release();
  }
}

/** Delete a group; its members keep their own rights and lose the group's (administrators only). */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await authorize(request, 'admin');
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ message: 'Unknown group.' }, { status: 404 });
  try {
    const result = await db.query('DELETE FROM user_groups WHERE id = $1', [id]);
    if (!result.rowCount) return NextResponse.json({ message: 'Unknown group.' }, { status: 404 });
    return NextResponse.json({ message: 'Deleted.' });
  } catch (error) {
    console.error('Could not delete group:', error);
    return NextResponse.json({ message: 'Could not delete the group.' }, { status: 500 });
  }
}
