'use client';

import { useState, useEffect } from 'react';
import { Eye, EyeOff, ChevronDown, Building2, ShieldCheck, User, Phone, Mail, Lock, ArrowLeft } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { CANONICAL_BRANCHES, normalizeBranchId } from '@/lib/branch-mapping';

export default function LoginPage() {
  /* ── shared ── */
  const [mode, setMode] = useState<'login' | 'reset' | 'update-password'>('login');
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [success, setSuccess]     = useState('');

  /* ── login ── */
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [branch, setBranch]       = useState('HQ');
  const [branchList, setBranchList] = useState<Array<{ id: string; name: string }>>([...CANONICAL_BRANCHES]);
  const [showPw, setShowPw]       = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [branchError, setBranchError] = useState(false);
  const [expiredAlert, setExpiredAlert] = useState(false);

  /* ── reset & update password ── */
  const [resetEmail, setResetEmail]           = useState('');
  const [newPassword, setNewPassword]         = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPw, setShowNewPw]             = useState(false);
  const [showConfirmPw, setShowConfirmPw]     = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      if (p.get('expired') === 'true') setExpiredAlert(true);

      // Load live active branches from Supabase if table exists
      supabase.from('branches').select('id, name').order('name').then(({ data, error }) => {
        if (!error && data && data.length > 0) {
          setBranchList(data);
        }
      });

      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
          setMode('update-password');
          setSuccess('Verification successful! Please enter your new password.');
        }
      });
      return () => subscription.unsubscribe();
    }
  }, []);

  /* switch mode — clear errors */
  const [tempSuccess, setTempSuccess] = useState('');
  const switchMode = (m: 'login' | 'reset' | 'update-password') => {
    setMode(m);
    setError('');
    // Keep success if switching to login after reset/register
    if (m === 'login' && tempSuccess) {
      setSuccess(tempSuccess);
      setTempSuccess('');
    } else {
      setSuccess('');
    }
  };

  /* ── RESET PASSWORD (Send Request to Admin Staff Management) ── */
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess('');
    setLoading(true);

    try {
      let loginEmail = resetEmail.trim();
      if (!loginEmail.includes('@')) {
        if (loginEmail.toLowerCase() === 'admin') {
          loginEmail = 'admin@gmail.com';
        } else {
          loginEmail = `${loginEmail.toLowerCase()}@gmail.com`;
        }
      }

      const res = await fetch('/api/staff/reset-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, branch }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to submit reset request');

      setSuccess('Verification request submitted! Your administrator in Staff Management has received the request to reset your password.');
      setResetEmail('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  /* ── UPDATE PASSWORD (After Link) ── */
  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess('');

    if (newPassword !== confirmPassword) {
      return setError('Passwords do not match.');
    }

    const strongRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
    if (!strongRegex.test(newPassword)) {
      return setError('New password must be at least 8 characters, include a lowercase & uppercase letter, a number, and a symbol.');
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) throw error;

      const successMsg = 'Password updated successfully! You can now sign in.';
      setTempSuccess(successMsg);
      await supabase.auth.signOut();
      
      setNewPassword('');
      setConfirmPassword('');
      switchMode('login');
      setSuccess(successMsg);
    } catch (err: any) {
      setError(err.message);
      await supabase.auth.signOut(); // clean up session
    } finally {
      setLoading(false);
    }
  };

  /* ── LOGIN ── */
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBranchError(false);
    setLoading(true);

    const effectiveBranchInput = branch || 'HQ';

    try {
      const rawInput = email.trim();
      let authUser: any = null;
      let tok = '';
      let refTok = '';
      let userRole = 'TELLER';

      // 1. Primary: Server-side API login (immune to browser adblockers, handles username/name lookup and http-safe cookies)
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: rawInput, password, branch: effectiveBranchInput })
        });
        const resData = await res.json();
        if (res.ok && resData.success) {
          authUser = resData.user;
          tok = resData.token || '';
          const cleanRole = (r?: string) => {
            const upper = (r || '').toUpperCase().trim();
            if (['ADMIN', 'MANAGER', 'AUDITOR'].includes(upper)) return upper;
            return 'TELLER';
          };
          userRole = cleanRole(resData.user?.role);
        } else if (!res.ok) {
          throw new Error(resData.error || 'Invalid credentials');
        }
      } catch (srvErr: any) {
        // Only re-throw if it's a real auth error from the server (not a fetch/network failure)
        const msg = srvErr?.message || '';
        const isNetworkError = msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network') || msg.toLowerCase().includes('econnrefused');
        if (!isNetworkError && msg) {
          throw srvErr;
        }
        console.warn('Server login fallback to client auth:', srvErr);
      }

      // 2. Fallback: Client-side Supabase if server-side route was unreachable
      if (!authUser) {
        let fallbackEmail = rawInput;
        if (!fallbackEmail.includes('@')) {
          fallbackEmail = fallbackEmail.toLowerCase() === 'admin' ? 'admin@gmail.com' : `${fallbackEmail.toLowerCase()}@gmail.com`;
        }
        const { data, error: signInError } = await supabase.auth.signInWithPassword({ email: fallbackEmail, password });
        if (signInError || !data.user) throw new Error(signInError?.message || 'Invalid credentials');

        const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).maybeSingle();
        authUser = data.user;
        tok = data.session?.access_token || '';
        refTok = data.session?.refresh_token || '';
        const cleanRole = (r?: string) => {
          const upper = (r || '').toUpperCase().trim();
          if (['ADMIN', 'MANAGER', 'AUDITOR'].includes(upper)) return upper;
          return 'TELLER';
        };
        userRole = cleanRole(profile?.role || data.user.user_metadata?.role);
      }

      const effectiveBranch = normalizeBranchId(authUser?.branchId || effectiveBranchInput);

      if (tok) {
        localStorage.setItem('auth_token', tok);
        document.cookie = `sb-access-token=${tok}; path=/; max-age=28800; SameSite=Lax`;
        document.cookie = `auth_token=${tok}; path=/; max-age=28800; SameSite=Lax`;
      }
      if (refTok) {
        localStorage.setItem('refresh_token', refTok);
        document.cookie = `sb-refresh-token=${refTok}; path=/; max-age=604800; SameSite=Lax`;
        document.cookie = `refresh_token=${refTok}; path=/; max-age=604800; SameSite=Lax`;
      }
      if (tok && refTok) {
        try {
          await supabase.auth.setSession({
            access_token: tok,
            refresh_token: refTok
          });
        } catch (setErr) {
          console.warn('Set supabase session note:', setErr);
        }
      }
      localStorage.setItem('user_branch', effectiveBranch);
      localStorage.setItem('user_role', userRole);
      const cleanDisplayName = userRole === 'ADMIN' ? 'Admin' : (authUser?.user_metadata?.full_name || authUser?.email?.split('@')[0] || 'User');
      localStorage.setItem('user_name', cleanDisplayName);
      localStorage.setItem('user', JSON.stringify({
        email: authUser.email,
        id: authUser.id,
        role: userRole,
        branchId: effectiveBranch,
        branchName: authUser?.branchName || branchList.find(b => b.id === effectiveBranch || normalizeBranchId(b.id) === effectiveBranch)?.name || (effectiveBranch === 'HQ' ? 'Head Office' : effectiveBranch),
      }));

      if (userRole === 'TELLER') {
        window.location.href = '/loans';
      } else if (userRole === 'AUDITOR') {
        window.location.href = '/dashboard/auditor';
      } else if (userRole === 'MANAGER') {
        window.location.href = '/operations/approvals';
      } else {
        window.location.href = '/';
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const selectedBranch = branchList.find(b => b.id === branch || normalizeBranchId(b.id) === normalizeBranchId(branch));

  /* ─────────────────────────────────────────────── */
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        html, body {
          height: 100%;
          font-family: 'Inter', 'Segoe UI', sans-serif;
          background: #1a1a1a;
        }

        /* ────────── ROOT ────────── */
        .root {
          display: flex;
          min-height: 100vh;
          font-family: 'Inter', 'Segoe UI', sans-serif;
        }

        /* ═════════════════════════════
           LEFT PANEL
        ═════════════════════════════ */
        .left {
          flex: 0 0 50%;
          display: flex;
          flex-direction: column;
          background: linear-gradient(160deg, #2a2a2a 0%, #1f1f1f 55%, #141414 100%);
          position: relative;
          overflow: hidden;
        }
        .left::before {
          content: '';
          position: absolute; top: -120px; right: -120px;
          width: 420px; height: 420px;
          background: radial-gradient(circle, rgba(251,191,36,.15) 0%, transparent 65%);
          border-radius: 50%; pointer-events: none;
        }
        .left::after {
          content: '';
          position: absolute; bottom: -100px; left: -80px;
          width: 320px; height: 320px;
          background: radial-gradient(circle, rgba(255,235,59,.12) 0%, transparent 65%);
          border-radius: 50%; pointer-events: none;
        }

        /* ── Top bar ── */
        .topbar {
          padding: 24px 52px;
          position: relative; z-index: 2;
          display: flex; align-items: center; gap: 10px;
          border-bottom: 1px solid rgba(255,255,255,.05);
          flex-shrink: 0;
        }
        .topbar-icon {
          width: 36px; height: 36px;
          background: linear-gradient(135deg, rgba(251,191,36,.3), rgba(255,235,59,.15));
          border: 1px solid rgba(255,235,59,.3);
          border-radius: 9px;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 0 16px rgba(251,191,36,.2);
        }
        .topbar-name  { font-size: 20px; font-weight: 700; color: #fff; letter-spacing: .2px; }
        .topbar-tag   { display: block; font-size: 12px; font-weight: 500; color: rgba(251,191,36,.65); letter-spacing: 1px; text-transform: uppercase; }

        /* ── Scrollable form area ── */
        .form-area {
          flex: 1;
          overflow-y: auto;
          display: flex; align-items: flex-start; justify-content: center;
          padding: 40px 52px;
          position: relative; z-index: 2;
        }
        .form-area::-webkit-scrollbar { width: 4px; }
        .form-area::-webkit-scrollbar-track { background: transparent; }
        .form-area::-webkit-scrollbar-thumb { background: rgba(255,255,255,.1); border-radius: 4px; }

        .form-card {
          width: 100%; max-width: 520px;
          padding: 8px 0 32px;
          animation: slide-up .4s cubic-bezier(.16,1,.3,1) both;
        }
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* ── Back Button ── */
        .back-btn {
          display: inline-flex; align-items: center; justify-content: center;
          width: 40px; height: 40px; border-radius: 50%;
          background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1);
          color: rgba(255,255,255,.7); cursor: pointer;
          margin-bottom: 24px;
          transition: background .15s, color .15s, transform .15s;
        }
        .back-btn:hover {
          background: rgba(251,191,36,.15); color: #fde047; border-color: rgba(251,191,36,.3);
          transform: translateX(-2px);
        }

        /* ── Heading ── */
        .heading { margin-bottom: 24px; }
        .heading-title {
          font-size: 32px; font-weight: 800;
          color: #fff; letter-spacing: -.5px; line-height: 1.15; margin-bottom: 8px;
        }
        .heading-sub { font-size: 14px; color: rgba(255,255,255,.5); line-height: 1.4; }
        .heading-sub a {
          color: #fbbf24; font-weight: 600;
          text-decoration: none; cursor: pointer;
          transition: color .15s;
        }
        .heading-sub a:hover { color: #fde047; }

        /* ── Alerts ── */
        .alert-warn {
          display: flex; align-items: flex-start; gap: 8px;
          background: rgba(251,191,36,.08);
          border: 1px solid rgba(251,191,36,.25);
          color: #fbbf24; border-radius: 10px;
          padding: 10px 14px; font-size: 12.5px; font-weight: 500;
          margin-bottom: 18px;
        }
        .alert-success {
          display: flex; align-items: flex-start; gap: 8px;
          background: rgba(34,197,94,.08);
          border: 1px solid rgba(34,197,94,.25);
          color: #86efac; border-radius: 10px;
          padding: 10px 14px; font-size: 12.5px; font-weight: 500;
          margin-bottom: 18px;
        }
        .alert-err {
          display: flex; align-items: center; gap: 8px;
          background: rgba(239,68,68,.08);
          border: 1px solid rgba(239,68,68,.22);
          color: #fca5a5; border-radius: 10px;
          padding: 10px 14px; font-size: 12.5px; font-weight: 500;
        }

        /* ── Form ── */
        .form { display: flex; flex-direction: column; gap: 14px; }

        /* Field */
        .field { display: flex; flex-direction: column; gap: 6px; }
        .field-label { font-size: 13px; font-weight: 600; color: rgba(255,255,255,.75); letter-spacing: .1px; }

        /* Input with icon wrapper */
        .inp-wrap { position: relative; }
        .inp-icon {
          position: absolute; left: 14px; top: 50%;
          transform: translateY(-50%);
          color: #94a3b8; pointer-events: none;
          display: flex; align-items: center;
        }

        /* Inputs */
        .inp {
          width: 100%; height: 46px;
          background: #fff;
          border: 1.5px solid transparent;
          border-radius: 10px;
          padding: 0 16px 0 42px;
          font-size: 14px; font-family: inherit;
          color: #0f172a; outline: none;
          transition: border-color .2s, box-shadow .2s;
        }
        .inp-no-icon { padding-left: 14px; }
        .inp::placeholder { color: #94a3b8; }
        .inp:focus { border-color: #fbbf24; box-shadow: 0 0 0 3px rgba(251,191,36,.18); }
        .inp:hover:not(:focus) { border-color: rgba(251,191,36,.35); }
        .inp-pw-pad { padding-right: 42px; }

        /* Eye toggle */
        .eye-btn {
          position: absolute; right: 14px; top: 50%;
          transform: translateY(-50%);
          background: none; border: none;
          color: #94a3b8; cursor: pointer;
          display: flex; align-items: center; padding: 0;
          transition: color .15s;
        }
        .eye-btn:hover { color: #fbbf24; }

        /* Branch dropdown */
        .br-wrap { position: relative; }
        .br-btn {
          width: 100%; height: 46px;
          background: #fff;
          border: 1.5px solid transparent;
          border-radius: 10px;
          padding: 0 16px 0 42px;
          font-size: 14px; font-family: inherit;
          display: flex; align-items: center; gap: 8px;
          cursor: pointer; outline: none;
          transition: border-color .2s, box-shadow .2s;
        }
        .br-btn:hover:not(.open) { border-color: rgba(251,191,36,.35); }
        .br-btn.open, .br-btn:focus { border-color: #fbbf24; box-shadow: 0 0 0 3px rgba(251,191,36,.18); }
        .br-btn.error { border-color: #ef4444; box-shadow: 0 0 0 3px rgba(239,68,68,.15); }
        .br-err-msg { font-size: 12px; color: #f87171; margin-top: 5px; font-weight: 500; display: flex; align-items: center; gap: 4px; }
        .br-txt { flex: 1; text-align: left; }
        .br-txt--ph  { color: #94a3b8; }
        .br-txt--val { color: #0f172a; font-weight: 500; }
        .br-chev { flex-shrink: 0; color: #94a3b8; transition: transform .22s; }
        .br-btn.open .br-chev { transform: rotate(180deg); }

        .br-menu {
          position: absolute; top: calc(100% + 4px); left: 0; right: 0;
          background: #1f1f1f;
          border: 1px solid rgba(251,191,36,.28);
          border-radius: 10px; overflow: hidden; z-index: 80;
          max-height: 240px; overflow-y: auto;
          box-shadow: 0 12px 36px rgba(0,0,0,.6);
          animation: menu-in .15s ease both;
        }
        .br-menu::-webkit-scrollbar { width: 4px; }
        .br-menu::-webkit-scrollbar-thumb { background: rgba(255,255,255,.2); border-radius: 4px; }
        @keyframes menu-in {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .br-item {
          width: 100%; background: none; border: none;
          padding: 11px 16px; font-size: 13.5px;
          font-family: inherit; cursor: pointer;
          text-align: left; color: rgba(255,255,255,.8);
          display: flex; align-items: center; gap: 8px;
          transition: background .14s, color .14s;
        }
        .br-item::before {
          content: ''; width: 5px; height: 5px;
          border-radius: 50%; background: rgba(255,255,255,.2);
          flex-shrink: 0; transition: background .14s;
        }
        .br-item:hover { background: rgba(251,191,36,.15); color: #fde047; }
        .br-item:hover::before { background: #fbbf24; }
        .br-item.sel { color: #fbbf24; font-weight: 600; }
        .br-item.sel::before { background: #fbbf24; }

        /* Forgot */
        .forgot { text-align: right; margin-top: -2px; }
        .forgot a { font-size: 13px; color: #fbbf24; font-weight: 500; cursor: pointer; text-decoration: none; transition: color .15s; }
        .forgot a:hover { color: #fde047; }

        /* ── Primary button ── */
        .btn-primary {
          width: 100%; height: 48px;
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
          border: none; border-radius: 10px;
          font-size: 15px; font-weight: 700;
          color: #1a1a1a; cursor: pointer;
          letter-spacing: .2px;
          display: flex; align-items: center; justify-content: center;
          font-family: inherit; position: relative; overflow: hidden;
          transition: transform .15s, box-shadow .2s, opacity .2s;
          box-shadow: 0 4px 18px rgba(245,158,11,.35);
          margin-top: 6px;
        }
        .btn-primary::after {
          content: ''; position: absolute; inset: 0;
          background: linear-gradient(to bottom, rgba(255,255,255,.2), transparent);
          pointer-events: none;
        }
        .btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 24px rgba(245,158,11,.45); }
        .btn-primary:active:not(:disabled) { transform: translateY(0); }
        .btn-primary:disabled { opacity: .5; cursor: not-allowed; }

        /* Spinner */
        .spinner {
          width: 18px; height: 18px;
          border: 2px solid rgba(26,26,26,.3);
          border-top-color: #1a1a1a;
          border-radius: 50%;
          animation: spin .7s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* ── Footer ── */
        .lp-footer {
          padding: 16px 52px;
          text-align: center;
          position: relative; z-index: 2;
          border-top: 1px solid rgba(255,255,255,.05);
          flex-shrink: 0;
        }
        .lp-footer p { font-size: 11px; color: rgba(255,255,255,.25); letter-spacing: .3px; }

        /* ═════════════════════════════
           RIGHT PANEL
        ═════════════════════════════ */
        .right {
          flex: 1;
          background: linear-gradient(145deg, #1c1c1c 0%, #121212 100%);
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          padding: 48px 40px;
          position: relative; overflow: hidden;
          gap: 32px;
        }
        .right::before {
          content: '';
          position: absolute; top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          width: 500px; height: 500px;
          background: radial-gradient(circle, rgba(251,191,36,.1) 0%, transparent 60%);
          border-radius: 50%; pointer-events: none;
        }

        /* Shield Ring with Rupasinghe Logo */
        .shield-ring {
          position: relative; z-index: 1; flex-shrink: 0;
          width: 280px; height: 280px;
        }
        .shield-ring::before {
          content: ''; position: absolute; inset: -14px; border-radius: 50%;
          border: 1px solid rgba(251,191,36,.25);
          animation: pulse 3s ease-in-out infinite;
        }
        .shield-ring::after {
          content: ''; position: absolute; inset: -28px; border-radius: 50%;
          border: 1px solid rgba(251,191,36,.12);
          animation: pulse 3s ease-in-out infinite .6s;
        }
        @keyframes pulse {
          0%, 100% { opacity: .4; transform: scale(1); }
          50%       { opacity: 1;  transform: scale(1.03); }
        }
        .shield-img-wrap {
          width: 100%; height: 100%; border-radius: 50%; overflow: hidden;
          background: #fff;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 0 0 2px rgba(251,191,36,.3), 0 0 50px rgba(251,191,36,.3), 0 0 100px rgba(251,191,36,.15);
        }
        .shield-img { width: 80%; height: 80%; object-fit: contain; display: block; }

        /* Right text */
        .right-text { text-align: center; z-index: 1; max-width: 440px; }
        .right-eyebrow { font-size: 12px; font-weight: 700; letter-spacing: 2.5px; color: #fbbf24; text-transform: uppercase; margin-bottom: 12px; }
        .right-title { font-size: 30px; font-weight: 800; color: #fff; letter-spacing: -.4px; line-height: 1.25; margin-bottom: 12px; }
        .right-body { font-size: 14.5px; color: rgba(255,255,255,.5); line-height: 1.55; }

        /* ── Responsive ── */
        @media (max-width: 960px) {
          .root { flex-direction: column; }
          .left { flex: none; width: 100%; }
          .right { flex: none; padding: 40px 24px; }
          .shield-ring { width: 200px; height: 200px; }
        }
        @media (max-width: 520px) {
          .form-area { padding: 24px 20px; }
          .topbar, .lp-footer { padding-left: 20px; padding-right: 20px; }
          .heading-title { font-size: 24px; }
        }
      `}</style>

      <div className="root">

        {/* ═══════════ LEFT ═══════════ */}
        <div className="left">

          {/* Brand */}
          <div className="topbar">
            <div className="topbar-icon">
              <ShieldCheck size={18} color="#fbbf24" />
            </div>
            <div>
              <span className="topbar-name">Mifos X</span>
              <span className="topbar-tag">Secure Portal</span>
            </div>
          </div>

          {/* Scrollable form */}
          <div className="form-area">
            <div className="form-card">

              {/* ════════ LOGIN FORM ════════ */}
              {mode === 'login' && (
                <>
                  <div className="heading">
                    <h1 className="heading-title">Welcome back</h1>
                    <p className="heading-sub">
                      Sign in to access your branch portal
                    </p>
                  </div>

                  {expiredAlert && (
                    <div className="alert-warn">⚠ Your session expired after 10 min of inactivity.</div>
                  )}
                  {success && <div className="alert-success">✓ {success}</div>}

                  <form className="form" onSubmit={handleLogin} autoComplete="off">

                    {/* Email */}
                    <div className="field">
                      <label className="field-label" htmlFor="l-email">Email address</label>
                      <div className="inp-wrap">
                        <span className="inp-icon"><Mail size={16} /></span>
                        <input id="l-email" type="text" className="inp" placeholder="you@example.com"
                          value={email} onChange={e => setEmail(e.target.value)} required autoComplete="username" />
                      </div>
                    </div>

                    {/* Password */}
                    <div className="field">
                      <label className="field-label" htmlFor="l-password">Password</label>
                      <div className="inp-wrap">
                        <span className="inp-icon"><Lock size={16} /></span>
                        <input id="l-password" type={showPw ? 'text' : 'password'}
                          className="inp inp-pw-pad" placeholder="••••••••••••"
                          value={password} onChange={e => setPassword(e.target.value)}
                          required autoComplete="current-password" />
                        <button type="button" className="eye-btn" tabIndex={-1}
                          onClick={() => setShowPw(v => !v)} aria-label="Toggle password">
                          {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      <div className="forgot"><a role="button" tabIndex={0} onClick={() => switchMode('reset')}>Forgot password?</a></div>
                    </div>

                    {/* Branch */}
                    <div className="field">
                      <label className="field-label" htmlFor="l-branch" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>Branch</span>
                        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}>Defaults to Head Office (HQ)</span>
                      </label>
                      <div className="br-wrap">
                        <div className="inp-icon" style={{ zIndex: 1, color: branchError ? '#f87171' : undefined }}><Building2 size={15} /></div>
                        <button id="l-branch" type="button"
                          className={`br-btn${branchOpen ? ' open' : ''}`}
                          onClick={() => { setBranchOpen(v => !v); }}
                          aria-haspopup="listbox" aria-expanded={branchOpen}>
                          <span className={`br-txt ${selectedBranch ? 'br-txt--val' : 'br-txt--ph'}`}>
                            {selectedBranch ? selectedBranch.name : 'Head Office (All Branches)'}
                          </span>
                          <ChevronDown size={15} className="br-chev" />
                        </button>
                        {branchOpen && (
                          <div className="br-menu" role="listbox">
                            {branchList.map(b => (
                              <button key={b.id} type="button" role="option"
                                aria-selected={branch === b.id}
                                className={`br-item${branch === b.id ? ' sel' : ''}`}
                                onClick={() => { setBranch(b.id); setBranchOpen(false); }}>
                                <span>{b.name}</span>
                                {b.id === 'HQ' && <span style={{ fontSize: '10px', color: '#ffd100', marginLeft: '6px', fontWeight: 600 }}>(All Branches)</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {error && <div className="alert-err" role="alert"><span>⚠</span>{error}</div>}

                    <button id="l-submit" type="submit" className="btn-primary" disabled={loading}>
                      {loading ? <span className="spinner" /> : 'Sign in'}
                    </button>

                  </form>
                </>
              )}

              {/* ════════ RESET PASSWORD FORM (Request Admin Verification) ════════ */}
              {mode === 'reset' && (
                <>
                  <button type="button" className="back-btn" onClick={() => switchMode('login')} aria-label="Go back">
                    <ArrowLeft size={18} />
                  </button>
                  <div className="heading">
                    <h1 className="heading-title">Reset password</h1>
                    <p className="heading-sub">
                      Remember your password?{' '}
                      <a onClick={() => switchMode('login')}>Sign in</a>
                    </p>
                  </div>

                  {success && <div className="alert-success">✓ {success}</div>}
                  {error && <div className="alert-err" role="alert"><span>⚠</span>{error}</div>}

                  <form className="form" onSubmit={handleResetPassword} autoComplete="off">
                    {/* Email / Username */}
                    <div className="field">
                      <label className="field-label" htmlFor="rs-email">Email or Username</label>
                      <div className="inp-wrap">
                        <span className="inp-icon"><Mail size={16} /></span>
                        <input id="rs-email" type="text" className="inp" placeholder="staff@rupasinghe.com"
                          value={resetEmail} onChange={e => setResetEmail(e.target.value)} required />
                      </div>
                    </div>

                    <p className="text-xs text-slate-400 leading-relaxed">
                      Submitting this form notifies your Administrator in <strong className="text-amber-400">Staff Management</strong> to verify and update your credentials.
                    </p>

                    <button type="submit" className="btn-primary" disabled={loading}>
                      {loading ? <span className="spinner" /> : 'Submit Verification Request'}
                    </button>
                  </form>
                </>
              )}

              {/* ════════ UPDATE PASSWORD FORM (After Link) ════════ */}
              {mode === 'update-password' && (
                <>
                  <div className="heading">
                    <h1 className="heading-title">Set new password</h1>
                    <p className="heading-sub">
                      Please enter a strong password to secure your account.
                    </p>
                  </div>

                  {success && <div className="alert-success">✓ {success}</div>}
                  {error && <div className="alert-err" role="alert"><span>⚠</span>{error}</div>}

                  <form className="form" onSubmit={handleUpdatePassword} autoComplete="off">
                    {/* New Password */}
                    <div className="field">
                      <label className="field-label" htmlFor="up-new-password">New Password</label>
                      <div className="inp-wrap">
                        <span className="inp-icon"><Lock size={16} /></span>
                        <input id="up-new-password" type={showNewPw ? 'text' : 'password'}
                          className="inp inp-pw-pad" placeholder="Min 8 chars, mixed case, symbol, number"
                          value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
                        <button type="button" className="eye-btn" tabIndex={-1}
                          onClick={() => setShowNewPw(v => !v)} aria-label="Toggle password">
                          {showNewPw ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>

                    {/* Confirm Password */}
                    <div className="field">
                      <label className="field-label" htmlFor="up-confirm-password">Confirm Password</label>
                      <div className="inp-wrap">
                        <span className="inp-icon"><Lock size={16} /></span>
                        <input id="up-confirm-password" type={showConfirmPw ? 'text' : 'password'}
                          className="inp inp-pw-pad" placeholder="Re-enter your new password"
                          value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required />
                        <button type="button" className="eye-btn" tabIndex={-1}
                          onClick={() => setShowConfirmPw(v => !v)} aria-label="Toggle password">
                          {showConfirmPw ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>

                    <button type="submit" className="btn-primary" disabled={loading}>
                      {loading ? <span className="spinner" /> : 'Update Password'}
                    </button>
                  </form>
                </>
              )}

            </div>
          </div>

          {/* Footer */}
          <div className="lp-footer">
            <p>Teller &amp; Admin Secure Portal &mdash; Mifos X &copy; 2026</p>
          </div>
        </div>

        {/* ═══════════ RIGHT ═══════════ */}
        <div className="right">
          <div className="shield-ring">
            <div className="shield-img-wrap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/rupasinghe_logo.png" alt="Rupasinghe Pawning" className="shield-img" />
            </div>
          </div>
          <div className="right-text">
            <p className="right-eyebrow">Enterprise-Grade Security</p>
            <h2 className="right-title">Your Data,<br />Always Protected</h2>
            <p className="right-body">
              Multi-branch MFI platform secured with end-to-end
              encryption, role-based access control and real-time audit logging.
            </p>
          </div>
        </div>

      </div>
    </>
  );
}
