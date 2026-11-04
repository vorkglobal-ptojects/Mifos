'use client';

import { useState, useEffect, useRef } from "react";
import { 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  Lock, 
  DivideCircle as Divider, 
  ShieldAlert,
  Package,
  PlusCircle,
  ArrowUpRight,
  TrendingUp,
  History,
  Trash2,
  Loader2,
  Calendar,
  Layers,
  Scale,
  Coins,
  ArrowRightLeft,
  XCircle,
  FileText,
  Search,
  CheckCircle,
  X,
  FileSpreadsheet,
  Printer,
  Building2,
  Users,
  UserPlus,
  Edit,
  Calculator,
  Filter,
  RotateCcw,
  QrCode,
  Tag,
  Percent,
  Save,
  Plus,
  ImageIcon,
  Upload
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { WebBluetoothTransport } from "@/lib/bluetooth/WebBluetoothTransport";
import { TsplAdapter } from "@/lib/bluetooth/TsplAdapter";
import { EscPosAdapter } from "@/lib/bluetooth/EscPosAdapter";
import { normalizeBranchId, getBranchSearchTerms, stripBranchPrefix, CANONICAL_BRANCHES, extractNumericBillNo, isSameNumericBill } from "@/lib/branch-mapping";
import { getAuthHeaders } from "@/lib/getAuthHeaders";
import ChangeRequestModal from "@/components/ChangeRequestModal";

// Stock item abbreviations
const ITEM_TYPES = [
  { code: 'PP', name: 'Pendant (PP)' },
  { code: 'PR', name: 'Ring (PR)' },
  { code: 'NL', name: 'Necklace (NL)' },
  { code: 'EAR', name: 'Earring (EAR)' },
  { code: 'BRC', name: 'Bracelet (BRC)' },
  { code: 'BPR', name: 'Baby Ring (BPR)' },
  { code: 'PB', name: 'Bangle (PB)' },
  { code: 'CR', name: 'Carved Ring (CR)' },
  { code: 'WJ', name: 'Wire Gyspy (WJ)' },
  { code: 'BJ', name: 'Ball Gyspy (BJ)' },
  { code: 'ANK', name: 'Anklets (ANK)' },
  { code: 'CH', name: 'Chain (CH)' },
  { code: 'DCH', name: 'Diamond Chain (DCH)' },
  { code: 'SPCH', name: 'Singapore Chain (SPCH)' },
  { code: 'VCH', name: 'V Chain (VCH)' },
  { code: 'BKT', name: 'Biscuit (BKT)' },
  { code: 'COIN', name: 'Coin (COIN)' },
  { code: 'NA', name: 'Not Applicable (NA)' },
  { code: 'TS', name: 'Tassel (TS)' },
  { code: 'SPJ', name: 'Spring Gyspy (SPJ)' }
];

const VALID_STOCK_CODES = new Set(ITEM_TYPES.map(it => it.code));

// Helper to normalize any messy or legacy item token into standard abbreviation (e.g. EAR, PR, CH, 18K-PP)
const normalizeItemToken = (rawToken: string): string => {
  if (!rawToken) return "";
  let clean = rawToken.trim();
  if (!clean) return "";

  // Check 18K / 18C prefix
  let is18K = false;
  if (/^18[KC][ -]/i.test(clean)) {
    is18K = true;
    clean = clean.replace(/^18[KC][ -]/i, '').trim();
  }

  // 1. Check parenthesized item code e.g. (EAR), (PR), (CH), (PP)
  const paren = clean.match(/\((EAR|PR|CH|PP|NL|BRC|PB|CR|WJ|BJ|ANK|DCH|SPCH|VCH|BKT|COIN|NA|TS|SPJ|BPR)\)/i);
  if (paren) {
    const code = paren[1].toUpperCase();
    return is18K ? `18K-${code}` : code;
  }

  // 2. Strip purity annotation like (22K), (20K), (24K), (9K), etc.
  clean = clean.replace(/\s*\(\d+K\)/gi, '').trim();

  // 3. Strip trailing sub-item numbering like -1, -2 or _1, _2
  clean = clean.replace(/[-_]\d+$/g, '').trim();

  // 4. Exact match of known code or code + count (e.g. EAR3, PR2)
  const codeMatch = clean.match(/^([A-Za-z]+)(\d*)$/);
  if (codeMatch && VALID_STOCK_CODES.has(codeMatch[1].toUpperCase())) {
    const code = codeMatch[1].toUpperCase();
    const count = codeMatch[2] || '';
    return (is18K ? `18K-${code}` : code) + count;
  }

  // 5. Keyword match in English or Sinhala descriptions
  const upper = clean.toUpperCase();
  if (upper.includes('CHAIN') || upper.includes('මාලය')) return is18K ? '18K-CH' : 'CH';
  if (upper.includes('BABY RING')) return is18K ? '18K-BPR' : 'BPR';
  if (upper.includes('RING') || upper.includes('මුද්ද')) return is18K ? '18K-PR' : 'PR';
  if (upper.includes('EAR') || upper.includes('කරාබු')) return is18K ? '18K-EAR' : 'EAR';
  if (upper.includes('PENDANT') || upper.includes('පෙන්ඩන්ට්')) return is18K ? '18K-PP' : 'PP';
  if (upper.includes('BRACELET') || upper.includes('බ්‍රේස්ලට්')) return is18K ? '18K-BRC' : 'BRC';
  if (upper.includes('BANGLE') || upper.includes('වළලු') || upper.includes('වලලු')) return is18K ? '18K-PB' : 'PB';
  if (upper.includes('NECKLACE')) return is18K ? '18K-NL' : 'NL';
  if (upper.includes('COIN')) return is18K ? '18K-COIN' : 'COIN';

  return is18K ? `18K-${clean.toUpperCase()}` : clean.toUpperCase();
};

// Helper to compress item type codes into short format (e.g., EAR, EAR, EAR -> EAR3, or 18C-PP, 18C-PP -> 18C-PP2)
const compressItemTypeString = (str: string): string => {
  if (!str) return "";

  // Split primarily by comma
  let rawTokens = str.split(',').map(s => s.trim()).filter(Boolean);

  // If only 1 token and it contains multiple space-separated known codes (e.g. 'PR PR' or 'CH PP')
  if (rawTokens.length === 1 && !rawTokens[0].includes('|') && !rawTokens[0].includes('(')) {
    const spaceParts = rawTokens[0].split(/\s+/).filter(Boolean);
    if (spaceParts.length > 1 && spaceParts.every(p => VALID_STOCK_CODES.has(p.replace(/\d+$/, '').toUpperCase()))) {
      rawTokens = spaceParts;
    }
  }

  const counts: { [code: string]: number } = {};
  const order: string[] = [];

  for (const token of rawTokens) {
    const norm = normalizeItemToken(token);
    if (!norm) continue;

    const match = norm.match(/^([A-Za-z0-9-]+?)(\d*)$/);
    if (match && match[1]) {
      const baseCode = match[1].toUpperCase();
      const num = match[2] ? parseInt(match[2], 10) : 1;
      if (!counts[baseCode]) {
        counts[baseCode] = 0;
        order.push(baseCode);
      }
      counts[baseCode] += num;
    } else {
      const upperToken = norm.toUpperCase();
      if (!counts[upperToken]) {
        counts[upperToken] = 0;
        order.push(upperToken);
      }
      counts[upperToken] += 1;
    }
  }

  return order.map(code => {
    const count = counts[code];
    return count > 1 ? `${code}${count}` : code;
  }).join(", ");
};

// Helper to expand compressed string (e.g. EAR3, 18C-PP2) into array of individual item objects
const expandItemTypeCodes = (str: string): Array<{ id: string, code: string }> => {
  if (!str) return [];
  const compressed = compressItemTypeString(str);
  if (!compressed) return [];

  const tokens = compressed.split(',').map(t => t.trim()).filter(Boolean);
  const result: Array<{ id: string, code: string }> = [];

  for (const token of tokens) {
    const match = token.match(/^([A-Za-z0-9-]+?)(\d*)$/);
    if (match && match[1]) {
      const baseCode = match[1].toUpperCase();
      const count = match[2] ? parseInt(match[2], 10) : 1;
      for (let i = 0; i < count; i++) {
        result.push({
          id: Math.random().toString(36).substring(2, 9),
          code: baseCode
        });
      }
    } else {
      result.push({
        id: Math.random().toString(36).substring(2, 9),
        code: token.toUpperCase()
      });
    }
  }

  return result;
};

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

// ==========================================
// TAB 1: Reconciliation State & Logic
// ==========================================
function EndOfDayContent() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab') as 'reconciliation' | 'stock' | 'matrix';
  // Navigation / Tabs
  const [activeTab, setActiveTab] = useState<'reconciliation' | 'stock' | 'matrix'>(initialTab || 'reconciliation');

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);
  const [step, setStep] = useState(1);
  const [cashCount, setCashCount] = useState<any>({
    "5000": 0, "1000": 0, "500": 0, "100": 0, "50": 0, "20": 0
  });
  
  const systemExpected = 458900; 

  const calculateTotal = () => {
    return Object.entries(cashCount).reduce((sum, [denom, count]: any) => {
      return sum + (parseInt(denom) * (parseInt(count) || 0));
    }, 0);
  };

  const actualTotal = calculateTotal();
  const difference = actualTotal - systemExpected;
  const isBalanced = difference === 0;

  // ==========================================
  // TAB 2: Stock Management State & Logic
  // ==========================================
  const [stockItems, setStockItems] = useState<any[]>([]);
  const [loadingStock, setLoadingStock] = useState(false);
  const [isUsingSupabase, setIsUsingSupabase] = useState(false);
  const [stockFilter, setStockFilter] = useState<'Active' | 'Withdrawn' | 'OldData'>('Active');
  const [searchQuery, setSearchQuery] = useState("");
  const [printingLabelId, setPrintingLabelId] = useState<string | null>(null);
  const [printerProtocol, setPrinterProtocol] = useState<'ESCPOS' | 'TSPL'>('ESCPOS');

  useEffect(() => {
    const saved = localStorage.getItem('mifos_printer_protocol');
    if (saved === 'TSPL' || saved === 'ESCPOS') {
      setPrinterProtocol(saved as any);
    }
  }, []);

  const togglePrinterProtocol = () => {
    const next = printerProtocol === 'ESCPOS' ? 'TSPL' : 'ESCPOS';
    setPrinterProtocol(next);
    localStorage.setItem('mifos_printer_protocol', next);
    toast.success(`Printer format switched to: ${next === 'ESCPOS' ? 'Thermal Receipt (ESC/POS)' : 'Sticker Label (TSPL)'}`);
  };

  // Handle Bluetooth Sticker Label Printing
  const handlePrintLabel = async (item: any) => {
    const itemKey = item.id || item.bill_no;
    if (printingLabelId) return;
    setPrintingLabelId(itemKey);
    const toastId = toast.loading(`Connecting to Bluetooth Printer for ${stripBranchPrefix(item.bill_no)}...`);

    try {
      const transport = new WebBluetoothTransport();
      const connected = await transport.connect();
      if (!connected) throw new Error('Could not connect to Bluetooth printer.');

      toast.loading(`Printing formatted stock ticket for ${stripBranchPrefix(item.bill_no)}...`, { id: toastId });

      // Extract item details & generate sequential label print number (e.g. LBL-0001)
      const getNextLabelNo = () => {
        try {
          const last = parseInt(localStorage.getItem('mifos_last_label_seq') || '0', 10);
          const next = last + 1;
          localStorage.setItem('mifos_last_label_seq', next.toString());
          const padded = String(next).padStart(4, '0');
          return `LBL-${padded}`;
        } catch (e) {
          return `LBL-0001`;
        }
      };

      const labelNo = getNextLabelNo();
      let printedBy = 'Branch Teller';
      let printedUserEmail = 'system';
      if (currentUser) {
        printedBy = currentUser.first_name || currentUser.name || currentUser.fullName || currentUser.email?.split('@')[0] || 'Teller';
        printedUserEmail = currentUser.email || currentUser.username || printedBy;
      }

      const billNoStr = stripBranchPrefix(item.bill_no || '').toString().trim();
      const branchName = (item.branch_id || 'HQ').toString().trim();
      
      const rawTypes = compressItemTypeString(item.item_type || "");
      const formattedItemNames = rawTypes ? rawTypes.split(", ").map((code: string) => getItemName(code)).join(" + ") : "";
      const displayItem = formattedItemNames || item.item_type || 'Item';
      
      const formattedDate = item.date 
        ? new Date(item.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
        : '';
      const formattedWeight = `${Math.round(parseFloat(item.weight || 0) * 1000)} mg`;

      // Look up customer info for QR payload & ticket
      const customer = (stockCustomers || []).find((c: any) => {
        if (!c.bill_numbers) return false;
        return c.bill_numbers.split(/[, ]+/).some((b: string) => b.trim().toUpperCase() === billNoStr.toUpperCase());
      }) || (oldStockCustomers || []).find((c: any) => {
        if (!c.bill_numbers) return false;
        return c.bill_numbers.split(/[, ]+/).some((b: string) => b.trim().toUpperCase() === billNoStr.toUpperCase());
      });

      // Rich QR Code Payload containing Label No, Pawning & Customer details
      const qrDetails: string[] = [
        `NO: ${labelNo}`,
        `BILL: ${billNoStr}`,
        `BRANCH: ${branchName}`,
        `DATE: ${formattedDate}`
      ];
      if (customer) {
        if (customer.name) qrDetails.push(`NAME: ${customer.name}`);
        if (customer.nic) qrDetails.push(`NIC: ${customer.nic}`);
        if (customer.tp) qrDetails.push(`TEL: ${customer.tp}`);
      }
      qrDetails.push(`ITEM: ${displayItem}`);
      qrDetails.push(`WT: ${formattedWeight}`);
      qrDetails.push(`PRINTED BY: ${printedBy}`);

      const qrPayload = qrDetails.join(' | ');

      const printerProtocol = (typeof window !== 'undefined' ? (localStorage.getItem('mifos_printer_protocol') || 'ESCPOS') : 'ESCPOS').toUpperCase();

      let payload: Uint8Array;

      if (printerProtocol === 'TSPL') {
        const adapter = new TsplAdapter();
        const commands: Uint8Array[] = [
          adapter.init(50, 30, 2),
          // QR Code on Left (x=15, y=15, cellWidth=3)
          adapter.qrcode(qrPayload, 15, 15, 3),
          // Line 1: Header Branch & Bill No (x=145, y=15, font 2)
          adapter.text(`${branchName} | ${billNoStr}`, 145, 15, "2", 1, 1),
          // Line 2: Label Number NO: LBL-0001 (x=145, y=48, font 2)
          adapter.text(`NO: ${labelNo}`, 145, 48, "2", 1, 1),
          // Line 3: Item Name (x=145, y=81, font 2)
          adapter.text(displayItem.length > 20 ? displayItem.substring(0, 20) + '..' : displayItem, 145, 81, "2", 1, 1),
          // Line 4: Weight (x=145, y=114, font 2)
          adapter.text(`Weight: ${formattedWeight}`, 145, 114, "2", 1, 1),
          // Line 5: Pawning Date under Weight (x=145, y=147, font 2)
          adapter.text(`DATE: ${formattedDate}`, 145, 147, "2", 1, 1),
          adapter.print(1, 1)
        ];
        payload = adapter.concat(commands);
      } else {
        // Standard ESC/POS Thermal Receipt / Ticket Format
        const adapter = new EscPosAdapter();
        const sep = '----------------------------------------';
        const dsep = '========================================';
        const bObj = CANONICAL_BRANCHES.find(b => b.id === normalizeBranchId(branchName));
        const fullBranchName = bObj ? bObj.name : (branchName === 'HQ' ? 'Head Office' : branchName);

        const lines: Uint8Array[] = [
          adapter.init(),
          // ── HEADER (centered) ──
          adapter.align(1),
          adapter.text('RUPASINGHE TRUST INVESTMENTS\n', true, true, true),
          adapter.text(`${fullBranchName} Branch · Safe Custody\n`, true),
          adapter.text(`${dsep}\n`),
          adapter.text('PAWN STOCK TICKET\n', true, false, true),
          adapter.text(`${dsep}\n`),

          // ── CORE IDENTIFIERS ──
          adapter.align(0),
          adapter.text(`Bill No   : ${billNoStr}\n`, true),
          adapter.text(`Label Ref : ${labelNo}\n`, true),
          adapter.text(`Date      : ${formattedDate || new Date().toLocaleDateString('en-GB')}\n`),
          adapter.text(`${sep}\n`),

          // ── ARTICLE DETAILS ──
          adapter.text('COLLATERAL ARTICLE:\n', true),
          adapter.text(`Item      : ${displayItem}\n`, true),
          adapter.text(`Weight    : ${formattedWeight}\n`, true),
          ...(item.purity ? [adapter.text(`Purity    : ${item.purity}\n`)] : []),
          ...(item.appraised_value ? [adapter.text(`Appraised : Rs. ${Number(item.appraised_value).toLocaleString()}\n`)] : []),
          adapter.text(`${sep}\n`),

          // ── CUSTOMER INFO (if matched) ──
          ...(customer ? [
            adapter.text('CUSTOMER INFORMATION:\n', true),
            ...(customer.name ? [adapter.text(`Name      : ${customer.name}\n`)] : []),
            ...(customer.nic ? [adapter.text(`NIC       : ${customer.nic}\n`)] : []),
            ...(customer.tp ? [adapter.text(`Phone     : ${customer.tp}\n`)] : []),
            adapter.text(`${sep}\n`),
          ] : []),

          // ── QR CODE (centered) ──
          adapter.align(1),
          adapter.qrcode(qrPayload, 5),
          adapter.text('Scan in Auditor Portal to verify\n'),
          adapter.text(`${dsep}\n`),

          // ── AUDIT METADATA ──
          adapter.align(0),
          adapter.text(`Printed By: ${printedBy}\n`),
          adapter.text(`Printed On: ${new Date().toLocaleDateString('en-GB')} ${new Date().toLocaleTimeString('en-GB')}\n`),
          adapter.text(`${sep}\n`),
          adapter.feed(4),
          adapter.cut(),
        ];

        payload = EscPosAdapter.concat(lines);
      }

      await transport.write(payload);

      // Record Print Event in Audit Logs
      fetch('/api/audit-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'PRINT_PAWN_LABEL',
          resource: billNoStr,
          label_no: labelNo,
          bill_no: billNoStr,
          branch_id: branchName,
          userEmail: printedUserEmail,
          details: {
            label_no: labelNo,
            bill_no: billNoStr,
            printed_by: printedBy,
            printed_by_email: printedUserEmail,
            item_type: displayItem,
            weight: formattedWeight,
            pawning_date: formattedDate
          }
        })
      }).catch(err => console.warn('Failed to post audit log:', err));

      try {
        const localLogs = JSON.parse(localStorage.getItem('local_audit_logs') || '[]');
        localLogs.unshift({
          id: Math.random().toString(36).substring(2, 9),
          action: 'PRINT_PAWN_LABEL',
          resource: `${billNoStr} (${labelNo})`,
          user_email: printedUserEmail,
          role: currentUser?.role || 'TELLER',
          branch_id: branchName,
          details: {
            label_no: labelNo,
            bill_no: billNoStr,
            printed_by: printedBy,
            printed_at: new Date().toISOString()
          },
          created_at: new Date().toISOString()
        });
        localStorage.setItem('local_audit_logs', JSON.stringify(localLogs.slice(0, 500)));
      } catch (e) {}

      toast.success(`Label ${labelNo} printed & logged by ${printedBy}!`, { id: toastId });
      setTimeout(() => transport.disconnect(), 1000);

    } catch (err: any) {
      if (err.name === 'NotFoundError' || err.message?.includes('cancel')) {
        toast.error('Bluetooth connection cancelled.', { id: toastId });
      } else {
        toast.error('Bluetooth Print Failed', { description: err.message, id: toastId });
      }
    } finally {
      setPrintingLabelId(null);
    }
  };

  // Old DB Stock State
  const [oldStockItems, setOldStockItems] = useState<any[]>([]);
  const [oldStockCustomers, setOldStockCustomers] = useState<any[]>([]);
  const [loadingOldStock, setLoadingOldStock] = useState(false);

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [isEditingWithdrawal, setIsEditingWithdrawal] = useState(false);
  const [isEditingActive, setIsEditingActive] = useState(false);
  const [selectedItemForWithdrawal, setSelectedItemForWithdrawal] = useState<any | null>(null);
  const [selectedActiveItem, setSelectedActiveItem] = useState<any | null>(null);

  // Maker-Checker Change Request Modal State
  const [stockChangeModal, setStockChangeModal] = useState<{
    isOpen: boolean;
    entityType: 'STOCK' | 'INTEREST';
    actionType: 'UPDATE' | 'DELETE' | 'RESTORE' | 'VOID_INTEREST';
    entityId: string;
    referenceNo: string;
    branchId: string;
    currentData: Record<string, any>;
    initialProposedData?: Record<string, any>;
  }>({
    isOpen: false,
    entityType: 'STOCK',
    actionType: 'DELETE',
    entityId: '',
    referenceNo: '',
    branchId: '',
    currentData: {}
  });

  // Restore Modal State
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [selectedItemForRestore, setSelectedItemForRestore] = useState<any | null>(null);
  const [restoreDate, setRestoreDate] = useState("");
  const [restoreInterest, setRestoreInterest] = useState("");
  const [restoreNotes, setRestoreNotes] = useState("");
  const [isSubmittingRestore, setIsSubmittingRestore] = useState(false);

  // Stock Customers State
  const [stockCustomers, setStockCustomers] = useState<any[]>([]);
  const [showBillCustomerModal, setShowBillCustomerModal] = useState(false);
  const [selectedBillForCustomerView, setSelectedBillForCustomerView] = useState<string | null>(null);
  const [selectedBranchForCustomerView, setSelectedBranchForCustomerView] = useState<string | null>(null);
  const [selectedStockItemForCustomerView, setSelectedStockItemForCustomerView] = useState<any | null>(null);

  // Bill Item Image States
  const [billImages, setBillImages] = useState<Record<string, string>>({});
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [showImagePreviewModal, setShowImagePreviewModal] = useState(false);
  const billImageInputRef = useRef<HTMLInputElement>(null);

  // Add Customer Form States
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  const [isEditingCustomer, setIsEditingCustomer] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
  const [custName, setCustName] = useState("");
  const [custAddress, setCustAddress] = useState("");
  const [custAddress2, setCustAddress2] = useState("");
  const [custTp, setCustTp] = useState("");
  const [custNic, setCustNic] = useState("");
  const [custBills, setCustBills] = useState("");
  const [nameSuggestions, setNameSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Stock Interests Form States
  const [stockInterests, setStockInterests] = useState<any[]>([]);
  const [showAddInterestModal, setShowAddInterestModal] = useState(false);
  const [interestDate, setInterestDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [interestValue, setInterestValue] = useState<string>("");
  const [interestBranch, setInterestBranch] = useState<string>("HQ");
  const [interestItemId, setInterestItemId] = useState<string>("");
  const [interestNotes, setInterestNotes] = useState<string>("");
  const [isSubmittingInterest, setIsSubmittingInterest] = useState(false);

  const fetchStockInterests = async () => {
    let remoteRecords: any[] = [];
    try {
      const res = await fetch('/api/stock/interest');
      if (res.ok) {
        const json = await res.json();
        if (json.data && Array.isArray(json.data)) {
          remoteRecords = json.data;
        }
      }
    } catch (e) {
      console.error("Failed to fetch stock interests:", e);
    }

    // Merge with any local interest entries stored in browser localStorage
    const local = localStorage.getItem('local_stock_interests');
    let localRecords: any[] = [];
    if (local) {
      try {
        const parsed = JSON.parse(local);
        if (Array.isArray(parsed)) {
          localRecords = parsed;
        }
      } catch (e) {}
    }

    // Combine remote + local deduplicated by id / key
    const map = new Map<string, any>();
    remoteRecords.forEach(r => {
      if (r) {
        const key = r.id || `${r.bill_no}_${r.branch}_${r.date}_${r.interest_value}`;
        map.set(key, r);
      }
    });
    localRecords.forEach(r => {
      if (r) {
        const key = r.id || `${r.bill_no}_${r.branch}_${r.date}_${r.interest_value}`;
        if (!map.has(key)) {
          map.set(key, r);
        }
      }
    });

    const combined = Array.from(map.values());
    if (combined.length > 0) {
      setStockInterests(combined);
      localStorage.setItem('local_stock_interests', JSON.stringify(combined));
    }

    // Auto-Sync to Cloud: If the tablet/browser has local interest records that are not in remote database,
    // automatically sync them to the server so they become visible to all tellers and devices.
    if (localRecords.length > 0) {
      const unsynced = localRecords.filter(loc => {
        if (!loc || !loc.bill_no || !loc.interest_value) return false;
        return !remoteRecords.some(rem => 
          rem.id === loc.id || 
          ((rem.bill_no || '').trim().toUpperCase() === (loc.bill_no || '').trim().toUpperCase() &&
           (rem.branch || '').trim().toUpperCase() === (loc.branch || '').trim().toUpperCase() &&
           rem.date === loc.date &&
           parseFloat(rem.interest_value) === parseFloat(loc.interest_value))
        );
      });

      if (unsynced.length > 0) {
        console.log(`[Auto-Sync] Syncing ${unsynced.length} tablet interest records to cloud...`);
        toast.info(`Syncing ${unsynced.length} offline interest payment(s) from this tablet to Cloud...`);
        Promise.all(unsynced.map(item => 
          fetch('/api/stock/interest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item)
          }).catch(e => console.warn('[Auto-Sync] Failed for item:', item, e))
        )).then(() => {
          console.log('[Auto-Sync] Local interest records successfully synced to cloud.');
          toast.success(`Successfully restored ${unsynced.length} interest payments to Database!`);
          fetch('/api/stock/interest')
            .then(r => r.json())
            .then(json => {
              if (json && json.data && Array.isArray(json.data)) {
                setStockInterests(json.data);
                localStorage.setItem('local_stock_interests', JSON.stringify(json.data));
              }
            }).catch(() => {});
        });
      }
    }
  };

  useEffect(() => {
    fetchStockInterests();
  }, []);

  const openAddInterestModal = (billNoStr: string, branchStr?: string, itemId?: string) => {
    setInterestDate(new Date().toISOString().split('T')[0]);
    setInterestValue("");
    const targetBranch = normalizeBranchId(
      branchStr ||
      selectedStockItemForCustomerView?.branch_id ||
      selectedBranchForCustomerView ||
      (selectedBranch !== 'ALL' ? selectedBranch : null) ||
      currentUser?.branchId ||
      "HQ"
    );
    setInterestBranch(targetBranch);
    setInterestItemId(itemId || selectedStockItemForCustomerView?.id || "");
    setInterestNotes("");
    setShowAddInterestModal(true);
  };

  const handleSaveInterest = async () => {
    if (!selectedBillForCustomerView) return;
    if (!interestDate || !interestValue || !interestBranch) {
      toast.error("Please fill in Date, Interest Value, and Branch.");
      return;
    }
    const val = parseFloat(interestValue);
    if (isNaN(val) || val <= 0) {
      toast.error("Please enter a valid interest value.");
      return;
    }

    setIsSubmittingInterest(true);
    const targetBranch = normalizeBranchId(
      interestBranch || 
      selectedStockItemForCustomerView?.branch_id ||
      selectedBranchForCustomerView || 
      currentUser?.branchId || 
      "DMT"
    );
    const newEntry = {
      bill_no: selectedBillForCustomerView,
      item_id: interestItemId || selectedStockItemForCustomerView?.id || undefined,
      date: interestDate,
      interest_value: val,
      branch: targetBranch,
      notes: interestNotes,
      created_at: new Date().toISOString()
    };

    try {
      const res = await fetch('/api/stock/interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newEntry)
      });
      let json: any = null;
      try {
        json = await res.json();
      } catch {}
      const savedEntry = (json && json.data) ? json.data : { ...newEntry, id: 'loc_' + Date.now() };

      // Update state and localStorage IMMEDIATELY so it never shows 0 or disappears
      setStockInterests(prev => {
        const updated = [savedEntry, ...prev.filter(i => i.id !== savedEntry.id)];
        localStorage.setItem('local_stock_interests', JSON.stringify(updated));
        return updated;
      });

      if (res.ok && json.success) {
        toast.success(`Interest of LKR ${val.toLocaleString()} added for bill ${selectedBillForCustomerView} (${targetBranch})!`);
      } else {
        toast.success(`Interest of LKR ${val.toLocaleString()} saved for ${targetBranch}!`);
      }
      setShowAddInterestModal(false);
      setInterestValue("");
      setInterestNotes("");
    } catch (err: any) {
      const localEntry = { ...newEntry, id: 'loc_' + Date.now() };
      setStockInterests(prev => {
        const updated = [localEntry, ...prev.filter(i => i.id !== localEntry.id)];
        localStorage.setItem('local_stock_interests', JSON.stringify(updated));
        return updated;
      });
      toast.success(`Interest of LKR ${val.toLocaleString()} saved!`);
      setShowAddInterestModal(false);
      setInterestValue("");
      setInterestNotes("");
    } finally {
      setIsSubmittingInterest(false);
    }
  };

  const handleDeleteInterest = async (id: string) => {
    if (currentUser?.role === 'TELLER') {
      setStockChangeModal({
        isOpen: true,
        entityType: 'INTEREST',
        actionType: 'VOID_INTEREST',
        entityId: String(id),
        referenceNo: `INT-${id}`,
        branchId: selectedBranch || 'HQ',
        currentData: { id }
      });
      return;
    }
    try {
      await fetch(`/api/stock/interest?id=${id}`, { method: 'DELETE' });
    } catch (e) {}
    setStockInterests(prev => {
      const updated = prev.filter(i => i.id !== id);
      localStorage.setItem('local_stock_interests', JSON.stringify(updated));
      return updated;
    });
    toast.success("Interest entry removed.");
  };

  const handleBillImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedBillForCustomerView) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file (JPG, PNG, WEBP)');
      return;
    }

    setIsUploadingImage(true);
    const toastId = toast.loading(`Uploading image for bill ${selectedBillForCustomerView}...`);

    try {
      let publicUrl = '';
      const fileExt = file.name.split('.').pop() || 'jpg';
      const cleanBill = selectedBillForCustomerView.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filePath = `bills/${cleanBill}_${Date.now()}.${fileExt}`;

      try {
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('pawn_images')
          .upload(filePath, file, { upsert: true });

        if (!uploadError && uploadData) {
          const { data: urlData } = supabase.storage
            .from('pawn_images')
            .getPublicUrl(filePath);
          publicUrl = urlData?.publicUrl || '';
        }
      } catch (storageErr) {
        console.warn("Supabase storage error, using fallback data URL:", storageErr);
      }

      if (!publicUrl) {
        publicUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }

      const updated = {
        ...billImages,
        [selectedBillForCustomerView]: publicUrl
      };
      setBillImages(updated);
      try {
        localStorage.setItem('local_stock_bill_images', JSON.stringify(updated));
      } catch (err) {
        console.warn("Could not save to localStorage", err);
      }

      toast.success(`Image uploaded for bill ${selectedBillForCustomerView}!`, { id: toastId });
    } catch (err: any) {
      console.error("Failed to upload image:", err);
      toast.error(err.message || 'Failed to upload image', { id: toastId });
    } finally {
      setIsUploadingImage(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleRemoveBillImage = (billNo: string) => {
    const updated = { ...billImages };
    delete updated[billNo];
    setBillImages(updated);
    try {
      localStorage.setItem('local_stock_bill_images', JSON.stringify(updated));
    } catch (e) {}
    toast.success(`Image removed for bill ${billNo}`);
    setShowImagePreviewModal(false);
  };

  // Stock Daily Matrix State & Handlers
  const [matrixDate, setMatrixDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [matrixBranch, setMatrixBranch] = useState<string>("ALL");
  const [matrixCategoryFilter, setMatrixCategoryFilter] = useState<string>("ALL");
  const [matrixResponse, setMatrixResponse] = useState<any>(null);
  const [loadingMatrix, setLoadingMatrix] = useState<boolean>(false);

  // Edit / Delete Matrix Item Modal State
  const [editingMatrixItem, setEditingMatrixItem] = useState<any | null>(null);
  const [showEditMatrixModal, setShowEditMatrixModal] = useState<boolean>(false);
  const [editMatrixAmount, setEditMatrixAmount] = useState<string>("");
  const [editMatrixDate, setEditMatrixDate] = useState<string>("");
  const [editMatrixBranch, setEditMatrixBranch] = useState<string>("");
  const [editMatrixNotes, setEditMatrixNotes] = useState<string>("");
  const [isSubmittingEditMatrix, setIsSubmittingEditMatrix] = useState<boolean>(false);

  const [deletingMatrixItem, setDeletingMatrixItem] = useState<any | null>(null);
  const [showDeleteMatrixModal, setShowDeleteMatrixModal] = useState<boolean>(false);
  const [isDeletingMatrixItem, setIsDeletingMatrixItem] = useState<boolean>(false);

  // Redis Cache Invalidation / Force Refresh state & handler
  const [isForceRefreshing, setIsForceRefreshing] = useState<boolean>(false);
  const [forceExpireChecked, setForceExpireChecked] = useState<boolean>(false);

  const handleForceRefreshInventory = async (targetBranch = matrixBranch, targetDate = matrixDate) => {
    setIsForceRefreshing(true);
    const toastId = toast.loading("Invalidating inventory cache...");
    try {
      const token = localStorage.getItem('auth_token') || '';
      const res = await fetch('/api/stock/cache/invalidate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          branch: targetBranch || selectedBranch || 'ALL',
          date: targetDate || matrixDate
        })
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to invalidate inventory cache');
      }

      toast.success("Inventory refreshed successfully.", { id: toastId });
      // Fresh reload from PostgreSQL
      await fetchDailyMatrix(matrixDate, matrixBranch);
      if (activeTab === 'stock') {
        await loadStockData();
      }
    } catch (err: any) {
      console.error("Force refresh error:", err);
      toast.error(err.message || "Failed to refresh inventory cache.", { id: toastId });
    } finally {
      setIsForceRefreshing(false);
    }
  };

  const fetchDailyMatrix = async (dDate = matrixDate, dBranch = matrixBranch) => {
    setLoadingMatrix(true);
    try {
      const res = await fetch(`/api/stock/daily-matrix?date=${dDate}&branch=${dBranch}`);
      if (res.ok) {
        const json = await res.json();
        setMatrixResponse(json);
      }
    } catch (err) {
      console.error("Failed to fetch daily matrix:", err);
    } finally {
      setLoadingMatrix(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'matrix') {
      fetchDailyMatrix(matrixDate, matrixBranch);
    }
  }, [activeTab, matrixDate, matrixBranch]);

  const openEditMatrixItem = (item: any) => {
    setEditingMatrixItem(item);
    setEditMatrixAmount(item.amount ? item.amount.toString() : "");
    setEditMatrixDate(item.date || matrixDate);
    setEditMatrixBranch(item.branch || "DMT");
    setEditMatrixNotes(item.notes || item.remarks || item.reason || "");
    setShowEditMatrixModal(true);
  };

  const handleSaveEditMatrixItem = async () => {
    if (!editingMatrixItem) return;
    setIsSubmittingEditMatrix(true);
    try {
      const res = await fetch('/api/stock/daily-matrix/item', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingMatrixItem.id,
          category: editingMatrixItem.category,
          bill_no: editingMatrixItem.bill_no,
          date: editMatrixDate,
          amount: parseFloat(editMatrixAmount) || 0,
          branch: editMatrixBranch,
          notes: editMatrixNotes,
          remarks: editMatrixNotes
        })
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success("Transaction updated successfully!");
        setShowEditMatrixModal(false);
        fetchDailyMatrix(matrixDate, matrixBranch);
        fetchStockInterests();
      } else {
        toast.error(json.error || "Failed to update item");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to update item");
    } finally {
      setIsSubmittingEditMatrix(false);
    }
  };

  const openDeleteMatrixItem = (item: any) => {
    setDeletingMatrixItem(item);
    setShowDeleteMatrixModal(true);
  };

  const handleConfirmDeleteMatrixItem = async () => {
    if (!deletingMatrixItem) return;
    setIsDeletingMatrixItem(true);
    try {
      const res = await fetch(`/api/stock/daily-matrix/item?id=${deletingMatrixItem.id}&category=${deletingMatrixItem.category}`, {
        method: 'DELETE'
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success("Transaction removed from daily matrix!");
        setShowDeleteMatrixModal(false);
        fetchDailyMatrix(matrixDate, matrixBranch);
        fetchStockInterests();
      } else {
        toast.error(json.error || "Failed to delete item");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to delete item");
    } finally {
      setIsDeletingMatrixItem(false);
    }
  };

  // Form State - Add Stock Item
  const [billNo, setBillNo] = useState("");
  const [billPrefix, setBillPrefix] = useState<string | null>(null);
  const BILL_PREFIXES = ["A", "1R", "3M", "3R", "6R", "12R", "6M"];

  const parseBillNumber = (billNoStr: string) => {
    let str = (billNoStr || "").trim().toUpperCase();
    str = stripBranchPrefix(str).toUpperCase();
    const sortedPrefixesByLength = [...BILL_PREFIXES].sort((a, b) => b.length - a.length);

    for (const pref of sortedPrefixesByLength) {
      if (str.startsWith(pref + " ") || str === pref || (str.startsWith(pref) && !/\D/.test(str.charAt(pref.length)))) {
        const rest = str.substring(pref.length).trim();
        const numPart = parseInt(rest.replace(/\D/g, ''), 10) || 0;
        const orderIdx = BILL_PREFIXES.indexOf(pref);
        return { orderIdx: orderIdx >= 0 ? orderIdx : 999, numPart, raw: str };
      }
    }

    const numPart = parseInt(str.replace(/\D/g, ''), 10) || 0;
    return { orderIdx: 999, numPart, raw: str };
  };

  const sortStockItems = (items: any[]) => {
    return [...(items || [])].sort((a, b) => {
      const infoA = parseBillNumber(a?.bill_no);
      const infoB = parseBillNumber(b?.bill_no);

      if (infoA.orderIdx !== infoB.orderIdx) {
        return infoA.orderIdx - infoB.orderIdx;
      }

      if (infoA.numPart !== infoB.numPart) {
        return infoA.numPart - infoB.numPart;
      }

      return infoA.raw.localeCompare(infoB.raw);
    });
  };

  const handlePrefixClick = (prefix: string) => {
    if (billPrefix === prefix) {
      setBillPrefix(null);
    } else {
      setBillPrefix(prefix);
    }
  };
  const [price, setPrice] = useState("");
  const [weight, setWeight] = useState("");
  const [date, setDate] = useState("");
  const [selectedItems, setSelectedItems] = useState<Array<{ id: string, code: string }>>([]);
  const [itemSearch, setItemSearch] = useState("");
  const [itemQuantity, setItemQuantity] = useState(1);
  const [is18K, setIs18K] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const handleSelectCode = (code: string) => {
    const finalCode = is18K ? `18K-${code}` : code;
    const newItems = [];
    for (let i = 0; i < itemQuantity; i++) {
      newItems.push({ id: Math.random().toString(36).substring(2, 9), code: finalCode });
    }
    setSelectedItems([
      ...selectedItems,
      ...newItems
    ]);
    setItemSearch("");
    setIsDropdownOpen(false);
    setItemQuantity(1);
  };

  const handleRemoveItem = (idToRemove: string) => {
    setSelectedItems(selectedItems.filter(item => item.id !== idToRemove));
  };


  // Form State - Withdrawal
  const [withdrawalDate, setWithdrawalDate] = useState("");
  const [withdrawalReason, setWithdrawalReason] = useState("Pawn Redeemed (Closed)");
  const [withdrawalNotes, setWithdrawalNotes] = useState("");
  const [fsInterest, setFsInterest] = useState("");

  // Advanced Filtering State
  const [filterReason, setFilterReason] = useState<string>("ALL");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [filterPrefix, setFilterPrefix] = useState<string>("ALL");

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [branches, setBranches] = useState<any[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("ALL");
  const [selectedAddBranch, setSelectedAddBranch] = useState("");

  // Load user from localStorage
  useEffect(() => {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        const u = JSON.parse(userStr);
        setCurrentUser(u);
        if (u.role === 'TELLER' && activeTab === 'stock') {
          setActiveTab('reconciliation');
        }
        if (u.role !== 'ADMIN') {
          const uBranch = normalizeBranchId(u.branchId || '');
          setSelectedBranch(uBranch && uBranch !== 'HQ' ? uBranch : 'ALL');
        }
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

  // Fetch branches from Supabase
  const loadBranches = async () => {
    try {
      // Ensure W2, W3, W4 exist in Supabase
      const newBranches = [
        { id: 'W2', name: 'Wattala 2', is_active: true },
        { id: 'W3', name: 'Wattala 3', is_active: true },
        { id: 'W4', name: 'Wattala 4', is_active: true }
      ];
      await supabase.from('branches').upsert(newBranches, { onConflict: 'id' });

      const { data, error } = await supabase.from('branches').select('*').eq('is_active', true);
      if (error) throw error;
      setBranches(data || []);
    } catch (err) {
      console.error("Failed to load branches:", err);
      setBranches([
        { id: 'BRL', name: 'Borella' },
        { id: 'DHW', name: 'Dehiwala' },
        { id: 'DMT', name: 'Dematagoda' },
        { id: 'HMG', name: 'Homagama' },
        { id: 'KDW', name: 'Kadawatha' },
        { id: 'KIR', name: 'Kiribathgoda' },
        { id: 'KOT', name: 'Kotikawatta' },
        { id: 'KTW', name: 'Kottawa' },
        { id: 'PND', name: 'Panadura' },
        { id: 'W2',  name: 'Wattala 2' },
        { id: 'W3',  name: 'Wattala 3' },
        { id: 'W4',  name: 'Wattala 4' },
        { id: 'KHT', name: 'Kahathuduwa' },
        { id: 'TEST', name: 'Test Branch' },
        { id: 'HQ',  name: 'Head Office' }
      ]);
    }
  };

  useEffect(() => {
    loadBranches();
  }, []);

  // Sync selectedAddBranch with selectedBranch when modal opens
  useEffect(() => {
    if (showAddModal) {
      if (selectedBranch && selectedBranch !== 'ALL') {
        setSelectedAddBranch(selectedBranch);
      } else if (currentUser && currentUser.role !== 'ADMIN') {
        setSelectedAddBranch(currentUser.branchId || "HQ");
      } else {
        setSelectedAddBranch("");
      }
    }
  }, [showAddModal]);

  // Default dates to today on mount
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    setDate(today);
    setWithdrawalDate(today);
    try {
      const saved = localStorage.getItem('local_stock_bill_images');
      if (saved) {
        setBillImages(JSON.parse(saved));
      }
    } catch (e) {}
  }, []);

  // Fetch Stock items
  const loadStockData = async () => {
    if (currentUser?.role === 'TELLER') {
      setStockItems([]);
      setLoadingStock(false);
      return;
    }
    setLoadingStock(true);
    try {
      // Determine the active branch filter
      let activeBranch = selectedBranch;
      if (!activeBranch && currentUser) {
        activeBranch = currentUser.role === 'ADMIN' ? 'ALL' : (currentUser.branchId || 'ALL');
      }

      let allFetchedStock: any[] = [];
      let fetchSuccess = false;

      // 1. Primary: Server-side API endpoint (secure, bypasses client RLS drops, supports fast branch indexing)
      try {
        const headers = getAuthHeaders();
        const apiBranch = (activeBranch && activeBranch !== 'HQ') ? activeBranch : (currentUser?.role === 'ADMIN' ? 'ALL' : (currentUser?.branchId && currentUser.branchId !== 'HQ' ? currentUser.branchId : 'ALL'));
        const queryParams = new URLSearchParams({
          branch: apiBranch,
          search: searchQuery.trim(),
        });
        const res = await fetch(`/api/stock?${queryParams.toString()}`, { headers });
        if (res.ok) {
          const json = await res.json();
          if (json.items && Array.isArray(json.items)) {
            allFetchedStock = json.items;
            fetchSuccess = true;
          }
        }
      } catch (apiErr) {
        console.warn("Stock API fetch error, falling back to client Supabase:", apiErr);
      }

      // 2. Fallback: Client-side Supabase query
      if (!fetchSuccess) {
        let page = 0;
        const pageSize = 1000;
        let hasMore = true;

        while (hasMore) {
          let query = supabase.from('stock_items').select('*');
          if (activeBranch && activeBranch !== 'ALL' && activeBranch !== 'HQ') {
            const branchTerms = getBranchSearchTerms(activeBranch);
            query = query.in('branch_id', branchTerms);
          }
          if (searchQuery.trim()) {
            query = query.ilike('bill_no', `%${searchQuery.trim()}%`);
          }
          const { data, error } = await query
            .order('created_at', { ascending: false })
            .range(page * pageSize, (page + 1) * pageSize - 1);

          if (error) throw error;

          if (data && data.length > 0) {
            allFetchedStock = allFetchedStock.concat(data);
            if (data.length < pageSize) {
              hasMore = false;
            } else {
              page++;
            }
          } else {
            hasMore = false;
          }
        }
      }

      setStockItems(sortStockItems(allFetchedStock));
      setIsUsingSupabase(true);
      try {
        localStorage.setItem('local_stock_items', JSON.stringify(allFetchedStock));
      } catch {}
    } catch (err: any) {
      console.warn("Supabase fetch failed, falling back to LocalStorage:", err.message);
      setIsUsingSupabase(false);
      const localData = localStorage.getItem('local_stock_items');
      if (localData) {
        try {
          const allItems = JSON.parse(localData);
          let activeBranch = selectedBranch;
          if (!activeBranch && currentUser) {
            activeBranch = currentUser.role === 'ADMIN' ? 'ALL' : (currentUser.branchId || 'ALL');
          }
          const branchTerms = getBranchSearchTerms(activeBranch);
          let filtered = activeBranch && activeBranch !== 'ALL' && activeBranch !== 'HQ'
            ? allItems.filter((item: any) => branchTerms.includes(item.branch_id) || normalizeBranchId(item.branch_id) === normalizeBranchId(activeBranch))
            : allItems;
          if (searchQuery.trim()) {
            filtered = filtered.filter((item: any) => 
              (item.bill_no || "").toLowerCase().includes(searchQuery.toLowerCase())
            );
          }
          setStockItems(sortStockItems(filtered));
        } catch (parseErr) {
          console.error("Error parsing local stock items", parseErr);
          setStockItems([]);
        }
      } else {
        setStockItems([]);
      }
    } finally {
      setLoadingStock(false);
    }
  };

  const loadCustomerData = async (forceRefresh = false) => {
    const CACHE_KEY = 'local_stock_customers';
    const CACHE_TIME_KEY = 'local_stock_customers_timestamp';
    const CACHE_TTL_MS = 60 * 1000; // 60 seconds TTL for customer lookup (auto-refreshes fresh data)

    // 1. Check LocalStorage cache first (Zero Supabase Egress!)
    if (!forceRefresh) {
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        const cachedTime = localStorage.getItem(CACHE_TIME_KEY);
        if (cached && cachedTime) {
          const age = Date.now() - Number(cachedTime);
          if (age < CACHE_TTL_MS) {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setStockCustomers(parsed);
              setIsUsingSupabase(true);
              return;
            }
          }
        }
      } catch (cErr) {
        console.warn("Local cache read failed, fetching from Supabase:", cErr);
      }
    }

    try {
      let allCustomers: any[] = [];
      let fetchSuccess = false;

      // 1. Primary: Server-side API endpoint
      try {
        const activeBranch = selectedBranch !== 'ALL' ? selectedBranch : (currentUser?.branchId || '');
        const headers = getAuthHeaders(activeBranch ? { 'x-branch-id': activeBranch } : undefined);
        const res = await fetch('/api/stock-customers', { headers, cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          if (json.customers && Array.isArray(json.customers)) {
            allCustomers = json.customers;
            fetchSuccess = true;
          }
        }
      } catch (e) {
        console.warn("Stock customers API error, falling back to Supabase client:", e);
      }

      // 2. Fallback: Client-side Supabase
      if (!fetchSuccess) {
        let page = 0;
        const pageSize = 1000;
        let hasMore = true;

        while (hasMore) {
          const from = page * pageSize;
          const to = from + pageSize - 1;
          const { data, error } = await supabase
            .from('stock_customers')
            .select('id, name, tp, nic, address, bill_numbers')
            .order('name', { ascending: true })
            .range(from, to);

          if (error) throw error;
          if (data && data.length > 0) {
            allCustomers = allCustomers.concat(data);
            if (data.length < pageSize) {
              hasMore = false;
            } else {
              page++;
            }
          } else {
            hasMore = false;
          }
        }
      }

      setStockCustomers(allCustomers);
      setIsUsingSupabase(true);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(allCustomers));
        localStorage.setItem(CACHE_TIME_KEY, String(Date.now()));
      } catch (sErr) {
        console.warn("Failed to persist stock customers to localStorage:", sErr);
      }
    } catch (err) {
      console.warn("Failed to fetch stock customers from Supabase, loading LocalStorage:", err);
      setIsUsingSupabase(false);
      const local = localStorage.getItem(CACHE_KEY);
      if (local) {
        try {
          const allItems = JSON.parse(local);
          setStockCustomers(allItems);
        } catch (e) {
          setStockCustomers([]);
        }
      } else {
        setStockCustomers([]);
      }
    }
  };

  const loadOldStockData = async () => {
    setLoadingOldStock(true);
    try {
      let allOldFetchedStock: any[] = [];
      let page = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const res = await fetch(`/api/stock/old?type=items&page=${page}&pageSize=${pageSize}`);
        if (!res.ok) throw new Error('Failed to load legacy stock');
        const json = await res.json();
        const data = json.items || [];

        if (data && data.length > 0) {
          allOldFetchedStock = allOldFetchedStock.concat(data);
          if (data.length < pageSize) {
            hasMore = false;
          } else {
            page++;
          }
        } else {
          hasMore = false;
        }
      }

      const formatted = allOldFetchedStock.map(item => ({
        ...item,
        branch_id: item.branch_id || 'OLD'
      }));
      setOldStockItems(sortStockItems(formatted));
    } catch (err: any) {
      console.warn("Failed to load old stock items:", err);
      setOldStockItems([]);
    } finally {
      setLoadingOldStock(false);
    }
  };

  const loadOldCustomerData = async () => {
    try {
      const res = await fetch('/api/stock/old?type=customers');
      if (!res.ok) throw new Error('Failed to load legacy customers');
      const json = await res.json();
      setOldStockCustomers(json.customers || []);
    } catch (err) {
      setOldStockCustomers([]);
    }
  };

  // Load stock when tab, branch or search query changes
  useEffect(() => {
    if (activeTab === 'stock') {
      loadStockData();
      loadOldStockData();
    }
  }, [activeTab, selectedBranch, currentUser, searchQuery]);

  // Load customer registry only when tab or branch filter changes
  useEffect(() => {
    if (activeTab === 'stock') {
      loadCustomerData();
      loadOldCustomerData();
    }
  }, [activeTab, selectedBranch, currentUser]);

  const closeAddModal = () => {
    setBillNo("");
    setBillPrefix(null);
    setPrice("");
    setWeight("");
    setDate(new Date().toISOString().split('T')[0]);
    setSelectedItems([]);
    setSelectedAddBranch(selectedBranch !== 'ALL' ? selectedBranch : "");
    setIsEditingActive(false);
    setSelectedActiveItem(null);
    setShowAddModal(false);
  };

  const openEditActiveModal = (item: any) => {
    setSelectedActiveItem(item);
    
    // Always strip any branch prefix first (e.g. W3-, KDW-, KIR-)
    let cleanBillNo = stripBranchPrefix(item.bill_no || '');
    let foundPrefix = null;
    for (const pref of BILL_PREFIXES) {
      if (cleanBillNo.toUpperCase().startsWith(pref.toUpperCase() + " ")) {
        foundPrefix = pref;
        cleanBillNo = cleanBillNo.substring(pref.length + 1).trim();
        break;
      } else if (cleanBillNo.toUpperCase().startsWith(pref.toUpperCase())) {
        foundPrefix = pref;
        cleanBillNo = cleanBillNo.substring(pref.length).trim();
        break;
      }
    }

    setBillNo(cleanBillNo);
    setBillPrefix(foundPrefix);
    setPrice(item.price ? item.price.toString() : '');
    const rawW = parseFloat(item.weight) || 0;
    const displayMg = rawW < 100 ? Math.round(rawW * 1000) : rawW;
    setWeight(displayMg > 0 ? displayMg.toString() : '');
    setDate(item.date);
    setSelectedAddBranch(item.branch_id || "");
    
    // Parse item_type string into selectedItems tags
    setSelectedItems(expandItemTypeCodes(item.item_type || ""));
    
    setIsEditingActive(true);
    setShowAddModal(true);
  };

  // Handle Add Item
  const handleAddStock = async () => {
    console.log("[DEBUG] handleAddStock initiated. Current state:", {
      currentUser,
      selectedAddBranch,
      billNo,
      price,
      weight,
      date,
      selectedItems,
      billPrefix,
      isEditingActive,
      selectedActiveItem
    });

    const targetBranch = currentUser?.role === 'ADMIN' ? selectedAddBranch : (currentUser?.branchId || 'HQ');
    console.log("[DEBUG] resolved targetBranch:", targetBranch);
    if (!targetBranch) {
      console.warn("[DEBUG] Validation failed: targetBranch is empty.");
      toast.error("Please select a branch.");
      return;
    }

    if (!billNo || !price || !weight || !date) {
      console.warn("[DEBUG] Validation failed: one or more required fields are empty.", { billNo, price, weight, date });
      toast.error("Please fill in all fields.");
      return;
    }

    if (selectedItems.length === 0) {
      console.warn("[DEBUG] Validation failed: selectedItems list is empty.");
      toast.error("Please select at least one gold item type.");
      return;
    }

    const formatBillNo = (prefix: string | null, rawNo: string) => {
      let clean = stripBranchPrefix(rawNo).trim();
      if (prefix) {
        if (clean.toUpperCase().startsWith(prefix.toUpperCase() + " ")) {
          clean = clean.substring(prefix.length + 1).trim();
        } else if (clean.toUpperCase().startsWith(prefix.toUpperCase())) {
          clean = clean.substring(prefix.length).trim();
        }
      }
      return prefix ? `${prefix} ${clean}` : clean;
    };

    const finalBillNo = stripBranchPrefix(formatBillNo(billPrefix, billNo)).trim();
    console.log("[DEBUG] generated finalBillNo (strictly clean):", finalBillNo);

    // Duplicate numeric bill number validation within current branch
    const isChangingNumeric = !isEditingActive || !selectedActiveItem || !isSameNumericBill(selectedActiveItem.bill_no, finalBillNo);
    if (isChangingNumeric) {
      const numericPart = extractNumericBillNo(finalBillNo);
      if (numericPart) {
        const targetBranch = normalizeBranchId(selectedBranch || 'HQ');
        const duplicateItem = stockItems.find(item => {
          if (isEditingActive && item.id === selectedActiveItem?.id) return false;
          const iBranch = normalizeBranchId(item.branch_id || item.branch || '');
          if (targetBranch !== 'ALL' && iBranch && iBranch !== targetBranch) return false;
          return isSameNumericBill(item.bill_no, finalBillNo);
        });

        if (duplicateItem) {
          toast.error(`Duplicate Bill Number: Bill number ${numericPart} already exists in ${targetBranch} branch.`);
          return;
        }
      }
    }

    const rawWeightInput = parseFloat(weight) || 0;
    const finalWeightGrams = rawWeightInput >= 100 ? (rawWeightInput / 1000) : rawWeightInput;

    const newItem = {
      bill_no: finalBillNo,
      price: parseFloat(price) || 0,
      weight: finalWeightGrams,
      date: date,
      item_type: compressItemTypeString(selectedItems.map(item => item.code).join(", ")),
      status: 'Active',
      branch_id: normalizeBranchId(targetBranch)
    };
    console.log("[DEBUG] newItem payload:", newItem);

    try {
      const isEdit = isEditingActive && selectedActiveItem;
      const headers = getAuthHeaders({ 'x-branch-id': targetBranch });

      const payload = isEdit ? {
        id: selectedActiveItem.id,
        bill_no: newItem.bill_no,
        price: newItem.price,
        weight: newItem.weight,
        date: newItem.date,
        item_type: newItem.item_type,
        branch_id: newItem.branch_id
      } : newItem;

      console.log("[DEBUG] Sending stock save request to /api/stock:", { method: isEdit ? 'PUT' : 'POST', payload });
      const res = await fetch('/api/stock', {
        method: isEdit ? 'PUT' : 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        let errDesc = `Failed to save stock item (${res.status})`;
        try {
          const errData = await res.json();
          if (errData?.error) errDesc = errData.error;
        } catch {}
        throw new Error(errDesc);
      }

      toast.success(isEdit ? "Stock item updated successfully!" : "Stock item added successfully!");
      closeAddModal();
      
      // Reload
      await loadStockData();
    } catch (err: any) {
      console.error("[DEBUG] Error saving stock item:", err);
      toast.error("Error saving stock item: " + err.message);
    }
  };

  // Stock Customer operations & logic
  const getCustomerForBill = (billNo: string, branchStr?: string) => {
    if (!billNo) return null;
    const cleanBill = billNo.trim().toLowerCase();
    const cleanNorm = stripBranchPrefix(billNo).toLowerCase().replace(/[\s\-_/]+/g, '');
    const targetBranch = branchStr ? normalizeBranchId(branchStr) : null;

    const isBillMatch = (c: any) => {
      if (!c.bill_numbers) return false;
      const rawBills = c.bill_numbers.split(",").map((b: string) => b.trim().toLowerCase());
      const normBills = c.bill_numbers.split(",").map((b: string) => stripBranchPrefix(b).toLowerCase().replace(/[\s\-_/]+/g, ''));

      return rawBills.includes(cleanBill) || normBills.includes(cleanNorm);
    };

    if (targetBranch) {
      // 1. Strict Priority: Exact match on target branch
      const matchExact = (c: any) => {
        if (!isBillMatch(c)) return false;
        const cBranch = normalizeBranchId(c.branch_id || c.branch || '');
        return cBranch === targetBranch;
      };

      const foundNew = stockCustomers.find(matchExact);
      if (foundNew) return foundNew;

      const foundOld = oldStockCustomers.find(matchExact);
      if (foundOld) return foundOld;

      // 2. Fallback: Only match unassigned customer IF they don't have a conflicting branch
      const matchUnassigned = (c: any) => {
        if (!isBillMatch(c)) return false;
        const cBranch = normalizeBranchId(c.branch_id || c.branch || '');
        return !cBranch;
      };

      const unassignedNew = stockCustomers.find(matchUnassigned);
      if (unassignedNew) return unassignedNew;

      const unassignedOld = oldStockCustomers.find(matchUnassigned);
      if (unassignedOld) return unassignedOld;

      return null;
    }

    // When no target branch is specified (e.g. ALL view without item context)
    const foundInNew = stockCustomers.find(isBillMatch);
    if (foundInNew) return foundInNew;

    return oldStockCustomers.find(isBillMatch);
  };

  const handleAddBillPrefix = (prefix: string) => {
    const trimmed = custBills.trim();
    if (!trimmed) {
      setCustBills(prefix + " ");
    } else if (trimmed.endsWith(",")) {
      setCustBills(custBills + " " + prefix + " ");
    } else {
      setCustBills(custBills + ", " + prefix + " ");
    }
  };

  const openAddCustomerModal = (initialBill = "") => {
    setSelectedCustomer(null);
    setCustName("");
    setCustAddress("");
    setCustAddress2("");
    setCustTp("");
    setCustNic("");
    setCustBills(initialBill);
    setIsEditingCustomer(false);
    setShowAddCustomerModal(true);
  };

  const openEditCustomerModal = (customer: any) => {
    setSelectedCustomer(customer);
    setCustName(customer.name);
    setCustAddress(customer.address);
    setCustAddress2(customer.address_2 || "");
    setCustTp(customer.tp);
    setCustNic(customer.nic || "");
    setCustBills(customer.bill_numbers || "");
    setIsEditingCustomer(true);
    setShowAddCustomerModal(true);
  };

  const handleNameChange = (val: string) => {
    setCustName(val);
    if (!val.trim()) {
      setNameSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const matches = stockCustomers.filter(c => 
      c.name.toLowerCase().includes(val.toLowerCase())
    );
    setNameSuggestions(matches);
    setShowSuggestions(matches.length > 0);
  };

  const selectNameSuggestion = (suggestion: any) => {
    setCustName(suggestion.name);
    setCustAddress(suggestion.address);
    setCustAddress2(suggestion.address_2 || "");
    setCustTp(suggestion.tp);
    setCustNic(suggestion.nic || "");
    if (!custBills.trim()) {
      setCustBills(suggestion.bill_numbers || "");
    }
    setShowSuggestions(false);
    setNameSuggestions([]);
  };

  const handleSaveCustomer = async () => {
    if (!custName.trim() || !custAddress.trim() || !custTp.trim()) {
      toast.error("Name, Address, and Telephone are required fields.");
      return;
    }

    const targetBranch = normalizeBranchId(
      selectedStockItemForCustomerView?.branch_id ||
      selectedBranchForCustomerView ||
      (selectedBranch !== 'ALL' ? selectedBranch : '') ||
      currentUser?.branchId ||
      'HQ'
    );

    const payload = {
      name: custName.trim(),
      address: custAddress.trim(),
      address_2: custAddress2.trim() || null,
      tp: custTp.trim(),
      nic: custNic.trim() || null,
      bill_numbers: custBills.trim(),
      branch_id: targetBranch
    };

    try {
      const isEdit = isEditingCustomer && selectedCustomer?.id && !String(selectedCustomer.id).startsWith('pawn-');
      const url = isEdit ? `/api/stock-customers/${selectedCustomer.id}` : '/api/stock-customers';
      const method = isEdit ? 'PUT' : 'POST';

      const headers = getAuthHeaders({ 'x-branch-id': targetBranch });
      const res = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        let errDesc = `Failed to save customer (${res.status})`;
        try {
          const errData = await res.json();
          if (errData?.error) errDesc = errData.error;
        } catch {}
        throw new Error(errDesc);
      }

      toast.success(isEdit ? "Customer profile updated successfully!" : "Customer profile saved successfully!");
      setShowAddCustomerModal(false);
      setShowBillCustomerModal(false);
      await loadCustomerData(true);
    } catch (err: any) {
      console.error("Error saving customer profile:", err);
      toast.error("Error saving customer profile: " + err.message);
    }
  };

  // Open withdrawal dialog
  const openWithdrawModal = (item: any) => {
    setSelectedItemForWithdrawal(item);
    setWithdrawalDate(new Date().toISOString().split('T')[0]);
    setWithdrawalReason("Pawn Redeemed (Closed)");
    setWithdrawalNotes("");
    setFsInterest("");
    setIsEditingWithdrawal(false);
    setShowWithdrawModal(true);
  };

  // Open edit withdrawal dialog
  const openEditWithdrawalModal = (item: any) => {
    setSelectedItemForWithdrawal(item);
    setWithdrawalDate(item.withdrawal_date || new Date().toISOString().split('T')[0]);
    setWithdrawalReason(item.withdrawal_reason || "Pawn Redeemed (Closed)");
    const notes = item.withdrawal_notes || "";
    setWithdrawalNotes(notes);

    // Parse interest if F/S notes
    let parsedInterest = "";
    if (notes.includes("Interest: Rs.") || notes.includes("Interest:")) {
      const match = notes.match(/Interest:\s*Rs\.\s*([\d,.]+)/i) || notes.match(/Interest:\s*([\d,.]+)/i);
      if (match) parsedInterest = match[1].replace(/,/g, '');
    }
    setFsInterest(parsedInterest);

    setIsEditingWithdrawal(true);
    setShowWithdrawModal(true);
  };

  // Handle Withdrawal Submission
  const handleWithdrawStock = async () => {
    if (!selectedItemForWithdrawal) return;
    if (!withdrawalDate || !withdrawalReason) {
      toast.error("Please select a date and reason.");
      return;
    }

    const id = selectedItemForWithdrawal.id;

    // Construct final notes with F/S interest if F/S reason is selected
    let finalNotes = withdrawalNotes || '';
    if (withdrawalReason === "F/S") {
      const interestStr = fsInterest ? `F/S [Interest: Rs. ${parseFloat(fsInterest).toLocaleString('en-US', { minimumFractionDigits: 0 })}]` : 'F/S';
      if (finalNotes && !finalNotes.includes("F/S")) {
        finalNotes = `${interestStr} - ${finalNotes}`;
      } else if (!finalNotes) {
        finalNotes = interestStr;
      }
    }

    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/stock', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          id: id,
          status: 'Withdrawn',
          withdrawal_date: withdrawalDate,
          withdrawal_reason: withdrawalReason,
          withdrawal_notes: finalNotes
        })
      });

      if (!res.ok) {
        let errDesc = `Failed to withdraw item (${res.status})`;
        try {
          const errData = await res.json();
          if (errData?.error) errDesc = errData.error;
        } catch {}
        throw new Error(errDesc);
      }

      toast.success(isEditingWithdrawal ? "Withdrawal details updated successfully!" : "Item marked as Withdrawn successfully!");
      setWithdrawalNotes("");
      setFsInterest("");
      setSelectedItemForWithdrawal(null);
      setShowWithdrawModal(false);
      setIsEditingWithdrawal(false);
      
      // Reload
      await loadStockData();
    } catch (err: any) {
      console.error("[DEBUG] Error saving withdrawal:", err);
      toast.error("Error saving withdrawal: " + err.message);
    }
  };

  // Open restore modal
  const openRestoreModal = (item: any) => {
    setSelectedItemForRestore(item);
    setRestoreDate(new Date().toISOString().split('T')[0]);
    setRestoreInterest("");
    setRestoreNotes("");
    setShowRestoreModal(true);
  };

  // Handle Restore Stock Submission
  const handleRestoreStock = async () => {
    if (!selectedItemForRestore) return;
    if (currentUser?.role === 'TELLER') {
      setStockChangeModal({
        isOpen: true,
        entityType: 'STOCK',
        actionType: 'RESTORE',
        entityId: selectedItemForRestore.id || selectedItemForRestore.item_id || selectedItemForRestore.bill_no,
        referenceNo: stripBranchPrefix(selectedItemForRestore.bill_no),
        branchId: selectedItemForRestore.branch_id || selectedBranch || 'HQ',
        currentData: selectedItemForRestore,
        initialProposedData: {
          restore_date: restoreDate,
          interest_amount: restoreInterest,
          notes: restoreNotes
        }
      });
      setShowRestoreModal(false);
      return;
    }
    if (!restoreDate) {
      toast.error("Please select a restoration date.");
      return;
    }

    setIsSubmittingRestore(true);
    try {
      if (isUsingSupabase) {
        const res = await fetch('/api/stock/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: selectedItemForRestore.id,
            restoreDate,
            interestPaid: restoreInterest,
            notes: restoreNotes
          })
        });

        const result = await res.json();
        if (!res.ok || result.error) {
          throw new Error(result.error || "Failed to restore item");
        }

        toast.success(`Bill Number "${selectedItemForRestore.bill_no}" successfully restored to Active Safe Stock!`);
      } else {
        const todayStr = restoreDate || new Date().toISOString().split('T')[0];
        const interestVal = parseFloat(restoreInterest) || 0;
        const interestStr = interestVal > 0 ? `Interest Paid: Rs. ${interestVal.toLocaleString('en-US')}` : 'Interest Paid: N/A';
        const cleanNotes = (restoreNotes || '').trim();
        const restoreHistoryLine = `[RESTORED TO SAFE on ${todayStr}] ${interestStr}${cleanNotes ? ' | Notes: ' + cleanNotes : ''}`;
        const previousNotes = selectedItemForRestore.withdrawal_notes || '';
        const updatedNotes = previousNotes ? `${previousNotes}\n${restoreHistoryLine}` : restoreHistoryLine;

        const updated = stockItems.map(item => {
          if (item.id === selectedItemForRestore.id) {
            return {
              ...item,
              status: 'Active',
              withdrawal_date: null,
              withdrawal_reason: null,
              withdrawal_notes: updatedNotes
            };
          }
          return item;
        });
        setStockItems(updated);
        localStorage.setItem('local_stock_items', JSON.stringify(updated));
        toast.success(`Bill Number "${selectedItemForRestore.bill_no}" restored to Active Safe (Local Storage)!`);
      }

      setShowRestoreModal(false);
      setSelectedItemForRestore(null);
      setRestoreInterest("");
      setRestoreNotes("");
      loadStockData();
    } catch (err: any) {
      toast.error("Error restoring stock item: " + err.message);
    } finally {
      setIsSubmittingRestore(false);
    }
  };

  // Handle Delete Stock Item Permanently
  const handleDeleteStock = async (item: any) => {
    const cleanDisplayBill = stripBranchPrefix(item.bill_no);
    if (currentUser?.role === 'TELLER') {
      setStockChangeModal({
        isOpen: true,
        entityType: 'STOCK',
        actionType: 'DELETE',
        entityId: item.id || item.item_id || item.bill_no,
        referenceNo: cleanDisplayBill,
        branchId: item.branch_id || selectedBranch || 'HQ',
        currentData: item
      });
      return;
    }
    if (!window.confirm(`Are you sure you want to permanently delete Bill Number "${cleanDisplayBill}" from stock inventory? This action cannot be undone.`)) {
      return;
    }

    const isOld = stockFilter === 'OldData' || item.branch_id === 'OLD';

    try {
      if (isUsingSupabase) {
        const res = await fetch('/api/stock/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            id: item.id, 
            bill_no: item.bill_no, 
            isOld 
          })
        });
        const result = await res.json();

        if (!res.ok || result.error) {
          throw new Error(result.error || "Failed to delete item from database");
        }

        toast.success(`Bill Number "${cleanDisplayBill}" deleted successfully!`);
      } else {
        const updated = stockItems.filter(i => i.id !== item.id);
        setStockItems(updated);
        localStorage.setItem('local_stock_items', JSON.stringify(updated));
        toast.success(`Bill Number "${cleanDisplayBill}" deleted successfully (Local Storage)!`);
      }

      // Optimistically update state immediately
      setStockItems(prev => prev.filter(i => i.id !== item.id && i.bill_no !== item.bill_no));
      setOldStockItems(prev => prev.filter(i => i.id !== item.id && i.bill_no !== item.bill_no));
      
      if (isOld) {
        loadOldStockData();
      } else {
        loadStockData();
      }
    } catch (err: any) {
      toast.error("Error deleting stock item: " + err.message);
    }
  };

  const getItemPiecesCount = (itemTypeStr: string): number => {
    if (!itemTypeStr) return 1;
    const compressed = compressItemTypeString(itemTypeStr);
    if (!compressed) return 1;
    const tokens = compressed.split(',').map(t => t.trim()).filter(Boolean);
    let total = 0;
    for (const token of tokens) {
      const match = token.match(/^([A-Za-z0-9-]+?)(\d+)$/);
      if (match && match[2]) {
        total += parseInt(match[2], 10);
      } else {
        total += 1;
      }
    }
    return total > 0 ? total : 1;
  };

  const getItemName = (codeWithCount: string): string => {
    if (!codeWithCount) return "";
    if (codeWithCount.includes(",")) {
      return codeWithCount.split(",").map(t => getItemName(t.trim())).filter(Boolean).join(" + ");
    }
    if (codeWithCount === 'BLCT') return 'Biscuit (BKT)'; // Backward compatibility
    
    let is18K = false;
    let cleanCode = codeWithCount;
    if (cleanCode.toUpperCase().startsWith("18K-") || cleanCode.toUpperCase().startsWith("18C-")) {
      is18K = true;
      cleanCode = cleanCode.substring(4);
    } else if (cleanCode.toUpperCase().startsWith("18K ") || cleanCode.toUpperCase().startsWith("18C ")) {
      is18K = true;
      cleanCode = cleanCode.substring(4);
    }

    const match = cleanCode.match(/^([A-Za-z]+)(\d*)$/);
    if (match) {
      const baseCode = match[1].toUpperCase();
      const count = match[2] ? parseInt(match[2], 10) : 1;
      const found = ITEM_TYPES.find(item => item.code === baseCode);
      const baseName = found ? found.name : baseCode;
      const prefixStr = is18K ? "18K " : "";
      const fullName = `${prefixStr}${baseName}`;
      return count > 1 ? `${fullName} (${count})` : fullName;
    }
    
    const found = ITEM_TYPES.find(item => item.code === cleanCode.toUpperCase());
    const baseName = found ? found.name : cleanCode;
    const prefixStr = is18K ? "18K " : "";
    return `${prefixStr}${baseName}`;
  };

  const handleExportExcel = () => {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timestamp = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0') + ' ' +
      now.toLocaleTimeString('en-US', { hour12: true });

    const activeBranchName = branches.find(b => b.id === selectedBranch)?.name || (selectedBranch === 'ALL' ? 'All Branches' : selectedBranch);

    const csvLines: string[] = [];

    // Title & Header Information matching paper layout
    csvLines.push(`"INVENTORY ON ${timestamp}"`);
    csvLines.push(`"${activeBranchName.toUpperCase()} Branch"`);
    csvLines.push(`"Status: ${stockFilter} Stock"`);
    csvLines.push("");

    const sortedPrefixes = [...BILL_PREFIXES].sort((a, b) => b.length - a.length);
    const grouped: { [key: string]: any[] } = {};
    BILL_PREFIXES.forEach(p => { grouped[p] = []; });
    grouped["OTHERS"] = [];

    sortedStock.forEach(item => {
      const clean = (item.bill_no || "").trim().toUpperCase();
      let matched = "OTHERS";
      for (const pref of sortedPrefixes) {
        if (clean.startsWith(pref + " ") || clean === pref || (clean.startsWith(pref) && /^\d/.test(clean.substring(pref.length)))) {
          matched = pref;
          break;
        }
      }
      grouped[matched].push(item);
    });

    const activeGroups = [...BILL_PREFIXES, "OTHERS"].filter(p => grouped[p].length > 0);

    activeGroups.forEach(pref => {
      const items = grouped[pref];
      csvLines.push(`"=== SECTION: ${pref} ==="`);

      if (stockFilter === 'Withdrawn') {
        csvLines.push(`"Bill No","Branch","Appraised Value / Price","Weight","Pawning Date","Withdraw/FS Date","Reason / Status","Notes / Interest","Items"`);
      } else {
        csvLines.push(`"Bill No","Branch","Appraised Value / Price","Weight","Date","Items"`);
      }

      items.forEach(item => {
        let formattedDate = '';
        if (item.date) {
          const d = new Date(item.date);
          if (!isNaN(d.getTime())) {
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const yr = String(d.getFullYear()).slice(-2);
            formattedDate = `${day}-${month}-${yr}`;
          } else {
            formattedDate = String(item.date);
          }
        }

        const weightVal = parseFloat(item.weight) || parseFloat(item.weight_g) || parseFloat(item.weight_grams) || 0;
        const g = Math.floor(weightVal);
        const mg = Math.round((weightVal - g) * 1000);
        const formattedWeight = `${item.weight_mg || (g * 1000 + mg)} mg`;
        const itemVal = parseFloat(item.price) || parseFloat(item.appraised_value) || parseFloat(item.disbursed_amount) || parseFloat(item.amount) || 0;
        const formattedPrice = itemVal.toLocaleString();
        const branchCode = item.branch_id || item.branch || 'HQ';

        if (stockFilter === 'Withdrawn') {
          let wDate = '';
          if (item.withdrawal_date) {
            const wd = new Date(item.withdrawal_date);
            wDate = !isNaN(wd.getTime()) ? wd.toLocaleDateString('en-GB') : String(item.withdrawal_date);
          }
          const wReason = item.withdrawal_reason || '';
          const wNotes = (item.withdrawal_notes || '').replace(/"/g, '""');
          csvLines.push(`"${stripBranchPrefix(item.bill_no)}","${branchCode}","${formattedPrice}","${formattedWeight}","${formattedDate}","${wDate}","${wReason}","${wNotes}","${compressItemTypeString(item.item_type || '')}"`);
        } else {
          csvLines.push(`"${stripBranchPrefix(item.bill_no)}","${branchCode}","${formattedPrice}","${formattedWeight}","${formattedDate}","${compressItemTypeString(item.item_type || '')}"`);
        }
      });

      const secValue = items.reduce((sum, item) => sum + (parseFloat(item.price) || parseFloat(item.appraised_value) || parseFloat(item.disbursed_amount) || parseFloat(item.amount) || 0), 0);
      const secWeight = items.reduce((sum, item) => sum + (parseFloat(item.weight) || parseFloat(item.weight_g) || parseFloat(item.weight_grams) || 0), 0);
      const secG = Math.floor(secWeight);
      const secMg = Math.round((secWeight - secG) * 1000);
      const formattedSecWeight = `${Math.round(secWeight * 1000)} mg`;

      if (stockFilter === 'Withdrawn') {
        csvLines.push(`"SECTION ${pref} TOTALS","","Rs. ${secValue.toLocaleString()}","${Math.round(secWeight * 1000)} mg","Packets: ${items.length}","","","",""`);
      } else {
        csvLines.push(`"SECTION ${pref} TOTALS","","Rs. ${secValue.toLocaleString()}","${Math.round(secWeight * 1000)} mg","Packets: ${items.length}",""`);
      }
      csvLines.push(`"No of Packets = ${items.length} | Section Total Value = Rs. ${secValue.toLocaleString()} | Section Total Weight = ${formattedSecWeight}"`);
      csvLines.push("");
    });

    // Summary Totals at bottom
    const totalCount = sortedStock.length;
    const totalPieces = sortedStock.reduce((sum, item) => sum + getItemPiecesCount(item.item_type || ''), 0);
    const totalWeight = sortedStock.reduce((sum, item) => sum + (parseFloat(item.weight) || parseFloat(item.weight_g) || parseFloat(item.weight_grams) || 0), 0);
    const totalValue = sortedStock.reduce((sum, item) => sum + (parseFloat(item.price) || parseFloat(item.appraised_value) || parseFloat(item.disbursed_amount) || parseFloat(item.amount) || 0), 0);
    const totG = Math.floor(totalWeight);
    const totMg = Math.round((totalWeight - totG) * 1000);
    const formattedTotWeight = `${Math.round(totalWeight * 1000)} mg`;

    csvLines.push(`"SUMMARY TOTALS"`);
    if (stockFilter === 'Withdrawn') {
      csvLines.push(`"TOTAL LOTS: ${totalCount}","TOTAL PIECES: ${totalPieces}","Rs. ${totalValue.toLocaleString()}","${Math.round(totalWeight * 1000)} mg","","","","",""`);
    } else {
      csvLines.push(`"TOTAL LOTS: ${totalCount}","TOTAL PIECES: ${totalPieces}","Rs. ${totalValue.toLocaleString()}","${Math.round(totalWeight * 1000)} mg","",""`);
    }
    csvLines.push(`"Total Lots / Packets","${totalCount}"`);
    csvLines.push(`"Total Gold Pieces","${totalPieces}"`);
    csvLines.push(`"Total Weight","${formattedTotWeight}"`);
    csvLines.push(`"Total Value","Rs. ${totalValue.toLocaleString()}"`);

    const csvContent = csvLines.join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Vault_Stock_${activeBranchName.replace(/\s+/g, '_')}_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Excel CSV report generated successfully!");
  };

  const handleExportPDF = () => {
    const printWindow = window.open('', '_blank', 'width=1100,height=850')!;
    const now = new Date();
    const timestampStr = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0') + ' ' +
      now.toLocaleTimeString('en-US', { hour12: true });
      
    const activeBranchName = branches.find(b => b.id === selectedBranch)?.name || (selectedBranch === 'ALL' ? 'All Branches' : selectedBranch);

    const sortedPrefixes = [...BILL_PREFIXES].sort((a, b) => b.length - a.length);
    const grouped: { [key: string]: any[] } = {};
    BILL_PREFIXES.forEach(p => { grouped[p] = []; });
    grouped["OTHERS"] = [];

    sortedStock.forEach(item => {
      const clean = (item.bill_no || "").trim().toUpperCase();
      let matched = "OTHERS";
      for (const pref of sortedPrefixes) {
        if (clean.startsWith(pref + " ") || clean === pref || (clean.startsWith(pref) && /^\d/.test(clean.substring(pref.length)))) {
          matched = pref;
          break;
        }
      }
      grouped[matched].push(item);
    });

    const activeGroups = [...BILL_PREFIXES, "OTHERS"].filter(p => grouped[p].length > 0);

    const sectionsHtml = activeGroups.map(pref => {
      const items = grouped[pref];
      const rowsHtml = items.map(item => {
        let formattedDate = '';
        if (item.date) {
          const d = new Date(item.date);
          if (!isNaN(d.getTime())) {
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const yr = String(d.getFullYear()).slice(-2);
            formattedDate = `${day}-${month}-${yr}`;
          } else {
            formattedDate = String(item.date);
          }
        }

        const weightVal = parseFloat(item.weight) || parseFloat(item.weight_g) || parseFloat(item.weight_grams) || 0;
        const g = Math.floor(weightVal);
        const mg = Math.round((weightVal - g) * 1000);
        const formattedWeight = `${item.weight_mg || (g * 1000 + mg)} mg`;
        const itemVal = parseFloat(item.price) || parseFloat(item.appraised_value) || parseFloat(item.disbursed_amount) || parseFloat(item.amount) || 0;
        const formattedPrice = itemVal.toLocaleString();
        const branchCode = item.branch_id || item.branch || 'HQ';

        return `
          <tr>
            <td style="font-weight: bold; text-align: left;">${stripBranchPrefix(item.bill_no)}</td>
            <td style="text-align: center;">${branchCode}</td>
            <td style="text-align: right;">${formattedPrice}</td>
            <td style="text-align: right;">${formattedWeight}</td>
            <td style="text-align: center;">${formattedDate}</td>
            <td style="text-align: left;">${compressItemTypeString(item.item_type || '')}</td>
          </tr>
        `;
      }).join('');

      return `
        <div class="section-block">
          <table class="inventory-table">
            <thead>
              <tr>
                <th style="text-align: left; width: 20%;">Bill No</th>
                <th style="text-align: center; width: 12%;">Branch</th>
                <th style="text-align: right; width: 20%;">Appraised Value</th>
                <th style="text-align: right; width: 16%;">Weight</th>
                <th style="text-align: center; width: 16%;">Date</th>
                <th style="text-align: left; width: 16%;">Items</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
          <div class="packet-count">No of Packets = ${items.length}</div>
        </div>
      `;
    }).join('');

    const totalCount = sortedStock.length;
    const totalPieces = sortedStock.reduce((sum, item) => sum + getItemPiecesCount(item.item_type || ''), 0);
    const totalWeight = sortedStock.reduce((sum, item) => sum + (parseFloat(item.weight) || parseFloat(item.weight_g) || parseFloat(item.weight_grams) || 0), 0);
    const totalValue = sortedStock.reduce((sum, item) => sum + (parseFloat(item.price) || parseFloat(item.appraised_value) || parseFloat(item.disbursed_amount) || parseFloat(item.amount) || 0), 0);

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Inventory Report - ${activeBranchName}</title>
          <style>
            @page {
              size: A4 portrait;
              margin: 10mm 10mm 10mm 10mm;
            }
            body {
              font-family: Arial, Helvetica, sans-serif;
              font-size: 10px;
              line-height: 1.2;
              color: #000;
              margin: 0;
              padding: 0;
            }
            .header-block {
              border-bottom: 1.5px solid #000;
              padding-bottom: 6px;
              margin-bottom: 12px;
              display: flex;
              justify-content: space-between;
              align-items: flex-end;
            }
            .header-title {
              font-size: 11px;
              font-weight: bold;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            .header-branch {
              font-size: 13px;
              font-weight: bold;
              text-transform: uppercase;
              margin-top: 2px;
            }
            .columns-wrapper {
              column-count: 2;
              column-gap: 20px;
              column-fill: auto;
            }
            .section-block {
              break-inside: avoid;
              margin-bottom: 12px;
            }
            .inventory-table {
              width: 100%;
              border-collapse: collapse;
              font-size: 9.5px;
            }
            .inventory-table th {
              border-bottom: 1px solid #000;
              padding: 3px 2px;
              font-weight: bold;
              font-size: 9px;
            }
            .inventory-table td {
              padding: 2px 2px;
              font-size: 9px;
              white-space: nowrap;
            }
            .packet-count {
              font-weight: bold;
              font-size: 9.5px;
              margin-top: 4px;
              margin-bottom: 8px;
            }
            .footer-summary {
              break-before: column;
              border-top: 1.5px solid #000;
              padding-top: 8px;
              margin-top: 15px;
              font-size: 10px;
              font-weight: bold;
            }
            .checked-by {
              margin-top: 25px;
              font-weight: bold;
              font-size: 10px;
            }
            @media print {
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="header-block">
            <div>
              <div class="header-title">INVENTORY ON ${timestampStr}</div>
              <div class="header-branch">${activeBranchName.toUpperCase()} Branch</div>
            </div>
            <div style="text-align: right; font-weight: bold; font-size: 9.5px;">
              <div>Status: ${stockFilter} Stock</div>
              <div>Lots: ${totalCount} | Pieces: ${totalPieces}</div>
            </div>
          </div>

          <div class="columns-wrapper">
            ${sectionsHtml}

            <div class="section-block footer-summary">
              <div>TOTAL VAULT LOTS = ${totalCount}</div>
              <div>TOTAL GOLD PIECES = ${totalPieces}</div>
              <div>TOTAL WEIGHT = ${Math.round(totalWeight * 1000)} mg</div>
              <div>TOTAL VALUE = Rs. ${totalValue.toLocaleString()}</div>
              <div class="checked-by">Checked BY: ______________________</div>
            </div>
          </div>

          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
                window.close();
              }, 500);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // Strict Rule: Helper function to determine if a stock item has been redeemed / withdrawn
  const isItemWithdrawnOrRedeemed = (item: any): boolean => {
    if (!item) return false;
    const statusClean = (item.status || '').toString().trim().toLowerCase();
    
    // 1. If status explicitly matches any withdrawn / redeemed keyword
    const withdrawnKeywords = ['withdrawn', 'redeemed', 'closed', 'fs', 'f/s', 'pawn redeemed (closed)', 'pawn redeemed', 'settled', 'auctioned'];
    if (withdrawnKeywords.includes(statusClean)) {
      return true;
    }
    
    // 2. If status is non-empty and not 'active'
    if (statusClean !== '' && statusClean !== 'active') {
      return true;
    }
    
    // 3. If withdrawal_date exists and is valid/non-empty
    if (item.withdrawal_date && String(item.withdrawal_date).trim() !== '' && String(item.withdrawal_date).trim() !== 'null') {
      return true;
    }

    // 4. If withdrawal_reason exists and is valid/non-empty
    if (item.withdrawal_reason && String(item.withdrawal_reason).trim() !== '' && String(item.withdrawal_reason).trim() !== 'null') {
      return true;
    }

    return false;
  };

  // Filter and search stock with Advanced Filters
  const filteredStock = (stockFilter === 'OldData' ? oldStockItems : stockItems).filter(item => {
    // 1. Strict Status Filter (Prevents ANY redeemed or withdrawn item from entering Active Stock)
    if (stockFilter === 'Active') {
      if (isItemWithdrawnOrRedeemed(item)) {
        return false;
      }
    } else if (stockFilter === 'Withdrawn') {
      if (!isItemWithdrawnOrRedeemed(item)) {
        return false;
      }
    } else if (stockFilter !== 'OldData' && item.status !== stockFilter) {
      return false;
    }

    // 2. Branch Filter
    if (selectedBranch && selectedBranch !== 'ALL') {
      const canonicalSelected = normalizeBranchId(selectedBranch);
      const canonicalItemBranch = normalizeBranchId(item.branch_id || '');
      if (canonicalItemBranch !== canonicalSelected && item.branch_id !== selectedBranch) {
        return false;
      }
    }

    // 3. Reason Filter (e.g. F/S, Pawn Redeemed, etc.)
    if (filterReason && filterReason !== 'ALL') {
      const reason = item.withdrawal_reason || "";
      const notes = item.withdrawal_notes || "";
      if (filterReason === 'F/S') {
        const isFS = reason === 'F/S' || notes.toUpperCase().includes("F/S");
        if (!isFS) return false;
      } else {
        if (reason !== filterReason) return false;
      }
    }

    // 4. Prefix Filter
    if (filterPrefix && filterPrefix !== 'ALL') {
      const cleanBill = (item.bill_no || "").trim();
      if (filterPrefix === '1R-12R') {
        const isR = /^(?:[1-9]|1[0-2])R(?:\s|$)/i.test(cleanBill);
        if (!isR) return false;
      } else {
        if (!cleanBill.startsWith(filterPrefix + " ") && !cleanBill.startsWith(filterPrefix)) {
          return false;
        }
      }
    }

    // 5. Date Range Filter
    const targetDate = stockFilter === 'Withdrawn' ? (item.withdrawal_date || item.date) : item.date;
    if (startDate && targetDate < startDate) return false;
    if (endDate && targetDate > endDate) return false;

    // 6. Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchBill = (item.bill_no || "").toLowerCase().includes(q);
      const matchType = (item.item_type || "").toLowerCase().includes(q);
      const matchName = getItemName(item.item_type || "").toLowerCase().includes(q);
      const matchNotes = (item.withdrawal_notes || "").toLowerCase().includes(q);
      const matchReason = (item.withdrawal_reason || "").toLowerCase().includes(q);
      if (!matchBill && !matchType && !matchName && !matchNotes && !matchReason) return false;
    }

    return true;
  });

  // Strict sort by prefix order: A -> 1R -> 3M -> 3R -> 6R -> 12R -> 6M -> Others
  const sortedStock = sortStockItems(filteredStock);

  // Calculate dynamic statistics strictly for the displayed/filtered stock list
  const displayCount = sortedStock.length;
  const displayWeight = sortedStock.reduce((sum, item) => sum + (parseFloat(item.weight) || parseFloat(item.weight_g) || parseFloat(item.weight_grams) || 0), 0);
  const displayValue = sortedStock.reduce((sum, item) => sum + (parseFloat(item.price) || parseFloat(item.appraised_value) || parseFloat(item.disbursed_amount) || parseFloat(item.amount) || 0), 0);

  const totalActiveCount = stockItems.filter(item => !isItemWithdrawnOrRedeemed(item)).length;
  const totalOldCount = oldStockItems.length;

  return (
    <div className="space-y-6 w-full max-w-[96%] xl:max-w-[1400px] mx-auto pb-20">
      
      {/* Page Header */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">End of Day & Stock</h1>
          <p className="text-sm font-medium text-slate-500 mt-1">
            Perform daily reconciliation and manage pawning gold vault inventory.
          </p>
        </div>
        
      </div>

      {/* Tabs Menu */}
      <div className="flex bg-slate-100 p-1.5 rounded-2xl border border-slate-200/60 w-full md:w-fit flex-wrap gap-1">
        <button 
          onClick={() => setActiveTab('reconciliation')}
          className={cn(
            "px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all cursor-pointer",
            activeTab === 'reconciliation' ? "bg-white text-slate-900 shadow-md font-bold" : "text-slate-500 hover:text-slate-800"
          )}
        >
          Daily Reconciliation
        </button>
        {currentUser?.role !== 'TELLER' && (
          <button 
            onClick={() => setActiveTab('stock')}
            className={cn(
              "px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all cursor-pointer",
              activeTab === 'stock' ? "bg-white text-slate-900 shadow-md font-bold" : "text-slate-500 hover:text-slate-800"
            )}
          >
            Pawn Stock Management
          </button>
        )}
        <button 
          onClick={() => setActiveTab('matrix')}
          className={cn(
            "px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all cursor-pointer flex items-center gap-1.5",
            activeTab === 'matrix' ? "bg-emerald-600 text-white shadow-md font-bold" : "text-slate-600 hover:text-slate-900 bg-slate-200/60"
          )}
        >
          <Coins className="w-3.5 h-3.5" /> Stock Daily Matrix
        </button>
      </div>

      {/* ==========================================
          RECONCILIATION TAB VIEW
          ========================================== */}
      {activeTab === 'reconciliation' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-6 animate-in fade-in-50 duration-300">
            {/* Step 1: Physical Cash Count */}
            <div className={`bg-white rounded-xl border ${step === 1 ? 'border-emerald-500 shadow-lg shadow-emerald-500/10' : 'border-slate-200 opacity-50'} overflow-hidden`}>
              <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex gap-4 items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black ${step === 1 ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'}`}>1</div>
                <div>
                  <h2 className="font-bold text-slate-800">Physical Vault Count</h2>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-0.5">Declare all physical denominations</p>
                </div>
              </div>
              
              {step === 1 && (
                <div className="p-6">
                  <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                    {[5000, 1000, 500, 100, 50, 20].map((denom) => (
                      <div key={denom} className="flex justify-between items-center gap-4">
                        <span className="font-black text-slate-700 w-16 text-right">Rs. {denom}</span>
                        <span className="text-slate-300 font-black">X</span>
                        <Input 
                          type="number" 
                          className="w-24 text-center font-bold" 
                          value={cashCount[denom]} 
                          onChange={e => setCashCount({...cashCount, [denom]: e.target.value})} 
                        />
                        <span className="font-black text-emerald-600 w-24 text-right">
                          = Rs. {(denom * (cashCount[denom] || 0)).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-8 pt-6 border-t border-slate-100 flex justify-between items-center">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Total Counted</p>
                      <p className="text-3xl font-black text-slate-900">Rs. {actualTotal.toLocaleString()}</p>
                    </div>
                    <Button onClick={() => setStep(2)} className="bg-emerald-600 hover:bg-emerald-700 font-bold px-8">Link to System Ledger</Button>
                  </div>
                </div>
              )}
            </div>

            {/* Step 2: System Reconciliation */}
            <div className={`bg-white rounded-xl border ${step === 2 ? 'border-blue-500 shadow-lg shadow-blue-500/10' : 'border-slate-200 opacity-50'} overflow-hidden`}>
              <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex gap-4 items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black ${step === 2 ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'}`}>2</div>
                <div>
                  <h2 className="font-bold text-slate-800">System Reconciliation</h2>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-0.5">Match physical count with digital ledger</p>
                </div>
              </div>
              
              {step === 2 && (
                <div className="p-6">
                  <div className="grid grid-cols-2 gap-6 bg-slate-50 p-6 rounded-xl border border-slate-200">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Expected By Ledger</p>
                      <p className="text-2xl font-black text-slate-800">Rs. {systemExpected.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Physical Reality</p>
                      <p className="text-2xl font-black text-blue-600">Rs. {actualTotal.toLocaleString()}</p>
                    </div>
                  </div>

                  <div className={`mt-6 p-6 rounded-xl flex items-center gap-4 border ${isBalanced ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
                    {isBalanced ? <CheckCircle2 className="w-8 h-8"/> : <ShieldAlert className="w-8 h-8 text-rose-600" />}
                    <div>
                      <h3 className="font-black text-lg">{isBalanced ? "Perfectly Balanced Vault" : "Discrepancy Detected!"}</h3>
                      <p className="font-medium text-sm mt-1">
                        {isBalanced 
                          ? "Your physical cash matches the digital ledger identically." 
                          : `Variance of Rs. ${Math.abs(difference).toLocaleString()}. You must authorize an override to close the branch.`
                        }
                      </p>
                    </div>
                  </div>

                  <div className="mt-8 flex justify-between">
                    <Button variant="outline" onClick={() => setStep(1)} className="font-bold">Back to Recount</Button>
                    <Button onClick={() => setStep(3)} className={`${isBalanced ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'} font-bold px-8`}>
                      {isBalanced ? "Proceed to Lock" : "Force Override & Proceed"}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Step 3: Final Freeze */}
            <div className={`bg-white rounded-xl border ${step === 3 ? 'border-slate-800 shadow-xl shadow-slate-900/10' : 'border-slate-200 opacity-50'} overflow-hidden`}>
              <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex gap-4 items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black ${step === 3 ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-500'}`}>3</div>
                <div>
                  <h2 className="font-bold text-slate-800">Final System Freeze</h2>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-0.5">Irreversible daily closure</p>
                </div>
              </div>
              {step === 3 && (
                <div className="p-8 text-center space-y-6">
                  <div className="mx-auto w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center">
                    <Lock className="w-10 h-10 text-amber-600" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-slate-800 tracking-tight">Lock Branch Operations</h3>
                    <p className="text-slate-500 font-medium mt-2 max-w-sm mx-auto">
                      Executing this command will forever archive today's ledger and prevent any further transactions until tomorrow.
                    </p>
                  </div>
                  <Button className="w-full bg-slate-900 hover:bg-slate-800 font-bold h-12 text-lg shadow-lg shadow-slate-900/20" onClick={() => alert('Branch successfully archived and closed for the day.')}>
                    AUTHORIZE END-OF-DAY ARCHIVE
                  </Button>
                  <Button variant="link" onClick={() => setStep(2)} className="font-bold text-slate-400">Cancel & Return</Button>
                </div>
              )}
            </div>
          </div>

          {/* Right Sidebar */}
          <div className="space-y-6">
            <div className="bg-slate-900 rounded-xl p-6 text-white shadow-xl shadow-slate-900/20">
              <h3 className="font-black text-lg mb-2">EOD Timeline</h3>
              <div className="flex flex-col gap-4 mt-6">
                <div className="flex gap-4">
                  <div className="mt-1"><CheckCircle2 className="w-5 h-5 text-emerald-400"/></div>
                  <div><p className="font-bold">Pending Transfers</p><p className="text-xs font-bold uppercase tracking-widest text-slate-400">All cleared</p></div>
                </div>
                <div className="flex gap-4 border-t border-slate-800 pt-4">
                  <div className="mt-1"><AlertCircle className="w-5 h-5 text-amber-400"/></div>
                  <div><p className="font-bold">Journal Balance</p><p className="text-xs text-amber-400 font-bold uppercase tracking-widest">Awaiting execution</p></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================
          STOCK MANAGEMENT TAB VIEW
          ========================================== */}
      {activeTab === 'stock' && currentUser?.role !== 'TELLER' && (
        <div className="space-y-6 animate-in fade-in-50 duration-300">
          
          {/* Inventory Stat Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
                <Package className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Vault Stock Count</p>
                <p className="text-2xl font-black text-slate-800 mt-0.5">{displayCount} Items</p>
                <p className="text-[10px] text-slate-500 font-bold mt-0.5">
                  {stockFilter === 'OldData' ? "Historical active vault items" : "Currently stored in inventory"}
                </p>
              </div>
            </div>

            <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600">
                <Scale className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Total Weight</p>
                <p className="text-2xl font-black text-slate-800 mt-0.5">{Math.round(displayWeight * 1000).toLocaleString()} mg</p>
                <p className="text-[10px] text-slate-500 font-bold mt-0.5">Cumulative gold weight</p>
              </div>
            </div>

            <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
                <Coins className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Appraised Value</p>
                <p className="text-2xl font-black text-slate-800 mt-0.5">Rs. {displayValue.toLocaleString()}</p>
                <p className="text-[10px] text-slate-500 font-bold mt-0.5">Cumulative value of stock</p>
              </div>
            </div>
          </div>

          {/* Filtering, Search & Add Section */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 lg:p-5 flex flex-wrap items-center justify-between gap-3 shadow-xs">
            
            {/* Left Controls: Filter Toggles & Branch Selector */}
            <div className="flex flex-wrap items-center gap-2.5 w-full xl:w-auto">
              {/* Filter Toggle Buttons */}
              <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 w-full sm:w-fit shrink-0 gap-1">
                <button 
                  onClick={() => setStockFilter('Active')}
                  className={cn(
                    "flex-1 sm:flex-initial px-4 lg:px-5 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer whitespace-nowrap",
                    stockFilter === 'Active' ? "bg-white text-slate-900 shadow-sm font-bold" : "text-slate-500 hover:text-slate-800"
                  )}
                >
                  Active Vault Stock ({totalActiveCount})
                </button>
                <button 
                  onClick={() => setStockFilter('Withdrawn')}
                  className={cn(
                    "flex-1 sm:flex-initial px-4 lg:px-5 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer whitespace-nowrap",
                    stockFilter === 'Withdrawn' ? "bg-white text-slate-900 shadow-sm font-bold" : "text-slate-500 hover:text-slate-800"
                  )}
                >
                  Withdrawn ({stockItems.filter(item => isItemWithdrawnOrRedeemed(item)).length})
                </button>
                <button 
                  onClick={() => setStockFilter('OldData')}
                  className={cn(
                    "flex-1 sm:flex-initial px-4 lg:px-5 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap",
                    stockFilter === 'OldData' 
                      ? "bg-amber-500 text-white shadow-sm shadow-amber-500/20 font-bold" 
                      : "text-amber-800 bg-amber-50/80 hover:bg-amber-100/80 border border-amber-200/50"
                  )}
                >
                  <span>Old Data</span>
                  <span className={cn(
                    "px-1.5 py-0.5 rounded text-[9px] font-black",
                    stockFilter === 'OldData' ? "bg-amber-600 text-white" : "bg-amber-200/80 text-amber-900"
                  )}>
                    {totalOldCount}
                  </span>
                </button>
              </div>

              {/* Branch Selector */}
              <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl border border-slate-200 w-full sm:w-auto shrink-0">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 pl-2 whitespace-nowrap">Branch:</span>
                <Select value={selectedBranch} onValueChange={(val) => val && setSelectedBranch(val)}>
                  <SelectTrigger className="h-8 w-44 bg-white border-slate-200 rounded-lg font-bold text-xs shadow-sm">
                    <SelectValue placeholder="All Branches" />
                  </SelectTrigger>
                  <SelectContent className="glass max-h-48 overflow-y-auto">
                    <SelectItem value="ALL" className="font-semibold text-xs">All Branches</SelectItem>
                    {branches.map((b: any) => (
                      <SelectItem key={b.id} value={b.id} className="font-semibold text-xs">{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Right Controls: Search Input & Action Buttons */}
            <div className="flex flex-wrap items-center gap-2.5 w-full xl:w-auto justify-start xl:justify-end">
              <div className="relative w-full sm:w-56 lg:w-64 shrink-0">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input 
                  placeholder="Search by Bill No or Item Code..." 
                  className="pl-9 h-9 rounded-xl bg-slate-50 border-slate-200 font-medium text-xs"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button 
                  onClick={handleExportExcel}
                  variant="outline"
                  className="border-slate-200 hover:bg-slate-50 text-slate-700 font-black uppercase tracking-widest text-[9px] h-9 px-3.5 rounded-xl flex items-center gap-1.5 cursor-pointer shadow-sm shrink-0 whitespace-nowrap"
                  title="Export Filtered Stock to Excel"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" /> Excel
                </Button>
                
                <Button 
                  onClick={handleExportPDF}
                  variant="outline"
                  className="border-slate-200 hover:bg-slate-50 text-slate-700 font-black uppercase tracking-widest text-[9px] h-9 px-3.5 rounded-xl flex items-center gap-1.5 cursor-pointer shadow-sm shrink-0 whitespace-nowrap"
                  title="Print PDF Report"
                >
                  <Printer className="w-3.5 h-3.5 text-blue-600" /> Print
                </Button>

                <Button 
                  onClick={togglePrinterProtocol}
                  variant="outline"
                  className="border-slate-200 hover:bg-slate-50 text-slate-700 font-black uppercase tracking-widest text-[9px] h-9 px-3.5 rounded-xl flex items-center gap-1.5 cursor-pointer shadow-sm shrink-0 whitespace-nowrap"
                  title="Toggle between ESC/POS Thermal Receipt and TSPL Barcode Sticker format"
                >
                  <Tag className="w-3.5 h-3.5 text-indigo-600" />
                  {printerProtocol === 'ESCPOS' ? 'Mode: Thermal Receipt' : 'Mode: Sticker (TSPL)'}
                </Button>

                {/* Normal Cache-First Reload with Auditor Force Expire check button */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button 
                    onClick={async () => {
                      if (forceExpireChecked && (currentUser?.role === 'AUDITOR' || currentUser?.role === 'ADMIN')) {
                        await handleForceRefreshInventory(selectedBranch || 'ALL');
                      } else {
                        loadStockData();
                        fetchDailyMatrix();
                      }
                    }}
                    variant="outline"
                    className={cn(
                      "border-slate-200 hover:bg-slate-50 text-slate-700 font-black uppercase tracking-widest text-[9px] h-9 px-3 rounded-xl flex items-center gap-1.5 cursor-pointer shadow-sm transition-all whitespace-nowrap",
                      forceExpireChecked && "border-amber-400 bg-amber-50 text-amber-900"
                    )}
                    title={forceExpireChecked ? "Reload and force-expire Redis cache" : "Reload inventory using cache by default"}
                  >
                    {loadingStock || isForceRefreshing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" />
                    ) : (
                      <RotateCcw className="w-3.5 h-3.5 text-slate-600" />
                    )}
                    Reload
                  </Button>

                  {/* Auditor / Admin Check Button to reset/force expire Redis cache */}
                  {(currentUser?.role === 'AUDITOR' || currentUser?.role === 'ADMIN') && (
                    <label 
                      className={cn(
                        "flex items-center gap-1.5 cursor-pointer border px-2.5 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all select-none h-9 shadow-xs whitespace-nowrap",
                        forceExpireChecked 
                          ? "bg-amber-500 border-amber-600 text-white shadow-amber-500/20" 
                          : "bg-amber-50/80 hover:bg-amber-100 border-amber-200/80 text-amber-800"
                      )}
                      title="Auditor check button to force-expire Redis cache on reload"
                    >
                      <input
                        type="checkbox"
                        checked={forceExpireChecked}
                        onChange={(e) => setForceExpireChecked(e.target.checked)}
                        className="w-3.5 h-3.5 accent-amber-600 rounded cursor-pointer"
                      />
                      <span>Force Expire Cache</span>
                    </label>
                  )}
                </div>

                <Button 
                  onClick={() => setShowAddModal(true)}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest text-[10px] h-9 px-5 rounded-xl flex items-center gap-1.5 cursor-pointer shadow-lg shadow-blue-500/20 shrink-0 whitespace-nowrap"
                >
                  <PlusCircle className="w-4 h-4" /> Add Stock Item
                </Button>
              </div>
            </div>
          </div>

          {/* ADVANCED FILTERING TOOLBAR BAR */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
              <span className="font-black text-[10px] uppercase tracking-widest text-slate-400 flex items-center gap-1.5 shrink-0">
                <Filter className="w-3.5 h-3.5 text-blue-600" /> Data Filters:
              </span>

              {/* Filter by Reason / Category */}
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-[10px] text-slate-500 uppercase">Reason:</span>
                <Select value={filterReason} onValueChange={(val) => val && setFilterReason(val)}>
                  <SelectTrigger className="h-8 w-44 bg-slate-50 border-slate-200 rounded-lg font-bold text-xs">
                    <SelectValue placeholder="All Reasons" />
                  </SelectTrigger>
                  <SelectContent className="glass">
                    <SelectItem value="ALL" className="font-semibold text-xs">All Reasons / Statuses</SelectItem>
                    <SelectItem value="F/S" className="font-black text-xs text-blue-700">F/S (Full Settlement)</SelectItem>
                    <SelectItem value="Pawn Redeemed (Closed)" className="font-semibold text-xs">Pawn Redeemed (Closed)</SelectItem>
                    <SelectItem value="Pawn Auctioned" className="font-semibold text-xs">Pawn Auctioned</SelectItem>
                    <SelectItem value="Stock Adjustment" className="font-semibold text-xs">Stock Adjustment</SelectItem>
                    <SelectItem value="Other" className="font-semibold text-xs">Other Reason</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Filter by Bill Prefix */}
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-[10px] text-slate-500 uppercase">Prefix:</span>
                <Select value={filterPrefix} onValueChange={(val) => val && setFilterPrefix(val)}>
                  <SelectTrigger className="h-8 w-32 bg-slate-50 border-slate-200 rounded-lg font-bold text-xs">
                    <SelectValue placeholder="All Prefixes" />
                  </SelectTrigger>
                  <SelectContent className="glass">
                    <SelectItem value="ALL" className="font-semibold text-xs">All Prefixes</SelectItem>
                    <SelectItem value="1R-12R" className="font-bold text-xs text-blue-700">1R-12R</SelectItem>
                    {BILL_PREFIXES.map(pref => (
                      <SelectItem key={pref} value={pref} className="font-bold text-xs">{pref}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Date Range: Start Date & End Date */}
              <div className="flex items-center gap-2">
                <span className="font-bold text-[10px] text-slate-500 uppercase">Date:</span>
                <Input 
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="h-8 w-32 bg-slate-50 border-slate-200 rounded-lg font-bold text-xs px-2"
                  title="Start Date"
                />
                <span className="text-slate-400 font-bold">to</span>
                <Input 
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="h-8 w-32 bg-slate-50 border-slate-200 rounded-lg font-bold text-xs px-2"
                  title="End Date"
                />
              </div>
            </div>

            <div className="flex items-center gap-3 w-full lg:w-auto justify-between lg:justify-end">
              {/* Filtered Item Counter Badge */}
              <div className="bg-blue-50 text-blue-800 border border-blue-200/60 font-black px-3 py-1 rounded-xl text-xs flex items-center gap-1.5">
                <span>Showing {filteredStock.length} items</span>
                {(filterReason !== 'ALL' || filterPrefix !== 'ALL' || startDate || endDate || searchQuery) && (
                  <span className="bg-blue-600 text-white px-1.5 py-0.2 rounded-full text-[9px]">Filtered</span>
                )}
              </div>

              {/* Clear Filters Button */}
              {(filterReason !== 'ALL' || filterPrefix !== 'ALL' || startDate || endDate || searchQuery) && (
                <Button 
                  onClick={() => {
                    setFilterReason('ALL');
                    setFilterPrefix('ALL');
                    setStartDate('');
                    setEndDate('');
                    setSearchQuery('');
                  }}
                  variant="ghost"
                  size="sm"
                  className="h-8 text-rose-600 hover:text-rose-700 hover:bg-rose-50 font-bold text-xs gap-1"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Clear Filters
                </Button>
              )}
            </div>
          </div>

          {/* Stock Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden min-h-[300px]">
            {(stockFilter === 'OldData' ? loadingOldStock : loadingStock) ? (
              <div className="flex flex-col items-center justify-center h-80 gap-3 text-slate-400">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                <span className="font-bold text-xs uppercase tracking-widest">Fetching Vault Items...</span>
              </div>
            ) : filteredStock.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-80 gap-4 text-center">
                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center border border-slate-100">
                  <Package className="w-8 h-8 text-slate-300" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800">No stock items found</h3>
                  <p className="text-xs text-slate-400 mt-1 max-w-xs font-semibold">
                    {searchQuery ? "No items matching your search query in this category." : "Add physical gold pawn items to display them in this ledger."}
                  </p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto w-full">
                <Table>
                  <TableHeader className="bg-slate-50/50">
                    <TableRow>
                      <TableHead className="px-6 py-4 font-black text-[10px] uppercase tracking-widest text-slate-400">Bill No</TableHead>
                      {currentUser?.role === 'ADMIN' && (
                        <TableHead className="px-6 py-4 font-black text-[10px] uppercase tracking-widest text-slate-400">Branch</TableHead>
                      )}
                      <TableHead className="px-6 py-4 font-black text-[10px] uppercase tracking-widest text-slate-400">Item Name</TableHead>
                      <TableHead className="px-6 py-4 font-black text-[10px] uppercase tracking-widest text-slate-400">Weight (mg)</TableHead>
                      <TableHead className="px-6 py-4 font-black text-[10px] uppercase tracking-widest text-slate-400 text-right">Appraised Value</TableHead>
                      <TableHead className="px-6 py-4 font-black text-[10px] uppercase tracking-widest text-slate-400">Pawning Date</TableHead>
                      {stockFilter === 'Withdrawn' ? (
                        <>
                          <TableHead className="px-6 py-4 font-black text-[10px] uppercase tracking-widest text-slate-400">Withdraw Date</TableHead>
                          <TableHead className="px-6 py-4 font-black text-[10px] uppercase tracking-widest text-slate-400 max-w-xs">Reason / Notes</TableHead>
                          <TableHead className="px-6 py-4 text-right" />
                        </>
                      ) : (
                        <TableHead className="px-6 py-4 text-right" />
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody className="divide-y divide-slate-100">
                    {sortedStock.map((item) => (
                      <TableRow key={item.id} className="group hover:bg-slate-50/50 transition-colors">
                        <TableCell className="px-6 py-4">
                          <button 
                            onClick={() => {
                              setSelectedBillForCustomerView(stripBranchPrefix(item.bill_no));
                              setSelectedStockItemForCustomerView(item);
                              setSelectedBranchForCustomerView(item.branch_id || item.branch || (selectedBranch !== 'ALL' ? selectedBranch : null) || currentUser?.branchId || null);
                              setShowBillCustomerModal(true);
                            }}
                            className="font-black text-slate-800 text-sm hover:text-blue-600 underline decoration-dotted transition-colors text-left flex items-center gap-1.5 cursor-pointer flex-wrap"
                            title="Click to view details & interest"
                          >
                            <span>{stripBranchPrefix(item.bill_no)}</span>
                            {getCustomerForBill(item.bill_no, item.branch_id || item.branch) && (
                              <span className="w-1.5 h-1.5 bg-blue-600 rounded-full inline-block" title="Customer Linked" />
                            )}
                            {(() => {
                              const itemBranch = normalizeBranchId(item.branch_id || item.branch || currentUser?.branchId || '');
                              const bInts = stockInterests.filter(i => {
                                // 1. Direct item ID match if available
                                if (i.item_id && item.id && i.item_id === item.id) {
                                  return true;
                                }
                                // 2. Bill number match
                                const billMatches = (i.bill_no || '').trim().toUpperCase() === (item.bill_no || '').trim().toUpperCase();
                                if (!billMatches) return false;

                                // If this interest record was explicitly assigned to another item, do not cross-apply
                                if (i.item_id && item.id && i.item_id !== item.id) {
                                  return false;
                                }

                                // 3. Strict branch isolation: interest branch MUST match this stock item's branch
                                const iBranch = normalizeBranchId(i.branch || '');
                                if (iBranch && itemBranch) {
                                  return iBranch === itemBranch;
                                }
                                return false;
                              });
                              const sumInt = bInts.reduce((sum, x) => sum + (parseFloat(x.interest_value) || 0), 0);
                              if (sumInt > 0) {
                                return (
                                  <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 font-black text-[9px] px-1.5 py-0.5 rounded-full" title={`Recorded Interest: LKR ${sumInt.toLocaleString()} (${itemBranch || 'Branch'})`}>
                                    +LKR {sumInt.toLocaleString()}
                                  </span>
                                );
                              }
                              return null;
                            })()}
                          </button>
                        </TableCell>
                        {currentUser?.role === 'ADMIN' && (
                          <TableCell className="px-6 py-4 font-bold text-slate-700 text-xs">
                            <span className="bg-blue-50 text-blue-800 border border-blue-200/50 font-black px-2 py-0.5 rounded-md text-[9px] uppercase tracking-wide">
                              {item.branch_id || 'HQ'}
                            </span>
                          </TableCell>
                        )}
                        <TableCell className="px-6 py-4 font-bold text-slate-700 text-xs">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {compressItemTypeString(item.item_type || "").split(", ").map((code: string) => (
                              <span key={code} className="bg-slate-100 text-slate-800 border border-slate-200/50 font-black px-2 py-0.5 rounded-md text-[9px] uppercase tracking-wide">
                                {code}
                              </span>
                            ))}
                            <span className="text-slate-700 font-bold ml-1 whitespace-normal break-words">
                              {compressItemTypeString(item.item_type || "").split(", ").map((code: string) => getItemName(code)).join(" + ")}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="px-6 py-4 font-bold text-slate-600 text-sm">
                          {item.weight_mg ? `${item.weight_mg} mg` : `${Math.round(parseFloat(item.weight || 0) * 1000)} mg`}
                        </TableCell>
                        <TableCell className="px-6 py-4 font-black text-slate-800 text-sm text-right text-gradient">
                          Rs. {(parseFloat(item.price) || 0).toLocaleString()}
                        </TableCell>
                        <TableCell className="px-6 py-4 font-bold text-slate-500 text-xs uppercase tracking-wider">
                          {new Date(item.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </TableCell>
                        {stockFilter === 'OldData' ? (
                          <TableCell className="px-6 py-4 text-right">
                            <span className="bg-amber-100 text-amber-900 border border-amber-300 font-black px-2.5 py-1 rounded-lg text-[10px] uppercase tracking-wider shadow-2xs">
                              OLD DATA
                            </span>
                          </TableCell>
                        ) : item.status === 'Withdrawn' ? (
                          <>
                            <TableCell className="px-6 py-4 font-bold text-rose-600 text-xs uppercase tracking-wider">
                              {new Date(item.withdrawal_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </TableCell>
                            <TableCell className="px-6 py-4 max-w-xs">
                              <p className="text-xs font-black text-rose-800 uppercase tracking-widest">{item.withdrawal_reason}</p>
                              {item.withdrawal_notes && (
                                <p className="text-[10px] text-slate-500 font-semibold mt-0.5 truncate">{item.withdrawal_notes}</p>
                              )}
                            </TableCell>
                            <TableCell className="px-6 py-4 text-right flex items-center justify-end gap-1.5">
                              <Button 
                                onClick={() => openRestoreModal(item)}
                                size="sm"
                                className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200/60 font-black text-[9px] uppercase tracking-widest h-8 px-3 rounded-xl transition-all cursor-pointer flex items-center gap-1 shadow-2xs"
                                title="Restore item back to Active Safe Stock"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                Restore
                              </Button>
                              <Button 
                                onClick={() => handlePrintLabel(item)}
                                disabled={printingLabelId === (item.id || item.bill_no)}
                                size="sm"
                                variant="outline"
                                className="border-blue-200 hover:bg-blue-50 text-blue-700 font-black text-[9px] uppercase tracking-widest h-8 px-2.5 rounded-xl transition-all cursor-pointer flex items-center gap-1 shadow-2xs"
                                title="Print Bluetooth Sticker Label"
                              >
                                {printingLabelId === (item.id || item.bill_no) ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <QrCode className="w-3.5 h-3.5 text-blue-600" />
                                )}
                                Print Label
                              </Button>
                              <Button 
                                onClick={() => openEditWithdrawalModal(item)}
                                size="sm"
                                variant="outline"
                                className="border-slate-200 hover:bg-slate-50 text-slate-600 font-black text-[9px] uppercase tracking-widest h-8 px-3 rounded-xl transition-all cursor-pointer"
                              >
                                Edit
                              </Button>
                              <Button 
                                onClick={() => handleDeleteStock(item)}
                                size="sm"
                                variant="ghost"
                                className="h-8 px-2 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-xl transition-all cursor-pointer"
                                title="Delete Record"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </TableCell>
                          </>
                        ) : (
                          <TableCell className="px-6 py-4 text-right flex items-center justify-end gap-1.5">
                            <Button 
                              onClick={() => handlePrintLabel(item)}
                              disabled={printingLabelId === (item.id || item.bill_no)}
                              size="sm"
                              variant="outline"
                              className="border-blue-200 hover:bg-blue-50 text-blue-700 font-black text-[9px] uppercase tracking-widest h-8 px-2.5 rounded-xl transition-all cursor-pointer flex items-center gap-1 shadow-2xs"
                              title="Print Bluetooth Sticker Label"
                            >
                              {printingLabelId === (item.id || item.bill_no) ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <QrCode className="w-3.5 h-3.5 text-blue-600" />
                              )}
                              Print Label
                            </Button>
                            <Button 
                              onClick={() => openEditActiveModal(item)}
                              size="sm"
                              variant="outline"
                              className="border-slate-200 hover:bg-slate-50 text-slate-600 font-black text-[9px] uppercase tracking-widest h-8 px-3 rounded-xl transition-all cursor-pointer"
                            >
                              Edit
                            </Button>
                            <Button 
                              onClick={() => openWithdrawModal(item)}
                              size="sm"
                              className="bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200/50 font-black text-[9px] uppercase tracking-widest h-8 px-3 rounded-xl transition-all cursor-pointer"
                            >
                              Withdraw
                            </Button>
                            <Button 
                              onClick={() => handleDeleteStock(item)}
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-xl transition-all cursor-pointer"
                              title="Delete Record"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==========================================
          STOCK DAILY SUMMARY & MATRIX TAB VIEW
          ========================================== */}
      {activeTab === 'matrix' && (
        <div className="space-y-6 animate-in fade-in-50 duration-300">

          {/* Date & Branch Controls bar */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-wrap items-center justify-between gap-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">Select Date</label>
                <input
                  type="date"
                  value={matrixDate}
                  onChange={(e) => setMatrixDate(e.target.value)}
                  className="h-10 px-3 border border-slate-200 rounded-xl font-bold text-slate-800 text-xs bg-white cursor-pointer"
                />
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">Select Branch</label>
                <select
                  value={matrixBranch}
                  onChange={(e) => setMatrixBranch(e.target.value)}
                  className="h-10 px-3 border border-slate-200 rounded-xl font-bold text-slate-800 text-xs bg-white cursor-pointer"
                >
                  <option value="ALL">All Branches</option>
                  <option value="DMT">Dematagoda (DMT)</option>
                  <option value="KIR">Kiribathgoda (KIR)</option>
                  <option value="BRL">Borella (BRL)</option>
                  <option value="DHW">Dehiwala (DHW)</option>
                  <option value="HMG">Homagama (HMG)</option>
                  <option value="KDW">Kadawatha (KDW)</option>
                  <option value="KOT">Kotikawatta (KOT)</option>
                  <option value="KTW">Kottawa (KTW)</option>
                  <option value="PND">Panadura (PND)</option>
                  <option value="W2">Wattala 2 (W2)</option>
                  <option value="W3">Wattala 3 (W3)</option>
                  <option value="W4">Wattala 4 (W4)</option>
                  <option value="KHT">Kahathuduwa (KHT)</option>
                  <option value="HQ">Head Office (HQ)</option>
                </select>
              </div>

              {/* Category Filter Buttons */}
              <div>
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">Category Filter</label>
                <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 flex-wrap gap-1">
                  {['ALL', 'FS', 'INTEREST', 'RECEIPT', 'LOAN', 'REDEEM'].map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setMatrixCategoryFilter(cat)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer",
                        matrixCategoryFilter === cat ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                      )}
                    >
                      {cat === 'FS' ? 'F / S' : cat === 'INTEREST' ? 'I (Interest)' : cat === 'RECEIPT' ? 'R (Receipt)' : cat}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Normal Cache-First Reload with Auditor Force Expire check button */}
              <Button
                onClick={async () => {
                  if (forceExpireChecked && (currentUser?.role === 'AUDITOR' || currentUser?.role === 'ADMIN')) {
                    await handleForceRefreshInventory(matrixBranch, matrixDate);
                  } else {
                    fetchDailyMatrix(matrixDate, matrixBranch);
                  }
                }}
                variant="outline"
                className={cn(
                  "h-10 rounded-xl font-bold border-slate-200 text-slate-700 hover:bg-slate-50 gap-2 cursor-pointer shadow-sm transition-all",
                  forceExpireChecked && "border-amber-400 bg-amber-50 text-amber-900"
                )}
                title={forceExpireChecked ? "Reload and force-expire Redis cache" : "Reload inventory using cache by default"}
              >
                {loadingMatrix || isForceRefreshing ? (
                  <Loader2 className="w-4 h-4 animate-spin text-amber-600" />
                ) : (
                  <RotateCcw className="w-4 h-4 text-slate-600" />
                )}
                Reload
              </Button>

              {/* Auditor / Admin Check Button to reset/force expire Redis cache */}
              {(currentUser?.role === 'AUDITOR' || currentUser?.role === 'ADMIN') && (
                <label 
                  className={cn(
                    "flex items-center gap-1.5 cursor-pointer border px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all select-none h-10 shadow-xs",
                    forceExpireChecked 
                      ? "bg-amber-500 border-amber-600 text-white shadow-amber-500/20" 
                      : "bg-amber-50/80 hover:bg-amber-100 border-amber-200/80 text-amber-800"
                  )}
                  title="Auditor check button to force-expire Redis cache on reload"
                >
                  <input
                    type="checkbox"
                    checked={forceExpireChecked}
                    onChange={(e) => setForceExpireChecked(e.target.checked)}
                    className="w-3.5 h-3.5 accent-amber-600 rounded cursor-pointer"
                  />
                  <span>Force Expire Cache</span>
                </label>
              )}
            </div>
          </div>

          {/* Daily KPI Summary Cards */}
          {matrixResponse?.summary && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-purple-50/70 border border-purple-200 rounded-2xl p-4 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-wider text-purple-700">F / S Charges</p>
                <p className="text-xl font-black text-purple-950 mt-1">LKR {matrixResponse.summary.total_fs.toLocaleString()}</p>
                <p className="text-[10px] text-purple-600 font-bold mt-0.5">{matrixResponse.data.fs_items.length} Entries</p>
              </div>

              <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-4 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-wider text-emerald-700">Interest (I)</p>
                <p className="text-xl font-black text-emerald-950 mt-1">LKR {matrixResponse.summary.total_interest.toLocaleString()}</p>
                <p className="text-[10px] text-emerald-600 font-bold mt-0.5">{matrixResponse.data.interest_items.length} Entries</p>
              </div>

              <div className="bg-blue-50/70 border border-blue-200 rounded-2xl p-4 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-wider text-blue-700">Receipts (R)</p>
                <p className="text-xl font-black text-blue-950 mt-1">LKR {matrixResponse.summary.total_receipts.toLocaleString()}</p>
                <p className="text-[10px] text-blue-600 font-bold mt-0.5">{matrixResponse.data.receipt_items.length} Entries</p>
              </div>

              <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-4 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-wider text-amber-700">Loans Issued</p>
                <p className="text-xl font-black text-amber-950 mt-1">LKR {matrixResponse.summary.total_loans.toLocaleString()}</p>
                <p className="text-[10px] text-amber-600 font-bold mt-0.5">{matrixResponse.data.loan_items.length} Items</p>
              </div>

              <div className="bg-rose-50/70 border border-rose-200 rounded-2xl p-4 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-wider text-rose-700">Redeemed Stock</p>
                <p className="text-xl font-black text-rose-950 mt-1">LKR {matrixResponse.summary.total_redeems.toLocaleString()}</p>
                <p className="text-[10px] text-rose-600 font-bold mt-0.5">{matrixResponse.data.redeem_items.length} Items</p>
              </div>
            </div>
          )}

          {/* Categorized Matrix Tables */}
          {(() => {
            if (loadingMatrix) {
              return (
                <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-blue-600" />
                  <p className="font-bold text-xs uppercase tracking-wider">Loading Daily Matrix Data...</p>
                </div>
              );
            }

            const categories = [
              { key: 'FS', title: 'F / S (Form & Stamp Fees)', items: matrixResponse?.data?.fs_items || [], badgeBg: 'bg-purple-100 text-purple-800' },
              { key: 'INTEREST', title: 'I (Interest Entries)', items: matrixResponse?.data?.interest_items || [], badgeBg: 'bg-emerald-100 text-emerald-800' },
              { key: 'RECEIPT', title: 'R (Receipts & Cash Received)', items: matrixResponse?.data?.receipt_items || [], badgeBg: 'bg-blue-100 text-blue-800' },
              { key: 'LOAN', title: 'Loans Issued (New Active Stock)', items: matrixResponse?.data?.loan_items || [], badgeBg: 'bg-amber-100 text-amber-800' },
              { key: 'REDEEM', title: 'Redeemed Stock (Closed Pawns)', items: matrixResponse?.data?.redeem_items || [], badgeBg: 'bg-rose-100 text-rose-800' }
            ];

            const filteredCategories = categories.filter(c => matrixCategoryFilter === 'ALL' || c.key === matrixCategoryFilter);

            return (
              <div className="space-y-6">
                {filteredCategories.map((cat) => (
                  <div key={cat.key} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                    <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className={cn("text-[10px] font-black px-2.5 py-1 rounded-md uppercase tracking-wider", cat.badgeBg)}>
                          {cat.key}
                        </span>
                        <h3 className="font-black text-slate-800 text-sm">{cat.title}</h3>
                        <span className="text-xs font-bold text-slate-400">({cat.items.length})</span>
                      </div>
                      <span className="text-xs font-black text-slate-700">
                        Subtotal: LKR {cat.items.reduce((s: number, x: any) => s + (x.amount || 0), 0).toLocaleString()}
                      </span>
                    </div>

                    {cat.items.length === 0 ? (
                      <div className="p-6 text-center text-xs font-semibold text-slate-400 italic">
                        No transactions recorded under {cat.key} for date {matrixDate}.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs font-semibold text-slate-600">
                          <thead className="bg-slate-50/50 border-b border-slate-100 text-[10px] font-black uppercase tracking-wider text-slate-400">
                            <tr>
                              <th className="px-6 py-3">Bill No</th>
                              <th className="px-6 py-3">Date</th>
                              <th className="px-6 py-3">Branch</th>
                              <th className="px-6 py-3">Amount (Rs.)</th>
                              <th className="px-6 py-3">Details / Notes</th>
                              <th className="px-6 py-3 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-bold">
                            {cat.items.map((row: any, idx: number) => (
                              <tr key={row.id || idx} className="hover:bg-slate-50/60 transition-colors">
                                <td className="px-6 py-3.5 text-slate-900 font-black">{row.bill_no}</td>
                                <td className="px-6 py-3.5 text-slate-500">{row.date}</td>
                                <td className="px-6 py-3.5">
                                  <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[10px] font-black border border-slate-200">
                                    {row.branch || 'DMT'}
                                  </span>
                                </td>
                                <td className="px-6 py-3.5 text-slate-900 font-black">LKR {Number(row.amount || 0).toLocaleString()}</td>
                                <td className="px-6 py-3.5 text-slate-500 text-[11px]">{row.notes || row.remarks || row.reason || row.item_type || '-'}</td>
                                <td className="px-6 py-3.5 text-right space-x-1">
                                  <button
                                    onClick={() => openEditMatrixItem(row)}
                                    className="p-1.5 hover:bg-blue-50 text-slate-400 hover:text-blue-600 rounded-lg transition-colors cursor-pointer"
                                    title="Edit Row"
                                  >
                                    <Edit className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => openDeleteMatrixItem(row)}
                                    className="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition-colors cursor-pointer"
                                    title="Delete Row"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })()}

        </div>
      )}

      {/* ==========================================
          DIALOG MODALS
          ========================================== */}

      {/* MODAL: ADD STOCK ITEM */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="sm:max-w-[580px] glass p-0 rounded-[2rem] border-white/40 max-h-[90vh] flex flex-col overflow-hidden">
          <div className="h-2 bg-blue-600 shrink-0" />
          <div className="p-6 pb-2 shrink-0">
            <DialogHeader>
              <DialogTitle className="text-2xl font-black tracking-tighter flex items-center gap-3 text-slate-900">
                <div className="h-10 w-10 bg-blue-50 rounded-xl flex items-center justify-center border border-blue-100 text-blue-600">
                  <Package className="h-5 w-5" />
                </div>
                {isEditingActive ? "Edit Vault Stock Item" : "Add Physical Vault Stock"}
              </DialogTitle>
              <DialogDescription className="font-medium text-slate-500 text-sm">
                {isEditingActive 
                  ? "Modify the record of pawn gold items stored in physical vault storage."
                  : "Declare a physical gold pawn asset and insert it into active vault stock logs."}
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-2 pb-36 space-y-5">
            <div className="grid gap-5 pb-4">
              
              {/* Branch Selection (Visible ONLY to Admin) */}
              {currentUser?.role === 'ADMIN' && (
                <div className="grid gap-2">
                  <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Target Branch Location</Label>
                  <Select onValueChange={(val) => val && setSelectedAddBranch(val)} value={selectedAddBranch}>
                    <SelectTrigger className="h-11 bg-white/50 border-slate-200 rounded-xl font-bold text-sm">
                      <SelectValue placeholder="Select Branch" />
                    </SelectTrigger>
                    <SelectContent className="glass max-h-48 overflow-y-auto">
                      {branches.map(b => (
                        <SelectItem key={b.id} value={b.id} className="font-semibold text-sm">
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Bill Number */}
              <div className="grid gap-2">
                <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Bill Number (Bill No)</Label>
                
                {/* Prefix selection buttons */}
                <div className="flex flex-wrap gap-1.5 mb-1">
                  {BILL_PREFIXES.map(pref => {
                    const isSelected = billPrefix === pref;
                    return (
                      <button
                        key={pref}
                        type="button"
                        onClick={() => handlePrefixClick(pref)}
                        className={cn(
                          "px-2.5 py-1 text-[11px] font-black rounded-lg border transition-all duration-150 active:scale-95 cursor-pointer",
                          isSelected
                            ? "bg-blue-600 border-blue-600 text-white shadow-sm shadow-blue-600/10"
                            : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 hover:border-slate-300"
                        )}
                      >
                        {pref}
                      </button>
                    );
                  })}
                </div>

                <div className="relative">
                  {billPrefix && (
                    <span className="absolute left-3 top-3 text-slate-400 font-black text-xs bg-slate-100 px-2 py-1 rounded border border-slate-200/50 pointer-events-none select-none">
                      {billPrefix}
                    </span>
                  )}
                  <Input 
                    value={billNo} 
                    onChange={e => setBillNo(e.target.value)} 
                    placeholder="Enter bill number (e.g. 31582)" 
                    className={cn(
                      "h-11 border-slate-200 rounded-xl font-bold",
                      billPrefix ? (billPrefix.length > 2 ? "pl-16" : "pl-12") : "",
                      (() => {
                        const numPart = extractNumericBillNo(billNo);
                        const isChanging = !isEditingActive || !selectedActiveItem || !isSameNumericBill(selectedActiveItem.bill_no, billNo);
                        return isChanging && numPart && stockItems.some(item => 
                          (!isEditingActive || item.id !== selectedActiveItem?.id) &&
                          isSameNumericBill(item.bill_no, billNo)
                        ) ? "border-rose-500 focus:ring-rose-500" : "";
                      })()
                    )}
                  />
                </div>
                {(() => {
                  const isChanging = !isEditingActive || !selectedActiveItem || !isSameNumericBill(selectedActiveItem.bill_no, billNo);
                  if (!isChanging) return null;
                  const numPart = extractNumericBillNo(billNo);
                  if (!numPart) return null;
                  const duplicateItem = stockItems.find(item => 
                    (!isEditingActive || item.id !== selectedActiveItem?.id) &&
                    isSameNumericBill(item.bill_no, billNo)
                  );
                  if (duplicateItem) {
                    return (
                      <p className="text-rose-600 font-bold text-xs flex items-center gap-1 mt-1">
                        <AlertCircle className="w-3.5 h-3.5" /> Duplicate Bill Number: Bill number {numPart} already exists in the system.
                      </p>
                    );
                  }
                  return null;
                })()}
              </div>

              {/* Date */}
              <div className="grid gap-2">
                <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Pawning Date</Label>
                <Input 
                  type="date"
                  value={date} 
                  onChange={e => setDate(e.target.value)} 
                  className="h-11 border-slate-200 rounded-xl font-bold" 
                />
              </div>
              {/* Price & Weight Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Appraised Value (Rs.)</Label>
                  <Input 
                    type="number"
                    step="0.01"
                    value={price} 
                    onChange={e => setPrice(e.target.value)} 
                    placeholder="125000" 
                    className="h-11 border-slate-200 rounded-xl font-bold" 
                  />
                </div>
                <div className="grid gap-2">
                  <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Gross Weight (mg)</Label>
                  <Input 
                    type="number"
                    step="1"
                    value={weight} 
                    onChange={e => setWeight(e.target.value)} 
                    placeholder="8500" 
                    className="h-11 border-slate-200 rounded-xl font-bold" 
                  />
                </div>
              </div>

              {/* Pawned Gold Item Categories (Multi-Select Tag Input) */}
              <div className="grid gap-2 relative">
                <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Pawned Gold Item Categories</Label>
                
                {/* Search Input, Quantity & 18C Toggle */}
                <div className="flex flex-wrap sm:flex-nowrap gap-2 relative items-center">
                  <div className="relative flex-1 min-w-[180px]">
                    <Input 
                      type="text"
                      value={itemSearch} 
                      onChange={e => {
                        setItemSearch(e.target.value);
                        setIsDropdownOpen(true);
                      }}
                      onFocus={() => setIsDropdownOpen(true)}
                      onBlur={() => setIsDropdownOpen(false)}
                      placeholder="Search and select gold items (e.g. Ring, Pendant)..." 
                      className="h-11 border-slate-200 rounded-xl font-bold pr-10 text-sm bg-white" 
                    />
                    <div className="absolute right-3 top-3.5 pointer-events-none text-slate-400">
                      <Search className="h-4 w-4" />
                    </div>
                  </div>

                  {/* Quantity Input */}
                  <div className="relative w-20 shrink-0">
                    <Input 
                      type="number"
                      min="1"
                      value={itemQuantity}
                      onChange={e => setItemQuantity(parseInt(e.target.value) || 1)}
                      className="h-11 border-slate-200 rounded-xl font-bold text-center text-sm bg-white" 
                      title="Quantity (e.g. 5 Rings)"
                    />
                  </div>

                  {/* 18 K Checkbox Toggle Button */}
                  <button
                    type="button"
                    onClick={() => setIs18K(!is18K)}
                    className={cn(
                      "h-11 px-3.5 rounded-xl font-black text-xs border transition-all flex items-center gap-1.5 shrink-0 cursor-pointer select-none",
                      is18K 
                        ? "bg-amber-500 border-amber-600 text-white shadow-sm shadow-amber-500/20" 
                        : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                    )}
                    title="Toggle 18 Karat Gold Category"
                  >
                    <input 
                      type="checkbox" 
                      checked={is18K} 
                      onChange={() => {}} 
                      className="w-3.5 h-3.5 accent-amber-600 pointer-events-none"
                    />
                    <span>18 K</span>
                  </button>
                </div>

                {/* Dropdown */}
                {isDropdownOpen && (
                  <div className="absolute left-0 top-[70px] z-50 w-full bg-white border border-slate-200 rounded-xl shadow-xl max-h-56 overflow-y-auto animate-in fade-in-50 slide-in-from-top-1 duration-150">
                    {ITEM_TYPES.filter(it => 
                      it.code.toLowerCase().includes(itemSearch.toLowerCase()) || 
                      it.name.toLowerCase().includes(itemSearch.toLowerCase())
                    ).length === 0 ? (
                      <div className="px-4 py-3 text-xs font-bold text-slate-400 text-center">No matching items</div>
                    ) : (
                      ITEM_TYPES.filter(it => 
                        it.code.toLowerCase().includes(itemSearch.toLowerCase()) || 
                        it.name.toLowerCase().includes(itemSearch.toLowerCase())
                      ).map(it => {
                        const targetCheckCode = is18K ? `18K-${it.code}` : it.code;
                        const isSelected = selectedItems.some(item => item.code === targetCheckCode || item.code === it.code);
                        return (
                          <button
                            key={it.code}
                            type="button"
                            className="w-full text-left px-4 py-3 hover:bg-slate-50 font-semibold text-sm transition-colors flex items-center justify-between text-slate-700 cursor-pointer border-b border-slate-100 last:border-0"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              handleSelectCode(it.code);
                            }}
                          >
                            <span className="flex items-center gap-2">
                              {is18K && <span className="bg-amber-100 text-amber-900 border border-amber-300 font-black px-1.5 py-0.5 rounded text-[10px]">18K</span>}
                              {it.name}
                            </span>
                            {isSelected && <CheckCircle className="h-4 w-4 text-blue-600 shrink-0" />}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}

                {/* Selected Tags Display (Grouped by Code with Quantity) */}
                {selectedItems.length > 0 && (() => {
                  const groupedMap: { [code: string]: { code: string; count: number; items: any[] } } = {};
                  const groupOrder: string[] = [];

                  selectedItems.forEach(item => {
                    const c = item.code;
                    if (!groupedMap[c]) {
                      groupedMap[c] = { code: c, count: 0, items: [] };
                      groupOrder.push(c);
                    }
                    groupedMap[c].count += 1;
                    groupedMap[c].items.push(item);
                  });

                  return (
                    <div className="flex flex-wrap gap-2 mt-2 p-3 bg-slate-50 border border-slate-200/60 rounded-xl">
                      {groupOrder.map(codeGroup => {
                        const group = groupedMap[codeGroup];
                        const isItem18K = group.code.toUpperCase().startsWith("18K-") || group.code.toUpperCase().startsWith("18C-");
                        const rawCode = isItem18K ? group.code.substring(4) : group.code;
                        const found = ITEM_TYPES.find(it => it.code === rawCode);
                        const baseName = found ? found.name : group.code;
                        const displayName = (isItem18K ? "18K " : "") + baseName + (group.count > 1 ? ` ${group.count}` : "");

                        return (
                          <div 
                            key={group.code}
                            className={cn(
                              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm border select-none",
                              isItem18K 
                                ? "bg-amber-50 text-amber-900 border-amber-200/70"
                                : "bg-blue-50 text-blue-800 border-blue-200/50"
                            )}
                          >
                            <span>{displayName}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedItems(selectedItems.filter(item => item.code !== group.code));
                              }}
                              className={cn(
                                "p-0.5 rounded transition-colors cursor-pointer",
                                isItem18K ? "text-amber-600 hover:bg-amber-100" : "text-blue-500 hover:bg-blue-100 text-blue-700"
                              )}
                              title={`Remove ${displayName}`}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>

          <div className="p-6 bg-slate-50/50 border-t border-slate-100 flex justify-end gap-3 shrink-0">
            <Button variant="outline" onClick={closeAddModal} className="rounded-xl font-bold">Cancel</Button>
            <Button 
              onClick={handleAddStock} 
              className="bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest text-[10px] h-10 px-6 rounded-xl shadow-lg shadow-blue-600/10 cursor-pointer"
            >
              {isEditingActive ? "Save Changes" : "Insert to Vault"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* MODAL: WITHDRAWAL / RELEASE */}
      <Dialog open={showWithdrawModal} onOpenChange={setShowWithdrawModal}>
        <DialogContent className="sm:max-w-[450px] glass p-0 rounded-[2rem] border-white/40 max-h-[90vh] flex flex-col overflow-hidden">
          <div className="h-2 bg-rose-600 shrink-0" />
          <div className="p-6 pb-2 shrink-0">
            <DialogHeader>
              <DialogTitle className="text-2xl font-black tracking-tighter flex items-center gap-3 text-slate-900">
                <div className="h-10 w-10 bg-rose-50 rounded-xl flex items-center justify-center border border-rose-100 text-rose-600">
                  <ArrowUpRight className="h-5 w-5" />
                </div>
                {isEditingWithdrawal ? "Edit Withdrawal Details" : "Release Pawn Item"}
              </DialogTitle>
              <DialogDescription className="font-medium text-slate-500 text-sm">
                {isEditingWithdrawal 
                  ? "Modify the withdrawal date, reason, or comments recorded for this stock item." 
                  : "Record the withdrawal and closure of pawn gold assets from physical vault storage."}
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-2 space-y-5">
            {selectedItemForWithdrawal && (
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/60 grid grid-cols-2 gap-x-4 gap-y-2 text-xs font-bold text-slate-600">
                <div>Bill No: <span className="text-slate-900 font-black">{selectedItemForWithdrawal.bill_no}</span></div>
                <div>Item: <span className="text-slate-900 font-black">{compressItemTypeString(selectedItemForWithdrawal.item_type || "")}</span></div>
                <div>Weight: <span className="text-slate-900 font-black">{selectedItemForWithdrawal.weight_mg ? `${selectedItemForWithdrawal.weight_mg} mg` : `${Math.round(parseFloat(selectedItemForWithdrawal.weight || 0) * 1000)} mg`}</span></div>
                <div>Value: <span className="text-slate-900 font-black">Rs. {selectedItemForWithdrawal.price.toLocaleString()}</span></div>
              </div>
            )}

            <div className="grid gap-5 pb-4">
              
              {/* Reason (Select Dropdown) */}
              <div className="grid gap-2">
                <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Withdrawal Reason / Status</Label>
                <Select onValueChange={(val) => val && setWithdrawalReason(val)} value={withdrawalReason}>
                  <SelectTrigger className="h-11 bg-white/50 border-slate-200 rounded-xl font-bold text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="glass">
                    <SelectItem value="Pawn Redeemed (Closed)" className="font-semibold text-sm">Pawn Redeemed (Closed)</SelectItem>
                    <SelectItem value="F/S" className="font-black text-sm text-blue-700">F/S (Full Settlement)</SelectItem>
                    <SelectItem value="Pawn Auctioned" className="font-semibold text-sm">Pawn Auctioned</SelectItem>
                    <SelectItem value="Stock Adjustment" className="font-semibold text-sm">Stock Adjustment</SelectItem>
                    <SelectItem value="Other" className="font-semibold text-sm">Other Reason</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* F/S Interest Input Field (Shown when F/S is selected) */}
              {withdrawalReason === "F/S" && (
                <div className="grid gap-2 bg-blue-50/70 p-4 rounded-xl border border-blue-200/80">
                  <Label className="font-black text-[10px] uppercase tracking-widest text-blue-800 flex items-center gap-1.5">
                    <Calculator className="w-3.5 h-3.5 text-blue-600" /> F/S Interest / I Amount (LKR)
                  </Label>
                  <Input 
                    type="number"
                    step="0.01"
                    placeholder="E.g. 1500" 
                    value={fsInterest} 
                    onChange={e => setFsInterest(e.target.value)} 
                    className="h-11 border-blue-300 bg-white rounded-xl font-bold text-sm text-slate-900 focus:ring-2 focus:ring-blue-500" 
                  />
                  <p className="text-[10px] font-semibold text-blue-600/80">
                    This interest amount will be saved into the ledger record for F/S settlement.
                  </p>
                </div>
              )}

              {/* Withdrawal Date */}
              <div className="grid gap-2">
                <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">
                  {withdrawalReason === "F/S" ? "F/S Settlement Date" : "Withdrawal Date"}
                </Label>
                <Input 
                  type="date"
                  value={withdrawalDate} 
                  onChange={e => setWithdrawalDate(e.target.value)} 
                  className="h-11 border-slate-200 rounded-xl font-bold" 
                />
              </div>

              {/* Notes */}
              <div className="grid gap-2">
                <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Notes</Label>
                <Input 
                  value={withdrawalNotes} 
                  onChange={e => setWithdrawalNotes(e.target.value)} 
                  placeholder={withdrawalReason === "F/S" ? "E.g. Full settlement completed." : "E.g. Closed ticket. Gold handed back to customer."} 
                  className="h-11 border-slate-200 rounded-xl font-bold" 
                />
              </div>
            </div>
          </div>

          <div className="p-6 bg-slate-50/50 border-t border-slate-100 flex justify-end gap-3 shrink-0">
            <Button variant="outline" onClick={() => setShowWithdrawModal(false)} className="rounded-xl font-bold">Cancel</Button>
             <Button 
              onClick={handleWithdrawStock} 
              className="bg-rose-600 hover:bg-rose-700 text-white font-black uppercase tracking-widest text-[10px] h-10 px-6 rounded-xl shadow-lg shadow-rose-600/10 cursor-pointer"
            >
              {isEditingWithdrawal ? "Save Changes" : "Release Gold Asset"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* MODAL: RESTORE ITEM TO ACTIVE SAFE */}
      <Dialog open={showRestoreModal} onOpenChange={setShowRestoreModal}>
        <DialogContent className="sm:max-w-[480px] glass p-0 rounded-[2rem] border-white/40 max-h-[90vh] flex flex-col overflow-hidden">
          <div className="h-2 bg-emerald-600 shrink-0" />
          <div className="p-6 pb-2 shrink-0">
            <DialogHeader>
              <DialogTitle className="text-2xl font-black tracking-tighter flex items-center gap-3 text-slate-900">
                <div className="h-10 w-10 bg-emerald-50 rounded-xl flex items-center justify-center border border-emerald-100 text-emerald-600">
                  <RotateCcw className="h-5 w-5" />
                </div>
                Restore to Active Safe
              </DialogTitle>
              <DialogDescription className="font-medium text-slate-500 text-sm">
                Return a previously withdrawn or forfeited (F/S) item back into the active branch safe inventory after interest payment.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-2 space-y-4">
            {selectedItemForRestore && (
              <div className="bg-emerald-50/70 p-4 rounded-xl border border-emerald-200/80 grid grid-cols-2 gap-x-4 gap-y-2 text-xs font-bold text-slate-700">
                <div>Bill No: <span className="text-emerald-900 font-black">{selectedItemForRestore.bill_no}</span></div>
                <div>Branch: <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-[10px] font-black">{selectedItemForRestore.branch_id || 'HQ'}</span></div>
                <div>Item: <span className="text-slate-900 font-black">{compressItemTypeString(selectedItemForRestore.item_type || "")}</span></div>
                <div>Appraised Value: <span className="text-slate-900 font-black">Rs. {(parseFloat(selectedItemForRestore.price) || 0).toLocaleString()}</span></div>
                {selectedItemForRestore.withdrawal_reason && (
                  <div className="col-span-2 pt-1 border-t border-emerald-200/60 text-[11px]">
                    Current Status: <span className="text-rose-700 font-black uppercase">{selectedItemForRestore.withdrawal_reason}</span>
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-4 pb-4">
              {/* Interest Amount Paid (LKR) */}
              <div className="grid gap-2">
                <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                  <Coins className="w-3.5 h-3.5 text-emerald-600" /> Interest Paid by Customer (Rs.)
                </Label>
                <Input 
                  type="number"
                  step="0.01"
                  placeholder="E.g. 2500" 
                  value={restoreInterest} 
                  onChange={e => setRestoreInterest(e.target.value)} 
                  className="h-11 border-slate-200 rounded-xl font-bold text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500" 
                />
                <p className="text-[10px] font-semibold text-slate-400">
                  Enter the interest amount collected from the customer to clear the overdue status.
                </p>
              </div>

              {/* Restore Date */}
              <div className="grid gap-2">
                <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" /> Date Returned to Branch Safe
                </Label>
                <Input 
                  type="date"
                  value={restoreDate} 
                  onChange={e => setRestoreDate(e.target.value)} 
                  className="h-11 border-slate-200 rounded-xl font-bold text-sm" 
                />
              </div>

              {/* Notes / Reason */}
              <div className="grid gap-2">
                <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Notes</Label>
                <Input 
                  value={restoreNotes} 
                  onChange={e => setRestoreNotes(e.target.value)} 
                  placeholder="E.g. Customer paid overdue interest. Item moved back from central vault." 
                  className="h-11 border-slate-200 rounded-xl font-bold text-sm" 
                />
              </div>
            </div>
          </div>

          <div className="p-6 bg-slate-50/50 border-t border-slate-100 flex justify-end gap-3 shrink-0">
            <Button variant="outline" onClick={() => setShowRestoreModal(false)} className="rounded-xl font-bold">Cancel</Button>
            <Button 
              onClick={handleRestoreStock} 
              disabled={isSubmittingRestore}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase tracking-widest text-[10px] h-10 px-6 rounded-xl shadow-lg shadow-emerald-600/10 cursor-pointer flex items-center gap-2"
            >
              {isSubmittingRestore ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              Confirm Restore to Safe
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* MODAL: BILL CUSTOMER INFO */}
      <Dialog open={showBillCustomerModal} onOpenChange={setShowBillCustomerModal}>
        <DialogContent className="sm:max-w-[420px] bg-white border border-slate-200 shadow-2xl p-0 overflow-hidden rounded-[2.5rem]">
          <div className="h-2 bg-blue-600" />
          <div className="p-8">
            <DialogHeader>
              <DialogTitle className="text-xl font-black tracking-tighter text-slate-900">
                Pawn Bill Details
              </DialogTitle>
              <DialogDescription className="font-semibold text-slate-400 text-xs mt-1 flex items-center gap-2">
                <span>Customer association for Bill No: <span className="text-slate-700 font-black">{stripBranchPrefix(selectedBillForCustomerView)}</span></span>
                {selectedBranchForCustomerView && (
                  <span className="bg-blue-50 text-blue-800 border border-blue-200/50 font-black px-2 py-0.5 rounded-md text-[9px] uppercase tracking-wide">
                    {normalizeBranchId(selectedBranchForCustomerView)}
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>

            {/* Hidden file input for uploading item picture */}
            <input 
              ref={billImageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleBillImageUpload}
            />

            <div className="mt-6 space-y-4">
              {(() => {
                if (!selectedBillForCustomerView) return null;
                const cust = getCustomerForBill(selectedBillForCustomerView, selectedBranchForCustomerView || undefined);
                const currentBillImage = billImages[selectedBillForCustomerView];

                if (cust) {
                  return (
                    <div className="space-y-4">
                      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/50 space-y-3 font-semibold text-xs text-slate-600">
                        <div>
                          <span className="text-[10px] uppercase font-black tracking-wider text-slate-400 block mb-1">Customer Name</span>
                          <span className="text-sm font-black text-slate-900">{cust.name}</span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase font-black tracking-wider text-slate-400 block mb-1">Telephone (TP)</span>
                          <span className="text-slate-900 font-bold">{cust.tp}</span>
                        </div>
                        {cust.nic && (
                          <div>
                            <span className="text-[10px] uppercase font-black tracking-wider text-slate-400 block mb-1">NIC Number</span>
                            <span className="text-slate-900 font-bold">{cust.nic}</span>
                          </div>
                        )}
                        <div>
                          <span className="text-[10px] uppercase font-black tracking-wider text-slate-400 block mb-1">Address</span>
                          <span className="text-slate-800 font-bold block">{cust.address}</span>
                          {cust.address_2 && (
                            <span className="text-slate-400 block mt-1">{cust.address_2}</span>
                          )}
                        </div>
                      </div>

                      {/* Item Image Attached Card */}
                      {currentBillImage && (
                        <div className="rounded-2xl overflow-hidden border border-slate-200 bg-slate-50 shadow-sm">
                          <div className="relative h-36 w-full overflow-hidden bg-slate-100 flex items-center justify-center group">
                            <img 
                              src={currentBillImage} 
                              alt={`Item for ${selectedBillForCustomerView}`} 
                              className="w-full h-full object-cover cursor-pointer transition-transform duration-300 group-hover:scale-105"
                              onClick={() => setShowImagePreviewModal(true)}
                            />
                            <div 
                              onClick={() => setShowImagePreviewModal(true)}
                              className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer text-white font-bold text-xs gap-1.5"
                            >
                              <Search className="w-3.5 h-3.5" /> View Photo
                            </div>
                          </div>
                          <div className="px-3 py-2 bg-white flex items-center justify-between border-t border-slate-100">
                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider flex items-center gap-1">
                              <ImageIcon className="w-3 h-3 text-amber-600" /> Item Photo Attached
                            </span>
                            <div className="flex items-center gap-2">
                              <button 
                                type="button"
                                onClick={() => billImageInputRef.current?.click()}
                                className="text-[10px] font-black text-blue-600 hover:text-blue-800 transition-colors cursor-pointer"
                              >
                                Change
                              </button>
                              <button 
                                type="button"
                                onClick={() => selectedBillForCustomerView && handleRemoveBillImage(selectedBillForCustomerView)}
                                className="text-[10px] font-black text-rose-500 hover:text-rose-700 transition-colors cursor-pointer"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap justify-end gap-2 pt-2">
                        <Button 
                          onClick={() => {
                            openAddInterestModal(
                              selectedBillForCustomerView, 
                              selectedStockItemForCustomerView?.branch_id || selectedBranchForCustomerView || undefined,
                              selectedStockItemForCustomerView?.id
                            );
                          }}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase tracking-widest text-[9px] h-9 px-3.5 rounded-xl shadow-md flex items-center justify-center cursor-pointer transition-all active:scale-95 gap-1.5"
                        >
                          <Percent className="w-3.5 h-3.5" /> Add Interest
                        </Button>
                        <Button 
                          onClick={() => {
                            if (currentBillImage) {
                              setShowImagePreviewModal(true);
                            } else {
                              billImageInputRef.current?.click();
                            }
                          }}
                          disabled={isUploadingImage}
                          className="bg-amber-600 hover:bg-amber-700 text-white font-black uppercase tracking-widest text-[9px] h-9 px-3.5 rounded-xl shadow-md flex items-center justify-center cursor-pointer transition-all active:scale-95 gap-1.5"
                          title="Upload or view picture of the item"
                        >
                          {isUploadingImage ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <ImageIcon className="w-3.5 h-3.5" />
                          )}
                          Image
                        </Button>
                        <Button 
                          onClick={() => {
                            openEditCustomerModal(cust);
                            setShowBillCustomerModal(false);
                          }}
                          variant="outline"
                          className="rounded-xl font-bold border-slate-200 hover:bg-slate-50 text-slate-700 cursor-pointer px-3.5 h-9 flex items-center gap-1.5 text-xs"
                        >
                          <Edit className="w-3.5 h-3.5 text-blue-600" /> Edit Profile
                        </Button>
                        <Button 
                          onClick={() => setShowBillCustomerModal(false)}
                          className="rounded-xl font-bold bg-slate-950 hover:bg-slate-900 text-white cursor-pointer px-4 h-9 text-xs"
                        >
                          Close Details
                        </Button>
                      </div>

                      {/* Recorded Interest Section */}
                      {(() => {
                        const targetBranch = normalizeBranchId(
                          selectedStockItemForCustomerView?.branch_id ||
                          selectedBranchForCustomerView || 
                          (selectedBranch !== 'ALL' ? selectedBranch : '') || 
                          currentUser?.branchId || 
                          ''
                        );
                        const currentItemId = selectedStockItemForCustomerView?.id;

                        const billInterests = stockInterests.filter(i => {
                          // 1. Direct item ID match
                          if (i.item_id && currentItemId && i.item_id === currentItemId) {
                            return true;
                          }
                          // 2. Bill number match
                          const billMatches = (i.bill_no || '').trim().toUpperCase() === (selectedBillForCustomerView || '').trim().toUpperCase();
                          if (!billMatches) return false;

                          // If this interest record belongs to another item ID, do not cross-apply
                          if (i.item_id && currentItemId && i.item_id !== currentItemId) {
                            return false;
                          }

                          // 3. Strict branch isolation
                          const iBranch = normalizeBranchId(i.branch || '');
                          if (iBranch && targetBranch) {
                            return iBranch === targetBranch;
                          }
                          return false;
                        });
                        const totalBillInterest = billInterests.reduce((sum, item) => sum + (parseFloat(item.interest_value) || 0), 0);
                        return (
                          <div className="mt-4 pt-4 border-t border-slate-200/60 space-y-2.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] uppercase font-black tracking-wider text-slate-500 flex items-center gap-1">
                                <Coins className="w-3.5 h-3.5 text-emerald-600" /> Recorded Interest Entries ({billInterests.length})
                              </span>
                              {totalBillInterest > 0 && (
                                <span className="text-xs font-black text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                                  Total: LKR {totalBillInterest.toLocaleString()}
                                </span>
                              )}
                            </div>

                            {billInterests.length === 0 ? (
                              <p className="text-[11px] text-slate-400 font-semibold italic py-1">No interest added yet for this bill.</p>
                            ) : (
                              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                                {billInterests.map((item, idx) => (
                                  <div key={item.id || idx} className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 shadow-sm">
                                    <div className="flex items-center gap-2">
                                      <span className="bg-emerald-100 text-emerald-800 text-[10px] font-black px-1.5 py-0.5 rounded">
                                        {item.branch || 'DMT'}
                                      </span>
                                      <span className="text-slate-500 font-semibold text-[11px]">{item.date}</span>
                                      <span className="text-slate-900 font-black">LKR {Number(item.interest_value || 0).toLocaleString()}</span>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteInterest(item.id)}
                                      className="text-slate-400 hover:text-rose-600 p-1 transition-colors cursor-pointer"
                                      title="Remove Interest Entry"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                } else {
                  return (
                    <div className="text-center py-6 space-y-4">
                      <div className="w-12 h-12 bg-slate-50 rounded-full border border-slate-100 flex items-center justify-center mx-auto">
                        <Users className="w-6 h-6 text-slate-300" />
                      </div>
                      <div>
                        <p className="text-xs font-black text-slate-700 uppercase tracking-wide">
                          {selectedBillForCustomerView?.includes('35153') ? 'Customer / NIC Not Linked (Legacy Vault Entry)' : 'No Customer Profile Linked'}
                        </p>
                        <p className="text-[11px] text-slate-400 font-semibold mt-1">
                          {selectedBillForCustomerView?.includes('35153')
                            ? 'Reference 12R 35153 is an active legacy vault book record without a digital customer mapping. Please verify physical bill book to link customer details.'
                            : 'There is no customer details registered under this bill number.'}
                        </p>
                      </div>

                      {/* Item Image Attached Card */}
                      {currentBillImage && (
                        <div className="rounded-2xl overflow-hidden border border-slate-200 bg-slate-50 shadow-sm text-left">
                          <div className="relative h-36 w-full overflow-hidden bg-slate-100 flex items-center justify-center group">
                            <img 
                              src={currentBillImage} 
                              alt={`Item for ${selectedBillForCustomerView}`} 
                              className="w-full h-full object-cover cursor-pointer transition-transform duration-300 group-hover:scale-105"
                              onClick={() => setShowImagePreviewModal(true)}
                            />
                            <div 
                              onClick={() => setShowImagePreviewModal(true)}
                              className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer text-white font-bold text-xs gap-1.5"
                            >
                              <Search className="w-3.5 h-3.5" /> View Photo
                            </div>
                          </div>
                          <div className="px-3 py-2 bg-white flex items-center justify-between border-t border-slate-100">
                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider flex items-center gap-1">
                              <ImageIcon className="w-3 h-3 text-amber-600" /> Item Photo Attached
                            </span>
                            <div className="flex items-center gap-2">
                              <button 
                                type="button"
                                onClick={() => billImageInputRef.current?.click()}
                                className="text-[10px] font-black text-blue-600 hover:text-blue-800 transition-colors cursor-pointer"
                              >
                                Change
                              </button>
                              <button 
                                type="button"
                                onClick={() => selectedBillForCustomerView && handleRemoveBillImage(selectedBillForCustomerView)}
                                className="text-[10px] font-black text-rose-500 hover:text-rose-700 transition-colors cursor-pointer"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap justify-center gap-2 pt-2">
                        <Button 
                          onClick={() => {
                            openAddInterestModal(
                              selectedBillForCustomerView, 
                              selectedStockItemForCustomerView?.branch_id || selectedBranchForCustomerView || undefined,
                              selectedStockItemForCustomerView?.id
                            );
                          }}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase tracking-widest text-[9px] h-10 px-4 rounded-xl shadow-md flex items-center justify-center cursor-pointer transition-all active:scale-95 gap-1.5"
                        >
                          <Percent className="w-3.5 h-3.5" /> Add Interest
                        </Button>
                        <Button 
                          onClick={() => {
                            openAddCustomerModal(selectedBillForCustomerView);
                            setShowBillCustomerModal(false);
                          }}
                          className="bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest text-[9px] h-10 px-4 rounded-xl shadow-lg flex items-center justify-center cursor-pointer transition-all active:scale-95 gap-1.5"
                        >
                          <UserPlus className="w-3.5 h-3.5" /> Add Customer Details
                        </Button>
                        <Button 
                          onClick={() => {
                            if (currentBillImage) {
                              setShowImagePreviewModal(true);
                            } else {
                              billImageInputRef.current?.click();
                            }
                          }}
                          disabled={isUploadingImage}
                          className="bg-amber-600 hover:bg-amber-700 text-white font-black uppercase tracking-widest text-[9px] h-10 px-4 rounded-xl shadow-md flex items-center justify-center cursor-pointer transition-all active:scale-95 gap-1.5"
                          title="Upload or view picture of the item"
                        >
                          {isUploadingImage ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <ImageIcon className="w-3.5 h-3.5" />
                          )}
                          Image
                        </Button>
                      </div>

                      {/* Recorded Interest Section */}
                      {(() => {
                        const targetBranch = normalizeBranchId(
                          selectedStockItemForCustomerView?.branch_id ||
                          selectedBranchForCustomerView || 
                          (selectedBranch !== 'ALL' ? selectedBranch : '') || 
                          currentUser?.branchId || 
                          ''
                        );
                        const currentItemId = selectedStockItemForCustomerView?.id;

                        const billInterests = stockInterests.filter(i => {
                          // 1. Direct item ID match
                          if (i.item_id && currentItemId && i.item_id === currentItemId) {
                            return true;
                          }
                          // 2. Bill number match
                          const billMatches = (i.bill_no || '').trim().toUpperCase() === (selectedBillForCustomerView || '').trim().toUpperCase();
                          if (!billMatches) return false;

                          // If this interest record belongs to another item ID, do not cross-apply
                          if (i.item_id && currentItemId && i.item_id !== currentItemId) {
                            return false;
                          }

                          // 3. Strict branch isolation
                          const iBranch = normalizeBranchId(i.branch || '');
                          if (iBranch && targetBranch) {
                            return iBranch === targetBranch;
                          }
                          return false;
                        });
                        const totalBillInterest = billInterests.reduce((sum, item) => sum + (parseFloat(item.interest_value) || 0), 0);
                        return (
                          <div className="mt-4 pt-4 border-t border-slate-200/60 text-left space-y-2.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] uppercase font-black tracking-wider text-slate-500 flex items-center gap-1">
                                <Coins className="w-3.5 h-3.5 text-emerald-600" /> Recorded Interest Entries ({billInterests.length})
                              </span>
                              {totalBillInterest > 0 && (
                                <span className="text-xs font-black text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                                  Total: LKR {totalBillInterest.toLocaleString()}
                                </span>
                              )}
                            </div>

                            {billInterests.length === 0 ? (
                              <p className="text-[11px] text-slate-400 font-semibold italic py-1">No interest added yet for this bill.</p>
                            ) : (
                              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                                {billInterests.map((item, idx) => (
                                  <div key={item.id || idx} className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 shadow-sm">
                                    <div className="flex items-center gap-2">
                                      <span className="bg-emerald-100 text-emerald-800 text-[10px] font-black px-1.5 py-0.5 rounded">
                                        {item.branch || 'DMT'}
                                      </span>
                                      <span className="text-slate-500 font-semibold text-[11px]">{item.date}</span>
                                      <span className="text-slate-900 font-black">LKR {Number(item.interest_value || 0).toLocaleString()}</span>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteInterest(item.id)}
                                      className="text-slate-400 hover:text-rose-600 p-1 transition-colors cursor-pointer"
                                      title="Remove Interest Entry"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                }
              })()}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* MODAL: PAWN ITEM IMAGE VIEW & FULL PREVIEW */}
      <Dialog open={showImagePreviewModal} onOpenChange={setShowImagePreviewModal}>
        <DialogContent className="sm:max-w-[480px] bg-white border border-slate-200 shadow-2xl p-0 overflow-hidden rounded-[2.5rem]">
          <div className="h-2 bg-amber-500" />
          <div className="p-6">
            <DialogHeader>
              <DialogTitle className="text-lg font-black tracking-tight text-slate-900 flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <ImageIcon className="w-5 h-5 text-amber-600" /> Pawn Item Photo
                </span>
                <span className="text-xs font-bold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full border border-slate-200">
                  Bill: {selectedBillForCustomerView}
                </span>
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-400 font-semibold mt-0.5">
                Attached photo of the collateral item for this pawn bill.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4">
              {selectedBillForCustomerView && billImages[selectedBillForCustomerView] ? (
                <div className="space-y-4">
                  <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-950 flex items-center justify-center max-h-[360px]">
                    <img 
                      src={billImages[selectedBillForCustomerView]} 
                      alt={`Item for ${selectedBillForCustomerView}`} 
                      className="max-h-[360px] w-auto max-w-full object-contain rounded-xl"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => billImageInputRef.current?.click()}
                      className="rounded-xl font-bold text-xs h-9 border-slate-200 hover:bg-slate-50 text-slate-700 flex items-center gap-1.5 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5 text-blue-600" /> Replace Image
                    </Button>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => selectedBillForCustomerView && handleRemoveBillImage(selectedBillForCustomerView)}
                        className="rounded-xl font-bold text-xs h-9 border-rose-200 text-rose-600 hover:bg-rose-50 hover:border-rose-300 flex items-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Remove
                      </Button>
                      <Button
                        type="button"
                        onClick={() => setShowImagePreviewModal(false)}
                        className="rounded-xl font-bold bg-slate-900 hover:bg-slate-800 text-white text-xs h-9 px-4 cursor-pointer"
                      >
                        Close
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center space-y-3">
                  <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto border border-amber-100">
                    <ImageIcon className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-bold text-slate-700">No image uploaded yet</p>
                  <p className="text-xs text-slate-400">Upload a picture of the collateral item for Bill {selectedBillForCustomerView}.</p>
                  <Button
                    type="button"
                    onClick={() => {
                      setShowImagePreviewModal(false);
                      billImageInputRef.current?.click();
                    }}
                    className="bg-amber-600 hover:bg-amber-700 text-white font-black text-xs h-9 px-4 rounded-xl shadow-md gap-1.5 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" /> Upload Image
                  </Button>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* MODAL: ADD/EDIT CUSTOMER */}
      <Dialog open={showAddCustomerModal} onOpenChange={setShowAddCustomerModal}>
        <DialogContent className="sm:max-w-[480px] bg-white border border-slate-200 shadow-2xl p-0 overflow-hidden rounded-[2.5rem] max-h-[90vh] flex flex-col">
          <div className="h-2 bg-blue-600 shrink-0" />
          <div className="p-6 pb-2 shrink-0">
            <DialogHeader>
              <DialogTitle className="text-xl font-black tracking-tighter flex items-center gap-3 text-slate-900">
                <div className="h-9 w-9 bg-blue-50 rounded-lg flex items-center justify-center border border-blue-100 text-blue-600">
                  <UserPlus className="h-4.5 w-4.5" />
                </div>
                {isEditingCustomer ? "Edit Customer Profile" : "Register Customer Profile"}
              </DialogTitle>
              <DialogDescription className="font-medium text-slate-500 text-xs">
                Associate customer contact details and addresses with active vault stock bills.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-2 space-y-4">
            <div className="grid gap-4 pb-4">
              
              {/* Customer Name */}
              <div className="grid gap-1.5 relative">
                <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Customer Name</Label>
                <div className="relative">
                  <Input 
                    value={custName} 
                    onChange={e => handleNameChange(e.target.value)} 
                    placeholder="E.g. Saman Kumara" 
                    className="h-10 border-slate-200 rounded-xl font-bold" 
                  />
                  {showSuggestions && nameSuggestions.length > 0 && (
                    <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-[9999] max-h-40 overflow-y-auto divide-y divide-slate-100">
                      {nameSuggestions.map(suggestion => (
                        <button
                          key={suggestion.id}
                          type="button"
                          onClick={() => selectNameSuggestion(suggestion)}
                          className="w-full text-left px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors animate-in fade-in"
                        >
                          <div className="font-black text-slate-900">{suggestion.name}</div>
                          <div className="text-[10px] text-slate-400 mt-0.5">{suggestion.tp} | {suggestion.address}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Telephone */}
              <div className="grid gap-1.5">
                <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Telephone (TP)</Label>
                <Input 
                  value={custTp} 
                  onChange={e => setCustTp(e.target.value)} 
                  placeholder="E.g. 0771234567" 
                  className="h-10 border-slate-200 rounded-xl font-bold" 
                />
              </div>

              {/* NIC */}
              <div className="grid gap-1.5">
                <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">NIC (Optional)</Label>
                <Input 
                  value={custNic} 
                  onChange={e => setCustNic(e.target.value)} 
                  placeholder="E.g. 199512345678" 
                  className="h-10 border-slate-200 rounded-xl font-bold" 
                />
              </div>

              {/* Address */}
              <div className="grid gap-1.5">
                <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Address</Label>
                <Input 
                  value={custAddress} 
                  onChange={e => setCustAddress(e.target.value)} 
                  placeholder="E.g. No 12, Main Street, Wattala" 
                  className="h-10 border-slate-200 rounded-xl font-bold" 
                />
              </div>

              {/* Address 2 */}
              <div className="grid gap-1.5">
                <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Address Line 2 (Optional)</Label>
                <Input 
                  value={custAddress2} 
                  onChange={e => setCustAddress2(e.target.value)} 
                  placeholder="E.g. Apartment 4B" 
                  className="h-10 border-slate-200 rounded-xl font-bold" 
                />
              </div>

              {/* Bill Numbers */}
              <div className="grid gap-1.5">
                <div className="flex justify-between items-center">
                  <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Linked Pawn Bill Numbers</Label>
                  <div className="flex items-center gap-1">
                    {["A", "1R", "3M", "3R", "6R", "12R", "6M"].map(pref => (
                      <button
                        key={pref}
                        type="button"
                        onClick={() => handleAddBillPrefix(pref)}
                        className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded text-[9px] font-black text-slate-700 cursor-pointer transition-colors active:scale-95"
                      >
                        {pref}
                      </button>
                    ))}
                  </div>
                </div>
                <Input 
                  value={custBills} 
                  onChange={e => setCustBills(e.target.value)} 
                  placeholder="Comma separated: e.g. 1R 15580, 12R 20750" 
                  className="h-10 border-slate-200 rounded-xl font-bold" 
                />
                <span className="text-[9px] font-bold text-slate-400">Associate one or multiple bill numbers to this customer profile.</span>
              </div>

            </div>
          </div>

          <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3 shrink-0">
            <Button variant="outline" onClick={() => setShowAddCustomerModal(false)} className="rounded-xl font-bold">Cancel</Button>
            <Button 
              onClick={handleSaveCustomer} 
              className="bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest text-[9px] h-10 px-5 rounded-xl shadow-lg cursor-pointer"
            >
              Save Customer
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* MODAL: ADD INTEREST FOR BILL */}
      <Dialog open={showAddInterestModal} onOpenChange={setShowAddInterestModal}>
        <DialogContent className="sm:max-w-[420px] bg-white border border-slate-200 shadow-2xl p-0 overflow-hidden rounded-[2.5rem]">
          <div className="h-2 bg-emerald-600" />
          <div className="p-6">
            <DialogHeader>
              <DialogTitle className="text-xl font-black tracking-tighter text-slate-900 flex items-center gap-2.5">
                <div className="w-9 h-9 bg-emerald-50 rounded-xl flex items-center justify-center border border-emerald-100 text-emerald-600">
                  <Percent className="w-5 h-5" />
                </div>
                Add Interest
              </DialogTitle>
              <DialogDescription className="font-semibold text-slate-400 text-xs mt-1 flex items-center gap-2">
                <span>Record interest for Bill No: <span className="text-slate-800 font-black">{selectedBillForCustomerView}</span></span>
                {selectedBranchForCustomerView && (
                  <span className="bg-emerald-50 text-emerald-800 border border-emerald-200/50 font-black px-2 py-0.5 rounded-md text-[9px] uppercase tracking-wide">
                    {normalizeBranchId(selectedBranchForCustomerView)}
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>

            <div className="mt-5 space-y-4">
              {/* Field 1: Date */}
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-black tracking-wider text-slate-500">
                  Date <span className="text-rose-500">*</span>
                </Label>
                <Input
                  type="date"
                  value={interestDate}
                  onChange={(e) => setInterestDate(e.target.value)}
                  className="h-10 border-slate-200 rounded-xl font-bold text-slate-800 text-xs"
                />
              </div>

              {/* Field 2: Interest Value */}
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-black tracking-wider text-slate-500">
                  Interest Value (Rs.) <span className="text-rose-500">*</span>
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-xs font-black text-slate-400">Rs.</span>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={interestValue}
                    onChange={(e) => setInterestValue(e.target.value)}
                    className="h-10 pl-10 border-slate-200 rounded-xl font-bold text-slate-900 text-sm"
                  />
                </div>
              </div>

              {/* Field 3: Branch */}
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-black tracking-wider text-slate-500">
                  Branch <span className="text-rose-500">*</span>
                </Label>
                {currentUser?.role !== 'ADMIN' ? (
                  <div className="h-10 border border-slate-200 rounded-xl font-black text-slate-800 text-xs px-3 bg-slate-50 flex items-center justify-between">
                    <span>{branches.find(b => normalizeBranchId(b.id) === normalizeBranchId(interestBranch))?.name || interestBranch}</span>
                    <span className="bg-emerald-100 text-emerald-800 text-[10px] font-black px-2 py-0.5 rounded">
                      {normalizeBranchId(interestBranch)}
                    </span>
                  </div>
                ) : (
                  <select
                    value={interestBranch}
                    onChange={(e) => setInterestBranch(e.target.value)}
                    className="h-10 border border-slate-200 rounded-xl font-bold text-slate-800 text-xs px-3 bg-white w-full focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
                  >
                    <option value="DMT">Dematagoda (DMT)</option>
                    <option value="KIR">Kiribathgoda (KIR)</option>
                    <option value="BRL">Borella (BRL)</option>
                    <option value="DHW">Dehiwala (DHW)</option>
                    <option value="HMG">Homagama (HMG)</option>
                    <option value="KDW">Kadawatha (KDW)</option>
                    <option value="KOT">Kotikawatta (KOT)</option>
                    <option value="KTW">Kottawa (KTW)</option>
                    <option value="PND">Panadura (PND)</option>
                    <option value="W2">Wattala 2 (W2)</option>
                    <option value="W3">Wattala 3 (W3)</option>
                    <option value="W4">Wattala 4 (W4)</option>
                    <option value="KHT">Kahathuduwa (KHT)</option>
                    <option value="HQ">Head Office (HQ)</option>
                  </select>
                )}
              </div>

              {/* Notes (Optional) */}
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-black tracking-wider text-slate-500">Notes / Remarks (Optional)</Label>
                <Input
                  placeholder="E.g. Monthly interest payment"
                  value={interestNotes}
                  onChange={(e) => setInterestNotes(e.target.value)}
                  className="h-10 border-slate-200 rounded-xl font-medium text-slate-700 text-xs"
                />
              </div>

              {/* Buttons */}
              <div className="flex justify-end gap-2 pt-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAddInterestModal(false)}
                  className="rounded-xl font-bold border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleSaveInterest}
                  disabled={isSubmittingInterest}
                  className="rounded-xl font-bold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer px-6 text-xs gap-1.5 shadow-md shadow-emerald-600/20"
                >
                  {isSubmittingInterest ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save Interest
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* MODAL: EDIT MATRIX ITEM */}
      <Dialog open={showEditMatrixModal} onOpenChange={setShowEditMatrixModal}>
        <DialogContent className="sm:max-w-[420px] bg-white border border-slate-200 shadow-2xl p-0 overflow-hidden rounded-[2.5rem]">
          <div className="h-2 bg-blue-600" />
          <div className="p-6">
            <DialogHeader>
              <DialogTitle className="text-xl font-black tracking-tighter text-slate-900 flex items-center gap-2">
                <Edit className="w-5 h-5 text-blue-600" />
                Edit Matrix Transaction ({editingMatrixItem?.category})
              </DialogTitle>
              <DialogDescription className="font-semibold text-slate-400 text-xs mt-1">
                Modify transaction details for Bill: <span className="text-slate-800 font-black">{editingMatrixItem?.bill_no}</span>
              </DialogDescription>
            </DialogHeader>

            <div className="mt-5 space-y-4">
              {/* Field 1: Date */}
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-black tracking-wider text-slate-500">Date</Label>
                <Input
                  type="date"
                  value={editMatrixDate}
                  onChange={(e) => setEditMatrixDate(e.target.value)}
                  className="h-10 border-slate-200 rounded-xl font-bold text-slate-800 text-xs"
                />
              </div>

              {/* Field 2: Amount */}
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-black tracking-wider text-slate-500">Amount (Rs.)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-xs font-black text-slate-400">Rs.</span>
                  <Input
                    type="number"
                    step="0.01"
                    value={editMatrixAmount}
                    onChange={(e) => setEditMatrixAmount(e.target.value)}
                    className="h-10 pl-10 border-slate-200 rounded-xl font-bold text-slate-900 text-sm"
                  />
                </div>
              </div>

              {/* Field 3: Branch */}
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-black tracking-wider text-slate-500">Branch</Label>
                <select
                  value={editMatrixBranch}
                  onChange={(e) => setEditMatrixBranch(e.target.value)}
                  className="h-10 border border-slate-200 rounded-xl font-bold text-slate-800 text-xs px-3 bg-white w-full focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                >
                  <option value="DMT">Dematagoda (DMT)</option>
                  <option value="KIR">Kiribathgoda (KIR)</option>
                  <option value="BRL">Borella (BRL)</option>
                  <option value="DHW">Dehiwala (DHW)</option>
                  <option value="HMG">Homagama (HMG)</option>
                  <option value="KDW">Kadawatha (KDW)</option>
                  <option value="KOT">Kotikawatta (KOT)</option>
                  <option value="KTW">Kottawa (KTW)</option>
                  <option value="PND">Panadura (PND)</option>
                  <option value="W2">Wattala 2 (W2)</option>
                  <option value="W3">Wattala 3 (W3)</option>
                  <option value="W4">Wattala 4 (W4)</option>
                  <option value="KHT">Kahathuduwa (KHT)</option>
                  <option value="HQ">Head Office (HQ)</option>
                </select>
              </div>

              {/* Field 4: Notes / Remarks */}
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-black tracking-wider text-slate-500">Remarks / Notes</Label>
                <Input
                  value={editMatrixNotes}
                  onChange={(e) => setEditMatrixNotes(e.target.value)}
                  className="h-10 border-slate-200 rounded-xl font-medium text-slate-700 text-xs"
                />
              </div>

              {/* Buttons */}
              <div className="flex justify-end gap-2 pt-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowEditMatrixModal(false)}
                  className="rounded-xl font-bold border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleSaveEditMatrixItem}
                  disabled={isSubmittingEditMatrix}
                  className="rounded-xl font-bold bg-blue-600 hover:bg-blue-700 text-white cursor-pointer px-6 text-xs gap-1.5 shadow-md"
                >
                  {isSubmittingEditMatrix ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save Changes
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* MODAL: DELETE MATRIX ITEM */}
      <Dialog open={showDeleteMatrixModal} onOpenChange={setShowDeleteMatrixModal}>
        <DialogContent className="sm:max-w-[420px] bg-white border border-slate-200 shadow-2xl p-0 overflow-hidden rounded-[2.5rem]">
          <div className="h-2 bg-rose-600" />
          <div className="p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-rose-50 rounded-full border border-rose-100 flex items-center justify-center mx-auto text-rose-600">
              <Trash2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-black text-slate-900 text-lg">Confirm Delete Transaction</h3>
              <p className="text-xs font-semibold text-slate-500 mt-1">
                Are you sure you want to delete this {deletingMatrixItem?.category} entry for bill <span className="font-black text-slate-800">{deletingMatrixItem?.bill_no}</span> (LKR {Number(deletingMatrixItem?.amount || 0).toLocaleString()})?
              </p>
            </div>

            <div className="flex justify-center gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => setShowDeleteMatrixModal(false)}
                className="rounded-xl font-bold border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer text-xs px-5"
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmDeleteMatrixItem}
                disabled={isDeletingMatrixItem}
                className="rounded-xl font-bold bg-rose-600 hover:bg-rose-700 text-white cursor-pointer px-5 text-xs gap-1.5 shadow-md shadow-rose-600/20"
              >
                {isDeletingMatrixItem ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Confirm Delete
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}

export default function EndOfDayPage() {
  return (
    <Suspense fallback={
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    }>
      <EndOfDayContent />
    </Suspense>
  );
}
