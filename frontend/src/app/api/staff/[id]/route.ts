import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

// PATCH: Update user email, password, or profile details (Admin only)
export async function PATCH(request: Request, context: any) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden. Admin privileges required.' }, { status: 403 });
    }

    const { id } = await context.params;
    const { email, password, branchId, branchName, role } = await request.json();

    // 1. Update auth (email / password) if provided
    const authUpdates: any = {};
    if (email) authUpdates.email = email;
    if (password) authUpdates.password = password;

    if (Object.keys(authUpdates).length > 0) {
      const { error: authError } = await adminSupabase.auth.admin.updateUserById(id, authUpdates);
      if (authError) throw authError;
    }

    // 2. Update profile record
    const profileUpdates: any = {};
    if (email)      profileUpdates.email       = email;
    if (branchId)   profileUpdates.branch_id   = branchId;
    if (branchName) profileUpdates.branch_name = branchName;
    if (role)       profileUpdates.role        = String(role).toUpperCase();

    const targetRole = profileUpdates.role;
    const targetBranch = profileUpdates.branch_id;
    if (targetRole === 'TELLER' && (targetBranch === 'HQ' || targetBranch === 'HEAD OFFICE')) {
      return NextResponse.json({ error: `TELLER accounts must be assigned to an operating branch, not Head Office.` }, { status: 400 });
    }

    if (Object.keys(profileUpdates).length > 0) {
      const { error: profileError } = await adminSupabase.from('profiles').update(profileUpdates).eq('id', id);
      if (profileError) throw profileError;
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Staff PATCH error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE: Remove user from auth and profiles (Admin only)
export async function DELETE(request: Request, context: any) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden. Admin privileges required.' }, { status: 403 });
    }

    const { id } = await context.params;

    // 1. Delete profile first (FK constraint)
    await adminSupabase.from('profiles').delete().eq('id', id);

    // 2. Delete auth user
    const { error: authError } = await adminSupabase.auth.admin.deleteUser(id);
    if (authError) throw authError;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Staff DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

