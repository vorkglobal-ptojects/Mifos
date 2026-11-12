import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { recordAuditLog } from '@/lib/audit-logger';
import { normalizeBranchId } from '@/lib/branch-mapping';

export const dynamic = 'force-dynamic';

// GET: List all password reset requests (Admin only)
export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden. Admin privileges required.' }, { status: 403 });
    }

    const { data, error } = await adminSupabase
      .from('audit_logs')
      .select('*')
      .eq('action', 'PASSWORD_RESET_REQUEST')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    const formatted = (data || []).map((row: any) => {
      const details = row.details || {};
      let status = 'PENDING';
      if (details.status === 'RESOLVED' || details.status === 'DISMISSED' || details.resolved_at) {
        status = details.status === 'DISMISSED' ? 'DISMISSED' : 'RESOLVED';
      }
      return {
        id: row.id,
        userId: row.user_id,
        email: row.user_email || details.email,
        branchId: row.branch_id || details.branch_id || 'HQ',
        status,
        requestedAt: details.requested_at || row.created_at,
        resolvedAt: details.resolved_at || null,
        note: details.note || details.message || '',
        ipAddress: details.ip_address || '',
      };
    });

    return NextResponse.json(formatted);
  } catch (error: any) {
    console.error('Password reset requests GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST: Submit a password reset request from login page (Public)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, branch, note } = body;

    if (!email) {
      return NextResponse.json({ error: 'Email address or username is required' }, { status: 400 });
    }

    let searchEmail = email.trim();
    if (!searchEmail.includes('@')) {
      if (searchEmail.toLowerCase() === 'admin') {
        searchEmail = 'admin@gmail.com';
      } else {
        searchEmail = `${searchEmail.toLowerCase()}@gmail.com`;
      }
    }

    // Try to find user profile to identify role, branch, and user ID
    let foundUserId: string | null = null;
    let foundRole = 'TELLER';
    let foundBranch = branch ? normalizeBranchId(branch) : 'HQ';

    const { data: profile } = await adminSupabase
      .from('profiles')
      .select('*')
      .ilike('email', searchEmail)
      .limit(1)
      .maybeSingle();

    if (profile) {
      foundUserId = profile.id;
      foundRole = profile.role || 'TELLER';
      foundBranch = profile.branch_id || foundBranch;
    } else {
      // Check auth users directly
      const { data: authUsers } = await adminSupabase.auth.admin.listUsers({ perPage: 1000 });
      const matched = authUsers?.users?.find(u => u.email?.toLowerCase() === searchEmail.toLowerCase());
      if (matched) {
        foundUserId = matched.id;
      }
    }

    // Log the request to audit_logs
    await recordAuditLog(null, {
      action: 'PASSWORD_RESET_REQUEST',
      resource: 'staff_passwords',
      userId: foundUserId || undefined,
      userEmail: searchEmail,
      role: foundRole,
      branchId: foundBranch,
      request,
      status: 'PENDING' as any,
      details: {
        status: 'PENDING',
        email: searchEmail,
        branch_id: foundBranch,
        requested_at: new Date().toISOString(),
        note: note || 'Password reset requested from login portal.',
      }
    });

    // Also send supabase recovery email if possible (non-blocking)
    try {
      await adminSupabase.auth.resetPasswordForEmail(searchEmail);
    } catch {
      // ignore
    }

    return NextResponse.json({
      success: true,
      message: 'Password reset request submitted to Administrator in Staff Management.'
    });
  } catch (error: any) {
    console.error('Password reset request POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH: Resolve a reset request (Admin sets new password or dismisses)
export async function PATCH(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden. Admin privileges required.' }, { status: 403 });
    }

    const { requestId, userId, email, newPassword, status } = await request.json();

    if (!requestId) {
      return NextResponse.json({ error: 'Missing requestId' }, { status: 400 });
    }

    // If newPassword provided, update user in auth
    if (newPassword && (userId || email)) {
      let targetUserId = userId;
      if (!targetUserId && email) {
        const { data: authUsers } = await adminSupabase.auth.admin.listUsers({ perPage: 1000 });
        const matched = authUsers?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
        targetUserId = matched?.id;
      }

      if (targetUserId) {
        const { error: authErr } = await adminSupabase.auth.admin.updateUserById(targetUserId, {
          password: newPassword,
        });
        if (authErr) throw authErr;
      }
    }

    // Fetch existing log row
    const { data: existingLog } = await adminSupabase
      .from('audit_logs')
      .select('*')
      .eq('id', requestId)
      .single();

    if (existingLog) {
      const updatedDetails = {
        ...(existingLog.details || {}),
        status: status || 'RESOLVED',
        resolved_at: new Date().toISOString(),
        resolved_by: session.user.email || 'ADMIN',
      };

      await adminSupabase
        .from('audit_logs')
        .update({ details: updatedDetails })
        .eq('id', requestId);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Password reset resolve PATCH error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
