import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    let refreshToken = '';
    try {
      const body = await request.json().catch(() => ({}));
      refreshToken = body?.refreshToken || body?.refresh_token || '';
    } catch {
      refreshToken = '';
    }

    if (!refreshToken) {
      const cookieHeader = request.headers.get('cookie') || '';
      const refreshCookie = cookieHeader
        .split(';')
        .find(c => c.trim().startsWith('sb-refresh-token=') || c.trim().startsWith('refresh_token='));
      if (refreshCookie) {
        refreshToken = refreshCookie.split('=')[1]?.trim() || '';
      }
    }

    if (!refreshToken) {
      return NextResponse.json({ error: 'No refresh token provided' }, { status: 400 });
    }

    const authSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data, error } = await authSupabase.auth.refreshSession({ refresh_token: refreshToken });

    if (error || !data?.session) {
      return NextResponse.json({ error: error?.message || 'Failed to refresh session' }, { status: 401 });
    }

    const newAccessToken = data.session.access_token;
    const newRefreshToken = data.session.refresh_token;

    const response = NextResponse.json({
      success: true,
      token: newAccessToken,
      refreshToken: newRefreshToken,
      user: {
        id: data.user?.id,
        email: data.user?.email
      }
    });

    const isProduction = process.env.NODE_ENV === 'production';
    response.cookies.set('sb-access-token', newAccessToken, {
      path: '/',
      maxAge: 28800,
      sameSite: 'lax',
      httpOnly: false,
      secure: isProduction
    });
    response.cookies.set('auth_token', newAccessToken, {
      path: '/',
      maxAge: 28800,
      sameSite: 'lax',
      httpOnly: false,
      secure: isProduction
    });
    response.cookies.set('sb-refresh-token', newRefreshToken, {
      path: '/',
      maxAge: 7 * 24 * 3600,
      sameSite: 'lax',
      httpOnly: false,
      secure: isProduction
    });
    response.cookies.set('refresh_token', newRefreshToken, {
      path: '/',
      maxAge: 7 * 24 * 3600,
      sameSite: 'lax',
      httpOnly: false,
      secure: isProduction
    });

    return response;
  } catch (err: any) {
    console.error('Session refresh error:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
