'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Camera, Plus, RefreshCw, Shield, CheckCircle2, AlertTriangle, Radio } from "lucide-react";
import { toast } from 'sonner';
import { getAuthHeaders } from '@/lib/getAuthHeaders';

export default function CctvCamerasPage() {
  const [cameras, setCameras] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [formData, setFormData] = useState({
    camera_name: '',
    branch_id: 'HQ',
    camera_ip: '192.168.1.100',
    counter_name: 'Cashier Counter 01',
    camera_model: 'EZVIZ CS-H6c-R105-1L3WF',
    camera_protocol: 'ONVIF/RTSP'
  });

  const fetchCameras = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/cctv/cameras', { headers: getAuthHeaders() });
      const data = await res.json();
      if (data.cameras) {
        setCameras(data.cameras);
      }
    } catch (err: any) {
      toast.error('Failed to load CCTV camera list');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCameras();
  }, []);

  const handleAddCamera = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/cctv/cameras', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(formData)
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to save camera');
      }
      toast.success(`Camera "${formData.camera_name}" registered successfully!`);
      setShowAddModal(false);
      fetchCameras();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-2 sm:p-4">
      {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-2xl border border-[#d6d6d6] shadow-sm">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-[#ffd100]/20 text-[#202020] rounded-2xl border border-[#ffd100]/40">
              <Camera className="w-8 h-8 text-[#202020]" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-[#202020]">Branch Camera Registry</h1>
              <p className="text-sm font-semibold text-slate-600">Manage EZVIZ CCTV cameras registered across branch counters</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={fetchCameras} variant="outline" size="sm" className="rounded-xl font-bold border-[#d6d6d6] bg-white hover:bg-slate-100 text-[#202020]">
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin text-[#ffd100]' : ''}`} /> Refresh Status
            </Button>
            <Button onClick={() => setShowAddModal(true)} size="sm" className="bg-[#ffd100] hover:bg-[#ffee32] text-[#202020] rounded-xl font-black border border-[#ffd100] shadow-sm">
              <Plus className="w-4 h-4 mr-2" /> Register New Camera
            </Button>
          </div>
        </div>

        {/* Camera List Table */}
        <Card className="border-[#d6d6d6] shadow-sm rounded-2xl overflow-hidden bg-white">
          <CardHeader className="bg-[#202020] text-white border-b border-[#333533] p-6">
            <CardTitle className="text-base font-bold text-[#ffd100]">Active Cameras ({cameras.length})</CardTitle>
            <CardDescription className="text-xs font-semibold text-slate-300">
              CCTV agents report heartbeats every 30 seconds to confirm ONVIF/RTSP connectivity
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-slate-500 font-bold">Loading camera data...</div>
            ) : cameras.length === 0 ? (
              <div className="p-8 text-center text-slate-500 font-bold">No cameras registered yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-700">
                  <thead className="bg-[#333533] text-slate-200 uppercase font-black tracking-wider text-[10px] border-b border-[#333533]">
                    <tr>
                      <th className="px-6 py-4 text-[#ffd100]">Status</th>
                      <th className="px-6 py-4">Camera Name</th>
                      <th className="px-6 py-4">Branch</th>
                      <th className="px-6 py-4">Counter</th>
                      <th className="px-6 py-4">Local IP</th>
                      <th className="px-6 py-4">Protocol & Model</th>
                      <th className="px-6 py-4">Agent ID</th>
                      <th className="px-6 py-4">Last Heartbeat</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-semibold">
                    {cameras.map((cam: any) => (
                      <tr key={cam.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                            cam.status === 'ONLINE' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-rose-100 text-rose-700 border border-rose-200'
                          }`}>
                            <Radio className="w-3 h-3 animate-pulse" /> {cam.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 font-bold text-slate-900">{cam.camera_name}</td>
                        <td className="px-6 py-4"><span className="bg-slate-100 px-2 py-1 rounded font-black text-slate-700">{cam.branch_id}</span></td>
                        <td className="px-6 py-4">{cam.counter_name}</td>
                        <td className="px-6 py-4 font-mono text-slate-600">{cam.camera_ip}</td>
                        <td className="px-6 py-4 text-slate-600">{cam.camera_model} ({cam.camera_protocol})</td>
                        <td className="px-6 py-4 font-mono text-xs text-blue-600">{cam.agent_id}</td>
                        <td className="px-6 py-4 text-slate-500 text-[11px]">{new Date(cam.last_heartbeat).toLocaleTimeString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Modal: Register Camera */}
        {showAddModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-lg max-h-[90dvh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
              <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex justify-between items-center shrink-0">
                <h3 className="text-lg font-black text-slate-900">Register New Camera</h3>
                <button type="button" onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
              </div>
              <form onSubmit={handleAddCamera} className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
                <div>
                  <Label className="font-bold text-slate-700 text-xs">Camera Name</Label>
                  <Input 
                    required 
                    value={formData.camera_name} 
                    onChange={e => setFormData({...formData, camera_name: e.target.value})}
                    placeholder="e.g. Kottawa Cashier Counter 01"
                    className="mt-1 font-semibold" 
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="font-bold text-slate-700 text-xs">Branch ID</Label>
                    <Input 
                      required 
                      value={formData.branch_id} 
                      onChange={e => setFormData({...formData, branch_id: e.target.value.toUpperCase()})}
                      placeholder="HQ, KTW, TEST"
                      className="mt-1 font-semibold uppercase" 
                    />
                  </div>
                  <div>
                    <Label className="font-bold text-slate-700 text-xs">Camera Local IP</Label>
                    <Input 
                      required 
                      value={formData.camera_ip} 
                      onChange={e => setFormData({...formData, camera_ip: e.target.value})}
                      placeholder="192.168.10.50"
                      className="mt-1 font-semibold" 
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="font-bold text-slate-700 text-xs">Counter Location</Label>
                    <Input 
                      value={formData.counter_name} 
                      onChange={e => setFormData({...formData, counter_name: e.target.value})}
                      placeholder="Cashier Counter 01"
                      className="mt-1 font-semibold" 
                    />
                  </div>
                  <div>
                    <Label className="font-bold text-slate-700 text-xs">Protocol</Label>
                    <Input 
                      value={formData.camera_protocol} 
                      onChange={e => setFormData({...formData, camera_protocol: e.target.value})}
                      placeholder="ONVIF/RTSP"
                      className="mt-1 font-semibold" 
                    />
                  </div>
                </div>
                <div className="pt-4 flex justify-end gap-3 border-t border-slate-100">
                  <Button type="button" variant="outline" onClick={() => setShowAddModal(false)} className="rounded-xl font-bold">Cancel</Button>
                  <Button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold">Register Camera</Button>
                </div>
              </form>
            </div>
          </div>
        )}
    </div>
  );
}
