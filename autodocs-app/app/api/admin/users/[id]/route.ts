import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/app/lib/server/db';
import { authorize, isHardcodedAdminEmail } from '@/app/lib/server/permissions';

interface RightsBody { role?: unknown; canEditSettings?: unknown; rightsMode?: unknown; groupIds?: unknown; }

const UUID = /^[0-9a-f-]{36}$/i;

/** Change a user's own rights, rights mode and/or group memberships (administrators only). */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await authorize(request, 'admin');
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ message: 'Unknown user.' }, { status: 404 });

  let body: RightsBody;
  try {
    body = (await request.json()) as RightsBody;
  } catch {
    return NextResponse.json({ message: 'The request body must be JSON.' }, { status: 400 });
  }
  if (body.role === undefined && body.canEditSettings === undefined && body.rightsMode === undefined && body.groupIds === undefined) {
    return NextResponse.json({ message: 'Nothing to change: send role, canEditSettings, rightsMode and/or groupIds.' }, { status: 400 });
  }
  if (body.role !== undefined && body.role !== 'user' && body.role !== 'admin') {
    return NextResponse.json({ message: 'role must be "user" or "admin".' }, { status: 400 });
  }
  if (body.canEditSettings !== undefined && typeof body.canEditSettings !== 'boolean') {
    return NextResponse.json({ message: 'canEditSettings must be true or false.' }, { status: 400 });
  }
  if (body.rightsMode !== undefined && body.rightsMode !== 'own' && body.rightsMode !== 'groups') {
    return NextResponse.json({ message: 'rightsMode must be "own" or "groups".' }, { status: 400 });
  }
  let groupIds: string[] | null = null;
  if (body.groupIds !== undefined) {
    if (!Array.isArray(body.groupIds) || !body.groupIds.every((value) => typeof value === 'string' && UUID.test(value))) {
      return NextResponse.json({ message: 'groupIds must be a list of group ids.' }, { status: 400 });
    }
    groupIds = [...new Set(body.groupIds as string[])];
  }

  const client = await db.connect();
  try {
    const target = await client.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [id]);
    if (!target.rows[0]) return NextResponse.json({ message: 'Unknown user.' }, { status: 404 });
    if (isHardcodedAdminEmail(target.rows[0].email)) {
      return NextResponse.json({ message: 'This account is a built-in administrator and cannot be changed.' }, { status: 409 });
    }
    if (groupIds) {
      const known = await client.query('SELECT 1 FROM user_groups WHERE id = ANY($1::uuid[])', [groupIds]);
      if (known.rowCount !== groupIds.length) return NextResponse.json({ message: 'Unknown group.' }, { status: 400 });
    }
    await client.query('BEGIN');
    await client.query(
      `UPDATE users SET role = COALESCE($2, role), can_edit_settings = COALESCE($3, can_edit_settings),
              rights_mode = COALESCE($4, rights_mode) WHERE id = $1`,
      [id, body.role ?? null, body.canEditSettings ?? null, body.rightsMode ?? null],
    );
    if (groupIds) {
      await client.query('DELETE FROM user_group_members WHERE user_id = $1', [id]);
      await client.query('INSERT INTO user_group_members (group_id, user_id) SELECT g, $1 FROM unnest($2::uuid[]) AS g', [id, groupIds]);
    }
    await client.query('COMMIT');
    return NextResponse.json({ message: 'Saved.' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('Could not update user rights:', error);
    return NextResponse.json({ message: 'Could not update the user.' }, { status: 500 });
  } finally {
    client.release();
  }
}
