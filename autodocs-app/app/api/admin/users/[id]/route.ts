import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/app/lib/server/db';
import { authorize, isHardcodedAdminEmail } from '@/app/lib/server/permissions';

interface RightsBody { role?: unknown; canEditSettings?: unknown; }

/** Change a user's role and/or settings right (administrators only). */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await authorize(request, 'admin');
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ message: 'Unknown user.' }, { status: 404 });

  let body: RightsBody;
  try {
    body = (await request.json()) as RightsBody;
  } catch {
    return NextResponse.json({ message: 'The request body must be JSON.' }, { status: 400 });
  }
  if (body.role === undefined && body.canEditSettings === undefined) {
    return NextResponse.json({ message: 'Nothing to change: send role and/or canEditSettings.' }, { status: 400 });
  }
  if (body.role !== undefined && body.role !== 'user' && body.role !== 'admin') {
    return NextResponse.json({ message: 'role must be "user" or "admin".' }, { status: 400 });
  }
  if (body.canEditSettings !== undefined && typeof body.canEditSettings !== 'boolean') {
    return NextResponse.json({ message: 'canEditSettings must be true or false.' }, { status: 400 });
  }

  try {
    const target = await db.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [id]);
    if (!target.rows[0]) return NextResponse.json({ message: 'Unknown user.' }, { status: 404 });
    if (isHardcodedAdminEmail(target.rows[0].email)) {
      return NextResponse.json({ message: 'This account is a built-in administrator and cannot be changed.' }, { status: 409 });
    }
    await db.query(
      `UPDATE users SET role = COALESCE($2, role), can_edit_settings = COALESCE($3, can_edit_settings) WHERE id = $1`,
      [id, body.role ?? null, body.canEditSettings ?? null],
    );
    return NextResponse.json({ message: 'Saved.' });
  } catch (error) {
    console.error('Could not update user rights:', error);
    return NextResponse.json({ message: 'Could not update the user.' }, { status: 500 });
  }
}
