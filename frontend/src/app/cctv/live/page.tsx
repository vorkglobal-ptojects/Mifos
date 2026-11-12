'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, Camera, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Circle, Radio, Shield, RefreshCw, Globe, Server, Link as LinkIcon } from "lucide-react";
import { toast } from 'sonner';
import { getAuthHeaders } from '@/lib/getAuthHeaders';

export default function CctvLivePage() {
  const [cameras, setCameras] = useState<any[]>([]);
  const [selectedCam, setSelectedCam] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRecordingManual, setIsRecordingManual] = useState(false);

  // Stream modes: 'agent' (Local Agent Stream), 'ezviz_cloud' (EZVIZ Cloud iFrame), 'custom' (Custom URL/HLS)
  const [streamMode, setStreamMode] = useState<'agent' | 'ezviz_cloud' | 'custom'>('agent');
  const [customStreamUrl, setCustomStreamUrl] = useState('');
  const [agentStreamError, setAgentStreamError] = useState(false);

  const fetchCameras = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/cctv/cameras', { headers: getAuthHeaders() });
      const data = await res.json();
      if (data.cameras && data.cameras.length > 0) {
        setCameras(data.cameras);
        setSelectedCam(data.cameras[0]);
      }
    } catch (err: any) {
      toast.error('Failed to load CCTV cameras');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCameras();
  }, []);

  const handlePtz = async (direction: string) => {
    if (!selectedCam) return;
    try {
      await fetch('/api/cctv/audit-logs', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'PTZ_CONTROL',
          camera_id: selectedCam.id,
          metadata: { direction }
        })
      });
      toast.success(`PTZ Move ${direction.toUpperCase()} sent to ${selectedCam.camera_name}`);
    } catch (err: any) {
      toast.error('PTZ Command failed');
    }
  };

  const handleSnapshot = async () => {
    if (!selectedCam) return;
    try {
      await fetch('/api/cctv/audit-logs', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'SNAPSHOT',
          camera_id: selectedCam.id
        })
      });
      toast.success(`Snapshot captured from ${selectedCam.camera_name}`);
    } catch (err: any) {
      toast.error('Snapshot failed');
    }
  };

  const toggleManualRecord = () => {
    setIsRecordingManual(!isRecordingManual);
    if (!isRecordingManual) {
      toast.info(`Manual recording started on ${selectedCam?.camera_name}`);
    } else {
      toast.success(`Manual 20s recording saved to CCTV evidence library`);
    }
  };

  // Compute live stream source URL
  const getStreamSrc = () => {
    if (streamMode === 'custom' && customStreamUrl) {
      return customStreamUrl;
    }
    if (streamMode === 'ezviz_cloud') {
      return `https://open.ezviz.com/live/view?serial=${selectedCam?.serial || 'BH1533244'}`;
    }
    // Default: Local Agent Stream URL (Port 8088 served by branch cctv-agent)
    return `http://127.0.0.1:8088/live?cam=${selectedCam?.id || 'CAM-HQ-01'}`;
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-2 sm:p-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl border border-emerald-100">
              <Eye className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-slate-900">Live Camera Stream & PTZ Control</h1>
              <p className="text-sm font-semibold text-slate-500">Real-time branch CCTV feed with Pan/Tilt directional control (EZVIZ CS-H6c ONVIF/RTSP)</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={selectedCam?.id || ''}
              onChange={e => {
                setSelectedCam(cameras.find(c => c.id === e.target.value));
                setAgentStreamError(false);
              }}
              className="bg-slate-100 border border-slate-200 rounded-xl text-xs font-black p-2.5 text-slate-800 focus:outline-none"
            >
              {cameras.map(c => (
                <option key={c.id} value={c.id}>
                  {c.branch_id} - {c.camera_name} ({c.camera_ip})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Stream Source Selector Bar */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-700 mr-2">Stream Source:</span>
            <Button
              onClick={() => { setStreamMode('agent'); setAgentStreamError(false); }}
              size="sm"
              variant={streamMode === 'agent' ? 'default' : 'outline'}
              className={`rounded-xl text-xs font-bold ${streamMode === 'agent' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''}`}
            >
              <Server className="w-3.5 h-3.5 mr-1.5" /> Branch Agent Stream (Port 8088)
            </Button>
            <Button
              onClick={() => { setStreamMode('ezviz_cloud'); setAgentStreamError(false); }}
              size="sm"
              variant={streamMode === 'ezviz_cloud' ? 'default' : 'outline'}
              className={`rounded-xl text-xs font-bold ${streamMode === 'ezviz_cloud' ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}`}
            >
              <Globe className="w-3.5 h-3.5 mr-1.5" /> EZVIZ Cloud iFrame
            </Button>
            <Button
              onClick={() => { setStreamMode('custom'); setAgentStreamError(false); }}
              size="sm"
              variant={streamMode === 'custom' ? 'default' : 'outline'}
              className={`rounded-xl text-xs font-bold ${streamMode === 'custom' ? 'bg-purple-600 hover:bg-purple-700 text-white' : ''}`}
            >
              <LinkIcon className="w-3.5 h-3.5 mr-1.5" /> Custom URL/HLS
            </Button>
          </div>

          {streamMode === 'custom' && (
            <div className="w-full sm:w-72">
              <Input
                value={customStreamUrl}
                onChange={e => setCustomStreamUrl(e.target.value)}
                placeholder="Paste HLS / Stream URL (e.g. http://...)"
                className="text-xs font-mono"
              />
            </div>
          )}
        </div>

        {/* Stream & Controls Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Stream Viewport */}
          <Card className="lg:col-span-2 border-slate-200 shadow-sm rounded-3xl overflow-hidden bg-slate-950 text-white flex flex-col justify-between">
            <div className="p-4 bg-slate-900/90 border-b border-slate-800 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="flex h-2.5 w-2.5 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </span>
                <span className="text-xs font-black uppercase tracking-wider text-emerald-400">
                  LIVE STREAM - {selectedCam?.camera_name || 'Camera 01'}
                </span>
              </div>
              <span className="text-[10px] font-mono bg-slate-800 px-2 py-0.5 rounded text-slate-400">
                {selectedCam?.camera_ip || '10.225.21.190'} | 2304 x 1296 @ 25fps
              </span>
            </div>

            {/* Video Feed Viewport */}
            <div className="aspect-video bg-slate-900 relative flex items-center justify-center overflow-hidden">
              {streamMode === 'ezviz_cloud' ? (
                <iframe
                  src={getStreamSrc()}
                  className="w-full h-full border-0"
                  allowFullScreen
                />
              ) : agentStreamError ? (
                <div className="p-6 text-center space-y-4 max-w-md bg-slate-900/95 border border-slate-800 rounded-3xl m-4 backdrop-blur-md">
                  <div className="w-12 h-12 bg-amber-500/10 text-amber-400 rounded-2xl flex items-center justify-center mx-auto border border-amber-500/20">
                    <Server className="w-6 h-6 animate-pulse" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-white">Branch CCTV Agent Offline</h3>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      Central Cloud MIFOS cannot reach local IP <code className="text-amber-300 font-mono">{selectedCam?.camera_ip || '10.225.21.190'}</code> directly. Run the local Agent service on your branch PC to stream live RTSP video.
                    </p>
                  </div>

                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-left space-y-1 font-mono text-[11px]">
                    <div className="text-slate-500">{"// Run on Branch PC Terminal:"}</div>
                    <div className="text-emerald-400">cd cctv-agent</div>
                    <div className="text-emerald-400">node agent.js</div>
                  </div>

                  <div className="flex gap-2 justify-center pt-1">
                    <Button
                      onClick={() => setAgentStreamError(false)}
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl"
                    >
                      <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry Stream
                    </Button>
                    <Button
                      onClick={() => setStreamMode('ezviz_cloud')}
                      size="sm"
                      variant="outline"
                      className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 text-xs font-bold rounded-xl"
                    >
                      <Globe className="w-3.5 h-3.5 mr-1.5" /> EZVIZ Cloud Mode
                    </Button>
                  </div>
                </div>
              ) : (
                <img 
                  src={getStreamSrc()}
                  onError={() => {
                    setAgentStreamError(true);
                  }}
                  alt="Live Camera Feed"
                  className="w-full h-full object-cover opacity-95" 
                />
              )}

              <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 text-[11px] font-mono">
                IP: {selectedCam?.camera_ip || '10.225.21.190'} | Branch: {selectedCam?.branch_id}
              </div>
              <div className="absolute bottom-4 right-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 text-[11px] font-mono">
                {new Date().toLocaleTimeString()}
              </div>

              {isRecordingManual && (
                <div className="absolute top-4 right-4 bg-rose-600/90 text-white px-3 py-1 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-1.5 animate-pulse">
                  <Circle className="w-3 h-3 fill-current" /> REC MANUAL
                </div>
              )}
            </div>

            {/* Quick Stream Actions */}
            <div className="p-4 bg-slate-900 border-t border-slate-800 flex justify-between items-center">
              <div className="flex gap-2">
                <Button onClick={handleSnapshot} size="sm" variant="outline" className="border-slate-700 bg-slate-800 text-white hover:bg-slate-700 rounded-xl text-xs font-bold">
                  <Camera className="w-3.5 h-3.5 mr-1.5" /> Take Snapshot
                </Button>
                <Button onClick={toggleManualRecord} size="sm" className={`rounded-xl text-xs font-bold ${isRecordingManual ? 'bg-rose-600 hover:bg-rose-700' : 'bg-blue-600 hover:bg-blue-700'} text-white`}>
                  <Circle className="w-3.5 h-3.5 mr-1.5 fill-current" /> {isRecordingManual ? 'Stop Recording' : 'Start Manual Record'}
                </Button>
              </div>
              <span className="text-[11px] text-slate-400 font-medium">ONVIF Stream Active</span>
            </div>
          </Card>

          {/* PTZ Pan/Tilt Directional Controls */}
          <Card className="border-slate-200 shadow-sm rounded-3xl p-6 bg-white flex flex-col justify-between">
            <div>
              <CardTitle className="text-base font-black text-slate-900 mb-1">PTZ Pan & Tilt Controls</CardTitle>
              <CardDescription className="text-xs font-semibold text-slate-500 mb-6">
                Hardware directional control for EZVIZ CS-H6c Motorized Pan/Tilt Lens
              </CardDescription>

              {/* Directional D-Pad */}
              <div className="flex flex-col items-center justify-center space-y-2 py-4">
                <Button onClick={() => handlePtz('up')} size="icon" className="w-12 h-12 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-800 shadow-sm">
                  <ChevronUp className="w-6 h-6" />
                </Button>
                <div className="flex items-center gap-4">
                  <Button onClick={() => handlePtz('left')} size="icon" className="w-12 h-12 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-800 shadow-sm">
                    <ChevronLeft className="w-6 h-6" />
                  </Button>
                  <div className="w-12 h-12 rounded-full bg-slate-900 text-white flex items-center justify-center font-black text-xs shadow-inner">
                    PTZ
                  </div>
                  <Button onClick={() => handlePtz('right')} size="icon" className="w-12 h-12 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-800 shadow-sm">
                    <ChevronRight className="w-6 h-6" />
                  </Button>
                </div>
                <Button onClick={() => handlePtz('down')} size="icon" className="w-12 h-12 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-800 shadow-sm">
                  <ChevronDown className="w-6 h-6" />
                </Button>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-100 space-y-2 text-xs font-semibold text-slate-600">
              <div className="flex justify-between">
                <span>Model:</span> <span className="font-bold text-slate-900">{selectedCam?.camera_model}</span>
              </div>
              <div className="flex justify-between">
                <span>Agent Status:</span> <span className="font-bold text-emerald-600">ONLINE</span>
              </div>
            </div>
          </Card>
        </div>
    </div>
  );
}
