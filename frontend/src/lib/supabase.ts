import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ielkaetihagxgnrrasch.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllbGthZXRpaGFneGducnJhc2NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMDE1NTksImV4cCI6MjA5OTY3NzU1OX0.YKLOHhXhUCgG1eMZiksR4H7UwySjhWzc0e_pomh_0oI';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

// Auto-hydrate Supabase client auth session and keep localStorage/cookies synced on refresh
if (typeof window !== 'undefined') {
  const getBrowserCookie = (name: string): string => {
    const prefix = `${name}=`;
    for (const part of document.cookie.split(';')) {
      const trimmed = part.trim();
      if (trimmed.startsWith(prefix)) {
        try {
          return decodeURIComponent(trimmed.slice(prefix.length).trim());
        } catch {
          return trimmed.slice(prefix.length).trim();
        }
      }
    }
    return '';
  };

  const clearBrowserAuthTokens = () => {
    try {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('sb-access-token');
      localStorage.removeItem('sb-refresh-token');
      localStorage.removeItem('user');
      for (const name of ['sb-access-token', 'auth_token', 'sb-refresh-token', 'refresh_token']) {
        document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
      }
    } catch {}
    supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  };

  const syncBrowserAuthTokens = (accessToken?: string | null, refreshToken?: string | null) => {
    if (!accessToken) return;
    const isHttps = window.location.protocol === 'https:';
    const secureAttr = isHttps ? '; Secure' : '';
    try {
      localStorage.setItem('auth_token', accessToken);
      localStorage.setItem('sb-access-token', accessToken);
      document.cookie = `sb-access-token=${encodeURIComponent(accessToken)}; path=/; max-age=28800; SameSite=Lax${secureAttr}`;
      document.cookie = `auth_token=${encodeURIComponent(accessToken)}; path=/; max-age=28800; SameSite=Lax${secureAttr}`;
      if (refreshToken) {
        localStorage.setItem('refresh_token', refreshToken);
        localStorage.setItem('sb-refresh-token', refreshToken);
        document.cookie = `sb-refresh-token=${encodeURIComponent(refreshToken)}; path=/; max-age=604800; SameSite=Lax${secureAttr}`;
        document.cookie = `refresh_token=${encodeURIComponent(refreshToken)}; path=/; max-age=604800; SameSite=Lax${secureAttr}`;
      }
    } catch {}
  };

  supabase.auth.onAuthStateChange((event, session) => {
    if ((event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') && session?.access_token) {
      syncBrowserAuthTokens(session.access_token, session.refresh_token);
    }
  });

  try {
    const isLogin = window.location.pathname === '/login';
    if (!isLogin) {
      const token =
        localStorage.getItem('auth_token') ||
        localStorage.getItem('sb-access-token') ||
        getBrowserCookie('sb-access-token') ||
        getBrowserCookie('auth_token');
      const refreshToken =
        localStorage.getItem('refresh_token') ||
        localStorage.getItem('sb-refresh-token') ||
        getBrowserCookie('sb-refresh-token') ||
        getBrowserCookie('refresh_token');

      if (token && refreshToken) {
        supabase.auth.getSession().then(({ data }) => {
          if (data?.session?.access_token) {
            syncBrowserAuthTokens(data.session.access_token, data.session.refresh_token);
          } else {
            supabase.auth.setSession({ access_token: token, refresh_token: refreshToken })
              .then(({ data: restored, error: restoredErr }) => {
                if (restored?.session?.access_token) {
                  syncBrowserAuthTokens(restored.session.access_token, restored.session.refresh_token);
                } else if (restoredErr) {
                  clearBrowserAuthTokens();
                }
              })
              .catch(() => {
                clearBrowserAuthTokens();
              });
          }
        }).catch(() => {
          clearBrowserAuthTokens();
        });
      }
    } else {
      // Clean up stale or expired session on login page to avoid AuthApiError popups
      const search = window.location.search || '';
      if (search.includes('redirect') || search.includes('expired')) {
        clearBrowserAuthTokens();
      }
    }
  } catch {}
}
