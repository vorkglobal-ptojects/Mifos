'use client';
import { getAuthHeaders } from '@/lib/getAuthHeaders';
import { getBranchSearchTerms, normalizeBranchId, isNationalId, normalizeNationalId, stripBranchPrefix, extractNumericBillNo, isSameNumericBill } from '@/lib/branch-mapping';

import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { 
  Plus, Search, FileText, Package, TrendingUp, AlertTriangle,
  Pencil, Trash2, RefreshCcw, Printer, Filter, UserCheck, Calculator, Coins, Scale, Download, Send, Smartphone, Bluetooth, Camera, MapPin, MoreVertical, ShieldCheck, Check, Lock
} from "lucide-react"
import { WebBluetoothTransport } from "@/lib/bluetooth/WebBluetoothTransport";
import { EscPosAdapter } from "@/lib/bluetooth/EscPosAdapter";
import { PawnBill80mmReceipt } from "@/components/receipts/PawnBill80mmReceipt";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { ItemEvaluationModal } from "@/components/ItemEvaluationModal"
import { CustomerSelectionModal } from "@/components/CustomerSelectionModal"
import ChangeRequestModal from "@/components/ChangeRequestModal"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "sonner"
import { buildPawnReminderSms } from "@/lib/sms"
import { compressImage } from "@/lib/image-compression"

