'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Settings, Camera, Shield, Save, RefreshCw, Key, Network, 
  Clock, HardDrive, Sliders, Radio, CheckCircle2, Plus, Trash2, Edit2, Play
} from "lucide-react";
import { toast } from 'sonner';
import { getAuthHeaders } from '@/lib/getAuthHeaders';

const BRANCH_LIST = ['HQ', 'KTW', 'BRL', 'DHW', 'HMG', 'KDW', 'KIR', 'KOT', 'PND', 'W2', 'W3', 'W4', 'KHT', 'TEST'];

export default function CctvSettingsPage() {
  const [activeTab, setActiveTab] = useState<'cameras' | 'recording' | 'ptz'>('cameras');
  const [cameras, setCameras] = useState<any[]>([]);
  const [selectedBranch, setSelectedBranch] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Global CCTV settings state
  const [settings, setSettings] = useState({
    evidence_pre_trigger_seconds: 10,
    evidence_post_trigger_seconds: 10,
    rolling_buffer_seconds: 60,
    evidence_retention_days: 90,
    ptz_speed_multiplier: 2,
    heartbeat_timeout_seconds: 60,
    auto_delete_expired_recordings: false,
    multi_camera_capture_enabled: true
  });

  // Camera Edit/Add Modal state
  const [showCamModal, setShowCamModal] = useState(false);
  const [editingCam, setEditingCam] = useState<any | null>(null);
  const [camForm, setCamForm] = useState({
    id: '',
    branch_id: 'KTW',
    camera_name: 'Cashier Counter 01',
    camera_ip: '10.225.21.190',
    verification_code: 'VPNMKF',
    rtsp_port: '554',
    onvif_port: '80',
    counter_name: 'Counter 01',
    camera_model: 'EZVIZ CS-H6c-R105-1L3WF'
  });

  const loadData = async () => {
    setLoading(true);
    try {
      // Fetch cameras
      const camRes = await fetch('/api/cctv/cameras', { headers: getAuthHeaders() });
      const camData = await camRes.json();
      if (camData.cameras) {
        setCameras(camData.cameras);
      }

      // Fetch global settings
      const setRes = await fetch('/api/cctv/settings', { headers: getAuthHeaders() });
      const setObj = await setRes.json();
      if (setObj.settings) {
        setSettings(setObj.settings);
      }
    } catch (err) {
      toast.error('Failed to load CCTV settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/cctv/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      toast.success('Global CCTV Settings & Retention policies updated!');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const openAddCamModal = () => {
    setEditingCam(null);
    setCamForm({
      id: '',
      branch_id: selectedBranch !== 'ALL' ? selectedBranch : 'KTW',
      camera_name: 'Cashier Counter 01',
      camera_ip: '10.225.21.190',
      verification_code: 'VPNMKF',
      rtsp_port: '554',
      onvif_port: '80',
      counter_name: 'Counter 01',
      camera_model: 'EZVIZ CS-H6c-R105-1L3WF'
    });
    setShowCamModal(true);
  };

  const openEditCamModal = (cam: any) => {
    setEditingCam(cam);
    setCamForm({
      id: cam.id,
      branch_id: cam.branch_id,
      camera_name: cam.camera_name,
      camera_ip: cam.camera_ip,
      verification_code: cam.verification_code || 'VPNMKF',
      rtsp_port: cam.rtsp_port || '554',
      onvif_port: cam.onvif_port || '80',
      counter_name: cam.counter_name || 'Cashier Counter 01',
      camera_model: cam.camera_model || 'EZVIZ CS-H6c'
    });
    setShowCamModal(true);
  };

  const handleSaveCamForm = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        ...camForm,
        camera_protocol: 'ONVIF/RTSP',
        agent_id: `CCTV-AGENT-${camForm.branch_id.toUpperCase()}`
      };

      let res;
      if (editingCam) {
        res = await fetch(`/api/cctv/cameras/${editingCam.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        res = await fetch('/api/cctv/cameras', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }

      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Save failed');
      toast.success(`Camera "${camForm.camera_name}" saved successfully!`);
      setShowCamModal(false);
      loadData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDeleteCam = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to remove camera "${name}"?`)) return;
    try {
      const res = await fetch(`/api/cctv/cameras/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Delete failed');
      toast.success(`Camera ${name} deleted.`);
      loadData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const filteredCameras = selectedBranch === 'ALL'
    ? cameras
    : cameras.filter(c => c.branch_id?.toUpperCase() === selectedBranch.toUpperCase());

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-2 sm:p-4">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl border border-blue-100">
            <Settings className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">Admin CCTV Control & Configuration</h1>
            <p className="text-sm font-semibold text-slate-500">Configure branch camera IPs, RTSP credentials, 20s clip timing, and retention policies</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleSaveSettings} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold">
            <Save className="w-4 h-4 mr-2" /> {saving ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </div>

      {/* Settings Navigation Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveTab('cameras')}
          className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${
            activeTab === 'cameras' ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          <Camera className="w-4 h-4" /> Branch Cameras & IPs ({cameras.length})
        </button>
        <button
          onClick={() => setActiveTab('recording')}
          className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${
            activeTab === 'recording' ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          <Clock className="w-4 h-4" /> Recording & Retention Policies
        </button>
        <button
          onClick={() => setActiveTab('ptz')}
          className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${
            activeTab === 'ptz' ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          <Sliders className="w-4 h-4" /> PTZ Hardware & Agent Health
        </button>
      </div>

      {/* TAB 1: Branch Camera IP & RTSP Credentials Manager */}
      {activeTab === 'cameras' && (
        <Card className="border-slate-200 shadow-sm rounded-2xl overflow-hidden">
          <CardHeader className="bg-slate-50/50 border-b border-slate-200/80 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <CardTitle className="text-base font-bold text-slate-800">Branch Camera IPs & RTSP Configuration</CardTitle>
              <CardDescription className="text-xs font-semibold text-slate-500">
                Manage camera IP addresses, verification codes, and counter assignments across all 14 branches
              </CardDescription>
            </div>
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <select
                value={selectedBranch}
                onChange={e => setSelectedBranch(e.target.value)}
                className="bg-white border border-slate-200 rounded-xl text-xs font-black p-2 text-slate-800 focus:outline-none"
              >
                <option value="ALL">All Branches ({cameras.length} Cameras)</option>
                {BRANCH_LIST.map(b => (
                  <option key={b} value={b}>Branch {b}</option>
                ))}
              </select>
              <Button onClick={openAddCamModal} size="sm" className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs">
                <Plus className="w-4 h-4 mr-1" /> Add Camera
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-slate-500 font-bold">Loading camera configurations...</div>
            ) : filteredCameras.length === 0 ? (
              <div className="p-8 text-center text-slate-500 font-bold">No cameras found for branch {selectedBranch}.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-700">
                  <thead className="bg-slate-100/70 text-slate-600 uppercase font-black tracking-wider text-[10px] border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4">Branch</th>
                      <th className="px-6 py-4">Camera Name & Location</th>
                      <th className="px-6 py-4">Local IP Address</th>
                      <th className="px-6 py-4">Verification Code (Password)</th>
                      <th className="px-6 py-4">RTSP URL Stream</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-semibold">
                    {filteredCameras.map((cam: any) => (
                      <tr key={cam.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-6 py-4">
                          <span className="bg-blue-100 text-blue-800 border border-blue-200 px-2.5 py-1 rounded-md font-black text-xs">
                            {cam.branch_id}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="font-bold text-slate-900 block">{cam.camera_name}</span>
                          <span className="text-[11px] text-slate-400 font-normal">{cam.counter_name} | {cam.camera_model}</span>
                        </td>
                        <td className="px-6 py-4 font-mono font-bold text-blue-600">{cam.camera_ip}</td>
                        <td className="px-6 py-4 font-mono text-slate-700 bg-slate-50 border border-slate-200 px-2 py-1 rounded inline-block my-2">
                          {cam.verification_code || 'VPNMKF'}
                        </td>
                        <td className="px-6 py-4 font-mono text-[11px] text-slate-500 truncate max-w-xs">
                          rtsp://admin:{cam.verification_code || 'VPNMKF'}@{cam.camera_ip}:554/h264/ch1/main/av_stream
                        </td>
                        <td className="px-6 py-4 text-right space-x-2">
                          <Button onClick={() => openEditCamModal(cam)} size="sm" variant="outline" className="rounded-xl text-xs font-bold">
                            <Edit2 className="w-3.5 h-3.5 mr-1 text-blue-600" /> Edit IP
                          </Button>
                          <Button onClick={() => handleDeleteCam(cam.id, cam.camera_name)} size="sm" variant="ghost" className="text-rose-600 hover:bg-rose-50 rounded-xl text-xs font-bold">
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* TAB 2: Recording & Retention Settings */}
      {activeTab === 'recording' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="border-slate-200 shadow-sm rounded-2xl p-6 bg-white space-y-6">
            <div>
              <CardTitle className="text-base font-bold text-slate-900 mb-1">20-Second Transaction Clip Window</CardTitle>
              <CardDescription className="text-xs font-semibold text-slate-500">
                Configure timing window extracted by branch CCTV agents on transaction triggers
              </CardDescription>
            </div>

            <div className="space-y-4">
              <div>
                <Label className="font-bold text-xs text-slate-700">Pre-Trigger Capture Duration (Seconds)</Label>
                <p className="text-[11px] text-slate-400 mb-1">Time captured BEFORE cashier completes pawn transaction (Default: 10s)</p>
                <Input 
                  type="number" 
                  value={settings.evidence_pre_trigger_seconds}
                  onChange={e => setSettings({...settings, evidence_pre_trigger_seconds: parseInt(e.target.value) || 10})}
                  className="font-bold font-mono" 
                />
              </div>

              <div>
                <Label className="font-bold text-xs text-slate-700">Post-Trigger Capture Duration (Seconds)</Label>
                <p className="text-[11px] text-slate-400 mb-1">Time captured AFTER cashier completes pawn transaction (Default: 10s)</p>
                <Input 
                  type="number" 
                  value={settings.evidence_post_trigger_seconds}
                  onChange={e => setSettings({...settings, evidence_post_trigger_seconds: parseInt(e.target.value) || 10})}
                  className="font-bold font-mono" 
                />
              </div>

              <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl text-blue-900 text-xs font-semibold flex items-center justify-between">
                <span>Total MP4 Evidence Clip Duration:</span>
                <span className="font-black text-sm text-blue-700">
                  {settings.evidence_pre_trigger_seconds + settings.evidence_post_trigger_seconds} Seconds
                </span>
              </div>
            </div>
          </Card>

          <Card className="border-slate-200 shadow-sm rounded-2xl p-6 bg-white space-y-6">
            <div>
              <CardTitle className="text-base font-bold text-slate-900 mb-1">Retention & Auto-Purge Policy</CardTitle>
              <CardDescription className="text-xs font-semibold text-slate-500">
                Set storage retention period for evidence MP4 clips in central database
              </CardDescription>
            </div>

            <div className="space-y-4">
              <div>
                <Label className="font-bold text-xs text-slate-700">Evidence Storage Retention Period</Label>
                <select
                  value={settings.evidence_retention_days}
                  onChange={e => setSettings({...settings, evidence_retention_days: parseInt(e.target.value)})}
                  className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-bold text-slate-800"
                >
                  <option value={30}>30 Days (1 Month)</option>
                  <option value={60}>60 Days (2 Months)</option>
                  <option value={90}>90 Days (3 Months - Recommended)</option>
                  <option value={180}>180 Days (6 Months)</option>
                  <option value={365}>365 Days (1 Year Legal Audit)</option>
                </select>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <input 
                  type="checkbox"
                  id="multiCamToggle"
                  checked={settings.multi_camera_capture_enabled}
                  onChange={e => setSettings({...settings, multi_camera_capture_enabled: e.target.checked})}
                  className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500" 
                />
                <label htmlFor="multiCamToggle" className="text-xs font-bold text-slate-800 cursor-pointer">
                  Capture clips from ALL 3 cameras in branch simultaneously
                </label>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* TAB 3: PTZ & Hardware Health */}
      {activeTab === 'ptz' && (
        <Card className="border-slate-200 shadow-sm rounded-2xl p-6 bg-white space-y-6 max-w-2xl">
          <div>
            <CardTitle className="text-base font-bold text-slate-900 mb-1">PTZ Hardware Speed & Heartbeat Alert</CardTitle>
            <CardDescription className="text-xs font-semibold text-slate-500">
              Configure Pan/Tilt motor speed and camera agent ping timeout
            </CardDescription>
          </div>

          <div className="space-y-4">
            <div>
              <Label className="font-bold text-xs text-slate-700">PTZ Motor Speed Multiplier (1x - 5x)</Label>
              <Input 
                type="number" 
                min={1}
                max={5}
                value={settings.ptz_speed_multiplier}
                onChange={e => setSettings({...settings, ptz_speed_multiplier: parseInt(e.target.value) || 2})}
                className="font-bold font-mono mt-1" 
              />
            </div>

            <div>
              <Label className="font-bold text-xs text-slate-700">Agent Heartbeat Timeout Threshold (Seconds)</Label>
              <p className="text-[11px] text-slate-400 mb-1">Marks camera OFFLINE if no agent ping received (Default: 60s)</p>
              <Input 
                type="number" 
                value={settings.heartbeat_timeout_seconds}
                onChange={e => setSettings({...settings, heartbeat_timeout_seconds: parseInt(e.target.value) || 60})}
                className="font-bold font-mono" 
              />
            </div>
          </div>
        </Card>
      )}

      {/* Modal: Add/Edit Camera IP & Credentials */}
      {showCamModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg max-h-[90dvh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex justify-between items-center shrink-0">
              <h3 className="text-base font-black text-slate-900">
                {editingCam ? `Edit Camera IP: ${editingCam.camera_name}` : 'Add New Branch Camera'}
              </h3>
              <button type="button" onClick={() => setShowCamModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>
            <form onSubmit={handleSaveCamForm} className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
              <div>
                <Label className="font-bold text-slate-700 text-xs">Branch</Label>
                <select
                  value={camForm.branch_id}
                  onChange={e => setCamForm({...camForm, branch_id: e.target.value})}
                  className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-bold text-slate-800"
                >
                  {BRANCH_LIST.map(b => (
                    <option key={b} value={b}>Branch {b}</option>
                  ))}
                </select>
              </div>

              <div>
                <Label className="font-bold text-slate-700 text-xs">Camera Name</Label>
                <Input 
                  required 
                  value={camForm.camera_name} 
                  onChange={e => setCamForm({...camForm, camera_name: e.target.value})}
                  placeholder="e.g. Kottawa Cashier Counter 01"
                  className="mt-1 font-semibold" 
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="font-bold text-slate-700 text-xs">Local IP Address</Label>
                  <Input 
                    required 
                    value={camForm.camera_ip} 
                    onChange={e => setCamForm({...camForm, camera_ip: e.target.value})}
                    placeholder="10.225.21.190"
                    className="mt-1 font-mono font-bold text-blue-600" 
                  />
                </div>
                <div>
                  <Label className="font-bold text-slate-700 text-xs">Verification Code (Password)</Label>
                  <Input 
                    required 
                    value={camForm.verification_code} 
                    onChange={e => setCamForm({...camForm, verification_code: e.target.value})}
                    placeholder="VPNMKF"
                    className="mt-1 font-mono font-bold uppercase" 
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="font-bold text-slate-700 text-xs">RTSP Port</Label>
                  <Input 
                    value={camForm.rtsp_port} 
                    onChange={e => setCamForm({...camForm, rtsp_port: e.target.value})}
                    placeholder="554"
                    className="mt-1 font-mono" 
                  />
                </div>
                <div>
                  <Label className="font-bold text-slate-700 text-xs">Counter Location</Label>
                  <Input 
                    value={camForm.counter_name} 
                    onChange={e => setCamForm({...camForm, counter_name: e.target.value})}
                    placeholder="Cashier Counter 01"
                    className="mt-1 font-semibold" 
                  />
                </div>
              </div>

              <div className="pt-4 flex justify-end gap-3 border-t border-slate-100">
                <Button type="button" variant="outline" onClick={() => setShowCamModal(false)} className="rounded-xl font-bold">Cancel</Button>
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold">Save Configuration</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
