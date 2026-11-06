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

// Auto-hydrate Supabase client auth session on browser startup if tokens exist in localStorage
if (typeof window !== 'undefined') {
  try {
    const isLogin = window.location.pathname === '/login';
    if (!isLogin) {
      const token = localStorage.getItem('auth_token') || localStorage.getItem('sb-access-token');
      const refreshToken = localStorage.getItem('refresh_token') || localStorage.getItem('sb-refresh-token');
      if (token && refreshToken) {
        supabase.auth.getSession().then(({ data }) => {
          if (!data?.session) {
            supabase.auth.setSession({ access_token: token, refresh_token: refreshToken })
              .catch((err: any) => {
                if (err?.message?.includes('Refresh Token') || err?.name === 'AuthApiError' || err?.status === 400) {
                  localStorage.removeItem('auth_token');
                  localStorage.removeItem('refresh_token');
                  localStorage.removeItem('sb-access-token');
                  localStorage.removeItem('sb-refresh-token');
                  localStorage.removeItem('user');
                  supabase.auth.signOut({ scope: 'local' }).catch(() => {});
                }
              });
          }
        }).catch((err: any) => {
          if (err?.message?.includes('Refresh Token') || err?.name === 'AuthApiError') {
            localStorage.removeItem('auth_token');
            localStorage.removeItem('refresh_token');
            supabase.auth.signOut({ scope: 'local' }).catch(() => {});
          }
        });
      }
    } else {
      // Clean up stale or expired session on login page to avoid AuthApiError popups
      const search = window.location.search || '';
      if (search.includes('redirect') || search.includes('expired')) {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('sb-access-token');
        localStorage.removeItem('sb-refresh-token');
        localStorage.removeItem('user');
        supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      }
    }
  } catch {}
}
