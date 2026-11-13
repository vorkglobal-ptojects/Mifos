'use client';

import Link from "next/link";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  BarChart4, TrendingUp, AlertTriangle, Download, 
  RefreshCcw, FileSpreadsheet, FileText, Landmark,
  ChevronRight, Calendar
} from "lucide-react";
import { toast } from "sonner";
import { normalizeBranchId } from "@/lib/branch-mapping";
import { getAuthHeaders } from "@/lib/getAuthHeaders";

export default function ReportsPage() {
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [portfolio, setPortfolio] = useState<any>(null);
  const [aging, setAging] = useState<any>(null);
  const [daily, setDaily] = useState<any[]>([]);
  const [rawPawns, setRawPawns] = useState<any[]>([]);
  const [rawTxs, setRawTxs] = useState<any[]>([]);

  useEffect(() => {
    loadReports();
  }, []);

  const loadReports = async () => {
    setLoading(true);
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
      const user = stored ? JSON.parse(stored) : null;
      const userBranch = user?.branchId || user?.branch_id;
      const isHead = !userBranch || normalizeBranchId(userBranch) === 'HQ' || userBranch.toUpperCase() === 'HEAD OFFICE';
      const filterBranch = (!isHead && userBranch && user?.role !== 'ADMIN')
        ? normalizeBranchId(userBranch)
        : 'ALL';
      const headers = getAuthHeaders();

      const [txsRes, pawnsRes] = await Promise.all([
        fetch(`/api/transactions?viewMode=${filterBranch === 'ALL' ? 'GLOBAL' : 'LOCAL'}&branchId=${encodeURIComponent(filterBranch)}`, {
          cache: 'no-store',
          headers
        }),
        fetch(`/api/pawns?filterBranch=${encodeURIComponent(filterBranch)}`, {
          cache: 'no-store',
          headers
        })
      ]);

      if (!txsRes.ok) throw new Error('Failed to load transactions for report');
      if (!pawnsRes.ok) throw new Error('Failed to load pawns for report');

      const txs = await txsRes.json();
      const pawns = await pawnsRes.json();
      const txList = Array.isArray(txs) ? txs : [];
      const pawnList = Array.isArray(pawns) ? pawns : [];
      setRawTxs(txList);
      setRawPawns(pawnList);

      // 2. Compute dynamic outstanding active portfolio and aging analysis
      const activePawns = pawnList.filter((p: any) => p.status === 'ACTIVE');
      const totalActivePortfolio = activePawns.reduce((acc: number, p: any) => acc + (p.disbursed_amount || 0), 0);

      const now = new Date();
      let bucketCurrent = 0;
      let bucket31_60 = 0;
      let bucket61_90 = 0;
      let bucket90_plus = 0;

      activePawns.forEach((p: any) => {
        const created = new Date(p.created_at || now);
        const diffTime = Math.abs(now.getTime() - created.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const amt = p.disbursed_amount || 0;

        if (diffDays <= 30) {
          bucketCurrent += amt;
        } else if (diffDays <= 60) {
          bucket31_60 += amt;
        } else if (diffDays <= 90) {
          bucket61_90 += amt;
        } else {
          bucket90_plus += amt;
        }
      });

      const parPct = totalActivePortfolio > 0 
        ? parseFloat(((bucket90_plus / totalActivePortfolio) * 100).toFixed(1)) 
        : 0;

      setPortfolio({
        totalDisbursed: totalActivePortfolio,
        portfolioAtRisk_pct: parPct
      });

      setAging({
        agingBuckets: {
          current: bucketCurrent,
          days_31_60: bucket31_60,
          days_61_90: bucket61_90,
          days_90_plus: bucket90_plus
        }
      });

      // 3. Compute daily transaction chart values
      const days: Record<string, {count: number, total: number}> = {};
      txList.forEach((t: any) => {
         const d = new Date(t.timestamp || new Date()).toISOString().split('T')[0];
         if (!days[d]) days[d] = {count: 0, total: 0};
         days[d].count++;
         days[d].total += (Number(t.amount) || 0);
      });
      
      const dailyArr = Object.entries(days).map(([date, val]) => ({
         date, count: val.count, totalAmount: val.total
      })).sort((a,b) => b.date.localeCompare(a.date));
      
      setDaily(dailyArr);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load management reports');
    }
    setLoading(false);
  };

  const triggerBlobDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadFile = async (_endpoint: string, filename: string) => {
    setExporting(true);
    try {
      const buckets = aging?.agingBuckets || { current: 0, days_31_60: 0, days_61_90: 0, days_90_plus: 0 };
      const todayStr = new Date().toISOString().split('T')[0];
      const stampedName = filename.replace(/(\.\w+)$/, `_${todayStr}$1`);

      if (filename.endsWith('.csv')) {
        const csvEscape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const rows: string[] = [
          'Section,Metric / Bill No,Branch,Date,Status / Category,Amount (LKR)',
          `Portfolio Summary,Total Active Portfolio,ALL,${todayStr},ACTIVE,${Number(portfolio?.totalDisbursed || 0)}`,
          `Portfolio Summary,Portfolio At Risk (>90d) %,ALL,${todayStr},PAR,${Number(portfolio?.portfolioAtRisk_pct || 0)}`,
          `Aging Buckets,Current (0-30d),ALL,${todayStr},BUCKET,${Number(buckets.current || 0)}`,
          `Aging Buckets,31-60 Days,ALL,${todayStr},BUCKET,${Number(buckets.days_31_60 || 0)}`,
          `Aging Buckets,61-90 Days,ALL,${todayStr},BUCKET,${Number(buckets.days_61_90 || 0)}`,
          `Aging Buckets,90+ Days,ALL,${todayStr},BUCKET,${Number(buckets.days_90_plus || 0)}`
        ];
        for (const p of rawPawns) {
          rows.push(
            [
              'Pawn Ticket',
              p.bill_no || p.id,
              p.branch_id || '',
              String(p.created_at || '').split('T')[0],
              p.status || '',
              Number(p.disbursed_amount || 0)
            ].map(csvEscape).join(',')
          );
        }
        const blob = new Blob(['\ufeff' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        triggerBlobDownload(blob, stampedName);
        toast.success(`Exported ${stampedName}`);
      } else if (filename.endsWith('.xlsx')) {
        const XLSX = await import('xlsx');
        const wb = XLSX.utils.book_new();
        const wsSummary = XLSX.utils.aoa_to_sheet([
          ['MIFOS Management Portfolio Report', todayStr],
          [],
          ['Metric', 'Value'],
          ['Total Active Portfolio (LKR)', Number(portfolio?.totalDisbursed || 0)],
          ['Portfolio At Risk (>90d) %', Number(portfolio?.portfolioAtRisk_pct || 0)],
          ['Current (0-30 Days)', Number(buckets.current || 0)],
          ['31-60 Days', Number(buckets.days_31_60 || 0)],
          ['61-90 Days', Number(buckets.days_61_90 || 0)],
          ['90+ Days Overdue', Number(buckets.days_90_plus || 0)]
        ]);
        XLSX.utils.book_append_sheet(wb, wsSummary, 'Portfolio & Aging');

        const wsDaily = XLSX.utils.aoa_to_sheet([
          ['Date', 'Transactions Count', 'Total Volume (LKR)'],
          ...daily.map((d) => [d.date, d.count, Number(d.totalAmount || 0)])
        ]);
        XLSX.utils.book_append_sheet(wb, wsDaily, 'Daily Volumes');

        const wsPawns = XLSX.utils.aoa_to_sheet([
          ['Bill No', 'Branch', 'Status', 'Disbursed (LKR)', 'Appraised (LKR)', 'Created Date'],
          ...rawPawns.map((p) => [
            p.bill_no || p.id,
            p.branch_id || '',
            p.status || '',
            Number(p.disbursed_amount || 0),
            Number(p.appraised_value || 0),
            String(p.created_at || '').split('T')[0]
          ])
        ]);
        XLSX.utils.book_append_sheet(wb, wsPawns, 'Pawn Portfolio');

        const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([buf], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        triggerBlobDownload(blob, stampedName);
        toast.success(`Exported ${stampedName}`);
      } else if (filename.endsWith('.pdf')) {
        const { jsPDF } = await import('jspdf');
        const doc = new jsPDF();
        doc.setFontSize(16);
        doc.text('MIFOS Management Portfolio & Risk Report', 14, 18);
        doc.setFontSize(10);
        doc.text(`Generated: ${todayStr} | Total Transactions: ${rawTxs.length} | Total Loans: ${rawPawns.length}`, 14, 26);
        doc.text(`Active Portfolio: Rs. ${Number(portfolio?.totalDisbursed || 0).toLocaleString()}`, 14, 36);
        doc.text(`Portfolio At Risk (>90 days): ${portfolio?.portfolioAtRisk_pct || 0}%`, 14, 43);
        doc.text('Aging Buckets:', 14, 55);
        doc.text(`- Current (0-30d): Rs. ${Number(buckets.current || 0).toLocaleString()}`, 18, 62);
        doc.text(`- 31-60 Days: Rs. ${Number(buckets.days_31_60 || 0).toLocaleString()}`, 18, 69);
        doc.text(`- 61-90 Days: Rs. ${Number(buckets.days_61_90 || 0).toLocaleString()}`, 18, 76);
        doc.text(`- 90+ Days: Rs. ${Number(buckets.days_90_plus || 0).toLocaleString()}`, 18, 83);
        doc.text('Recent Daily Volumes:', 14, 96);
        daily.slice(0, 18).forEach((d, idx) => {
          doc.text(`${d.date}: ${d.count} txns — Rs. ${Number(d.totalAmount || 0).toLocaleString()}`, 18, 103 + idx * 7);
        });
        doc.save(stampedName);
        toast.success(`Exported ${stampedName}`);
      }
    } catch (err: any) {
      console.error('Export failed:', err);
      toast.error(err?.message || 'Failed to export report');
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCcw className="animate-spin h-8 w-8 text-blue-600" /></div>;

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-20">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 bg-white p-6 sm:p-8 rounded-2xl shadow-sm border border-slate-200">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-rose-600 font-black tracking-widest text-xs uppercase mb-2">
            <BarChart4 className="h-4 w-4" /> Portfolio Intelligence
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-slate-900 leading-none">Management Reporting</h1>
          <p className="text-slate-500 font-medium tracking-tight">Risk analysis, portfolio aging, and transaction summaries.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button onClick={loadReports} variant="outline" className="gap-2 font-bold border-slate-300">
            <RefreshCcw className="h-4 w-4" /> Recalculate Risk
          </Button>
          <Button onClick={() => downloadFile('/reports/export/master', 'master_export.csv')} className="bg-slate-900 hover:bg-slate-800 text-white font-bold px-6 shadow-lg shadow-slate-100 gap-2">
            <Download className="h-4 w-4" /> Master Export
          </Button>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* PAR % Gauge */}
        <Card className="bg-white border-slate-200 shadow-sm overflow-hidden">
          <CardHeader className="border-b border-slate-50">
            <CardTitle className="text-lg font-black flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-rose-600" /> Portfolio At Risk (PAR)
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center py-10">
            <div className={`text-6xl font-black mb-2 ${portfolio?.portfolioAtRisk_pct > 15 ? 'text-rose-600' : 'text-emerald-600'}`}>
              {portfolio?.portfolioAtRisk_pct || '0'}%
            </div>
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest text-center">
              Ratio of Outstanding Portfolio <br/> with due payments {'>'} 90 days.
            </p>
            <div className="w-full bg-slate-100 h-2 rounded-full mt-8 overflow-hidden">
              <div 
                className={`h-full transition-all duration-1000 ${portfolio?.portfolioAtRisk_pct > 15 ? 'bg-rose-500 shadow-[0_0_8px_rose]' : 'bg-emerald-500 shadow-[0_0_8px_emerald]'}`}
                style={{ width: `${Math.min(portfolio?.portfolioAtRisk_pct || 0, 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Aging Buckets */}
        <Card className="lg:col-span-2 bg-white border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-50">
            <CardTitle className="text-lg font-black flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-blue-600" /> Aging Analysis (Buckets)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="space-y-6">
              {Object.entries(aging?.agingBuckets || {}).map(([key, val]: any) => (
                <div key={key} className="space-y-2">
                  <div className="flex justify-between text-xs font-black uppercase tracking-wider text-slate-500">
                    <span>{key.replace(/_/g, ' ')}</span>
                    <span className="text-slate-900">Rs. {val.toLocaleString()}</span>
                  </div>
                  <div className="h-3 w-full bg-slate-50 rounded-lg overflow-hidden border border-slate-100">
                    <div 
                      className={`h-full transition-all duration-1000 ${
                        key.includes('current') ? 'bg-blue-500' : 
                        key.includes('31_60') ? 'bg-amber-400' :
                        key.includes('61_90') ? 'bg-orange-500' : 'bg-rose-600'
                      }`}
                      style={{ width: `${(val / (portfolio?.totalDisbursed || 1)) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Daily Summary */}
        <Card className="bg-white border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-50">
            <CardTitle className="text-lg font-black flex items-center gap-2">
              <Calendar className="h-5 w-5 text-indigo-600" /> Daily Transaction Volumes
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-slate-50">
              {daily.length === 0 ? (
                <div className="p-12 text-center text-slate-400 font-medium">No daily records aggregated yet.</div>
              ) : (
                daily.map((d, i) => (
                  <div key={i} className="px-6 py-4 flex justify-between items-center hover:bg-slate-50/50 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="bg-indigo-50 text-indigo-700 h-10 w-10 rounded-lg flex items-center justify-center font-black text-xs">
                        {d.date.split('-')[2]}
                      </div>
                      <div>
                        <p className="font-black text-slate-800">{new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{d.count} Transactions Today</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-black text-slate-900 tracking-tight">Rs. {d.totalAmount.toLocaleString()}</p>
                      <ChevronRight className="h-4 w-4 text-slate-300 ml-auto mt-1" />
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Master Exports Menu */}
        <div className="space-y-6">
          <Card className="bg-slate-900 text-white border-none shadow-xl shadow-slate-200 overflow-hidden relative group">
            <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform duration-500">
              <Landmark className="h-32 w-32" />
            </div>
            <CardContent className="relative pt-10 pb-10 px-8">
              <h3 className="text-2xl font-black tracking-tighter mb-2">Portfolio Export Engine</h3>
              <p className="text-slate-400 font-medium mb-8 text-sm max-w-[300px]">
                Generate full forensic audit reports for regulatory compliance.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Button onClick={() => downloadFile('/reports/export/xlsx', 'portfolio_export.xlsx')} className="bg-emerald-600 hover:bg-emerald-700 text-white font-black gap-2 shadow-lg shadow-emerald-900/20">
                  <FileSpreadsheet className="h-4 w-4" /> Download .XLSX
                </Button>
                <Button onClick={() => downloadFile('/reports/export/pdf', 'portfolio_report.pdf')} className="bg-rose-600 hover:bg-rose-700 text-white font-black gap-2 shadow-lg shadow-rose-900/20">
                  <FileText className="h-4 w-4" /> Download .PDF
                </Button>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-white border-slate-200 p-8 border-l-4 border-l-blue-600">
            <h4 className="font-black text-slate-800 mb-2">Next Execution: End-of-Day</h4>
            <p className="text-sm text-slate-500 font-medium mb-4 leading-relaxed">
              Regulatory compliance requires daily reconciliation of all portfolios. Ensure all branches 
              have completed their EOD workflow before generating consolidated final reports.
            </p>
            <Link href="/operations/eod" className="inline-flex items-center text-blue-600 font-black uppercase text-xs tracking-widest hover:text-blue-700 hover:underline">
              Open EOD Control Panel →
            </Link>
          </Card>
        </div>
      </div>
    </div>
  );
}
