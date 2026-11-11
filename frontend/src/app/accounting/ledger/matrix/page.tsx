'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  Building2, Calendar, CheckCircle2, AlertTriangle, FileSpreadsheet, 
  RefreshCw, ArrowLeft, ChevronRight, Layers, BarChart3
} from 'lucide-react';
import Link from 'next/link';
import { getAuthHeaders } from '@/lib/getAuthHeaders';

interface MonthData {
  month: string;
  entered_count: number;
  flagged_count: number;
  days: string[];
}

interface BranchMatrixItem {
  branch_id: string;
  branch_name: string;
  months: Record<string, MonthData>;
  total_entered: number;
  total_flagged: number;
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

export default function LedgerMatrixPage() {
  const [selectedYear, setSelectedYear] = useState('2026');
  const [matrixData, setMatrixData] = useState<Record<string, BranchMatrixItem>>({});
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMatrix = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ledger/matrix?year=${selectedYear}`, { headers: getAuthHeaders() });
      const data = await res.json();

      if (data.error) {
        setError(data.error);
      } else {
        setBranches(data.branches || []);
        setMatrixData(data.matrix || {});
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedYear]);

  useEffect(() => {
    fetchMatrix();
  }, [fetchMatrix]);

  // Total summary statistics
  const grandTotalEntered = Object.values(matrixData).reduce((sum, b) => sum + (b.total_entered || 0), 0);
  const grandTotalFlagged = Object.values(matrixData).reduce((sum, b) => sum + (b.total_flagged || 0), 0);

  return (
    <div className="rounded-3xl bg-slate-900 text-slate-100 p-4 md:p-8 space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-slate-800/80 backdrop-blur border border-slate-700/60 p-6 rounded-2xl shadow-2xl">
        <div className="flex items-center gap-4">
          <Link href="/accounting/ledger" className="p-3 bg-slate-700/50 hover:bg-slate-700 rounded-xl transition">
            <ArrowLeft className="w-5 h-5 text-slate-300" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
                <BarChart3 className="w-7 h-7 text-emerald-400" />
                14 Branches Ledger Progress Matrix
              </h1>
              <span className="px-3 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full text-xs font-bold uppercase tracking-wider">
                Multi-Branch Audit
              </span>
            </div>
            <p className="text-slate-400 text-sm mt-1">
              Track month-by-month paper ledger completion and audit flags across all 14 branches.
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-white font-bold text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
          >
            <option value="2024">Year 2024</option>
            <option value="2025">Year 2025</option>
            <option value="2026">Year 2026</option>
          </select>
          <button
            onClick={fetchMatrix}
            disabled={loading}
            className="p-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-slate-200 transition disabled:opacity-50"
            title="Refresh Matrix"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <Link
            href="/accounting/ledger/entry"
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm transition shadow-lg shadow-emerald-600/30"
          >
            <FileSpreadsheet className="w-4 h-4" />
            + Enter Daily Ledger
          </Link>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-800/50 border border-slate-700/60 p-5 rounded-2xl flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Days Entered ({selectedYear})</p>
            <p className="text-3xl font-black text-white mt-1">{grandTotalEntered} Days</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-800/50 border border-slate-700/60 p-5 rounded-2xl flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Flagged Mismatch Days</p>
            <p className={`text-3xl font-black mt-1 ${grandTotalFlagged > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {grandTotalFlagged} Days
            </p>
          </div>
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${
            grandTotalFlagged > 0 ? 'bg-rose-500/20 border-rose-500/30 text-rose-400' : 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
          }`}>
            <AlertTriangle className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-800/50 border border-slate-700/60 p-5 rounded-2xl flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Branches Tracked</p>
            <p className="text-3xl font-black text-white mt-1">{branches.length} Branches</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
            <Building2 className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Main Matrix Table */}
      <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl overflow-hidden shadow-2xl">
        <div className="p-5 border-b border-slate-700/60 flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-white flex items-center gap-2">
            <Layers className="w-5 h-5 text-emerald-400" />
            Completion Progress Matrix ({selectedYear})
          </h2>
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
              <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" /> Complete (25+ Days)
            </span>
            <span className="flex items-center gap-1.5 text-amber-400 font-bold">
              <span className="w-3 h-3 rounded-full bg-amber-500 inline-block" /> In Progress (1-24 Days)
            </span>
            <span className="flex items-center gap-1.5 text-slate-500 font-bold">
              <span className="w-3 h-3 rounded-full bg-slate-700 inline-block" /> Not Started
            </span>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-400 animate-pulse font-medium">
            Loading 11 Branches Matrix...
          </div>
        ) : error ? (
          <div className="p-8 bg-rose-950/50 text-rose-300 text-sm font-semibold text-center">
            {error}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-900/80 text-slate-400 font-bold border-b border-slate-700/80">
                  <th className="py-3.5 px-4 sticky left-0 bg-slate-900/90 min-w-[140px] z-10">Branch</th>
                  {MONTH_NAMES.map((m, idx) => (
                    <th key={idx} className="py-3.5 px-3 text-center min-w-[75px]">{m}</th>
                  ))}
                  <th className="py-3.5 px-4 text-right min-w-[90px]">Total Days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/40">
                {branches.map((b) => {
                  const item = matrixData[b.id];
                  return (
                    <tr key={b.id} className="hover:bg-slate-700/30 transition">
                      {/* Branch Name Column */}
                      <td className="py-3 px-4 font-extrabold text-white sticky left-0 bg-slate-900/90 z-10 flex items-center justify-between">
                        <span>{b.name}</span>
                        <span className="text-[10px] text-slate-500 font-mono">({b.id})</span>
                      </td>

                      {/* 12 Months Columns */}
                      {MONTH_NAMES.map((_, mIdx) => {
                        const mKey = `${selectedYear}-${String(mIdx + 1).padStart(2, '0')}`;
                        const mData = item?.months?.[mKey];
                        const count = mData?.entered_count || 0;
                        const flagged = mData?.flagged_count || 0;

                        let badgeColor = 'bg-slate-800 text-slate-500 border-slate-700';
                        if (count >= 25) {
                          badgeColor = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-bold';
                        } else if (count > 0) {
                          badgeColor = 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold';
                        }

                        return (
                          <td key={mIdx} className="py-3 px-2 text-center">
                            <Link
                              href={`/accounting/ledger/entry?branch=${b.id}&month=${mKey}`}
                              className={`inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs transition hover:scale-105 ${badgeColor}`}
                              title={`${count} days entered in ${mKey}`}
                            >
                              <span>{count}</span>
                              {flagged > 0 && (
                                <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
                              )}
                            </Link>
                          </td>
                        );
                      })}

                      {/* Total Days */}
                      <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400">
                        {item?.total_entered || 0}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