export default function PawnesPage() {
  const [isOpen, setIsOpen]       = useState(false);
  const [isEvaluationOpen, setIsEvaluationOpen] = useState(false);
  const [isCustomerStepOpen, setIsCustomerStepOpen] = useState(false);
  const [evaluationData, setEvaluationData] = useState<any>(null);

  // Inline Quick Customer Registration (inside pawn modal)
  const [showInlineReg, setShowInlineReg]         = useState(false);
  const [inlineNic, setInlineNic]                 = useState('');
  const [inlineName, setInlineName]               = useState('');
  const [inlinePhone, setInlinePhone]             = useState('');
  const [inlineAddress, setInlineAddress]         = useState('');
  const [isSavingCustomer, setIsSavingCustomer]   = useState(false);

  // KYC Photo Upload Step (after inline registration)
  const [showKycStep, setShowKycStep]             = useState(false);
  const [newClientId, setNewClientId]             = useState<string>('');

  // Maker-Checker Change Request Modal State
  const [changeRequestTarget, setChangeRequestTarget] = useState<{
    isOpen: boolean;
    actionType: 'UPDATE' | 'DELETE';
    pawn: any;
    proposedData?: Record<string, any>;
  }>({
    isOpen: false,
    actionType: 'DELETE',
    pawn: null,
    proposedData: {}
  });

  const openChangeRequest = (pawn: any, actionType: 'UPDATE' | 'DELETE', proposedData?: Record<string, any>) => {
    setChangeRequestTarget({
      isOpen: true,
      actionType,
      pawn,
      proposedData
    });
  };
  const [kycActiveTab, setKycActiveTab]           = useState<'front'|'back'|'sign'>('front');
  const [kycFront, setKycFront]                   = useState<string|null>(null);
  const [kycBack, setKycBack]                     = useState<string|null>(null);
  const [kycSign, setKycSign]                     = useState<string|null>(null);
  const [kycCameraOn, setKycCameraOn]             = useState(false);
  const [isSavingKyc, setIsSavingKyc]             = useState(false);
  const kycVideoRef                               = useRef<HTMLVideoElement>(null);
  const kycStreamRef                              = useRef<MediaStream|null>(null);
  const [pawns, setPawns]         = useState<any[]>([]);
  const [branches, setBranches]   = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [isSaving, setIsSaving]   = useState(false);
  const [search, setSearch]       = useState('');
  const [editingPawn, setEditingPawn] = useState<any>(null);

  // Pawn Redemption Dialog State
  const [isRedeemOpen, setIsRedeemOpen] = useState(false);
  const [redeemingPawn, setRedeemingPawn] = useState<any>(null);
  const [redeemDays, setRedeemDays] = useState(15);
  const [redeemInsurance, setRedeemInsurance] = useState('50');
  const [isRedeeming, setIsRedeeming] = useState(false);

  // Pawn Details & Print Dialog State (Fully Editable Override Support)
  const [detailsPawn, setDetailsPawn]                         = useState<any>(null);
  const [detailsDays, setDetailsDays]                         = useState<number>(1);
  const [detailsInsurance, setDetailsInsurance]               = useState<string>('50');
  const [detailsCustomRate, setDetailsCustomRate]             = useState<string>('');
  const [detailsCustomInterest, setDetailsCustomInterest]     = useState<string>('');
  const [detailsCustomSettlement, setDetailsCustomSettlement] = useState<string>('');
  const [detailsCustomAppraised, setDetailsCustomAppraised]   = useState<string>('');
  const [detailsCustomDisbursed, setDetailsCustomDisbursed]   = useState<string>('');

  // User context
  const [branchId, setBranchId]       = useState('');
  const [userId, setUserId]           = useState('');
  const [userRole, setUserRole]       = useState('TELLER');

  // Branch locked for tellers and non-global branch staff: strictly locked to home branch pawns only
  const isBranchLocked = userRole === 'TELLER' || (
    userRole !== 'ADMIN' && userRole !== 'AUDITOR' &&
    Boolean(branchId) && branchId !== 'HQ' && branchId !== 'DHW' && branchId !== 'ALL'
  );

  // Multi-option filters
  const [filterBranch, setFilterBranch]           = useState('ALL');
  const [filterDescription, setFilterDescription] = useState('ALL');
  const [filterStatus, setFilterStatus]           = useState('ALL');
  const [selectedBranches, setSelectedBranches]   = useState<string[]>([]);
  const [isBranchFilterOpen, setIsBranchFilterOpen] = useState(false);
  const branchDropdownRef                         = useRef<HTMLDivElement>(null);
  const [redemptionReceiptData, setRedemptionReceiptData] = useState<any>(null);

  // Close branch dropdown popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (branchDropdownRef.current && !branchDropdownRef.current.contains(event.target as Node)) {
        setIsBranchFilterOpen(false);
      }
    };
    if (isBranchFilterOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isBranchFilterOpen]);

  // Weight & KYC Photos Viewer Modal State
  const [viewPhotoModal, setViewPhotoModal] = useState<{
    isOpen: boolean;
    billNo: string;
    customerName?: string;
    airPhoto?: string | null;
    waterPhoto?: string | null;
    airWeight?: number | string | null;
    waterWeight?: number | string | null;
    kycFront?: string | null;
    kycBack?: string | null;
    kycSignature?: string | null;
  }>({
    isOpen: false,
    billNo: '',
    customerName: '',
    airPhoto: null,
    waterPhoto: null,
    kycFront: null,
    kycBack: null,
    kycSignature: null,
  });

  const handleOpenPhotoViewer = async (pawn: any) => {
    let air = pawn.air_weight_photo_url || null;
    let water = pawn.water_weight_photo_url || null;
    let aw = pawn.evaluation_air_weight || pawn.weight_mg || null;
    let ww = pawn.evaluation_water_weight || null;

    const cleanBill = getBillNo(pawn);
    if (!air && !water && cleanBill) {
      try {
        const res = await fetch(`/api/evaluations?billNo=${encodeURIComponent(cleanBill)}`);
        const json = await res.json();
        if (json.evaluations && json.evaluations.length > 0) {
          const ev = json.evaluations[0];
          air = ev.air_weight_photo_url;
          water = ev.water_weight_photo_url;
          aw = ev.air_weight;
          ww = ev.water_weight;
        }
      } catch (err) {
        console.warn('Could not fetch weight photos:', err);
      }
    }

    // Extract customer KYC photos
    let kycFront: string | null = null;
    let kycBack: string | null = null;
    let kycSignature: string | null = null;
    let cName: string = '';

    const cid = pawn.client_id || '';
    const client = pawn.clients || clientsList.find(c => 
      String(c.id).toLowerCase() === String(cid).toLowerCase() || 
      String(c.national_id || c.nationalId || '').toLowerCase() === String(cid).toLowerCase()
    );

    if (client) {
      cName = `${client.first_name || client.firstName || ''} ${client.last_name || client.lastName || ''}`.trim();
      kycSignature = client.signature_image || client.signatureImage || null;
      const rawNic = client.nic_image || client.nicImage;
      if (rawNic) {
        try {
          const parsed = typeof rawNic === 'string' ? JSON.parse(rawNic) : rawNic;
          kycFront = parsed.front || null;
          kycBack = parsed.back || null;
        } catch {
          if (typeof rawNic === 'string' && rawNic.startsWith('data:image')) {
            kycFront = rawNic;
          }
        }
      }
    }

    setViewPhotoModal({
      isOpen: true,
      billNo: cleanBill || 'Pawn Collateral',
      customerName: cName || pawn.customer_name || 'Customer',
      airPhoto: air,
      waterPhoto: water,
      airWeight: aw,
      waterWeight: ww,
      kycFront,
      kycBack,
      kycSignature,
    });
  };

  // Form state
  const BILL_PREFIXES = ['1R', '3M', '3R', '6R', '12R', '6M', 'A'];
  const ITEM_OPTIONS = [
    { code: 'CH', label: 'Chain' },
    { code: 'PP', label: 'Pendant' },
    { code: 'PR', label: 'Ring' },
    { code: 'NL', label: 'Necklace' },
    { code: 'EAR', label: 'Earrings' },
    { code: 'BRC', label: 'Bracelet' },
    { code: 'BKT', label: 'Bangles' },
    { code: 'COIN', label: 'Gold Coin / Bar' },
    { code: 'OTHER', label: 'Other' }
  ];

  const handlePrefixChange = (pref: string) => {
    setBillPrefix(pref);
    if (pref === '1R') setPeriodMonths('1');
    else if (pref === '3M' || pref === '3R') setPeriodMonths('3');
    else if (pref === '6M' || pref === '6R') setPeriodMonths('6');
    else if (pref === '12R' || pref === 'A') setPeriodMonths('12');
    else setPeriodMonths('1');
  };

  const [billPrefix, setBillPrefix]     = useState('1R');
  const [billNo, setBillNo]             = useState('');
  const [itemType, setItemType]         = useState('CH');
  const [clientId, setClientId]         = useState('');
  const [description, setDescription]   = useState('');
  const [appraisal, setAppraisal]       = useState('');
  const [amount, setAmount]             = useState('');

  // Client Extended Details
  const [clientPhone, setClientPhone]     = useState('');
  const [clientAddress, setClientAddress] = useState('');

  // Dedicated Grams & Milligrams Weight & Period State
  const [weightGrams, setWeightGrams]   = useState('');
  const [weightMg, setWeightMg]         = useState('');
  const [periodMonths, setPeriodMonths] = useState('1');
  const [pawnDate, setPawnDate]         = useState<string>(() => new Date().toISOString().split('T')[0]);

  // Multi-Item Pawn State (Milligrams mg standard)
  const [itemsList, setItemsList] = useState<any[]>([
    { itemType: 'CH', purity: '22K', description: '', customType: '', weightMg: '', appraisedValue: '' }
  ]);

  const handleAddItem = () => {
    setItemsList(prev => [
      ...prev,
      { itemType: 'CH', purity: '22K', description: '', customType: '', weightMg: '', appraisedValue: '' }
    ]);
  };

  const handleRemoveItem = (idx: number) => {
    if (itemsList.length <= 1) return;
    setItemsList(prev => {
      const copy = prev.filter((_, i) => i !== idx);
      const totMg = copy.reduce((s, item) => s + (parseFloat(item.weightMg) || 0), 0);
      setWeightMg(totMg > 0 ? String(totMg) : '');
      const totAppraised = copy.reduce((s, item) => s + (parseFloat(item.appraisedValue) || 0), 0);
      if (totAppraised > 0) setAppraisal(String(totAppraised));
      return copy;
    });
  };

  const handleUpdateItem = (idx: number, field: string, val: string) => {
    setItemsList(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [field]: val };

      const totMg = copy.reduce((s, item) => s + (parseFloat(item.weightMg) || 0), 0);
      setWeightMg(totMg > 0 ? String(totMg) : '');

      const totAppraised = copy.reduce((s, item) => s + (parseFloat(item.appraisedValue) || 0), 0);
      if (totAppraised > 0) setAppraisal(String(totAppraised));

      return copy;
    });
  };

  // Gold Calculator State
  const [showGoldCalc, setShowGoldCalc] = useState(false);
  const [goldPurity, setGoldPurity]     = useState('22K');
  const [goldWeight, setGoldWeight]     = useState('');
  const [goldRate, setGoldRate]         = useState('23500'); // Default market price per gram LKR
  const [goldLtv, setGoldLtv]           = useState('80'); // Default LTV %

  const handleWeightChange = (mgVal: string) => {
    setWeightMg(mgVal);
    const mg = parseFloat(mgVal) || 0;
    const totalGrams = mg / 1000;
    setWeightGrams(totalGrams > 0 ? String(totalGrams) : '');
    setGoldWeight(totalGrams > 0 ? String(totalGrams) : '');
  };

  // Client lookup maps: { nationalId/id -> "First Last" } and { id -> NIC }
  const [clientsMap, setClientsMap]     = useState<Record<string, string>>({});
  const [clientsNicMap, setClientsNicMap] = useState<Record<string, string>>({});
  const [resolvedName, setResolvedName] = useState('');
  const [clientsList, setClientsList]   = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);

  const getClientNic = (pawn: any) => {
    if (!pawn) return '—';
    const cid = String(pawn.client_id || '').toLowerCase().trim();
    if (clientsNicMap[cid]) return clientsNicMap[cid];
    if (pawn.clients?.national_id) return pawn.clients.national_id;
    if (pawn.clients?.nationalId) return pawn.clients.nationalId;
    if (pawn.clients?.nic) return pawn.clients.nic;

    // Check clientsList directly if map didn't resolve it
    if (clientsList && clientsList.length > 0) {
      const matchClient = clientsList.find((c: any) => {
        const cId = String(c.id || '').toLowerCase().trim();
        const cNic = String(c.nationalId || c.national_id || c.nic || '').toLowerCase().trim();
        const cNum = String(c.clientNumber || c.client_number || '').toLowerCase().trim();
        return (cId && cId === cid) || (cNic && cNic === cid) || (cNum && cNum === cid);
      });
      if (matchClient) {
        const foundNic = matchClient.nationalId || matchClient.national_id || matchClient.nic;
        if (foundNic) return foundNic;
      }
    }
    return String(pawn.client_id || '—');
  };

  const getBillNo = (pawn: any) => {
    if (!pawn) return '—';
    if (pawn.display_bill_no && String(pawn.display_bill_no).trim()) return String(pawn.display_bill_no).trim();

    const rawBill = pawn.bill_no ? String(pawn.bill_no).trim() : '';
    const isPlaceholder = !rawBill || rawBill.startsWith('REC-') || rawBill.startsWith('TEMP-');

    // If description has a real bill number prefix (e.g. "1R 0101 | Chain (0.61mg)"), prioritize it over placeholder
    const desc = String(pawn.description || '');
    const match = desc.match(/^([A-Za-z0-9]+\s+[0-9A-Za-z]+)\s*\|?\s*(.*)/);
    if (match && match[1]) {
      const descBill = stripBranchPrefix(match[1].trim());
      if (isPlaceholder || !rawBill) return descBill;
    }

    if (rawBill && !isPlaceholder) return stripBranchPrefix(rawBill);
    if (match && match[1]) return stripBranchPrefix(match[1].trim());
    if (rawBill) return stripBranchPrefix(rawBill);

    const pid = String(pawn.id || '');
    return `#${pid.substring(0, 8).toUpperCase()}`;
  };

  const getCleanDescription = (pawn: any) => {
    if (!pawn) return '—';
    const desc = String(pawn.description || '');
    const match = desc.match(/^([A-Za-z0-9]+\s+[0-9A-Za-z]+)\s*\|\s*(.*)/);
    if (match && match[2]) return match[2].trim();
    return desc;
  };

  const isNicFormat = (str: string): boolean => {
    if (!str) return true;
    const clean = str.trim();
    if (/^\d{9,12}[vVxX]?$/.test(clean)) return true;
    return false;
  };

  const getCustomerName = (pawn: any): string => {
    if (!pawn) return '';

    const pawnCidStr = String(pawn.client_id || '').toLowerCase().trim();

    const directName = pawn.client_name || pawn.customer_name || pawn.customerName || pawn.clientName;
    if (directName && !isNicFormat(directName)) return directName;

    if (pawn.clients) {
      const cName = `${pawn.clients.firstName || pawn.clients.first_name || ''} ${pawn.clients.lastName || pawn.clients.last_name || ''}`.trim() || pawn.clients.name || pawn.clients.full_name;
      if (cName && !isNicFormat(cName)) return cName;
    }
    if (pawn.client) {
      const cName = `${pawn.client.firstName || pawn.client.first_name || ''} ${pawn.client.lastName || pawn.client.last_name || ''}`.trim() || pawn.client.name || pawn.client.full_name;
      if (cName && !isNicFormat(cName)) return cName;
    }

    if (pawnCidStr && clientsMap[pawnCidStr]) {
      const mappedName = clientsMap[pawnCidStr];
      if (mappedName && !isNicFormat(mappedName)) return mappedName;
    }

    if (clientsList && clientsList.length > 0 && pawnCidStr) {
      const matchedClient = clientsList.find((c: any) => {
        const cId = String(c.id || '').toLowerCase().trim();
        const cNic = String(c.nationalId || c.national_id || c.nic || '').toLowerCase().trim();
        return cId === pawnCidStr || cNic === pawnCidStr;
      });
      if (matchedClient) {
        const matchedName = `${matchedClient.firstName || matchedClient.first_name || ''} ${matchedClient.lastName || matchedClient.last_name || ''}`.trim() || matchedClient.name || matchedClient.full_name;
        if (matchedName && !isNicFormat(matchedName)) return matchedName;
      }
    }

    return '';
  };

  const loadUser = () => {
    const stored = localStorage.getItem('user');
    if (stored) {
      const u = JSON.parse(stored);
      setBranchId(u.branchId || '');
      setUserId(u.id || '');
      const rawRole = (localStorage.getItem('user_role') || u.role || 'TELLER').toUpperCase().trim();
      const effectiveRole = ['ADMIN', 'MANAGER', 'AUDITOR'].includes(rawRole) ? rawRole : 'TELLER';
      setUserRole(effectiveRole);
      if (effectiveRole === 'TELLER' && u.branchId) {
        setFilterBranch(u.branchId);
      }
      return u;
    }
    return null;
  };

  const loadBranches = async () => {
    try {
      const res = await fetch('/api/branches');
      if (res.ok) {
        const data = await res.json();
        setBranches([{ id: 'ALL', name: 'All Branches' }, ...data]);
      }
    } catch (e) { console.error('Failed to load branches', e); }
  };

  // Load clients across all branches for fast lookups & cross-branch customer pawn creation
  const loadClients = async (forceRefresh = false) => {
    try {
      const headers = getAuthHeaders();
      const freshParam = forceRefresh ? `&fresh=${Date.now()}` : '';
      const res = await fetch(`/api/clients?branchId=ALL&minimal=true${freshParam}`, { headers, cache: 'no-store' });
      if (res.ok) {
        const data: any[] = await res.json();
        setClientsList(data);
        const map: Record<string, string> = {};
        const nMap: Record<string, string> = {};
        data.forEach(c => {
          const rawName = `${c.firstName || c.first_name || ''} ${c.lastName || c.last_name || ''}`.trim();
          const name = rawName || c.name || c.full_name || c.customer_name || c.client_name || 'Client';
          const rawNic = String(c.nationalId || c.national_id || c.nic || c.id || '').trim();
          const cleanNic = stripBranchPrefix(rawNic).trim();
          const phone = String(c.phone || c.mobile || '').replace(/\D/g, '');

          if (rawNic) {
            map[rawNic.toLowerCase()] = name;
            nMap[rawNic.toLowerCase()] = cleanNic || rawNic;
            const rDig = rawNic.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (rDig) map[rDig] = name;
          }
          if (cleanNic) {
            map[cleanNic.toLowerCase()] = name;
            nMap[cleanNic.toLowerCase()] = cleanNic;
            const cDig = cleanNic.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (cDig) map[cDig] = name;
          }
          if (phone && phone.length >= 7) {
            map[phone] = name;
            if (phone.startsWith('0')) map[phone.slice(1)] = name;
          }
          if (c.id != null) {
            const cidStr = String(c.id).toLowerCase().trim();
            map[cidStr] = name;
            nMap[cidStr] = cleanNic || rawNic;
          }
          if (c.clientNumber != null) {
            const cNumStr = String(c.clientNumber).toLowerCase().trim();
            map[cNumStr] = name;
            nMap[cNumStr] = cleanNic || rawNic;
          }
          if (c.client_number != null) {
            const cNumStr = String(c.client_number).toLowerCase().trim();
            map[cNumStr] = name;
            nMap[cNumStr] = cleanNic || rawNic;
          }
        });
        setClientsMap(map);
        setClientsNicMap(nMap);
      }
    } catch (e) { console.error('Failed to load clients map', e); }
  };

  const loadPawns = async (u?: any, overrideBranches?: string[] | string) => {
    try {
      setLoading(true);
      const user = u || loadUser();
      const headers = getAuthHeaders();
      const rawRole = (localStorage.getItem('user_role') || user?.role || userRole || 'TELLER').toUpperCase().trim();
      const effectiveRole = ['ADMIN', 'MANAGER', 'AUDITOR'].includes(rawRole) ? rawRole : 'TELLER';
      const uBranch = user?.branchId || branchId;
      const locked = effectiveRole === 'TELLER' || (
        effectiveRole !== 'ADMIN' && effectiveRole !== 'AUDITOR' &&
        Boolean(uBranch) && uBranch !== 'HQ' && uBranch !== 'DHW' && uBranch !== 'ALL'
      );

      let activeBranches: string[] = [];
      if (locked && uBranch) {
        // Tellers and branch staff are strictly locked to their home branch
        activeBranches = [normalizeBranchId(uBranch).toUpperCase()];
      } else if (overrideBranches !== undefined) {
        activeBranches = Array.isArray(overrideBranches) ? overrideBranches : [overrideBranches];
      } else if (selectedBranches.length > 0) {
        activeBranches = selectedBranches;
      } else if (uBranch && uBranch !== 'DHW' && uBranch !== 'HQ' && uBranch !== 'ALL') {
        activeBranches = [normalizeBranchId(uBranch).toUpperCase()];
      } else {
        activeBranches = ['ALL'];
      }

      const isAll = activeBranches.includes('ALL');
      const branchParam = isAll ? 'ALL' : activeBranches.join(',');

      const params = new URLSearchParams({
        branchId: branchParam,
        role: effectiveRole,
        filterBranch: branchParam,
      });
      const res = await fetch(`/api/pawns?${params}`, { headers, cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setPawns(Array.isArray(data) ? data : []);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to load pawn tickets');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const toggleBranch = (bId: string) => {
    if (isBranchLocked) return;
    const cleanId = bId.trim().toUpperCase();
    let next: string[];

    if (cleanId === 'ALL') {
      if (selectedBranches.includes('ALL')) {
        next = branchId ? [branchId.toUpperCase()] : [];
      } else {
        next = ['ALL'];
      }
    } else {
      if (selectedBranches.includes('ALL')) {
        next = branchId && branchId.toUpperCase() !== cleanId
          ? [branchId.toUpperCase(), cleanId]
          : [cleanId];
      } else {
        const exists = selectedBranches.some(b => b.toUpperCase() === cleanId);
        if (exists) {
          next = selectedBranches.filter(b => b.toUpperCase() !== cleanId);
          if (next.length === 0 && branchId) {
            next = [branchId.toUpperCase()];
          }
        } else {
          next = [...selectedBranches, cleanId];
        }
      }
    }

    setSelectedBranches(next);
    setFilterBranch(next.includes('ALL') ? 'ALL' : next.join(','));
    loadPawns(undefined, next);
  };

  const selectHomeBranchOnly = () => {
    if (isBranchLocked) return;
    const home = branchId ? branchId.toUpperCase() : 'HQ';
    setSelectedBranches([home]);
    setFilterBranch(home);
    loadPawns(undefined, [home]);
  };

  const selectAllBranches = () => {
    if (isBranchLocked) return;
    setSelectedBranches(['ALL']);
    setFilterBranch('ALL');
    loadPawns(undefined, ['ALL']);
  };

  const getBranchButtonLabel = () => {
    if (isBranchLocked) {
      const code = branchId ? branchId.toUpperCase() : 'HOME';
      const bObj = branches.find(b => b.id.toUpperCase() === code.toUpperCase());
      const name = bObj?.name || code;
      return `${name.toUpperCase()} (HOME) (${pawns.length})`;
    }
    if (selectedBranches.includes('ALL')) {
      return `ALL BRANCHES (${pawns.length})`;
    }
    if (selectedBranches.length === 0) {
      return `NO BRANCH (${pawns.length})`;
    }
    if (selectedBranches.length === 1) {
      const code = selectedBranches[0];
      const bObj = branches.find(b => b.id.toUpperCase() === code.toUpperCase());
      const name = bObj?.name || code;
      const isHome = branchId && code.toUpperCase() === branchId.toUpperCase();
      return `${name.toUpperCase()}${isHome ? ' (HOME)' : ''} (${pawns.length})`;
    }
    if (selectedBranches.length === 2) {
      return `${selectedBranches[0].toUpperCase()} + ${selectedBranches[1].toUpperCase()} (${pawns.length})`;
    }
    return `${selectedBranches[0].toUpperCase()} + ${selectedBranches[1].toUpperCase()} +${selectedBranches.length - 2} (${pawns.length})`;
  };

  useEffect(() => {
    const u = loadUser();
    const rawRole = (localStorage.getItem('user_role') || u?.role || 'TELLER').toUpperCase().trim();
    const effectiveRole = ['ADMIN', 'MANAGER', 'AUDITOR'].includes(rawRole) ? rawRole : 'TELLER';
    const locked = effectiveRole === 'TELLER' || (
      effectiveRole !== 'ADMIN' && effectiveRole !== 'AUDITOR' &&
      Boolean(u?.branchId) && u.branchId !== 'HQ' && u.branchId !== 'DHW' && u.branchId !== 'ALL'
    );

    let initialBranches = ['ALL'];
    if (locked && u?.branchId) {
      initialBranches = [normalizeBranchId(u.branchId).toUpperCase()];
    } else if (u?.branchId && u.branchId !== 'DHW' && u.branchId !== 'HQ' && u.branchId !== 'ALL') {
      initialBranches = [normalizeBranchId(u.branchId).toUpperCase()];
    }

    setSelectedBranches(initialBranches);
    setFilterBranch(initialBranches.includes('ALL') ? 'ALL' : initialBranches.join(','));
    loadPawns(u, initialBranches);
    loadClients();
    loadBranches();
  }, []);

  // Resolve customer name, phone, and address when NIC/ID/phone/name is typed
  const clientSearchTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleClientIdChange = (val: string) => {
    setClientId(val);
    const cleanVal = val.toLowerCase().trim();
    const cleanValDigits = cleanVal.replace(/[^a-z0-9]/g, '');
    const cleanValNumbers = cleanVal.replace(/\D/g, '');
    let matchedName = clientsMap[cleanVal] || (cleanValDigits ? clientsMap[cleanValDigits] : '') || '';
    let matchedClient: any = null;

    if (cleanVal && clientsList.length > 0) {
      matchedClient = clientsList.find(c => {
        const rawNic = String(c.nationalId || c.national_id || c.nic || '').toLowerCase().trim();
        const cleanNic = stripBranchPrefix(rawNic).toLowerCase();
        const rawNicDigits = rawNic.replace(/[^a-z0-9]/g, '');
        const cleanNicDigits = cleanNic.replace(/[^a-z0-9]/g, '');
        const rawNicNumbers = rawNic.replace(/\D/g, '');
        const cleanNicNumbers = cleanNic.replace(/\D/g, '');
        const cid = String(c.id != null ? c.id : '').toLowerCase().trim();
        const phone = String(c.phone || c.mobile || '').replace(/\D/g, '');
        const rawPhone = String(c.phone || c.mobile || '').toLowerCase().trim();
        const fullName = `${c.firstName || c.first_name || ''} ${c.lastName || c.last_name || ''}`.toLowerCase().trim();
        const altName = String(c.name || '').toLowerCase().trim();

        // 1. NIC match (raw, stripped of branch prefix, or alphanumeric normalized, or digit inclusion)
        const nicMatch = (
          (rawNic && rawNic === cleanVal) ||
          (cleanNic && cleanNic === cleanVal) ||
          (cleanValDigits.length >= 4 && (
            rawNicDigits === cleanValDigits ||
            cleanNicDigits === cleanValDigits ||
            rawNicDigits.includes(cleanValDigits) ||
            cleanNicDigits.includes(cleanValDigits) ||
            cleanValDigits.includes(rawNicDigits) ||
            cleanValDigits.includes(cleanNicDigits)
          )) ||
          (cleanValNumbers.length >= 4 && (
            rawNicNumbers.includes(cleanValNumbers) ||
            cleanNicNumbers.includes(cleanValNumbers) ||
            cleanValNumbers.includes(rawNicNumbers) ||
            cleanValNumbers.includes(cleanNicNumbers)
          ))
        );

        // 2. ID match
        const idMatch = (cid && cid === cleanVal);

        // 3. Phone match
        const phoneMatch = (
          (cleanValNumbers.length >= 7 && phone.includes(cleanValNumbers)) ||
          (rawPhone && rawPhone.includes(cleanVal))
        );

        // 4. Name match
        const nameMatch = (
          (fullName && (fullName === cleanVal || fullName.startsWith(cleanVal) || fullName.includes(cleanVal))) ||
          (altName && (altName === cleanVal || altName.startsWith(cleanVal) || altName.includes(cleanVal)))
        );

        return nicMatch || idMatch || phoneMatch || nameMatch;
      });

      if (matchedClient && !matchedName) {
        matchedName = `${matchedClient.firstName || matchedClient.first_name || ''} ${matchedClient.lastName || matchedClient.last_name || ''}`.trim() || matchedClient.name || '';
      }
    }

    setResolvedName(matchedName || '');
    if (matchedClient) {
      const phone = matchedClient.phone || matchedClient.mobile || matchedClient.contact || matchedClient.phoneNumber || matchedClient.phone_number || '';
      const address = matchedClient.address || matchedClient.addressLine1 || matchedClient.address_line1 || '';
      if (phone) setClientPhone(phone);
      if (address) setClientAddress(address);
    } else if (cleanVal.length >= 3) {
      if (clientSearchTimerRef.current) clearTimeout(clientSearchTimerRef.current);
      clientSearchTimerRef.current = setTimeout(async () => {
        try {
          const headers = getAuthHeaders();
          const res = await fetch(`/api/clients?search=${encodeURIComponent(cleanVal)}&minimal=true&fresh=true`, { headers });
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
              setClientsList(prev => {
                const existingIds = new Set(prev.map(c => c.id));
                const newItems = data.filter((d: any) => !existingIds.has(d.id));
                return newItems.length > 0 ? [...newItems, ...prev] : prev;
              });
              const bestMatch = data[0];
              const matchName = `${bestMatch.first_name || bestMatch.firstName || ''} ${bestMatch.last_name || bestMatch.lastName || ''}`.trim() || bestMatch.name || '';
              if (matchName) {
                setResolvedName(matchName);
                if (bestMatch.phone) setClientPhone(bestMatch.phone);
                if (bestMatch.address) setClientAddress(bestMatch.address);
              }
            }
          }
        } catch (e) {
          console.warn('Live loan client lookup notice:', e);
        }
      }, 300);
    }
    setShowSuggestions(true);
    setActiveSuggestion(0);
  };

  const selectClient = (c: any) => {
    const rawNic = c.nationalId || c.national_id || c.nic || c.id || '';
    const cleanNic = stripBranchPrefix(rawNic);
    setClientId(cleanNic || rawNic);
    const name = `${c.firstName || c.first_name || ''} ${c.lastName || c.last_name || ''}`.trim() || c.name || c.full_name || '';
    setResolvedName(name);
    const phone = c.phone || c.mobile || c.contact || c.phoneNumber || c.phone_number || '';
    const address = c.address || c.addressLine1 || c.address_line1 || '';
    setClientPhone(phone);
    setClientAddress(address);
    setShowSuggestions(false);
  };

  const resetForm = () => {
    setClientId(''); setDescription(''); setAppraisal(''); setAmount('');
    setBillPrefix('1R'); setBillNo(''); setItemType('CH'); setGoldWeight('');
    setWeightGrams(''); setWeightMg('');
    setPawnDate(new Date().toISOString().split('T')[0]);
    setClientPhone(''); setClientAddress('');
    setItemsList([{ itemType: 'CH', description: '', weightGrams: '', weightMg: '', appraisedValue: '' }]);
    setEditingPawn(null); setResolvedName(''); setShowSuggestions(false);
    setShowInlineReg(false); setInlineNic(''); setInlineName(''); setInlinePhone(''); setInlineAddress('');
    setShowKycStep(false); setNewClientId(''); setKycFront(null); setKycBack(null); setKycSign(null);
    setKycCameraOn(false); setKycActiveTab('front');
    if (kycStreamRef.current) { kycStreamRef.current.getTracks().forEach(t => t.stop()); kycStreamRef.current = null; }
  };

  // Save new customer inline and auto-select them
  const handleInlineRegisterCustomer = async () => {
    const nicVal = inlineNic.trim() || clientId.trim();
    if (!nicVal) { toast.error('NIC is required'); return; }

    const isGovNic = isNationalId(nicVal);
    const inlineDuplicate = clientsList.find(c => {
      const cBranch = normalizeBranchId(c.branch_id || c.branchId);
      const myBranch = normalizeBranchId(branchId);
      // For non-NIC book ledger IDs (like "3R 14543"), only check within teller's active branch
      if (!isGovNic && cBranch !== myBranch) {
        return false;
      }
      const rawNic = String(c.national_id || c.nationalId || c.nic || c.id || '').trim().toLowerCase();
      const cleanNic = stripBranchPrefix(rawNic).toLowerCase();
      const target = nicVal.toLowerCase();
      return target === rawNic || target === cleanNic;
    });

    if (inlineDuplicate) {
      toast.info(`Using existing customer record for ${inlineDuplicate.first_name || inlineDuplicate.firstName || 'Customer'}`);
      const rawNic = inlineDuplicate.national_id || inlineDuplicate.nationalId || inlineDuplicate.id || nicVal;
      const nic = stripBranchPrefix(rawNic);
      const fullName = `${inlineDuplicate.first_name || inlineDuplicate.firstName || ''} ${inlineDuplicate.last_name || inlineDuplicate.lastName || ''}`.trim() || inlineDuplicate.name || inlineName.trim();
      setClientId(nic);
      setResolvedName(fullName);
      setClientPhone(inlineDuplicate.phone || inlinePhone.trim());
      setClientAddress(inlineDuplicate.address || inlineAddress.trim());
      setShowInlineReg(false);
      return;
    }

    if (!inlineName.trim()) { toast.error('Name is required'); return; }
    setIsSavingCustomer(true);
    const toastId = toast.loading('Registering customer...');
    try {
      const nameParts = inlineName.trim().split(' ');
      const firstName = nameParts[0] || '';
      const lastName  = nameParts.slice(1).join(' ') || '';
      const normNic = normalizeNationalId(nicVal);
      const payload = {
        nationalId: normNic,
        national_id: normNic,
        nic: normNic,
        firstName,
        lastName,
        phone: inlinePhone.trim(),
        address: inlineAddress.trim(),
        branchId,
      };
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let errorMsg = 'Failed to register customer';
        try {
          const err = await res.json();
          errorMsg = err.error || err.message || errorMsg;
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
      let newClient: any = {};
      try {
        newClient = await res.json();
      } catch {}
      toast.dismiss(toastId);
      // Auto-select the newly registered customer
      const finalDisplayNic = stripBranchPrefix(normNic) || normNic;
      setClientId(finalDisplayNic);
      setResolvedName(inlineName.trim());
      setClientPhone(inlinePhone.trim());
      setClientAddress(inlineAddress.trim());
      setShowInlineReg(false);
      setShowSuggestions(false);

      if (newClient && newClient.id) {
        setClientsList(prev => [newClient, ...prev.filter(c => c.id !== newClient.id)]);
        setClientsMap(prev => ({
          ...prev,
          [normNic.toLowerCase()]: inlineName.trim(),
          [finalDisplayNic.toLowerCase()]: inlineName.trim()
        }));
      }

      // Transition to KYC photo step
      setNewClientId(newClient.id || '');
      setShowKycStep(true);
      setKycActiveTab('front');
      // Refresh clients list in background with fresh bypass
      loadClients(true);
    } catch (err: any) {
      toast.error(err.message || 'Registration failed', { id: toastId });
    } finally {
      setIsSavingCustomer(false);
    }
  };

  // Start KYC webcam
  const startKycCamera = async () => {
    try {
      if (kycStreamRef.current) { kycStreamRef.current.getTracks().forEach(t => t.stop()); }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } 
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      kycStreamRef.current = stream;
      setKycCameraOn(true);
      if (kycVideoRef.current) { 
        kycVideoRef.current.srcObject = stream; 
        kycVideoRef.current.play().catch(() => {});
      }
    } catch { 
      toast.error('Camera access denied or unavailable'); 
    }
  };

  const stopKycCamera = () => {
    if (kycStreamRef.current) { kycStreamRef.current.getTracks().forEach(t => t.stop()); kycStreamRef.current = null; }
    setKycCameraOn(false);
  };

  const captureKycPhoto = () => {
    if (!kycVideoRef.current) return;
    const canvas = document.createElement('canvas');
    const width = kycVideoRef.current.videoWidth || 640;
    const height = kycVideoRef.current.videoHeight || 480;
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(kycVideoRef.current, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    if (kycActiveTab === 'front') setKycFront(dataUrl);
    else if (kycActiveTab === 'back') setKycBack(dataUrl);
    else setKycSign(dataUrl);
    stopKycCamera();
  };

  // Save KYC photos to existing client via PATCH
  const handleInlineKycSave = async () => {
    if (!newClientId) { setShowKycStep(false); return; }
    setIsSavingKyc(true);
    const toastId = toast.loading('Saving KYC photos...');
    try {
      const [compressedFront, compressedBack, compressedSign] = await Promise.all([
        compressImage(kycFront),
        compressImage(kycBack),
        compressImage(kycSign)
      ]);
      const nicImage = JSON.stringify({ front: compressedFront, back: compressedBack });
      const res = await fetch(`/api/clients/${newClientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ nicImage, signatureImage: compressedSign }),
      });
      if (!res.ok) {
        let errorMsg = 'Failed to save photos';
        try {
          const err = await res.json();
          errorMsg = err.error || err.message || errorMsg;
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
      toast.success('KYC photos saved ✓', { id: toastId });
    } catch (err: any) {
      toast.error(err.message || 'Could not save photos', { id: toastId });
    } finally {
      setIsSavingKyc(false);
      setShowKycStep(false);
    }
  };

  const openAdd = () => { 
    resetForm(); 
    if (userRole === 'ADMIN' && filterBranch && filterBranch !== 'ALL') {
      setBranchId(filterBranch);
    }
    loadClients(); 
    setIsOpen(true); 
  };

  const openEdit = (pawn: any) => {
    setEditingPawn(pawn);
    setPawnDate(pawn.date || (pawn.created_at ? pawn.created_at.split('T')[0] : new Date().toISOString().split('T')[0]));
    if (pawn.branch_id) setBranchId(pawn.branch_id);
    const cid = pawn.client_id || '';
    setClientId(cid);
    
    let resolved = clientsMap[cid.toLowerCase()] || '';
    let cPhone = '';
    let cAddress = '';

    if (pawn.clients) {
      resolved = `${pawn.clients.firstName || ''} ${pawn.clients.lastName || ''}`.trim() || resolved;
      cPhone = pawn.clients.phone || '';
      cAddress = pawn.clients.address || pawn.clients.address_line1 || '';
    } else {
      const matchedClient = clientsList.find(c => String(c.id).toLowerCase() === cid.toLowerCase() || String(c.nationalId || c.national_id || '').toLowerCase() === cid.toLowerCase());
      if (matchedClient) {
        cPhone = matchedClient.phone || '';
        cAddress = matchedClient.address || matchedClient.address_line1 || '';
      }
    }
    
    setResolvedName(resolved);
    setClientPhone(cPhone);
    setClientAddress(cAddress);
    
    // Parse description for bill prefix and bill no if present
    const desc = pawn.description || '';
    const match = desc.match(/^([A-Za-z0-9]+)\s+([0-9]+)\s*\|?\s*(.*)/);
    if (match) {
      if (BILL_PREFIXES.includes(match[1])) setBillPrefix(match[1]);
      setBillNo(match[2]);
      setDescription(match[3] || desc);
    } else {
      setDescription(desc);
    }

    // Extract Grams & mg from pawn weight_grams/weight_mg or weight or items
    let gVal = pawn.weight_grams !== undefined && pawn.weight_grams !== null ? String(pawn.weight_grams) : '';
    let mgVal = pawn.weight_mg !== undefined && pawn.weight_mg !== null ? String(pawn.weight_mg) : '';

    let wNum = (parseFloat(gVal) || 0) + ((parseFloat(mgVal) || 0) / 1000);
    if (wNum <= 0) {
      wNum = parseFloat(String(pawn.weight || '').replace(/[^0-9.]/g, '')) || 0;
    }
    if (wNum <= 0 && Array.isArray(pawn.items) && pawn.items.length > 0) {
      wNum = pawn.items.reduce((s: number, it: any) => s + (parseFloat(it.weight_grams) || 0) + ((parseFloat(it.weight_mg) || 0) / 1000), 0);
    }

    if (!gVal && !mgVal && wNum > 0) {
      const g = Math.floor(wNum);
      const mg = Math.round((wNum - g) * 1000);
      gVal = String(g || '');
      mgVal = mg > 0 ? String(mg) : '';
    }

    setWeightGrams(gVal);
    setWeightMg(mgVal);
    setGoldWeight(wNum > 0 ? String(wNum) : '');
    setPeriodMonths(String(pawn.period_months || '3'));

    setAppraisal(String(pawn.appraised_value || ''));
    setAmount(String(pawn.disbursed_amount || ''));
    setIsOpen(true);
  };

  const handleSave = async () => {
    if (!clientId || !amount) {
      toast.error('Missing required fields', { description: 'Please select a Customer and enter Disbursed Amount.' });
      return;
    }

    // Intercept Teller edit mutations to route through Change Request system
    if (editingPawn && userRole === 'TELLER') {
      const cleanBill = billNo.trim();
      const finalBillNo = cleanBill ? (billPrefix ? `${billPrefix} ${cleanBill}` : cleanBill) : editingPawn.bill_no;
      openChangeRequest(editingPawn, 'UPDATE', {
        disbursed_amount: amount,
        appraised_value: appraisal,
        weight_grams: weightGrams,
        weight_mg: weightMg,
        description: `${finalBillNo} | ${description}`.trim(),
        period_months: periodMonths
      });
      setIsOpen(false);
      return;
    }
    setIsSaving(true);
    const toastId = toast.loading(editingPawn ? 'Updating pawn ticket...' : 'Creating pawn ticket...');

    try {
      const cleanBill = billNo.trim();
      if (!cleanBill) {
        toast.error('Bill / Ticket number is required', { description: 'Please enter a valid bill number before issuing the loan.' });
        setIsSaving(false);
        return;
      }
      let finalBillNo = '';
      if (cleanBill) {
        // If user already typed prefix inside billNo, format cleanly
        const prefixUpper = billPrefix.toUpperCase();
        if (cleanBill.toUpperCase().startsWith(prefixUpper + ' ')) {
          finalBillNo = cleanBill;
        } else if (cleanBill.toUpperCase().startsWith(prefixUpper)) {
          finalBillNo = `${billPrefix} ${cleanBill.substring(prefixUpper.length).trim()}`;
        } else {
          finalBillNo = `${billPrefix} ${cleanBill}`;
        }
      }

      // Duplicate numeric bill number validation within current branch
      const isChangingNumeric = !editingPawn || !isSameNumericBill(editingPawn.bill_no || editingPawn.display_bill_no || editingPawn.description, finalBillNo);
      if (isChangingNumeric) {
        const numericPart = extractNumericBillNo(finalBillNo);
        if (numericPart) {
          const effectiveTargetBranch = normalizeBranchId(editingPawn?.branch_id || editingPawn?.branchId || branchId || 'HQ');
          const dupPawn = (pawns || []).find((p: any) => {
            if (editingPawn && p.id === editingPawn.id) return false;
            const pBranch = normalizeBranchId(p.branch_id || p.branchId || '');
            if (effectiveTargetBranch !== 'ALL' && pBranch && pBranch !== effectiveTargetBranch) return false;
            return isSameNumericBill(p.bill_no || p.display_bill_no || p.description, finalBillNo);
          });

          if (dupPawn) {
            toast.dismiss(toastId);
            toast.error(`Duplicate Bill Number: Bill number ${numericPart} already exists in ${effectiveTargetBranch} branch.`);
            setIsSaving(false);
            return;
          }
        }
      }

      const itemDescSummary = itemsList.map(i => {
        const itemLabel = i.itemType === 'OTHER' 
          ? (i.customType || i.description || 'Other Item') 
          : (ITEM_OPTIONS.find(o => o.code === i.itemType)?.label || i.itemType);
        return `${itemLabel}${i.weightMg ? ` (${i.weightMg}mg)` : ''}`;
      }).filter(Boolean).join(', ');

      const itemDesc = description.trim() || itemDescSummary || `${goldPurity} Gold Collateral (${itemType})`;
      const fullDescription = finalBillNo ? `${finalBillNo} | ${itemDesc}` : itemDesc;

      // getAuthHeaders() automatically includes Authorization + x-branch-id from localStorage
      const headers = getAuthHeaders();

      const url    = editingPawn ? `/api/pawns/${editingPawn.id}` : '/api/pawns';
      const method = editingPawn ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers,
        body: JSON.stringify({
          clientId,
          clientName: resolvedName,
          phone: clientPhone,
          address: clientAddress,
          description: fullDescription,
          appraisedValue: appraisal,
          disbursedAmount: amount,
          branchId,
          createdByUserId: userId,
          billNo: finalBillNo,
          weight: goldWeight,
          weightGrams,
          weightMg,
          periodMonths,
          itemType,
          items: itemsList,
          date: pawnDate,
          airWeightPhoto: evaluationData?.airWeightPhoto || null,
          waterWeightPhoto: evaluationData?.waterWeightPhoto || null,
          waterWeight: evaluationData?.waterWeight || null,
          specificGravity: evaluationData?.specificGravity || null,
          estimatedKarat: evaluationData?.estimatedKarat || null
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to save');
      }

      const savedData = await res.json();

      toast.success(editingPawn ? 'Pawn ticket updated!' : 'Pawn ticket created & synced to vault stock!', { id: toastId });
      setIsOpen(false);
      resetForm();
      await Promise.all([loadPawns(), loadClients()]);

      // Automatically open official Printable Pawn Agreement Receipt Modal
      if (!editingPawn && savedData) {
        openDetails(savedData);
      }
    } catch (err: any) {
      toast.error('Error saving ticket', { description: err.message, id: toastId });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (pawn: any) => {
    if (!confirm(`Delete pawn ticket for "${pawn.description}"?`)) return;
    const toastId = toast.loading('Deleting pawn ticket...');
    try {
      const res = await fetch(`/api/pawns/${pawn.id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      if (!res.ok) throw new Error('Delete failed');
      toast.success('Pawn ticket deleted', { id: toastId });
      loadPawns();
    } catch (err) {
      toast.error('Could not delete ticket', { id: toastId });
    }
  };

  const getGoldFactor = (purity: string) => {
    if (purity === '24K') return 1.0;
    if (purity === '22K') return 0.916;
    if (purity === '20K') return 0.833;
    return 0.75; // 18K
  };

  const applyGoldCalculation = () => {
    const weight = parseFloat(goldWeight) || 0;
    const rate = parseFloat(goldRate) || 0;
    const factor = getGoldFactor(goldPurity);
    const appraisedVal = Math.round(weight * rate * factor);
    const ltvPercent = parseFloat(goldLtv) || 80;
    const loanAmount = Math.round(appraisedVal * (ltvPercent / 100));

    setAppraisal(String(appraisedVal));
    setAmount(String(loanAmount));
    
    // Auto-update description if empty
    setDescription(prev => prev === '' ? `${goldPurity} Gold Collateral, ${weight} mg` : prev);

    toast.success('Gold valuation applied!', {
      description: `Appraisal: Rs. ${appraisedVal.toLocaleString()} | Loan Amount: Rs. ${loanAmount.toLocaleString()}`
    });
    setShowGoldCalc(false);
  };

  // Rupasinghe Interest Redemption Calculator
  const calculateRedemption = (principal: number, days: number, insuranceStr: string) => {
    const insurance = parseFloat(insuranceStr) || 0;
    const tier = principal < 50000 ? 'A' : 'B';
    let interestRate = 0.0250; // Tier A: 2.50%
    let discountRate = 0.0100; // Tier A: 1.00%
    if (tier === 'B') {
      interestRate = 0.0275; // Tier B: 2.75%
      discountRate = 0.0050; // Tier B: 0.50%
    }

    const interestOne = principal * interestRate;
    const totalAmount = principal + interestOne;
    const finalTotalInterest = interestOne + insurance;

    let settlement = 0;
    let accrualExpr = '';
    let accrualDesc = '';
    let activeNodeIndex = 0;

    if (days <= 10) {
      const discount = totalAmount * discountRate;
      settlement = totalAmount - discount;
      accrualExpr = `Total Amount (Rs. ${totalAmount.toLocaleString()}) - Discount (Rs. ${discount.toLocaleString()})`;
      accrualDesc = `Day 1-10: Early Discount of ${(discountRate * 100).toFixed(1)}% applied to Total Amount.`;
      activeNodeIndex = 0;
    } else if (days <= 30) {
      settlement = totalAmount;
      accrualExpr = `Flat Total Amount (T)`;
      accrualDesc = `Day 11-30: Standard grace period. Flat redemption amount of Total Amount.`;
      activeNodeIndex = 1;
    } else if (days <= 38) {
      const extraInt = (totalAmount * interestRate) * 0.25;
      settlement = principal + extraInt + finalTotalInterest;
      accrualExpr = `P + ((T × r_int) × 0.25) + I_final`;
      accrualDesc = `Month 2 (Days 1-8): Principal + 25% extra interest increment + Final Total Interest.`;
      activeNodeIndex = 2;
    } else if (days <= 45) {
      const extraInt = (totalAmount * interestRate) * 0.50;
      settlement = principal + extraInt + finalTotalInterest;
      accrualExpr = `P + ((T × r_int) × 0.50) + I_final`;
      accrualDesc = `Month 2 (Days 9-15): Principal + 50% extra interest increment + Final Total Interest.`;
      activeNodeIndex = 3;
    } else if (days <= 60) {
      const extraInt = totalAmount * interestRate;
      settlement = principal + extraInt + finalTotalInterest;
      accrualExpr = `P + (T × r_int) + I_final`;
      accrualDesc = `Month 2 (Full): Principal + 100% extra interest increment + Final Total Interest.`;
      activeNodeIndex = 4;
    } else {
      const months = Math.ceil(days / 30);
      const extraInt = (totalAmount * interestRate) * (months - 1);
      settlement = principal + extraInt + finalTotalInterest;
      accrualExpr = `P + ((T × r_int) × (${months} - 1)) + I_final`;
      accrualDesc = `Month 3+ (Month ${months}): Principal + accrued monthly interest + Final Total Interest.`;
      activeNodeIndex = 5;
    }

    const accruedCharges = Math.max(0, settlement - principal);
    return {
      interestRate,
      interestOne,
      totalAmount,
      finalTotalInterest,
      settlement,
      accrualExpr,
      accrualDesc,
      activeNodeIndex,
      accruedCharges
    };
  };

  const openRedeem = (pawn: any) => {
    setRedeemingPawn(pawn);
    // Calculate days elapsed between created_at and now
    const createdDate = pawn.created_at ? new Date(pawn.created_at) : new Date();
    const today = new Date();
    const diffTime = Math.abs(today.getTime() - createdDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;
    
    setRedeemDays(diffDays);
    setRedeemInsurance('50');
    setIsRedeemOpen(true);
  };

  const handleRedeemSubmit = async () => {
    if (!redeemingPawn) return;
    setIsRedeeming(true);
    const toastId = toast.loading('Processing pawn redemption...');
    try {
      const res = await fetch(`/api/pawns/${redeemingPawn.id}/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          insurance: redeemInsurance,
          days: redeemDays,
          approvedBy: 'Teller / Cashier'
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to redeem');
      }

      const data = await res.json();
      toast.success(`Pawn redeemed! Posted GL Journal Entry: ${data.journalEntryId}`, { id: toastId });

      const calc = calculateRedemption(
        redeemingPawn.disbursed_amount || 0,
        redeemDays,
        redeemInsurance
      );

      const receiptObj = {
        pawn: redeemingPawn,
        journalEntryId: data.journalEntryId,
        days: redeemDays,
        insurance: redeemInsurance,
        principal: redeemingPawn.disbursed_amount || 0,
        interest: calc.accruedCharges,
        settlement: calc.settlement,
        redeemedAt: new Date().toLocaleDateString('en-GB')
      };

      setIsRedeemOpen(false);
      setRedeemingPawn(null);
      setRedemptionReceiptData(receiptObj);
      loadPawns();
    } catch (err: any) {
      toast.error('Redemption failed', { description: err.message, id: toastId });
    } finally {
      setIsRedeeming(false);
    }
  };

  const handleApprove = async (pawn: any) => {
    if (!confirm(`Are you sure you want to approve Pawn Ticket #${pawn.id?.substring(0, 8).toUpperCase()} for Rs. ${pawn.disbursed_amount?.toLocaleString()}?`)) return;
    const toastId = toast.loading('Approving pawn ticket...');
    try {
      const res = await fetch(`/api/pawns/${pawn.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ approvedBy: `Branch Office / ${userRole}` })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Approval failed');
      }
      toast.success('Pawn ticket approved successfully!', { id: toastId });
      loadPawns();
    } catch (err: any) {
      toast.error('Approval failed', { description: err.message, id: toastId });
    }
  };

  const handleSendReminder = async (pawn: any) => {
    let custPhone = pawn.client_phone || pawn.phone;
    if (!custPhone && pawn.clients) custPhone = pawn.clients.phone;
    if (!custPhone && pawn.client_id) {
      const matched = clientsList.find(c => String(c.id).toLowerCase() === String(pawn.client_id).toLowerCase() || String(c.nationalId).toLowerCase() === String(pawn.client_id).toLowerCase());
      custPhone = matched?.phone;
    }

    if (!custPhone) {
      const inputPhone = prompt("Enter customer mobile number for SMS reminder:");
      if (!inputPhone) return;
      custPhone = inputPhone;
    }

    const billDisplay = getBillNo(pawn);
    const amountVal = pawn.disbursed_amount || 0;
    const cName = getCustomerName(pawn) || 'Valued Customer';
    const reminderMsg = buildPawnReminderSms({
      customerName: cName,
      ticketNo: billDisplay,
      amount: amountVal
    });

    const toastId = toast.loading(`Dispatching SMS reminder to ${custPhone}...`);
    try {
      const res = await fetch('/api/notifications/sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: custPhone,
          message: reminderMsg,
          ticketNo: billDisplay,
          amount: amountVal,
          type: 'REMINDER'
        })
      });

      const data = await res.json();
      if (res.ok) {
        toast.success(`SMS Reminder dispatched to ${custPhone}!`, {
          description: data.notice || 'Dispatched via Android SIM Gateway',
          id: toastId
        });
      } else {
        toast.error(data.error || 'Failed to send SMS reminder', { id: toastId });
      }
    } catch (err: any) {
      toast.error('Error sending SMS reminder: ' + err.message, { id: toastId });
    }
  };

  const openDetails = (pawn: any) => {
    setDetailsPawn(pawn);
    const createdDate = pawn.created_at ? new Date(pawn.created_at) : new Date();
    const today = new Date();
    const diffTime = Math.abs(today.getTime() - createdDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;
    setDetailsDays(diffDays);
    setDetailsInsurance('50');

    const p = pawn.disbursed_amount || 0;
    const calc = calculateRedemption(p, diffDays, '50');
    setDetailsCustomRate((calc.interestRate * 100).toFixed(2));
    setDetailsCustomInterest(calc.accruedCharges.toString());
    setDetailsCustomSettlement(calc.settlement.toString());
    setDetailsCustomAppraised(String(pawn.appraised_value || 0));
    setDetailsCustomDisbursed(String(pawn.disbursed_amount || 0));
  };

  const searchLower = (search || '').toLowerCase().trim();
  const filtered = pawns.filter(p => {
    // 1. Branch Filter (Client-side immediate filtering + safety)
    if (isBranchLocked && branchId) {
      const homeBranch = normalizeBranchId(branchId).toUpperCase();
      const pBranch = String(p.branch_id || p.branchId || '').toUpperCase().trim();
      const terms = getBranchSearchTerms(homeBranch);
      const isHomeMatch = terms.some(t => pBranch === t.toUpperCase() || pBranch.includes(t.toUpperCase())) || pBranch === homeBranch;
      if (!isHomeMatch) return false;
    } else if (selectedBranches.length > 0 && !selectedBranches.includes('ALL')) {
      const pBranch = String(p.branch_id || p.branchId || '').toUpperCase().trim();
      const branchMatches = selectedBranches.some(sBranch => {
        const terms = getBranchSearchTerms(sBranch);
        return terms.some(t => pBranch === t.toUpperCase() || pBranch.includes(t.toUpperCase())) || pBranch === sBranch.toUpperCase();
      });
      if (!branchMatches) return false;
    }

    // 2. Status Filter
    if (filterStatus && filterStatus !== 'ALL') {
      const pStatus = String(p.status || 'ACTIVE').toUpperCase().trim();
      if (pStatus !== filterStatus.toUpperCase().trim()) return false;
    }

    // 3. Item Description Filter
    if (filterDescription && filterDescription !== 'ALL') {
      const desc = String(p.description || '').toLowerCase();
      const fDesc = filterDescription.toLowerCase().trim();
      let descMatch = false;
      if (fDesc === 'ring') {
        descMatch = desc.includes('ring') || desc.includes('(pr)') || desc.includes('pr_') || desc.includes('pr-');
      } else if (fDesc === 'chain') {
        descMatch = desc.includes('chain');
      } else if (fDesc === 'earrings') {
        descMatch = desc.includes('ear') || desc.includes('earring');
      } else if (fDesc === 'pendant') {
        descMatch = desc.includes('pendant') || desc.includes('(pp)') || desc.includes('pp_') || desc.includes('pp-');
      } else if (fDesc === 'bracelet') {
        descMatch = desc.includes('bracelet') || desc.includes('(brc)') || desc.includes('brc_') || desc.includes('brc-');
      } else if (fDesc === 'bangle') {
        descMatch = desc.includes('bangle') || desc.includes('(bgl)') || desc.includes('bgl_');
      } else if (fDesc === 'necklace') {
        descMatch = desc.includes('necklace') || desc.includes('(nl)') || desc.includes('nl_');
      } else {
        descMatch = desc.includes(fDesc);
      }
      if (!descMatch) return false;
    }

    // 4. Search Query Filter
    if (!searchLower) return true;

    const searchClean = searchLower.replace(/[^a-z0-9]/gi, '');

    // Bill Number matching (supports exact bill_no, display bill #, description prefix, and normalized alphanumeric)
    const displayBill = getBillNo(p).toLowerCase();
    const rawBill = String(p.bill_no || '').toLowerCase();
    const descBillMatch = (p.description || '').match(/^([A-Za-z0-9]+\s+[0-9A-Za-z]+)/);
    const descBill = descBillMatch ? descBillMatch[1].toLowerCase() : '';
    const billMatches = (
      displayBill.includes(searchLower) ||
      rawBill.includes(searchLower) ||
      descBill.includes(searchLower) ||
      (searchClean.length > 0 && (
        displayBill.replace(/[^a-z0-9]/gi, '').includes(searchClean) ||
        rawBill.replace(/[^a-z0-9]/gi, '').includes(searchClean) ||
        descBill.replace(/[^a-z0-9]/gi, '').includes(searchClean)
      ))
    );

    // NIC Number matching (supports mapped NIC, display NIC, client join NIC, client ID, and normalized alphanumeric)
    const cleanId = String(p.client_id || '').toLowerCase().trim();
    const displayNic = String(getClientNic(p) || '').toLowerCase();
    const rawNic = String(p.clients?.national_id || p.clients?.nationalId || p.clients?.nic || '').toLowerCase();
    const mapNic = String(clientsNicMap[cleanId] || '').toLowerCase();
    const nicMatches = (
      displayNic.includes(searchLower) ||
      rawNic.includes(searchLower) ||
      mapNic.includes(searchLower) ||
      cleanId.includes(searchLower) ||
      (searchClean.length > 0 && (
        displayNic.replace(/[^a-z0-9]/gi, '').includes(searchClean) ||
        rawNic.replace(/[^a-z0-9]/gi, '').includes(searchClean) ||
        mapNic.replace(/[^a-z0-9]/gi, '').includes(searchClean) ||
        cleanId.replace(/[^a-z0-9]/gi, '').includes(searchClean)
      ))
    );

    const clientName = (getCustomerName(p) || clientsMap[cleanId] || p.clients?.first_name || p.clients?.firstName || p.clients?.name || '').toLowerCase();
    const clientPhone = String(p.clients?.phone || p.phone || '').toLowerCase();
    const description = String(p.description || '').toLowerCase();
    const id = String(p.id || '').toLowerCase();
    const branch = String(p.branch_id || p.branchId || '').toLowerCase();
    const status = String(p.status || '').toLowerCase();

    return (
      billMatches ||
      nicMatches ||
      clientName.includes(searchLower) ||
      clientPhone.includes(searchLower) ||
      description.includes(searchLower) ||
      branch.includes(searchLower) ||
      status.includes(searchLower) ||
      id.includes(searchLower)
    );
  });

  const totalDisbursed = filtered.reduce((s, p) => s + (p.disbursed_amount || 0), 0);

  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-700">

      {/* Page Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center glass p-8 rounded-2xl border-white/40 shadow-2xl gap-6">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tighter leading-none mb-2">
            Pawning <span className="text-gradient">Process</span>
          </h1>
          <p className="text-slate-500 font-medium tracking-tight">Record pawned collateral and assign capital to registered clients.</p>
        </div>
      </div>

      {/* Evaluation Modal */}
      <ItemEvaluationModal 
        isOpen={isEvaluationOpen} 
        onOpenChange={setIsEvaluationOpen} 
        onAccept={(data) => {
          setEvaluationData(data);
          resetForm();
          if (userRole === 'ADMIN' && filterBranch && filterBranch !== 'ALL') {
            setBranchId(filterBranch);
          }
          loadClients();
          // Set initial form values based on evaluation
          const appraisedStr = (data.trueValue || '').toString();
          const amountStr = (data.askingAmount || '').toString();
          
          const rawAw = Number(data.airWeight) || 0;
          // Scale often outputs Grams (e.g. 4.02g). If rawAw < 50, it is grams! Convert to mg.
          // If rawAw >= 50, it was already entered as milligrams (e.g. 4020 mg).
          const weightMgNum = rawAw > 0 && rawAw < 50 ? Math.round(rawAw * 1000) : (rawAw >= 50 ? Math.round(rawAw) : 0);
          const weightMgStr = weightMgNum > 0 ? weightMgNum.toString() : '';
          const gVal = rawAw > 0 && rawAw < 50 ? rawAw.toString() : (rawAw >= 50 ? (rawAw / 1000).toFixed(3) : '0');
          
          setAppraisal(appraisedStr);
          setAmount(amountStr);
          setWeightMg(weightMgStr);
          setGoldWeight(gVal);

          let karatPurity = '22K';
          if (data.estimatedKarat) {
            const kMatch = data.estimatedKarat.match(/(24K|22K|21K|20K|18K|14K|10K|9K)/i);
            if (kMatch) {
              karatPurity = kMatch[1].toUpperCase();
              setGoldPurity(karatPurity);
            }
          }

          setItemsList([{ 
            itemType: 'CH', 
            description: `Evaluated Collateral (${karatPurity}, SG ${data.specificGravity || '—'})`, 
            weightGrams: gVal, 
            weightMg: weightMgStr, 
            appraisedValue: appraisedStr,
            purity: karatPurity
          }]);
          setIsCustomerStepOpen(true);
        }} 
      />

      {/* Customer Selection & KYC Registration Modal (Step 2) */}
      <CustomerSelectionModal
        isOpen={isCustomerStepOpen}
        onOpenChange={setIsCustomerStepOpen}
        clientsList={clientsList}
        branchId={branchId}
        evaluationSummary={{
          airWeight: evaluationData?.airWeight,
          waterWeight: evaluationData?.waterWeight,
          specificGravity: evaluationData?.specificGravity,
          estimatedKarat: evaluationData?.estimatedKarat,
          trueValue: evaluationData?.trueValue,
          askingAmount: evaluationData?.askingAmount
        }}
        onCustomerSelected={(cust) => {
          const rawNic = cust.nic || cust.id || '';
          const cleanNic = stripBranchPrefix(rawNic);
          setClientId(cleanNic || rawNic);
          setResolvedName(cust.name);
          setClientPhone(cust.phone);
          setClientAddress(cust.address);
          setIsCustomerStepOpen(false);
          setIsOpen(true);

          // Optimistically register into clientsList and clientsMap for instant search availability
          const newRecord = {
            id: cust.id,
            national_id: rawNic,
            nationalId: rawNic,
            display_national_id: cleanNic,
            first_name: cust.name,
            lastName: '.',
            phone: cust.phone,
            address: cust.address
          };
          setClientsList(prev => [newRecord, ...prev.filter(c => c.id !== cust.id && c.national_id !== rawNic)]);
          setClientsMap(prev => ({
            ...prev,
            [rawNic.toLowerCase()]: cust.name,
            [cleanNic.toLowerCase()]: cust.name,
            [String(cust.id).toLowerCase()]: cust.name
          }));
          loadClients(true);
        }}
      />

      {/* Dialog */}
      <Dialog open={isOpen} onOpenChange={(v) => { setIsOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="w-[95vw] sm:w-[92vw] lg:max-w-5xl max-h-[90vh] bg-white border border-slate-200 shadow-2xl p-0 rounded-2xl sm:rounded-[2.5rem] flex flex-col overflow-hidden">
          <div className="h-2.5 bg-gradient-to-r from-amber-500 via-amber-600 to-yellow-500 shrink-0" />
          
          {/* Fixed Header */}
          <div className="p-4 sm:p-6 pb-3 border-b border-slate-100 shrink-0 bg-white">
            <DialogHeader>
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                <DialogTitle className="text-xl sm:text-2xl font-black tracking-tighter flex items-center gap-2.5 sm:gap-3 text-slate-900">
                  <div className="p-2 sm:p-2.5 bg-amber-500/10 rounded-2xl text-amber-600 shrink-0">
                    <Package className="w-5 h-5 sm:w-6 sm:h-6" />
                  </div>
                  <span>{editingPawn ? 'Edit Pawn Ticket' : 'Originate New Pawn Ticket'}</span>
                </DialogTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-3 py-1 bg-slate-100 text-slate-700 border border-slate-200 rounded-full text-[10px] sm:text-xs font-mono font-black shrink-0 flex items-center gap-1.5">
                    <MapPin className="w-3 h-3 text-primary" />
                    <span>Branch: {branches.find(b => b.id === branchId || b.id === (branchId ? branchId.toUpperCase() : ''))?.name || branchId || 'Active Branch'}</span>
                  </span>
                  <span className="px-3 py-1 bg-amber-100 text-amber-800 border border-amber-200 rounded-full text-[10px] sm:text-xs font-mono font-bold shrink-0">
                    Weight Unit: Milligrams (mg)
                  </span>
                </div>
              </div>
              <DialogDescription className="font-semibold text-slate-500 text-xs mt-1">
                {editingPawn ? 'Update pawn collateral details below.' : 'Record collateral item details, calculate valuation, and process principal disbursal.'}
              </DialogDescription>
            </DialogHeader>
          </div>

          {/* Scrollable Form Body */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
            {/* 2-COLUMN GRID LAYOUT */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 items-start">

              {/* LEFT COLUMN: Customer & Ticket Details */}
              <div className="space-y-5">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 border-b border-slate-100 pb-2">
                  1. Customer & Bill Information
                </h3>

                {/* Customer Details Display */}
                {resolvedName && (
                  <div className="p-3.5 bg-emerald-50/90 border border-emerald-200 rounded-2xl flex items-center justify-between shadow-xs">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                        <UserCheck className="w-4 h-4 stroke-[2.5]" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black text-slate-900">{resolvedName}</span>
                          <span className="font-mono text-[10px] font-bold text-emerald-800 bg-emerald-100/80 px-2 py-0.5 rounded-md">
                            NIC: {clientId}
                          </span>
                        </div>
                        <div className="text-[10px] font-bold text-slate-500 mt-0.5 flex items-center gap-2">
                          <span>TP: {clientPhone || '—'}</span>
                          <span>•</span>
                          <span className="truncate max-w-[200px]">{clientAddress || 'No address'}</span>
                        </div>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsCustomerStepOpen(true)}
                      className="text-xs font-bold text-amber-700 hover:text-amber-800 hover:bg-amber-100/60 rounded-xl h-8 px-2.5"
                    >
                      Change
                    </Button>
                  </div>
                )}

                {/* Customer Search */}
                <div className="grid gap-2 relative">
                  <Label className="font-black text-[10px] uppercase tracking-widest text-slate-500">Customer ID or NIC</Label>
                  <Input
                    value={clientId}
                    onChange={e => handleClientIdChange(e.target.value)}
                    placeholder="Search customer database..."
                    className="h-11 bg-white/80 rounded-xl font-mono font-bold text-xs"
                    onKeyDown={e => {
                      const typed = clientId.toLowerCase().trim();
                      const typedDigits = typed.replace(/[^a-z0-9]/g, '');
                      const typedNumbers = typed.replace(/\D/g, '');
                      const suggestions = clientsList.filter(c => {
                        if (!typed) return false;
                        const rawNic = String(c.nationalId || c.national_id || c.nic || c.id || '').toLowerCase();
                        const cleanNic = stripBranchPrefix(rawNic).toLowerCase();
                        const rawNicDigits = rawNic.replace(/[^a-z0-9]/g, '');
                        const cleanNicDigits = cleanNic.replace(/[^a-z0-9]/g, '');
                        const rawNicNumbers = rawNic.replace(/\D/g, '');
                        const cleanNicNumbers = cleanNic.replace(/\D/g, '');
                        const cid = String(c.id != null ? c.id : '').toLowerCase();
                        const name = `${c.firstName || c.first_name || ''} ${c.lastName || c.last_name || ''}`.toLowerCase();
                        const altName = String(c.name || '').toLowerCase();
                        const phone = String(c.phone || c.mobile || '').replace(/\D/g, '');

                        return (
                          rawNic.includes(typed) ||
                          cleanNic.includes(typed) ||
                          (typedDigits.length >= 3 && (rawNicDigits.includes(typedDigits) || cleanNicDigits.includes(typedDigits))) ||
                          (typedNumbers.length >= 3 && (rawNicNumbers.includes(typedNumbers) || cleanNicNumbers.includes(typedNumbers))) ||
                          cid.includes(typed) ||
                          name.includes(typed) ||
                          altName.includes(typed) ||
                          (phone && typedNumbers.length >= 3 && phone.includes(typedNumbers))
                        );
                      });

                      if (showSuggestions && suggestions.length > 0) {
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setActiveSuggestion(p => Math.min(p + 1, suggestions.length - 1));
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setActiveSuggestion(p => Math.max(p - 1, 0));
                        } else if (e.key === 'Enter') {
                          e.preventDefault();
                          if (suggestions[activeSuggestion]) {
                            selectClient(suggestions[activeSuggestion]);
                          }
                        } else if (e.key === 'Escape') {
                          setShowSuggestions(false);
                        }
                      }
                    }}
                  />
                  
                  {/* Autocomplete Dropdown list */}
                  {(() => {
                    const typed = clientId.toLowerCase().trim();
                    const typedDigits = typed.replace(/[^a-z0-9]/g, '');
                    const typedNumbers = typed.replace(/\D/g, '');
                    const suggestions = clientsList.filter(c => {
                      if (!typed) return false;
                      const rawNic = String(c.nationalId || c.national_id || c.nic || c.id || '').toLowerCase();
                      const cleanNic = stripBranchPrefix(rawNic).toLowerCase();
                      const rawNicDigits = rawNic.replace(/[^a-z0-9]/g, '');
                      const cleanNicDigits = cleanNic.replace(/[^a-z0-9]/g, '');
                      const rawNicNumbers = rawNic.replace(/\D/g, '');
                      const cleanNicNumbers = cleanNic.replace(/\D/g, '');
                      const cid = String(c.id != null ? c.id : '').toLowerCase();
                      const name = `${c.firstName || c.first_name || ''} ${c.lastName || c.last_name || ''}`.toLowerCase();
                      const altName = String(c.name || '').toLowerCase();
                      const phone = String(c.phone || c.mobile || '').replace(/\D/g, '');

                      return (
                        rawNic.includes(typed) ||
                        cleanNic.includes(typed) ||
                        (typedDigits.length >= 3 && (rawNicDigits.includes(typedDigits) || cleanNicDigits.includes(typedDigits))) ||
                        (typedNumbers.length >= 3 && (rawNicNumbers.includes(typedNumbers) || cleanNicNumbers.includes(typedNumbers))) ||
                        cid.includes(typed) ||
                        name.includes(typed) ||
                        altName.includes(typed) ||
                        (phone && typedNumbers.length >= 3 && phone.includes(typedNumbers))
                      );
                    });

                    return (
                      <>
                        {showSuggestions && suggestions.length > 0 && (
                          <div className="absolute z-50 left-0 right-0 top-16 bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden max-h-60 overflow-y-auto">
                            {suggestions.map((c, i) => {
                              const nicStr = c.nationalId || c.national_id || c.id || '';
                              const nameStr = `${c.firstName || c.first_name || ''} ${c.lastName || c.last_name || ''}`.trim();
                              const isSelected = i === activeSuggestion;
                              return (
                                <button
                                  key={c.id || i}
                                  type="button"
                                  onClick={() => selectClient(c)}
                                  onMouseEnter={() => setActiveSuggestion(i)}
                                  className={`w-full text-left px-4 py-2.5 text-xs font-bold transition-all flex flex-col gap-0.5 border-b border-slate-100 last:border-0 ${
                                    isSelected ? 'bg-primary text-white' : 'hover:bg-slate-50 text-slate-700'
                                  }`}
                                >
                                  <span className={`${isSelected ? 'text-white' : 'text-slate-900'} font-black text-xs`}>{nameStr}</span>
                                  <span className={`${isSelected ? 'text-slate-200' : 'text-slate-400'} font-mono text-[10px]`}>{nicStr}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {/* Inline Customer Registration — no page redirect needed */}
                        {clientId && !resolvedName && suggestions.length === 0 && (
                          <div className="mt-2 bg-amber-50 border border-amber-200 rounded-2xl overflow-hidden">
                            {/* Header Row */}
                            <div className="flex items-center justify-between px-3 py-2.5">
                              <span className="text-amber-800 text-[11px] font-black tracking-tight flex items-center gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                                Customer not found
                              </span>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => {
                                  setShowInlineReg(v => !v);
                                  setInlineNic(clientId);
                                }}
                                className="bg-amber-600 hover:bg-amber-700 text-white font-black text-[10px] uppercase tracking-widest rounded-lg h-7 px-3 gap-1"
                              >
                                <Plus className="w-3 h-3" />
                                {showInlineReg ? 'Cancel' : 'Register Now'}
                              </Button>
                            </div>

                            {/* Inline Registration Form */}
                            {showInlineReg && (() => {
                              const inlineDuplicate = inlineNic.trim()
                                ? clientsList.find(c => {
                                    const cNic = String(c.national_id || c.nationalId || c.nic || c.id || '').trim().toLowerCase();
                                    return inlineNic.trim().toLowerCase() === cNic;
                                  })
                                : null;

                              return (
                                <div className="px-3 pb-3 space-y-2.5 border-t border-amber-200 pt-2.5">
                                  <p className="text-[10px] text-amber-700 font-bold uppercase tracking-widest">Quick Registration</p>
                                  
                                  {/* ── RED ALERT: CUSTOMER ALREADY EXISTS IN DATABASE ── */}
                                  {inlineDuplicate && (
                                    <div className="bg-red-50 border-2 border-red-500 rounded-xl p-3 space-y-2 animate-in fade-in duration-200">
                                      <div className="flex items-center justify-between border-b border-red-200 pb-1.5">
                                        <span className="text-[11px] font-black text-red-700 uppercase flex items-center gap-1">
                                          <AlertTriangle className="w-3.5 h-3.5" /> Customer Exists in Database!
                                        </span>
                                        <span className="text-[9px] font-mono font-black bg-red-600 text-white px-1.5 py-0.5 rounded">
                                          EXISTS
                                        </span>
                                      </div>
                                      <div className="space-y-1 text-[11px]">
                                        <p className="text-red-700 font-bold">NIC: <span className="font-mono font-black">{inlineDuplicate.national_id || inlineDuplicate.nationalId || inlineNic}</span></p>
                                        <p className="text-red-700 font-bold">Name: <span className="font-black">{`${inlineDuplicate.first_name || inlineDuplicate.firstName || ''} ${inlineDuplicate.last_name || inlineDuplicate.lastName || ''}`.trim() || inlineDuplicate.name}</span></p>
                                        <p className="text-red-700 font-bold">TP: <span className="font-mono font-black">{inlineDuplicate.phone || 'No TP'}</span></p>
                                        <p className="text-red-700 font-bold">Address: <span>{inlineDuplicate.address || 'No Address'}</span></p>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const nic = inlineDuplicate.national_id || inlineDuplicate.nationalId || inlineDuplicate.id || inlineNic.trim();
                                          const fullName = `${inlineDuplicate.first_name || inlineDuplicate.firstName || ''} ${inlineDuplicate.last_name || inlineDuplicate.lastName || ''}`.trim() || inlineDuplicate.name || inlineName.trim();
                                          setClientId(nic);
                                          setResolvedName(fullName);
                                          setClientPhone(inlineDuplicate.phone || inlinePhone.trim());
                                          setClientAddress(inlineDuplicate.address || inlineAddress.trim());
                                          setShowInlineReg(false);
                                          toast.success('Selected existing customer record ✓');
                                        }}
                                        className="w-full py-1.5 bg-red-600 hover:bg-red-700 text-white text-[10px] font-black uppercase tracking-wider rounded-lg shadow cursor-pointer"
                                      >
                                        Select This Existing Customer
                                      </button>
                                    </div>
                                  )}

                                  {/* NIC */}
                                  <div className="grid gap-1">
                                    <div className="flex items-center justify-between">
                                      <label className={`text-[10px] font-black uppercase tracking-wider ${inlineDuplicate ? 'text-red-600' : 'text-slate-500'}`}>NIC Number</label>
                                      {inlineDuplicate && (
                                        <span className="text-[9px] font-black text-red-600 uppercase">Already Registered</span>
                                      )}
                                    </div>
                                    <input
                                      type="text"
                                      value={inlineNic}
                                      onChange={e => setInlineNic(e.target.value)}
                                      placeholder="e.g. 941234567V"
                                      className={`h-9 px-3 rounded-xl text-xs font-mono font-bold w-full focus:outline-none transition-all ${
                                        inlineDuplicate
                                          ? 'border-2 border-red-500 bg-red-50/70 text-red-700 ring-2 ring-red-400/20'
                                          : 'border border-slate-200 bg-white'
                                      }`}
                                    />
                                  </div>

                                {/* Full Name */}
                                <div className="grid gap-1">
                                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Full Name</label>
                                  <input
                                    type="text"
                                    value={inlineName}
                                    onChange={e => setInlineName(e.target.value)}
                                    placeholder="e.g. Kamal Perera"
                                    className="h-9 px-3 rounded-xl border border-slate-200 bg-white text-xs font-bold w-full focus:outline-none focus:ring-2 focus:ring-amber-400"
                                  />
                                </div>

                                {/* Phone & Address */}
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="grid gap-1">
                                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Phone</label>
                                    <input
                                      type="text"
                                      value={inlinePhone}
                                      onChange={e => setInlinePhone(e.target.value)}
                                      placeholder="07X XXX XXXX"
                                      className="h-9 px-3 rounded-xl border border-slate-200 bg-white text-xs font-mono w-full focus:outline-none focus:ring-2 focus:ring-amber-400"
                                    />
                                  </div>
                                  <div className="grid gap-1">
                                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Address</label>
                                    <input
                                      type="text"
                                      value={inlineAddress}
                                      onChange={e => setInlineAddress(e.target.value)}
                                      placeholder="Street, City"
                                      className="h-9 px-3 rounded-xl border border-slate-200 bg-white text-xs w-full focus:outline-none focus:ring-2 focus:ring-amber-400"
                                    />
                                  </div>
                                </div>

                                {/* Save Button */}
                                <Button
                                  type="button"
                                  onClick={handleInlineRegisterCustomer}
                                  disabled={isSavingCustomer || !inlineName.trim()}
                                  className="w-full h-9 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[11px] uppercase tracking-widest rounded-xl gap-2"
                                >
                                  {isSavingCustomer
                                    ? <><RefreshCcw className="w-3.5 h-3.5 animate-spin" /> Saving...</>
                                    : <><UserCheck className="w-3.5 h-3.5" /> Register & Select Customer</>
                                  }
                                </Button>
                                </div>
                              );
                            })()}
                          </div>
                        )}

                        {/* ── KYC Photo Upload Step (after registration) ── */}
                        {showKycStep && (
                          <div className="mt-2 bg-slate-900 border border-amber-500/30 rounded-2xl overflow-hidden">
                            {/* Header */}
                            <div className="px-4 py-3 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between">
                              <div>
                                <p className="text-amber-400 text-[10px] font-black uppercase tracking-widest">KYC Document Capture</p>
                                <p className="text-slate-300 text-[11px] font-semibold mt-0.5">Capture NIC front, back &amp; signature</p>
                              </div>
                              <span className="text-[9px] font-black bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-1 rounded-lg uppercase tracking-wider">
                                Customer Registered ✓
                              </span>
                            </div>

                            {/* Tab Bar */}
                            <div className="grid grid-cols-3 border-b border-white/5">
                              {(['front','back','sign'] as const).map((tab) => {
                                const labels = { front: 'NIC Front', back: 'NIC Back', sign: 'Signature' };
                                const photos = { front: kycFront, back: kycBack, sign: kycSign };
                                const isActive = kycActiveTab === tab;
                                return (
                                  <button key={tab} type="button"
                                    onClick={() => { setKycActiveTab(tab); stopKycCamera(); }}
                                    className={`py-2 text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-1.5 ${
                                      isActive ? 'bg-amber-500/20 text-amber-400 border-b-2 border-amber-500' : 'text-slate-500 hover:text-slate-300'
                                    }`}
                                  >
                                    {photos[tab] ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" /> : null}
                                    {labels[tab]}
                                  </button>
                                );
                              })}
                            </div>

                            {/* Camera / Preview Area */}
                            <div className="p-3">
                              {(() => {
                                const currentPhoto = kycActiveTab === 'front' ? kycFront : kycActiveTab === 'back' ? kycBack : kycSign;
                                return (
                                  <div className="space-y-2">
                                    {kycCameraOn ? (
                                      <div className="relative rounded-xl overflow-hidden bg-black">
                                        <video 
                                          ref={(el) => {
                                            kycVideoRef.current = el;
                                            if (el && kycStreamRef.current) el.srcObject = kycStreamRef.current;
                                          }} 
                                          autoPlay playsInline muted className="w-full h-40 object-cover" 
                                        />
                                        <div className="absolute inset-0 border-2 border-amber-500/50 rounded-xl pointer-events-none" />
                                        <button type="button" onClick={captureKycPhoto}
                                          className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-amber-500 hover:bg-amber-600 text-black font-black text-[11px] uppercase tracking-widest px-4 py-1.5 rounded-full shadow-lg">
                                          📷 Capture
                                        </button>
                                        <button type="button" onClick={stopKycCamera}
                                          className="absolute top-2 right-2 bg-black/60 text-white text-[10px] px-2 py-1 rounded-lg">
                                          ✕
                                        </button>
                                      </div>
                                    ) : currentPhoto ? (
                                      <div className="relative rounded-xl overflow-hidden bg-black">
                                        <img src={currentPhoto} alt="captured" className="w-full h-40 object-contain bg-black" />
                                        <button type="button" onClick={() => { if (kycActiveTab==='front') setKycFront(null); else if (kycActiveTab==='back') setKycBack(null); else setKycSign(null); }}
                                          className="absolute top-2 right-2 bg-red-500/80 hover:bg-red-500 text-white text-[10px] px-2.5 py-1 rounded-lg font-bold shadow-sm">
                                          Retake
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="h-40 rounded-xl bg-slate-800 border border-white/5 flex flex-col items-center justify-center gap-2">
                                        <Camera className="w-8 h-8 text-slate-600" />
                                        <p className="text-slate-500 text-[11px]">No photo captured</p>
                                      </div>
                                    )}

                                    {!kycCameraOn && !currentPhoto && (
                                      <button type="button" onClick={startKycCamera}
                                        className="w-full flex items-center justify-center gap-2 py-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 rounded-xl font-black text-[11px] uppercase tracking-widest transition-all">
                                        <Camera className="w-4 h-4" /> Open Camera
                                      </button>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>

                            {/* Footer Actions */}
                            <div className="px-3 pb-3 flex gap-2">
                              <button type="button" onClick={() => { stopKycCamera(); setShowKycStep(false); }}
                                className="flex-1 py-2 rounded-xl border border-white/10 text-slate-400 hover:text-white text-[11px] font-bold uppercase tracking-widest transition-all">
                                Skip
                              </button>
                              <button type="button" onClick={handleInlineKycSave} disabled={isSavingKyc || (!kycFront && !kycBack && !kycSign)}
                                className="flex-[2] py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-black text-[11px] uppercase tracking-widest transition-all flex items-center justify-center gap-2">
                                {isSavingKyc ? <><RefreshCcw className="w-3.5 h-3.5 animate-spin" /> Saving...</> : <><UserCheck className="w-3.5 h-3.5" /> Save KYC Photos</>}
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}

                  {resolvedName && !showKycStep && (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-xl mt-1">
                      <UserCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span className="text-emerald-700 font-black text-xs">{resolvedName}</span>
                    </div>
                  )}
                </div>

                {/* Extended Contact Info */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Phone Number</Label>
                    <Input
                      value={clientPhone}
                      onChange={e => setClientPhone(e.target.value)}
                      placeholder="07X XXX XXXX"
                      className="h-10 bg-white/80 rounded-xl text-xs font-mono"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Address</Label>
                    <Input
                      value={clientAddress}
                      onChange={e => setClientAddress(e.target.value)}
                      placeholder="Customer Address"
                      className="h-10 bg-white/80 rounded-xl text-xs"
                    />
                  </div>
                </div>

                {/* Target Branch and Pawning Date Selection */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 bg-amber-50/70 border border-amber-200/90 rounded-2xl">
                  <div className="grid gap-1.5">
                    <Label className="font-black text-[10px] uppercase tracking-widest text-amber-900 flex items-center justify-between">
                      <span>Target Branch</span>
                      {userRole === 'ADMIN' && <span className="text-[9px] text-amber-600 font-bold">(Admin Select)</span>}
                    </Label>
                    {userRole === 'ADMIN' ? (
                      <select
                        value={branchId}
                        onChange={e => setBranchId(e.target.value)}
                        className="h-10 px-3 bg-white rounded-xl border border-amber-300 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                      >
                        <option value="">-- Select Branch --</option>
                        {branches.filter(b => b.id !== 'ALL').map(b => (
                          <option key={b.id || b.code} value={b.id || b.code}>
                            {b.name || b.code} ({b.id || b.code})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="h-10 px-3 flex items-center bg-white/80 rounded-xl border border-amber-200 text-xs font-bold text-slate-700">
                        {branches.find(b => (b.id || b.code) === branchId)?.name || branchId || 'Current Branch'}
                      </div>
                    )}
                  </div>

                  <div className="grid gap-1.5">
                    <Label className="font-black text-[10px] uppercase tracking-widest text-amber-900">
                      Pawning Date
                    </Label>
                    <Input
                      type="date"
                      value={pawnDate}
                      onChange={e => setPawnDate(e.target.value)}
                      className="h-10 bg-white rounded-xl text-xs font-bold border-amber-300"
                    />
                  </div>
                </div>

                {/* Bill Prefix & Bill Number Block */}
                <div className="grid gap-3 p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between flex-wrap gap-1.5">
                      <Label className="font-black text-[10px] uppercase tracking-widest text-slate-500">Bill Type / Prefix</Label>
                      <Badge className="bg-amber-500/10 text-amber-800 border border-amber-500/20 font-black text-[10px] uppercase tracking-wider px-2.5 py-0.5">
                        Tenor: {periodMonths} {parseInt(periodMonths) === 1 ? 'Month' : 'Months'} (Auto)
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {BILL_PREFIXES.map(pref => (
                        <button
                          key={pref}
                          type="button"
                          onClick={() => handlePrefixChange(pref)}
                          className={`px-3 py-1.5 text-xs font-black rounded-xl transition-all border ${
                            billPrefix === pref
                              ? 'bg-primary text-white border-primary shadow-md scale-105'
                              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {pref}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-1.5">
                    <Label className="font-black text-[10px] uppercase tracking-widest text-slate-500">Bill Number</Label>
                    <div className="flex items-center gap-2">
                      <span className="font-black text-sm text-primary px-3 py-2 bg-primary/10 border border-primary/20 rounded-xl">
                        {billPrefix || '1R'}
                      </span>
                      <Input
                        value={billNo}
                        onChange={e => setBillNo(e.target.value)}
                        placeholder="E.g., 20743"
                        className={`h-10 bg-white rounded-xl font-mono font-bold text-xs ${
                          (() => {
                            const numPart = extractNumericBillNo(billNo);
                            const isChanging = !editingPawn || !isSameNumericBill(editingPawn.bill_no || editingPawn.display_bill_no || editingPawn.description, billNo);
                            return isChanging && numPart && (pawns || []).some((p: any) => 
                              (!editingPawn || p.id !== editingPawn.id) &&
                              isSameNumericBill(p.bill_no || p.display_bill_no || p.description, billNo)
                            ) ? 'border-rose-500 text-rose-600 focus:ring-rose-500' : '';
                          })()
                        }`}
                      />
                    </div>
                    {(() => {
                      const isChanging = !editingPawn || !isSameNumericBill(editingPawn.bill_no || editingPawn.display_bill_no || editingPawn.description, billNo);
                      if (!isChanging) return null;
                      const numPart = extractNumericBillNo(billNo);
                      if (!numPart) return null;
                      const targetBranch = normalizeBranchId(editingPawn?.branch_id || editingPawn?.branchId || branchId || 'HQ');
                      const dupPawn = (pawns || []).find((p: any) => {
                        if (editingPawn && p.id === editingPawn.id) return false;
                        const pBranch = normalizeBranchId(p.branch_id || p.branchId || '');
                        if (targetBranch !== 'ALL' && pBranch && pBranch !== targetBranch) return false;
                        return isSameNumericBill(p.bill_no || p.display_bill_no || p.description, billNo);
                      });
                      if (dupPawn) {
                        return (
                          <p className="text-rose-600 font-bold text-xs flex items-center gap-1 mt-1">
                            <AlertTriangle className="w-3.5 h-3.5" /> Duplicate Bill Number: Bill number {numPart} already exists in {targetBranch} branch.
                          </p>
                        );
                      }
                      return null;
                    })()}
                  </div>
                </div>

              </div>

              {/* RIGHT COLUMN: Multi-Item Collateral & Valuation */}
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">
                    2. Collateral Items & Valuation (Milligrams - mg)
                  </h3>
                  <Button type="button" size="sm" onClick={handleAddItem} className="h-7 px-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-[10px] uppercase tracking-wider rounded-lg gap-1">
                    <Plus className="w-3 h-3" /> Add Item (+)
                  </Button>
                </div>

                {/* Multi-Item Collateral List (Responsive View) */}
                <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                  <div className="hidden sm:grid grid-cols-12 gap-2 px-2 py-1 bg-slate-100/80 rounded-lg text-[9px] font-black uppercase tracking-widest text-slate-500">
                    <span className="col-span-5">Item</span>
                    <span className="col-span-3">Purity</span>
                    <span className="col-span-3">Weight (mg)</span>
                    <span className="col-span-1 text-center">Action</span>
                  </div>

                  {itemsList.map((item, idx) => {
                    const isOther = item.itemType === 'OTHER';
                    return (
                      <div key={idx} className="p-2.5 sm:p-2 bg-slate-50 border border-slate-200 rounded-xl space-y-2 transition-all">
                        {/* Mobile View (< sm) */}
                        <div className="flex sm:hidden flex-col gap-2">
                          <div className="flex items-center gap-2">
                            <div className="flex-1">
                              <Select
                                value={item.itemType || 'CH'}
                                onValueChange={v => handleUpdateItem(idx, 'itemType', v)}
                              >
                                <SelectTrigger className="h-9 bg-white border-slate-200 text-xs font-bold w-full">
                                  <SelectValue placeholder="Select Item" />
                                </SelectTrigger>
                                <SelectContent className="bg-white border-slate-200">
                                  {ITEM_OPTIONS.map(opt => (
                                    <SelectItem key={opt.code} value={opt.code} className="text-xs font-medium">
                                      {opt.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            {itemsList.length > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRemoveItem(idx)}
                                className="h-9 w-9 p-0 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg shrink-0"
                                title="Remove Item"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Select
                                value={item.purity || '22K'}
                                onValueChange={v => handleUpdateItem(idx, 'purity', v)}
                              >
                                <SelectTrigger className="h-9 bg-white border-slate-200 text-xs font-bold w-full">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-white border-slate-200">
                                  <SelectItem value="24K" className="text-xs font-bold">24K (99.9%)</SelectItem>
                                  <SelectItem value="22K" className="text-xs font-bold">22K (91.6%)</SelectItem>
                                  <SelectItem value="20K" className="text-xs font-bold">20K (83.3%)</SelectItem>
                                  <SelectItem value="18K" className="text-xs font-bold">18K (75.0%)</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="relative flex items-center">
                              <Input
                                type="number"
                                value={item.weightMg}
                                onChange={e => handleUpdateItem(idx, 'weightMg', e.target.value)}
                                placeholder="12500"
                                className="h-9 bg-white font-mono font-bold text-xs pr-7 w-full"
                              />
                              <span className="absolute right-2 text-[10px] font-black text-slate-400 pointer-events-none">mg</span>
                            </div>
                          </div>
                        </div>

                        {/* Desktop View (>= sm) */}
                        <div className="hidden sm:grid grid-cols-12 gap-2 items-center">
                          <div className="col-span-5">
                            <Select
                              value={item.itemType || 'CH'}
                              onValueChange={v => handleUpdateItem(idx, 'itemType', v)}
                            >
                              <SelectTrigger className="h-9 bg-white border-slate-200 text-xs font-bold w-full">
                                <SelectValue placeholder="Select Item" />
                              </SelectTrigger>
                              <SelectContent className="bg-white border-slate-200">
                                {ITEM_OPTIONS.map(opt => (
                                  <SelectItem key={opt.code} value={opt.code} className="text-xs font-medium">
                                    {opt.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="col-span-3">
                            <Select
                              value={item.purity || '22K'}
                              onValueChange={v => handleUpdateItem(idx, 'purity', v)}
                            >
                              <SelectTrigger className="h-9 bg-white border-slate-200 text-xs font-bold w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-white border-slate-200">
                                <SelectItem value="24K" className="text-xs font-bold">24K (99.9%)</SelectItem>
                                <SelectItem value="22K" className="text-xs font-bold">22K (91.6%)</SelectItem>
                                <SelectItem value="20K" className="text-xs font-bold">20K (83.3%)</SelectItem>
                                <SelectItem value="18K" className="text-xs font-bold">18K (75.0%)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="col-span-3 relative flex items-center">
                            <Input
                              type="number"
                              value={item.weightMg}
                              onChange={e => handleUpdateItem(idx, 'weightMg', e.target.value)}
                              placeholder="12500"
                              className="h-9 bg-white font-mono font-bold text-xs pr-7 w-full"
                            />
                            <span className="absolute right-2 text-[10px] font-black text-slate-400 pointer-events-none">mg</span>
                          </div>
                          <div className="col-span-1 flex justify-center">
                            {itemsList.length > 1 ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRemoveItem(idx)}
                                className="h-8 w-8 p-0 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg"
                                title="Remove Item"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            ) : (
                              <div className="w-8" />
                            )}
                          </div>
                        </div>

                        {/* Custom Text Field for OTHER */}
                        {isOther && (
                          <div className="pt-1">
                            <Input
                              value={item.customType || item.description || ''}
                              onChange={e => {
                                handleUpdateItem(idx, 'customType', e.target.value);
                                handleUpdateItem(idx, 'description', e.target.value);
                              }}
                              placeholder="Enter custom item description (e.g., Gold Waist Chain / අරනූල්)..."
                              className="h-8 bg-amber-50/50 border-amber-200 text-xs font-semibold text-amber-950 placeholder:text-amber-700/50"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Aggregate Summary */}
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center justify-between text-xs flex-wrap gap-1">
                  <div className="flex items-center gap-2 text-amber-900 font-bold">
                    <Scale className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Collateral Items: {itemsList.length}</span>
                  </div>
                  <span className="font-mono font-black text-amber-900 text-xs">
                    Total Weight: {itemsList.reduce((s, i) => s + (parseFloat(i.weightMg) || 0), 0).toLocaleString()} mg
                  </span>
                </div>

                {/* Financial Values */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="grid gap-1">
                    <Label className="font-black text-[10px] uppercase tracking-widest text-slate-500">Appraised Value (Rs.)</Label>
                    <Input value={appraisal} onChange={e => setAppraisal(e.target.value)} type="number" placeholder="100000" className="h-11 bg-white rounded-xl text-xs font-bold" />
                  </div>
                  <div className="grid gap-1">
                    <Label className="font-black text-[10px] uppercase tracking-widest text-slate-500">Disbursed Amount (Rs.)</Label>
                    <Input value={amount} onChange={e => setAmount(e.target.value)} type="number" placeholder="85000" className="h-11 bg-blue-50 border-blue-300 rounded-xl text-xs font-black text-blue-900" />
                  </div>
                </div>

              </div>

            </div>
          </div>

          {/* Fixed Footer */}
          <div className="p-4 sm:p-6 pt-3 border-t border-slate-100 bg-slate-50/80 shrink-0 flex flex-col-reverse sm:flex-row justify-end gap-2.5">
            <Button variant="ghost" className="font-bold text-slate-500 h-11 sm:h-12 rounded-xl w-full sm:w-auto" onClick={() => setIsOpen(false)}>Cancel</Button>
            <Button
              disabled={isSaving}
              onClick={handleSave}
              className="bg-primary hover:bg-primary/90 text-white font-black px-8 h-11 sm:h-12 rounded-xl shadow-lg shadow-primary/20 gap-2 w-full sm:w-auto"
            >
              {isSaving ? <RefreshCcw className="w-4 h-4 animate-spin" /> : null}
              {isSaving ? 'Saving...' : (editingPawn ? 'Update Ticket' : 'Finalize & Disburse')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Summary Stats */}
      <div className="grid gap-6 md:grid-cols-3">
        {[
          { label: 'Active Pawn Items',  value: loading ? '—' : filtered.length.toString(),                    icon: Package,       color: 'text-indigo-600',  bg: 'bg-indigo-50' },
          { label: 'Capital Disbursed',  value: loading ? '—' : `Rs. ${totalDisbursed.toLocaleString()}`,      icon: TrendingUp,    color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Items in Arrears',   value: '0',                                                            icon: AlertTriangle, color: 'text-rose-600',    bg: 'bg-rose-50' },
        ].map(s => (
          <Card key={s.label} className="glass border-white/50 shadow-xl rounded-3xl overflow-hidden group hover:shadow-2xl transition-all duration-500">
            <CardContent className="p-8 flex items-center gap-6">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${s.bg} shrink-0`}>
                <s.icon className={`h-7 w-7 ${s.color}`} />
              </div>
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{s.label}</p>
                <p className={`text-3xl font-black tracking-tighter leading-none ${s.color}`}>{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search & Action Bar with Multi-Option Filters (Add Pawn, Branch, Item Description, Status) */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search by Bill #, Client, NIC, Phone, Description..."
            className="pl-10 h-11 bg-white/70 border-slate-200 glass focus:ring-primary shadow-xs rounded-xl font-bold text-xs"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Add Pawn Button (Near Searching Bar) */}
        <Button
          onClick={() => setIsEvaluationOpen(true)}
          className="h-11 px-5 bg-amber-500 hover:bg-amber-600 text-white font-black uppercase tracking-wider text-xs shadow-md shadow-amber-500/20 rounded-xl gap-2 shrink-0 cursor-pointer transition-all active:scale-95"
        >
          <Plus className="h-4 w-4 stroke-[3]" />
          <span>Add Pawn</span>
        </Button>

        {/* Filters Group */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 shrink-0">
          {/* Branch Filter with Multi-Select Popover Card (Locked for Tellers, interactive for Admins) */}
          <div className="relative min-w-[180px] sm:min-w-[210px]" ref={branchDropdownRef}>
            <button
              type="button"
              id="loans-branch-filter-btn"
              disabled={isBranchLocked}
              onClick={() => {
                if (!isBranchLocked) {
                  setIsBranchFilterOpen(!isBranchFilterOpen);
                }
              }}
              title={isBranchLocked ? `Pawning strictly restricted to ${getBranchButtonLabel()}` : 'Filter pawns by branch'}
              className={`h-11 w-full px-3.5 pr-8 bg-white/90 border ${
                isBranchFilterOpen ? 'border-primary ring-2 ring-primary/20' : 'border-slate-200'
              } glass font-black text-[11px] uppercase tracking-wider text-slate-800 rounded-xl shadow-xs ${
                isBranchLocked
                  ? 'cursor-default opacity-90'
                  : 'hover:border-primary/60 cursor-pointer'
              } transition-all flex items-center justify-between select-none`}
            >
              <div className="flex items-center gap-1.5 truncate">
                <span className="truncate">{getBranchButtonLabel()}</span>
                {isBranchLocked ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" title="Locked to your assigned branch" />
                ) : (
                  !selectedBranches.includes('ALL') && selectedBranches.length > 0 && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                  )
                )}
              </div>
              <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-primary">
                {isBranchLocked ? (
                  <Lock className="w-3.5 h-3.5 text-slate-400" />
                ) : (
                  <Filter className="w-3.5 h-3.5" />
                )}
              </div>
            </button>

            {/* Interactive Multi-Select Popover Card (Only rendered when not locked) */}
            {!isBranchLocked && isBranchFilterOpen && (
              <div className="absolute right-0 top-13 z-50 w-72 bg-white/95 backdrop-blur-xl border border-slate-200/90 shadow-2xl rounded-2xl p-3 space-y-2.5 animate-in fade-in zoom-in-95 duration-150">
                {/* Header & Quick Actions */}
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-primary" />
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-700">Select Branches</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {branchId && (
                      <button
                        type="button"
                        onClick={selectHomeBranchOnly}
                        className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-lg bg-slate-100 hover:bg-primary hover:text-white text-slate-600 transition-colors cursor-pointer"
                        title="Reset to only your home branch"
                      >
                        My Branch
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={selectAllBranches}
                      className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-lg bg-slate-100 hover:bg-primary hover:text-white text-slate-600 transition-colors cursor-pointer"
                      title="Select all branches"
                    >
                      All
                    </button>
                  </div>
                </div>

                {/* All Branches Option */}
                <div
                  onClick={() => toggleBranch('ALL')}
                  className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl cursor-pointer transition-colors ${
                    selectedBranches.includes('ALL')
                      ? 'bg-primary/10 text-primary font-black'
                      : 'hover:bg-slate-50 text-slate-700 font-bold'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-3.5 h-3.5 rounded-md border flex items-center justify-center transition-colors ${
                      selectedBranches.includes('ALL')
                        ? 'bg-primary border-primary text-white'
                        : 'border-slate-300 bg-white'
                    }`}>
                      {selectedBranches.includes('ALL') && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                    </div>
                    <span className="text-[11px]">All Branches</span>
                  </div>
                  <Badge variant="outline" className="text-[8px] font-black uppercase px-1 py-0">ALL</Badge>
                </div>

                <div className="h-px bg-slate-100 my-0.5" />

                {/* Branch Checklist */}
                <div className="max-h-48 overflow-y-auto space-y-1 pr-1 overscroll-contain">
                  {branches.filter(b => b.id !== 'ALL').map((b: any) => {
                    const isTicked = selectedBranches.includes('ALL') || selectedBranches.some(bCode => bCode.toUpperCase() === b.id.toUpperCase());
                    const isHome = branchId && b.id.toUpperCase() === branchId.toUpperCase();
                    return (
                      <div
                        key={b.id}
                        onClick={() => toggleBranch(b.id)}
                        className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl cursor-pointer transition-colors ${
                          isTicked
                            ? 'bg-slate-50 text-slate-900 font-black'
                            : 'hover:bg-slate-50 text-slate-600 font-medium'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <div className={`w-3.5 h-3.5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                            isTicked
                              ? 'bg-primary border-primary text-white'
                              : 'border-slate-300 bg-white'
                          }`}>
                            {isTicked && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                          </div>
                          <span className="text-[11px] truncate">{b.name || b.id} Branch</span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {isHome && (
                            <span className="text-[7px] font-black uppercase px-1 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                              HOME
                            </span>
                          )}
                          <span className="text-[9px] font-mono font-bold text-slate-400 uppercase">
                            {b.id}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Popover Footer */}
                <div className="border-t border-slate-100 pt-2 flex items-center justify-between">
                  <span className="text-[9px] font-bold text-slate-400">
                    {pawns.length} ticket{pawns.length === 1 ? '' : 's'} loaded
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsBranchFilterOpen(false)}
                    className="px-2.5 py-1 bg-primary text-white text-[9px] font-black uppercase tracking-wider rounded-lg shadow-xs hover:bg-primary/90 transition-colors cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Item Description Filter */}
          <div className="relative min-w-[130px]">
            <select
              value={filterDescription}
              onChange={e => setFilterDescription(e.target.value)}
              className="h-11 w-full px-3 pr-8 bg-white/80 border border-slate-200 font-bold text-[11px] uppercase tracking-wider text-slate-700 rounded-xl shadow-xs focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer appearance-none truncate"
            >
              <option value="ALL">All Items</option>
              <option value="Ring">Ring (PR)</option>
              <option value="Chain">Chain</option>
              <option value="Earrings">Earrings (EAR)</option>
              <option value="Necklace">Necklace (NL)</option>
              <option value="Bangle">Bangle (BGL)</option>
              <option value="Pendant">Pendant (PP)</option>
              <option value="Bracelet">Bracelet (BRC)</option>
            </select>
            <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">
              <Package className="w-3.5 h-3.5 text-indigo-500" />
            </div>
          </div>

          {/* Status Filter */}
          <div className="relative min-w-[130px]">
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="h-11 w-full px-3 pr-8 bg-white/80 border border-slate-200 font-bold text-[11px] uppercase tracking-wider text-slate-700 rounded-xl shadow-xs focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer appearance-none truncate"
            >
              <option value="ALL">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="PENDING_APPROVAL">Pending Approval</option>
              <option value="AUDITED_PENDING_APPROVAL">Audited (Pending Mgr)</option>
              <option value="REQUIRES_RECHECK">Requires Recheck</option>
              <option value="REDEEMED">Redeemed</option>
            </select>
            <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            </div>
          </div>
        </div>

        {/* Reset Filter Button if active */}
        {(selectedBranches.length > 0 && !selectedBranches.includes('ALL') || filterDescription !== 'ALL' || filterStatus !== 'ALL' || search) && (
          <Button
            variant="ghost"
            onClick={() => {
              selectAllBranches();
              setFilterDescription('ALL');
              setFilterStatus('ALL');
              setSearch('');
            }}
            className="h-11 px-3 text-slate-500 hover:text-rose-600 hover:bg-rose-50 text-[11px] font-black uppercase tracking-wider rounded-xl transition-all shrink-0 cursor-pointer"
            title="Reset all filters"
          >
            Reset
          </Button>
        )}
      </div>

      {/* Table — Screen fitting for tablet & desktop */}
      <div className="w-full overflow-x-auto glass border-white/50 rounded-2xl shadow-xl bg-white/70">
        <Table className="w-full text-xs">
          <TableHeader className="bg-slate-50/80 border-b border-slate-200/70">
            <TableRow>
              <TableHead className="px-2.5 py-2.5 font-black text-[10px] uppercase tracking-wider text-slate-400 whitespace-nowrap">Bill #</TableHead>
              <TableHead className="px-1.5 py-2.5 font-black text-[10px] uppercase tracking-wider text-slate-400 whitespace-nowrap">Branch</TableHead>
              <TableHead className="px-2 py-2.5 font-black text-[10px] uppercase tracking-wider text-slate-400">Customer</TableHead>
              <TableHead className="px-2 py-2.5 font-black text-[10px] uppercase tracking-wider text-slate-400">Item Description</TableHead>
              <TableHead className="px-2 py-2.5 font-black text-[10px] uppercase tracking-wider text-slate-400 text-right whitespace-nowrap">Appraised (LKR)</TableHead>
              <TableHead className="px-2 py-2.5 font-black text-[10px] uppercase tracking-wider text-slate-400 text-right whitespace-nowrap">Disbursed (LKR)</TableHead>
              <TableHead className="px-1.5 py-2.5 text-center font-black text-[10px] uppercase tracking-wider text-slate-400 whitespace-nowrap">Status</TableHead>
              <TableHead className="px-1.5 py-2.5 text-center font-black text-[10px] uppercase tracking-wider text-slate-400 whitespace-nowrap">Date</TableHead>
              <TableHead className="px-1 py-2.5 text-center font-black text-[10px] uppercase tracking-wider text-slate-400 whitespace-nowrap">Photos</TableHead>
              <TableHead className="px-2 py-2.5 text-right font-black text-[10px] uppercase tracking-wider text-slate-400 whitespace-nowrap">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-slate-100">
            {loading ? (
              <TableRow><TableCell colSpan={10} className="h-64 text-center font-black text-slate-300 animate-pulse tracking-widest uppercase">Loading pawn registry...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="h-64 text-center">
                  <div className="flex flex-col items-center justify-center gap-4">
                    <FileText className="h-12 w-12 text-slate-200" />
                    <p className="text-slate-400 font-bold">{search || filterBranch !== 'ALL' || filterDescription !== 'ALL' || filterStatus !== 'ALL' ? 'No matching pawn items found.' : "No active pawn items. Click 'Originate Pawn' to begin."}</p>
                    {!search && filterBranch === 'ALL' && filterDescription === 'ALL' && filterStatus === 'ALL' && (
                      <Button variant="outline" onClick={openAdd} className="border-primary/20 text-primary font-black text-[10px] uppercase tracking-widest h-12 rounded-xl hover:bg-primary hover:text-white transition-all px-8">
                        Create First Ticket
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map(pawn => (
                <TableRow key={pawn.id} className="group hover:bg-primary/5 transition-all duration-200">
                  <TableCell className="px-2.5 py-2 font-black text-primary text-xs tracking-tight whitespace-nowrap">
                    {getBillNo(pawn)}
                  </TableCell>
                  <TableCell className="px-1.5 py-2 whitespace-nowrap">
                    <Badge className="bg-slate-100 text-slate-700 border-slate-200 font-bold text-[9px] uppercase px-1.5 py-0.5">
                      {pawn.branch_id || 'HQ'}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-2 py-2">
                    {(() => {
                      const rawNic = getClientNic(pawn);
                      const isUuid = rawNic.length > 20 && rawNic.includes('-');
                      const displayNic = isUuid ? `${rawNic.substring(0, 8)}...${rawNic.slice(-4)}` : rawNic;
                      const custName = getCustomerName(pawn);
                      return (
                        <div className="flex flex-col max-w-[130px] xl:max-w-[150px]">
                          <span className="font-mono font-bold text-slate-900 group-hover:text-primary transition-colors text-[11px] truncate" title={rawNic}>
                            {displayNic}
                          </span>
                          {custName ? (
                            <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-tight truncate mt-0.5" title={custName}>
                              {custName}
                            </span>
                          ) : null}
                        </div>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="px-2 py-2 font-bold text-slate-700 text-xs max-w-[125px] truncate" title={getCleanDescription(pawn)}>
                    {getCleanDescription(pawn)}
                  </TableCell>
                  <TableCell className="px-2 py-2 font-bold text-amber-700 text-xs text-right whitespace-nowrap">
                    Rs. {(pawn.appraised_value || 0).toLocaleString()}
                  </TableCell>
                  <TableCell className="px-2 py-2 font-black text-blue-700 text-xs text-right whitespace-nowrap">
                    Rs. {(pawn.disbursed_amount || 0).toLocaleString()}
                  </TableCell>
                  <TableCell className="px-1.5 py-2 text-center whitespace-nowrap">
                    <Badge className={`font-black text-[8.5px] uppercase tracking-wider px-2 py-0.5 border ${
                      pawn.status === 'REQUIRES_RECHECK'
                        ? "bg-rose-100 text-rose-800 border-rose-300 animate-pulse"
                        : pawn.status === 'AUDITED_PENDING_APPROVAL'
                        ? "bg-blue-50 text-blue-800 border-blue-200"
                        : pawn.status === 'PENDING_APPROVAL' 
                        ? "bg-amber-50 text-amber-800 border-amber-200"
                        : pawn.status === 'ACTIVE'
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : pawn.status === 'REDEEMED'
                            ? "bg-purple-50 text-purple-700 border-purple-200"
                            : "bg-slate-50 text-slate-700 border-slate-200"
                    }`}>
                      {pawn.status === 'REQUIRES_RECHECK' 
                        ? 'RECHECK' 
                        : pawn.status === 'AUDITED_PENDING_APPROVAL'
                        ? 'AUDITED'
                        : (pawn.status || 'ACTIVE')}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-1.5 py-2 text-center text-slate-500 font-bold text-[10px] uppercase tracking-wider whitespace-nowrap">
                    {pawn.created_at ? new Date(pawn.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'}
                  </TableCell>
                  <TableCell className="px-1 py-2 text-center whitespace-nowrap">
                    {(() => {
                      const hasScalePhoto = !!(pawn.air_weight_photo_url || pawn.water_weight_photo_url);
                      const cid = pawn.client_id || '';
                      const client = pawn.clients || clientsList.find(c => 
                        String(c.id).toLowerCase() === String(cid).toLowerCase() || 
                        String(c.national_id || c.nationalId || '').toLowerCase() === String(cid).toLowerCase()
                      );
                      const hasKycPhoto = !!(client?.nic_image || client?.nicImage || client?.signature_image || client?.signatureImage);

                      if (hasScalePhoto || hasKycPhoto) {
                        return (
                          <button
                            type="button"
                            onClick={() => handleOpenPhotoViewer(pawn)}
                            className="inline-flex items-center gap-1 px-1.5 py-1 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-all shadow-xs cursor-pointer group"
                            title="Click to view Scale & KYC Photos"
                          >
                            {pawn.air_weight_photo_url ? (
                              <img 
                                src={pawn.air_weight_photo_url} 
                                alt="Scale" 
                                className="w-4 h-4 object-cover rounded border border-amber-300 shrink-0"
                              />
                            ) : (
                              <div className="w-4 h-4 rounded bg-amber-200 flex items-center justify-center text-[8px] font-black text-amber-800 shrink-0">
                                🪪
                              </div>
                            )}
                            <span className="text-[9px] font-black text-amber-800">
                              {hasScalePhoto && hasKycPhoto ? 'Scale+KYC' : hasScalePhoto ? 'Scale' : 'KYC'}
                            </span>
                          </button>
                        );
                      }
                      return <span className="text-[10px] text-slate-300 font-bold">—</span>;
                    })()}
                  </TableCell>
                  <TableCell className="px-2 py-2 text-right whitespace-nowrap">
                    <div className="flex items-center gap-1 justify-end">
                      {pawn.status === 'PENDING_APPROVAL' && userRole !== 'TELLER' && (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => handleApprove(pawn)}
                          className="h-7 px-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1 font-bold text-[10px] shrink-0 shadow-xs cursor-pointer"
                        >
                          <UserCheck className="h-3 w-3" /> Approve
                        </Button>
                      )}
                      {pawn.status === 'ACTIVE' && (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => openRedeem(pawn)}
                          className="h-7 px-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white flex items-center gap-1 font-bold text-[10px] shrink-0 shadow-xs cursor-pointer"
                        >
                          <Coins className="h-3 w-3" /> Settle
                        </Button>
                      )}
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => openDetails(pawn)}
                        className="h-7 px-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1 font-bold text-[10px] shrink-0 shadow-xs cursor-pointer"
                      >
                        <FileText className="h-3 w-3" /> Details
                      </Button>

                      {/* Dropdown for SMS Reminder, Edit, and Delete */}
                      <DropdownMenu>
                        <DropdownMenuTrigger className="h-7 w-7 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-800 transition-colors cursor-pointer outline-none shrink-0 shadow-xs">
                          <MoreVertical className="w-3.5 h-3.5" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48 glass p-1.5 rounded-xl border-slate-200 shadow-xl bg-white/95">
                          {pawn.status === 'ACTIVE' && (
                            <DropdownMenuItem onClick={() => handleSendReminder(pawn)} className="gap-2 px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-50 rounded-lg cursor-pointer">
                              <Send className="w-3.5 h-3.5 text-amber-600" /> Send SMS Reminder
                            </DropdownMenuItem>
                          )}
                          {userRole === 'TELLER' ? (
                            <>
                              <DropdownMenuItem onClick={() => openEdit(pawn)} className="gap-2 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer">
                                <Pencil className="w-3.5 h-3.5 text-amber-500" /> Request Edit Ticket
                              </DropdownMenuItem>
                              <DropdownMenuSeparator className="my-1 bg-slate-100" />
                              <DropdownMenuItem onClick={() => openChangeRequest(pawn, 'DELETE')} className="gap-2 px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer">
                                <Trash2 className="w-3.5 h-3.5 text-rose-500" /> Request Delete Ticket
                              </DropdownMenuItem>
                            </>
                          ) : (
                            <>
                              <DropdownMenuItem onClick={() => openEdit(pawn)} className="gap-2 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer">
                                <Pencil className="w-3.5 h-3.5 text-slate-500" /> Edit Pawn Record
                              </DropdownMenuItem>
                              <DropdownMenuSeparator className="my-1 bg-slate-100" />
                              <DropdownMenuItem onClick={() => handleDelete(pawn)} className="gap-2 px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer">
                                <Trash2 className="w-3.5 h-3.5 text-rose-500" /> Delete Ticket
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pawn Redemption & Settlement Dialog */}
      <Dialog open={isRedeemOpen} onOpenChange={setIsRedeemOpen}>
        <DialogContent className="w-[95vw] md:w-full md:max-w-4xl max-h-[90vh] overflow-y-auto border border-slate-800 shadow-2xl rounded-3xl p-8 bg-slate-950 text-slate-100">
          <DialogHeader className="border-b border-white/10 pb-4 mb-6">
            <div className="flex items-center gap-2 text-purple-400">
              <Coins className="w-6 h-6 animate-bounce" />
              <DialogTitle className="text-2xl font-black tracking-tight text-white">
                Pawn Redemption & Settlement Engine
              </DialogTitle>
            </div>
            <DialogDescription className="text-slate-400 font-bold uppercase tracking-wider text-xs">
              Rupasinghe Core Settlement System
            </DialogDescription>
          </DialogHeader>

          {redeemingPawn && (() => {
            const principal = redeemingPawn.disbursed_amount || 0;
            const {
              interestRate,
              interestOne,
              totalAmount,
              finalTotalInterest,
              settlement,
              accrualExpr,
              accrualDesc,
              activeNodeIndex,
              accruedCharges
            } = calculateRedemption(principal, redeemDays, redeemInsurance);

            return (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Left Column: Controls & Presets */}
                <div className="space-y-6">
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-2">Transaction Details</h3>
                    <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-2">
                      <div className="flex justify-between">
                        <span className="text-slate-400 text-sm">Ticket ID:</span>
                        <span className="font-mono text-sm font-bold text-white">#{redeemingPawn.id?.substring(0, 8).toUpperCase()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400 text-sm">Customer:</span>
                        <span className="text-sm font-bold text-emerald-400">{clientsMap[redeemingPawn.client_id?.toLowerCase()] || redeemingPawn.client_id}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400 text-sm">Description:</span>
                        <span className="text-sm font-bold text-slate-200">{redeemingPawn.description}</span>
                      </div>
                    </div>
                  </div>

                  {/* Principal (Read Only) */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label className="text-slate-300 font-bold">Principal Amount (LKR)</Label>
                      <span className="bg-purple-900/50 text-purple-300 border border-purple-700/50 text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded">Tier {principal < 50000 ? 'A' : 'B'}</span>
                    </div>
                    <div className="relative flex items-center">
                      <span className="absolute left-4 font-mono text-slate-500 font-bold">Rs.</span>
                      <Input
                        type="text"
                        readOnly
                        value={principal.toLocaleString()}
                        className="bg-white/5 border-white/10 text-white font-mono text-lg font-bold pl-12 rounded-xl"
                      />
                    </div>
                  </div>

                  {/* Days Slider */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label className="text-slate-300 font-bold">Days Elapsed</Label>
                      <span className="font-mono text-sm font-black bg-purple-500/20 text-purple-300 border border-purple-500/30 px-3 py-0.5 rounded-xl">{redeemDays} Days</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="365"
                      value={redeemDays}
                      onChange={e => setRedeemDays(parseInt(e.target.value))}
                      className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-purple-500 focus:outline-none"
                    />
                    {/* Milestones */}
                    <div className="flex flex-wrap gap-2 mt-1">
                      {[5, 15, 35, 42, 55, 95].map(d => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setRedeemDays(d)}
                          className={`text-[10px] font-bold px-2 py-1 rounded-lg border transition-all ${
                            redeemDays === d
                              ? 'bg-purple-500 border-purple-500 text-white'
                              : 'bg-white/5 border-white/10 text-slate-400 hover:text-white hover:bg-white/10'
                          }`}
                        >
                          Day {d}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Manual Insurance Amount */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label className="text-slate-300 font-bold">Insurance Amount (LKR) [Manual]</Label>
                      <span className="bg-purple-500 text-slate-950 text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded">Manual</span>
                    </div>
                    <div className="relative flex items-center">
                      <span className="absolute left-4 font-mono text-slate-500 font-bold">Rs.</span>
                      <Input
                        type="number"
                        value={redeemInsurance}
                        onChange={e => setRedeemInsurance(e.target.value)}
                        className="bg-white/5 border-white/10 text-white font-mono text-lg font-bold pl-12 rounded-xl"
                      />
                    </div>
                    {/* Presets */}
                    <div className="flex gap-2">
                      {['10', '50', '100', '250', '500'].map(p => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setRedeemInsurance(p)}
                          className={`text-[10px] font-bold px-3 py-1.5 rounded-lg border transition-all ${
                            redeemInsurance === p
                              ? 'bg-purple-500 border-purple-500 text-white shadow-lg'
                              : 'bg-white/5 border-white/10 text-slate-400 hover:text-white hover:bg-white/10'
                          }`}
                        >
                          {p} Rs
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Right Column: Output, Timeline Map & Mathematical Audit */}
                <div className="space-y-6">
                  {/* Total Settlement Amount Output */}
                  <div className="bg-gradient-to-br from-purple-950/40 to-slate-900 border border-purple-500/20 rounded-2xl p-6 text-center space-y-3 relative overflow-hidden shadow-2xl shadow-purple-950/20">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Estimated Redemption Amount</span>
                    <div className="flex items-baseline justify-center gap-1">
                      <span className="text-xl font-bold text-slate-400">Rs.</span>
                      <span className="text-4xl font-black text-white tracking-tight drop-shadow-[0_0_15px_rgba(191,85,236,0.3)]">{settlement.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between border-t border-white/5 pt-4 text-xs font-bold text-slate-400">
                      <div className="text-left">
                        <span>Principal:</span>
                        <p className="font-mono text-white text-sm">Rs. {principal.toLocaleString()}</p>
                      </div>
                      <div className="text-right">
                        <span>Accrued Charges:</span>
                        <p className="font-mono text-purple-400 text-sm">Rs. {accruedCharges.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                      </div>
                    </div>
                  </div>

                  {/* Mathematical Audit */}
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-2">Real-Time Mathematical Audit</h3>
                    <div className="space-y-2 text-xs text-slate-300">
                      {/* Interest One */}
                      <div className="bg-white/5 border border-white/10 rounded-xl p-3 flex justify-between items-center">
                        <div>
                          <span className="text-slate-400">Base Interest (I₁):</span>
                          <p className="text-[10px] font-mono text-slate-500">{principal.toLocaleString()} × {(interestRate*100).toFixed(2)}%</p>
                        </div>
                        <span className="font-mono font-bold text-slate-200">Rs. {interestOne.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>

                      {/* Total Amount */}
                      <div className="bg-white/5 border border-white/10 rounded-xl p-3 flex justify-between items-center">
                        <div>
                          <span className="text-slate-400">Total Amount (T):</span>
                          <p className="text-[10px] font-mono text-slate-500">Principal + I₁</p>
                        </div>
                        <span className="font-mono font-bold text-slate-200">Rs. {totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>

                      {/* Manual Insurance */}
                      <div className="bg-white/5 border border-white/10 rounded-xl p-3 flex justify-between items-center">
                        <div>
                          <span className="text-slate-400">Manual Insurance Fee:</span>
                          <p className="text-[10px] font-mono text-slate-500">Overridden Cashier input</p>
                        </div>
                        <span className="font-mono font-bold text-slate-200">Rs. {parseFloat(redeemInsurance || '0').toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>

                      {/* Segment Accrual */}
                      <div className="bg-purple-950/20 border border-purple-500/20 rounded-xl p-3 space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-purple-300 font-bold">Segment Accrual Mode:</span>
                          <span className="font-mono font-bold text-purple-200">Rs. {settlement.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        <div className="bg-purple-500/10 border-l-2 border-purple-500 rounded p-2 text-[11px] text-purple-300 font-mono">
                          <p className="font-bold">{accrualExpr}</p>
                          <p className="text-[10px] opacity-75 mt-0.5">{accrualDesc}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Settle Action Button */}
                  <Button
                    onClick={handleRedeemSubmit}
                    disabled={isRedeeming}
                    type="button"
                    className="w-full h-14 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-black text-sm uppercase tracking-widest rounded-2xl shadow-xl transition-all"
                  >
                    {isRedeeming ? (
                      <RefreshCcw className="w-5 h-5 animate-spin mr-2" />
                    ) : (
                      <Coins className="w-5 h-5 mr-2" />
                    )}
                    Process Settlement & Post GL
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Pawn Details & Printable Receipt Dialog (Fast Isolated Sub-Component) */}
      <PawnDetailsModal
        pawn={detailsPawn}
        onClose={() => setDetailsPawn(null)}
        clientsMap={clientsMap}
        clientsNicMap={clientsNicMap}
        clientsList={clientsList}
        branchesList={branches}
        getBillNo={getBillNo}
        getClientNic={getClientNic}
        getCleanDescription={getCleanDescription}
        calculateRedemption={calculateRedemption}
      />

      {/* Pawn Redemption / Settlement Receipt Modal */}
      <RedemptionReceiptModal
        data={redemptionReceiptData}
        onClose={() => setRedemptionReceiptData(null)}
        clientsList={clientsList}
        clientsMap={clientsMap}
        branchesList={branches}
        getBillNo={getBillNo}
        getClientNic={getClientNic}
        getCleanDescription={getCleanDescription}
      />

      {/* Captured Weight Photos Viewer Modal */}
      <Dialog 
        open={viewPhotoModal.isOpen} 
        onOpenChange={(v) => setViewPhotoModal(prev => ({ ...prev, isOpen: v }))}
      >
        <DialogContent className="w-[95vw] sm:w-[90vw] lg:max-w-3xl bg-white border border-slate-200 shadow-2xl p-0 rounded-2xl sm:rounded-[2.5rem] flex flex-col overflow-hidden">
          <div className="h-2.5 bg-gradient-to-r from-amber-500 via-amber-600 to-yellow-500 shrink-0" />
          <div className="p-6 border-b border-slate-100">
            <DialogHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-amber-500/10 rounded-2xl text-amber-600">
                    <Camera className="w-6 h-6" />
                  </div>
                  <div>
                    <DialogTitle className="text-xl sm:text-2xl font-black text-slate-900">
                      Captured Weight Photos
                    </DialogTitle>
                    <DialogDescription className="text-xs font-bold text-slate-500 mt-0.5">
                      Scale proof for Bill: <span className="font-mono text-primary font-black">{viewPhotoModal.billNo}</span>
                    </DialogDescription>
                  </div>
                </div>
              </div>
            </DialogHeader>
          </div>

          <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
            {/* Scale Photos Section */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-black uppercase tracking-wider text-slate-700">⚖️ Scale Weight Proofs</span>
              </div>
              {(!viewPhotoModal.airPhoto && !viewPhotoModal.waterPhoto) ? (
                <div className="flex flex-col items-center justify-center p-6 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                  <Camera className="w-8 h-8 text-slate-300 mb-1" />
                  <p className="text-xs font-bold text-slate-600">No Scale Photos Recorded</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">There are no hydrostatic scale photos linked to this pawn ticket.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Air Weight Photo Card */}
                  <div className="bg-slate-50/80 rounded-2xl p-4 border border-slate-200 flex flex-col items-center">
                    <div className="w-full flex items-center justify-between mb-2">
                      <span className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span> Air Weight Photo
                      </span>
                      {viewPhotoModal.airWeight ? (
                        <span className="text-xs font-mono font-black text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                          {viewPhotoModal.airWeight} mg
                        </span>
                      ) : null}
                    </div>
                    <div className="w-full aspect-[4/3] bg-black/95 rounded-xl overflow-hidden shadow-inner flex items-center justify-center border border-slate-300">
                      {viewPhotoModal.airPhoto ? (
                        <img 
                          src={viewPhotoModal.airPhoto} 
                          alt="Air weight scale photo" 
                          className="w-full h-full object-contain cursor-zoom-in"
                          onClick={() => {
                            const w = window.open("");
                            w?.document.write(`<img src="${viewPhotoModal.airPhoto}" style="max-width:100%;height:auto;margin:auto;display:block;"/>`);
                          }}
                        />
                      ) : (
                        <span className="text-xs text-slate-400 font-bold">No photo taken</span>
                      )}
                    </div>
                  </div>

                  {/* Water Weight Photo Card */}
                  <div className="bg-slate-50/80 rounded-2xl p-4 border border-slate-200 flex flex-col items-center">
                    <div className="w-full flex items-center justify-between mb-2">
                      <span className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span> Water Weight Photo
                      </span>
                      {viewPhotoModal.waterWeight ? (
                        <span className="text-xs font-mono font-black text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                          {viewPhotoModal.waterWeight} mg
                        </span>
                      ) : null}
                    </div>
                    <div className="w-full aspect-[4/3] bg-black/95 rounded-xl overflow-hidden shadow-inner flex items-center justify-center border border-slate-300">
                      {viewPhotoModal.waterPhoto ? (
                        <img 
                          src={viewPhotoModal.waterPhoto} 
                          alt="Water weight scale photo" 
                          className="w-full h-full object-contain cursor-zoom-in"
                          onClick={() => {
                            const w = window.open("");
                            w?.document.write(`<img src="${viewPhotoModal.waterPhoto}" style="max-width:100%;height:auto;margin:auto;display:block;"/>`);
                          }}
                        />
                      ) : (
                        <span className="text-xs text-slate-400 font-bold">No photo taken</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Customer Identity & KYC Photos Section */}
            {(viewPhotoModal.kycFront || viewPhotoModal.kycBack || viewPhotoModal.kycSignature) && (
              <div className="pt-4 border-t border-slate-200">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-700">🪪 Customer Identity & KYC Scans</span>
                  {viewPhotoModal.customerName && (
                    <span className="text-xs font-bold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-lg">
                      {viewPhotoModal.customerName}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {viewPhotoModal.kycFront ? (
                    <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-200 text-center">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-600 block mb-1.5">NIC Front</span>
                      <img 
                        src={viewPhotoModal.kycFront} 
                        alt="NIC Front" 
                        className="w-full h-28 object-cover rounded-lg border border-slate-300 shadow-sm cursor-zoom-in hover:opacity-90 transition-opacity"
                        onClick={() => {
                          const w = window.open("");
                          w?.document.write(`<img src="${viewPhotoModal.kycFront}" style="max-width:100%;height:auto;margin:auto;display:block;"/>`);
                        }}
                      />
                    </div>
                  ) : null}
                  {viewPhotoModal.kycBack ? (
                    <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-200 text-center">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-600 block mb-1.5">NIC Back</span>
                      <img 
                        src={viewPhotoModal.kycBack} 
                        alt="NIC Back" 
                        className="w-full h-28 object-cover rounded-lg border border-slate-300 shadow-sm cursor-zoom-in hover:opacity-90 transition-opacity"
                        onClick={() => {
                          const w = window.open("");
                          w?.document.write(`<img src="${viewPhotoModal.kycBack}" style="max-width:100%;height:auto;margin:auto;display:block;"/>`);
                        }}
                      />
                    </div>
                  ) : null}
                  {viewPhotoModal.kycSignature ? (
                    <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-200 text-center">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-600 block mb-1.5">Customer Signature</span>
                      <img 
                        src={viewPhotoModal.kycSignature} 
                        alt="Customer Signature" 
                        className="w-full h-28 object-contain bg-white rounded-lg border border-slate-300 shadow-sm cursor-zoom-in hover:opacity-90 transition-opacity"
                        onClick={() => {
                          const w = window.open("");
                          w?.document.write(`<img src="${viewPhotoModal.kycSignature}" style="max-width:100%;height:auto;margin:auto;display:block;"/>`);
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
          <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
            <Button 
              type="button" 
              onClick={() => setViewPhotoModal(prev => ({ ...prev, isOpen: false }))}
              className="bg-slate-900 hover:bg-slate-800 text-white font-bold px-6 rounded-xl"
            >
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    {/* Maker-Checker Change Request Modal */}
    <ChangeRequestModal
      isOpen={changeRequestTarget.isOpen}
      onClose={() => setChangeRequestTarget(prev => ({ ...prev, isOpen: false }))}
      entityType="PAWN"
      actionType={changeRequestTarget.actionType}
      entityId={changeRequestTarget.pawn?.id || ''}
      referenceNo={changeRequestTarget.pawn?.bill_no || changeRequestTarget.pawn?.pawn_ticket_no || changeRequestTarget.pawn?.id?.substring(0, 8) || 'PAWN'}
      branchId={changeRequestTarget.pawn?.branch_id || branchId || 'HQ'}
      currentData={changeRequestTarget.pawn || {}}
      initialProposedData={changeRequestTarget.proposedData}
      onSubmitted={() => {
        loadPawns();
      }}
    />
    </div>
  );
}

const BRANCH_ADDRESSES: Record<string, string> = {
  HQ: 'Head Office, No. 3/B/1, Station Road, Dehiwala.',
  DHW: 'No. 3/B/1, Station Road, Dehiwala.',
  DEHIWALA: 'No. 3/B/1, Station Road, Dehiwala.',
  BRL: 'Borella Branch, Colombo 08.',
  BORELLA: 'Borella Branch, Colombo 08.',
  KOT: 'Kotikawatta Branch, Angoda.',
  KOTIKAWATTA: 'Kotikawatta Branch, Angoda.',
  DMT: 'Dematagoda Branch, Colombo 09.',
  DEMATAGODA: 'Dematagoda Branch, Colombo 09.',
  W2: 'Wattala Branch No. 2, Negombo Road, Wattala.',
  W3: 'Wattala Branch No. 3, Negombo Road, Wattala.',
  W4: 'Wattala Branch No. 4, Negombo Road, Wattala.',
  WATTALA: 'Negombo Road, Wattala.',
  KIR: 'Kiribathgoda Branch, Kandy Road, Kiribathgoda.',
  KIRIBATHGODA: 'Kiribathgoda Branch, Kandy Road, Kiribathgoda.',
  KDW: 'Kadawatha Branch, Kandy Road, Kadawatha.',
  KADAWATHA: 'Kadawatha Branch, Kandy Road, Kadawatha.',
  PND: 'Panadura Branch, Galle Road, Panadura.',
  PANADURA: 'Panadura Branch, Galle Road, Panadura.',
  KTW: 'Kottawa Branch, High Level Road, Kottawa.',
  KOTTAWA: 'Kottawa Branch, High Level Road, Kottawa.',
  HMG: 'Homagama Branch, High Level Road, Homagama.',
  HOMAGAMA: 'Homagama Branch, High Level Road, Homagama.',
  KHT: 'Kahathuduwa Branch, Main Street, Kahathuduwa.',
  KAHATHUDUWA: 'Kahathuduwa Branch, Main Street, Kahathuduwa.',
  TEST: 'Test Branch Office, Colombo.',
  TESTBRANCH: 'Test Branch Office, Colombo.',
};

const getBranchAddress = (pawn: any, branchesList?: any[]): string => {
  if (!pawn) return 'No. 3/B/1, Station Road, Dehiwala.';

  if (pawn.branch_address) return pawn.branch_address;
  if (pawn.branchAddress) return pawn.branchAddress;

  const bId = String(pawn.branch_id || pawn.branchId || '').toUpperCase().trim();
  if (bId && BRANCH_ADDRESSES[bId]) return BRANCH_ADDRESSES[bId];

  const bName = String(pawn.branch_name || pawn.branchName || pawn.branch || '').toUpperCase().trim();
  if (bName && BRANCH_ADDRESSES[bName]) return BRANCH_ADDRESSES[bName];

  if (branchesList && branchesList.length > 0) {
    const matchedBranch = branchesList.find((b: any) =>
      String(b.id || '').toUpperCase() === bId ||
      String(b.name || '').toUpperCase() === bName
    );
    if (matchedBranch?.address) return matchedBranch.address;
    if (matchedBranch?.name) return `${matchedBranch.name} Branch.`;
  }

  if (pawn.branch_name || pawn.branch) {
    return `${pawn.branch_name || pawn.branch} Branch.`;
  }

  return 'No. 3/B/1, Station Road, Dehiwala.';
};

// Ultra-Fast Isolated Sub-Component for Pawn Details & Interactive Bill Receipt (100% Editable Fields)
function PawnDetailsModal({
  pawn,
  onClose,
  clientsMap,
  clientsNicMap,
  clientsList,
  branchesList,
  getBillNo,
  getClientNic,
  getCleanDescription,
  calculateRedemption
}: {
  pawn: any;
  onClose: () => void;
  clientsMap: Record<string, string>;
  clientsNicMap: Record<string, string>;
  clientsList: any[];
  branchesList?: any[];
  getBillNo: (p: any) => string;
  getClientNic: (p: any) => string;
  getCleanDescription: (p: any) => string;
  calculateRedemption: (p: number, d: number, ins: string) => any;
}) {
  // Inline Editable States directly inside the Bill
  const [billNo, setBillNo]               = useState<string>('');
  const [billMonths, setBillMonths]       = useState<string>('3');
  const [billDate, setBillDate]           = useState<string>('');
  const [billBranchAddress, setBillBranchAddress] = useState<string>('');
  const [billName, setBillName]           = useState<string>('');
  const [billAddress, setBillAddress]     = useState<string>('');
  const [billNic, setBillNic]             = useState<string>('');
  const [billPhone, setBillPhone]         = useState<string>('');
  const [billAmount, setBillAmount]       = useState<string>('0');
  const [billDesc, setBillDesc]           = useState<string>('');
  const [billAppraised, setBillAppraised] = useState<string>('0');
  const [billWeight, setBillWeight]       = useState<string>('');
  const [billLastDate, setBillLastDate]   = useState<string>('');

  const resolveClientDetails = (p: any) => {
    if (!p) return { name: '', address: '', nic: '', phone: '' };

    const pawnCidStr = String(p.client_id || '').toLowerCase().trim();

    const clientObj = clientsList?.find((c: any) => {
      const cId  = String(c.id || '').toLowerCase().trim();
      const cNic = String(c.nationalId || c.national_id || c.nic || '').toLowerCase().trim();
      const cNum = String(c.clientNumber || c.client_number || '').toLowerCase().trim();
      return (cId && cId === pawnCidStr) || (cNic && cNic === pawnCidStr) || (cNum && cNum === pawnCidStr);
    });

    const cObjName = clientObj
      ? (`${clientObj.firstName || clientObj.first_name || ''} ${clientObj.lastName || clientObj.last_name || ''}`.trim() || clientObj.name || clientObj.full_name || clientObj.customer_name)
      : '';

    const pName = p.client_name || p.customer_name || p.customerName || p.clientName ||
      (p.clients ? (`${p.clients.firstName || p.clients.first_name || ''} ${p.clients.lastName || p.clients.last_name || ''}`.trim() || p.clients.name || p.clients.full_name) : '') ||
      (p.client ? (`${p.client.firstName || p.client.first_name || ''} ${p.client.lastName || p.client.last_name || ''}`.trim() || p.client.name || p.client.full_name) : '');

    const name = pName || (pawnCidStr && clientsMap[pawnCidStr]) || cObjName || '';

    const address = p.client_address || p.address || clientObj?.address || clientObj?.address_line1 || p.clients?.address || p.client?.address || '';

    const rawNic = p.client_nic || p.nic || p.national_id || p.client?.nationalId || p.client?.national_id || p.clients?.nationalId || p.clients?.national_id || clientObj?.nationalId || clientObj?.national_id || getClientNic(p);
    const nic = (rawNic && rawNic !== '—' && rawNic !== 'undefined') ? rawNic : '';

    const phone = p.client_phone || p.phone || clientObj?.phone || clientObj?.mobile || p.clients?.phone || p.client?.phone || '';

    return { name, address, nic, phone };
  };


  useEffect(() => {
    if (pawn) {
      const bNo = getBillNo(pawn);
      const createdDate = pawn.created_at ? new Date(pawn.created_at) : new Date();
      const formattedDate = createdDate.toLocaleDateString('en-GB');

      const pawnTenorMonths = parseInt(pawn.period_months, 10) || 3;
      const lastD = new Date(createdDate);
      lastD.setMonth(lastD.getMonth() + pawnTenorMonths);
      const formattedLastDate = lastD.toLocaleDateString('en-GB');

      const cDetails = resolveClientDetails(pawn);
      const bAddress = getBranchAddress(pawn, branchesList);
      const computedWeight = pawn.weight_grams || pawn.weight || (Array.isArray(pawn.pawn_items) && pawn.pawn_items.length > 0 ? pawn.pawn_items.reduce((s: number, i: any) => s + (Number(i.weight_grams) || 0), 0) : '0.0');

      let wVal = parseFloat(pawn.weight || 0);
      if (wVal <= 0 && Array.isArray(pawn.items) && pawn.items.length > 0) {
        wVal = pawn.items.reduce((s: number, it: any) => s + (parseFloat(it.weight_grams) || 0) + ((parseFloat(it.weight_mg) || 0) / 1000), 0);
      }

      let formattedWeightStr = '';
      if (wVal > 0) {
        const g = Math.floor(wVal);
        const mg = Math.round((wVal - g) * 1000);
        formattedWeightStr = `${pawn.weight_mg || (g * 1000 + mg)} mg`;
      } else if (pawn.weight_grams !== undefined) {
        const g = Math.floor(pawn.weight_grams);
        const mg = Math.round((parseFloat(pawn.weight_mg) || 0));
        formattedWeightStr = `${pawn.weight_mg || (g * 1000 + mg)} mg`;
      }

      setBillNo(bNo);
      setBillMonths(String(pawnTenorMonths));
      setBillDate(formattedDate);
      setBillBranchAddress(bAddress);
      setBillName(cDetails.name);
      setBillAddress(cDetails.address);
      setBillNic(cDetails.nic);
      setBillPhone(cDetails.phone);
      setBillAmount(String(pawn.disbursed_amount || 0));
      setBillDesc(getCleanDescription(pawn));
      setBillAppraised(String(pawn.appraised_value || 0));
      setBillWeight(formattedWeightStr || String(computedWeight));
      setBillLastDate(formattedLastDate);
    }
  }, [pawn]);


  // Bluetooth printing hooks — must be declared before any early return
  const receipt80mmRef = useRef<HTMLDivElement>(null);
  const [isBluetoothPrinting, setIsBluetoothPrinting] = useState(false);

  if (!pawn) return null;

  const resetDefaults = () => {
    if (pawn) {
      const bNo = getBillNo(pawn);
      const createdDate = pawn.created_at ? new Date(pawn.created_at) : new Date();
      const formattedDate = createdDate.toLocaleDateString('en-GB');

      const pTenor = parseInt(pawn.period_months, 10) || 3;
      const lastD = new Date(createdDate);
      lastD.setMonth(lastD.getMonth() + pTenor);
      const formattedLastDate = lastD.toLocaleDateString('en-GB');

      const cDetails = resolveClientDetails(pawn);
      const bAddress = getBranchAddress(pawn, branchesList);

      let wVal = parseFloat(pawn.weight || 0);
      if (wVal <= 0 && Array.isArray(pawn.items) && pawn.items.length > 0) {
        wVal = pawn.items.reduce((s: number, it: any) => s + (parseFloat(it.weight_grams) || 0) + ((parseFloat(it.weight_mg) || 0) / 1000), 0);
      }
      let formattedWeightStr = '';
      if (wVal > 0) {
        const g = Math.floor(wVal);
        const mg = Math.round((wVal - g) * 1000);
        formattedWeightStr = `${pawn.weight_mg || (g * 1000 + mg)} mg`;
      } else if (pawn.weight_grams !== undefined) {
        const g = Math.floor(pawn.weight_grams);
        const mg = Math.round((parseFloat(pawn.weight_mg) || 0));
        formattedWeightStr = `${pawn.weight_mg || (g * 1000 + mg)} mg`;
      }

      setBillNo(bNo);
      setBillMonths(String(pTenor));
      setBillDate(formattedDate);
      setBillBranchAddress(bAddress);
      setBillName(cDetails.name);
      setBillAddress(cDetails.address);
      setBillNic(cDetails.nic);
      setBillPhone(cDetails.phone);
      setBillAmount(String(pawn.disbursed_amount || 0));
      setBillDesc(getCleanDescription(pawn));
      setBillAppraised(String(pawn.appraised_value || 0));
      setBillWeight(formattedWeightStr || String(pawn.weight || ''));
      setBillLastDate(formattedLastDate);
    }
  };

  // Build the ESC/POS text receipt and send via Bluetooth — no html2canvas needed
  const handleBluetoothPrint = async () => {
    setIsBluetoothPrinting(true);
    const toastId = toast.loading('Connecting to Bluetooth Printer...');

    try {
      const transport = new WebBluetoothTransport();
      const connected = await transport.connect();
      if (!connected) throw new Error('Could not connect to printer.');

      toast.loading('Sending receipt to printer...', { id: toastId });

      const adapter = new EscPosAdapter();
      const sep  = '----------------------------------------';
      const dsep = '- - - - - - - - - - - - - - - - - - - -';
      const fmt  = (n: number) => n.toLocaleString();
      const amt  = parseFloat(billAmount || '0');
      const cleanSinhala = (str: string) => (str || '').replace(/[\u0D80-\u0DFF]+/g, '').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim();

      const lines: Uint8Array[] = [
        adapter.init(),
        // ── HEADER (centered) ──
        adapter.align(1),
        adapter.text('RUPASINGHE TRUST\n', true, true, true),
        adapter.text('INVESTMENTS LTD.\n', true, false, true),
        adapter.text('(PREV. L.S. RUPASINGHE PAWN BROKERS)\n'),
        adapter.text(`${billBranchAddress || 'Head Office, Dehiwala.'}\n`),
        adapter.text('Tel: 011 7006588\n'),
        adapter.text(`${sep}\n`),
        adapter.text('** PAWN BILL **\n', true),
        adapter.text(`${sep}\n`),
        // ── BODY (left aligned) ──
        adapter.align(0),
        adapter.text(`R No: ${billNo}\n`, true),
        adapter.text(`Date: ${billDate}\n`),
        adapter.text(`Months: ${billMonths}\n`),
        adapter.text(`${sep}\n`),
        adapter.text(`I the undersigned: ${cleanSinhala(billName)}\n`),
        adapter.text(`of: ${cleanSinhala(billAddress)}\n`),
        adapter.text(`NIC: ${billNic}\n`),
        adapter.text(`Phone: ${billPhone}\n`),
        adapter.text('being the lawful owner of the articles\n'),
        adapter.text('mentioned below has sold out right for\n'),
        // ── AMOUNT (centered) ──
        adapter.align(1),
        adapter.text(`${sep}\n`),
        adapter.text(`Rs. ${fmt(amt)}\n`, true, false, true),
        adapter.text(`${sep}\n`),
        // ── ARTICLES (left) ──
        adapter.align(0),
        adapter.text('ARTICLES DESCRIPTION:\n', true),
        adapter.text(`${cleanSinhala(billDesc)}\n`, true),
        adapter.text(`Appraised: Rs. ${billAppraised}\n`),
        adapter.text(`Total Weight: ${billWeight}\n`),
        adapter.text(`${sep}\n`),
        // ── TERMS ──
        adapter.text('I hold responsible and liable for any\n'),
        adapter.text('claims arising on sale of the articles.\n'),
        adapter.text('I have read, understood, and agreed to these terms.\n'),
        adapter.text(`${sep}\n`),
        adapter.text(`Last Date: ${billLastDate}\n`, true),
        adapter.text(`Name: ${cleanSinhala(billName)}\n`),
        adapter.feed(3),
        // ── STUB ──
        adapter.text(`${sep}\n`),
        adapter.text(`R No: ${billNo}    ........ Signature\n`),
        adapter.feed(4),
        adapter.cut(),
      ];


      const payload = EscPosAdapter.concat(lines);
      await transport.write(payload);

      toast.success('Pawn Bill Printed via Bluetooth!', { id: toastId });
      setTimeout(() => transport.disconnect(), 1000);

    } catch (err: any) {
      if (err.name === 'NotFoundError' || err.message?.includes('cancel')) {
        toast.error('Bluetooth connection cancelled.', { id: toastId });
      } else {
        toast.error('Bluetooth Print Failed', { description: err.message, id: toastId });
      }
    } finally {
      setIsBluetoothPrinting(false);
    }
  };

  // Standard Web / Desktop Print Handler for Pawn Bill
  const handleStandardPrint = () => {
    const printWindow = window.open('', '_blank', 'width=750,height=900');
    if (!printWindow) {
      toast.error('Popup blocked. Please allow popups to print.');
      return;
    }
    const receiptElement = document.getElementById('printable-pawn-receipt');
    if (!receiptElement) {
      toast.error('Printable content not found.');
      return;
    }

    // Clone element and replace any input values with static text for clean printing
    const clone = receiptElement.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input').forEach((input) => {
      const span = document.createElement('span');
      span.textContent = input.value;
      span.className = input.className;
      span.style.borderBottom = '1px solid #000';
      span.style.padding = '0 4px';
      input.parentNode?.replaceChild(span, input);
    });

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8"/>
        <title>Pawn Agreement Bill - ${billNo}</title>
        <style>
          @media print {
            @page { size: auto; margin: 8mm; }
            body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; background: white !important; margin: 0; padding: 0; }
          }
          body { font-family: 'Times New Roman', Times, serif; font-size: 12px; margin: 0 auto; max-width: 650px; padding: 15px; background: white; color: #000; }
          .center { text-align: center; }
          .bold { font-weight: bold; }
        </style>
      </head>
      <body>
        ${clone.outerHTML}
        <script>
          setTimeout(() => { window.print(); window.close(); }, 500);
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  };


  return (
    <Dialog open={!!pawn} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-4xl max-w-4xl w-[95vw] max-h-[94vh] border border-slate-700 shadow-2xl rounded-3xl p-5 bg-slate-950 text-slate-100 flex flex-col overflow-y-auto">
        {/* Modal Header */}
        <DialogHeader className="border-b border-slate-800 pb-3 shrink-0">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-blue-400">
              <FileText className="w-5 h-5" />
              <DialogTitle className="text-xl font-black tracking-tight text-white">
                Pawn Bill Generator & Interactive Editor
              </DialogTitle>
            </div>
            <div className="flex items-center gap-3">
              <Button
                onClick={resetDefaults}
                type="button"
                variant="outline"
                className="border-slate-700 text-slate-300 hover:bg-slate-800 text-xs font-bold px-3 py-1.5 rounded-xl"
              >
                Reset Defaults
              </Button>
              <Button
                onClick={handleStandardPrint}
                type="button"
                className="bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white font-bold text-xs uppercase tracking-wider px-4 py-2 rounded-xl flex items-center gap-1.5"
              >
                <Printer className="w-4 h-4" />
                Web Print
              </Button>
              <Button
                onClick={handleBluetoothPrint}
                disabled={isBluetoothPrinting}
                type="button"
                className="bg-blue-600 hover:bg-blue-500 text-white font-black text-xs uppercase tracking-widest px-4 py-2 rounded-xl flex items-center gap-2 shadow-lg"
              >
                <Bluetooth className="w-4 h-4" />
                {isBluetoothPrinting ? 'PRINTING...' : 'BLUETOOTH PRINT (80mm)'}
              </Button>
            </div>
          </div>
        </DialogHeader>


        {/* Interactive Bill Editor Container */}
        <div className="py-4 flex justify-center bg-slate-900/80 rounded-2xl border border-slate-800 my-2">
          <div className="bg-white text-slate-900 p-6 md:p-8 rounded-2xl shadow-2xl max-w-2xl w-full border border-slate-300 text-xs font-serif leading-relaxed" id="printable-pawn-receipt">
            
            {/* Header */}
            <div className="text-center border-b-2 border-slate-900 pb-3 mb-4">
              <h2 className="text-2xl font-black tracking-tight uppercase text-blue-900 font-sans">RUPASINGHE TRUST INVESTMENTS LTD.</h2>
              <p className="text-xs font-bold tracking-wide italic text-slate-700 font-sans">(PREVIOUSLY L. S. RUPASINGHE PAWN BROKERS)</p>
              <div className="flex justify-between items-center text-xs font-sans font-bold text-slate-800 mt-2 px-1">
                <span>Phone: 011 7006588</span>
                <input
                  type="text"
                  value={billBranchAddress}
                  onChange={(e) => setBillBranchAddress(e.target.value)}
                  className="border-b-2 border-blue-600 bg-blue-50/80 focus:bg-blue-100 text-blue-900 text-right font-sans font-bold px-2 py-0.5 rounded outline-none text-xs transition-all w-72"
                  placeholder="Branch Address"
                />
              </div>
            </div>

            {/* Top Row: Months & Date */}
            <div className="flex justify-between items-center text-xs mb-3 font-sans font-bold">
              <div className="flex items-center gap-1">
                <span>මාස / Months &#125;</span>
                <input
                  type="text"
                  value={billMonths}
                  onChange={(e) => {
                    const mVal = e.target.value;
                    setBillMonths(mVal);
                    const parsedM = parseInt(mVal, 10);
                    if (!isNaN(parsedM) && parsedM > 0 && billDate) {
                      const parts = billDate.split('/');
                      if (parts.length === 3) {
                        const d = parseInt(parts[0], 10);
                        const m = parseInt(parts[1], 10) - 1;
                        const y = parseInt(parts[2], 10);
                        const dt = new Date(y, m, d);
                        dt.setMonth(dt.getMonth() + parsedM);
                        setBillLastDate(dt.toLocaleDateString('en-GB'));
                      }
                    }
                  }}
                  className="w-16 border-b-2 border-blue-600 bg-blue-50/80 focus:bg-blue-100 text-blue-900 text-center font-mono font-bold px-1 py-0.5 rounded outline-none text-sm transition-all"
                  placeholder="3"
                />
              </div>
              <div className="flex items-center gap-1">
                <span>Date:</span>
                <input
                  type="text"
                  value={billDate}
                  onChange={(e) => {
                    const dVal = e.target.value;
                    setBillDate(dVal);
                    const parsedM = parseInt(billMonths, 10) || 3;
                    const parts = dVal.split('/');
                    if (parts.length === 3) {
                      const d = parseInt(parts[0], 10);
                      const m = parseInt(parts[1], 10) - 1;
                      const y = parseInt(parts[2], 10);
                      if (!isNaN(d) && !isNaN(m) && !isNaN(y)) {
                        const dt = new Date(y, m, d);
                        dt.setMonth(dt.getMonth() + parsedM);
                        setBillLastDate(dt.toLocaleDateString('en-GB'));
                      }
                    }
                  }}
                  className="w-32 border-b-2 border-blue-600 bg-blue-50/80 focus:bg-blue-100 text-blue-900 text-center font-mono font-bold px-1 py-0.5 rounded outline-none text-xs transition-all"
                  placeholder="12/08/2026"
                />
              </div>
            </div>

            {/* Customer Declaration */}
            <div className="space-y-2 text-xs mb-4 leading-relaxed font-sans">
              <div className="flex flex-wrap items-center gap-1">
                <span>I the undersigned</span>
                <input
                  type="text"
                  value={billName}
                  onChange={(e) => setBillName(e.target.value)}
                  className="flex-1 min-w-[200px] border-b-2 border-blue-600 bg-blue-50/80 focus:bg-blue-100 text-blue-900 font-bold px-2 py-0.5 rounded outline-none text-xs transition-all"
                  placeholder="Customer Name"
                />
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <span>of</span>
                <input
                  type="text"
                  value={billAddress}
                  onChange={(e) => setBillAddress(e.target.value)}
                  className="flex-1 min-w-[250px] border-b-2 border-blue-600 bg-blue-50/80 focus:bg-blue-100 text-slate-900 font-medium px-2 py-0.5 rounded outline-none text-xs transition-all"
                  placeholder="Address"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                <div className="flex items-center gap-1">
                  <span className="shrink-0">N.I.C. No.</span>
                  <input
                    type="text"
                    value={billNic}
                    onChange={(e) => setBillNic(e.target.value)}
                    className="w-full border-b-2 border-blue-600 bg-blue-50/80 focus:bg-blue-100 text-blue-900 font-mono font-bold px-2 py-0.5 rounded outline-none text-xs transition-all"
                    placeholder="NIC Number"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="shrink-0">Phone No.</span>
                  <input
                    type="text"
                    value={billPhone}
                    onChange={(e) => setBillPhone(e.target.value)}
                    className="w-full border-b-2 border-blue-600 bg-blue-50/80 focus:bg-blue-100 text-slate-900 font-mono font-medium px-2 py-0.5 rounded outline-none text-xs transition-all"
                    placeholder="Phone Number"
                  />
                </div>
              </div>
              <div className="pt-1">
                being the lawful owner of the articles mentioned below has sold out right for
              </div>
              <div className="flex items-center gap-1 font-bold">
                <span>Rs.</span>
                <input
                  type="number"
                  value={billAmount}
                  onChange={(e) => setBillAmount(e.target.value)}
                  className="w-44 border-b-2 border-emerald-600 bg-emerald-50/80 focus:bg-emerald-100 text-emerald-900 font-mono font-black text-sm px-2 py-0.5 rounded outline-none transition-all"
                  placeholder="Loan Capital Amount"
                />
              </div>
            </div>

            {/* Collateral Articles Table & Weight */}
            <div className="border-2 border-slate-300 rounded-xl p-3 mb-4 bg-slate-50/80 font-sans text-xs">
              <div className="font-bold text-xs text-slate-600 uppercase tracking-wider mb-1">Articles Description:</div>
              <textarea
                rows={2}
                value={billDesc}
                onChange={(e) => setBillDesc(e.target.value)}
                className="w-full border-2 border-blue-500/40 bg-white text-slate-900 font-bold p-2 rounded-lg outline-none text-xs focus:border-blue-600 transition-all resize-none mb-2"
                placeholder="Collateral Item Description"
              />
              <div className="grid grid-cols-2 gap-4 border-t border-slate-300 pt-2 text-xs font-semibold">
                <div className="flex items-center gap-1">
                  <span className="shrink-0">Appraised Valuation: Rs.</span>
                  <input
                    type="number"
                    value={billAppraised}
                    onChange={(e) => setBillAppraised(e.target.value)}
                    className="w-full border-b-2 border-amber-600 bg-amber-50/80 text-amber-900 font-mono font-bold px-2 py-0.5 rounded outline-none text-xs"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="shrink-0">Total Weight:</span>
                  <input
                    type="text"
                    value={billWeight}
                    onChange={(e) => setBillWeight(e.target.value)}
                    className="w-20 border-b-2 border-blue-600 bg-blue-50/80 text-slate-900 font-mono font-bold text-center px-1 py-0.5 rounded outline-none text-xs"
                  />
                  <span>g</span>
                </div>
              </div>
            </div>

            {/* Sinhala & Legal Terms */}
            <div className="text-[10px] text-slate-800 space-y-1 mb-4 leading-normal font-sans bg-slate-100 p-2 rounded-lg border border-slate-200">
              <p>I hold responsible and liable or any claims that may arise on the sale of the articles.</p>
              <p className="font-bold text-slate-900">මෙය මට කියවා තේරුම් කරදුන් පසු අත්සන් කළෙමි.</p>
              <p className="text-[9.5px]">රසිට්පතේ යට සඳහන් අවසාන දිනට ප්‍රථම නිදහස් කිරීම හෝ පොළී මුදල් ගෙවීම කළයුතුයි. එසේ නොවුනහොත් එදිනට පසු බඩු විකුණනු ලැබේ.</p>
            </div>

            {/* Amount Box, Last Date, Signature & Stamp Box */}
            <div className="grid grid-cols-12 gap-3 items-end mb-4 border-t-2 border-b-2 border-slate-300 py-3 font-sans">
              {/* Left: Boxed Amount & Last Date */}
              <div className="col-span-7 space-y-2">
                <div className="border-2 border-slate-900 rounded-xl p-2 text-center bg-slate-50 shadow-inner">
                  <span className="text-xs font-bold text-slate-600 block">Rs.</span>
                  <span className="text-2xl font-black text-slate-900 font-mono tracking-tight">
                    Rs. {parseFloat(billAmount || '0').toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-xs font-bold">
                  <span className="shrink-0">අවසාන දිනය / Last Date &#125;</span>
                  <input
                    type="text"
                    value={billLastDate}
                    onChange={(e) => setBillLastDate(e.target.value)}
                    className="w-32 border-b-2 border-blue-600 bg-blue-50/80 text-slate-900 font-mono font-bold text-center px-1 py-0.5 rounded outline-none text-xs"
                  />
                </div>
                <div className="text-xs">
                  <span>ගනුදෙනු බාරගත් අයගේ අත්සන: </span>
                  <span className="border-b border-slate-800 font-semibold px-2">............................</span>
                </div>
                <div className="text-xs">
                  <span>නම: </span>
                  <span className="border-b border-slate-800 font-bold text-slate-900 px-2">{billName}</span>
                </div>
              </div>

              {/* Right: STAMP Box & Bill Number */}
              <div className="col-span-5 flex flex-col items-center justify-end text-center space-y-2">
                <div className="w-24 h-24 border-2 border-dashed border-slate-800 rounded-xl flex items-center justify-center text-xs font-black text-slate-400 bg-slate-50">
                  STAMP
                </div>
                <div className="flex items-center justify-center gap-1 text-sm font-black text-slate-900 font-mono">
                  <span>R No.</span>
                  <input
                    type="text"
                    value={billNo}
                    onChange={(e) => setBillNo(e.target.value)}
                    className="w-28 border-b-2 border-blue-800 bg-blue-50/80 text-blue-900 font-mono font-black text-center px-1 py-0.5 rounded outline-none text-sm"
                  />
                </div>
              </div>
            </div>

            {/* Perforated Stub Line */}
            <div className="border-t-2 border-dashed border-slate-400 pt-3 flex justify-between items-center text-xs font-mono font-bold font-sans">
              <div className="flex items-center gap-1">
                <span>R No.</span>
                <span className="text-blue-900 font-black">{billNo}</span>
              </div>
              <div className="text-xs font-normal text-slate-600 font-sans">......................................... Signature</div>
            </div>

          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Sub-Component: Official Pawn Redemption / Settlement Receipt Modal (Interactive 80mm Editable & Bluetooth POS Print)
function RedemptionReceiptModal({
  data,
  onClose,
  clientsList,
  clientsMap,
  branchesList,
  getBillNo,
  getClientNic,
  getCleanDescription
}: {
  data: any;
  onClose: () => void;
  clientsList?: any[];
  clientsMap?: Record<string, string>;
  branchesList?: any[];
  getBillNo: (p: any) => string;
  getClientNic: (p: any) => string;
  getCleanDescription: (p: any) => string;
}) {
  // Pre-compute initial values from props
  const resolvedData = data ? (() => {
    const { pawn, journalEntryId, days, insurance, principal, interest, settlement, redeemedAt } = data;
    const billNo = pawn ? getBillNo(pawn) : 'RED-001';
    const pCidStr = String(pawn?.client_id || '').toLowerCase().trim();
    const clientObj = clientsList?.find((c: any) => {
      const cId  = String(c.id || '').toLowerCase().trim();
      const cNic = String(c.nationalId || c.national_id || c.nic || '').toLowerCase().trim();
      return (cId && cId === pCidStr) || (cNic && cNic === pCidStr);
    });
    const cName = pawn?.client_name || pawn?.customerName || (pCidStr && clientsMap?.[pCidStr]) || (clientObj ? `${clientObj.firstName || ''} ${clientObj.lastName || ''}`.trim() : '') || 'S. A. Perera';
    const cAddress = pawn?.client_address || clientObj?.address || 'Station Road, Dehiwala';
    const cNic = pawn?.client_nic || clientObj?.nationalId || getClientNic(pawn) || '200125102002';
    const cPhone = pawn?.client_phone || clientObj?.phone || '077 0000000';
    const bAddress = getBranchAddress(pawn, branchesList) || 'No. 3/B/1, Station Road, Dehiwala. Tel: 011 7006588';
    
    // Weight calculation
    let weightStr = String(pawn?.weight || '0.00');
    if (pawn?.weight_grams !== undefined && pawn?.weight_grams !== null) {
      const g = Math.floor(pawn.weight_grams);
      const mg = Math.round((parseFloat(pawn.weight_mg) || 0));
      weightStr = `${pawn?.weight_mg || (g * 1000 + mg)} mg`;
    }

    return { 
      pawn, journalEntryId, days, insurance, principal, interest, settlement, redeemedAt, 
      billNo, cName, cAddress, cNic, cPhone, bAddress, weightStr 
    };
  })() : null;

  // Editable Form State
  const [companyTitle, setCompanyTitle] = useState('RUPASINGHE TRUST INVESTMENTS LTD.');
  const [branchAddress, setBranchAddress] = useState('');
  const [billNo, setBillNoState] = useState('');
  const [redemptionDate, setRedemptionDate] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [nic, setNic] = useState('');
  const [phone, setPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [description, setDescription] = useState('');
  const [appraisedValuation, setAppraisedValuation] = useState('');
  const [weight, setWeight] = useState('');
  const [principal, setPrincipal] = useState('');
  const [days, setDays] = useState('');
  const [interest, setInterest] = useState('');
  const [insurance, setInsurance] = useState('');
  const [settlement, setSettlement] = useState('');

  const [isBluetoothPrinting, setIsBluetoothPrinting] = useState(false);

  // Sync state when data prop changes
  useEffect(() => {
    if (resolvedData) {
      setCompanyTitle('RUPASINGHE TRUST INVESTMENTS LTD.');
      setBranchAddress(resolvedData.bAddress || 'No. 3/B/1, Station Road, Dehiwala. Tel: 011 7006588');
      setBillNoState(resolvedData.billNo || '12R 0001');
      setRedemptionDate(resolvedData.redeemedAt || new Date().toISOString().substring(0, 10));
      setCustomerName(resolvedData.cName || '');
      setNic(resolvedData.cNic || '');
      setPhone(resolvedData.cPhone || '');
      setCustomerAddress(resolvedData.cAddress || '');
      setDescription(getCleanDescription(resolvedData.pawn) || 'Gold Collateral');
      setAppraisedValuation(String(resolvedData.pawn?.appraised_value || 0));
      setWeight(resolvedData.weightStr || '0.00');
      setPrincipal(String(resolvedData.principal || 0));
      setDays(String(resolvedData.days || 0));
      setInterest(String(resolvedData.interest || 0));
      setInsurance(String(resolvedData.insurance || 0));
      setSettlement(String(resolvedData.settlement || 0));
    }
  }, [data]);

  if (!data) return null;

  const handleRecalcSettlement = (pVal: string, iVal: string, insVal: string) => {
    const p = parseFloat(pVal) || 0;
    const i = parseFloat(iVal) || 0;
    const ins = parseFloat(insVal) || 0;
    setSettlement(String(p + i + ins));
  };

  const resetFormDefaults = () => {
    if (resolvedData) {
      setCompanyTitle('RUPASINGHE TRUST INVESTMENTS LTD.');
      setBranchAddress(resolvedData.bAddress || 'No. 3/B/1, Station Road, Dehiwala. Tel: 011 7006588');
      setBillNoState(resolvedData.billNo || '12R 0001');
      setRedemptionDate(resolvedData.redeemedAt || new Date().toISOString().substring(0, 10));
      setCustomerName(resolvedData.cName || '');
      setNic(resolvedData.cNic || '');
      setPhone(resolvedData.cPhone || '');
      setCustomerAddress(resolvedData.cAddress || '');
      setDescription(getCleanDescription(resolvedData.pawn) || 'Gold Collateral');
      setAppraisedValuation(String(resolvedData.pawn?.appraised_value || 0));
      setWeight(resolvedData.weightStr || '0.00');
      setPrincipal(String(resolvedData.principal || 0));
      setDays(String(resolvedData.days || 0));
      setInterest(String(resolvedData.interest || 0));
      setInsurance(String(resolvedData.insurance || 0));
      setSettlement(String(resolvedData.settlement || 0));
    }
  };

  // 1. Web Bluetooth ESC/POS Printing Handler (Direct to 80mm Thermal Receipt Printer)
  const handleBluetoothPrint = async () => {
    setIsBluetoothPrinting(true);
    const toastId = toast.loading('Connecting to Bluetooth Printer...');

    try {
      const transport = new WebBluetoothTransport();
      const connected = await transport.connect();
      if (!connected) throw new Error('Could not connect to printer.');

      toast.loading('Sending receipt to printer...', { id: toastId });

      const adapter = new EscPosAdapter();
      const sep  = '----------------------------------------';
      const fmt  = (n: number) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      const pAmt   = parseFloat(principal || '0');
      const iAmt   = parseFloat(interest || '0');
      const insAmt = parseFloat(insurance || '0');
      const totAmt = parseFloat(settlement || '0');
      const appAmt = parseFloat(appraisedValuation || '0');

      const lines: Uint8Array[] = [
        adapter.init(),
        // ── HEADER (centered) ──
        adapter.align(1),
        adapter.text(`${companyTitle || 'RUPASINGHE TRUST INVESTMENTS LTD.'}\n`, true, true, true),
        adapter.text(`${branchAddress || 'No. 3/B/1, Station Road, Dehiwala.'}\n`),
        adapter.text(`${sep}\n`),
        adapter.text('PAWN REDEMPTION RECEIPT\n', true, false, true),
        adapter.text(`${sep}\n`),
        // ── META (left) ──
        adapter.align(0),
        adapter.text(`Receipt No: ${billNo}\n`, true),
        adapter.text(`Date: ${redemptionDate}\n`),
        adapter.text(`${sep}\n`),
        // ── CUSTOMER (left) ──
        adapter.text(`Customer: ${customerName}\n`),
        adapter.text(`NIC: ${nic}  Phone: ${phone}\n`),
        adapter.text(`Address: ${customerAddress}\n`),
        adapter.text(`${sep}\n`),
        // ── ARTICLE (left) ──
        adapter.text(`Article: ${description}\n`, true),
        adapter.text(`Appraised: Rs. ${fmt(appAmt)}\n`),
        adapter.text(`Weight: ${weight}\n`),
        adapter.text(`${sep}\n`),
        // ── BREAKDOWN ──
        adapter.text(`Principal: Rs. ${fmt(pAmt)}\n`),
        adapter.text(`Interest (${days} Days): Rs. ${fmt(iAmt)}\n`),
        adapter.text(`Insurance & Charges: Rs. ${fmt(insAmt)}\n`),
        adapter.text(`${sep}\n`),
        // ── TOTAL SETTLEMENT ──
        adapter.align(1),
        adapter.text(`TOTAL SETTLEMENT: Rs. ${fmt(totAmt)}\n`, true, false, true),
        adapter.text(`${sep}\n`),
        adapter.feed(2),
        adapter.align(0),
        adapter.text('Customer Signature      Cashier Signature\n'),
        adapter.text('-------------------     -------------------\n'),
        adapter.feed(4),
        adapter.cut(),
      ];

      const payload = EscPosAdapter.concat(lines);
      await transport.write(payload);

      toast.success('Redemption Receipt Printed via Bluetooth!', { id: toastId });
      setTimeout(() => transport.disconnect(), 1000);

    } catch (err: any) {
      if (err.name === 'NotFoundError' || err.message?.includes('cancel')) {
        toast.error('Bluetooth connection cancelled.', { id: toastId });
      } else {
        toast.error('Bluetooth Print Failed', { description: err.message, id: toastId });
      }
    } finally {
      setIsBluetoothPrinting(false);
    }
  };

  // 2. Standard Web Browser 80mm Print Handler
  const handleStandardPrint = () => {
    const printWindow = window.open('', '_blank', 'width=650,height=800');
    if (!printWindow) {
      toast.error('Popup blocked. Please allow popups to print.');
      return;
    }
    const fmt = (n: number) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const pAmt   = parseFloat(principal || '0');
    const iAmt   = parseFloat(interest || '0');
    const insAmt = parseFloat(insurance || '0');
    const totAmt = parseFloat(settlement || '0');
    const appAmt = parseFloat(appraisedValuation || '0');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8"/>
        <title>Pawn Redemption Receipt - ${billNo}</title>
        <style>
          @media print {
            @page { size: 80mm auto; margin: 0; }
            body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; background: white !important; margin: 0; padding: 10px; }
          }
          body { font-family: 'Courier New', monospace; font-size: 12px; width: 300px; margin: 0 auto; padding: 16px; background: white; color: #000; }
          .center { text-align: center; }
          .right { text-align: right; }
          .bold { font-weight: bold; }
          .sep { border-top: 1px dashed #000; margin: 8px 0; }
          .row { display: flex; justify-space-between; margin-bottom: 4px; }
        </style>
      </head>
      <body>
        <div class="center bold" style="font-size: 14px;">${companyTitle}</div>
        <div class="center" style="font-size: 10px;">${branchAddress}</div>
        <div class="sep"></div>
        <div class="center bold">PAWN REDEMPTION RECEIPT</div>
        <div class="sep"></div>
        <div class="row"><span>Receipt No: <strong>${billNo}</strong></span><span>Date: ${redemptionDate}</span></div>
        <div class="sep"></div>
        <div>Customer: <strong>${customerName}</strong></div>
        <div>NIC: ${nic} | Phone: ${phone}</div>
        <div>Address: ${customerAddress}</div>
        <div class="sep"></div>
        <div>Article: <strong>${description}</strong></div>
        <div class="row"><span>Appraised: Rs. ${fmt(appAmt)}</span><span>Weight: ${weight}</span></div>
        <div class="sep"></div>
        <div class="row"><span>Principal Disbursed:</span><span>Rs. ${fmt(pAmt)}</span></div>
        <div class="row"><span>Interest (${days} Days):</span><span>Rs. ${fmt(iAmt)}</span></div>
        <div class="row"><span>Insurance & Charges:</span><span>Rs. ${fmt(insAmt)}</span></div>
        <div class="sep"></div>
        <div class="row bold" style="font-size: 13px;"><span>TOTAL SETTLEMENT:</span><span>Rs. ${fmt(totAmt)}</span></div>
        <div class="sep"></div>
        <div style="margin-top: 30px; display: flex; justify-content: space-between; font-size: 10px;" class="center">
          <div><div>-------------------</div>Customer Signature</div>
          <div><div>-------------------</div>Cashier Signature</div>
        </div>
        <script>
          setTimeout(() => { window.print(); window.close(); }, 500);
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <Dialog open={!!data} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-5xl max-w-5xl w-[95vw] max-h-[94vh] border border-slate-700 shadow-2xl rounded-3xl p-5 bg-slate-950 text-slate-100 flex flex-col overflow-y-auto">
        
        {/* Modal Header */}
        <DialogHeader className="border-b border-slate-800 pb-3 shrink-0">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-purple-400">
              <Coins className="w-5 h-5" />
              <DialogTitle className="text-xl font-black tracking-tight text-white">
                Pawn Redemption Receipt (80mm Thermal POS Printer)
              </DialogTitle>
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={resetFormDefaults}
                type="button"
                variant="outline"
                className="border-slate-700 text-slate-300 hover:bg-slate-800 text-xs font-bold px-3 py-1.5 rounded-xl"
              >
                Reset Form
              </Button>
              
              <Button
                onClick={handleBluetoothPrint}
                disabled={isBluetoothPrinting}
                type="button"
                className="bg-purple-600 hover:bg-purple-500 text-white font-black text-xs uppercase tracking-wider px-4 py-2 rounded-xl flex items-center gap-1.5 shadow-lg shadow-purple-600/30"
              >
                <Bluetooth className="w-4 h-4" />
                {isBluetoothPrinting ? 'PRINTING...' : 'BLUETOOTH PRINT (80mm)'}
              </Button>

              <Button
                onClick={handleStandardPrint}
                type="button"
                className="bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white font-bold text-xs uppercase tracking-wider px-4 py-2 rounded-xl flex items-center gap-1.5"
              >
                <Printer className="w-4 h-4" /> Web Print
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* Main 2-Column Container */}
        <div className="py-4 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

          {/* LEFT 5 COLS: EDITABLE INPUTS */}
          <div className="lg:col-span-5 bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3.5 text-xs">
            <div className="border-b border-slate-800 pb-2 flex items-center justify-between">
              <span className="font-extrabold text-xs text-purple-300 uppercase tracking-wider">Editable Bill Fields</span>
              <span className="text-[10px] text-slate-500">Real-time update</span>
            </div>

            {/* Header */}
            <div className="space-y-2 bg-slate-950 p-2.5 rounded-xl border border-slate-800">
              <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider block">1. Header Information</span>
              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Company Title</label>
                <input
                  type="text"
                  value={companyTitle}
                  onChange={(e) => setCompanyTitle(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-white font-bold focus:outline-none focus:border-purple-500 text-xs"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Branch Address & Tel</label>
                <input
                  type="text"
                  value={branchAddress}
                  onChange={(e) => setBranchAddress(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-slate-200 focus:outline-none focus:border-purple-500 text-xs"
                />
              </div>
            </div>

            {/* Bill & Customer */}
            <div className="space-y-2 bg-slate-950 p-2.5 rounded-xl border border-slate-800">
              <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider block">2. Receipt & Customer Info</span>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Bill No</label>
                  <input
                    type="text"
                    value={billNo}
                    onChange={(e) => setBillNoState(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 font-mono font-bold text-purple-300 focus:outline-none focus:border-purple-500 text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Redemption Date</label>
                  <input
                    type="text"
                    value={redemptionDate}
                    onChange={(e) => setRedemptionDate(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 font-mono text-slate-200 focus:outline-none focus:border-purple-500 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Customer Name</label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 font-bold text-white focus:outline-none focus:border-purple-500 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">NIC Number</label>
                  <input
                    type="text"
                    value={nic}
                    onChange={(e) => setNic(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 font-mono text-slate-200 focus:outline-none focus:border-purple-500 text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Phone Number</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 font-mono text-slate-200 focus:outline-none focus:border-purple-500 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Customer Address</label>
                <input
                  type="text"
                  value={customerAddress}
                  onChange={(e) => setCustomerAddress(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-slate-300 focus:outline-none focus:border-purple-500 text-xs"
                />
              </div>
            </div>

            {/* Article */}
            <div className="space-y-2 bg-slate-950 p-2.5 rounded-xl border border-slate-800">
              <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider block">3. Article Description</span>
              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Item Description</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 font-bold text-amber-300 focus:outline-none focus:border-purple-500 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Appraised Value (Rs.)</label>
                  <input
                    type="number"
                    value={appraisedValuation}
                    onChange={(e) => setAppraisedValuation(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 font-mono text-amber-300 focus:outline-none focus:border-purple-500 text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Weight (mg)</label>
                  <input
                    type="text"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 font-mono text-slate-200 focus:outline-none focus:border-purple-500 text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Financial Breakdown */}
            <div className="space-y-2 bg-slate-950 p-2.5 rounded-xl border border-slate-800">
              <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider block">4. Payment Breakdown</span>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Principal Loan (Rs.)</label>
                  <input
                    type="number"
                    value={principal}
                    onChange={(e) => {
                      const v = e.target.value;
                      setPrincipal(v);
                      handleRecalcSettlement(v, interest, insurance);
                    }}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 font-mono font-bold text-emerald-400 focus:outline-none focus:border-purple-500 text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Days Count</label>
                  <input
                    type="number"
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 font-mono text-slate-200 focus:outline-none focus:border-purple-500 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Interest (Rs.)</label>
                  <input
                    type="number"
                    value={interest}
                    onChange={(e) => {
                      const v = e.target.value;
                      setInterest(v);
                      handleRecalcSettlement(principal, v, insurance);
                    }}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 font-mono font-bold text-purple-300 focus:outline-none focus:border-purple-500 text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Insurance & Charges (Rs.)</label>
                  <input
                    type="number"
                    value={insurance}
                    onChange={(e) => {
                      const v = e.target.value;
                      setInsurance(v);
                      handleRecalcSettlement(principal, interest, v);
                    }}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 font-mono text-slate-200 focus:outline-none focus:border-purple-500 text-xs"
                  />
                </div>
              </div>

              <div className="pt-1">
                <label className="text-[10px] text-emerald-400 font-bold block mb-0.5">Total Settlement Paid (Rs.)</label>
                <input
                  type="number"
                  value={settlement}
                  onChange={(e) => setSettlement(e.target.value)}
                  className="w-full bg-emerald-950 border border-emerald-500/50 rounded px-3 py-1.5 font-mono font-bold text-emerald-300 text-sm focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* RIGHT 7 COLS: 80MM POS THERMAL RECEIPT REAL-TIME PREVIEW */}
          <div className="lg:col-span-7 flex justify-center">
            <div className="w-[576px] max-w-full bg-white text-black p-5 rounded-xl shadow-2xl font-mono text-xs border border-slate-300 space-y-2">
              
              {/* Header */}
              <div className="text-center space-y-0.5 mb-2">
                <div className="text-base font-black tracking-wide text-black">
                  {companyTitle}
                </div>
                <div className="text-[11px] text-slate-800">
                  {branchAddress}
                </div>
              </div>

              <div className="border-t border-b border-black py-1 my-2 text-center font-bold text-sm tracking-wider uppercase">
                PAWN REDEMPTION RECEIPT
              </div>

              {/* Meta */}
              <div className="flex justify-between py-1 border-b border-slate-300 text-xs">
                <span>Receipt No: <strong>{billNo}</strong></span>
                <span>Date: <strong>{redemptionDate}</strong></span>
              </div>

              {/* Customer Info */}
              <div className="py-2 border-b border-slate-300 space-y-1 text-xs">
                <div>Customer: <strong>{customerName}</strong></div>
                <div>NIC: <strong>{nic}</strong> | Phone: {phone}</div>
                <div>Address: {customerAddress}</div>
              </div>

              {/* Item Info */}
              <div className="py-2 border-b border-slate-300 space-y-1 text-xs">
                <div>Article: <strong>{description}</strong></div>
                <div className="flex justify-between text-[11px]">
                  <span>Appraised: <strong>Rs. {parseFloat(appraisedValuation || '0').toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong></span>
                  <span>Weight: <strong>{weight}</strong></span>
                </div>
              </div>

              {/* Payment Breakdown */}
              <div className="py-2 space-y-1.5 border-b border-black text-xs">
                <div className="flex justify-between">
                  <span>Principal Disbursed:</span>
                  <span>Rs. {parseFloat(principal || '0').toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between">
                  <span>Accrued Interest ({days} Days):</span>
                  <span>Rs. {parseFloat(interest || '0').toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between">
                  <span>Insurance & Charges:</span>
                  <span>Rs. {parseFloat(insurance || '0').toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
              </div>

              {/* Total Settlement Paid */}
              <div className="py-2 my-1 flex justify-between items-center text-sm font-black border-b-2 border-black">
                <span>TOTAL SETTLEMENT:</span>
                <span className="text-base font-black">Rs. {parseFloat(settlement || '0').toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>

              {/* Signatures & Notice */}
              <div className="pt-4 space-y-6 text-[11px]">
                <div className="text-[10px] text-center text-slate-700 italic">
                  Official receipt for pawn redemption & article release.
                </div>

                <div className="flex justify-between items-end pt-4">
                  <div className="text-center">
                    <div className="border-b border-black w-32 mb-1"></div>
                    <div>Customer Signature</div>
                  </div>
                  <div className="text-center">
                    <div className="border-b border-black w-32 mb-1"></div>
                    <div>Cashier Signature</div>
                  </div>
                </div>
              </div>

            </div>
          </div>

        </div>

      </DialogContent>
    </Dialog>
  );
}
