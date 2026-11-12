import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { createClient, type User } from '@supabase/supabase-js';
import { normalizeBranchId } from './branch-mapping';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ielkaetihagxgnrrasch.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllbGthZXRpaGFneGducnJhc2NoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDEwMTU1OSwiZXhwIjoyMDk5Njc3NTU5fQ.F0KSjnVMl9Nz4fuXV3Z_fHBkQfCU8ieyPT0qJ2xLEMg';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllbGthZXRpaGFneGducnJhc2NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMDE1NTksImV4cCI6MjA5OTY3NzU1OX0.YKLOHhXhUCgG1eMZiksR4H7UwySjhWzc0e_pomh_0oI';

export const adminSupabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

export type UserRole = 'ADMIN' | 'TELLER' | 'AUDITOR' | 'MANAGER' | 'EVALUATOR';
const VALID_ROLES = new Set<UserRole>(['ADMIN', 'TELLER', 'AUDITOR', 'MANAGER', 'EVALUATOR']);

export interface AuthSession {
  user: any;
  profile: any;
  role: UserRole;
  branchId: string;
  trustedBranchId: string;
  branchName?: string;
  isAuthorized: boolean;
}

const REFRESH_CACHE_TTL_MS = 20_000;
const refreshCache = new Map<string, { promise: Promise<User | null>; expiresAt: number }>();

function extractCookieValue(cookieHeader: string, names: string[]): string {
  if (!cookieHeader) return '';
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (names.includes(key)) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return '';
}

/**
 * Cryptographically verifies and exchanges an active refresh token with Supabase Auth.
 * Deduplicates concurrent requests per token hash so shift dashboards do not race rotation.
 */
async function verifyViaRefreshToken(refreshToken: string): Promise<User | null> {
  if (!refreshToken || refreshToken.length < 8) return null;
  const key = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const now = Date.now();

  const cached = refreshCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = (async (): Promise<User | null> => {
    try {
      const authSupabase = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      });
      const { data, error } = await authSupabase.auth.refreshSession({ refresh_token: refreshToken });
      if (error || !data?.session?.user) {
        return null;
      }
      return data.session.user;
    } catch (err) {
      console.warn('[auth-server] Verified refresh token fallback failed:', err);
      return null;
    }
  })();

  refreshCache.set(key, { promise, expiresAt: now + REFRESH_CACHE_TTL_MS });
  if (refreshCache.size > 200) {
    for (const [k, v] of refreshCache.entries()) {
      if (v.expiresAt <= now) refreshCache.delete(k);
    }
  }

  const resolvedUser = await promise;
  if (!resolvedUser) {
    refreshCache.delete(key);
  }
  return resolvedUser;
}

/**
 * Extracts and cryptographically verifies the authenticated user session server-side.
 * Never trusts unverified JWT claims; expired access tokens recover strictly via Supabase refresh_token verification.
 */
export async function getAuthenticatedUser(request: Request): Promise<AuthSession | null> {
  try {
    const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
    const xAuthToken = request.headers.get('x-auth-token');
    const cookieHeader = request.headers.get('cookie') || '';

    let token = '';
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (xAuthToken) {
      token = xAuthToken.trim();
    } else {
      token = extractCookieValue(cookieHeader, ['sb-access-token', 'auth_token']);
    }

    const refreshToken =
      request.headers.get('x-refresh-token')?.trim() ||
      extractCookieValue(cookieHeader, ['sb-refresh-token', 'refresh_token']);

    if (!token && !refreshToken) {
      return null;
    }

    let user: User | null = null;
    if (token) {
      const { data: authData, error: userError } = await adminSupabase.auth.getUser(token);
      if (!userError && authData?.user) {
        user = authData.user;
      }
    }

    // Safe mid-shift recovery: exchange valid refresh_token with Supabase Auth (no unverified JWT decode)
    if (!user && refreshToken) {
      user = await verifyViaRefreshToken(refreshToken);
    }

    if (!user) {
      return null;
    }

    // Fetch user profile securely
    const { data: profileData } = await adminSupabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    const profile = profileData || {
      id: user.id,
      email: user.email,
      role: (user.user_metadata?.role || 'TELLER').toUpperCase(),
      branch_id: user.user_metadata?.branch_id || 'HQ',
      branch_name: user.user_metadata?.branch_name || 'Head Office'
    };
    const rawRole = String(profile?.role || user.user_metadata?.role || 'TELLER').toUpperCase() as UserRole;
    const role: UserRole = VALID_ROLES.has(rawRole) ? rawRole : 'TELLER';
    const trustedBranchId = normalizeBranchId(profile?.branch_id || 'HQ');
    let branchId = trustedBranchId;
    const branchName = profile?.branch_name || '';

    // Branch identification: ADMIN/HQ Auditors can switch branch via header; HQ relieving Tellers can select a non-HQ branch
    const selectedBranch =
      request.headers.get('x-branch-id') ||
      request.headers.get('X-Branch-Id') ||
      request.headers.get('X-BRANCH-ID');

    if (role === 'ADMIN' || (role === 'AUDITOR' && trustedBranchId === 'HQ')) {
      if (selectedBranch && selectedBranch.trim() !== '') {
        branchId = normalizeBranchId(selectedBranch.trim());
      }
    } else if (role === 'TELLER' && (trustedBranchId === 'HQ' || !trustedBranchId)) {
      if (selectedBranch && selectedBranch.trim() !== '') {
        const normalizedSel = normalizeBranchId(selectedBranch.trim());
        if (normalizedSel && normalizedSel !== 'HQ') {
          branchId = normalizedSel;
        }
      }
    } else {
      branchId = trustedBranchId;
    }

    if (!branchId) {
      branchId = 'HQ';
    }

    return {
      user,
      profile,
      role,
      branchId,
      trustedBranchId,
      branchName,
      isAuthorized: true
    };
  } catch (err) {
    console.error('getAuthenticatedUser error:', err);
    return null;
  }
}

