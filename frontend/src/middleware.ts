import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

function isTokenValid(token?: string): boolean {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    let jsonStr: string;
    if (typeof atob === 'function') {
      try {
        jsonStr = decodeURIComponent(escape(atob(base64)));
      } catch {
        jsonStr = atob(base64);
      }
    } else {
      jsonStr = Buffer.from(base64, 'base64').toString('utf8');
    }
    const payload = JSON.parse(jsonStr);
    if (!payload.sub) return false;
    // Expired tokens are marked invalid
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp && (nowSec > payload.exp)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Allow public assets, internal next.js endpoints, and static files
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/auth/login') ||
    pathname.startsWith('/api/auth/logout') ||
    pathname.startsWith('/api/auth/refresh') ||
    pathname === '/favicon.ico' ||
    pathname === '/rupasinghe_logo.png' ||
    pathname === '/icon.png' ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.ico')
  ) {
    return NextResponse.next();
  }

  // 2. Check for authentication token or active refresh cookie
  const authToken = request.cookies.get('sb-access-token')?.value || request.cookies.get('auth_token')?.value;
  const refreshCookie = request.cookies.get('sb-refresh-token')?.value || request.cookies.get('refresh_token')?.value || '';
  const hasValidToken = isTokenValid(authToken) || refreshCookie.trim().length >= 8;

  const isLoginPage = pathname === '/login';

  // If user is trying to access protected route without valid token, redirect to /login
  if (!hasValidToken && !isLoginPage && !pathname.startsWith('/api/')) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
