'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { 
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  QrCode, Camera, CheckCircle2, AlertTriangle, X, 
  RefreshCw, ShieldCheck, Search, Tag, Sparkles, 
  Trash2, Lock, ArrowLeft, ChevronRight, User, Scale, 
  Filter, Check, AlertCircle, Loader2
} from 'lucide-react';
import { toast } from 'sonner';
import { getAuthHeaders } from '@/lib/getAuthHeaders';

interface PawnRecord {
  id: string;
  bill_no: string;
  client_id?: string;
  customer_name?: string;
  phone?: string;
  branch_id?: string;
  clients?: {
    first_name?: string;
    last_name?: string;
    national_id?: string;
    phone?: string;
  };
  weight?: number;
  weight_grams?: number;
  weight_mg?: number;
  disbursed_amount?: number;
  description?: string;
  packet_qr?: string | null;
}

interface PacketQrScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetBillNo?: string;
  targetPawnId?: string;
  currentPacketQr?: string;
  customerName?: string;
  weightFormatted?: string;
  availablePawns?: PawnRecord[];
  onSuccess?: (packetQr: string, billNo: string, pawnId?: string) => void;
}

export default function PacketQrScannerModal({
  isOpen,
  onClose,
  targetBillNo,
  targetPawnId,
  currentPacketQr,
  customerName,
  weightFormatted,
  availablePawns = [],
  onSuccess
}: PacketQrScannerModalProps) {
  // Stepper State: 'SEARCH' (Select Bill) or 'SCAN' (Scan/Attach QR)
  const [step, setStep] = useState<'SEARCH' | 'SCAN'>('SEARCH');
  
  // Selected Bill State
  const [selectedPawn, setSelectedPawn] = useState<PawnRecord | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterStickerStatus, setFilterStickerStatus] = useState<'ALL' | 'NO_STICKER' | 'HAS_STICKER'>('ALL');
  const [remotePawns, setRemotePawns] = useState<PawnRecord[]>([]);
  const [isSearchingRemote, setIsSearchingRemote] = useState<boolean>(false);

  // Scanner & Input State
  const [activeTab, setActiveTab] = useState<'camera' | 'manual'>('camera');
  const [scannedCode, setScannedCode] = useState<string>('');
  const [manualCode, setManualCode] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // User Role Guard
  const [userRole, setUserRole] = useState<string>('');

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const readerElementId = 'packet-qr-reader-window';

  useEffect(() => {
    try {
      const stored = localStorage.getItem('user');
      if (stored) {
        const u = JSON.parse(stored);
        setUserRole(u.role || '');
      }
    } catch (e) {}
  }, []);

  const isAuditorOrAdmin = userRole === 'AUDITOR' || userRole === 'ADMIN';

  // Sound feedback on successful scan
  const playBeep = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) {}
  };

  // Initialize or Reset Modal when opened/closed
  useEffect(() => {
    if (isOpen) {
      setScannedCode('');
      setManualCode('');
      setSearchQuery('');
      setFilterStickerStatus('ALL');
      setCameraError(null);

      if (targetBillNo) {
        // Pre-targeted bill passed from row or verify page
        setSelectedPawn({
          id: targetPawnId || targetBillNo,
          bill_no: targetBillNo,
          customer_name: customerName,
          packet_qr: currentPacketQr || null
        });
        setStep('SCAN');
        if (activeTab === 'camera') {
          const timer = setTimeout(() => startCamera(), 300);
          return () => clearTimeout(timer);
        }
      } else {
        // Search first workflow requested by user
        setSelectedPawn(null);
        setStep('SEARCH');
      }
    } else {
      stopCamera();
    }

    return () => {
      stopCamera();
    };
  }, [isOpen, targetBillNo, targetPawnId, currentPacketQr]);

  // Handle switching tabs inside Step 2
  useEffect(() => {
    if (isOpen && step === 'SCAN') {
      if (activeTab === 'camera') {
        const timer = setTimeout(() => startCamera(), 250);
        return () => clearTimeout(timer);
      } else {
        stopCamera();
      }
    }
  }, [activeTab, step]);

  // Fetch search results if availablePawns is empty and query is typed
  useEffect(() => {
    if (!isOpen || step !== 'SEARCH') return;
    if (availablePawns.length > 0) return; // Use in-memory list if available

    const timer = setTimeout(async () => {
      if (!searchQuery.trim()) {
        setRemotePawns([]);
        return;
      }
      setIsSearchingRemote(true);
      try {
        const res = await fetch(`/api/pawns?search=${encodeURIComponent(searchQuery.trim())}`, {
          headers: getAuthHeaders()
        });
        if (res.ok) {
          const list = await res.json();
          setRemotePawns(Array.isArray(list) ? list : []);
        }
      } catch (err) {
        console.warn('Search remote pawns error:', err);
      } finally {
        setIsSearchingRemote(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery, isOpen, step, availablePawns.length]);

  // Filtered pawns for Step 1
  const searchResults = useMemo(() => {
    const pawnsSource = availablePawns.length > 0 ? availablePawns : remotePawns;
    const q = searchQuery.toLowerCase().trim();

    return pawnsSource.filter((p) => {
      // 1. Sticker status filter
      if (filterStickerStatus === 'NO_STICKER' && p.packet_qr) return false;
      if (filterStickerStatus === 'HAS_STICKER' && !p.packet_qr) return false;

      // 2. Query filter
      if (!q) return true;
      const b = (p.bill_no || '').toLowerCase();
      const c = (p.clients?.first_name || p.customer_name || '').toLowerCase();
      const nic = (p.clients?.national_id || '').toLowerCase();
      const phone = (p.clients?.phone || p.phone || '').toLowerCase();
      const desc = (p.description || '').toLowerCase();
      return b.includes(q) || c.includes(q) || nic.includes(q) || phone.includes(q) || desc.includes(q);
    }).slice(0, 30);
  }, [availablePawns, remotePawns, searchQuery, filterStickerStatus]);

  // Start Camera Scanner with mobile-optimized resolution & aspect
  const startCamera = async () => {
    setCameraError(null);
    try {
      if (scannerRef.current) {
        try {
          if (scannerRef.current.isScanning) {
            await scannerRef.current.stop();
          }
          await scannerRef.current.clear();
        } catch (e) {}
      }

      const html5QrCode = new Html5Qrcode(readerElementId);
      scannerRef.current = html5QrCode;

      const config = {
        fps: 10,
        qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
          const minDim = Math.min(viewfinderWidth, viewfinderHeight);
          return {
            width: Math.floor(minDim * 0.8),
            height: Math.floor(minDim * 0.8)
          };
        },
        aspectRatio: 1.0
      };

      await html5QrCode.start(
        { facingMode: 'environment' },
        config,
        (decodedText) => {
          handleCodeDetected(decodedText);
        },
        () => {}
      );
      setIsCameraActive(true);
    } catch (err: any) {
      console.warn('Camera start error:', err);
      setCameraError(err?.message || 'Unable to access camera. Please allow camera permissions or use the Barcode Scanner Gun / Input option.');
      setIsCameraActive(false);
    }
  };

  // Stop Camera
  const stopCamera = async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        await scannerRef.current.clear();
      } catch (e) {}
      scannerRef.current = null;
    }
    setIsCameraActive(false);
  };

  // Handle scanned code
  const handleCodeDetected = async (code: string) => {
    if (!code || code.trim() === '') return;
    playBeep();
    setScannedCode(code.trim());
    setManualCode(code.trim());

    await stopCamera();
    toast.success(`Packet Sticker Scanned: "${code.length > 25 ? code.substring(0, 25) + '...' : code}"`);
  };

  // Select Bill from Search (Step 1 -> Step 2)
  const handleSelectBill = (pawn: PawnRecord) => {
    setSelectedPawn(pawn);
    setScannedCode(pawn.packet_qr || '');
    setManualCode(pawn.packet_qr || '');
    setStep('SCAN');
    if (activeTab === 'camera') {
      setTimeout(() => startCamera(), 250);
    }
  };

  // Save / Bind Packet QR to Selected Bill
  const handleSavePacketQr = async () => {
    if (!isAuditorOrAdmin) {
      toast.error('Forbidden. Only Auditor accounts can assign packet stickers.');
      return;
    }

    const codeToSave = (manualCode || scannedCode).trim();
    const billToSave = (selectedPawn?.bill_no || targetBillNo || '').trim();

    if (!billToSave) {
      toast.error('Please select a bill number first');
      setStep('SEARCH');
      return;
    }

    if (!codeToSave) {
      toast.error('Please scan or enter a packet sticker QR code');
      return;
    }

    setIsSubmitting(true);
    const toastId = toast.loading(`Binding packet sticker to Bill #${billToSave}...`);

    try {
      const targetId = selectedPawn?.id || targetPawnId || billToSave;
      const res = await fetch(`/api/pawns/${encodeURIComponent(targetId)}/packet-qr`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({
          packet_qr: codeToSave,
          bill_no: billToSave,
          branch_id: selectedPawn?.branch_id
        })
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to save packet sticker QR');
      }

      toast.success(`Packet sticker attached to Bill #${billToSave}!`, { id: toastId });
      if (onSuccess) {
        onSuccess(codeToSave, billToSave, selectedPawn?.id || targetPawnId);
      }
      onClose();
    } catch (err: any) {
      console.error('Save packet QR error:', err);
      toast.error(err.message || 'Error saving packet QR', { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete / Unlink Packet QR from Bill
  const handleDeletePacketQr = async () => {
    const billToDelete = selectedPawn?.bill_no || targetBillNo;
    if (!billToDelete) return;

    if (!isAuditorOrAdmin) {
      toast.error('Forbidden. Only Auditor accounts can delete packet stickers.');
      return;
    }

    if (!confirm(`Are you sure you want to remove and unlink the packet sticker QR for Bill #${billToDelete}?`)) {
      return;
    }

    setIsDeleting(true);
    const toastId = toast.loading(`Deleting packet sticker for Bill #${billToDelete}...`);

    try {
      const targetId = selectedPawn?.id || targetPawnId || billToDelete;
      const branchParam = selectedPawn?.branch_id ? `?branch_id=${encodeURIComponent(selectedPawn.branch_id)}` : '';
      const res = await fetch(`/api/pawns/${encodeURIComponent(targetId)}/packet-qr${branchParam}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to delete packet sticker QR');
      }

      toast.success(`Packet sticker QR removed from Bill #${billToDelete}`, { id: toastId });
      setScannedCode('');
      setManualCode('');
      if (selectedPawn) {
        setSelectedPawn({ ...selectedPawn, packet_qr: null });
      }
      if (onSuccess) {
        onSuccess('', billToDelete, selectedPawn?.id || targetPawnId);
      }
      onClose();
    } catch (err: any) {
      console.error('Delete packet QR error:', err);
      toast.error(err.message || 'Error deleting packet QR', { id: toastId });
    } finally {
      setIsDeleting(false);
    }
  };

  const effectiveBillNo = selectedPawn?.bill_no || targetBillNo || '';
  const effectiveCustomer = selectedPawn?.clients?.first_name || selectedPawn?.customer_name || customerName || '';
  const effectiveWeight = selectedPawn?.weight_mg ? `${selectedPawn.weight_mg} mg` : (weightFormatted || (selectedPawn?.weight ? `${Math.round(selectedPawn.weight * 1000)} mg` : (selectedPawn?.weight_grams ? `${Math.round(Number(selectedPawn.weight_grams) * 1000)} mg` : '')));
  const effectiveQr = selectedPawn?.packet_qr || currentPacketQr;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent 
        className="w-[96vw] sm:max-w-xl max-h-[92dvh] sm:max-h-[88vh] flex flex-col p-3.5 sm:p-5 md:p-6 bg-white/95 backdrop-blur-2xl border border-white/60 shadow-2xl rounded-3xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Scoped CSS for html5-qrcode responsive scaling on mobile & tablets */}
        <style dangerouslySetInnerHTML={{ __html: `
          #${readerElementId} {
            width: 100% !important;
            border: none !important;
          }
          #${readerElementId} video {
            width: 100% !important;
            height: 100% !important;
            object-fit: cover !important;
            border-radius: 1rem !important;
          }
          #${readerElementId}__scan_region {
            min-height: 180px !important;
          }
          #${readerElementId}__dashboard_section {
            display: none !important;
          }
        `}} />

        {/* MODAL HEADER */}
        <DialogHeader className="pb-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 sm:gap-3">
              {step === 'SCAN' ? (
                <button
                  type="button"
                  onClick={() => {
                    stopCamera();
                    setStep('SEARCH');
                  }}
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-amber-50 hover:bg-amber-100 text-amber-800 flex items-center justify-center transition-all cursor-pointer shadow-2xs border border-amber-200/60 active:scale-95"
                  title="Back to Bill Search"
                >
                  <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5 text-amber-700" />
                </button>
              ) : (
                <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center text-white shadow-lg shadow-amber-500/25 shrink-0">
                  <QrCode className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
              )}

              <div>
                <DialogTitle className="text-base sm:text-xl font-black text-slate-900 tracking-tight flex items-center gap-1.5">
                  {step === 'SEARCH' ? '1. Search & Select Bill' : '2. Scan Vault Packet Sticker'}
                  <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
                </DialogTitle>
                <DialogDescription className="text-[11px] sm:text-xs font-semibold text-slate-500 line-clamp-1">
                  {step === 'SEARCH' 
                    ? 'Search bill number, customer or NIC to select ticket' 
                    : `Attach vault sticker QR to Bill #${effectiveBillNo}`
                  }
                </DialogDescription>
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* STEPPER PILLS (MOBILE / TABLET TOUCH TARGETS) */}
        <div className="flex items-center gap-1.5 sm:gap-2 pt-2 pb-1 shrink-0">
          <button
            type="button"
            onClick={() => {
              if (step === 'SCAN') {
                stopCamera();
                setStep('SEARCH');
              }
            }}
            className={`flex-1 py-2 px-3 rounded-xl text-[11px] sm:text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer min-h-[38px] active:scale-[0.99] ${
              step === 'SEARCH'
                ? 'bg-amber-500 text-slate-950 shadow-xs ring-2 ring-amber-500/30'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            1. Search Bill
          </button>

          <button
            type="button"
            disabled={!selectedPawn && !targetBillNo}
            onClick={() => {
              setStep('SCAN');
              if (activeTab === 'camera') setTimeout(() => startCamera(), 250);
            }}
            className={`flex-1 py-2 px-3 rounded-xl text-[11px] sm:text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer min-h-[38px] disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.99] ${
              step === 'SCAN'
                ? 'bg-amber-500 text-slate-950 shadow-xs ring-2 ring-amber-500/30'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            2. Add QR Code
          </button>
        </div>

        {/* ================= STEP 1: SEARCH BILL NUMBER ================= */}
        {step === 'SEARCH' && (
          <div className="flex-1 overflow-y-auto overscroll-contain space-y-3 py-1 pr-1 -mr-1">
            {/* Search Input Box */}
            <div className="relative">
              <Search className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <Input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Type Bill No (e.g. BRL-0001), Customer, NIC..."
                className="h-12 pl-10 pr-10 bg-slate-50 border-slate-200 text-slate-900 font-bold text-sm sm:text-base rounded-2xl focus:bg-white focus:ring-amber-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="w-8 h-8 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-700 flex items-center justify-center absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Quick Status Filter Pills for Fast Vault Audits */}
            <div className="flex flex-wrap items-center gap-1.5 pb-0.5">
              <button
                type="button"
                onClick={() => setFilterStickerStatus('ALL')}
                className={`px-3 py-1.5 rounded-xl text-[10px] sm:text-[11px] font-black uppercase tracking-wider whitespace-nowrap transition-all cursor-pointer ${
                  filterStickerStatus === 'ALL'
                    ? 'bg-slate-800 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                All Tickets
              </button>
              <button
                type="button"
                onClick={() => setFilterStickerStatus('NO_STICKER')}
                className={`px-3 py-1.5 rounded-xl text-[10px] sm:text-[11px] font-black uppercase tracking-wider whitespace-nowrap transition-all cursor-pointer flex items-center gap-1 ${
                  filterStickerStatus === 'NO_STICKER'
                    ? 'bg-amber-500 text-slate-950 font-black shadow-xs'
                    : 'bg-amber-50 text-amber-800 border border-amber-200/80 hover:bg-amber-100'
                }`}
              >
                <AlertCircle className="w-3 h-3 text-amber-700" />
                Needs Sticker
              </button>
              <button
                type="button"
                onClick={() => setFilterStickerStatus('HAS_STICKER')}
                className={`px-3 py-1.5 rounded-xl text-[10px] sm:text-[11px] font-black uppercase tracking-wider whitespace-nowrap transition-all cursor-pointer flex items-center gap-1 ${
                  filterStickerStatus === 'HAS_STICKER'
                    ? 'bg-emerald-600 text-white font-black shadow-xs'
                    : 'bg-emerald-50 text-emerald-800 border border-emerald-200/80 hover:bg-emerald-100'
                }`}
              >
                <Check className="w-3 h-3 text-emerald-600" />
                Has Sticker
              </button>
            </div>

            {/* Results Counter / Loading Indicator */}
            <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-wider text-slate-500 px-1">
              <span>{searchQuery ? 'Matching Tickets' : 'Recent Tickets'} ({searchResults.length})</span>
              {isSearchingRemote && (
                <span className="text-amber-600 font-bold flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Searching...
                </span>
              )}
            </div>

            {/* Results Scroll Area (Mobile / Tablet Optimized List) */}
            <div className="space-y-2 max-h-[44vh] sm:max-h-[48vh] overflow-y-auto overscroll-contain pr-0.5">
              {searchResults.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 space-y-2">
                  <Search className="w-8 h-8 text-slate-300 mx-auto" />
                  <p className="text-xs font-bold text-slate-500">
                    {searchQuery ? `No pawn bills found matching "${searchQuery}"` : 'Type a bill number or customer name to begin'}
                  </p>
                </div>
              ) : (
                searchResults.map((pawn) => {
                  const cust = pawn.clients?.first_name || pawn.customer_name || 'Valued Customer';
                  const nic = pawn.clients?.national_id || '';
                  const wt = pawn.weight_mg ? `${pawn.weight_mg} mg` : (pawn.weight ? `${Math.round(pawn.weight * 1000)} mg` : (pawn.weight_grams ? `${Math.round(Number(pawn.weight_grams) * 1000)} mg` : ''));
                  const hasSticker = Boolean(pawn.packet_qr);

                  return (
                    <button
                      key={pawn.id || pawn.bill_no}
                      type="button"
                      onClick={() => handleSelectBill(pawn)}
                      className="w-full text-left p-3 sm:p-3.5 bg-white hover:bg-amber-50/70 border border-slate-200 hover:border-amber-300 rounded-2xl transition-all shadow-2xs hover:shadow-sm cursor-pointer flex items-center justify-between gap-3 group active:scale-[0.98] focus:ring-2 focus:ring-amber-500"
                    >
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-black text-sm sm:text-base text-slate-900 group-hover:text-amber-700">
                            Bill #{pawn.bill_no || pawn.id.substring(0, 8).toUpperCase()}
                          </span>
                          {pawn.branch_id && (
                            <Badge variant="outline" className="bg-slate-100 text-slate-700 font-mono text-[9px] font-black px-1.5 py-0.5">
                              {pawn.branch_id}
                            </Badge>
                          )}
                          {hasSticker ? (
                            <Badge className="bg-emerald-50 text-emerald-800 border-emerald-200 font-mono text-[9px] font-bold gap-1 px-1.5 py-0.5">
                              <Tag className="w-2.5 h-2.5 text-emerald-600" />
                              {pawn.packet_qr}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200 text-[9px] font-bold px-1.5 py-0.5">
                              No Sticker
                            </Badge>
                          )}
                        </div>

                        <div className="flex items-center gap-2 sm:gap-3 text-xs text-slate-600 truncate">
                          <span className="font-bold text-slate-800 truncate flex items-center gap-1">
                            <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            {cust} {nic ? `(${nic})` : ''}
                          </span>
                          {wt && (
                            <span className="text-amber-800 font-black shrink-0 flex items-center gap-1">
                              <Scale className="w-3.5 h-3.5 text-amber-600" />
                              {wt}
                            </span>
                          )}
                        </div>

                        {pawn.description && (
                          <p className="text-[11px] text-slate-500 font-medium truncate">
                            {pawn.description}
                          </p>
                        )}
                      </div>

                      <div className="shrink-0 flex items-center text-amber-600 group-hover:translate-x-0.5 transition-transform">
                        <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-amber-600" />
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* ================= STEP 2: SCAN OR ATTACH QR ================= */}
        {step === 'SCAN' && (
          <div className="flex-1 overflow-y-auto overscroll-contain space-y-3 py-1 pr-1 -mr-1">
            {/* Selected Bill Card */}
            <div className="p-3 sm:p-3.5 rounded-2xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/80 flex items-center justify-between gap-3 shadow-2xs">
              <div className="space-y-0.5 min-w-0">
                <div className="text-[10px] font-black uppercase tracking-wider text-amber-700">Selected Pawn Bill</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-base sm:text-lg font-black text-slate-900 font-mono">
                    Bill #{effectiveBillNo}
                  </span>
                  {effectiveCustomer && (
                    <Badge variant="outline" className="bg-white/90 text-slate-800 border-amber-300 font-bold text-[10px] sm:text-[11px] truncate max-w-[130px] sm:max-w-[160px]">
                      {effectiveCustomer}
                    </Badge>
                  )}
                </div>
                {effectiveWeight && (
                  <div className="text-[11px] font-bold text-amber-900 flex items-center gap-1">
                    <Scale className="w-3 h-3 text-amber-600" /> Total Weight: {effectiveWeight}
                  </div>
                )}
              </div>

              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  stopCamera();
                  setStep('SEARCH');
                }}
                className="h-8 px-2.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 rounded-xl shrink-0 cursor-pointer shadow-2xs"
              >
                Change Bill
              </Button>
            </div>

            {/* Current Sticker Status (if already paired) */}
            {effectiveQr && (
              <div className="p-2.5 sm:p-3 bg-emerald-50 rounded-2xl border border-emerald-200 flex items-center justify-between gap-2 shadow-2xs">
                <div className="flex items-center gap-2 min-w-0">
                  <Tag className="w-4 h-4 text-emerald-600 shrink-0" />
                  <div className="min-w-0">
                    <span className="text-[10px] font-black uppercase text-emerald-800 block">Current Packet Sticker:</span>
                    <span className="font-mono text-xs font-black text-slate-900 truncate block">
                      {effectiveQr}
                    </span>
                  </div>
                </div>
                <Badge className="bg-emerald-600 text-white font-bold text-[10px] shrink-0">
                  Paired
                </Badge>
              </div>
            )}

            {/* Tab Switcher: Camera vs Barcode Gun */}
            <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-2xl">
              <button
                type="button"
                onClick={() => setActiveTab('camera')}
                className={`flex-1 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer min-h-[38px] ${
                  activeTab === 'camera' 
                    ? 'bg-white text-slate-900 shadow-xs' 
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Camera className="w-4 h-4" /> Live Camera
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('manual');
                  stopCamera();
                }}
                className={`flex-1 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer min-h-[38px] ${
                  activeTab === 'manual' 
                    ? 'bg-white text-slate-900 shadow-xs' 
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Tag className="w-4 h-4" /> Barcode Gun / Input
              </button>
            </div>

            {/* Live Camera Viewport (Mobile & Tablet Friendly Aspect Box) */}
            {activeTab === 'camera' && (
              <div className="space-y-2">
                <div className="relative w-full max-w-[270px] sm:max-w-[310px] aspect-square bg-slate-900 rounded-2xl overflow-hidden flex flex-col items-center justify-center border-2 border-dashed border-amber-400/50 mx-auto shadow-inner">
                  <div id={readerElementId} className="w-full h-full" />
                  
                  {!isCameraActive && !cameraError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/85 text-white gap-2 z-10">
                      <Camera className="w-8 h-8 text-amber-400 animate-pulse" />
                      <p className="text-xs font-semibold text-slate-300">Activating camera feed...</p>
                    </div>
                  )}

                  {cameraError && (
                    <div className="absolute inset-0 p-4 flex flex-col items-center justify-center bg-slate-950/90 text-center gap-2 z-10">
                      <AlertTriangle className="w-7 h-7 text-rose-400" />
                      <p className="text-xs text-rose-200 font-medium px-2">{cameraError}</p>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={startCamera}
                        className="mt-1 bg-white/10 text-white border-white/20 hover:bg-white/20 text-xs font-bold"
                      >
                        Retry Camera
                      </Button>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium px-1">
                  <span>Hold packet sticker QR code in frame</span>
                  {isCameraActive && (
                    <button
                      type="button"
                      onClick={startCamera}
                      className="text-amber-600 hover:text-amber-700 font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" /> Refresh Feed
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Barcode Gun / Manual Input */}
            {activeTab === 'manual' && (
              <div className="space-y-2 py-1">
                <label className="text-xs font-black uppercase tracking-wider text-slate-700 block">
                  Scan with Barcode Gun or Enter Sticker Code
                </label>
                <div className="relative">
                  <Input
                    autoFocus
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (manualCode.trim()) {
                          playBeep();
                          handleSavePacketQr();
                        }
                      }
                    }}
                    placeholder="e.g. PKT-00129, RUP-GOLD-8492, or QR payload"
                    className="h-12 bg-white border-slate-200 text-slate-900 font-mono text-sm sm:text-base rounded-2xl pl-10 focus:ring-amber-500"
                  />
                  <QrCode className="w-5 h-5 text-slate-400 absolute left-3 top-3.5" />
                </div>
                <p className="text-[11px] text-slate-500 font-medium">
                  Trigger hardware scanner gun directly into this input box.
                </p>
              </div>
            )}

            {/* Scanned Result Banner */}
            {(scannedCode || manualCode) && (
              <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-400/40 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-amber-800 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    Detected Sticker Code
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setScannedCode('');
                      setManualCode('');
                      if (activeTab === 'camera') startCamera();
                    }}
                    className="text-[10px] font-bold text-slate-500 hover:text-slate-800 underline cursor-pointer"
                  >
                    Clear / Re-scan
                  </button>
                </div>
                <div className="font-mono text-xs sm:text-sm font-black text-slate-900 break-all bg-white p-2.5 rounded-xl border border-amber-200">
                  {manualCode || scannedCode}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ROLE SECURITY NOTICE IF NOT AUDITOR */}
        {!isAuditorOrAdmin && (
          <div className="p-2.5 bg-amber-50 rounded-2xl border border-amber-200 flex items-center gap-2 text-xs font-bold text-amber-900 shrink-0 my-1">
            <Lock className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Read-Only mode: Only Auditor accounts can attach or delete packet stickers.</span>
          </div>
        )}

        {/* MODAL FOOTER / ACTIONS (MOBILE & TABLET STICKY FOOTER) */}
        <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 shrink-0">
          <div>
            {step === 'SCAN' && effectiveQr && isAuditorOrAdmin && (
              <Button
                type="button"
                variant="outline"
                disabled={isDeleting || isSubmitting}
                onClick={handleDeletePacketQr}
                className="h-11 px-3 sm:px-4 rounded-2xl text-xs font-black uppercase tracking-wider text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border-rose-200 flex items-center gap-1.5 cursor-pointer active:scale-95"
                title="Permanently remove packet sticker from this bill"
              >
                {isDeleting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete QR
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="h-11 px-4 sm:px-5 rounded-2xl text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
            >
              Cancel
            </Button>

            {step === 'SCAN' && (
              <Button
                type="button"
                disabled={(!manualCode && !scannedCode) || isSubmitting || !isAuditorOrAdmin}
                onClick={handleSavePacketQr}
                className="h-11 px-4 sm:px-6 rounded-2xl text-xs font-black uppercase tracking-wider bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white shadow-lg shadow-amber-500/25 flex items-center gap-1.5 sm:gap-2 cursor-pointer disabled:opacity-50 active:scale-95"
              >
                {isSubmitting ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <ShieldCheck className="w-4 h-4" />
                )}
                Save Sticker
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
