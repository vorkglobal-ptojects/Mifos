'use client';
import { getAuthHeaders } from '@/lib/getAuthHeaders';
import { getBranchSearchTerms, normalizeBranchId, isNationalId, normalizeNationalId, stripBranchPrefix } from '@/lib/branch-mapping';

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { 
  Plus, Search, UserPlus, Sparkles, Filter, MoreVertical, RefreshCcw, 
  Pencil, Trash2, ShieldCheck, UserCog, Camera, CameraOff, MapPin, Image,
  Users, Edit, FileText, Check, AlertTriangle, CheckCircle2, Eye, Upload, ZoomIn
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import ChangeRequestModal from "@/components/ChangeRequestModal"
import { supabase } from "@/lib/supabase"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { printLoanAgreement } from "@/lib/loanAgreementPrint"
import { SmartNicScanner } from "@/components/SmartNicScanner"
import { compressImage } from "@/lib/image-compression"



export default function ClientsPage() {
  const [isOpen, setIsOpen] = useState(false);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Stock Customers State
  const [stockCustomers, setStockCustomers] = useState<any[]>([]);
  const [showCustomerRegistryModal, setShowCustomerRegistryModal] = useState(false);
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  const [isEditingCustomer, setIsEditingCustomer] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);

  // Form State - Add Customer
  const [custName, setCustName] = useState("");
  const [custAddress, setCustAddress] = useState("");
  const [custAddress2, setCustAddress2] = useState("");
  const [custTp, setCustTp] = useState("");
  const [custNic, setCustNic] = useState("");
  const [custBills, setCustBills] = useState("");

  // Autocomplete Suggestions
  const [nameSuggestions, setNameSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState("");
  const [isUsingSupabase, setIsUsingSupabase] = useState(true);

  // Agreement Modal State
  const [showAgreementModal, setShowAgreementModal] = useState(false);
  const [agreementClientNum, setAgreementClientNum] = useState("");
  const [agreementDate, setAgreementDate] = useState("");
  const [agreementBorrowerName, setAgreementBorrowerName] = useState("");
  const [agreementNic, setAgreementNic] = useState("");
  const [agreementAddress, setAgreementAddress] = useState("");
  const [agreementLoanLimit, setAgreementLoanLimit] = useState("100000");
  const [agreementServiceFee, setAgreementServiceFee] = useState("3.5");
  const [agreementInterest, setAgreementInterest] = useState("0");
  const [agreementCode, setAgreementCode] = useState("");

  // Form State
  const [nic, setNic] = useState('');
  const [firstName, setFirstName] = useState(''); // Mapped to Name with Initials
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');         // Mapped to TP
  const [address, setAddress] = useState('');
  const [nicFrontImage, setNicFrontImage] = useState<string | null>(null);
  const [nicBackImage, setNicBackImage] = useState<string | null>(null);
  const [signatureImage, setSignatureImage] = useState<string | null>(null);
  const [activeKycTab, setActiveKycTab] = useState<'nic_front' | 'nic_back' | 'signature'>('nic_front');

  const [branchId, setBranchId] = useState('');
  const [userId, setUserId] = useState('');
  const [userRole, setUserRole] = useState('');
  const [editingClient, setEditingClient] = useState<any>(null);
  const [clientDeleteModal, setClientDeleteModal] = useState<{
    isOpen: boolean;
    client: any;
  }>({
    isOpen: false,
    client: null
  });
  const [selectedBranches, setSelectedBranches] = useState<string[]>([]);
  const [isBranchFilterOpen, setIsBranchFilterOpen] = useState(false);
  const branchDropdownRef = useRef<HTMLDivElement>(null);
  const [branches, setBranches] = useState<any[]>([]);

  // Customer KYC Photo Viewer Dialog State
  const [photoViewerClient, setPhotoViewerClient] = useState<{
    isOpen: boolean;
    clientId?: string;
    name: string;
    nic: string;
    front?: string | null;
    back?: string | null;
    signature?: string | null;
    isLoading?: boolean;
  }>({
    isOpen: false,
    clientId: '',
    name: '',
    nic: '',
    front: null,
    back: null,
    signature: null,
    isLoading: false,
  });

  // Real-time duplicate cross-check against database when registering customer
  const normalizedInputNic = (nic || '').trim().toLowerCase();
  const normalizedInputPhone = (phone || '').replace(/\D/g, '');
  const isGovInputNic = isNationalId(normalizedInputNic);

  // In Sri Lanka pawning, NIC is the unique primary citizen identity.
  // Phone numbers can be legitimately shared (e.g. spouses, family) and must NOT
  // hijack the customer identity or block registration of a distinct citizen.
  const duplicateClientMatch = (!editingClient && normalizedInputNic.length >= 3)
    ? clients.find(c => {
        const cBranch = normalizeBranchId(c.branch_id || c.branchId);
        const myBranch = normalizeBranchId(branchId);

        // If it's a book-era / non-NIC code (e.g. "3R 14543"), ONLY match within the user's active branch!
        // This ensures Kadawatha and Kiribathgoda will never conflict on duplicate book ledger IDs.
        if (!isGovInputNic && cBranch !== myBranch) {
          return false;
        }

        const rawNic = String(c.national_id || c.nationalId || c.nic || c.id || '').trim().toLowerCase();
        const cleanRawNic = stripBranchPrefix(rawNic).toLowerCase();

        return (
          rawNic === normalizedInputNic || 
          cleanRawNic === normalizedInputNic ||
          rawNic.replace(/[^a-z0-9]/g, '') === normalizedInputNic.replace(/[^a-z0-9]/g, '') ||
          cleanRawNic.replace(/[^a-z0-9]/g, '') === normalizedInputNic.replace(/[^a-z0-9]/g, '')
        );
      })
    : null;

  const isDuplicateClientNic = Boolean(duplicateClientMatch);

  // Informational only: check if another customer with a different NIC shares this phone number
  const sharedPhoneClient = (!editingClient && normalizedInputPhone.length >= 9)
    ? clients.find(c => {
        const cPhone = String(c.phone || c.mobile || '').replace(/\D/g, '');
        const rawNic = String(c.national_id || c.nationalId || c.nic || c.id || '').trim().toLowerCase();
        const cleanRawNic = stripBranchPrefix(rawNic).toLowerCase();
        const isSameNic = normalizedInputNic.length >= 3 && (
          rawNic === normalizedInputNic || 
          cleanRawNic === normalizedInputNic ||
          rawNic.replace(/[^a-z0-9]/g, '') === normalizedInputNic.replace(/[^a-z0-9]/g, '')
        );
        return !isSameNic && cPhone.length >= 9 && cPhone === normalizedInputPhone;
      })
    : null;

  const isDuplicateClientPhone = Boolean(sharedPhoneClient);

  const loadBranches = async () => {
    try {
      const res = await fetch('/api/branches', { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setBranches([{ id: 'ALL', name: 'All Branches' }, ...data]);
      }
    } catch (e) {
      console.error('Failed to load branches', e);
    }
  };

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

  const loadClients = async (overrideBranches?: string[] | string, forceRefresh = false) => {
    try {
      setLoading(true);
      const rawUserBranch = typeof window !== 'undefined' ? localStorage.getItem('user_branch') : null;
      let effectiveActiveBranch = rawUserBranch ? normalizeBranchId(rawUserBranch) : '';

      const storedUser = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
      let currentRole = userRole;
      if (storedUser) {
        try {
          const user = JSON.parse(storedUser);
          if (!effectiveActiveBranch && user.branchId) {
            effectiveActiveBranch = normalizeBranchId(user.branchId);
          }
          setUserId(user.id || '');
          currentRole = user.role || 'TELLER';
          setUserRole(currentRole);
        } catch {}
      }
      if (effectiveActiveBranch) {
        setBranchId(effectiveActiveBranch);
      }

      // Determine active branches to query
      let activeBranches: string[] = [];
      if (overrideBranches !== undefined) {
        activeBranches = Array.isArray(overrideBranches) ? overrideBranches : [overrideBranches];
      } else if (selectedBranches.length > 0) {
        activeBranches = selectedBranches;
      } else if (effectiveActiveBranch && effectiveActiveBranch !== 'DHW' && effectiveActiveBranch !== 'HQ' && effectiveActiveBranch !== 'ALL') {
        // Users at a specific branch default to their branch
        activeBranches = [effectiveActiveBranch];
      } else {
        // Staff at Main Branch (HQ/DHW) oversee all branches by default
        activeBranches = ['ALL'];
      }

      const isAll = activeBranches.includes('ALL');
      const branchParamValue = isAll ? 'ALL' : activeBranches.join(',');
      const queryParam = isAll ? '' : `?branchId=${encodeURIComponent(branchParamValue)}`;
      const freshParam = forceRefresh ? `${queryParam ? '&' : '?'}fresh=${Date.now()}` : '';

      // getAuthHeaders() automatically includes Authorization + x-branch-id from localStorage
      const headers = getAuthHeaders();
      const res = await fetch(`/api/clients${queryParam}${freshParam}`, { headers, cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setClients(Array.isArray(data) ? data : []);
      } else {
        const errJson = await res.json().catch(() => ({}));
        console.warn("Client directory fetch response:", res.status, errJson);
        toast.error(errJson.error || "Failed to load customer directory. Please retry.");
      }
    } catch(err: any) {
      console.error("Client directory network error:", err);
      toast.error("Network connection issue while loading customer directory.");
    } finally {
      setLoading(false);
    }
  };

  // Live cross-branch customer search whenever user types in the search box
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q || q.length < 2) return;
    const timer = setTimeout(async () => {
      try {
        const headers = getAuthHeaders();
        const res = await fetch(`/api/clients?search=${encodeURIComponent(q)}&fresh=true`, { headers });
        if (res.ok) {
          const results = await res.json();
          if (Array.isArray(results) && results.length > 0) {
            setClients(prev => {
              const existingIds = new Set(prev.map(c => c.id));
              const newClients = results.filter((r: any) => !existingIds.has(r.id));
              return newClients.length > 0 ? [...newClients, ...prev] : prev;
            });
          }
        }
      } catch (err) {
        console.warn('Live client search notice:', err);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const toggleBranch = (bId: string) => {
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
    loadClients(next);
  };

  const selectHomeBranchOnly = () => {
    const home = branchId ? branchId.toUpperCase() : 'HQ';
    setSelectedBranches([home]);
    loadClients([home]);
  };

  const selectAllBranches = () => {
    setSelectedBranches(['ALL']);
    loadClients(['ALL']);
  };

  const getBranchButtonLabel = () => {
    if (selectedBranches.includes('ALL')) {
      return `ALL BRANCHES (${clients.length})`;
    }
    if (selectedBranches.length === 0) {
      return `NO BRANCH (${clients.length})`;
    }
    if (selectedBranches.length === 1) {
      const code = selectedBranches[0];
      const bObj = branches.find(b => b.id.toUpperCase() === code.toUpperCase());
      const name = bObj?.name || code;
      const isHome = branchId && code.toUpperCase() === branchId.toUpperCase();
      return `${name.toUpperCase()}${isHome ? ' (HOME)' : ''} (${clients.length})`;
    }
    if (selectedBranches.length === 2) {
      return `${selectedBranches[0].toUpperCase()} + ${selectedBranches[1].toUpperCase()} (${clients.length})`;
    }
    return `${selectedBranches[0].toUpperCase()} + ${selectedBranches[1].toUpperCase()} +${selectedBranches.length - 2} (${clients.length})`;
  };

  const loadCustomerData = async (forceRefresh = false) => {
    const CACHE_KEY = 'local_stock_customers';
    const CACHE_TIME_KEY = 'local_stock_customers_timestamp';
    const CACHE_TTL_MS = 60 * 1000; // 60 seconds TTL (auto-refreshes fresh database records)

    // 1. Try reading from LocalStorage cache first (Zero Supabase Egress!)
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
const headers = getAuthHeaders(branchId ? { 'x-branch-id': normalizeBranchId(branchId) } : undefined);
      const res = await fetch('/api/stock-customers', { headers, cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        if (json.customers && Array.isArray(json.customers)) {
          allCustomers = json.customers;
        }
      }

      setStockCustomers(allCustomers);
      setIsUsingSupabase(true);
      try {
localStorage.setItem(CACHE_KEY, JSON.stringify(allCustomers));
        localStorage.setItem(CACHE_TIME_KEY, String(Date.now()));
      } catch (sErr) {
        console.warn('Failed to persist stock customers to localStorage:', sErr);
      }
    } catch (err) {
      console.warn("Failed to fetch stock customers from API, loading LocalStorage:", err);
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

  useEffect(() => {
    let initialBranches = ['ALL'];
    try {
      const stored = localStorage.getItem('user');
      const activeBranch = localStorage.getItem('user_branch');
      if (stored) {
        const u = JSON.parse(stored);
        const branchToUse = activeBranch || u.branchId;
        // Anyone logged into a specific branch defaults to that isolated branch
        if (branchToUse && branchToUse !== 'HQ' && branchToUse !== 'ALL') {
          const myBranch = normalizeBranchId(branchToUse).toUpperCase();
          initialBranches = [myBranch];
        }
      }
    } catch {}
    setSelectedBranches(initialBranches);
    loadClients(initialBranches);
    loadCustomerData();
    loadBranches();
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('register') === 'true') {
        setIsOpen(true);
        const nicParam = params.get('nic');
        if (nicParam) {
          setNic(nicParam);
        }
      } else if (params.get('register_existing') === 'true') {
        const billParam = params.get('bill') || "";
        openAddCustomerModal(billParam);
      }
    }
  }, []);

  const openAgreementDialog = (client: any) => {
    setAgreementClientNum(client.nic || `CLI-${client.id.substring(0, 6)}`.toUpperCase());
    setAgreementDate(new Date().toISOString().split('T')[0]);
    setAgreementBorrowerName(client.first_name || client.firstName || "");
    setAgreementNic(client.nic || "");
    setAgreementAddress(client.address || "");
    setAgreementLoanLimit("100000");
    setAgreementServiceFee("3.5");
    setAgreementInterest("0");
    setAgreementCode("");
    setShowAgreementModal(true);
  };

  const handleGenerateAgreement = () => {
    if (!agreementCode.trim()) {
      toast.error("SMS Verification Code is required to sign the agreement.");
      return;
    }
    printLoanAgreement({
      clientNumber: agreementClientNum,
      agreementDate: agreementDate,
      borrowerName: agreementBorrowerName,
      nicNumber: agreementNic,
      address: agreementAddress,
      loanLimit: agreementLoanLimit,
      serviceFee: agreementServiceFee,
      interestRate: agreementInterest,
      verificationCode: agreementCode
    });
    setShowAgreementModal(false);
  };

  const handleSave = async () => {
    if (isSaving) return;

    // If duplicate customer detected when registering new, switch to edit mode
    if (duplicateClientMatch && !editingClient) {
      toast.info(`Customer already exists in database. Switched to existing record for ${duplicateClientMatch.first_name || duplicateClientMatch.firstName || 'Customer'}`);
      openEditDialog(duplicateClientMatch);
      return;
    }

    if (!nic || !firstName) {
      toast.error("Missing Information", {
        description: "NIC and Name with Initials are required."
      });
      return;
    }

    // Format / normalize phone number for robust Sri Lankan telecommunication standards
    let formattedPhone = (phone || '').trim();
    const rawPhoneDigits = formattedPhone.replace(/\D/g, '');
    if (rawPhoneDigits.length === 9 && rawPhoneDigits.startsWith('7')) {
      formattedPhone = `0${rawPhoneDigits}`;
    } else if (rawPhoneDigits.length === 11 && rawPhoneDigits.startsWith('94')) {
      formattedPhone = `0${rawPhoneDigits.substring(2)}`;
    }
    const phoneDigits = formattedPhone.replace(/\D/g, '');
    if (!phoneDigits || phoneDigits.length < 10) {
      toast.error("invalid mobile number", {
        description: "Mobile number must be at least 10 digits (e.g. 0771234567)."
      });
      return;
    }

    if (!nicFrontImage || !nicBackImage || !signatureImage) {
      toast.error("capture the pictures", {
        description: "Please capture NIC Front, NIC Back, and Signature pictures before proceeding."
      });
      if (!nicFrontImage) setActiveKycTab('nic_front');
      else if (!nicBackImage) setActiveKycTab('nic_back');
      else if (!signatureImage) setActiveKycTab('signature');
      return;
    }

    setIsSaving(true);
    const toastId = toast.loading(editingClient ? "Updating customer profile..." : "Saving customer profile...");

    try {
      const url = editingClient ? `/api/clients/${editingClient.id}` : '/api/clients';
      const method = editingClient ? 'PATCH' : 'POST';

      // Compress both NIC scans and signature to guarantee lightweight, safe payload
      const [compressedFront, compressedBack, compressedSign] = await Promise.all([
        compressImage(nicFrontImage),
        compressImage(nicBackImage),
        compressImage(signatureImage)
      ]);

      // Serialize Front and Back NIC scan base64 frames into a single robust JSON payload string
      const serializedNicImage = JSON.stringify({ front: compressedFront, back: compressedBack });

      // Guarantee effective operating branch is never empty or fallen back to HQ
      const rawUserBranch = typeof window !== 'undefined' ? localStorage.getItem('user_branch') : null;
      let effectiveActiveBranch = rawUserBranch ? normalizeBranchId(rawUserBranch) : '';
      if (!effectiveActiveBranch) {
        const storedUser = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
        if (storedUser) {
          try {
            const user = JSON.parse(storedUser);
            if (user.branchId) effectiveActiveBranch = normalizeBranchId(user.branchId);
          } catch {}
        }
      }
      const branchToSave = normalizeBranchId(branchId || effectiveActiveBranch || 'HQ');

      const headers = getAuthHeaders({ 'x-branch-id': branchToSave });

      const normNic = normalizeNationalId(nic);
      const res = await fetch(url, {
        method,
        headers,
        body: JSON.stringify({ 
          nic: normNic, 
          national_id: normNic,
          nationalId: normNic,
          firstName, // Name with Initials
          lastName: '.',
          phone: formattedPhone,
          address,
          nicImage: serializedNicImage,
          signatureImage: compressedSign,
          branchId: branchToSave, 
          createdByUserId: userId 
        })
      });

      if (!res.ok) {
        let errorMsg = `Failed to save customer (${res.status})`;
        try {
          const errorData = await res.json();
          errorMsg = errorData.error || errorData.message || errorMsg;
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

      let savedData: any = null;
      try {
        savedData = await res.json();
      } catch {}

      toast.success(editingClient ? "Customer updated successfully!" : "Customer saved successfully!", { id: toastId });
      
      setIsOpen(false);
      setEditingClient(null);
      setNic(''); setFirstName(''); setPhone(''); setAddress('');
      setNicFrontImage(null); setNicBackImage(null); setSignatureImage(null);
      setActiveKycTab('nic_front');

      // Optimistically insert / update customer in local state for instantaneous search availability
      if (savedData && savedData.id) {
        setClients(prev => {
          const formatted = {
            ...savedData,
            display_national_id: stripBranchPrefix(savedData.national_id || savedData.nationalId)
          };
          return [formatted, ...prev.filter(c => c.id !== savedData.id)];
        });
      }

      await loadClients(undefined, true);
    } catch(err: any) {
      console.error(err);
      toast.error("Error saving customer", {
        description: err.message || "Please check your network connection.",
        id: toastId
      });
    } finally {
      setIsSaving(false);
    }
  };

  const openEditDialog = (client: any) => {
    setEditingClient(client);
    setNic(client.national_id || client.nationalId || '');
    setFirstName(client.first_name || client.firstName || '');
    setPhone(client.phone || '');
    setAddress(client.address || '');
    
    let front = null;
    let back = null;
    if (client.nic_image) {
      try {
        const parsed = JSON.parse(client.nic_image);
        front = parsed.front || null;
        back = parsed.back || null;
      } catch (e) {
        front = client.nic_image; // Fallback legacy format support
      }
    }
    setNicFrontImage(front);
    setNicBackImage(back);
    setSignatureImage(client.signature_image || null);
    setActiveKycTab('nic_front');
    setIsOpen(true);
  };

  const handleDelete = async (client: any) => {
    if (userRole === 'TELLER') {
      setClientDeleteModal({ isOpen: true, client });
      return;
    }
    if (!confirm(`Are you sure you want to remove ${client.first_name || client.firstName}?`)) return;

    const toastId = toast.loading("Deleting customer...");
    try {
      const headers = getAuthHeaders();

      const res = await fetch(`/api/clients/${client.id}`, { method: 'DELETE', headers });
      if (!res.ok) throw new Error("Delete failed");
      toast.success("Customer removed successfully", { id: toastId });
      loadClients();
    } catch (err) {
      toast.error("Could not delete customer", { id: toastId });
    }
  };

  // Existing Shop Bills Customer operations & logic
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
    const activeBranchFilter =
      selectedBranches.length === 1 && selectedBranches[0] !== 'ALL'
        ? normalizeBranchId(selectedBranches[0])
        : (branchId && normalizeBranchId(branchId) !== 'HQ' ? normalizeBranchId(branchId) : '');
    const matches = stockCustomers.filter(c => {
      if (!c.name.toLowerCase().includes(val.toLowerCase())) return false;
      if (activeBranchFilter && activeBranchFilter !== 'HQ' && c.branch_id) {
        return normalizeBranchId(c.branch_id) === activeBranchFilter;
      }
      return true;
    });
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

    const isEdit = isEditingCustomer && selectedCustomer?.id && !String(selectedCustomer.id).startsWith('pawn-');
    const resolvedBranchRaw = isEdit
      ? (selectedCustomer?.branch_id || (selectedBranches.length === 1 && selectedBranches[0] !== 'ALL' ? selectedBranches[0] : '') || branchId || 'HQ')
      : ((selectedBranches.length === 1 && selectedBranches[0] !== 'ALL' ? selectedBranches[0] : '') || branchId || 'HQ');
    const effectiveBranch = normalizeBranchId(resolvedBranchRaw);
    const payload = {
      ...(isEdit ? { id: selectedCustomer.id } : {}),
      name: custName.trim(),
      address: custAddress.trim(),
      address_2: custAddress2.trim() || null,
      tp: custTp.trim(),
      nic: custNic.trim() || null,
      bill_numbers: custBills.trim(),
      branch_id: effectiveBranch
    };

    try {
      const url = isEdit ? `/api/stock-customers/${selectedCustomer.id}` : '/api/stock-customers';
      const method = isEdit ? 'PUT' : 'POST';

      const headers = getAuthHeaders({ 'x-branch-id': effectiveBranch });
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

      toast.success(isEdit ? "Customer profile updated successfully!" : "Customer profile created successfully!");
      setShowAddCustomerModal(false);
      await loadCustomerData(true);
      await loadClients(undefined, true);
    } catch (err: any) {
      toast.error("Error saving customer profile: " + err.message);
    }
  };

  const handleDeleteCustomer = async (id: string) => {
    if (userRole === 'TELLER') {
      const targetCust = clients.find((c: any) => c.id === id);
      setClientDeleteModal({ isOpen: true, client: targetCust || { id } });
      return;
    }
    if (!confirm("Are you sure you want to delete this customer profile?")) return;
    try {
      if (isUsingSupabase) {
        const headers = getAuthHeaders();
        const res = await fetch(`/api/stock-customers/${id}`, { method: 'DELETE', headers });
        if (!res.ok) throw new Error("Delete failed");
        toast.success("Customer profile deleted from Supabase!");
      } else {
        const local = localStorage.getItem('local_stock_customers');
        if (local) {
          const list = JSON.parse(local).filter((c: any) => c.id !== id);
          localStorage.setItem('local_stock_customers', JSON.stringify(list));
        }
        toast.success("Customer profile deleted (Local Storage)!");
      }
      loadCustomerData(true);
    } catch (err: any) {
      toast.error("Error deleting customer: " + err.message);
    }
  };

  const filteredClients = clients
    .filter(client => {
      // 1. Multi-Branch filter
      // When a user is actively searching by query, search across all branches
      // so customers are never hidden by branch isolation.
      if (!searchQuery.trim() && selectedBranches.length > 0 && !selectedBranches.includes('ALL')) {
        const cBranch = String(client.branch_id || client.branchId || '').toUpperCase().trim();
        const branchMatches = selectedBranches.some(sBranch => {
          const terms = getBranchSearchTerms(sBranch);
          return terms.some(t => cBranch === t.toUpperCase() || cBranch.includes(t.toUpperCase())) || cBranch === sBranch.toUpperCase();
        });
        if (!branchMatches) return false;
      }

      // 2. Search query filter
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      const qDigits = q.replace(/[^a-z0-9]/g, '');
      const qNumbers = q.replace(/\D/g, '');
      const rawNic = String(client.national_id || client.nationalId || '').toLowerCase();
      const cleanNic = (client.display_national_id || stripBranchPrefix(rawNic)).toLowerCase();
      const rawNicDigits = rawNic.replace(/[^a-z0-9]/g, '');
      const cleanNicDigits = cleanNic.replace(/[^a-z0-9]/g, '');
      const rawNicNumbers = rawNic.replace(/\D/g, '');
      const cleanNicNumbers = cleanNic.replace(/\D/g, '');
      const rawPhone = String(client.phone || '').toLowerCase();
      const phoneDigits = rawPhone.replace(/\D/g, '');
      const firstName = (client.first_name || client.firstName || '').toLowerCase();
      const lastName = (client.last_name || client.lastName || '').toLowerCase();
      const fullName = `${firstName} ${lastName}`.trim();
      const qWords = q.split(/\s+/).filter(Boolean);

      const wordsMatch = qWords.length > 1 && qWords.every(w =>
        fullName.includes(w) ||
        rawNic.includes(w) ||
        cleanNic.includes(w) ||
        (client.address || '').toLowerCase().includes(w) ||
        phoneDigits.includes(w)
      );

      return (
        wordsMatch ||
        fullName.includes(q) ||
        firstName.includes(q) ||
        lastName.includes(q) ||
        rawNic.includes(q) ||
        cleanNic.includes(q) ||
        (qDigits.length >= 3 && (rawNicDigits.includes(qDigits) || cleanNicDigits.includes(qDigits) || qDigits.includes(rawNicDigits) || qDigits.includes(cleanNicDigits))) ||
        (qNumbers.length >= 3 && (rawNicNumbers.includes(qNumbers) || cleanNicNumbers.includes(qNumbers))) ||
        rawPhone.includes(q) ||
        (qDigits.length >= 3 && phoneDigits.includes(qDigits)) ||
        client.address?.toLowerCase().includes(q) ||
        (client.branch_id || client.branchId)?.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const timeA = new Date(a.created_at || a.createdAt || 0).getTime();
      const timeB = new Date(b.created_at || b.createdAt || 0).getTime();
      return timeB - timeA;
    });

  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center glass p-8 rounded-2xl border-white/40 shadow-2xl gap-6">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tighter leading-none mb-2">Our <span className="text-gradient">Customers</span></h1>
          <p className="text-slate-500 font-medium tracking-tight">View and manage all customer details across all branches.</p>
        </div>
      </div>

      {/* Photo Capture & KYC Verification KPI & Coverage Chart */}
      {(() => {
        const total = clients.length;
        const withAnyPhoto = clients.filter(c => {
          if (c.signature_image || c.signatureImage) return true;
          const raw = c.nic_image || c.nicImage;
          if (!raw) return false;
          try {
            const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return !!(p.front || p.back);
          } catch {
            return typeof raw === 'string' && raw.length > 20;
          }
        }).length;

        const withFront = clients.filter(c => {
          const raw = c.nic_image || c.nicImage;
          if (!raw) return false;
          try {
            const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return !!p.front;
          } catch {
            return typeof raw === 'string' && raw.length > 20;
          }
        }).length;

        const withBack = clients.filter(c => {
          const raw = c.nic_image || c.nicImage;
          if (!raw) return false;
          try {
            const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return !!p.back;
          } catch {
            return false;
          }
        }).length;

        const withSign = clients.filter(c => !!(c.signature_image || c.signatureImage)).length;

        const withFullKyc = clients.filter(c => {
          const hasSign = !!(c.signature_image || c.signatureImage);
          const raw = c.nic_image || c.nicImage;
          if (!hasSign || !raw) return false;
          try {
            const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return !!(p.front && p.back);
          } catch {
            return false;
          }
        }).length;

        const coveragePct = total > 0 ? Math.round((withAnyPhoto / total) * 100) : 0;
        const fullKycPct = total > 0 ? Math.round((withFullKyc / total) * 100) : 0;
        const frontPct = total > 0 ? Math.round((withFront / total) * 100) : 0;
        const backPct = total > 0 ? Math.round((withBack / total) * 100) : 0;
        const signPct = total > 0 ? Math.round((withSign / total) * 100) : 0;

        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total Customers */}
            <div className="glass p-5 rounded-2xl border border-white/60 shadow-lg bg-white/60 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">Total Directory</span>
                <div className="p-2 bg-slate-100 rounded-xl text-slate-700">
                  <Users className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-3xl font-black text-slate-900 tracking-tight">{total}</div>
                <div className="text-xs font-bold text-slate-400 mt-0.5">Registered Borrowers</div>
              </div>
            </div>

            {/* Photos Captured */}
            <div className="glass p-5 rounded-2xl border border-emerald-100 shadow-lg bg-emerald-50/40 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-wider text-emerald-800">Photos Captured</span>
                <div className="p-2 bg-emerald-100 rounded-xl text-emerald-700">
                  <Camera className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-3xl font-black text-emerald-950 tracking-tight">{withAnyPhoto}</div>
                <div className="text-xs font-bold text-emerald-700 mt-0.5">{total - withAnyPhoto} Pending Capture</div>
              </div>
            </div>

            {/* Complete 3-Point KYC */}
            <div className="glass p-5 rounded-2xl border border-blue-100 shadow-lg bg-blue-50/40 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-wider text-blue-800">3-Point Verified KYC</span>
                <div className="p-2 bg-blue-100 rounded-xl text-blue-700">
                  <ShieldCheck className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-3xl font-black text-blue-950 tracking-tight">{withFullKyc}</div>
                <div className="text-xs font-bold text-blue-700 mt-0.5">{fullKycPct}% Complete (Front + Back + Sign)</div>
              </div>
            </div>

            {/* Verification Coverage Chart */}
            <div className="glass p-5 rounded-2xl border border-amber-100 shadow-lg bg-gradient-to-br from-white/90 to-amber-50/60 flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-black uppercase tracking-wider text-amber-900">Photo Coverage</span>
                <span className="text-sm font-black text-amber-900 font-mono">{coveragePct}%</span>
              </div>
              <div className="space-y-2">
                <div className="w-full bg-slate-200/80 rounded-full h-2.5 overflow-hidden flex">
                  <div className="bg-emerald-500 h-full transition-all duration-500" style={{ width: `${coveragePct}%` }} />
                </div>
                <div className="grid grid-cols-3 gap-1 pt-1 text-[9px] font-bold text-slate-500 text-center">
                  <div className="bg-white/80 py-1 rounded border border-slate-100">
                    <span className="text-slate-400 block text-[8px]">FRONT</span>
                    <span className="font-mono text-slate-800 font-black">{frontPct}%</span>
                  </div>
                  <div className="bg-white/80 py-1 rounded border border-slate-100">
                    <span className="text-slate-400 block text-[8px]">BACK</span>
                    <span className="font-mono text-slate-800 font-black">{backPct}%</span>
                  </div>
                  <div className="bg-white/80 py-1 rounded border border-slate-100">
                    <span className="text-slate-400 block text-[8px]">SIGN</span>
                    <span className="font-mono text-slate-800 font-black">{signPct}%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}



      {/* New Customer Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="w-[98vw] sm:w-[95vw] md:max-w-4xl lg:max-w-5xl xl:max-w-6xl h-[90dvh] max-h-[90dvh] sm:h-auto sm:max-h-[90dvh] bg-white border border-slate-200 shadow-2xl p-0 rounded-2xl sm:rounded-[2.5rem] flex flex-col gap-0 overflow-hidden my-auto">
          <div className="h-2 bg-[#ffd100] shrink-0" />
          
          {/* Fixed Header */}
          <div className="p-3 sm:p-6 pb-2.5 sm:pb-3 pr-12 border-b border-slate-100 shrink-0 bg-white">
            <DialogHeader>
              <DialogTitle className="text-lg sm:text-2xl font-black tracking-tighter flex items-center gap-2 sm:gap-3">
                 {editingClient ? <UserCog className="w-5 h-5 sm:w-6 sm:h-6 text-amber-600 shrink-0" /> : <UserPlus className="w-5 h-5 sm:w-6 sm:h-6 text-amber-600 shrink-0" />}
                 <span>{editingClient ? "Edit Customer Record" : "Register New Customer"}</span>
              </DialogTitle>
              <DialogDescription className="font-medium text-slate-500 text-[11px] sm:text-sm mt-0.5 sm:mt-1">
                {editingClient ? "Update current customer KYC and profile." : "Enter customer details and capture webcam images for KYC verification."}
              </DialogDescription>
            </DialogHeader>
          </div>

          {/* Scrollable Form Body */}
          <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-6 space-y-4 sm:space-y-5 overscroll-contain">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6 items-start">
              {/* Left Column: Form Inputs */}
              <div className="space-y-4">
                {/* ── RED ALERT: CUSTOMER ALREADY EXISTS IN DATABASE ── */}
                {duplicateClientMatch && (
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
                            Existing customer details are shown below in red:
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
                          {duplicateClientMatch.national_id || duplicateClientMatch.nationalId || duplicateClientMatch.id || nic}
                        </span>
                      </div>

                      <div className="bg-white/90 p-2.5 rounded-xl border border-red-300 shadow-sm">
                        <span className="text-[10px] font-black uppercase tracking-wider text-red-500 block mb-0.5">
                          Full Name
                        </span>
                        <span className="font-black text-red-700 text-sm">
                          {`${duplicateClientMatch.first_name || duplicateClientMatch.firstName || ''} ${duplicateClientMatch.last_name || duplicateClientMatch.lastName || ''}`.trim() || duplicateClientMatch.name || 'Unnamed Client'}
                        </span>
                      </div>

                      <div className="bg-white/90 p-2.5 rounded-xl border border-red-300 shadow-sm">
                        <span className="text-[10px] font-black uppercase tracking-wider text-red-500 block mb-0.5">
                          Mobile Number (TP)
                        </span>
                        <span className="font-mono font-black text-red-700 text-sm">
                          {duplicateClientMatch.phone || duplicateClientMatch.mobile || 'No Mobile Number'}
                        </span>
                      </div>

                      <div className="bg-white/90 p-2.5 rounded-xl border border-red-300 shadow-sm">
                        <span className="text-[10px] font-black uppercase tracking-wider text-red-500 block mb-0.5">
                          Registered Branch
                        </span>
                        <span className="font-black text-red-700 text-xs uppercase">
                          {duplicateClientMatch.branch_id || duplicateClientMatch.branchId || 'Head Office / HQ'}
                        </span>
                      </div>

                      <div className="bg-white/90 p-2.5 rounded-xl border border-red-300 shadow-sm sm:col-span-2">
                        <span className="text-[10px] font-black uppercase tracking-wider text-red-500 block mb-0.5">
                          Permanent Address
                        </span>
                        <span className="font-bold text-red-700 text-xs">
                          {duplicateClientMatch.address || duplicateClientMatch.address_line1 || 'No Address Recorded'}
                        </span>
                      </div>
                    </div>

                    {/* Action button inside red card */}
                    <div className="pt-1 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-red-600">
                        Click below to view or edit this customer profile:
                      </span>
                      <Button
                        type="button"
                        onClick={() => {
                          openEditDialog(duplicateClientMatch);
                          toast.info('Switched to existing customer record ✓');
                        }}
                        className="bg-red-600 hover:bg-red-700 text-white font-black text-xs uppercase tracking-wider h-9 px-4 rounded-xl shadow-md gap-1.5 cursor-pointer shrink-0"
                      >
                        <Pencil className="w-4 h-4" />
                        <span>Edit Existing Record</span>
                      </Button>
                    </div>
                  </div>
                )}

                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label 
                      htmlFor="nic" 
                      className={`font-black text-[10px] uppercase tracking-widest ${isDuplicateClientNic ? 'text-red-600' : 'text-slate-400'}`}
                    >
                      NIC Number (Primary Key)
                    </Label>
                    {isDuplicateClientNic && (
                      <span className="text-[10px] font-black text-red-600 flex items-center gap-1 uppercase tracking-wider animate-pulse">
                        <AlertTriangle className="w-3 h-3 stroke-[2.5]" /> Exists in DB
                      </span>
                    )}
                  </div>
                  <Input 
                    value={nic} 
                    onChange={e=>setNic(e.target.value)} 
                    id="nic" 
                    placeholder="e.g. 941234567V or 199412345678" 
                    className={`h-11 rounded-xl font-mono font-bold text-xs sm:text-sm transition-all ${
                      isDuplicateClientNic 
                        ? 'border-2 border-red-500 bg-red-50/70 text-red-700 focus:border-red-600 focus:ring-red-400/20' 
                        : 'bg-white/50 text-slate-800'
                    }`} 
                  />
                </div>
                
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="firstName" className="font-black text-[10px] uppercase tracking-widest text-slate-400">Name with Initials</Label>
                    {duplicateClientMatch && (
                      <span className="text-[10px] font-bold text-red-600">
                        Existing: {`${duplicateClientMatch.first_name || duplicateClientMatch.firstName || ''} ${duplicateClientMatch.last_name || duplicateClientMatch.lastName || ''}`.trim()}
                      </span>
                    )}
                  </div>
                  <Input value={firstName} onChange={e=>setFirstName(e.target.value)} id="firstName" placeholder="e.g. A.B.C. Perera" className="h-11 bg-white/50 rounded-xl font-bold text-slate-800 text-xs sm:text-sm" />
                </div>

                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label 
                      htmlFor="phone" 
                      className="font-black text-[10px] uppercase tracking-widest text-slate-400"
                    >
                      TP (Phone Number)
                    </Label>
                    <div className="flex items-center gap-2">
                      {sharedPhoneClient && (
                        <span className="text-[10px] font-bold text-amber-600 flex items-center gap-1 uppercase tracking-wider">
                          <AlertTriangle className="w-3 h-3 stroke-[2]" /> Shared with {sharedPhoneClient.first_name || sharedPhoneClient.firstName || 'Customer'}
                        </span>
                      )}
                      <span className={`text-[10px] font-mono font-bold ${(phone || '').replace(/\D/g, '').length >= 10 ? 'text-emerald-600' : 'text-slate-400'}`}>
                        {(phone || '').replace(/\D/g, '').length >= 10 ? '✓ ' : ''}
                        {(phone || '').replace(/\D/g, '').length}/10 digits
                      </span>
                    </div>
                  </div>
                  <Input 
                    value={phone} 
                    onChange={e => {
                      const val = e.target.value;
                      const digits = val.replace(/\D/g, '');
                      if (digits.length <= 12) {
                        setPhone(val);
                      }
                    }} 
                    id="phone" 
                    placeholder="e.g. 077 123 4567" 
                    className="h-11 rounded-xl font-mono font-bold text-xs sm:text-sm bg-white/50 text-slate-800 focus:border-amber-500 focus:ring-amber-400/20" 
                  />
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="address" className="font-black text-[10px] uppercase tracking-widest text-slate-400">Address</Label>
                  <textarea 
                    value={address} 
                    onChange={e=>setAddress(e.target.value)} 
                    id="address" 
                    placeholder="Enter customer permanent address..." 
                    className="w-full h-20 sm:h-24 p-3 bg-white/50 border border-slate-200 rounded-xl font-bold text-slate-800 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none" 
                  />
                </div>
              </div>

              {/* Right Column: Smart Tabbed Switcher (NIC Front, NIC Back, Signature) */}
              <div className="space-y-4">
                {/* Segmented Control Tabs */}
                <div className="flex flex-wrap sm:grid sm:grid-cols-3 gap-1.5 p-1.5 bg-slate-100 rounded-xl border border-slate-200 shadow-inner w-full">
                  <button
                    type="button"
                    onClick={() => setActiveKycTab('nic_front')}
                    className={`flex-1 min-w-[100px] py-2 px-2 sm:px-3 text-[11px] sm:text-xs font-black uppercase tracking-tight sm:tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer rounded-lg ${
                      activeKycTab === 'nic_front'
                        ? 'bg-[#ffd100] text-[#202020] shadow-sm'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                    }`}
                  >
                    <span className="flex items-center gap-1 truncate">
                      <span>🪪</span> 
                      <span className="truncate">NIC Front</span>
                      {nicFrontImage ? (
                        <Check className="w-3 h-3 text-emerald-700 inline-block stroke-[3] shrink-0" />
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-600 inline-block shrink-0" />
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveKycTab('nic_back')}
                    className={`flex-1 min-w-[100px] py-2 px-2 sm:px-3 text-[11px] sm:text-xs font-black uppercase tracking-tight sm:tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer rounded-lg ${
                      activeKycTab === 'nic_back'
                        ? 'bg-[#ffd100] text-[#202020] shadow-sm'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                    }`}
                  >
                    <span className="flex items-center gap-1 truncate">
                      <span>🪪</span> 
                      <span className="truncate">NIC Back</span>
                      {nicBackImage ? (
                        <Check className="w-3 h-3 text-emerald-700 inline-block stroke-[3] shrink-0" />
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-600 inline-block shrink-0" />
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveKycTab('signature')}
                    className={`flex-1 min-w-[100px] py-2 px-2 sm:px-3 text-[11px] sm:text-xs font-black uppercase tracking-tight sm:tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer rounded-lg ${
                      activeKycTab === 'signature'
                        ? 'bg-[#ffd100] text-[#202020] shadow-sm'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                    }`}
                  >
                    <span className="flex items-center gap-1 truncate">
                      <span>✍️</span> 
                      <span className="truncate">Signature</span>
                      {signatureImage ? (
                        <Check className="w-3 h-3 text-emerald-700 inline-block stroke-[3] shrink-0" />
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-600 inline-block shrink-0" />
                      )}
                    </span>
                  </button>
                </div>

                {/* KYC Photo Capture Box */}
                <div className="w-full">
                  {activeKycTab === 'nic_front' && (
                    <SmartNicScanner 
                      key="nic_front_capture"
                      label="NIC Front Side Photo" 
                      onCapture={(base64) => setNicFrontImage(base64)} 
                      initialImage={nicFrontImage} 
                      autoStart={true}
                    />
                  )}

                  {activeKycTab === 'nic_back' && (
                    <SmartNicScanner 
                      key="nic_back_capture"
                      label="NIC Back Side Photo" 
                      onCapture={(base64) => setNicBackImage(base64)} 
                      initialImage={nicBackImage} 
                      autoStart={true}
                    />
                  )}

                  {activeKycTab === 'signature' && (
                    <SmartNicScanner 
                      key="signature_capture"
                      label="Customer Signature Photo" 
                      onCapture={(base64) => setSignatureImage(base64)} 
                      initialImage={signatureImage} 
                      autoStart={true}
                      isSignature={true}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Fixed Footer */}
          <div className="p-3 sm:p-5 border-t border-slate-200/90 bg-white/95 backdrop-blur-md shrink-0 flex flex-col sm:flex-row justify-between items-center gap-2.5 sm:gap-3 z-30 shadow-[0_-4px_12px_rgba(0,0,0,0.04)]">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 w-full sm:w-auto justify-center sm:justify-start">
              {(!nicFrontImage || !nicBackImage || !signatureImage) ? (
                <span className="flex items-center gap-1.5 text-amber-800 bg-amber-50 border border-amber-300/80 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl text-[10px] sm:text-[11px] font-bold w-full sm:w-auto justify-center sm:justify-start">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span className="truncate">Required: {!nicFrontImage ? 'NIC Front' : ''} {!nicBackImage ? (!nicFrontImage ? '• NIC Back' : 'NIC Back') : ''} {!signatureImage ? (!nicFrontImage || !nicBackImage ? '• Signature' : 'Signature') : ''}</span>
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
                variant="outline" 
                className="font-bold text-slate-600 h-10 sm:h-11 rounded-xl flex-1 sm:flex-none border-slate-200 text-xs sm:text-sm" 
                onClick={() => { setIsOpen(false); setEditingClient(null); }}
              >
                Cancel
              </Button>
              <Button 
                disabled={isSaving}
                onClick={handleSave} 
                className={`${
                  duplicateClientMatch
                    ? "bg-red-600 hover:bg-red-700 text-white shadow-red-600/20"
                    : "bg-[#ffd100] hover:bg-[#ffee32] text-[#202020] shadow-black/10"
                } font-black px-5 sm:px-8 h-10 sm:h-11 rounded-xl shadow-lg gap-1.5 sm:gap-2 cursor-pointer flex-[2] sm:flex-none transition-all text-xs sm:text-sm`}
              >
                {isSaving ? <RefreshCcw className="w-4 h-4 animate-spin shrink-0" /> : null}
                <span className="truncate">
                  {isSaving 
                    ? "Saving..." 
                    : duplicateClientMatch 
                      ? "Customer Exists - Edit" 
                      : (editingClient ? "Update Customer" : "Register Customer")}
                </span>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Directory Controls */}
      <div className="flex flex-col md:flex-row items-center gap-4">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search all customers by Name, NIC, TP, Address, or Branch..." 
            className="pl-12 h-14 bg-white/50 border-white/40 glass focus:ring-primary shadow-lg shadow-slate-200/50 rounded-2xl font-bold" 
          />
        </div>
        <div className="relative w-full md:w-auto shrink-0 min-w-[240px]" ref={branchDropdownRef}>
          {/* Maroon/Primary Filter Trigger Button */}
          <button
            type="button"
            id="clients-branch-filter-btn"
            onClick={() => setIsBranchFilterOpen(!isBranchFilterOpen)}
            className={`h-14 w-full px-5 pr-11 bg-white/90 border ${
              isBranchFilterOpen ? 'border-primary ring-2 ring-primary/20' : 'border-slate-200'
            } glass font-black text-xs uppercase tracking-wider text-slate-800 rounded-2xl shadow-sm hover:border-primary/60 transition-all flex items-center justify-between cursor-pointer select-none`}
          >
            <div className="flex items-center gap-2 truncate">
              <span className="truncate">{getBranchButtonLabel()}</span>
              {!selectedBranches.includes('ALL') && selectedBranches.length > 0 && (
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              )}
            </div>
            <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-primary">
              <Filter className="w-4 h-4" />
            </div>
          </button>

          {/* Interactive Multi-Select Popover Card */}
          {isBranchFilterOpen && (
            <div className="absolute right-0 top-16 z-50 w-80 bg-white/95 backdrop-blur-xl border border-slate-200/90 shadow-2xl rounded-2xl p-3.5 space-y-3 animate-in fade-in zoom-in-95 duration-150">
              {/* Card Header & Quick Actions */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-amber-600" />
                  <span className="text-[11px] font-black uppercase tracking-wider text-slate-700">Select Branches</span>
                </div>
                <div className="flex items-center gap-1">
                  {branchId && (
                    <button
                      type="button"
                      onClick={selectHomeBranchOnly}
                      className="text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-lg bg-slate-100 hover:bg-[#ffd100] hover:text-[#202020] text-slate-600 transition-colors cursor-pointer"
                      title="Reset to only your home branch"
                    >
                      My Branch
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={selectAllBranches}
                    className="text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-lg bg-slate-100 hover:bg-[#ffd100] hover:text-[#202020] text-slate-600 transition-colors cursor-pointer"
                    title="Select all branches"
                  >
                    All
                  </button>
                </div>
              </div>

              {/* All Branches Option */}
              <div
                onClick={() => toggleBranch('ALL')}
                className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition-colors ${
                  selectedBranches.includes('ALL')
                    ? 'bg-amber-50 text-amber-900 font-black'
                    : 'hover:bg-slate-50 text-slate-700 font-bold'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div className={`w-4 h-4 rounded-md border flex items-center justify-center transition-colors ${
                    selectedBranches.includes('ALL')
                      ? 'bg-[#ffd100] border-amber-500 text-[#202020]'
                      : 'border-slate-300 bg-white'
                  }`}>
                    {selectedBranches.includes('ALL') && <Check className="w-3 h-3 stroke-[3]" />}
                  </div>
                  <span className="text-xs">All Branches (Global Directory)</span>
                </div>
                <Badge variant="outline" className="text-[9px] font-black uppercase tracking-wider">ALL</Badge>
              </div>

              <div className="h-px bg-slate-100 my-1" />

              {/* Branch Checklist */}
              <div className="max-h-56 overflow-y-auto space-y-1 pr-1 overscroll-contain">
                {branches.filter(b => b.id !== 'ALL').map((b: any) => {
                  const isTicked = selectedBranches.includes('ALL') || selectedBranches.some(bCode => bCode.toUpperCase() === b.id.toUpperCase());
                  const isHome = branchId && b.id.toUpperCase() === branchId.toUpperCase();
                  return (
                    <div
                      key={b.id}
                      onClick={() => toggleBranch(b.id)}
                      className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition-colors ${
                        isTicked
                          ? 'bg-slate-50 text-slate-900 font-black'
                          : 'hover:bg-slate-50 text-slate-600 font-medium'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className={`w-4 h-4 rounded-md border flex items-center justify-center transition-colors ${
                          isTicked
                            ? 'bg-[#ffd100] border-amber-500 text-[#202020]'
                            : 'border-slate-300 bg-white'
                        }`}>
                          {isTicked && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>
                        <span className="text-xs">{b.name || b.id} Branch</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {isHome && (
                          <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                            HOME
                          </span>
                        )}
                        <span className="text-[10px] font-mono font-bold text-slate-400 uppercase">
                          {b.id}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Popover Footer */}
              <div className="border-t border-slate-100 pt-2 flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-400">
                  {clients.length} customer{clients.length === 1 ? '' : 's'} loaded
                </span>
                <button
                  type="button"
                  onClick={() => setIsBranchFilterOpen(false)}
                  className="px-3 py-1 bg-[#ffd100] text-[#202020] text-[10px] font-black uppercase tracking-wider rounded-lg shadow-sm hover:bg-[#ffee32] transition-colors cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
        <Button 
          onClick={() => setIsOpen(true)} 
          className="gap-2 bg-[#ffd100] hover:bg-[#ffee32] h-12 px-7 text-[#202020] font-black uppercase tracking-widest text-xs shadow-lg card-hover w-full md:w-auto shrink-0 transition-all rounded-2xl cursor-pointer"
        >
          <UserPlus className="h-4 w-4" /> Add New Customer
        </Button>
      </div>

      {/* Table Section */}
      <div className="w-full glass border-white/40 rounded-[2rem] shadow-2xl min-h-[420px] flex flex-col bg-white/40 overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-50/50 border-b border-slate-100">
            <TableRow>
              <TableHead className="px-4 py-4 font-black text-[10px] uppercase tracking-widest text-slate-400">NIC Number</TableHead>
              <TableHead className="px-4 py-4 font-black text-[10px] uppercase tracking-widest text-slate-400">Name & TP</TableHead>
              <TableHead className="px-3 py-4 font-black text-[10px] uppercase tracking-widest text-slate-400">Branch</TableHead>
              <TableHead className="px-4 py-4 font-black text-[10px] uppercase tracking-widest text-slate-400">Address</TableHead>
              <TableHead className="px-4 py-4 font-black text-[10px] uppercase tracking-widest text-slate-400">Webcam KYC Scans</TableHead>
              <TableHead className="px-3 py-4 font-black text-[10px] uppercase tracking-widest text-slate-400">Status</TableHead>
              <TableHead className="px-3 py-4 font-black text-[10px] uppercase tracking-widest text-slate-400">Joined Date</TableHead>
              <TableHead className="px-3 py-4"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-slate-50">
            {loading ? (
               <TableRow><TableCell colSpan={8} className="h-64 text-center font-black text-slate-300 animate-pulse tracking-widest uppercase">Initializing directory metadata...</TableCell></TableRow>
            ) : filteredClients.length === 0 ? (
               <TableRow>
                 <TableCell colSpan={8} className="h-64 text-center">
                    <p className="text-slate-400 font-bold mb-4">No customer records found in selected branch(es).</p>
                    {searchQuery.trim() && !selectedBranches.includes('ALL') && (
                      <div className="mb-4">
                        <Button
                          type="button"
                          onClick={selectAllBranches}
                          className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs uppercase tracking-widest h-11 rounded-xl shadow-md gap-2"
                        >
                          <Search className="w-4 h-4" />
                          Search Across All Branches
                        </Button>
                      </div>
                    )}
                    <Button variant="outline" onClick={() => setIsOpen(true)} className="border-amber-300 text-slate-900 font-black text-[10px] uppercase tracking-widest h-11 rounded-xl hover:bg-[#ffd100] hover:text-[#202020] transition-all px-8">Generate First Entry</Button>
                 </TableCell>
               </TableRow>
            ) : (
              filteredClients.map((client) => (
                <TableRow key={client.id} className="group hover:bg-amber-50/40 transition-all duration-300">
                  <TableCell className="px-4 py-4 font-black text-slate-900 group-hover:text-amber-700 transition-colors underline decoration-amber-500/20 underline-offset-4">
                    {client.display_national_id || stripBranchPrefix(client.national_id || client.nationalId) || 'N/A'}
                  </TableCell>
                  <TableCell className="px-4 py-4">
                    <div className="flex flex-col">
                      {(() => {
                        const rawName = (client.first_name || client.firstName || '').trim();
                        const lastName = (client.last_name || client.lastName || '').trim();
                        const isPlaceholder = !rawName || rawName === 'Valued Customer' || rawName === '.';
                        const fullName = isPlaceholder ? '' : [rawName, lastName === '.' ? '' : lastName].filter(Boolean).join(' ');
                        return isPlaceholder ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-100 border border-dashed border-slate-300 text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">No Name</span>
                        ) : (
                          <span className="font-bold text-slate-800 leading-none mb-1">{fullName}</span>
                        );
                      })()}
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{client.phone || 'No Phone'}</span>
                    </div>
                  </TableCell>
                  <TableCell className="px-3 py-4">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-100 border border-slate-200/80 font-black text-[10px] uppercase tracking-wider text-slate-700 shadow-xs">
                      <MapPin className="w-3 h-3 text-amber-600 shrink-0" />
                      <span>{client.branch_id || client.branchId || 'HQ'}</span>
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-4 max-w-[220px] whitespace-normal break-words text-slate-500 font-bold text-xs">{client.address || 'No Address'}</TableCell>
                  <TableCell className="px-4 py-4">
                    <div className="flex items-center gap-2">
                      {(() => {
                        let nicFront: string | null = null;
                        let nicBack: string | null = null;
                        if (client.nic_image) {
                          try {
                            const parsed = JSON.parse(client.nic_image);
                            nicFront = parsed.front || null;
                            nicBack = parsed.back || null;
                          } catch (e) {
                            nicFront = client.nic_image;
                          }
                        }

                        const isRealImage = (src?: string | null) => 
                          Boolean(src && (src.startsWith('data:') || src.startsWith('http:') || src.startsWith('https:') || src.startsWith('/')));

                        const hasFront = Boolean(isRealImage(nicFront) || nicFront === 'captured' || client.has_nic_image);
                        const hasBack = Boolean(isRealImage(nicBack) || nicBack === 'captured');
                        const hasSig = Boolean(isRealImage(client.signature_image) || client.signature_image === 'captured' || client.has_signature);

                        const handleOpenViewer = async () => {
                          const needsFetch = (!isRealImage(nicFront) && hasFront) || (!isRealImage(client.signature_image) && hasSig);

                          setPhotoViewerClient({
                            isOpen: true,
                            clientId: client.id,
                            name: `${client.first_name || client.firstName || ''} ${client.last_name || client.lastName || ''}`.trim() || 'Customer',
                            nic: client.national_id || client.nationalId || 'N/A',
                            front: isRealImage(nicFront) ? nicFront : null,
                            back: isRealImage(nicBack) ? nicBack : null,
                            signature: isRealImage(client.signature_image) ? client.signature_image : null,
                            isLoading: needsFetch,
                          });

                          if (needsFetch && client.id) {
                            try {
                              const res = await fetch(`/api/clients/${client.id}`, { headers: getAuthHeaders() });
                              if (res.ok) {
                                const full = await res.json();
                                let fFront: string | null = null;
                                let fBack: string | null = null;
                                if (full.nic_image) {
                                  try {
                                    const p = JSON.parse(full.nic_image);
                                    fFront = p.front || null;
                                    fBack = p.back || null;
                                  } catch {
                                    fFront = full.nic_image;
                                  }
                                }
                                setPhotoViewerClient(prev => ({
                                  ...prev,
                                  front: fFront,
                                  back: fBack,
                                  signature: full.signature_image || null,
                                  isLoading: false,
                                }));
                              } else {
                                setPhotoViewerClient(prev => ({ ...prev, isLoading: false }));
                              }
                            } catch {
                              setPhotoViewerClient(prev => ({ ...prev, isLoading: false }));
                            }
                          }
                        };

                        return (
                          <>
                            {/* Front Scan */}
                            {isRealImage(nicFront) ? (
                              <div onClick={handleOpenViewer} className="relative group/thumb cursor-pointer" title="Click to view full photo">
                                <img src={nicFront!} alt="NIC Front" className="w-9 h-7 rounded-lg object-cover border border-slate-200 shadow-xs transition-transform group-hover/thumb:scale-125" />
                              </div>
                            ) : hasFront ? (
                              <button type="button" onClick={handleOpenViewer} className="h-7 px-2 rounded-md bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/80 text-emerald-700 flex items-center gap-1 cursor-pointer transition-all shadow-xs" title="Webcam NIC Front captured. Click to view">
                                <Camera className="w-3 h-3 text-emerald-600" />
                                <span className="text-[9px] font-black uppercase tracking-wider">Front</span>
                              </button>
                            ) : (
                              <div className="w-7 h-7 bg-slate-100 rounded-md flex items-center justify-center border border-dashed border-slate-200" title="No NIC Front Scan">
                                <CameraOff className="w-3 h-3 text-slate-300" />
                              </div>
                            )}

                            {/* Back Scan */}
                            {isRealImage(nicBack) ? (
                              <div onClick={handleOpenViewer} className="relative group/thumb cursor-pointer" title="Click to view full photo">
                                <img src={nicBack!} alt="NIC Back" className="w-9 h-7 rounded-lg object-cover border border-slate-200 shadow-xs transition-transform group-hover/thumb:scale-125" />
                              </div>
                            ) : hasBack ? (
                              <button type="button" onClick={handleOpenViewer} className="h-7 px-2 rounded-md bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/80 text-emerald-700 flex items-center gap-1 cursor-pointer transition-all shadow-xs" title="Webcam NIC Back captured. Click to view">
                                <Camera className="w-3 h-3 text-emerald-600" />
                                <span className="text-[9px] font-black uppercase tracking-wider">Back</span>
                              </button>
                            ) : (
                              <div className="w-7 h-7 bg-slate-100 rounded-md flex items-center justify-center border border-dashed border-slate-200" title="No NIC Back Scan">
                                <CameraOff className="w-3 h-3 text-slate-300" />
                              </div>
                            )}

                            {/* Signature Scan */}
                            {isRealImage(client.signature_image) ? (
                              <div onClick={handleOpenViewer} className="relative group/thumb cursor-pointer" title="Click to view signature">
                                <img src={client.signature_image} alt="Signature" className="w-9 h-7 rounded-lg object-cover border border-slate-200 shadow-xs transition-transform group-hover/thumb:scale-125" />
                              </div>
                            ) : hasSig ? (
                              <button type="button" onClick={handleOpenViewer} className="h-7 px-2 rounded-md bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/80 text-indigo-700 flex items-center gap-1 cursor-pointer transition-all shadow-xs" title="Webcam Signature captured. Click to view">
                                <CheckCircle2 className="w-3 h-3 text-indigo-600" />
                                <span className="text-[9px] font-black uppercase tracking-wider">Sig</span>
                              </button>
                            ) : (
                              <div className="w-7 h-7 bg-slate-100 rounded-md flex items-center justify-center border border-dashed border-slate-200" title="No Signature Scan">
                                <CameraOff className="w-3 h-3 text-slate-300" />
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </TableCell>
                  <TableCell className="px-3 py-4">
                    {(() => {
                      let hasFront = false;
                      let hasBack = false;
                      if (client.nic_image) {
                        try {
                          const parsed = JSON.parse(client.nic_image);
                          hasFront = !!parsed.front;
                          hasBack = !!parsed.back;
                        } catch (e) {
                          hasFront = true; // Legacy fallback is marked complete
                          hasBack = true;
                        }
                      }
                      const kycComplete = hasFront && hasBack && !!client.signature_image;
                      return (
                        <Badge className={`border font-black text-[9px] uppercase tracking-widest px-3 ${
                          kycComplete
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                            : 'bg-amber-50 text-amber-700 border-amber-100'
                        }`}>
                          {kycComplete ? 'KYC Verified' : 'Pending KYC'}
                        </Badge>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="px-3 py-4 text-slate-500 font-bold text-xs uppercase tracking-widest">
                    {(client.created_at || client.createdAt) ? new Date(client.created_at || client.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A'}
                  </TableCell>
                  <TableCell className="px-3 py-4 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger className="text-slate-500 hover:text-amber-700 hover:bg-amber-50 transition-all h-10 w-10 rounded-xl inline-flex items-center justify-center border border-slate-200/70 bg-white cursor-pointer outline-none">
                         <MoreVertical className="w-4 h-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48 glass p-2 rounded-2xl border-white/40 shadow-2xl">
                        <div className="px-4 py-2 font-black text-[9px] uppercase tracking-widest text-slate-400">Operations</div>
                        <DropdownMenuSeparator className="bg-slate-100/50" />
                        <DropdownMenuItem onClick={() => openEditDialog(client)} className="gap-3 px-4 py-3 rounded-xl font-bold text-slate-700 hover:bg-amber-50 hover:text-amber-900 transition-colors cursor-pointer outline-none">
                          <Pencil className="w-4 h-4" /> Edit Profile
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openAgreementDialog(client)} className="gap-3 px-4 py-3 rounded-xl font-bold text-slate-700 hover:bg-amber-50 hover:text-amber-900 transition-colors cursor-pointer outline-none">
                          <FileText className="w-4 h-4 text-blue-600" /> Loan Agreement
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDelete(client)} className="gap-3 px-4 py-3 rounded-xl font-bold text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer">
                          <Trash2 className="w-4 h-4" /> Delete Record
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* MODAL: CUSTOMER REGISTRY */}
      <Dialog open={showCustomerRegistryModal} onOpenChange={setShowCustomerRegistryModal}>
        <DialogContent className="w-[96vw] max-w-[96vw] sm:max-w-[750px] bg-white border border-slate-200 shadow-2xl p-0 overflow-hidden rounded-2xl sm:rounded-[2.5rem] max-h-[85vh] flex flex-col">
          <div className="h-2 bg-blue-600 shrink-0" />
          <div className="p-4 sm:p-6 pb-2 shrink-0 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <DialogHeader>
              <DialogTitle className="text-xl sm:text-2xl font-black tracking-tighter flex items-center gap-3 text-slate-900">
                <div className="h-10 w-10 bg-blue-50 rounded-xl flex items-center justify-center border border-blue-100 text-blue-600 shrink-0">
                  <Users className="h-5 w-5" />
                </div>
                <span>Customer Registry</span>
              </DialogTitle>
              <DialogDescription className="font-medium text-slate-500 text-xs sm:text-sm">
                Manage profile details and associated bill numbers for active vault customers.
              </DialogDescription>
            </DialogHeader>
            <Button 
              onClick={() => openAddCustomerModal("")}
              className="bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest text-[9px] h-9 px-4 rounded-xl flex items-center gap-1.5 cursor-pointer shadow-md w-full sm:w-auto justify-center"
            >
              <UserPlus className="w-3.5 h-3.5" /> Add Profile
            </Button>
          </div>

          {/* Search bar inside Registry */}
          <div className="px-4 sm:px-6 py-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input 
                placeholder="Search customers by name, phone or NIC..." 
                className="pl-9 h-9 rounded-xl bg-slate-50 border-slate-200 font-medium text-xs"
                value={customerSearchQuery}
                onChange={(e) => setCustomerSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-2">
            {(() => {
              const filtered = stockCustomers.filter(c => 
                (c.name || "").toLowerCase().includes(customerSearchQuery.toLowerCase()) ||
                (c.tp || "").toLowerCase().includes(customerSearchQuery.toLowerCase()) ||
                (c.nic || "").toLowerCase().includes(customerSearchQuery.toLowerCase()) ||
                (c.address || "").toLowerCase().includes(customerSearchQuery.toLowerCase()) ||
                (c.bill_numbers || "").toLowerCase().includes(customerSearchQuery.toLowerCase())
              );

              if (loading) {
                return <div className="py-12 text-center text-xs font-bold text-slate-400 animate-pulse">Loading active vault customer records...</div>;
              }

              if (filtered.length === 0) {
                return <div className="py-12 text-center text-xs font-bold text-slate-400">No registered vault customers found.</div>;
              }

              return (
                <div className="space-y-3 pb-6">
                  <Table>
                    <TableHeader className="bg-slate-50">
                      <TableRow>
                        <TableHead className="font-black text-[10px] uppercase text-slate-400">Customer</TableHead>
                        <TableHead className="font-black text-[10px] uppercase text-slate-400">Contact</TableHead>
                        <TableHead className="font-black text-[10px] uppercase text-slate-400">Bills Associated</TableHead>
                        <TableHead className="font-black text-[10px] uppercase text-slate-400 text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map(cust => (
                        <TableRow key={cust.id} className="hover:bg-slate-50/80">
                          <TableCell className="font-bold text-xs">
                            <div className="text-slate-900">{cust.name}</div>
                            {cust.nic && <div className="text-[10px] font-mono text-slate-400">{cust.nic}</div>}
                          </TableCell>
                          <TableCell className="text-xs">
                            <div className="font-mono text-slate-700">{cust.tp || 'N/A'}</div>
                            <div className="text-[10px] text-slate-400 truncate max-w-[150px]">{cust.address || ''}</div>
                          </TableCell>
                          <TableCell className="text-xs">
                            {cust.bill_numbers ? (
                              <div className="flex flex-wrap gap-1 max-w-[200px]">
                                {cust.bill_numbers.split(',').map((b: string, i: number) => (
                                  <span key={i} className="px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded text-[9px] font-mono font-bold">
                                    {b.trim()}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-[10px] text-slate-300 italic">No bills linked</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => openEditCustomerModal(cust)}
                                className="h-7 w-7 p-0 text-slate-400 hover:text-blue-600 rounded-lg"
                                title="Edit Customer Profile"
                              >
                                <Edit className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDeleteCustomer(cust.id)}
                                className="h-7 w-7 p-0 text-slate-400 hover:text-rose-600 rounded-lg"
                                title="Delete Customer Profile"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              );
            })()}
          </div>

          <div className="p-4 sm:p-6 bg-slate-50 border-t border-slate-100 flex justify-end shrink-0">
            <Button onClick={() => setShowCustomerRegistryModal(false)} className="rounded-xl font-bold w-full sm:w-auto">Close Registry</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* MODAL: ADD/EDIT CUSTOMER */}
      <Dialog open={showAddCustomerModal} onOpenChange={setShowAddCustomerModal}>
        <DialogContent className="w-[96vw] max-w-[96vw] sm:max-w-[480px] bg-white border border-slate-200 shadow-2xl p-0 overflow-hidden rounded-2xl sm:rounded-[2.5rem] max-h-[90vh] flex flex-col">
          <div className="h-2 bg-blue-600 shrink-0" />
          <div className="p-4 sm:p-6 pb-2 shrink-0">
            <DialogHeader>
              <DialogTitle className="text-lg sm:text-xl font-black tracking-tighter flex items-center gap-3 text-slate-900">
                <div className="h-9 w-9 bg-blue-50 rounded-lg flex items-center justify-center border border-blue-100 text-blue-600 shrink-0">
                  <UserPlus className="h-4.5 w-4.5" />
                </div>
                <span>{isEditingCustomer ? "Edit Customer Profile" : "Register Customer Profile"}</span>
              </DialogTitle>
              <DialogDescription className="font-medium text-slate-500 text-xs">
                Associate customer contact details and addresses with active vault stock bills.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-2 space-y-4">
            <div className="grid gap-4 pb-4">
              
              {/* Customer Name */}
              <div className="grid gap-1.5 relative">
                <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Customer Name</Label>
                <div className="relative">
                  <Input 
                    value={custName} 
                    onChange={e => handleNameChange(e.target.value)} 
                    placeholder="E.g. Saman Kumara" 
                    className="h-10 border-slate-200 rounded-xl font-bold text-xs" 
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
                  className="h-10 border-slate-200 rounded-xl font-bold text-xs" 
                />
              </div>

              {/* NIC */}
              <div className="grid gap-1.5">
                <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">NIC (Optional)</Label>
                <Input 
                  value={custNic} 
                  onChange={e => setCustNic(e.target.value)} 
                  placeholder="E.g. 941234567V" 
                  className="h-10 border-slate-200 rounded-xl font-bold text-xs" 
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

      {/* MODAL: DIGITAL LOAN AGREEMENT SIGNER */}
      <Dialog open={showAgreementModal} onOpenChange={setShowAgreementModal}>
        <DialogContent className="sm:max-w-[500px] bg-white border border-slate-200 shadow-2xl p-0 overflow-hidden rounded-[2.5rem] max-h-[90vh] flex flex-col">
          <div className="h-2 bg-blue-600 shrink-0" />
          <div className="p-6 pb-2 shrink-0">
            <DialogHeader>
              <DialogTitle className="text-xl font-black tracking-tighter flex items-center gap-3 text-slate-900">
                <div className="h-9 w-9 bg-blue-50 rounded-lg flex items-center justify-center border border-blue-100 text-blue-600">
                  <FileText className="h-4.5 w-4.5" />
                </div>
                Digital Loan Agreement Signer
              </DialogTitle>
              <DialogDescription className="font-medium text-slate-500 text-xs">
                Fill in the details to customize and electronically sign the 11-page Loan Agreement document.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-2 space-y-4">
            <div className="grid gap-4 pb-4">
              
              {/* Client / Agreement Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-1.5">
                  <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Agreement Date</Label>
                  <Input 
                    type="date"
                    value={agreementDate} 
                    onChange={e => setAgreementDate(e.target.value)} 
                    className="h-10 border-slate-200 rounded-xl font-bold text-xs" 
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Client Number / Code</Label>
                  <Input 
                    value={agreementClientNum} 
                    onChange={e => setAgreementClientNum(e.target.value)} 
                    placeholder="E.g. CLI-002"
                    className="h-10 border-slate-200 rounded-xl font-bold text-xs" 
                  />
                </div>
              </div>

              {/* Borrower Details */}
              <div className="grid gap-1.5">
                <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Borrower Full Name</Label>
                <Input 
                  value={agreementBorrowerName} 
                  onChange={e => setAgreementBorrowerName(e.target.value)} 
                  className="h-10 border-slate-200 rounded-xl font-bold text-xs" 
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-1.5">
                  <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">NIC Number</Label>
                  <Input 
                    value={agreementNic} 
                    onChange={e => setAgreementNic(e.target.value)} 
                    className="h-10 border-slate-200 rounded-xl font-bold text-xs" 
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Approved Loan Limit (LKR)</Label>
                  <Input 
                    type="number"
                    value={agreementLoanLimit} 
                    onChange={e => setAgreementLoanLimit(e.target.value)} 
                    className="h-10 border-slate-200 rounded-xl font-bold text-xs" 
                  />
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Residential Address</Label>
                <Input 
                  value={agreementAddress} 
                  onChange={e => setAgreementAddress(e.target.value)} 
                  className="h-10 border-slate-200 rounded-xl font-bold text-xs" 
                />
              </div>

              {/* Interest and Service Fee Config */}
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-1.5">
                  <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Loan Service Fee (%)</Label>
                  <Input 
                    type="number"
                    step="0.1"
                    value={agreementServiceFee} 
                    onChange={e => setAgreementServiceFee(e.target.value)} 
                    className="h-10 border-slate-200 rounded-xl font-bold text-xs" 
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="font-black text-[10px] uppercase tracking-widest text-slate-400">Interest Rate (%)</Label>
                  <Input 
                    type="number"
                    value={agreementInterest} 
                    onChange={e => setAgreementInterest(e.target.value)} 
                    className="h-10 border-slate-200 rounded-xl font-bold text-xs" 
                    disabled
                  />
                  <span className="text-[9px] font-bold text-slate-400">Interest is set to 0% as per Agreement Clause 4.2.</span>
                </div>
              </div>

              {/* SMS Verification (Signature Code) */}
              <div className="grid gap-1.5 bg-slate-50 p-4 rounded-2xl border border-slate-200/50">
                <Label className="font-black text-[10px] uppercase tracking-widest text-blue-600 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5" /> SMS Verification Code (Electronic Signature)
                </Label>
                <Input 
                  value={agreementCode} 
                  onChange={e => setAgreementCode(e.target.value)} 
                  placeholder="Enter 6-digit signature code" 
                  className="h-10 border-blue-200 rounded-xl font-black text-center text-sm tracking-widest bg-white" 
                />
                <span className="text-[9px] font-semibold text-slate-500 leading-normal mt-0.5">
                  This code acts as the electronic signature of the Borrower under the Electronic Transactions Act No. 19 of 2006.
                </span>
              </div>

            </div>
          </div>

          <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3 shrink-0">
            <Button variant="outline" onClick={() => setShowAgreementModal(false)} className="rounded-xl font-bold">Cancel</Button>
            <Button 
              onClick={handleGenerateAgreement} 
              className="bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest text-[9px] h-10 px-5 rounded-xl shadow-lg cursor-pointer"
            >
              Generate & Print PDF
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Customer KYC Photos Viewer Dialog */}
      <Dialog 
        open={photoViewerClient.isOpen} 
        onOpenChange={(v) => setPhotoViewerClient(prev => ({ ...prev, isOpen: v }))}
      >
        <DialogContent className="w-[95vw] sm:w-[90vw] lg:max-w-3xl max-h-[90dvh] bg-white border border-slate-200 shadow-2xl p-0 rounded-2xl sm:rounded-[2.5rem] flex flex-col gap-0 overflow-hidden">
          <div className="h-2.5 bg-gradient-to-r from-emerald-500 via-teal-600 to-[#ffd100] shrink-0" />
          <div className="p-5 sm:p-6 border-b border-slate-100 shrink-0 pr-12">
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-500/10 rounded-2xl text-emerald-600">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <DialogTitle className="text-xl sm:text-2xl font-black text-slate-900">
                    Customer KYC Scans
                  </DialogTitle>
                  <DialogDescription className="text-xs font-bold text-slate-500 mt-0.5">
                    {photoViewerClient.name} • <span className="font-mono text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded font-black">NIC: {photoViewerClient.nic}</span>
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6 space-y-6 overscroll-contain">
            {photoViewerClient.isLoading ? (
              <div className="flex flex-col items-center justify-center p-12 text-center bg-slate-50 rounded-2xl border border-slate-200">
                <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-3" />
                <p className="text-sm font-black text-slate-800">Loading High-Resolution KYC Scans...</p>
                <p className="text-xs text-slate-400 mt-1 font-bold">Securely retrieving biometric and signature data</p>
              </div>
            ) : (!photoViewerClient.front && !photoViewerClient.back && !photoViewerClient.signature) ? (
              <div className="flex flex-col items-center justify-center p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                <CameraOff className="w-12 h-12 text-slate-300 mb-2" />
                <p className="text-sm font-bold text-slate-600">No Webcam KYC Photos Recorded</p>
                <p className="text-xs text-slate-400 mt-1">This customer does not have any saved NIC or signature scans yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* NIC Front */}
                <div className="bg-slate-50/80 rounded-2xl p-4 border border-slate-200 flex flex-col items-center">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-700 block mb-2">NIC Front</span>
                  <div className="w-full aspect-[4/3] bg-black/95 rounded-xl overflow-hidden shadow-inner flex items-center justify-center border border-slate-300">
                    {photoViewerClient.front && (photoViewerClient.front.startsWith('data:') || photoViewerClient.front.startsWith('http:') || photoViewerClient.front.startsWith('/')) ? (
                      <img 
                        src={photoViewerClient.front} 
                        alt="NIC Front" 
                        className="w-full h-full object-contain cursor-zoom-in"
                        onClick={() => {
                          const w = window.open("");
                          w?.document.write(`<img src="${photoViewerClient.front}" style="max-width:100%;height:auto;margin:auto;display:block;"/>`);
                        }}
                      />
                    ) : (
                      <span className="text-xs text-slate-400 font-bold">No Front Scan</span>
                    )}
                  </div>
                </div>

                {/* NIC Back */}
                <div className="bg-slate-50/80 rounded-2xl p-4 border border-slate-200 flex flex-col items-center">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-700 block mb-2">NIC Back</span>
                  <div className="w-full aspect-[4/3] bg-black/95 rounded-xl overflow-hidden shadow-inner flex items-center justify-center border border-slate-300">
                    {photoViewerClient.back && (photoViewerClient.back.startsWith('data:') || photoViewerClient.back.startsWith('http:') || photoViewerClient.back.startsWith('/')) ? (
                      <img 
                        src={photoViewerClient.back} 
                        alt="NIC Back" 
                        className="w-full h-full object-contain cursor-zoom-in"
                        onClick={() => {
                          const w = window.open("");
                          w?.document.write(`<img src="${photoViewerClient.back}" style="max-width:100%;height:auto;margin:auto;display:block;"/>`);
                        }}
                      />
                    ) : (
                      <span className="text-xs text-slate-400 font-bold">No Back Scan</span>
                    )}
                  </div>
                </div>

                {/* Signature */}
                <div className="bg-slate-50/80 rounded-2xl p-4 border border-slate-200 flex flex-col items-center">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-700 block mb-2">Customer Signature</span>
                  <div className="w-full aspect-[4/3] bg-white rounded-xl overflow-hidden shadow-inner flex items-center justify-center border border-slate-300">
                    {photoViewerClient.signature && (photoViewerClient.signature.startsWith('data:') || photoViewerClient.signature.startsWith('http:') || photoViewerClient.signature.startsWith('/')) ? (
                      <img 
                        src={photoViewerClient.signature} 
                        alt="Signature" 
                        className="w-full h-full object-contain cursor-zoom-in p-2"
                        onClick={() => {
                          const w = window.open("");
                          w?.document.write(`<img src="${photoViewerClient.signature}" style="max-width:100%;height:auto;margin:auto;display:block;"/>`);
                        }}
                      />
                    ) : (
                      <span className="text-xs text-slate-400 font-bold">No Signature Scan</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
            <Button 
              type="button" 
              onClick={() => setPhotoViewerClient(prev => ({ ...prev, isOpen: false }))}
              className="bg-slate-900 hover:bg-slate-800 text-white font-bold px-6 rounded-xl"
            >
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  )
}