/**
 * Validates financial mutation authorization strictly.
 * Unlike general read views, financial actions (cash dispatch, cash receipt, till count, approval)
 * strictly forbid branch spoofing via x-branch-id headers for non-admin accounts.
 */
export function validateFinancialActionAuth(
  session: AuthSession | null,
  requiredBranchId?: string | null,
  allowedRoles?: UserRole[]
): { authorized: boolean; error?: string } {
  if (!session || !session.user) {
    return { authorized: false, error: 'Unauthorized. Valid authentication session required.' };
  }

  if (allowedRoles && !allowedRoles.includes(session.role)) {
    return { authorized: false, error: `Forbidden. Action requires role: ${allowedRoles.join(', ')}.` };
  }

  // ADMIN has full system access across all branches
  if (session.role === 'ADMIN') {
    return { authorized: true };
  }

  if (requiredBranchId) {
    const targetNorm = normalizeBranchId(requiredBranchId);
    const profileNorm = normalizeBranchId(session.trustedBranchId);

    if (profileNorm !== targetNorm) {
      return { 
        authorized: false, 
        error: `Forbidden. Your assigned branch (${profileNorm}) is not authorized to perform operations for branch (${targetNorm}).` 
      };
    }
  }

  return { authorized: true };
}

/**
 * Validates whether the authenticated user is permitted to access/modify data for the target branch ID.
 * Returns true if permitted, false if forbidden.
 */
export function validateBranchAccess(session: AuthSession | null, targetBranchId?: string | null): boolean {
  if (!session) return false;
  // ADMIN has full system access
  if (session.role === 'ADMIN') return true;

  const isHead = !session.branchId || normalizeBranchId(session.branchId) === 'HQ' || session.branchId === 'HEAD OFFICE';
  // Users operating from Head Office (excluding TELLER and EVALUATOR) have cross-branch visibility
  if (isHead && session.role !== 'TELLER' && session.role !== 'EVALUATOR') return true;

  // Branch user is strictly bound to their assigned / selected branch
  if (!targetBranchId || targetBranchId === 'ALL' || targetBranchId === 'HQ') {
    return false;
  }

  return normalizeBranchId(session.branchId) === normalizeBranchId(targetBranchId);
}

/**
 * Enforces server-side authorization for API routes.
 * Returns null if authorized, or a NextResponse error if unauthorized.
 */
export async function enforceApiAuth(
  request: Request,
  allowedRoles?: UserRole | UserRole[],
  targetBranchId?: string | null
): Promise<{ session: AuthSession | null; errorResponse: NextResponse | null }> {
  const session = await getAuthenticatedUser(request);

  if (!session) {
    return {
      session: null,
      errorResponse: NextResponse.json(
        { error: 'Unauthorized. Authentication token is missing or invalid.' },
        { status: 401 }
      )
    };
  }

  if (allowedRoles) {
    const rolesArray = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    if (!rolesArray.includes(session.role)) {
      return {
        session,
        errorResponse: NextResponse.json(
          { error: `Forbidden. Requires one of the following roles: ${rolesArray.join(', ')}.` },
          { status: 403 }
        )
      };
    }
  }

  if (session.role !== 'ADMIN' && targetBranchId) {
    if (!validateBranchAccess(session, targetBranchId)) {
      return {
        session,
        errorResponse: NextResponse.json(
          { error: `Forbidden. You are not authorized to access or modify data for branch ${targetBranchId}.` },
          { status: 403 }
        )
      };
    }
  }

  return { session, errorResponse: null };
}
