'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ShieldCheck, UserPlus, Pencil, Trash2, RefreshCcw,
  Eye, EyeOff, Building2, Mail, Lock, Sparkles, Users,
  KeyRound, AlertCircle, CheckCircle2, Clock
} from 'lucide-react';
import { toast } from 'sonner';
import { getAuthHeaders } from '@/lib/getAuthHeaders';

// Branches will be fetched dynamically from /api/branches

const ROLES = ['TELLER', 'ADMIN', 'AUDITOR', 'MANAGER'];

export default function StaffPage() {
  const [staff, setStaff]             = useState<any[]>([]);
  const [loading, setLoading]         = useState(true);
  const [isSaving, setIsSaving]       = useState(false);
  const [isOpen, setIsOpen]           = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [showPassword, setShowPassword] = useState(false);

  const [branches, setBranches]       = useState<any[]>([]);
  const [isNewBranch, setIsNewBranch] = useState(false);
  const [newBranchId, setNewBranchId] = useState('');
  const [newBranchName, setNewBranchName] = useState('');

  // Form fields
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [branchId, setBranchId]     = useState('');
  const [branchName, setBranchName] = useState('');
  const [role, setRole]             = useState('TELLER');
  const [searchQuery, setSearchQuery] = useState('');

  // Password Reset Requests State
  const [resetRequests, setResetRequests]     = useState<any[]>([]);
  const [activeTab, setActiveTab]             = useState<'staff' | 'requests'>('staff');
  const [resolvingReq, setResolvingReq]       = useState<any>(null);
  const [newStaffPassword, setNewStaffPassword] = useState('');
  const [isResolving, setIsResolving]         = useState(false);
  const [showResolvePw, setShowResolvePw]     = useState(false);

  const loadStaff = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/staff', { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setStaff(data);
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to load staff');
      }
    } catch (e) {
      toast.error('Network error loading staff');
    } finally {
      setLoading(false);
    }
  };

  const loadBranches = async () => {
    try {
      const res = await fetch('/api/branches');
      if (res.ok) {
        setBranches(await res.json());
      }
    } catch (e) {
      console.error('Failed to load branches');
    }
  };

  const loadResetRequests = async () => {
    try {
      const res = await fetch('/api/staff/reset-requests', {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setResetRequests(Array.isArray(data) ? data : []);
      } else {
        const err = await res.json();
        console.warn('Failed to load reset requests:', err);
      }
    } catch (e) {
      console.error('Failed to load reset requests', e);
    }
  };

  const handleRefresh = () => {
    loadStaff();
    loadBranches();
    loadResetRequests();
    toast.success('Data refreshed');
  };

  useEffect(() => { 
    loadStaff(); 
    loadBranches();
    loadResetRequests();

    // Auto-poll reset requests every 8 seconds for real-time visibility
    const interval = setInterval(() => {
      loadResetRequests();
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  const handleResolveReset = async () => {
    if (!resolvingReq || !newStaffPassword) {
      toast.error('Please enter a new password for the staff member.');
      return;
    }
    if (newStaffPassword.length < 6) {
      toast.error('Password must be at least 6 characters.');
      return;
    }

    setIsResolving(true);
    const toastId = toast.loading(`Updating password for ${resolvingReq.email}...`);
    try {
      const res = await fetch('/api/staff/reset-requests', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          requestId: resolvingReq.id,
          userId: resolvingReq.userId,
          email: resolvingReq.email,
          newPassword: newStaffPassword,
          status: 'RESOLVED',
        })
      });

      if (res.ok) {
        toast.success(`Password successfully updated for ${resolvingReq.email}!`, { id: toastId });
        setResolvingReq(null);
        setNewStaffPassword('');
        loadResetRequests();
        loadStaff();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to update password', { id: toastId });
      }
    } catch (e: any) {
      toast.error(e.message || 'Error resolving request', { id: toastId });
    } finally {
      setIsResolving(false);
    }
  };

  const handleDismissReset = async (req: any) => {
    try {
      const res = await fetch('/api/staff/reset-requests', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          requestId: req.id,
          status: 'DISMISSED',
        })
      });
      if (res.ok) {
        toast.success('Request dismissed');
        loadResetRequests();
      }
    } catch {
      toast.error('Failed to dismiss request');
    }
  };

  // Auto-fill branch name when branch ID is selected
  const handleBranchSelect = (bid: string) => {
    setBranchId(bid);
    const match = branches.find(b => b.id === bid);
    setBranchName(match?.name || '');
  };

  const resetForm = () => {
    setEmail(''); setPassword(''); setBranchId(''); setBranchName(''); setRole('TELLER');
    setEditingUser(null); setShowPassword(false);
    setIsNewBranch(false); setNewBranchId(''); setNewBranchName('');
  };

  const openAdd = () => { resetForm(); setIsOpen(true); };

  const openEdit = (user: any) => {
    setEditingUser(user);
    setEmail(user.email || '');
    setPassword(''); // never pre-fill password
    setBranchId(user.branch_id || '');
    setBranchName(user.branch_name || '');
    setRole(user.role || 'TELLER');
    setIsOpen(true);
  };

  const handleSave = async () => {
    if (!email || (!editingUser && !password)) {
      toast.error('Missing required fields', { description: 'Email and Password are required.' });
      return;
    }

    if (isNewBranch && (!newBranchId || !newBranchName)) {
      toast.error('Missing branch info', { description: 'Please enter ID and Name for the new branch.' });
      return;
    }

    if (!isNewBranch && !branchId) {
      toast.error('Missing branch', { description: 'Please select a branch.' });
      return;
    }

    setIsSaving(true);
    const toastId = toast.loading(editingUser ? 'Updating user account...' : 'Creating user account...');

    try {
      let finalBranchId = branchId;
      let finalBranchName = branchName;

      // Ensure branchName is captured from the branches list if missing
      if (!finalBranchName && finalBranchId) {
        const bMatch = branches.find(b => b.id === finalBranchId);
        if (bMatch) finalBranchName = bMatch.name;
      }

      // Handle New Branch Creation first
      if (isNewBranch) {
        console.log('Creating new branch:', { newBranchId, newBranchName });
        const bRes = await fetch('/api/branches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: newBranchId, name: newBranchName }),
        });
        if (!bRes.ok) {
          const bErr = await bRes.json();
          throw new Error(bErr.error || 'Failed to create new branch');
        }
        const bData = await bRes.json();
        finalBranchId = bData.id;
        finalBranchName = bData.name;
        loadBranches(); // refresh list in background
      }

      const url    = editingUser ? `/api/staff/${editingUser.id}` : '/api/staff';
      const method = editingUser ? 'PATCH' : 'POST';

      const body: any = { 
        email, 
        branchId: finalBranchId, 
        branchName: finalBranchName, 
        role 
      };
      if (password) body.password = password;

      console.log('Saving staff member:', body);
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to save');
      }

      toast.success(
        editingUser ? 'User account updated!' : 'User created! They can now log in immediately.',
        { id: toastId }
      );
      setIsOpen(false);
      resetForm();
      loadStaff();
    } catch (err: any) {
      toast.error('Error saving user', { description: err.message, id: toastId });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (user: any) => {
    if (!confirm(`Permanently delete "${user.email}"?\n\nThis will remove their login access immediately.`)) return;
    const toastId = toast.loading('Removing user account...');
    try {
      const res = await fetch(`/api/staff/${user.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      toast.success('User account removed successfully', { id: toastId });
      loadStaff();
    } catch (err: any) {
      toast.error('Could not delete user', { description: err.message, id: toastId });
    }
  };

  const roleColor = (r: string) => {
    if (r === 'ADMIN') return 'bg-indigo-100 text-indigo-700 border-indigo-200';
    if (r === 'AUDITOR') return 'bg-amber-100 text-amber-900 border-amber-300';
    if (r === 'MANAGER') return 'bg-purple-100 text-purple-800 border-purple-200';
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  };

  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-700">

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center glass p-8 rounded-2xl border-slate-200 shadow-xl gap-6">
        <div>
          <Badge className="bg-[#333533] text-[#ffd100] border-transparent mb-3 px-3 py-1 font-black uppercase tracking-widest text-[10px]">
            <ShieldCheck className="w-3.5 h-3.5 mr-1.5 text-[#ffd100]" /> Admin Only
          </Badge>
          <h1 className="text-4xl font-black text-[#202020] tracking-tighter leading-none mb-2">
            Staff <span className="text-gradient">Directory</span>
          </h1>
          <p className="text-slate-600 font-semibold">Manage branch accounts, passwords and access levels.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={handleRefresh}
            disabled={loading}
            className="h-12 px-5 border-[#d6d6d6] bg-white text-[#202020] hover:bg-slate-100 font-black text-[10px] uppercase tracking-widest rounded-xl gap-2 shadow-xs"
          >
            <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin text-[#ffd100]' : ''}`} />
            Refresh
          </Button>
          <Button
            onClick={openAdd}
            className="gap-2 bg-[#ffd100] hover:bg-[#ffee32] text-[#202020] h-14 px-8 font-black uppercase tracking-widest text-xs shadow-lg shadow-black/10 rounded-2xl border border-[#ffd100]"
          >
            <UserPlus className="h-4 w-4" /> Add User
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        {[
          { label: 'Total Users',  value: staff.length,                                              color: 'text-slate-900' },
          { label: 'Branches',     value: branches.length,                                           color: 'text-emerald-600' },
          { label: 'Admins',       value: staff.filter(s => s.role === 'ADMIN').length,              color: 'text-indigo-600' },
          { label: 'Managers',     value: staff.filter(s => s.role === 'MANAGER').length,            color: 'text-purple-600' },
          { label: 'Auditors',     value: staff.filter(s => s.role === 'AUDITOR').length,            color: 'text-amber-600' },
          { label: 'Reset Requests', value: resetRequests.filter(r => r.status === 'PENDING').length, color: 'text-rose-600' },
        ].map(s => (
          <div key={s.label} className="glass border-white/40 rounded-2xl p-6 shadow-lg">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{s.label}</p>
            <p className={`text-3xl font-black tracking-tighter ${s.color}`}>{loading ? '—' : s.value}</p>
          </div>
        ))}
      </div>

      {/* Pending Reset Requests Alert Banner */}
      {resetRequests.filter(r => r.status === 'PENDING').length > 0 && (
        <div className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-lg animate-in fade-in">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0 border border-amber-500/30">
              <KeyRound className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900">
                {resetRequests.filter(r => r.status === 'PENDING').length} Pending Password Reset Verification Request(s)
              </h3>
              <p className="text-xs text-slate-500 font-medium">
                Branch staff members have requested password assistance via the login portal.
              </p>
            </div>
          </div>
          <Button
            onClick={() => setActiveTab('requests')}
            className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs px-5 py-2.5 rounded-xl h-auto shrink-0 shadow-md"
          >
            Review & Reset Passwords
          </Button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
        <button
          onClick={() => setActiveTab('staff')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider transition-all cursor-pointer ${
            activeTab === 'staff'
              ? 'bg-[#ffd100] text-[#202020] shadow-md'
              : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Users className="w-4 h-4" /> All Staff Accounts ({staff.length})
        </button>

        <button
          onClick={() => setActiveTab('requests')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider transition-all cursor-pointer ${
            activeTab === 'requests'
              ? 'bg-[#ffd100] text-[#202020] shadow-md'
              : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <KeyRound className="w-4 h-4" /> Password Reset Requests
          {resetRequests.filter(r => r.status === 'PENDING').length > 0 && (
            <Badge className="bg-rose-500 text-white font-black text-[9px] px-2 py-0.5 rounded-full ml-1">
              {resetRequests.filter(r => r.status === 'PENDING').length}
            </Badge>
          )}
        </button>
      </div>

      {/* Dialog */}
      <Dialog open={isOpen} onOpenChange={(v) => { setIsOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="sm:max-w-[480px] glass border-white/40 p-0 max-h-[90dvh] flex flex-col gap-0 overflow-hidden rounded-[2rem]">
          <div className="h-2 bg-[#ffd100] shrink-0" />
          <div className="flex-1 min-h-0 overflow-y-auto p-6 sm:p-8 space-y-6 overscroll-contain">
            <DialogHeader className="pr-8">
              <DialogTitle className="text-2xl font-black tracking-tighter flex items-center gap-3">
                <UserPlus className="w-6 h-6 text-amber-600" />
                {editingUser ? 'Edit User Account' : 'Create New User'}
              </DialogTitle>
              <DialogDescription className="font-medium text-slate-500">
                {editingUser
                  ? 'Update credentials or branch assignment. Leave password blank to keep existing.'
                  : 'Create a new branch account. The user can log in immediately after creation.'}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-5">
              {/* Email */}
              <div className="grid gap-2">
                <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400 flex items-center gap-2">
                  <Mail className="w-3 h-3" /> Email Address
                </Label>
                <Input
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="branch.new@rupasinghe.com"
                  type="email"
                  className="h-12 bg-white/50 rounded-xl"
                />
              </div>

              {/* Password */}
              <div className="grid gap-2">
                <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400 flex items-center gap-2">
                  <Lock className="w-3 h-3" /> {editingUser ? 'New Password (leave blank to keep)' : 'Password'}
                </Label>
                <div className="relative">
                  <Input
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder={editingUser ? '••••••••' : 'Min 8 characters'}
                    type={showPassword ? 'text' : 'password'}
                    className="h-12 bg-white/50 rounded-xl pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Branch Assignment</Label>
                    {!editingUser && (
                      <Button 
                        variant="ghost" 
                        onClick={() => setIsNewBranch(!isNewBranch)} 
                        className="h-6 text-[9px] font-black uppercase text-primary hover:text-primary hover:bg-primary/5"
                      >
                        {isNewBranch ? "Select Existing" : "+ Create New Branch"}
                      </Button>
                    )}
                  </div>

                  {isNewBranch ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-in slide-in-from-top-2 duration-300">
                      <div className="grid gap-2">
                        <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Branch Name</Label>
                        <Input 
                          value={newBranchName} 
                          onChange={e => setNewBranchName(e.target.value)} 
                          placeholder="E.g. Kandana" 
                          className="h-12 bg-white/50 rounded-xl"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">ID (3 Letters)</Label>
                        <Input 
                          value={newBranchId} 
                          onChange={e => setNewBranchId(e.target.value.toUpperCase())} 
                          placeholder="KND" 
                          maxLength={10}
                          className="h-12 bg-white/50 rounded-xl"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col sm:grid sm:grid-cols-2 gap-4">
                      <div className="grid gap-2 min-w-0">
                        <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400 flex items-center gap-2">
                          <Building2 className="w-3 h-3" /> Select Branch
                        </Label>
                        <Select value={branchId} onValueChange={(v) => v && handleBranchSelect(v)}>
                          <SelectTrigger className="h-12 bg-white/50 rounded-xl font-bold text-sm w-full overflow-hidden min-w-0">
                            <SelectValue placeholder="Select branch" className="truncate" />
                          </SelectTrigger>
                          <SelectContent className="glass border-white/40 rounded-2xl shadow-2xl max-w-[90vw]">
                            {branches.map(b => (
                              <SelectItem key={b.id} value={b.id} className="font-bold whitespace-nowrap">
                                {b.name} ({b.id.length > 8 ? `${b.id.substring(0, 8)}...` : b.id})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2 min-w-0">
                        <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Role</Label>
                        <Select value={role} onValueChange={(v) => v && setRole(v)}>
                          <SelectTrigger className="h-12 bg-white/50 rounded-xl font-bold text-sm w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="glass border-white/40 rounded-2xl shadow-2xl">
                            {ROLES.map(r => (
                              <SelectItem key={r} value={r} className="font-bold">{r}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </div>

              {/* Branch name preview */}
              {branchName && (
                <div className="flex items-center gap-2 px-4 py-3 bg-primary/5 border border-primary/20 rounded-xl">
                  <Building2 className="w-4 h-4 text-primary shrink-0" />
                  <span className="text-primary font-black text-sm truncate pr-2">
                    Will be assigned to: <span className="font-black">{branchName}</span> ({branchId.length > 8 ? `${branchId.substring(0, 8)}...` : branchId})
                  </span>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
              <Button variant="ghost" className="font-bold text-slate-500 h-11 rounded-xl" onClick={() => setIsOpen(false)}>Cancel</Button>
              <Button
                disabled={isSaving}
                onClick={handleSave}
                className="bg-[#ffd100] hover:bg-[#ffee32] text-[#202020] font-black px-8 h-11 rounded-xl shadow-lg shadow-black/10 gap-2"
              >
                {isSaving ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                {isSaving ? 'Saving...' : (editingUser ? 'Update Account' : 'Create Account')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Content depending on Active Tab */}
      {activeTab === 'staff' ? (
        <div className="glass border-white/40 rounded-[2.5rem] shadow-2xl overflow-hidden bg-white/40">
          <div className="px-6 py-5 border-b border-slate-100 flex items-center gap-3">
            <Users className="w-5 h-5 text-amber-600" />
            <h2 className="font-black text-slate-800 tracking-tighter text-lg">All User Accounts</h2>
            <Badge className="ml-auto bg-amber-100 text-amber-900 border-amber-200 font-black text-[10px] uppercase tracking-widest">
              {staff.length} total
            </Badge>
          </div>
          <Table>
            <TableHeader className="bg-slate-50/50">
              <TableRow>
                <TableHead className="px-5 py-4 font-black text-[10px] uppercase tracking-widest text-slate-400">Email</TableHead>
                <TableHead className="px-4 py-4 font-black text-[10px] uppercase tracking-widest text-slate-400">Branch</TableHead>
                <TableHead className="px-4 py-4 font-black text-[10px] uppercase tracking-widest text-slate-400">Branch ID</TableHead>
                <TableHead className="px-4 py-4 font-black text-[10px] uppercase tracking-widest text-slate-400">Role</TableHead>
                <TableHead className="px-4 py-4 font-black text-[10px] uppercase tracking-widest text-slate-400">Last Login</TableHead>
                <TableHead className="px-4 py-4" />
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-slate-50">
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-64 text-center font-black text-slate-300 animate-pulse tracking-widest uppercase">
                    Loading user accounts...
                  </TableCell>
                </TableRow>
              ) : staff.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-64 text-center">
                    <div className="flex flex-col items-center gap-4">
                      <Users className="h-12 w-12 text-slate-200" />
                      <p className="text-slate-400 font-bold">No user accounts found.</p>
                      <p className="text-slate-300 text-sm">Run the seed API or create your first user.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                staff.map(user => (
                  <TableRow key={user.id} className="group hover:bg-primary/5 transition-all duration-300">
                    <TableCell className="px-8 py-5">
                      <div className="flex flex-col">
                        <span className="font-black text-slate-900 group-hover:text-primary transition-colors text-sm">
                          {user.email}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="px-8 py-5 font-bold text-slate-700">
                      {user.role === 'ADMIN' ? (
                        <span className="text-indigo-600 font-bold flex items-center gap-1.5">
                          <ShieldCheck className="w-3.5 h-3.5" /> All Branches (Admin)
                        </span>
                      ) : user.role === 'AUDITOR' ? (
                        <div className="flex flex-col">
                          <span className="text-amber-800 font-bold flex items-center gap-1">
                            <ShieldCheck className="w-3.5 h-3.5 text-amber-600" /> {user.branch_name || 'Assigned Branch'}
                          </span>
                          <span className="text-[10px] text-amber-600/70 font-semibold">Branch Auditor</span>
                        </div>
                      ) : user.role === 'MANAGER' ? (
                        <div className="flex flex-col">
                          <span className="text-purple-800 font-bold flex items-center gap-1">
                            <ShieldCheck className="w-3.5 h-3.5 text-purple-600" /> {user.branch_name || 'Assigned Branch'}
                          </span>
                          <span className="text-[10px] text-purple-600/70 font-semibold">Branch Manager</span>
                        </div>
                      ) : (
                        <div className="flex flex-col">
                          <span className="text-slate-900 font-bold">{user.branch_name || 'Operating Branch'}</span>
                          <span className="text-[10px] text-slate-400 font-medium">Counter Staff</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="px-8 py-5">
                      <span className="font-black text-xs bg-slate-100 text-slate-600 px-3 py-1 rounded-lg tracking-widest" title={user.branch_id}>
                        {user.role === 'ADMIN' ? 'ALL' : ((user.branch_id && user.branch_id.length > 8) ? `${user.branch_id.substring(0, 8)}...` : (user.branch_id || 'BRANCH'))}
                      </span>
                    </TableCell>
                    <TableCell className="px-8 py-5">
                      <Badge className={`font-black text-[9px] uppercase tracking-widest px-3 border ${roleColor(user.role)}`}>
                        {user.role || 'TELLER'}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-8 py-5 text-slate-400 font-bold text-xs uppercase tracking-widest">
                      {user.lastSignIn
                        ? new Date(user.lastSignIn).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                        : 'Never'}
                    </TableCell>
                    <TableCell className="px-8 py-5">
                      <div className="flex items-center gap-2 justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(user)}
                          className="h-9 w-9 p-0 rounded-xl hover:bg-primary/10 hover:text-primary"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(user)}
                          className="h-9 w-9 p-0 rounded-xl hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      ) : (
        /* Password Reset Requests Tab */
        <div className="glass border-white/40 rounded-[2.5rem] shadow-2xl overflow-hidden bg-white/40">
          <div className="px-8 py-6 border-b border-slate-100 flex items-center gap-3">
            <KeyRound className="w-5 h-5 text-amber-500" />
            <h2 className="font-black text-slate-800 tracking-tighter text-lg">Staff Password Reset Requests</h2>
            <Badge className="ml-auto bg-amber-500/10 text-amber-600 border-amber-500/20 font-black text-[10px] uppercase tracking-widest">
              {resetRequests.length} total
            </Badge>
          </div>
          <Table>
            <TableHeader className="bg-slate-50/50">
              <TableRow>
                <TableHead className="px-8 py-5 font-black text-[10px] uppercase tracking-widest text-slate-400">Staff Email</TableHead>
                <TableHead className="px-8 py-5 font-black text-[10px] uppercase tracking-widest text-slate-400">Branch</TableHead>
                <TableHead className="px-8 py-5 font-black text-[10px] uppercase tracking-widest text-slate-400">Requested Date</TableHead>
                <TableHead className="px-8 py-5 font-black text-[10px] uppercase tracking-widest text-slate-400">Status</TableHead>
                <TableHead className="px-8 py-5 font-black text-[10px] uppercase tracking-widest text-slate-400 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-slate-50">
              {resetRequests.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-64 text-center">
                    <div className="flex flex-col items-center gap-4">
                      <CheckCircle2 className="h-12 w-12 text-emerald-400" />
                      <p className="text-slate-700 font-bold">No password reset requests pending!</p>
                      <p className="text-slate-400 text-sm">When branch staff use "Forgot Password" on login, verification requests will appear here.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                resetRequests.map(req => (
                  <TableRow key={req.id} className="group hover:bg-amber-50/20 transition-all duration-300">
                    <TableCell className="px-8 py-5">
                      <div className="flex flex-col">
                        <span className="font-black text-slate-900 text-sm">{req.email}</span>
                        {req.note && <span className="text-[11px] text-slate-400 mt-0.5">{req.note}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="px-8 py-5 font-bold text-slate-700">
                      <span className="font-black text-xs bg-slate-100 text-slate-700 px-3 py-1 rounded-lg">
                        {req.branchId}
                      </span>
                    </TableCell>
                    <TableCell className="px-8 py-5 text-slate-500 font-medium text-xs">
                      {req.requestedAt
                        ? new Date(req.requestedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                        : '—'}
                    </TableCell>
                    <TableCell className="px-8 py-5">
                      {req.status === 'PENDING' ? (
                        <Badge className="bg-amber-100 text-amber-800 border-amber-300 font-black text-[9px] uppercase tracking-widest px-2.5 py-1">
                          <Clock className="w-3 h-3 mr-1" /> Pending Verification
                        </Badge>
                      ) : req.status === 'RESOLVED' ? (
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-black text-[9px] uppercase tracking-widest px-2.5 py-1">
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Resolved
                        </Badge>
                      ) : (
                        <Badge className="bg-slate-100 text-slate-600 border-slate-200 font-black text-[9px] uppercase tracking-widest px-2.5 py-1">
                          {req.status}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="px-8 py-5 text-right">
                      <div className="flex items-center gap-2 justify-end">
                        {req.status === 'PENDING' && (
                          <>
                            <Button
                              size="sm"
                              onClick={() => {
                                setResolvingReq(req);
                                setNewStaffPassword('');
                              }}
                              className="bg-[#ffd100] hover:bg-[#ffee32] text-slate-950 font-black text-xs h-9 px-4 rounded-xl gap-1.5 shadow-sm"
                            >
                              <KeyRound className="w-3.5 h-3.5" /> Verify & Reset
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDismissReset(req)}
                              className="h-9 px-3 rounded-xl text-slate-400 hover:text-slate-600 font-bold text-xs"
                            >
                              Dismiss
                            </Button>
                          </>
                        )}
                        {req.status !== 'PENDING' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setResolvingReq(req);
                              setNewStaffPassword('');
                            }}
                            className="h-9 px-3 rounded-xl text-primary font-bold text-xs hover:bg-primary/10"
                          >
                            Update Again
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Password Reset Resolution Modal */}
      <Dialog open={!!resolvingReq} onOpenChange={(v) => { if (!v) { setResolvingReq(null); setNewStaffPassword(''); } }}>
        <DialogContent className="sm:max-w-[450px] glass border-white/40 p-0 max-h-[90dvh] flex flex-col gap-0 overflow-hidden rounded-[2rem]">
          <div className="h-2 bg-[#ffd100] shrink-0" />
          <div className="flex-1 min-h-0 overflow-y-auto p-6 sm:p-8 space-y-6 overscroll-contain">
            <DialogHeader className="pr-8">
              <DialogTitle className="text-xl font-black tracking-tighter flex items-center gap-2.5">
                <KeyRound className="w-5 h-5 text-[#ffd100]" />
                Reset Password for Staff
              </DialogTitle>
              <DialogDescription className="font-medium text-slate-500">
                Enter a new password for <strong className="text-slate-800 font-bold">{resolvingReq?.email}</strong>. The staff member will be able to log in immediately.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
                <div className="text-xs text-slate-400 font-bold uppercase tracking-wider">Account Info</div>
                <div className="text-sm font-black text-slate-800">{resolvingReq?.email}</div>
                <div className="text-xs text-slate-500">Branch: <span className="font-bold">{resolvingReq?.branchId}</span></div>
              </div>

              <div className="grid gap-2">
                <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400 flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5" /> New Password
                </Label>
                <div className="relative">
                  <Input
                    value={newStaffPassword}
                    onChange={e => setNewStaffPassword(e.target.value)}
                    placeholder="Enter new password (min. 6 chars)"
                    type={showResolvePw ? 'text' : 'password'}
                    className="h-12 bg-white/50 rounded-xl pr-12 font-medium"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResolvePw(!showResolvePw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors"
                  >
                    {showResolvePw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
              <Button
                variant="ghost"
                className="font-bold text-slate-500 h-11 rounded-xl"
                onClick={() => { setResolvingReq(null); setNewStaffPassword(''); }}
              >
                Cancel
              </Button>
              <Button
                disabled={isResolving}
                onClick={handleResolveReset}
                className="bg-[#ffd100] hover:bg-[#ffee32] text-slate-950 font-black px-6 h-11 rounded-xl shadow-lg shadow-black/10 gap-2"
              >
                {isResolving ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {isResolving ? 'Updating...' : 'Set & Approve Password'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
