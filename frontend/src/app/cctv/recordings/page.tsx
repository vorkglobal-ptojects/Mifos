'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlaySquare, Search, Download, Eye, Film, ShieldAlert, CheckCircle2, Clock } from "lucide-react";
import { toast } from 'sonner';
import { getAuthHeaders } from '@/lib/getAuthHeaders';

export default function CctvRecordingsPage() {
  const [recordings, setRecordings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchPawn, setSearchPawn] = useState('');
  const [activeRecording, setActiveRecording] = useState<any | null>(null);

  const fetchRecordings = async () => {
    setLoading(true);
    try {
      let url = '/api/cctv/recordings';
      if (searchPawn) {
        url += `?pawn_id=${encodeURIComponent(searchPawn)}`;
      }
      const res = await fetch(url, { headers: getAuthHeaders() });
      const data = await res.json();
      if (data.recordings) {
        setRecordings(data.recordings);
      }
    } catch (err: any) {
      toast.error('Failed to load CCTV recordings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecordings();
  }, []);

  const handlePlayVideo = async (rec: any) => {
    setActiveRecording(rec);
    // Audit Log
    try {
      await fetch('/api/cctv/audit-logs', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'PLAYBACK',
          recording_id: rec.id,
          camera_id: rec.camera_id,
          metadata: { pawn_id: rec.pawn_id }
        })
      });
    } catch (err) {
      // audit log failure non-blocking
    }
  };

  const handleDownload = async (rec: any) => {
    try {
      await fetch('/api/cctv/audit-logs', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'DOWNLOAD',
          recording_id: rec.id,
          camera_id: rec.camera_id,
          metadata: { pawn_id: rec.pawn_id }
        })
      });
      window.open(rec.file_path, '_blank');
      toast.success(`Downloading evidence clip for ${rec.pawn_id}`);
    } catch (err: any) {
      toast.error('Download failed: ' + err.message);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-2 sm:p-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-2xl border border-[#d6d6d6] shadow-sm">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-[#ffd100]/20 text-[#202020] rounded-2xl border border-[#ffd100]/40">
              <PlaySquare className="w-8 h-8 text-[#202020]" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-[#202020]">Transaction Evidence Clips</h1>
              <p className="text-sm font-semibold text-slate-600">20-second MP4 CCTV clips linked to Pawn Ticket Numbers (10s before + 10s after trigger)</p>
            </div>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
              <Input 
                value={searchPawn}
                onChange={e => setSearchPawn(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && fetchRecordings()}
                placeholder="Search Pawn Ticket ID..." 
                className="pl-9 font-semibold rounded-xl text-xs border-[#d6d6d6] bg-white"
              />
            </div>
            <Button onClick={fetchRecordings} className="bg-[#ffd100] hover:bg-[#ffee32] text-[#202020] rounded-xl font-black text-xs border border-[#ffd100] shadow-sm">
              Search
            </Button>
          </div>
        </div>

        {/* Evidence List */}
        <Card className="border-[#d6d6d6] shadow-sm rounded-2xl overflow-hidden bg-white">
          <CardHeader className="bg-[#202020] text-white border-b border-[#333533] p-6">
            <CardTitle className="text-base font-bold text-[#ffd100]">Recorded Evidence ({recordings.length})</CardTitle>
            <CardDescription className="text-xs font-semibold text-slate-500">
              Clips automatically extracted by branch CCTV agents and uploaded securely
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-slate-500 font-bold">Loading recordings...</div>
            ) : recordings.length === 0 ? (
              <div className="p-8 text-center text-slate-500 font-bold">No evidence clips found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-700">
                  <thead className="bg-slate-100/70 text-slate-600 uppercase font-black tracking-wider text-[10px] border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4">Pawn Ticket ID</th>
                      <th className="px-6 py-4">Branch</th>
                      <th className="px-6 py-4">Duration</th>
                      <th className="px-6 py-4">Camera</th>
                      <th className="px-6 py-4">Cashier</th>
                      <th className="px-6 py-4">Created Time</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-semibold">
                    {recordings.map((rec: any) => (
                      <tr key={rec.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3" /> Ready
                          </span>
                        </td>
                        <td className="px-6 py-4 font-black text-indigo-600 text-sm">{rec.pawn_id}</td>
                        <td className="px-6 py-4"><span className="bg-slate-100 px-2 py-1 rounded font-black text-slate-700">{rec.branch_id}</span></td>
                        <td className="px-6 py-4 font-mono text-slate-600">{rec.duration || 20} seconds</td>
                        <td className="px-6 py-4 font-mono text-xs text-slate-600">{rec.camera_id}</td>
                        <td className="px-6 py-4 text-slate-600">{rec.cashier_id}</td>
                        <td className="px-6 py-4 text-slate-500 text-[11px]">{new Date(rec.created_at).toLocaleString()}</td>
                        <td className="px-6 py-4 text-right space-x-2">
                          <Button onClick={() => handlePlayVideo(rec)} size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold">
                            <Eye className="w-3.5 h-3.5 mr-1" /> Play Clip
                          </Button>
                          <Button onClick={() => handleDownload(rec)} size="sm" variant="outline" className="rounded-xl text-xs font-bold">
                            <Download className="w-3.5 h-3.5 mr-1" /> Download
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

        {/* Video Player Modal */}
        {activeRecording && (
          <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-3xl rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95">
              <div className="bg-slate-900 px-6 py-4 flex justify-between items-center text-white">
                <div className="flex items-center gap-2">
                  <Film className="w-5 h-5 text-indigo-400" />
                  <h3 className="text-base font-black">CCTV Evidence: {activeRecording.pawn_id}</h3>
                </div>
                <button onClick={() => setActiveRecording(null)} className="text-slate-400 hover:text-white font-bold text-lg">✕</button>
              </div>

              {/* Video Frame */}
              <div className="bg-black aspect-video flex items-center justify-center relative">
                <video 
                  controls 
                  autoPlay 
                  className="w-full h-full max-h-[420px] object-contain"
                  src={activeRecording.file_path}
                >
                  Your browser does not support the video tag.
                </video>
              </div>

              {/* Metadata details */}
              <div className="p-6 bg-slate-50 border-t border-slate-200 space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                  <div>
                    <span className="block text-slate-400 font-bold text-[10px] uppercase">Pawn Ticket ID</span>
                    <span className="font-black text-indigo-600 text-sm">{activeRecording.pawn_id}</span>
                  </div>
                  <div>
                    <span className="block text-slate-400 font-bold text-[10px] uppercase">Branch & Camera</span>
                    <span className="font-bold text-slate-800">{activeRecording.branch_id} - {activeRecording.camera_id}</span>
                  </div>
                  <div>
                    <span className="block text-slate-400 font-bold text-[10px] uppercase">Video Window</span>
                    <span className="font-bold text-slate-800">10s Pre + 10s Post Trigger</span>
                  </div>
                  <div>
                    <span className="block text-slate-400 font-bold text-[10px] uppercase">Cashier</span>
                    <span className="font-bold text-slate-800">{activeRecording.cashier_id}</span>
                  </div>
                </div>

                <div className="flex justify-between items-center pt-3 border-t border-slate-200">
                  <span className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" /> Created: {new Date(activeRecording.created_at).toLocaleString()}
                  </span>
                  <Button onClick={() => handleDownload(activeRecording)} size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs">
                    <Download className="w-3.5 h-3.5 mr-1.5" /> Download MP4 Clip
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
