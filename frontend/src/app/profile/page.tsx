'use client';

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { 
  UserCircle, 
  Pencil, 
  Camera, 
  Building2, 
  Mail, 
  Phone, 
  User, 
  Loader2, 
  CheckCircle2,
  AlertCircle
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function ProfilePage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isSupportOpen, setIsSupportOpen] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    email: ''
  });

  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    setLoading(true);
    try {
      const storedUser = localStorage.getItem('user');
      if (!storedUser) { setLoading(false); return; }

      const parsedUser = JSON.parse(storedUser);

      // Helper: build a display name from the stored email when DB has no name columns
      const nameFromEmail = (email: string = '') => {
        const local = email.split('@')[0].replace(/[._\-]/g, ' ');
        return local.charAt(0).toUpperCase() + local.slice(1);
      };

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', parsedUser.id)
        .single();

      if (error) {
        // PGRST116 = no rows returned — profile row not yet created, use localStorage
        if (error.code === 'PGRST116') {
          const fallbackName = parsedUser.firstName || parsedUser.first_name
            || nameFromEmail(parsedUser.email) || '';
          const merged = {
            ...parsedUser,
            first_name: fallbackName,
            last_name:  parsedUser.lastName || parsedUser.last_name || '',
          };
          setUser(merged);
          setFormData({
            first_name: merged.first_name,
            last_name:  merged.last_name,
            phone:      parsedUser.phone || '',
            email:      parsedUser.email || '',
          });
          return;
        }

        // Schema/column mismatch — log and fall through to localStorage
        if (error.message?.includes('column') || error.message?.includes('schema')) {
          console.warn('Profile schema mismatch — using localStorage fallback:', error.message);
          const fallbackName = parsedUser.firstName || parsedUser.first_name
            || nameFromEmail(parsedUser.email) || '';
          setUser({ ...parsedUser, first_name: fallbackName });
          setFormData({
            first_name: fallbackName,
            last_name:  parsedUser.lastName || parsedUser.last_name || '',
            phone:      parsedUser.phone || '',
            email:      parsedUser.email || '',
          });
          return;
        }

        // Any other error — log but still show localStorage data
        console.warn('Profile fetch error (non-fatal):', error.message || error);
        setUser(parsedUser);
        setFormData({
          first_name: parsedUser.firstName || parsedUser.first_name || nameFromEmail(parsedUser.email),
          last_name:  parsedUser.lastName  || parsedUser.last_name  || '',
          phone:      parsedUser.phone || '',
          email:      parsedUser.email || '',
        });
        return;
      }

      if (data) {
        // Merge DB data — derive name from email if DB columns are missing
        const first = data.first_name || parsedUser.firstName || parsedUser.first_name
          || nameFromEmail(data.email || parsedUser.email) || '';
        const last  = data.last_name  || parsedUser.lastName  || parsedUser.last_name  || '';
        const merged = { ...parsedUser, ...data, first_name: first, last_name: last };
        setUser(merged);
        setFormData({
          first_name: first,
          last_name:  last,
          phone:      data.phone || parsedUser.phone || '',
          email:      data.email || parsedUser.email || '',
        });
        localStorage.setItem('user', JSON.stringify({
          ...merged,
          firstName: first,
          lastName:  last,
        }));
      }
    } catch (err: any) {
      // Unexpected JS error (network, JSON parse, etc.)
      console.warn('fetchProfile unexpected error:', err?.message || err);
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        try {
          const p = JSON.parse(storedUser);
          setUser(p);
          setFormData({
            first_name: p.firstName || p.first_name || '',
            last_name:  p.lastName  || p.last_name  || '',
            phone:      p.phone || '',
            email:      p.email || '',
          });
        } catch (_) { /* ignore */ }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }

    setUpdating(true);
    const toastId = toast.loading('Uploading photo...');

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}-${Math.random()}.${fileExt}`;
      const filePath = `avatars/${fileName}`;

      // 1. Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file);

      if (uploadError) {
        if (uploadError.message.includes('bucket not found')) {
          throw new Error('Storage bucket "avatars" not found. Please create it in Supabase.');
        }
        throw uploadError;
      }

      // 2. Get Public URL
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      // 3. Upsert into profiles table
      const { error: updateError } = await supabase
        .from('profiles')
        .upsert({ 
          id: user.id,
          avatar_url: publicUrl,
          updated_at: new Date().toISOString()
        });

      if (updateError) throw updateError;

      // 4. Update local state
      setUser({ ...user, avatar_url: publicUrl });
      
      // Update localStorage
      const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
      localStorage.setItem('user', JSON.stringify({ ...storedUser, avatar_url: publicUrl }));

      toast.success('Profile picture updated successfully!', { id: toastId });
      
      // Force sidebar refresh
      window.dispatchEvent(new Event('storage'));
    } catch (error: any) {
      console.error('Avatar upload error:', error);
      const msg = error.message?.includes('column') ? 'Database Error: missing avatar_url column.' : 'Failed to upload photo';
      toast.error(msg, { id: toastId });
    } finally {
      setUpdating(false);
    }
  };

  const handleSaveProfile = async () => {
    setUpdating(true);
    const toastId = toast.loading('Saving profile changes...');

    try {
      const { error } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          first_name: formData.first_name,
          last_name: formData.last_name,
          phone: formData.phone,
          updated_at: new Date().toISOString()
        });

      if (error) throw error;

      const newUser = { 
        ...user, 
        first_name: formData.first_name, 
        last_name: formData.last_name, 
        phone: formData.phone 
      };
      
      setUser(newUser);

      // Update localStorage
      const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
      localStorage.setItem('user', JSON.stringify({ 
        ...storedUser, 
        ...newUser,
        firstName: formData.first_name, // fallback for legacy code
        lastName: formData.last_name
      }));

      toast.success('Profile updated successfully!', { id: toastId });
      setIsEditMode(false);
      
      // Force sidebar refresh
      window.dispatchEvent(new Event('storage'));
    } catch (error: any) {
      console.error('Profile update error:', error);
      const errorMsg = error.message?.includes('column') 
        ? 'Database Error: Missing columns. Please run the SQL migration.' 
        : 'Failed to save profile changes';
      toast.error(errorMsg, { id: toastId });
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="h-10 w-10 text-primary animate-spin" />
        <p className="text-slate-500 font-bold animate-pulse uppercase tracking-widest text-xs">Synchronizing Profile...</p>
      </div>
    );
  }

  const initials = `${(user?.first_name || 'U')[0]}${(user?.last_name || '?')[0]}`.toUpperCase();

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-12">
      {/* Header with Glassmorphism */}
      <div className="relative overflow-hidden rounded-[2.5rem] p-8 border border-[#d6d6d6] bg-white shadow-xl group">
        <div className="absolute top-0 right-0 -mt-20 -mr-20 w-64 h-64 bg-[#ffd100]/10 rounded-full blur-3xl group-hover:bg-[#ffd100]/20 transition-all duration-1000" />
        <div className="absolute bottom-0 left-0 -mb-20 -ml-20 w-64 h-64 bg-[#333533]/5 rounded-full blur-3xl group-hover:bg-[#333533]/10 transition-all duration-1000" />
        
        <div className="relative flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex flex-col md:flex-row items-center gap-8 text-center md:text-left">
            {/* Avatar Section */}
            <div className="relative">
              <div className="h-36 w-36 rounded-[3rem] bg-[#202020] border-4 border-white shadow-2xl overflow-hidden flex items-center justify-center transition-transform hover:scale-105 duration-500 ring-4 ring-[#ffd100]/30">
                {user?.avatar_url ? (
                  <img src={user.avatar_url} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-5xl font-black text-[#ffd100] tracking-tighter">{initials}</span>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 justify-center md:justify-start">
                <h1 className="text-5xl font-black text-[#202020] tracking-tighter leading-none">
                  {user?.first_name ? `${user.first_name} ${user.last_name || ''}` : 'Your Profile'}
                </h1>
                <Badge className={cn(
                  "px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border-0",
                  user?.role === 'ADMIN' ? "bg-[#333533] text-[#ffd100] shadow-sm" : "bg-[#ffd100] text-[#202020] shadow-sm"
                )}>
                  {user?.role || 'Staff Member'}
                </Badge>
              </div>
              
              <div className="flex flex-col gap-2 text-slate-600 font-bold text-sm">
                <p className="flex items-center gap-2 justify-center md:justify-start">
                  <Mail className="h-4 w-4 text-amber-600" />
                  {user?.email}
                </p>
                <div className="flex items-center gap-4 justify-center md:justify-start">
                  <p className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-amber-600" />
                    {user?.branch_name || 'Main Branch'}
                  </p>
                  <p className="px-2 py-0.5 bg-slate-100 rounded text-[10px] text-slate-500">ID: {user?.id?.slice(0, 8)}...</p>
                </div>
              </div>
            </div>
          </div>

          <Button 
            onClick={() => setIsEditMode(true)}
            className="rounded-[1.5rem] px-8 h-14 gap-3 bg-[#ffd100] hover:bg-[#ffee32] text-[#202020] font-black shadow-lg transition-all active:scale-95 group border border-[#ffd100]"
          >
            <Pencil className="h-5 w-5 group-hover:rotate-12 transition-transform" /> 
            Edit Details
          </Button>
        </div>
      </div>

      {/* Info Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <Card className="rounded-[2rem] border-slate-100 shadow-xl shadow-slate-200/40 overflow-hidden bg-white">
            <CardHeader className="bg-slate-50/50 border-b border-slate-100 p-6 sm:p-8">
              <CardTitle className="flex items-center gap-3 text-xl font-black tracking-tight uppercase text-slate-900">
                <div className="h-10 w-10 rounded-xl bg-amber-100 flex items-center justify-center">
                  <User className="h-5 w-5 text-amber-700" />
                </div>
                Personal Profile
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 sm:p-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-1.5 group">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest group-hover:text-amber-700 transition-colors">First Name</p>
                  <p className="text-xl font-extrabold text-slate-700">{user?.first_name || 'Not Set'}</p>
                </div>
                <div className="space-y-1.5 group">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest group-hover:text-amber-700 transition-colors">Last Name</p>
                  <p className="text-xl font-extrabold text-slate-700">{user?.last_name || 'Not Set'}</p>
                </div>
                <div className="space-y-1.5 group">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest group-hover:text-amber-700 transition-colors">Phone Number</p>
                  <p className="text-xl font-extrabold text-slate-700">{user?.phone || 'Not Set'}</p>
                </div>
                <div className="space-y-1.5 opacity-70">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Account Email</p>
                  <p className="text-xl font-extrabold text-slate-700 break-all">{user?.email}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-8">
          <Card className="rounded-[2rem] border-slate-100 shadow-xl shadow-slate-200/40 overflow-hidden bg-white group cursor-pointer" onClick={() => setIsSupportOpen(true)}>
            <CardContent className="p-8 flex flex-col items-center justify-center text-center gap-6">
              <div className="relative">
                <div className="h-20 w-20 rounded-[1.75rem] bg-amber-100 flex items-center justify-center">
                  <AlertCircle className="h-10 w-10 text-amber-700" />
                </div>
                <div className="absolute -top-1.5 -right-1.5 h-5 w-5 bg-red-500 rounded-full border-4 border-white" />
              </div>
              <div className="space-y-2">
                <h3 className="text-2xl font-black tracking-tighter text-slate-900 uppercase">Need Help?</h3>
                <p className="text-slate-500 font-bold text-sm px-2 leading-relaxed">
                  Branch issues or technical trouble? Our IT team is ready to help you.
                </p>
              </div>
              <Button 
                variant="outline" 
                className="w-full rounded-2xl h-12 font-black border-2 border-amber-300 text-slate-900 hover:bg-[#ffd100] hover:text-[#202020] hover:border-[#ffd100] transition-all active:scale-95 group shadow-md text-base"
              >
                Contact Support
                <Phone className="ml-2.5 h-4 w-4 group-hover:rotate-12 transition-transform" />
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── EDIT PROFILE MODAL ── */}
      <Dialog open={isEditMode} onOpenChange={setIsEditMode}>
        <DialogContent className="sm:max-w-lg rounded-[2rem] p-0 max-h-[90dvh] flex flex-col gap-0 overflow-hidden border border-slate-200 shadow-2xl bg-white/95 backdrop-blur-3xl animate-in zoom-in-95 duration-300">
          <div className="bg-[#ffd100] h-2 w-full shrink-0" />
          
          <div className="flex-1 min-h-0 overflow-y-auto p-6 sm:p-8 space-y-6 overscroll-contain">
            <div className="flex justify-between items-start pr-8">
              <div className="space-y-1">
                <h1 className="text-2xl font-black text-slate-900 tracking-tighter">Edit Profile</h1>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Personal Identification</p>
              </div>
              <div className="h-11 w-11 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center shadow-sm">
                <Pencil className="h-5 w-5 text-amber-700" />
              </div>
            </div>

            {/* Avatar centered in modal */}
            <div className="flex flex-col items-center gap-3 py-1">
              <div className="relative group cursor-pointer" onClick={() => fileRef.current?.click()}>
                <div className="h-28 w-28 rounded-[2rem] bg-slate-900 border-4 border-white shadow-xl overflow-hidden flex items-center justify-center group-hover:scale-105 transition-all duration-500">
                  {user?.avatar_url ? (
                    <img src={user.avatar_url} alt="Profile" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-4xl font-black text-[#ffd100]">{initials}</span>
                  )}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all duration-300">
                    <Camera className="h-8 w-8 text-white scale-90 group-hover:scale-100 transition-transform" />
                  </div>
                </div>
                <div className="absolute -bottom-2 -right-2 bg-[#ffd100] text-[#202020] rounded-xl p-2.5 shadow-lg group-hover:scale-110 transition-all border border-white">
                  <Camera className="h-4 w-4" />
                </div>
              </div>
              <div className="text-center">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Change Profile Photo</p>
                <p className="text-[9px] font-bold text-slate-300 mt-0.5 italic">Storage managed by Supabase</p>
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
            </div>

            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">First Name</Label>
                  <Input 
                    value={formData.first_name}
                    onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                    className="h-14 px-5 rounded-[1.25rem] bg-slate-50 border-slate-100 font-bold focus:bg-white focus:ring-4 focus:ring-primary/5 transition-all text-lg"
                    placeholder="Enter first name"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Last Name</Label>
                  <Input 
                    value={formData.last_name}
                    onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                    className="h-14 px-5 rounded-[1.25rem] bg-slate-50 border-slate-100 font-bold focus:bg-white focus:ring-4 focus:ring-primary/5 transition-all text-lg"
                    placeholder="Enter last name"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Phone Number</Label>
                <div className="relative">
                  <Input 
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="h-14 px-5 rounded-[1.25rem] bg-slate-50 border-slate-100 font-bold focus:bg-white focus:ring-4 focus:ring-primary/5 transition-all text-lg pl-12"
                    placeholder="077 000 0000"
                  />
                  <Phone className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-300" />
                </div>
              </div>
            </div>

            <div className="pt-4 flex gap-3 border-t border-slate-100">
              <DialogClose render={<Button variant="outline" className="flex-1 h-12 rounded-xl font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition-all" />}>
                Cancel
              </DialogClose>
              <Button 
                onClick={handleSaveProfile}
                disabled={updating}
                className="flex-[2] h-12 rounded-xl bg-[#ffd100] hover:bg-[#ffee32] text-[#202020] font-black shadow-lg transition-all active:scale-95 text-sm"
              >
                {updating ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <CheckCircle2 className="h-5 w-5 mr-2" />}
                Save Changes
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── SUPPORT MODAL ── */}
      <Dialog open={isSupportOpen} onOpenChange={setIsSupportOpen}>
        <DialogContent className="sm:max-w-md rounded-[2rem] border border-slate-200 bg-white/95 backdrop-blur-3xl shadow-2xl p-0 max-h-[90dvh] flex flex-col gap-0 overflow-hidden">
          <div className="bg-[#ffd100] h-2 shrink-0" />
          <div className="flex-1 min-h-0 overflow-y-auto p-6 sm:p-8 text-center space-y-6 overscroll-contain">
            <div className="flex justify-center">
              <div className="h-20 w-20 rounded-[1.75rem] bg-amber-100 flex items-center justify-center">
                <Phone className="h-9 w-9 text-amber-700" />
              </div>
            </div>
            
            <div className="space-y-1">
              <h2 className="text-xs font-black text-slate-400 uppercase tracking-[0.3em]">Official Support</h2>
              <h1 className="text-3xl font-black text-slate-900 tracking-tighter leading-none">Vork.Global</h1>
            </div>

            <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col items-center gap-2 group transition-all duration-500 shadow-xl">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Contact Hotline</p>
              <p className="text-3xl sm:text-4xl font-black text-white tracking-tighter group-hover:text-[#ffd100] transition-colors">0775088850</p>
            </div>

            <p className="text-sm font-semibold text-slate-500 px-2 leading-relaxed">
              Our technical engineering team is available 24/7 to ensure seamless branch operations.
            </p>

            <Button 
              onClick={() => setIsSupportOpen(false)}
              className="w-full h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 font-black text-xs uppercase tracking-widest transition-all active:scale-95"
            >
              Close Hub
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
