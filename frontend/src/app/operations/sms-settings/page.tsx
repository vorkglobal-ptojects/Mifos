'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Smartphone, Send, RefreshCcw, Save, ShieldCheck,
  CheckCircle2, AlertTriangle, MessageSquare, Radio, Server,
  Building2, Lock, Activity, BatteryCharging, Battery, Wifi,
  RotateCcw, Users, Sliders, FileText, Trash2, Search, CheckSquare, Square
} from 'lucide-react';
import { toast } from 'sonner';
import { getAuthHeaders } from '@/lib/getAuthHeaders';
import { normalizeBranchId } from '@/lib/branch-mapping';
import {
  buildInterestPaymentSms,
  buildPawnApprovedSms,
  buildPawnReceiptSms,
  buildPawnRedeemSms,
  buildPawnReminderSms,
  buildForfeitureWarningSms,
  buildPawnReturnedSms,
  calculateSmsParts,
  DEFAULT_SMS_TEMPLATES,
  DEFAULT_SMS_TRIGGERS,
  normalizeSriLankaPhone,
  SMS_TEMPLATE_LABELS,
  SMS_TRIGGER_META,
  SmsTemplateKey,
  SmsTriggersConfig,
} from '@/lib/sms-templates';

type TabKey = 'gateway' | 'dispatch' | 'templates' | 'logs';

