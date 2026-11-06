import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { normalizeBranchId, CANONICAL_BRANCHES } from '@/lib/branch-mapping';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ielkaetihagxgnrrasch.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllbGthZXRpaGFneGducnJhc2NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMDE1NTksImV4cCI6MjA5OTY3NzU1OX0.YKLOHhXhUCgG1eMZiksR4H7UwySjhWzc0e_pomh_0oI';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllbGthZXRpaGFneGducnJhc2NoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDEwMTU1OSwiZXhwIjoyMDk5Njc3NTU5fQ.F0KSjnVMl9Nz4fuXV3Z_fHBkQfCU8ieyPT0qJ2xLEMg';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password, branch, branchId } = body;
    const requestedBranch = branch || branchId;

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    // Admin Supabase client to fetch profile safely
    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    let loginEmail = String(email).trim();
    if (!loginEmail.includes('@')) {
      if (loginEmail.toLowerCase() === 'admin') {
        loginEmail = 'admin@gmail.com';
      } else {
        try {
          const cleanUser = loginEmail.toLowerCase();
          // 1. Search profiles by email prefix or name
          const { data: matchedProf } = await adminSupabase
            .from('profiles')
            .select('email')
            .or(`email.ilike.%${cleanUser}%,first_name.ilike.%${cleanUser}%,last_name.ilike.%${cleanUser}%`)
            .limit(1)
            .maybeSingle();

          if (matchedProf && matchedProf.email) {
            loginEmail = matchedProf.email;
          } else {
            // 2. Check if there is an auth user matching username directly
            const { data: authList } = await adminSupabase.auth.admin.listUsers({ perPage: 100 });
            const foundUser = authList?.users?.find(u => 
              (u.email && u.email.toLowerCase().startsWith(cleanUser)) ||
              (u.user_metadata?.username && u.user_metadata.username.toLowerCase() === cleanUser) ||
              (u.user_metadata?.full_name && u.user_metadata.full_name.toLowerCase().includes(cleanUser))
            );
            if (foundUser && foundUser.email) {
              loginEmail = foundUser.email;
            } else {
              loginEmail = `${cleanUser}@gmail.com`;
            }
          }
        } catch {
          loginEmail = `${loginEmail.toLowerCase()}@gmail.com`;
        }
      }
    }

    // Direct Supabase client for authentication
    const authSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data: authData, error: authError } = await authSupabase.auth.signInWithPassword({
      email: loginEmail,
      password: String(password)
    });

    if (authError || !authData.user) {
      return NextResponse.json(
        { error: authError?.message || 'Invalid credentials' },
        { status: 401 }
      );
    }

    const { data: profile } = await adminSupabase
      .from('profiles')
      .select('*')
      .eq('id', authData.user.id)
      .maybeSingle();

    // Derive role strictly from database profile or auth metadata, defaulting to least-privilege TELLER
    const role = (profile?.role || authData.user.user_metadata?.role || 'TELLER').toUpperCase();
    
    // Determine effective operating branch:
    // ADMIN can select any operating branch;
    // TELLERs with HQ or unassigned profile can select their operating branch at login;
    // Other staff operate in their assigned database branch.
    const selectedBranch = requestedBranch ? normalizeBranchId(requestedBranch) : null;
    let effectiveBranch = normalizeBranchId(profile?.branch_id || 'HQ');
    if (role === 'ADMIN' || role === 'AUDITOR' || role === 'MANAGER') {
      // Admin, Auditor, and Manager can operate in HQ (Main Branch) or select any specific branch
      effectiveBranch = selectedBranch || effectiveBranch || 'HQ';
    } else {
      // TELLER must operate in their assigned or selected local branch
      if (selectedBranch && selectedBranch !== 'HQ' && selectedBranch !== 'DHW') {
        effectiveBranch = selectedBranch;
      } else if (profile?.branch_id && normalizeBranchId(profile.branch_id) !== 'HQ' && normalizeBranchId(profile.branch_id) !== 'DHW') {
        effectiveBranch = normalizeBranchId(profile.branch_id);
      }
    }

    // Main Branch (DHW / HQ) is reserved for Management, Admin, and Auditor - Tellers must log into their assigned local branch
    if ((effectiveBranch === 'DHW' || effectiveBranch === 'HQ') && role === 'TELLER') {
      return NextResponse.json(
        { error: 'Access Denied: Main Branch is reserved for Administrator and Management login only. Please select your assigned local branch.' },
        { status: 403 }
      );
    }

    const branchObj = CANONICAL_BRANCHES.find(b => b.id === effectiveBranch);
    const effectiveBranchName = branchObj ? branchObj.name : ((effectiveBranch === 'HQ' || effectiveBranch === 'DHW') ? 'Main Branch' : (profile?.branch_name || effectiveBranch));

    // Auto-heal missing profile in public.profiles if user authenticated successfully
    let userProfile = profile;
    if (!userProfile) {
      const emailPrefix = (authData.user.email || '').split('@')[0];
      const newProf = {
        id: authData.user.id,
        email: authData.user.email,
        branch_id: effectiveBranch,
        branch_name: effectiveBranchName,
        role: role,
        first_name: authData.user.user_metadata?.first_name || authData.user.user_metadata?.full_name || emailPrefix,
        created_at: new Date().toISOString()
      };
      try {
        await adminSupabase.from('profiles').insert(newProf);
        userProfile = newProf;
      } catch (insertErr) {
        console.warn('Auto-create profile note:', insertErr);
        userProfile = newProf;
      }
    }

    // Keep database profile in sync with selected operating branch for ADMIN
    if (role === 'ADMIN' && userProfile && effectiveBranch && effectiveBranch !== normalizeBranchId(userProfile.branch_id)) {
      try {
        await adminSupabase
          .from('profiles')
          .update({
            branch_id: effectiveBranch,
            branch_name: effectiveBranchName
          })
          .eq('id', authData.user.id);
      } catch (profErr) {
        console.warn('Failed to update profile branch on login:', profErr);
      }
    }

    const token = authData.session?.access_token || '';
    const refreshToken = authData.session?.refresh_token || '';

    const response = NextResponse.json({
      success: true,
      user: {
        id: authData.user.id,
        email: authData.user.email,
        role: role,
        branchId: effectiveBranch,
        branchName: effectiveBranchName
      },
      profile: userProfile ? { ...userProfile, branch_id: effectiveBranch, branch_name: effectiveBranchName } : { role, branch_id: effectiveBranch, branch_name: effectiveBranchName },
      token: token,
      refreshToken: refreshToken
    });

    if (token) {
      const isHttps = request.url.startsWith('https:');
      response.cookies.set('sb-access-token', token, {
        path: '/',
        maxAge: 28800,
        sameSite: 'lax',
        httpOnly: false,
        secure: isHttps
      });
      response.cookies.set('auth_token', token, {
        path: '/',
        maxAge: 28800,
        sameSite: 'lax',
        httpOnly: false,
        secure: isHttps
      });
      if (refreshToken) {
        response.cookies.set('sb-refresh-token', refreshToken, {
          path: '/',
          maxAge: 7 * 24 * 3600, // 7 days
          sameSite: 'lax',
          httpOnly: false,
          secure: isHttps
        });
        response.cookies.set('refresh_token', refreshToken, {
          path: '/',
          maxAge: 7 * 24 * 3600,
          sameSite: 'lax',
          httpOnly: false,
          secure: isHttps
        });
      }
    }

    return response;
  } catch (err: any) {
    console.error('Server login exception:', err);
    return NextResponse.json(
      { error: err.message || 'Authentication server error' },
      { status: 500 }
    );
  }
}
