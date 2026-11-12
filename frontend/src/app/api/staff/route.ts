import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

// GET: List all users from profiles + auth (Admin only)
export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }
    if (session.role !== 'ADMIN' && session.role !== 'MANAGER') {
      return NextResponse.json({ error: 'Forbidden. Admin or Manager privileges required to view staff.' }, { status: 403 });
    }

    // Get all auth users
    const { data: authData } = await adminSupabase.auth.admin.listUsers({ perPage: 1000 });
    const authUsers = authData?.users || [];

    // Get all profiles
    const { data: profiles } = await adminSupabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    const profilesMap = new Map((profiles || []).map((p: any) => [p.id, p]));
    const mergedMap = new Map<string, any>();

    // 1. Process all Supabase Auth Users
    for (const u of authUsers) {
      const p = profilesMap.get(u.id);
      mergedMap.set(u.id, {
        id: u.id,
        email: u.email || p?.email || '',
        branch_id: p?.branch_id || 'HQ',
        branch_name: p?.branch_name || 'Head Office',
        role: (p?.role || 'TELLER').toUpperCase(),
        lastSignIn: u.last_sign_in_at || p?.last_login || null,
        created_at: u.created_at || p?.created_at || new Date().toISOString(),
      });
    }

    // 2. Add any additional Profiles not present in authUsers
    for (const p of (profiles || [])) {
      if (!mergedMap.has(p.id)) {
        mergedMap.set(p.id, {
          ...p,
          email: p.email || '',
          branch_id: p.branch_id || 'HQ',
          branch_name: p.branch_name || 'Head Office',
          role: p.role || 'TELLER',
          lastSignIn: p.last_login || null,
          created_at: p.created_at || new Date().toISOString(),
        });
      }
    }

    const merged = Array.from(mergedMap.values()).sort((a, b) => 
      new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    );

    return NextResponse.json(merged);
  } catch (error: any) {
    console.error('Staff GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST: Create new user + profile (Admin only)
export async function POST(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden. Admin privileges required to create staff accounts.' }, { status: 403 });
    }

    const { email, password, branchId, branchName, role } = await request.json();

    console.log('[DEBUG] POST /api/staff started:', { email, branchId, branchName, role });

    if (!email || !password || !branchId || !branchName) {
      console.log('[DEBUG] POST /api/staff missing fields');
      return NextResponse.json({ error: 'Missing required fields: email, password, branchId, branchName' }, { status: 400 });
    }

    // 1. Create the Supabase auth user
    console.log('[DEBUG] POST /api/staff creating auth user...');
    const { data: newUser, error: createError } = await adminSupabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // auto-confirm so they can login immediately
    });

    if (createError) {
      console.error('[DEBUG] POST /api/staff auth creation error:', createError);
      throw createError;
    }

    if (!newUser.user) {
       console.error('[DEBUG] POST /api/staff auth user created but newUser.user is null');
       throw new Error('Auth user creation failed (no user object returned)');
    }

    const normalizedRole = (role || 'TELLER').toUpperCase();
    if ((normalizedRole === 'TELLER' || normalizedRole === 'MANAGER') && (branchId === 'HQ' || branchId === 'HEAD OFFICE')) {
      return NextResponse.json({ error: `${normalizedRole} accounts must be assigned to an operating branch, not Head Office.` }, { status: 400 });
    }

    // 2. Create the profile record
    console.log('[DEBUG] POST /api/staff creating profile record for user:', newUser.user.id);
    const { error: profileError } = await adminSupabase.from('profiles').insert({
      id: newUser.user.id,
      email,
      branch_id: branchId,
      branch_name: branchName,
      role: normalizedRole,
      created_at: new Date().toISOString(),
    });

    if (profileError) {
      console.error('[DEBUG] POST /api/staff profile creation error:', profileError);
      throw profileError;
    }

    console.log('[DEBUG] POST /api/staff finished successfully');
    return NextResponse.json({ success: true, userId: newUser.user.id }, { status: 201 });
  } catch (error: any) {
    console.error('Staff POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
