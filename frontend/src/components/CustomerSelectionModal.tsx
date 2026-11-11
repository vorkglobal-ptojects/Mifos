'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { 
  Search, UserCheck, UserPlus, Camera, CameraOff, Check, AlertTriangle, 
  RefreshCcw, ArrowRight, User, Phone, MapPin, CreditCard, ShieldCheck,
  Upload, ZoomIn
} from 'lucide-react';
import { toast } from 'sonner';
import { getAuthHeaders } from '@/lib/getAuthHeaders';
import { normalizeBranchId, stripBranchPrefix, normalizeNationalId } from '@/lib/branch-mapping';
import { SmartNicScanner } from './SmartNicScanner';
import { compressImage } from '@/lib/image-compression';

export interface SelectedCustomerData {
  id: string;
  nic: string;
  name: string;
  phone: string;
  address: string;
  nicImage?: string | null;
  signatureImage?: string | null;
}

interface CustomerSelectionModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  clientsList: any[];
  branchId: string;
  onCustomerSelected: (customer: SelectedCustomerData) => void;
  evaluationSummary?: {
    airWeight?: number;
    waterWeight?: number;
    specificGravity?: number;
    estimatedKarat?: string;
    trueValue?: number;
    askingAmount?: number;
  };
}

export function CustomerSelectionModal({
  isOpen,
  onOpenChange,
  clientsList,
  branchId,
  onCustomerSelected,
  evaluationSummary
}: CustomerSelectionModalProps) {
  const [mode, setMode] = useState<'EXISTING' | 'NEW'>('EXISTING');

  // Existing customer search state
  const [searchNic, setSearchNic] = useState('');
  const [selectedExistingClient, setSelectedExistingClient] = useState<any | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // New customer registration form state
  const [newNic, setNewNic] = useState('');
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newAddress, setNewAddress] = useState('');

  // KYC Camera state
  const [activeKycTab, setActiveKycTab] = useState<'front' | 'back' | 'sign'>('front');
  const [kycFront, setKycFront] = useState<string | null>(null);
  const [kycBack, setKycBack] = useState<string | null>(null);
  const [kycSign, setKycSign] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [activeClients, setActiveClients] = useState<any[]>(clientsList || []);
  const [previewPhotoZoom, setPreviewPhotoZoom] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Synchronize clients list from props
  useEffect(() => {
    if (clientsList && clientsList.length > 0) {
      setActiveClients(clientsList);
    }
  }, [clientsList]);

  // Ensure freshest client directory across all branches when modal opens
  useEffect(() => {
    if (isOpen) {
      fetch('/api/clients?branchId=ALL&minimal=true&fresh=true', { headers: getAuthHeaders() })
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) {
            setActiveClients(data);
          }
        })
        .catch(err => console.error('Error refreshing client list for cross-check:', err));
    }
  }, [isOpen]);

  // Live on-demand server search if typed search is not found in local cache
  useEffect(() => {
    const q = searchNic.trim();
    if (!q || q.length < 3) return;
    const timer = setTimeout(async () => {
      try {
        const headers = getAuthHeaders();
        const res = await fetch(`/api/clients?search=${encodeURIComponent(q)}&minimal=true&fresh=true`, { headers });
        if (res.ok) {
          const results = await res.json();
          if (Array.isArray(results) && results.length > 0) {
            setActiveClients(prev => {
              const existingIds = new Set(prev.map(c => c.id));
              const newMatches = results.filter((r: any) => !existingIds.has(r.id));
              return newMatches.length > 0 ? [...newMatches, ...prev] : prev;
            });
          }
        }
      } catch (err) {
        console.warn('Live modal client search notice:', err);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchNic]);

  // Reset or initialize on open
  useEffect(() => {
    if (isOpen) {
      setMode('EXISTING');
      setSearchNic('');
      setSelectedExistingClient(null);
      setIsDropdownOpen(false);
      setNewNic('');
      setNewName('');
      setNewPhone('');
      setNewAddress('');
      setKycFront(null);
      setKycBack(null);
      setKycSign(null);
      setActiveKycTab('front');
      stopCamera();
    } else {
      stopCamera();
    }
  }, [isOpen]);

  // Clean up camera on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Guarantee that when video element mounts and camera is active, stream is attached and playing
  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(e => console.warn('Video play notice:', e));
    }
  }, [cameraActive]);

  const startCamera = async () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      setCameraError(null);
      
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
        });
      } catch {
        // Fallback for laptops/desktops without environment camera
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }

      streamRef.current = stream;
      setCameraActive(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
    } catch (err: any) {
      console.error('Camera access error:', err);
      setCameraError('Camera access denied or unavailable. You can also upload a photo file.');
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const handleCaptureCurrentTab = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
      if (activeKycTab === 'front') setKycFront(dataUrl);
      else if (activeKycTab === 'back') setKycBack(dataUrl);
      else setKycSign(dataUrl);
    }
    stopCamera();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      compressImage(file).then((dataUrl) => {
        if (dataUrl) {
          if (activeKycTab === 'front') setKycFront(dataUrl);
          else if (activeKycTab === 'back') setKycBack(dataUrl);
          else setKycSign(dataUrl);
        }
      });
    }
  };

  const currentCapturedPhoto = activeKycTab === 'front' ? kycFront : activeKycTab === 'back' ? kycBack : kycSign;

  // Filter matching existing clients by typed NIC, phone, or name
  const matchingClients = searchNic.trim()
    ? activeClients.filter(c => {
        const rawNic = String(c.national_id || c.nationalId || c.nic || c.id || '').toLowerCase();
        const cleanNic = stripBranchPrefix(rawNic).toLowerCase();
        const rawNicDigits = rawNic.replace(/[^a-z0-9]/g, '');
        const cleanNicDigits = cleanNic.replace(/[^a-z0-9]/g, '');
        const rawNicNumbers = rawNic.replace(/\D/g, '');
        const cleanNicNumbers = cleanNic.replace(/\D/g, '');
        const name = `${c.first_name || c.firstName || ''} ${c.last_name || c.lastName || ''}`.toLowerCase();
        const altName = String(c.name || '').toLowerCase();
        const phone = String(c.phone || c.mobile || '').replace(/\D/g, '');
        const rawPhone = String(c.phone || c.mobile || '').toLowerCase();
        const q = searchNic.toLowerCase().trim();
        const cleanQ = stripBranchPrefix(q).toLowerCase();
        const qDigits = q.replace(/[^a-z0-9]/g, '');
        const qNumbers = q.replace(/\D/g, '');
        const qWords = q.split(/\s+/).filter(Boolean);

        const wordsMatch = qWords.length > 1 && qWords.every(w =>
          name.includes(w) ||
          altName.includes(w) ||
          rawNic.includes(w) ||
          cleanNic.includes(w) ||
          phone.includes(w)
        );

        return (
          wordsMatch ||
          rawNic.includes(q) ||
          cleanNic.includes(cleanQ) ||
          (qDigits.length >= 3 && (rawNicDigits.includes(qDigits) || cleanNicDigits.includes(qDigits) || qDigits.includes(rawNicDigits) || qDigits.includes(cleanNicDigits))) ||
          (qNumbers.length >= 3 && (rawNicNumbers.includes(qNumbers) || cleanNicNumbers.includes(qNumbers))) ||
          name.includes(q) ||
          altName.includes(q) ||
          rawPhone.includes(q) ||
          (phone && qNumbers.length >= 3 && phone.includes(qNumbers))
        );
      })
    : [];

  // Real-time duplicate cross-check against database when adding new customer details
  // In Sri Lanka pawning, NIC is the unique primary citizen identity.
  // Phone numbers can be legitimately shared (e.g., family members, spouses) and must NOT
  // hijack the customer identity or block registration of a distinct citizen.
  const normalizedNewNic = normalizeNationalId(newNic.trim()).toLowerCase();
  const cleanNewNic = stripBranchPrefix(normalizedNewNic).toLowerCase();
  const newNicDigits = normalizedNewNic.replace(/[^a-z0-9]/g, '');
  const normalizedNewPhone = newPhone.replace(/\D/g, '');

  const existingCustomerMatch = normalizedNewNic.length >= 3
    ? activeClients.find(c => {
        const cNic = String(c.national_id || c.nationalId || c.nic || c.id || '').trim().toLowerCase();
        const cleanCNic = stripBranchPrefix(cNic).toLowerCase();
        const cNicDigits = cNic.replace(/[^a-z0-9]/g, '');
        const cleanCDigits = cleanCNic.replace(/[^a-z0-9]/g, '');

        return (
          cNic === normalizedNewNic || 
          cleanCNic === cleanNewNic ||
          (newNicDigits.length >= 4 && (cNicDigits === newNicDigits || cleanCDigits === newNicDigits))
        );
      })
    : null;

  const isDuplicateNic = Boolean(existingCustomerMatch);

  // Informational only: check if another customer with a different NIC shares this phone number
  const sharedPhoneCustomer = (normalizedNewPhone.length >= 9)
    ? activeClients.find(c => {
        const cPhone = String(c.phone || c.mobile || '').replace(/\D/g, '');
        const cNic = String(c.national_id || c.nationalId || c.nic || c.id || '').trim().toLowerCase();
        const cleanCNic = stripBranchPrefix(cNic).toLowerCase();
        const isSameNic = normalizedNewNic.length >= 3 && (
          cNic === normalizedNewNic || 
          cleanCNic === cleanNewNic ||
          cNic.replace(/[^a-z0-9]/g, '') === normalizedNewNic.replace(/[^a-z0-9]/g, '')
        );
        return !isSameNic && cPhone.length >= 9 && cPhone === normalizedNewPhone;
      })
    : null;

  const isDuplicatePhone = Boolean(sharedPhoneCustomer);

  const handleSelectClient = (client: any) => {
    setSelectedExistingClient(client);
    setSearchNic(client.national_id || client.nationalId || client.id || '');
    setIsDropdownOpen(false);
  };

  const handleContinueWithExisting = () => {
    if (!selectedExistingClient) {
      toast.error('Please select an existing customer first');
      return;
    }
    const c = selectedExistingClient;
    const nic = c.national_id || c.nationalId || c.id || '';
    const fullName = `${c.first_name || c.firstName || ''} ${c.last_name || c.lastName || ''}`.trim() || c.name || 'Customer';
    const phone = c.phone || '';
    const address = c.address || c.address_line1 || '';

    onCustomerSelected({
      id: c.id || nic,
      nic,
      name: fullName,
      phone,
      address,
      nicImage: c.nic_image || c.nicImage || null,
      signatureImage: c.signature_image || c.signatureImage || null,
    });
    onOpenChange(false);
  };

  const handleSwitchToNewWithTypedNic = () => {
    setNewNic(searchNic.trim());
    setMode('NEW');
    setSelectedExistingClient(null);
    setIsDropdownOpen(false);
  };

  const handleRegisterNewCustomer = async () => {
    // If customer already exists in database, gracefully adopt existing customer record
    if (existingCustomerMatch) {
      toast.info(`Using existing customer record for ${existingCustomerMatch.first_name || existingCustomerMatch.firstName || 'Customer'}`);
      const c = existingCustomerMatch;
      const nic = c.national_id || c.nationalId || c.id || newNic.trim();
      const fullName = `${c.first_name || c.firstName || ''} ${c.last_name || c.lastName || ''}`.trim() || c.name || newName.trim();
      const phone = c.phone || newPhone.trim();
      const address = c.address || c.address_line1 || newAddress.trim();

      stopCamera();
      onCustomerSelected({
        id: c.id || nic,
        nic,
        name: fullName,
        phone,
        address,
        nicImage: c.nic_image || c.nicImage || (kycFront || kycBack ? JSON.stringify({ front: kycFront, back: kycBack }) : null),
        signatureImage: c.signature_image || c.signatureImage || kycSign || null,
      });
      onOpenChange(false);
      return;
    }

    if (!newNic.trim()) {
      toast.error('NIC number is required');
      return;
    }
    if (!newName.trim()) {
      toast.error('Full name is required');
      return;
    }
    // Format / normalize phone number for robust Sri Lankan telecommunication standards
    let formattedPhone = newPhone.trim();
    const rawPhoneDigits = formattedPhone.replace(/\D/g, '');
    if (rawPhoneDigits.length === 9 && rawPhoneDigits.startsWith('7')) {
      formattedPhone = `0${rawPhoneDigits}`;
    } else if (rawPhoneDigits.length === 11 && rawPhoneDigits.startsWith('94')) {
      formattedPhone = `0${rawPhoneDigits.substring(2)}`;
    }
    const phoneDigits = formattedPhone.replace(/\D/g, '');
    if (!phoneDigits || phoneDigits.length < 10) {
      toast.error('Invalid mobile number', {
        description: 'Mobile number must be at least 10 digits (e.g. 0771234567).'
      });
      return;
    }
    if (!newAddress.trim()) {
      toast.error('Address is required');
      return;
    }
    const cleanNicInput = normalizeNationalId(newNic.trim());
    const hasAnyKyc = Boolean(kycFront || kycBack || kycSign);
    if (!hasAnyKyc) {
      toast.info('Registering customer profile (KYC photos can be uploaded anytime)');
    }

    setIsRegistering(true);
    const toastId = toast.loading('Registering customer in system...');

    try {
      const nameParts = newName.trim().split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '.';

      const [compressedFront, compressedBack, compressedSign] = await Promise.all([
        compressImage(kycFront),
        compressImage(kycBack),
        compressImage(kycSign)
      ]);

      const nicImage = (compressedFront || compressedBack) ? JSON.stringify({ front: compressedFront, back: compressedBack }) : null;
      const signatureImage = compressedSign || null;

      let storedBranch = '';
      if (typeof window !== 'undefined') {
        try {
          storedBranch = localStorage.getItem('user_branch') || '';
          if (!storedBranch) {
            const rawUser = localStorage.getItem('user');
            if (rawUser) storedBranch = JSON.parse(rawUser)?.branchId || '';
          }
        } catch {
          storedBranch = '';
        }
      }
      const safeBranch = normalizeBranchId(branchId || storedBranch || 'HQ');

      const payload = {
        nic: cleanNicInput,
        national_id: cleanNicInput,
        firstName,
        first_name: firstName,
        lastName,
        last_name: lastName,
        phone: formattedPhone,
        address: newAddress.trim(),
        branchId: safeBranch,
        branch_id: safeBranch,
        nic_image: nicImage,
        signature_image: signatureImage
      };

      const branchToPass = payload.branchId;
      let res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders({ 'x-branch-id': branchToPass }) },
        body: JSON.stringify(payload),
      });

      // If 401 Unauthorized occurs, attempt silent token refresh and retry
      if (res.status === 401) {
        try {
          const storedRefreshToken = typeof window !== 'undefined' ? localStorage.getItem('refresh_token') : '';
          const refreshRes = await fetch('/api/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: storedRefreshToken })
          });
          if (refreshRes.ok) {
            const refreshData = await refreshRes.json();
            if (refreshData?.token) {
              localStorage.setItem('auth_token', refreshData.token);
              if (refreshData.refreshToken) {
                localStorage.setItem('refresh_token', refreshData.refreshToken);
              }
              // Retry customer registration with fresh token
              res = await fetch('/api/clients', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders({ 'x-branch-id': branchToPass }) },
                body: JSON.stringify(payload),
              });
            }
          }
        } catch (renewErr) {
          console.warn('Session auto-renewal failed:', renewErr);
        }
      }

      if (!res.ok) {
        let errorMsg = 'Failed to register customer';
        try {
          const errJson = await res.json();
          errorMsg = errJson.error || errJson.message || errorMsg;
        } catch {
          const text = await res.text().catch(() => '');
          if (text.toLowerCase().includes('request entity too large') || text.toLowerCase().includes('requested en') || res.status === 413) {
            errorMsg = 'Images are too large. Please use smaller photos.';
          } else if (text) {
            errorMsg = text.slice(0, 150);
          }
        }
        throw new Error(errorMsg);
      }

      let createdClient: any = {};
      try {
        createdClient = await res.json();
      } catch {}

      toast.success('Customer registered successfully ✓', { id: toastId });

      stopCamera();

      const newEntry = {
        ...createdClient,
        id: createdClient.id || newNic.trim(),
        national_id: createdClient.national_id || newNic.trim(),
        nationalId: createdClient.national_id || newNic.trim(),
        first_name: firstName,
        last_name: lastName,
        phone: formattedPhone,
        address: newAddress.trim(),
        display_national_id: stripBranchPrefix(createdClient.national_id || newNic.trim())
      };
      setActiveClients(prev => [newEntry, ...prev.filter(c => c.id !== newEntry.id)]);

      onCustomerSelected({
        id: createdClient.id || newNic.trim(),
        nic: newNic.trim(),
        name: newName.trim(),
        phone: newPhone.trim(),
        address: newAddress.trim(),
        nicImage,
        signatureImage
      });

      onOpenChange(false);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Customer registration failed', { id: toastId });
    } finally {
      setIsRegistering(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="w-[98vw] sm:w-[95vw] md:max-w-4xl lg:max-w-5xl xl:max-w-6xl h-[90dvh] max-h-[90dvh] sm:h-auto sm:max-h-[90dvh] bg-white border border-slate-200 shadow-2xl p-0 rounded-2xl sm:rounded-[2.5rem] flex flex-col gap-0 overflow-hidden my-auto">
        {/* Top Accent Bar */}
        <div className="h-2.5 bg-gradient-to-r from-amber-500 via-amber-600 to-yellow-500 shrink-0" />

        {/* Modal Header */}
        <div className="p-3 sm:p-6 pb-2.5 sm:pb-3 pr-12 border-b border-slate-100 bg-white shrink-0">
          <DialogHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <DialogTitle className="text-lg sm:text-2xl font-black text-slate-900 flex items-center gap-2 sm:gap-2.5">
                  {mode === 'EXISTING' ? (
                    <div className="p-2 bg-amber-500/10 text-amber-600 rounded-2xl">
                      <UserCheck className="w-5 h-5 sm:w-6 sm:h-6" />
                    </div>
                  ) : (
                    <div className="p-2 bg-amber-500/10 text-amber-600 rounded-2xl">
                      <UserPlus className="w-5 h-5 sm:w-6 sm:h-6" />
                    </div>
                  )}
                  <span>{mode === 'EXISTING' ? 'Customer Identification' : 'Register New Customer'}</span>
                </DialogTitle>
                <DialogDescription className="font-semibold text-slate-500 text-[11px] sm:text-xs mt-0.5 sm:mt-1">
                  {mode === 'EXISTING' 
                    ? 'Search borrower by NIC number or register a new customer before originating pawn.'
                    : 'Enter customer details and capture webcam images for KYC verification.'}
                </DialogDescription>
              </div>

              {/* Collateral Snapshot Badge */}
              {evaluationSummary?.airWeight ? (
                <div className="bg-amber-50 border border-amber-200 px-3.5 py-1.5 rounded-2xl flex items-center gap-2 shrink-0 self-start sm:self-auto">
                  <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  <div className="text-[11px] font-bold text-amber-900">
                    <span>{evaluationSummary.airWeight} mg</span>
                    {evaluationSummary.estimatedKarat ? (
                      <span className="text-amber-700 ml-1">({evaluationSummary.estimatedKarat})</span>
                    ) : null}
                    {(evaluationSummary.askingAmount || evaluationSummary.trueValue) ? (
                      <span className="font-mono font-black ml-1.5 text-amber-950">• Rs. {(evaluationSummary.askingAmount || evaluationSummary.trueValue || 0).toLocaleString()}</span>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </DialogHeader>

          {/* Toggle between Existing Customer and Register New Customer */}
          <div className="flex bg-slate-100 p-1 rounded-2xl mt-4">
            <button
              type="button"
              onClick={() => { setMode('EXISTING'); stopCamera(); }}
              className={`flex-1 py-2.5 text-xs font-black uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 ${
                mode === 'EXISTING' 
                  ? 'bg-white shadow text-slate-900 font-black' 
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <UserCheck className="w-4 h-4 text-amber-500" />
              Existing Customer (Search NIC)
            </button>
            <button
              type="button"
              onClick={() => { setMode('NEW'); }}
              className={`flex-1 py-2.5 text-xs font-black uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 ${
                mode === 'NEW' 
                  ? 'bg-white shadow text-slate-900 font-black' 
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <UserPlus className="w-4 h-4 text-amber-500" />
              Register New Customer
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3.5 sm:p-6 space-y-5 sm:space-y-6 overscroll-contain">
          {/* ─────────────────────────────────────────────────────────── */}
          {/* TAB 1: EXISTING CUSTOMER SEARCH                             */}
          {/* ─────────────────────────────────────────────────────────── */}
          {mode === 'EXISTING' && (
            <div className="space-y-6">
              {/* NIC Search Box */}
              <div className="relative">
                <Label className="font-black text-xs uppercase tracking-wider text-slate-600 block mb-2">
                  Search Customer NIC Number
                </Label>
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    value={searchNic}
                    onChange={(e) => {
                      setSearchNic(e.target.value);
                      setIsDropdownOpen(true);
                      if (selectedExistingClient && (selectedExistingClient.national_id !== e.target.value)) {
                        setSelectedExistingClient(null);
                      }
                    }}
                    onFocus={() => setIsDropdownOpen(true)}
                    placeholder="Type NIC number (e.g. 941234567V or 199412345678)..."
                    className="pl-11 h-14 bg-white rounded-2xl font-mono font-bold text-sm border-slate-200 focus:border-amber-500 focus:ring-amber-500/20 shadow-sm"
                    autoFocus
                  />
                  {searchNic && (
                    <button
                      type="button"
                      onClick={() => { setSearchNic(''); setSelectedExistingClient(null); setIsDropdownOpen(false); }}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 hover:text-slate-600"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Dropdown Results */}
                {isDropdownOpen && searchNic.trim().length > 0 && (
                  <div className="absolute z-50 left-0 right-0 mt-2 bg-white rounded-2xl border border-slate-200 shadow-2xl max-h-64 overflow-y-auto divide-y divide-slate-100">
                    {matchingClients.length > 0 ? (
                      matchingClients.map((client) => {
                        const nic = client.national_id || client.nationalId || client.id || '';
                        const name = `${client.first_name || client.firstName || ''} ${client.last_name || client.lastName || ''}`.trim();
                        const phone = client.phone || 'No TP';
                        const branch = client.branch_id || client.branchId || '';

                        return (
                          <div
                            key={client.id || nic}
                            onClick={() => handleSelectClient(client)}
                            className="p-3.5 hover:bg-amber-50/60 cursor-pointer transition-colors flex items-center justify-between"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-xl bg-amber-100/70 text-amber-800 flex items-center justify-center font-black text-xs shrink-0">
                                <CreditCard className="w-4 h-4" />
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-black text-slate-900 text-sm">{nic}</span>
                                  {branch && (
                                    <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
                                      {branch}
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs font-bold text-slate-600">{name || 'Unnamed Client'}</div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs font-mono font-bold text-slate-500">{phone}</div>
                              <span className="text-[10px] font-bold text-amber-600 flex items-center justify-end gap-1">
                                Select <ArrowRight className="w-3 h-3" />
                              </span>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="p-5 text-center space-y-3">
                        <p className="text-sm font-bold text-slate-600">
                          No existing customer found with NIC: <span className="font-mono text-amber-600">{searchNic}</span>
                        </p>
                        <Button
                          type="button"
                          onClick={handleSwitchToNewWithTypedNic}
                          className="bg-amber-500 hover:bg-amber-600 text-white font-black text-xs uppercase tracking-wider rounded-xl h-10 px-5 shadow-md shadow-amber-500/20"
                        >
                          <UserPlus className="w-4 h-4 mr-1.5" /> Register &quot;{searchNic}&quot; as New Customer
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Selected Customer Card */}
              {selectedExistingClient ? (
                <div className="bg-slate-50/80 rounded-2xl p-5 border-2 border-emerald-500/30 space-y-4 animate-in fade-in duration-300">
                  <div className="flex items-center justify-between border-b border-slate-200/80 pb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                        <Check className="w-4 h-4 stroke-[3]" />
                      </div>
                      <div>
                        <span className="text-xs font-black uppercase tracking-wider text-emerald-800 block">
                          Customer Verified & Found
                        </span>
                        <span className="text-[11px] font-bold text-slate-400">
                          Details ready for pawn registration
                        </span>
                      </div>
                    </div>
                    <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 font-mono font-black text-xs">
                      {selectedExistingClient.national_id || selectedExistingClient.nationalId}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="bg-white p-3.5 rounded-xl border border-slate-200">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-1">
                        <User className="w-3 h-3 text-primary" /> Full Name (Name with Initials)
                      </span>
                      <p className="text-sm font-bold text-slate-900">
                        {`${selectedExistingClient.first_name || selectedExistingClient.firstName || ''} ${selectedExistingClient.last_name || selectedExistingClient.lastName || ''}`.trim() || 'N/A'}
                      </p>
                    </div>

                    <div className="bg-white p-3.5 rounded-xl border border-slate-200">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-1">
                        <Phone className="w-3 h-3 text-primary" /> Mobile Number (TP)
                      </span>
                      <p className="text-sm font-bold text-slate-900 font-mono">
                        {selectedExistingClient.phone || 'No Mobile Number'}
                      </p>
                    </div>

                    <div className="bg-white p-3.5 rounded-xl border border-slate-200 sm:col-span-2">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-1">
                        <MapPin className="w-3 h-3 text-primary" /> Permanent Address
                      </span>
                      <p className="text-xs font-bold text-slate-700">
                        {selectedExistingClient.address || selectedExistingClient.address_line1 || 'No Address Recorded'}
                      </p>
                    </div>
                  </div>

                  {/* KYC Photos on File Badge */}
                  <div className="flex items-center gap-2 pt-1 text-[11px] font-bold text-slate-500">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>
                      {(selectedExistingClient.nic_image || selectedExistingClient.signature_image)
                        ? 'KYC biometric and identity photos on file ✓'
                        : 'No photos on file (can proceed or capture later)'}
                    </span>
                  </div>
                </div>
              ) : (
                /* Empty / Hint State */
                <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto">
                    <CreditCard className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-700">Search for an Existing Customer by NIC</p>
                    <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                      Type the customer&apos;s NIC number above. If the customer is not registered yet, you can register them in seconds with KYC photos.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setMode('NEW')}
                    className="border-amber-300 text-amber-700 hover:bg-amber-50 font-bold text-xs uppercase tracking-wider rounded-xl"
                  >
                    <UserPlus className="w-4 h-4 mr-1.5" /> Or Register New Customer Directly
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* ─────────────────────────────────────────────────────────── */}
          {/* TAB 2: REGISTER NEW CUSTOMER WITH WEBCAM KYC                */}
          {/* ─────────────────────────────────────────────────────────── */}
          {mode === 'NEW' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6 items-start">
              {/* Left Column: Customer Details Inputs */}
              <div className="space-y-4">
                {/* ── RED ALERT: CUSTOMER ALREADY EXISTS IN DATABASE ── */}
                {existingCustomerMatch && (
                  <div className="bg-red-50 border-2 border-red-500 rounded-2xl p-4 sm:p-5 shadow-lg shadow-red-500/10 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="flex items-start justify-between gap-2 border-b border-red-200 pb-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-red-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                          <AlertTriangle className="w-5 h-5 stroke-[2.5]" />
                        </div>
                        <div>
                          <span className="text-xs sm:text-sm font-black text-red-700 uppercase tracking-wide block">
                            Customer Already Exists in Database!
                          </span>
                          <span className="text-[11px] font-bold text-red-600">
                            Registered customer details are shown below in red:
                          </span>
                        </div>
                      </div>
                      <Badge className="bg-red-600 hover:bg-red-600 text-white font-mono font-black text-[10px] uppercase tracking-wider shrink-0 px-2.5 py-1">
                        EXISTS IN DB
                      </Badge>
                    </div>

                    {/* Existing Details Visible in Red Color */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <div className="bg-white/90 p-2.5 rounded-xl border border-red-300 shadow-sm">
                        <span className="text-[10px] font-black uppercase tracking-wider text-red-500 block mb-0.5">
                          Existing NIC Number
                        </span>
                        <span className="font-mono font-black text-red-700 text-sm">
                          {existingCustomerMatch.national_id || existingCustomerMatch.nationalId || existingCustomerMatch.id || newNic}
                        </span>
                      </div>

                      <div className="bg-white/90 p-2.5 rounded-xl border border-red-300 shadow-sm">
                        <span className="text-[10px] font-black uppercase tracking-wider text-red-500 block mb-0.5">
                          Full Name
                        </span>
                        <span className="font-black text-red-700 text-sm">
                          {`${existingCustomerMatch.first_name || existingCustomerMatch.firstName || ''} ${existingCustomerMatch.last_name || existingCustomerMatch.lastName || ''}`.trim() || existingCustomerMatch.name || 'Unnamed Client'}
                        </span>
                      </div>

                      <div className="bg-white/90 p-2.5 rounded-xl border border-red-300 shadow-sm">
                        <span className="text-[10px] font-black uppercase tracking-wider text-red-500 block mb-0.5">
                          Mobile Number (TP)
                        </span>
                        <span className="font-mono font-black text-red-700 text-sm">
                          {existingCustomerMatch.phone || existingCustomerMatch.mobile || 'No Mobile Number'}
                        </span>
                      </div>

                      <div className="bg-white/90 p-2.5 rounded-xl border border-red-300 shadow-sm">
                        <span className="text-[10px] font-black uppercase tracking-wider text-red-500 block mb-0.5">
                          Registered Branch
                        </span>
                        <span className="font-black text-red-700 text-xs uppercase">
                          {existingCustomerMatch.branch_id || existingCustomerMatch.branchId || 'Head Office / HQ'}
                        </span>
                      </div>

                      <div className="bg-white/90 p-2.5 rounded-xl border border-red-300 shadow-sm sm:col-span-2">
                        <span className="text-[10px] font-black uppercase tracking-wider text-red-500 block mb-0.5">
                          Permanent Address
                        </span>
                        <span className="font-bold text-red-700 text-xs">
                          {existingCustomerMatch.address || existingCustomerMatch.address_line1 || 'No Address Recorded'}
                        </span>
                      </div>
                    </div>

                    {/* Action button inside red card */}
                    <div className="pt-1 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-red-600">
                        Choose existing record for this pawn transaction:
                      </span>
                      <Button
                        type="button"
                        onClick={() => {
                          handleSelectClient(existingCustomerMatch);
                          setMode('EXISTING');
                          toast.success('Selected existing customer record ✓');
                        }}
                        className="bg-red-600 hover:bg-red-700 text-white font-black text-xs uppercase tracking-wider h-9 px-4 rounded-xl shadow-md gap-1.5 cursor-pointer shrink-0"
                      >
                        <UserCheck className="w-4 h-4" />
                        <span>Use This Existing Customer</span>
                      </Button>
                    </div>
                  </div>
                )}

                {/* NIC Number */}
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label 
                      htmlFor="reg-nic" 
                      className={`font-black text-[10px] uppercase tracking-widest ${isDuplicateNic ? 'text-red-600' : 'text-slate-500'}`}
                    >
                      NIC Number (Primary Key)
                    </Label>
                    {isDuplicateNic && (
                      <span className="text-[10px] font-black text-red-600 flex items-center gap-1 uppercase tracking-wider animate-pulse">
                        <AlertTriangle className="w-3 h-3 stroke-[2.5]" /> Exists in DB
                      </span>
                    )}
                  </div>
                  <Input
                    id="reg-nic"
                    value={newNic}
                    onChange={(e) => setNewNic(e.target.value)}
                    placeholder="e.g. 941234567V or 199412345678"
                    className={`h-11 rounded-xl font-mono font-bold text-sm transition-all ${
                      isDuplicateNic 
                        ? 'border-2 border-red-500 bg-red-50/70 text-red-700 focus:border-red-600 focus:ring-red-400/20' 
                        : 'bg-white border-slate-200 text-slate-800'
                    }`}
                  />
                </div>

                {/* Name with Initials */}
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="reg-name" className="font-black text-[10px] uppercase tracking-widest text-slate-500">
                      Name with Initials
                    </Label>
                    {existingCustomerMatch && (
                      <span className="text-[10px] font-bold text-red-600">
                        Existing: {`${existingCustomerMatch.first_name || existingCustomerMatch.firstName || ''} ${existingCustomerMatch.last_name || existingCustomerMatch.lastName || ''}`.trim()}
                      </span>
                    )}
                  </div>
                  <Input
                    id="reg-name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. A.B.C. Perera"
                    className="h-11 bg-white rounded-xl font-bold text-slate-800 text-sm"
                  />
                </div>

                {/* TP (Phone Number) */}
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label 
                      htmlFor="reg-phone" 
                      className="font-black text-[10px] uppercase tracking-widest text-slate-500"
                    >
                      TP (Phone Number)
                    </Label>
                    <div className="flex items-center gap-2">
                      {sharedPhoneCustomer && (
                        <span className="text-[10px] font-bold text-amber-600 flex items-center gap-1 uppercase tracking-wider">
                          <AlertTriangle className="w-3 h-3 stroke-[2]" /> Shared with {sharedPhoneCustomer.first_name || sharedPhoneCustomer.firstName || 'Customer'}
                        </span>
                      )}
                      <span className={`text-[10px] font-mono font-bold ${
                        newPhone.replace(/\D/g, '').length >= 10 ? 'text-emerald-600' : 'text-slate-400'
                      }`}>
                        {newPhone.replace(/\D/g, '').length >= 10 ? '✓ ' : ''}
                        {newPhone.replace(/\D/g, '').length}/10 digits
                      </span>
                    </div>
                  </div>
                  <Input
                    id="reg-phone"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="e.g. 077 123 4567"
                    className="h-11 rounded-xl font-mono font-bold text-sm bg-white border-slate-200 text-slate-800 focus:border-amber-500 focus:ring-amber-400/20"
                  />
                </div>

                {/* Address */}
                <div className="grid gap-1.5">
                  <Label htmlFor="reg-address" className="font-black text-[10px] uppercase tracking-widest text-slate-500">
                    Address
                  </Label>
                  <textarea
                    id="reg-address"
                    value={newAddress}
                    onChange={(e) => setNewAddress(e.target.value)}
                    placeholder="Enter customer permanent address..."
                    rows={3}
                    className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              {/* Right Column: Webcam KYC Capture */}
              <div className="space-y-4">
                {/* KYC Tabs */}
                <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-slate-100 rounded-xl border border-slate-200">
                  <button
                    type="button"
                    onClick={() => { setActiveKycTab('front'); stopCamera(); }}
                    className={`flex-1 min-w-[95px] py-2 px-2 rounded-lg text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      activeKycTab === 'front' 
                        ? 'bg-[#ffd100] text-[#202020] shadow-sm' 
                        : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
                    }`}
                  >
                    <span>💳 NIC Front</span>
                    <span className={`w-2 h-2 rounded-full ${kycFront ? 'bg-emerald-600' : 'bg-amber-600'}`} />
                  </button>

                  <button
                    type="button"
                    onClick={() => { setActiveKycTab('back'); stopCamera(); }}
                    className={`flex-1 min-w-[95px] py-2 px-2 rounded-lg text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      activeKycTab === 'back' 
                        ? 'bg-[#ffd100] text-[#202020] shadow-sm' 
                        : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
                    }`}
                  >
                    <span>💳 NIC Back</span>
                    <span className={`w-2 h-2 rounded-full ${kycBack ? 'bg-emerald-600' : 'bg-amber-600'}`} />
                  </button>

                  <button
                    type="button"
                    onClick={() => { setActiveKycTab('sign'); stopCamera(); }}
                    className={`flex-1 min-w-[95px] py-2 px-2 rounded-lg text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      activeKycTab === 'sign' 
                        ? 'bg-[#ffd100] text-[#202020] shadow-sm' 
                        : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
                    }`}
                  >
                    <span>✍️ Signature</span>
                    <span className={`w-2 h-2 rounded-full ${kycSign ? 'bg-emerald-600' : 'bg-amber-600'}`} />
                  </button>
                </div>

                {/* KYC Photo Capture Box */}
                <div className="w-full">
                  {activeKycTab === 'front' && (
                    <SmartNicScanner 
                      key="nic_front_capture_modal"
                      label="NIC Front Side Photo" 
                      onCapture={(base64) => setKycFront(base64)} 
                      initialImage={kycFront} 
                      autoStart={true}
                    />
                  )}

                  {activeKycTab === 'back' && (
                    <SmartNicScanner 
                      key="nic_back_capture_modal"
                      label="NIC Back Side Photo" 
                      onCapture={(base64) => setKycBack(base64)} 
                      initialImage={kycBack} 
                      autoStart={true}
                    />
                  )}

                  {activeKycTab === 'sign' && (
                    <SmartNicScanner 
                      key="signature_capture_modal"
                      label="Customer Signature Photo" 
                      onCapture={(base64) => setKycSign(base64)} 
                      initialImage={kycSign} 
                      autoStart={true}
                      isSignature={true}
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3 sm:p-5 border-t border-slate-200/90 bg-white/95 backdrop-blur-md shrink-0 flex flex-col sm:flex-row justify-between items-center gap-2.5 sm:gap-3 z-30 shadow-[0_-4px_12px_rgba(0,0,0,0.04)]">
          {mode === 'EXISTING' ? (
            <>
              <div className="text-xs font-bold text-slate-500 w-full sm:w-auto text-center sm:text-left">
                {selectedExistingClient ? (
                  <span className="text-emerald-700 flex items-center justify-center sm:justify-start gap-1.5">
                    <Check className="w-4 h-4 text-emerald-600 stroke-[3]" />
                    <span>Ready to proceed with {selectedExistingClient.first_name || selectedExistingClient.firstName}</span>
                  </span>
                ) : (
                  <span>Please select a customer from the dropdown above</span>
                )}
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  className="font-bold text-slate-600 h-10 sm:h-11 rounded-xl flex-1 sm:flex-none border-slate-200 text-xs sm:text-sm"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={!selectedExistingClient}
                  onClick={handleContinueWithExisting}
                  className="bg-amber-500 hover:bg-amber-600 text-white font-black px-5 sm:px-6 h-10 sm:h-11 rounded-xl shadow-lg shadow-amber-500/20 gap-1.5 sm:gap-2 cursor-pointer disabled:opacity-50 flex-[2] sm:flex-none text-xs sm:text-sm"
                >
                  <span className="truncate">Continue to Pawn</span>
                  <ArrowRight className="w-4 h-4 shrink-0" />
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 w-full sm:w-auto justify-center sm:justify-start">
                {(!kycFront || !kycBack || !kycSign) ? (
                  <span className="flex items-center gap-1.5 text-amber-800 bg-amber-50 border border-amber-300/80 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl text-[10px] sm:text-[11px] font-bold w-full sm:w-auto justify-center sm:justify-start">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span className="truncate">Recommended: {!kycFront ? 'NIC Front' : ''} {!kycBack ? (!kycFront ? '• NIC Back' : 'NIC Back') : ''} {!kycSign ? (!kycFront || !kycBack ? '• Signature' : 'Signature') : ''}</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl text-[10px] sm:text-[11px] font-bold w-full sm:w-auto justify-center sm:justify-start">
                    <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 stroke-[3]" />
                    <span>All 3 KYC pictures captured ✓</span>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setMode('EXISTING')}
                  className="font-bold text-slate-600 h-10 sm:h-11 rounded-xl flex-1 sm:flex-none border-slate-200 text-xs sm:text-sm"
                >
                  Back
                </Button>
                <Button
                  type="button"
                  disabled={isRegistering || !newNic.trim() || (!existingCustomerMatch && (!newName.trim() || !newPhone.trim() || !newAddress.trim()))}
                  onClick={handleRegisterNewCustomer}
                  className={`font-black px-5 sm:px-7 h-10 sm:h-11 rounded-xl shadow-lg gap-1.5 sm:gap-2 cursor-pointer disabled:opacity-50 transition-all flex-[2] sm:flex-none text-xs sm:text-sm ${
                    existingCustomerMatch
                      ? 'bg-red-600 hover:bg-red-700 text-white shadow-red-600/20'
                      : 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/20'
                  }`}
                >
                  {isRegistering ? <RefreshCcw className="w-4 h-4 animate-spin mr-1 shrink-0" /> : null}
                  <span className="truncate">
                    {isRegistering 
                      ? 'Processing...' 
                      : existingCustomerMatch 
                        ? 'Use Existing Customer' 
                        : 'Register Customer'}
                  </span>
                  <ArrowRight className="w-4 h-4 shrink-0" />
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
