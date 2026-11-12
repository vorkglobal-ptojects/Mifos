'use client';

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  Smartphone, Send, RefreshCcw, Save, ShieldCheck, 
  CheckCircle2, AlertTriangle, MessageSquare, Radio, Server,
  Building2, Lock
} from "lucide-react";
import { toast } from "sonner";
import { buildPawnReceiptSms } from "@/lib/sms";
import { getAuthHeaders } from "@/lib/getAuthHeaders";

export default function SmsSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  /* Branch List & Selected Branch */
  const [branches, setBranches] = useState<any[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('GLOBAL');

  /* Gateway Config State */
  const [deviceId, setDeviceId] = useState('6aa2895cccb6c72709fa5556');
  const [apiKey, setApiKey] = useState('txb_SQX87S1btDchmgxYURa40D3I3WEjxSqg');
  const [gatewayUrl, setGatewayUrl] = useState('https://api.textbee.dev/api/v1/gateway/devices/6aa2895cccb6c72709fa5556/send-sms');
  const [email, setEmail] = useState('');
  const [simSlot, setSimSlot] = useState('1');
  const [enabled, setEnabled] = useState(true);

  /* All Branch Configs map */
  const [branchConfigs, setBranchConfigs] = useState<Record<string, any>>({});

  /* Test SMS State */
  const [testPhone, setTestPhone] = useState('0771234567');
  const [testMessage, setTestMessage] = useState(buildPawnReceiptSms({ customerName: 'Nisal Sayuranga', ticketNo: '1R 20743', amount: 50000 }));

  /* SMS Logs */
  const [logs, setLogs] = useState<any[]>([]);

  const loadSettingsAndLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/notifications/sms', { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setIsAdmin(data.isAdmin !== false);
        setBranches(data.branches || [{ id: 'HQ', name: 'Head Office' }]);
        setLogs(data.logs || []);

        const config = data.config || {};
        setBranchConfigs(config.branches || {});

        populateFields(selectedBranchId, config);
      }
    } catch (e) {
      console.error(e);
      toast.error('Failed to load SMS settings');
    } finally {
      setLoading(false);
    }
  };

  const populateFields = (branchId: string, globalConfig: any) => {
    const bConfigs = globalConfig?.branches || branchConfigs || {};
    if (branchId === 'GLOBAL') {
      setDeviceId(globalConfig?.deviceId || '6aa2895cccb6c72709fa5556');
      setApiKey(globalConfig?.apiKey || 'txb_SQX87S1btDchmgxYURa40D3I3WEjxSqg');
      setGatewayUrl(globalConfig?.gatewayUrl || 'https://api.textbee.dev/api/v1/gateway/devices/6aa2895cccb6c72709fa5556/send-sms');
      setEmail('headOffice@rupasinghe.lk');
      setSimSlot(String(globalConfig?.simSlot || '1'));
      setEnabled(globalConfig?.enabled !== false);
    } else {
      const bConf = bConfigs[branchId] || {};
      setDeviceId(bConf.deviceId || '');
      setApiKey(bConf.apiKey || '');
      setGatewayUrl(bConf.gatewayUrl || (bConf.deviceId ? `https://api.textbee.dev/api/v1/gateway/devices/${bConf.deviceId}/send-sms` : ''));
      setEmail(bConf.email || '');
      setSimSlot(String(bConf.simSlot || '1'));
      setEnabled(bConf.enabled !== false);
    }
  };

  useEffect(() => {
    loadSettingsAndLogs();
  }, []);

  const handleBranchChange = (newBranchId: string) => {
    setSelectedBranchId(newBranchId);
    const targetBranch = branches.find(b => b.id === newBranchId);

    fetch('/api/notifications/sms', { headers: getAuthHeaders() })
      .then(res => res.json())
      .then(data => {
        const config = data.config || {};
        if (config.branches) {
          setBranchConfigs(config.branches);
        }
        populateFields(newBranchId, config);

        // Smooth scroll to top editor card
        window.scrollTo({ top: 0, behavior: 'smooth' });

        if (newBranchId === 'GLOBAL') {
          toast.info('Master Default Gateway Selected', {
            description: 'Editing global fallback TextBee credentials.'
          });
        } else {
          toast.info(`Editing device config for ${targetBranch?.name || newBranchId}`, {
            description: `Enter the TextBee Device ID & API Key for this branch's SIM card.`
          });
        }
      })
      .catch(() => {
        toast.error('Failed to load device config');
      });
  };

  const handleSaveConfig = async () => {
    if (!isAdmin) return toast.error('Only Administrators can modify SMS Gateway settings.');
    setSaving(true);
    const toastId = toast.loading(`Saving ${selectedBranchId === 'GLOBAL' ? 'Master Default' : `Branch [${selectedBranchId}]`} TextBee Gateway...`);

    const selectedBranchObj = branches.find(b => b.id === selectedBranchId);

    try {
      const res = await fetch('/api/settings/sms-gateway', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          branchId: selectedBranchId === 'GLOBAL' ? undefined : selectedBranchId,
          branchName: selectedBranchObj?.name || selectedBranchId,
          email,
          deviceId,
          apiKey,
          gatewayUrl: gatewayUrl || (deviceId ? `https://api.textbee.dev/api/v1/gateway/devices/${deviceId}/send-sms` : ''),
          simSlot: parseInt(simSlot) || 1,
          enabled
        })
      });

      if (res.ok) {
        toast.success(`TextBee Gateway saved for ${selectedBranchId === 'GLOBAL' ? 'Master System Default' : selectedBranchObj?.name || selectedBranchId}!`, { id: toastId });
        loadSettingsAndLogs();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to save configuration', { id: toastId });
      }
    } catch (err: any) {
      toast.error('Error saving settings: ' + err.message, { id: toastId });
    } finally {
      setSaving(false);
    }
  };

  const handleSendTestSms = async () => {
    if (!testPhone || !testMessage) return toast.error('Enter phone number and message');
    setTesting(true);
    const toastId = toast.loading('Sending test SMS via TextBee Gateway...');

    try {
      const res = await fetch('/api/notifications/sms', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          phone: testPhone,
          message: testMessage,
          ticketNo: 'TEST-001',
          amount: 50000,
          type: 'TEST'
        })
      });

      const data = await res.json();
      if (res.ok) {
        if (data.status === 'SENT') {
          toast.success(`Test SMS dispatched via TextBee Gateway! (${data.notice})`, { id: toastId });
        } else {
          toast.info(`SMS queued in database (${data.notice})`, { id: toastId });
        }
        loadSettingsAndLogs();
      } else {
        toast.error(data.error || 'Failed to dispatch SMS', { id: toastId });
      }
    } catch (err: any) {
      toast.error('Error dispatching test SMS: ' + err.message, { id: toastId });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-700 pb-16">

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center glass p-8 rounded-3xl border-white/40 shadow-2xl gap-6 relative overflow-hidden">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-amber-500/10 rounded-2xl border border-amber-500/20 text-amber-500">
            <Smartphone className="w-8 h-8" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-black text-slate-900 tracking-tighter leading-none">
                Multi-Branch <span className="bg-gradient-to-r from-amber-500 to-yellow-600 bg-clip-text text-transparent">TextBee SMS Gateway</span>
              </h1>
              <span className="px-3 py-1 bg-amber-500/10 text-amber-700 border border-amber-500/20 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
                <Lock className="w-3 h-3" /> Admin Only
              </span>
            </div>
            <p className="text-slate-500 font-semibold text-xs tracking-tight mt-1">
              Configure independent TextBee Android SIM devices per branch tablet so customer SMS dispatches from local branch SIMs.
            </p>
          </div>
        </div>

        <Button
          onClick={loadSettingsAndLogs}
          variant="outline"
          className="h-11 px-4 bg-white/80 border-slate-200 text-slate-700 font-bold rounded-2xl shadow-sm text-xs"
        >
          <RefreshCcw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin text-amber-500' : ''}`} /> Refresh Status
        </Button>
      </div>

      {/* Admin Authorization Notice */}
      {!isAdmin && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-3 text-amber-900 font-bold text-xs shadow-md">
          <ShieldCheck className="w-5 h-5 text-amber-600 shrink-0" />
          <div>
            <span>Read-Only Mode: You are logged in as a Teller.</span>
            <p className="text-[11px] font-medium text-amber-700 mt-0.5">
              Only System Administrators can add or modify branch TextBee SMS credentials.
            </p>
          </div>
        </div>
      )}

      {/* Branch Selector Tabs */}
      <div className="flex flex-wrap items-center gap-2 pb-1">
        <button
          onClick={() => handleBranchChange('GLOBAL')}
          className={`px-4 py-2.5 rounded-2xl text-xs font-black transition-all duration-200 flex items-center gap-2 whitespace-nowrap shadow-sm border cursor-pointer ${
            selectedBranchId === 'GLOBAL'
              ? 'bg-slate-950 text-[#ffd100] border-slate-900 shadow-md'
              : 'bg-white/80 text-slate-600 border-slate-200 hover:bg-slate-100'
          }`}
        >
          <Server className="w-4 h-4" /> Master Default Gateway
        </button>

        {branches.map((b) => {
          const hasCustom = !!branchConfigs[b.id]?.deviceId;
          return (
            <button
              key={b.id}
              onClick={() => handleBranchChange(b.id)}
              className={`px-4 py-2.5 rounded-2xl text-xs font-black transition-all duration-200 flex items-center gap-2 whitespace-nowrap shadow-sm border cursor-pointer ${
                selectedBranchId === b.id
                  ? 'bg-[#ffd100] text-[#202020] border-amber-400 shadow-md'
                  : 'bg-white/80 text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Building2 className="w-4 h-4" />
              <span>{b.name || b.id} ({b.id})</span>
              {hasCustom && (
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" title="Custom Branch Device Connected" />
              )}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Gateway Configuration Card */}
        <Card className="glass border-white/40 shadow-xl rounded-3xl p-6 lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-amber-500" />
              <h2 className="font-black text-base text-slate-900">
                {selectedBranchId === 'GLOBAL' ? 'Master Default Gateway Config' : `Branch Configuration: ${branches.find(b => b.id === selectedBranchId)?.name || selectedBranchId}`}
              </h2>
            </div>
            <span className="px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full font-mono text-[10px] font-black uppercase tracking-wider">
              {selectedBranchId === 'GLOBAL' ? 'Global Fallback SIM' : `Branch [${selectedBranchId}] Tablet SIM`}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-2 md:col-span-2">
              <Label className="text-xs font-bold text-slate-700">Branch Tablet / Device Email Profile</Label>
              <Input
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={!isAdmin}
                placeholder="e.g. branch.kandy@rupasinghe.lk"
                className="h-11 rounded-xl bg-white/80 font-mono text-xs"
              />
              <p className="text-[11px] text-slate-400">
                Email address associated with the TextBee profile logged in on this branch's Android tablet.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-bold text-slate-700">TextBee Device ID</Label>
              <Input
                value={deviceId}
                onChange={e => setDeviceId(e.target.value)}
                disabled={!isAdmin}
                placeholder="e.g. 6aa2895cccb6c72709fa5556"
                className="h-11 rounded-xl bg-white/80 font-mono text-xs"
              />
              <p className="text-[11px] text-slate-400">
                Found in TextBee Mobile App under Settings ➔ Device ID.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-bold text-slate-700">TextBee API Key</Label>
              <Input
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                disabled={!isAdmin}
                type="password"
                placeholder="txb_..."
                className="h-11 rounded-xl bg-white/80 font-mono text-xs"
              />
              <p className="text-[11px] text-slate-400">
                API Key for this branch's TextBee profile (`txb_...`).
              </p>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label className="text-xs font-bold text-slate-700">API Endpoint URL (Auto-Generated)</Label>
              <Input
                value={gatewayUrl || (deviceId ? `https://api.textbee.dev/api/v1/gateway/devices/${deviceId}/send-sms` : '')}
                onChange={e => setGatewayUrl(e.target.value)}
                disabled={!isAdmin}
                placeholder="https://api.textbee.dev/api/v1/gateway/devices/.../send-sms"
                className="h-11 rounded-xl bg-white/80 font-mono text-xs"
              />
            </div>
          </div>

          {isAdmin && (
            <div className="flex justify-end pt-2">
              <Button
                onClick={handleSaveConfig}
                disabled={saving}
                className="h-11 px-6 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl text-xs gap-2 shadow-lg shadow-amber-500/20"
              >
                <Save className="w-4 h-4" /> Save {selectedBranchId === 'GLOBAL' ? 'Master Default' : `Branch [${selectedBranchId}]`} Gateway
              </Button>
            </div>
          )}
        </Card>

        {/* Test SMS Dispatcher Card */}
        <Card className="glass border-white/40 shadow-xl rounded-3xl p-6 space-y-5">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <MessageSquare className="w-5 h-5 text-indigo-600" />
            <h2 className="font-black text-base text-slate-900">Send Test SMS</h2>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Test Mobile Number</Label>
              <Input
                value={testPhone}
                onChange={e => setTestPhone(e.target.value)}
                placeholder="0771234567"
                className="h-10 rounded-xl bg-white/80 font-mono text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Message Content</Label>
              <textarea
                rows={3}
                value={testMessage}
                onChange={e => setTestMessage(e.target.value)}
                className="w-full p-3 rounded-xl bg-white/80 border border-slate-200 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/30"
              />
            </div>

            <Button
              onClick={handleSendTestSms}
              disabled={testing}
              className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs gap-2 shadow-md"
            >
              <Send className={`w-4 h-4 ${testing ? 'animate-bounce' : ''}`} /> Dispatch Test SMS
            </Button>
          </div>
        </Card>

      </div>

      {/* Branch Gateway Summary Matrix */}
      <Card className="glass border-white/40 shadow-2xl rounded-3xl overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="font-black text-lg text-slate-900 tracking-tight">Branch SMS Gateway Status Matrix</h2>
            <p className="text-xs text-slate-500 font-medium">All registered system branches and their active TextBee SIM gateway devices.</p>
          </div>
          <span className="text-xs font-bold text-slate-400">Total Branches: {branches.length}</span>
        </div>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-slate-950 text-white">
              <TableRow className="hover:bg-slate-900 border-slate-800">
                <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300 py-4 pl-6">Branch Code & Name</TableHead>
                <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">Device Email / Profile</TableHead>
                <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">TextBee Device ID</TableHead>
                <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">API Key Status</TableHead>
                <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">Connection Mode</TableHead>
                <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300 pr-6 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-slate-100">
              {branches.map((b) => {
                const bConf = branchConfigs[b.id];
                const hasCustom = !!(bConf?.deviceId && bConf?.apiKey);
                const activeDeviceId = bConf?.deviceId || '6aa2895cccb6c72709fa5556 (Default)';

                return (
                  <TableRow key={b.id} className="hover:bg-slate-50 transition-colors">
                    <TableCell className="pl-6 font-bold text-xs text-slate-900">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-amber-500" />
                        <div>
                          <p className="font-black text-slate-900">{b.name || b.id}</p>
                          <p className="text-[10px] font-mono text-slate-400">ID: {b.id}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">
                      {bConf?.email || '—'}
                    </TableCell>
                    <TableCell className="font-mono text-xs font-semibold text-slate-800">
                      {activeDeviceId}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-500">
                      {hasCustom ? '••••••••' + (bConf?.apiKey?.slice(-4) || '') : 'Default HQ Key'}
                    </TableCell>
                    <TableCell>
                      {hasCustom ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full font-mono text-[10px] font-black">
                          <CheckCircle2 className="w-3 h-3 text-emerald-500" /> CUSTOM BRANCH SIM
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-full font-mono text-[10px] font-black">
                          <Radio className="w-3 h-3 text-amber-500" /> FALLBACK TO HQ
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <Button
                        onClick={() => handleBranchChange(b.id)}
                        variant="outline"
                        size="sm"
                        className="h-8 px-3 text-xs font-black text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-300 rounded-xl shadow-xs cursor-pointer"
                      >
                        Configure Device
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dispatch Logs Table */}
      <Card className="glass border-white/40 shadow-2xl rounded-3xl overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-black text-lg text-slate-900 tracking-tight">Recent Customer SMS Dispatch Logs</h2>
          <span className="text-xs font-bold text-slate-400">Total Logs: {logs.length}</span>
        </div>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-slate-950 text-white">
              <TableRow className="hover:bg-slate-900 border-slate-800">
                <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300 py-4 pl-6">Timestamp</TableHead>
                <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">Branch</TableHead>
                <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">Customer Mobile</TableHead>
                <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">Message Text</TableHead>
                <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">Ticket #</TableHead>
                <TableHead className="font-black text-[10px] uppercase tracking-widest text-slate-300">Status & Notice</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-slate-100">
              {logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-slate-400 font-bold text-sm">
                    No SMS dispatch logs recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => {
                  const dateStr = log.created_at ? new Date(log.created_at).toLocaleString('en-GB') : '—';
                  const isSent = log.status === 'SENT';

                  return (
                    <TableRow key={log.id} className="hover:bg-slate-50 transition-colors">
                      <TableCell className="pl-6 font-mono text-xs font-semibold text-slate-600">
                        {dateStr}
                      </TableCell>
                      <TableCell className="font-mono text-xs font-bold text-amber-600">
                        {log.branch_id || 'HQ'}
                      </TableCell>
                      <TableCell className="font-mono text-xs font-bold text-slate-900">
                        {log.phone}
                      </TableCell>
                      <TableCell className="text-xs text-slate-700 max-w-xs truncate">
                        {log.message}
                      </TableCell>
                      <TableCell className="font-mono text-xs font-bold text-amber-600">
                        {log.ticket_no || '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className={`inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider ${isSent ? 'text-emerald-600' : 'text-amber-600'}`}>
                            {isSent ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                            {log.status}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {log.dispatch_notice || 'Queued in database'}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

    </div>
  );
}