export default function SmsSettingsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('gateway');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [batchRetrying, setBatchRetrying] = useState(false);

  const [isAdmin, setIsAdmin] = useState(false);
  const [isHead, setIsHead] = useState(false);
  const [userBranchId, setUserBranchId] = useState('HQ');

  /* Branch & Config State */
  const [branches, setBranches] = useState<any[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('GLOBAL');
  const [globalConfig, setGlobalConfig] = useState<any>({});
  const [branchConfigs, setBranchConfigs] = useState<Record<string, any>>({});

  /* Gateway Form Fields (NO hardcoded API secrets) */
  const [deviceId, setDeviceId] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [savedMaskedKey, setSavedMaskedKey] = useState('');
  const [hasSavedKey, setHasSavedKey] = useState(false);
  const [clearApiKey, setClearApiKey] = useState(false);
  const [email, setEmail] = useState('');
  const [simSlot, setSimSlot] = useState('1');
  const [enabled, setEnabled] = useState(true);

  /* Live Device Health */
  const [health, setHealth] = useState<any>(null);

  /* Test SMS State */
  const [testBranchId, setTestBranchId] = useState<string>('GLOBAL');
  const [testTemplateKey, setTestTemplateKey] = useState<SmsTemplateKey>('RECEIPT');
  const [testPhone, setTestPhone] = useState('0771234567');
  const [testMessage, setTestMessage] = useState(() =>
    buildPawnReceiptSms({ customerName: 'Test Customer', ticketNo: '1R 20743', amount: 50000 })
  );

  /* Triggers & Templates State */
  const [triggers, setTriggers] = useState<SmsTriggersConfig>({ ...DEFAULT_SMS_TRIGGERS });
  const [templates, setTemplates] = useState<Record<SmsTemplateKey, string>>({ ...DEFAULT_SMS_TEMPLATES });
  const [activeTemplateKey, setActiveTemplateKey] = useState<SmsTemplateKey>('RECEIPT');

  /* Logs & Filters State */
  const [logs, setLogs] = useState<any[]>([]);
  const [stats, setStats] = useState({ total: 0, sent: 0, queued: 0, failed: 0, todaySent: 0 });
  const [logStatusFilter, setLogStatusFilter] = useState<string>('ALL');
  const [logBranchFilter, setLogBranchFilter] = useState<string>('ALL');
  const [logSearch, setLogSearch] = useState<string>('');

  /* Bulk Reminders State */
  const [bulkBranch, setBulkBranch] = useState<string>('ALL');
  const [bulkSearch, setBulkSearch] = useState<string>('');
  const [bulkPawns, setBulkPawns] = useState<any[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [selectedPawnIds, setSelectedPawnIds] = useState<Set<string>>(new Set());
  const [bulkTemplateKey, setBulkTemplateKey] = useState<SmsTemplateKey>('REMINDER');
  const [bulkCustomMsg, setBulkCustomMsg] = useState<string>(DEFAULT_SMS_TEMPLATES.REMINDER);
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkSummary, setBulkSummary] = useState<any>(null);

  const populateFields = useCallback((branchId: string, cfg: any) => {
    const bConfigs = cfg?.branches || {};
    if (branchId === 'GLOBAL') {
      setDeviceId(cfg?.deviceId || '');
      setApiKeyInput('');
      setClearApiKey(false);
      setHasSavedKey(Boolean(cfg?.hasApiKey));
      setSavedMaskedKey(cfg?.maskedApiKey || '');
      setEmail(cfg?.email || '');
      setSimSlot(String(cfg?.simSlot || '1'));
      setEnabled(cfg?.enabled !== false);
    } else {
      const norm = normalizeBranchId(branchId);
      const bConf = bConfigs[norm] || bConfigs[branchId] || {};
      setDeviceId(bConf.deviceId || '');
      setApiKeyInput('');
      setClearApiKey(false);
      setHasSavedKey(Boolean(bConf.hasApiKey));
      setSavedMaskedKey(bConf.maskedApiKey || '');
      setEmail(bConf.email || '');
      setSimSlot(String(bConf.simSlot || '1'));
      setEnabled(bConf.enabled !== false);
    }
  }, []);

  const loadSettingsAndLogs = useCallback(async (opts?: { branch?: string; status?: string; search?: string }) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      const b = opts?.branch ?? logBranchFilter;
      const st = opts?.status ?? logStatusFilter;
      const q = opts?.search ?? logSearch;
      if (b && b !== 'ALL') params.set('branch', b);
      if (st && st !== 'ALL') params.set('status', st);
      if (q && q.trim()) params.set('search', q.trim());

      const res = await fetch(`/api/notifications/sms?${params.toString()}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to load SMS gateway status');
      const data = await res.json();

      setIsAdmin(Boolean(data.isAdmin));
      setIsHead(Boolean(data.isHead));
      setUserBranchId(data.userBranchId || 'HQ');
      setBranches((data.branches || [{ id: 'HQ', name: 'Head Office' }]).filter((br: any) => String(br.id).toUpperCase() !== 'TESTBRANCH'));
      setLogs(Array.isArray(data.logs) ? data.logs : []);
      if (data.stats) setStats(data.stats);

      const cfg = data.config || {};
      setGlobalConfig(cfg);
      setBranchConfigs(cfg.branches || {});

      if (cfg.triggers) {
        setTriggers({ ...DEFAULT_SMS_TRIGGERS, ...cfg.triggers });
      }
      const mergedTemplates = { ...DEFAULT_SMS_TEMPLATES };
      if (cfg.templates) {
        for (const k of Object.keys(DEFAULT_SMS_TEMPLATES) as SmsTemplateKey[]) {
          if (cfg.templates[k]) mergedTemplates[k] = cfg.templates[k];
        }
      }
      setTemplates(mergedTemplates);

      if (!data.isAdmin && !data.isHead && data.userBranchId) {
        setSelectedBranchId(data.userBranchId);
        setTestBranchId(data.userBranchId);
        setBulkBranch(data.userBranchId);
        populateFields(data.userBranchId, cfg);
      } else {
        populateFields(selectedBranchId, cfg);
      }
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Failed to load SMS settings');
    } finally {
      setLoading(false);
    }
  }, [logBranchFilter, logStatusFilter, logSearch, populateFields, selectedBranchId]);

  useEffect(() => {
    loadSettingsAndLogs();
  }, []);

  const handleCheckHealth = async (targetBranch = selectedBranchId) => {
    setHealthLoading(true);
    try {
      const res = await fetch(
        `/api/notifications/sms?action=health&branchId=${encodeURIComponent(targetBranch)}`,
        { headers: getAuthHeaders() }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Health check failed');
      setHealth(data.health);
      if (data.health?.online) {
        toast.success(`Device Online (${data.health.model || 'TextBee Android'})`, {
          description: `Battery ${data.health.batteryPercentage ?? '?'}% • Last ping ${data.health.heartbeatAgeMinutes ?? 0}m ago`
        });
      } else {
        toast.warning(`Gateway Status: ${data.health?.status || 'UNKNOWN'}`, {
          description: data.health?.error || 'Device heartbeat may be delayed.'
        });
      }
    } catch (err: any) {
      toast.error(err.message || 'Health probe failed');
    } finally {
      setHealthLoading(false);
    }
  };

  const handleBranchSelect = (newBranchId: string) => {
    setSelectedBranchId(newBranchId);
    setTestBranchId(newBranchId);
    populateFields(newBranchId, { ...globalConfig, branches: branchConfigs });
    setHealth(null);
  };

  const handleSaveConfig = async () => {
    if (!isAdmin) return toast.error('Only Administrators can modify SMS Gateway settings.');
    setSaving(true);
    const toastId = toast.loading(
      `Saving ${selectedBranchId === 'GLOBAL' ? 'Master Default' : `Branch [${selectedBranchId}]`} TextBee Gateway...`
    );

    const selectedBranchObj = branches.find((b) => b.id === selectedBranchId);
    try {
      const res = await fetch('/api/settings/sms-gateway', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'SAVE_GATEWAY',
          branchId: selectedBranchId === 'GLOBAL' ? 'GLOBAL' : selectedBranchId,
          branchName: selectedBranchObj?.name || selectedBranchId,
          email,
          deviceId,
          apiKey: apiKeyInput.trim() || undefined,
          clearApiKey,
          simSlot: parseInt(simSlot, 10) || 1,
          enabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save configuration');

      toast.success(
        `Saved ${selectedBranchId === 'GLOBAL' ? 'Master Gateway' : `${selectedBranchObj?.name || selectedBranchId} SIM`} config`,
        { id: toastId }
      );
      setApiKeyInput('');
      setClearApiKey(false);
      await loadSettingsAndLogs();
    } catch (err: any) {
      toast.error(err.message || 'Error saving settings', { id: toastId });
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveBranchOverride = async () => {
    if (!isAdmin || selectedBranchId === 'GLOBAL') return;
    setSaving(true);
    const toastId = toast.loading(`Resetting ${selectedBranchId} to Master Fallback...`);
    try {
      const res = await fetch('/api/settings/sms-gateway', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'REMOVE_BRANCH', branchId: selectedBranchId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to remove branch config');
      toast.success(`Branch ${selectedBranchId} reverted to Master Gateway fallback`, { id: toastId });
      await loadSettingsAndLogs();
    } catch (err: any) {
      toast.error(err.message, { id: toastId });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTriggers = async () => {
    if (!isAdmin) return toast.error('Admin only.');
    setSaving(true);
    const toastId = toast.loading('Saving Auto-SMS Trigger rules...');
    try {
      const res = await fetch('/api/settings/sms-gateway', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'SAVE_TRIGGERS', triggers }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save triggers');
      toast.success('Auto-SMS triggers updated successfully!', { id: toastId });
      await loadSettingsAndLogs();
    } catch (err: any) {
      toast.error(err.message, { id: toastId });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTemplates = async () => {
    if (!isAdmin) return toast.error('Admin only.');
    setSaving(true);
    const toastId = toast.loading('Saving SMS Templates...');
    try {
      const res = await fetch('/api/settings/sms-gateway', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'SAVE_TEMPLATES', templates }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save templates');
      toast.success('Custom SMS templates saved!', { id: toastId });
      await loadSettingsAndLogs();
    } catch (err: any) {
      toast.error(err.message, { id: toastId });
    } finally {
      setSaving(false);
    }
  };

  const applyTestTemplatePreview = (key: SmsTemplateKey) => {
    setTestTemplateKey(key);
    const tmpl = templates[key];
    const branchLabel = testBranchId === 'GLOBAL' ? 'HQ' : testBranchId;
    if (key === 'RECEIPT') {
      setTestMessage(buildPawnReceiptSms({ customerName: 'Test Customer', ticketNo: '1R 20743', amount: 50000, customTemplate: tmpl }));
    } else if (key === 'APPROVED') {
      setTestMessage(buildPawnApprovedSms({ customerName: 'Test Customer', ticketNo: '1R 20743', amount: 50000, branchName: branchLabel, customTemplate: tmpl }));
    } else if (key === 'INTEREST') {
      setTestMessage(buildInterestPaymentSms({ customerName: 'Test Customer', ticketNo: '1R 20743', interestAmount: 2750, branchName: branchLabel, customTemplate: tmpl }));
    } else if (key === 'REDEEM') {
      setTestMessage(buildPawnRedeemSms({ customerName: 'Test Customer', ticketNo: '1R 20743', settlementAmount: 52750, branchName: branchLabel, customTemplate: tmpl }));
    } else if (key === 'REMINDER') {
      setTestMessage(buildPawnReminderSms({ customerName: 'Test Customer', ticketNo: '1R 20743', amount: 50000, branchName: branchLabel, customTemplate: tmpl }));
    } else if (key === 'FORFEITURE') {
      setTestMessage(buildForfeitureWarningSms({ customerName: 'Test Customer', ticketNo: '1R 20743', principal: 50000, interestDue: 8250, expiryDate: '2026-11-30', branchName: branchLabel, customTemplate: tmpl }));
    } else {
      setTestMessage(buildPawnReturnedSms({ customerName: 'Test Customer', ticketNo: '1R 20743', reason: 'Weight recheck needed', branchName: branchLabel, customTemplate: tmpl }));
    }
  };

  const handleSendTestSms = async () => {
    const phoneCheck = normalizeSriLankaPhone(testPhone);
    if (!phoneCheck.valid) return toast.error(phoneCheck.reason || 'Enter a valid Sri Lankan mobile number.');
    if (!testMessage.trim()) return toast.error('Enter message content.');

    setTesting(true);
    const toastId = toast.loading(`Sending test SMS via ${testBranchId === 'GLOBAL' ? 'Master Gateway' : `Branch ${testBranchId}`}...`);
    try {
      const res = await fetch('/api/notifications/sms', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          phone: phoneCheck.e164,
          message: testMessage,
          ticketNo: 'TEST-001',
          amount: 50000,
          type: 'TEST',
          branchId: testBranchId,
          forceGlobal: testBranchId === 'GLOBAL',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to dispatch SMS');

      if (data.status === 'SENT') {
        toast.success(`SMS Delivered to ${data.phone}`, { description: data.notice, id: toastId });
      } else if (data.status === 'QUEUED') {
        toast.warning(`SMS Queued (Retryable)`, { description: data.notice, id: toastId });
      } else {
        toast.error(`SMS Failed (${data.status})`, { description: data.notice || data.error, id: toastId });
      }
      loadSettingsAndLogs();
    } catch (err: any) {
      toast.error(err.message || 'Error sending test SMS', { id: toastId });
    } finally {
      setTesting(false);
    }
  };

  const handleRetrySingle = async (logId: string) => {
    setRetryingId(logId);
    const toastId = toast.loading('Retrying SMS via TextBee...');
    try {
      const res = await fetch('/api/notifications/sms', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'RETRY', logId }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Retry delivered successfully!', { description: data.notice, id: toastId });
      } else {
        toast.error(data.error || data.notice || 'Retry failed', { id: toastId });
      }
      await loadSettingsAndLogs();
    } catch (err: any) {
      toast.error(err.message || 'Retry request failed', { id: toastId });
    } finally {
      setRetryingId(null);
    }
  };

  const handleRetryPendingBatch = async () => {
    setBatchRetrying(true);
    const toastId = toast.loading('Retrying queued/failed SMS from last 48h...');
    try {
      const res = await fetch('/api/notifications/sms', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'RETRY_PENDING',
          branchId: logBranchFilter,
          lookbackHours: 48,
          limit: 20,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Batch retry failed');
      toast.success(`Batch Retry Complete: ${data.sentCount} sent / ${data.attempted} attempted`, {
        description: data.failedCount > 0 ? `${data.failedCount} still pending.` : 'All recent pending messages delivered.',
        id: toastId,
      });
      await loadSettingsAndLogs();
    } catch (err: any) {
      toast.error(err.message || 'Batch retry error', { id: toastId });
    } finally {
      setBatchRetrying(false);
    }
  };

  const loadBulkRecipients = async () => {
    setBulkLoading(true);
    try {
      const params = new URLSearchParams({ status: 'ACTIVE' });
      if (bulkBranch && bulkBranch !== 'ALL') {
        params.set('branchId', bulkBranch);
      }
      const res = await fetch(`/api/pawns?${params.toString()}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to load active pawn bills');
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data.pawns || data.items || []);
      setBulkPawns(list);
      setSelectedPawnIds(new Set());
      setBulkSummary(null);
    } catch (err: any) {
      toast.error(err.message || 'Could not load active loans');
    } finally {
      setBulkLoading(false);
    }
  };

  const filteredBulkPawns = useMemo(() => {
    const q = bulkSearch.trim().toLowerCase();
    return bulkPawns
      .filter((p) => {
        if (String(p.branch_id || '').toUpperCase() === 'TEST') return false;
        if (!q) return true;
        const name = String(p.client_name || p.customer_name || p.clients?.first_name || '').toLowerCase();
        const bill = String(p.bill_no || p.display_bill_no || '').toLowerCase();
        const phone = String(p.phone || p.client_phone || p.clients?.phone || '').toLowerCase();
        return name.includes(q) || bill.includes(q) || phone.includes(q);
      })
      .slice(0, 120);
  }, [bulkPawns, bulkSearch]);

  const toggleSelectPawn = (id: string, validPhone: boolean) => {
    if (!validPhone) return;
    setSelectedPawnIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 50) next.add(id);
      else toast.warning('Maximum 50 recipients per bulk batch.');
      return next;
    });
  };

  const selectAllValidBulk = () => {
    const validIds = filteredBulkPawns
      .filter((p) => normalizeSriLankaPhone(p.phone || p.client_phone || p.clients?.phone).valid)
      .slice(0, 50)
      .map((p) => p.id);
    if (selectedPawnIds.size === validIds.length && validIds.length > 0) {
      setSelectedPawnIds(new Set());
    } else {
      setSelectedPawnIds(new Set(validIds));
    }
  };

  const handleSendBulkReminders = async () => {
    if (selectedPawnIds.size === 0) return toast.error('Select at least one customer loan.');
    const chosen = bulkPawns.filter((p) => selectedPawnIds.has(p.id));
    setBulkSending(true);
    const toastId = toast.loading(`Sending bulk reminders to ${chosen.length} customers...`);
    try {
      const recipients = chosen.map((p) => ({
        phone: p.phone || p.client_phone || p.clients?.phone,
        customerName: p.client_name || p.customer_name || `${p.clients?.first_name || ''} ${p.clients?.last_name || ''}`.trim() || 'Valued Customer',
        ticketNo: p.display_bill_no || p.bill_no || p.id.slice(0, 8),
        amount: p.disbursed_amount || 0,
        branchId: p.branch_id || userBranchId,
      }));

      const res = await fetch('/api/notifications/sms', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          mode: 'BULK',
          templateKey: bulkTemplateKey,
          customMessage: bulkCustomMsg,
          type: bulkTemplateKey === 'FORFEITURE' ? 'FORFEITURE' : 'REMINDER',
          recipients,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Bulk SMS dispatch failed');

      setBulkSummary(data);
      toast.success(`Bulk Dispatch Complete: ${data.sentCount} Sent, ${data.queuedCount} Queued`, { id: toastId });
      await loadSettingsAndLogs();
    } catch (err: any) {
      toast.error(err.message || 'Bulk dispatch error', { id: toastId });
    } finally {
      setBulkSending(false);
    }
  };

  const phoneCheck = useMemo(() => normalizeSriLankaPhone(testPhone), [testPhone]);
  const testSmsParts = useMemo(() => calculateSmsParts(testMessage), [testMessage]);
  const templateParts = useMemo(() => calculateSmsParts(templates[activeTemplateKey] || ''), [templates, activeTemplateKey]);

  const activeBranchList = useMemo(
    () => (isHead ? branches : branches.filter((b) => normalizeBranchId(b.id) === normalizeBranchId(userBranchId))),
    [branches, isHead, userBranchId]
  );

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500 pb-16 max-w-full overflow-x-hidden">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center glass p-5 sm:p-7 rounded-3xl border-white/40 shadow-xl gap-4">
        <div className="flex items-start sm:items-center gap-3">
          <div className="p-3 bg-amber-500/10 rounded-2xl border border-amber-500/20 text-amber-500 shrink-0">
            <Smartphone className="w-7 h-7" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-tight">
                TextBee <span className="bg-gradient-to-r from-amber-500 to-yellow-600 bg-clip-text text-transparent">SMS Gateway</span>
              </h1>
              <span className="px-2.5 py-0.5 bg-amber-500/10 text-amber-700 border border-amber-500/20 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
                <Lock className="w-3 h-3" /> {isAdmin ? 'Admin Control' : 'Read Only'}
              </span>
            </div>
            <p className="text-slate-500 font-semibold text-xs mt-1">
              Multi-branch Android tablet SIM dispatch, live device health, trilingual templates, retry queue & bulk reminders.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <Button
            onClick={() => handleCheckHealth(selectedBranchId)}
            disabled={healthLoading}
            variant="outline"
            className="h-10 px-4 bg-white border-emerald-200 text-emerald-700 hover:bg-emerald-50 font-bold rounded-2xl shadow-xs text-xs cursor-pointer"
          >
            <Activity className={`w-4 h-4 mr-1.5 ${healthLoading ? 'animate-pulse' : ''}`} />
            Check Device Health
          </Button>
          <Button
            onClick={() => loadSettingsAndLogs()}
            variant="outline"
            className="h-10 px-4 bg-white border-slate-200 text-slate-700 font-bold rounded-2xl shadow-xs text-xs cursor-pointer"
          >
            <RefreshCcw className={`w-4 h-4 mr-1.5 ${loading ? 'animate-spin text-amber-500' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Card className="glass border-white/40 rounded-2xl p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sent (Recent 500)</p>
          <p className="text-2xl font-black text-emerald-600 mt-1">{stats.sent}</p>
          <p className="text-[11px] font-semibold text-slate-500 mt-0.5">Today: {stats.todaySent} delivered</p>
        </Card>
        <Card className="glass border-white/40 rounded-2xl p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Queued / Failed</p>
          <p className={`text-2xl font-black mt-1 ${stats.queued + stats.failed > 0 ? 'text-rose-600' : 'text-slate-800'}`}>
            {stats.queued + stats.failed}
          </p>
          <p className="text-[11px] font-semibold text-slate-500 mt-0.5">{stats.queued} queued • {stats.failed} failed</p>
        </Card>
        <Card className="glass border-white/40 rounded-2xl p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Custom Branch SIMs</p>
          <p className="text-2xl font-black text-amber-600 mt-1">{globalConfig.configuredBranchCount || 0}</p>
          <p className="text-[11px] font-semibold text-slate-500 mt-0.5">Fallback: {globalConfig.hasApiKey ? 'Master Active' : 'Not Configured'}</p>
        </Card>
        <Card className="glass border-white/40 rounded-2xl p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Auto Triggers Active</p>
          <p className="text-2xl font-black text-indigo-600 mt-1">
            {Object.values(triggers).filter(Boolean).length} / {SMS_TRIGGER_META.length}
          </p>
          <p className="text-[11px] font-semibold text-slate-500 mt-0.5">Gateway {globalConfig.enabled !== false ? 'ENABLED' : 'PAUSED'}</p>
        </Card>
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
        {[
          { key: 'gateway', label: 'Gateway & Devices', icon: Server },
          { key: 'dispatch', label: 'Test & Bulk Reminders', icon: Send },
          { key: 'templates', label: 'Auto Triggers & Templates', icon: Sliders },
          { key: 'logs', label: `Logs & Retry (${stats.queued + stats.failed})`, icon: FileText },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key as TabKey)}
            className={`px-4 py-2.5 rounded-2xl text-xs font-black flex items-center gap-2 transition-all cursor-pointer border ${
              activeTab === key
                ? 'bg-slate-950 text-[#ffd100] border-slate-900 shadow-md'
                : 'bg-white/80 text-slate-600 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <Icon className="w-4 h-4" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {!isAdmin && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-3 text-amber-900 font-bold text-xs shadow-xs">
          <ShieldCheck className="w-5 h-5 text-amber-600 shrink-0" />
          <span>Read-Only Configuration: Only System Administrators can change TextBee credentials, auto-triggers, or templates.</span>
        </div>
      )}

      {/* TAB 1: GATEWAY & DEVICES */}
      {activeTab === 'gateway' && (
        <div className="space-y-6">
          {/* Live Health Result Banner */}
          {health && (
            <Card className={`rounded-3xl p-5 border shadow-md ${health.online ? 'bg-emerald-50/80 border-emerald-200' : 'bg-rose-50/80 border-rose-200'}`}>
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className={`p-2.5 rounded-2xl ${health.online ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                    <Activity className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-black text-sm text-slate-900">
                        {health.brand || ''} {health.model || `Device ••••${health.deviceIdTail || ''}`}
                      </h3>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${health.online ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}`}>
                        {health.status}
                      </span>
                      <span className="text-[11px] font-mono text-slate-500">
                        Scope: {health.usedBranchDevice ? `Branch [${health.branchId}] SIM` : 'Master Default SIM'}
                      </span>
                    </div>
                    {health.error ? (
                      <p className="text-xs font-bold text-rose-700 mt-1">{health.error}</p>
                    ) : (
                      <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-slate-700 mt-1.5">
                        <span className="inline-flex items-center gap-1">
                          {health.isCharging ? <BatteryCharging className="w-3.5 h-3.5 text-emerald-600" /> : <Battery className="w-3.5 h-3.5 text-slate-600" />}
                          Battery: {health.batteryPercentage ?? '—'}%
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Wifi className="w-3.5 h-3.5 text-indigo-600" />
                          Network: {health.networkType || '—'}
                        </span>
                        <span>Last Ping: {health.heartbeatAgeMinutes !== null ? `${health.heartbeatAgeMinutes}m ago` : 'Never'}</span>
                        <span>App v{health.appVersion || '—'}</span>
                        <span>Total Sent: {health.sentSMSCount ?? '—'}</span>
                      </div>
                    )}
                    {Array.isArray(health.sims) && health.sims.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {health.sims.map((s: any) => (
                          <span key={s.slot} className="px-2.5 py-0.5 rounded-lg bg-white border border-slate-200 text-[11px] font-bold text-slate-700">
                            SIM {s.slot}: {s.displayName || s.carrier}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* Branch Selector Pills */}
          <div className="flex flex-wrap items-center gap-2">
            {isHead && (
              <button
                onClick={() => handleBranchSelect('GLOBAL')}
                className={`px-3.5 py-2 rounded-2xl text-xs font-black flex items-center gap-2 border cursor-pointer ${
                  selectedBranchId === 'GLOBAL'
                    ? 'bg-slate-950 text-[#ffd100] border-slate-900 shadow-sm'
                    : 'bg-white/80 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <Server className="w-3.5 h-3.5" /> Master Default Gateway
              </button>
            )}

            {activeBranchList.map((b) => {
              const norm = normalizeBranchId(b.id);
              const bConf = branchConfigs[norm] || branchConfigs[b.id];
              const hasCustom = Boolean(bConf?.deviceId);
              const isDisabled = bConf && bConf.enabled === false;
              return (
                <button
                  key={b.id}
                  onClick={() => handleBranchSelect(b.id)}
                  className={`px-3.5 py-2 rounded-2xl text-xs font-black flex items-center gap-2 border cursor-pointer ${
                    selectedBranchId === b.id
                      ? 'bg-[#ffd100] text-[#202020] border-amber-400 shadow-sm'
                      : 'bg-white/80 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <Building2 className="w-3.5 h-3.5" />
                  <span>{b.name || b.id} ({norm})</span>
                  {hasCustom && (
                    <span className={`w-2 h-2 rounded-full ${isDisabled ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                  )}
                </button>
              );
            })}
          </div>

          {/* Editor Card */}
          <Card className="glass border-white/40 shadow-xl rounded-3xl p-5 sm:p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-amber-500" />
                <h2 className="font-black text-base text-slate-900">
                  {selectedBranchId === 'GLOBAL'
                    ? 'Master Default TextBee Config'
                    : `Branch Config: ${branches.find((b) => b.id === selectedBranchId)?.name || selectedBranchId} (${normalizeBranchId(selectedBranchId)})`}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enabled}
                    disabled={!isAdmin}
                    onChange={(e) => setEnabled(e.target.checked)}
                    className="w-4 h-4 accent-amber-500 rounded"
                  />
                  Gateway Enabled
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700">Branch Tablet Email Profile</Label>
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={!isAdmin}
                  placeholder="e.g. branch.kht@rupasinghe.lk"
                  className="h-11 rounded-xl bg-white/80 font-mono text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700">Preferred SIM Slot Label</Label>
                <select
                  value={simSlot}
                  onChange={(e) => setSimSlot(e.target.value)}
                  disabled={!isAdmin}
                  className="w-full h-11 px-3 rounded-xl bg-white/80 border border-slate-200 font-mono text-xs font-bold"
                >
                  <option value="1">SIM Slot 1</option>
                  <option value="2">SIM Slot 2</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700">TextBee Device ID</Label>
                <Input
                  value={deviceId}
                  onChange={(e) => setDeviceId(e.target.value)}
                  disabled={!isAdmin}
                  placeholder="Paste TextBee Device ID..."
                  className="h-11 rounded-xl bg-white/80 font-mono text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold text-slate-700">TextBee API Key</Label>
                  {hasSavedKey && !clearApiKey && (
                    <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                      Saved ({savedMaskedKey})
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={apiKeyInput}
                    onChange={(e) => {
                      setApiKeyInput(e.target.value);
                      if (e.target.value) setClearApiKey(false);
                    }}
                    disabled={!isAdmin}
                    type="password"
                    placeholder={
                      clearApiKey
                        ? 'Key will be cleared on Save'
                        : hasSavedKey
                        ? `Leave blank to keep ${savedMaskedKey}`
                        : 'Enter new TextBee API Key (txb_...)'
                    }
                    className="h-11 rounded-xl bg-white/80 font-mono text-xs"
                  />
                  {isAdmin && hasSavedKey && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setClearApiKey(!clearApiKey);
                        setApiKeyInput('');
                      }}
                      className="h-11 px-3 rounded-xl text-xs font-bold border-rose-200 text-rose-600 hover:bg-rose-50 shrink-0"
                    >
                      {clearApiKey ? 'Undo' : 'Clear'}
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-xs font-bold text-slate-700">TextBee Cloud Send Endpoint (Auto-Built)</Label>
                <Input
                  value={deviceId ? `https://api.textbee.dev/api/v1/gateway/devices/${deviceId.trim()}/send-sms` : ''}
                  readOnly
                  placeholder="Enter Device ID above to generate TextBee endpoint..."
                  className="h-11 rounded-xl bg-slate-50 font-mono text-xs text-slate-600"
                />
              </div>
            </div>

            {isAdmin && (
              <div className="flex flex-wrap justify-between items-center gap-3 pt-2">
                {selectedBranchId !== 'GLOBAL' && branchConfigs[normalizeBranchId(selectedBranchId)] ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={saving}
                    onClick={handleRemoveBranchOverride}
                    className="h-10 px-4 rounded-xl text-xs font-bold border-rose-200 text-rose-700 hover:bg-rose-50 gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Revert Branch to Master Fallback
                  </Button>
                ) : (
                  <div />
                )}
                <Button
                  onClick={handleSaveConfig}
                  disabled={saving}
                  className="h-11 px-6 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl text-xs gap-2 shadow-md cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  Save {selectedBranchId === 'GLOBAL' ? 'Master Gateway' : `Branch [${normalizeBranchId(selectedBranchId)}]`}
                </Button>
              </div>
            )}
          </Card>

          {/* Branch Gateway Matrix */}
          <Card className="glass border-white/40 shadow-xl rounded-3xl overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-black text-base text-slate-900">Branch SMS Gateway Matrix</h2>
                <p className="text-xs text-slate-500">Overview of custom Android tablet SIMs vs Master fallback across branches.</p>
              </div>
              <span className="text-xs font-bold text-slate-400">Branches: {activeBranchList.length}</span>
            </div>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-slate-950 text-white">
                    <TableRow className="hover:bg-slate-900 border-slate-800">
                      <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300 py-3.5 pl-5">Branch</TableHead>
                      <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">Profile Email</TableHead>
                      <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">Device ID</TableHead>
                      <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">API Key</TableHead>
                      <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">Mode</TableHead>
                      <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300 pr-5 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="divide-y divide-slate-100">
                    {activeBranchList.map((b) => {
                      const norm = normalizeBranchId(b.id);
                      const bConf = branchConfigs[norm] || branchConfigs[b.id];
                      const hasCustom = Boolean(bConf?.deviceId);
                      const isDisabled = bConf?.enabled === false;
                      return (
                        <TableRow key={b.id} className="hover:bg-slate-50">
                          <TableCell className="pl-5 font-bold text-xs text-slate-900">
                            <p className="font-black">{b.name || b.id}</p>
                            <p className="text-[10px] font-mono text-slate-400">Code: {norm}</p>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-slate-600">{bConf?.email || '—'}</TableCell>
                          <TableCell className="font-mono text-xs font-semibold text-slate-800">
                            {bConf?.deviceId || (globalConfig.deviceId ? `${globalConfig.deviceId} (Master)` : 'Not Configured')}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-slate-500">
                            {bConf?.hasApiKey ? bConf.maskedApiKey : (globalConfig.hasApiKey ? `Master (${globalConfig.maskedApiKey})` : 'None')}
                          </TableCell>
                          <TableCell>
                            {isDisabled ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-full text-[10px] font-black">
                                DISABLED
                              </span>
                            ) : hasCustom ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-[10px] font-black">
                                <CheckCircle2 className="w-3 h-3" /> CUSTOM BRANCH SIM
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-full text-[10px] font-black">
                                <Radio className="w-3 h-3" /> MASTER FALLBACK
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="pr-5 text-right">
                            <div className="flex justify-end gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleCheckHealth(b.id)}
                                className="h-8 px-2.5 text-[11px] font-bold rounded-xl cursor-pointer"
                              >
                                Ping
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleBranchSelect(b.id)}
                                className="h-8 px-3 text-[11px] font-black text-amber-700 bg-amber-50 border-amber-300 rounded-xl cursor-pointer"
                              >
                                Configure
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 2: TEST & BULK REMINDERS */}
      {activeTab === 'dispatch' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Single Test / Manual SMS */}
          <Card className="glass border-white/40 shadow-xl rounded-3xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <MessageSquare className="w-5 h-5 text-indigo-600" />
              <h2 className="font-black text-base text-slate-900">Single / Branch Test SMS</h2>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs font-bold text-slate-700">Dispatch Via Branch Gateway</Label>
                <select
                  value={testBranchId}
                  onChange={(e) => setTestBranchId(e.target.value)}
                  disabled={!isHead}
                  className="w-full h-10 px-3 rounded-xl bg-white border border-slate-200 text-xs font-bold"
                >
                  {isHead && <option value="GLOBAL">Master Default Gateway (HQ)</option>}
                  {activeBranchList.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name || b.id} ({normalizeBranchId(b.id)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-bold text-slate-700">Customer / Test Mobile Number</Label>
                <Input
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="0771234567 or +9477..."
                  className="h-10 rounded-xl bg-white font-mono text-xs"
                />
                <p className={`text-[11px] font-mono ${phoneCheck.valid ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {phoneCheck.valid ? `Normalized: ${phoneCheck.e164}` : phoneCheck.reason}
                </p>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-bold text-slate-700">Load Template Preset</Label>
                <select
                  value={testTemplateKey}
                  onChange={(e) => applyTestTemplatePreview(e.target.value as SmsTemplateKey)}
                  className="w-full h-10 px-3 rounded-xl bg-white border border-slate-200 text-xs font-bold"
                >
                  {(Object.keys(SMS_TEMPLATE_LABELS) as SmsTemplateKey[]).map((k) => (
                    <option key={k} value={k}>
                      {SMS_TEMPLATE_LABELS[k].label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold text-slate-700">Message Content</Label>
                  <span className="text-[10px] font-mono text-slate-500">
                    {testSmsParts.chars} chars • {testSmsParts.parts} SMS ({testSmsParts.encoding})
                  </span>
                </div>
                <textarea
                  rows={6}
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                  className="w-full p-3 rounded-xl bg-white border border-slate-200 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                />
              </div>

              <Button
                onClick={handleSendTestSms}
                disabled={testing || !phoneCheck.valid}
                className="w-full h-11 bg-slate-950 hover:bg-slate-800 text-white font-bold rounded-xl text-xs gap-2 shadow-md cursor-pointer"
              >
                <Send className="w-4 h-4" />
                {testing ? 'Sending...' : 'Dispatch SMS Now'}
              </Button>
            </div>
          </Card>

          {/* Bulk Customer / Loan Reminders */}
          <Card className="glass border-white/40 shadow-xl rounded-3xl p-5 sm:p-6 lg:col-span-2 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-amber-500" />
                <div>
                  <h2 className="font-black text-base text-slate-900">Bulk Active Loan Reminders (Max 50 / batch)</h2>
                  <p className="text-xs text-slate-500">Load active loans, select valid customer phones, and send personalized reminders.</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={bulkBranch}
                  onChange={(e) => setBulkBranch(e.target.value)}
                  disabled={!isHead}
                  className="h-9 px-3 rounded-xl bg-white border border-slate-200 text-xs font-bold"
                >
                  {isHead && <option value="ALL">All Branches</option>}
                  {activeBranchList.map((b) => (
                    <option key={b.id} value={b.id}>{b.name || b.id} ({normalizeBranchId(b.id)})</option>
                  ))}
                </select>
                <Button
                  onClick={loadBulkRecipients}
                  disabled={bulkLoading}
                  variant="outline"
                  className="h-9 px-3.5 rounded-xl text-xs font-bold cursor-pointer"
                >
                  <RefreshCcw className={`w-3.5 h-3.5 mr-1.5 ${bulkLoading ? 'animate-spin' : ''}`} />
                  Load Active Loans
                </Button>
              </div>
            </div>

            {bulkSummary && (
              <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-900 flex flex-wrap gap-4">
                <span>Total: {bulkSummary.total}</span>
                <span className="text-emerald-700">Sent: {bulkSummary.sentCount}</span>
                <span className="text-amber-700">Queued: {bulkSummary.queuedCount}</span>
                <span className="text-rose-700">Failed/Invalid: {bulkSummary.failedCount + bulkSummary.invalidCount}</span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-bold text-slate-700">Filter Recipients</Label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
                  <Input
                    value={bulkSearch}
                    onChange={(e) => setBulkSearch(e.target.value)}
                    placeholder="Search bill #, customer name, or phone..."
                    className="h-9 pl-8 rounded-xl bg-white text-xs"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-bold text-slate-700">Bulk Template Base</Label>
                <select
                  value={bulkTemplateKey}
                  onChange={(e) => {
                    const k = e.target.value as SmsTemplateKey;
                    setBulkTemplateKey(k);
                    setBulkCustomMsg(templates[k] || DEFAULT_SMS_TEMPLATES[k]);
                  }}
                  className="w-full h-9 px-3 rounded-xl bg-white border border-slate-200 text-xs font-bold"
                >
                  <option value="REMINDER">Payment Reminder</option>
                  <option value="INTEREST">Interest Reminder / Notice</option>
                  <option value="FORFEITURE">Overdue Warning</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-bold text-slate-700">
                Message Pattern (variables: {'{{customer_name}}, {{ticket_no}}, {{amount}}, {{branch_name}}'})
              </Label>
              <textarea
                rows={4}
                value={bulkCustomMsg}
                onChange={(e) => setBulkCustomMsg(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-white border border-slate-200 text-xs font-medium"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={selectAllValidBulk}
                disabled={filteredBulkPawns.length === 0}
                className="h-8 px-3 rounded-xl text-xs font-bold cursor-pointer"
              >
                {selectedPawnIds.size > 0 ? 'Clear / Toggle Selection' : 'Select All Valid (Max 50)'}
              </Button>
              <Button
                type="button"
                onClick={handleSendBulkReminders}
                disabled={bulkSending || selectedPawnIds.size === 0}
                className="h-9 px-4 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl text-xs gap-1.5 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                Send Bulk Reminders ({selectedPawnIds.size})
              </Button>
            </div>

            <div className="max-h-72 overflow-y-auto overflow-x-auto border border-slate-200 rounded-2xl bg-white/70">
              <Table>
                <TableHeader className="bg-slate-900 text-white">
                  <TableRow>
                    <TableHead className="w-10 text-slate-300 text-[10px]">Pick</TableHead>
                    <TableHead className="text-slate-300 text-[10px] uppercase">Bill #</TableHead>
                    <TableHead className="text-slate-300 text-[10px] uppercase">Customer</TableHead>
                    <TableHead className="text-slate-300 text-[10px] uppercase">Phone</TableHead>
                    <TableHead className="text-slate-300 text-[10px] uppercase text-right">Principal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-slate-100">
                  {filteredBulkPawns.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-xs text-slate-400 font-semibold">
                        Click &quot;Load Active Loans&quot; above to view eligible customers.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredBulkPawns.map((p) => {
                      const rawPhone = p.phone || p.client_phone || p.clients?.phone || '';
                      const pNorm = normalizeSriLankaPhone(rawPhone);
                      const checked = selectedPawnIds.has(p.id);
                      const name = p.client_name || p.customer_name || `${p.clients?.first_name || ''} ${p.clients?.last_name || ''}`.trim() || 'Unknown';
                      return (
                        <TableRow
                          key={p.id}
                          onClick={() => toggleSelectPawn(p.id, pNorm.valid)}
                          className={`cursor-pointer ${!pNorm.valid ? 'opacity-50' : checked ? 'bg-amber-50/70' : 'hover:bg-slate-50'}`}
                        >
                          <TableCell>
                            {checked ? <CheckSquare className="w-4 h-4 text-amber-600" /> : <Square className="w-4 h-4 text-slate-400" />}
                          </TableCell>
                          <TableCell className="font-mono text-xs font-bold text-slate-900">
                            {p.display_bill_no || p.bill_no} <span className="text-[10px] text-slate-400">[{normalizeBranchId(p.branch_id)}]</span>
                          </TableCell>
                          <TableCell className="text-xs font-semibold text-slate-800">{name}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {pNorm.valid ? (
                              <span className="text-emerald-700 font-bold">{pNorm.e164}</span>
                            ) : (
                              <span className="text-rose-600 text-[11px]">Invalid/Missing</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs font-bold">
                            Rs. {(Number(p.disbursed_amount) || 0).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>
      )}

      {/* TAB 3: AUTO TRIGGERS & TEMPLATES */}
      {activeTab === 'templates' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Auto-SMS Trigger Toggles */}
          <Card className="glass border-white/40 shadow-xl rounded-3xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="font-black text-base text-slate-900">Automated SMS Triggers</h2>
                <p className="text-xs text-slate-500">Control which system actions automatically send customer SMS.</p>
              </div>
              {isAdmin && (
                <Button
                  onClick={handleSaveTriggers}
                  disabled={saving}
                  size="sm"
                  className="h-9 px-4 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl text-xs cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5 mr-1.5" /> Save Triggers
                </Button>
              )}
            </div>

            <div className="space-y-3">
              {SMS_TRIGGER_META.map((item) => {
                const active = triggers[item.key];
                return (
                  <label
                    key={item.key}
                    className={`flex items-start justify-between gap-3 p-3.5 rounded-2xl border cursor-pointer transition-colors ${
                      active ? 'bg-emerald-50/50 border-emerald-200' : 'bg-white/70 border-slate-200'
                    }`}
                  >
                    <div>
                      <p className="text-xs font-black text-slate-900">{item.label}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{item.description}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={active}
                      disabled={!isAdmin}
                      onChange={(e) => setTriggers((prev) => ({ ...prev, [item.key]: e.target.checked }))}
                      className="w-4 h-4 mt-1 accent-emerald-600 shrink-0"
                    />
                  </label>
                );
              })}
            </div>
          </Card>

          {/* Trilingual Template Customizer */}
          <Card className="glass border-white/40 shadow-xl rounded-3xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="font-black text-base text-slate-900">Trilingual Template Editor</h2>
                <p className="text-xs text-slate-500">Customize Sinhala / Tamil / English SMS templates per event.</p>
              </div>
              {isAdmin && (
                <Button
                  onClick={handleSaveTemplates}
                  disabled={saving}
                  size="sm"
                  className="h-9 px-4 bg-slate-950 hover:bg-slate-800 text-white font-black rounded-xl text-xs cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5 mr-1.5" /> Save Templates
                </Button>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(SMS_TEMPLATE_LABELS) as SmsTemplateKey[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setActiveTemplateKey(k)}
                  className={`px-3 py-1.5 rounded-xl text-[11px] font-black border cursor-pointer ${
                    activeTemplateKey === k
                      ? 'bg-amber-500 text-slate-950 border-amber-500'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {SMS_TEMPLATE_LABELS[k].label}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="text-xs font-bold text-slate-700">
                  Template: {SMS_TEMPLATE_LABELS[activeTemplateKey].label}
                </Label>
                <span className="text-[10px] font-mono text-slate-500">
                  {templateParts.chars} chars • {templateParts.parts} SMS ({templateParts.encoding})
                </span>
              </div>
              <textarea
                rows={8}
                disabled={!isAdmin}
                value={templates[activeTemplateKey] || ''}
                onChange={(e) =>
                  setTemplates((prev) => ({ ...prev, [activeTemplateKey]: e.target.value }))
                }
                className="w-full p-3 rounded-2xl bg-white border border-slate-200 text-xs font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-amber-500/30"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1">
                  {SMS_TEMPLATE_LABELS[activeTemplateKey].placeholders.map((ph) => (
                    <button
                      key={ph}
                      type="button"
                      disabled={!isAdmin}
                      onClick={() =>
                        setTemplates((prev) => ({ ...prev, [activeTemplateKey]: (prev[activeTemplateKey] || '') + ` ${ph}` }))
                      }
                      className="px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 text-[10px] font-mono font-bold text-slate-700 cursor-pointer"
                    >
                      + {ph}
                    </button>
                  ))}
                </div>
                {isAdmin && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setTemplates((prev) => ({
                        ...prev,
                        [activeTemplateKey]: DEFAULT_SMS_TEMPLATES[activeTemplateKey],
                      }))
                    }
                    className="h-7 px-2.5 text-[11px] font-bold rounded-lg cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3 mr-1" /> Reset Default
                  </Button>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* TAB 4: DISPATCH LOGS & RETRY QUEUE */}
      {activeTab === 'logs' && (
        <Card className="glass border-white/40 shadow-xl rounded-3xl overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div>
              <h2 className="font-black text-base text-slate-900">SMS Dispatch Logs & Retry Queue</h2>
              <p className="text-xs text-slate-500">Live branch-scoped delivery history with TextBee responses and retry controls.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                placeholder="Search phone or message..."
                className="h-9 w-48 rounded-xl bg-white text-xs"
              />
              <select
                value={logStatusFilter}
                onChange={(e) => {
                  const v = e.target.value;
                  setLogStatusFilter(v);
                  loadSettingsAndLogs({ status: v });
                }}
                className="h-9 px-3 rounded-xl bg-white border border-slate-200 text-xs font-bold"
              >
                <option value="ALL">All Status</option>
                <option value="SENT">SENT</option>
                <option value="QUEUED">QUEUED</option>
                <option value="FAILED">FAILED</option>
              </select>
              {isHead && (
                <select
                  value={logBranchFilter}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLogBranchFilter(v);
                    loadSettingsAndLogs({ branch: v });
                  }}
                  className="h-9 px-3 rounded-xl bg-white border border-slate-200 text-xs font-bold"
                >
                  <option value="ALL">All Branches</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name || b.id} ({normalizeBranchId(b.id)})</option>
                  ))}
                </select>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => loadSettingsAndLogs()}
                className="h-9 px-3 rounded-xl text-xs font-bold cursor-pointer"
              >
                Apply
              </Button>
              {stats.queued + stats.failed > 0 && (
                <Button
                  size="sm"
                  disabled={batchRetrying}
                  onClick={handleRetryPendingBatch}
                  className="h-9 px-3.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs gap-1.5 cursor-pointer"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${batchRetrying ? 'animate-spin' : ''}`} />
                  Retry Recent Pending (48h)
                </Button>
              )}
            </div>
          </div>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-950 text-white">
                  <TableRow className="hover:bg-slate-900 border-slate-800">
                    <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300 py-3.5 pl-5">Timestamp</TableHead>
                    <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">Branch</TableHead>
                    <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">Mobile</TableHead>
                    <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">Ticket / Type</TableHead>
                    <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">Message</TableHead>
                    <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">Status & Notice</TableHead>
                    <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300 pr-5 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-slate-100">
                  {logs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12 text-slate-400 font-bold text-sm">
                        No SMS dispatch logs found for this filter.
                      </TableCell>
                    </TableRow>
                  ) : (
                    logs.map((log) => {
                      const dateStr = log.created_at ? new Date(log.created_at).toLocaleString('en-GB') : '—';
                      const isSent = log.status === 'SENT';
                      const canRetry = log.status === 'QUEUED' || log.status === 'FAILED';
                      return (
                        <TableRow key={log.id} className="hover:bg-slate-50">
                          <TableCell className="pl-5 font-mono text-[11px] font-semibold text-slate-600 whitespace-nowrap">
                            {dateStr}
                          </TableCell>
                          <TableCell className="font-mono text-xs font-bold text-amber-600">
                            {normalizeBranchId(log.branch_id || 'HQ')}
                          </TableCell>
                          <TableCell className="font-mono text-xs font-bold text-slate-900 whitespace-nowrap">
                            {log.phone || log.recipient_phone || '—'}
                          </TableCell>
                          <TableCell className="font-mono text-[11px]">
                            <div className="font-bold text-slate-800">{log.ticket_no || '—'}</div>
                            <span className="text-[10px] text-slate-400">{log.type || 'SMS'}</span>
                          </TableCell>
                          <TableCell className="text-xs text-slate-700 max-w-xs truncate" title={log.message || log.message_text}>
                            {log.message || log.message_text || '—'}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-0.5 max-w-xs">
                              <span
                                className={`inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider ${
                                  isSent ? 'text-emerald-600' : log.status === 'QUEUED' ? 'text-amber-600' : 'text-rose-600'
                                }`}
                              >
                                {isSent ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                                {log.status} {log.attempts > 1 ? `(${log.attempts}x)` : ''}
                              </span>
                              <span className="text-[10px] text-slate-500 font-mono truncate" title={log.notice}>
                                {log.notice || '—'}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="pr-5 text-right">
                            {canRetry ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={retryingId === log.id}
                                onClick={() => handleRetrySingle(log.id)}
                                className="h-7 px-2.5 text-[11px] font-bold text-amber-700 border-amber-300 bg-amber-50 hover:bg-amber-100 rounded-lg cursor-pointer"
                              >
                                <RotateCcw className={`w-3 h-3 mr-1 ${retryingId === log.id ? 'animate-spin' : ''}`} />
                                Retry
                              </Button>
                            ) : (
                              <span className="text-[10px] font-mono text-slate-400">Done</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
