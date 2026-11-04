const fs = require('fs');

function patchApprovalsPage() {
  const file = 'frontend/src/app/operations/approvals/page.tsx';
  let code = fs.readFileSync(file, 'utf8');
  const isCRLF = code.includes('\r\n');
  const eol = isCRLF ? '\r\n' : '\n';

  // 1. Update filterTab type & add state
  const oldState = `  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBranch, setSelectedBranch] = useState<string>('ALL');
  const [filterTab, setFilterTab] = useState<'AUDITED' | 'RECHECK' | 'APPROVED' | 'ALL'>('AUDITED');`.replace(/\r?\n/g, eol);

  const newState = `  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBranch, setSelectedBranch] = useState<string>('ALL');
  const [filterTab, setFilterTab] = useState<'AUDITED' | 'RECHECK' | 'APPROVED' | 'ALL' | 'CHANGE_REQUESTS'>('AUDITED');

  // Change Request Tickets State (Maker-Checker)
  const [changeTickets, setChangeTickets] = useState<any[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<any>(null);
  const [isTicketActionLoading, setIsTicketActionLoading] = useState(false);
  const [isRejectTicketModalOpen, setIsRejectTicketModalOpen] = useState(false);
  const [ticketRejectReason, setTicketRejectReason] = useState('');`.replace(/\r?\n/g, eol);

  if (code.includes(oldState)) {
    code = code.replace(oldState, newState);
    console.log('✓ Added change tickets state in approvals/page.tsx');
  }

  // 2. Fetch change tickets in loadDashboardData
  const oldLoadEnd = `        setAuditMap(newMap);
      }
    } catch (e) {`.replace(/\r?\n/g, eol);

  const newLoadEnd = `        setAuditMap(newMap);
      }

      // Fetch change request tickets for Manager/Admin review
      try {
        const ticketParams = new URLSearchParams({
          branch: selectedBranch === 'ALL' ? 'ALL' : selectedBranch
        });
        const tRes = await fetch(\`/api/change-requests?\${ticketParams}\`, { headers: getAuthHeaders() });
        if (tRes.ok) {
          const tJson = await tRes.json();
          setChangeTickets(tJson.tickets || []);
        }
      } catch (tErr) {
        console.warn('Error fetching change tickets:', tErr);
      }
    } catch (e) {`.replace(/\r?\n/g, eol);

  if (code.includes(oldLoadEnd)) {
    code = code.replace(oldLoadEnd, newLoadEnd);
    console.log('✓ Added change tickets fetch in approvals/page.tsx');
  }

  // 3. Add ticket action handlers
  const oldReturnClose = `  const closeReturnModal = () => {
    setIsReturnModalOpen(false);
    setReturnReason('');
  };`.replace(/\r?\n/g, eol);

  const newTicketHandlers = `  const closeReturnModal = () => {
    setIsReturnModalOpen(false);
    setReturnReason('');
  };

  const handleApproveTicket = async (ticket: any) => {
    setIsTicketActionLoading(true);
    try {
      const res = await fetch(\`/api/change-requests/\${ticket.id}/approve\`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ notes: 'Approved by Branch Manager' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(\`Ticket \${ticket.ticket_no} approved and applied to database!\`);
      loadDashboardData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to approve ticket');
    } finally {
      setIsTicketActionLoading(false);
    }
  };

  const handleRejectTicket = async () => {
    if (!ticketRejectReason.trim()) {
      toast.error('Rejection reason is required');
      return;
    }
    if (!selectedTicket) return;
    setIsTicketActionLoading(true);
    try {
      const res = await fetch(\`/api/change-requests/\${selectedTicket.id}/reject\`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ notes: ticketRejectReason.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(\`Ticket \${selectedTicket.ticket_no} marked as REJECTED.\`);
      setIsRejectTicketModalOpen(false);
      setTicketRejectReason('');
      setSelectedTicket(null);
      loadDashboardData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to reject ticket');
    } finally {
      setIsTicketActionLoading(false);
    }
  };`.replace(/\r?\n/g, eol);

  if (code.includes(oldReturnClose)) {
    code = code.replace(oldReturnClose, newTicketHandlers);
    console.log('✓ Added ticket action handlers in approvals/page.tsx');
  }

  // 4. Add Tab button in Filter Tabs
  const oldTabs = `            <button
              onClick={() => setFilterTab('AUDITED')}
              className={\`px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap \${
                filterTab === 'AUDITED'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }\`}
            >
              Audited • Ready for Final Review ({metrics.auditedCount})
            </button>`.replace(/\r?\n/g, eol);

  const newTabs = `            <button
              onClick={() => setFilterTab('CHANGE_REQUESTS')}
              className={\`px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 \${
                filterTab === 'CHANGE_REQUESTS'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }\`}
            >
              <FileText className="w-3.5 h-3.5" /> Change Tickets ({changeTickets.filter(t => t.status === 'PENDING').length})
            </button>
            <button
              onClick={() => setFilterTab('AUDITED')}
              className={\`px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap \${
                filterTab === 'AUDITED'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }\`}
            >
              Audited • Ready for Final Review ({metrics.auditedCount})
            </button>`.replace(/\r?\n/g, eol);

  if (code.includes(oldTabs)) {
    code = code.replace(oldTabs, newTabs);
    console.log('✓ Added Change Tickets tab button in approvals/page.tsx');
  }

  // 5. Render Change Requests Table when filterTab === 'CHANGE_REQUESTS'
  const oldTableStart = `      {/* ── TRANSACTIONS LIST ── */}
      {filteredPawns.length === 0 ? (`.replace(/\r?\n/g, eol);

  const newTableStart = `      {/* ── CHANGE REQUEST TICKETS TABLE (MAKER-CHECKER) ── */}
      {filterTab === 'CHANGE_REQUESTS' ? (
        changeTickets.length === 0 ? (
          <Card className="bg-white border border-slate-200 shadow-sm rounded-3xl py-16 text-center">
            <CardContent className="space-y-3 flex flex-col items-center">
              <div className="w-14 h-14 bg-purple-50 text-purple-600 rounded-full flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <h2 className="text-lg font-black text-slate-900">No Pending Change Request Tickets</h2>
              <p className="text-slate-500 text-xs max-w-md">There are currently no edit or delete requests submitted by Tellers awaiting Manager review for this branch.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
            <Table>
              <TableHeader className="bg-slate-900 text-white">
                <TableRow className="border-b border-slate-800 hover:bg-transparent">
                  <TableHead className="px-6 py-4 font-black text-[10px] uppercase tracking-widest text-purple-300">Ticket No & Date</TableHead>
                  <TableHead className="px-6 py-4 font-black text-[10px] uppercase tracking-widest text-slate-300">Entity & Branch</TableHead>
                  <TableHead className="px-6 py-4 font-black text-[10px] uppercase tracking-widest text-slate-300">Action & Reference</TableHead>
                  <TableHead className="px-6 py-4 font-black text-[10px] uppercase tracking-widest text-slate-300">Reason / Justification</TableHead>
                  <TableHead className="px-6 py-4 font-black text-[10px] uppercase tracking-widest text-slate-300">Proposed Changes (Diff)</TableHead>
                  <TableHead className="px-6 py-4 font-black text-[10px] uppercase tracking-widest text-right text-slate-300">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {changeTickets.map((t: any) => {
                  const isPending = t.status === 'PENDING';
                  const isDelete = t.action_type === 'DELETE' || t.action_type === 'VOID_INTEREST';
                  return (
                    <TableRow key={t.id} className="border-b border-slate-100 hover:bg-slate-50/80 transition-colors">
                      <TableCell className="px-6 py-4">
                        <div className="font-mono text-xs font-bold text-slate-900">{t.ticket_no}</div>
                        <div className="text-[10px] text-slate-400">{t.created_at ? new Date(t.created_at).toLocaleString() : 'N/A'}</div>
                        <Badge variant="outline" className={\`mt-1 text-[9px] font-black uppercase \${
                          t.status === 'PENDING' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                          t.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'
                        }\`}>
                          {t.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <Badge variant="outline" className="text-[10px] font-bold bg-slate-100 text-slate-700 border-slate-200">
                          {t.entity_type}
                        </Badge>
                        <div className="text-xs font-bold text-slate-700 mt-1">Branch: {t.branch_id}</div>
                        <div className="text-[10px] text-slate-500">By: {t.requested_by_name || t.requested_by_email}</div>
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <Badge variant="outline" className={\`text-[10px] font-bold \${
                          isDelete ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-blue-50 text-blue-700 border-blue-200'
                        }\`}>
                          {t.action_type}
                        </Badge>
                        <div className="text-xs font-bold text-slate-900 mt-1">{t.reference_no}</div>
                      </TableCell>
                      <TableCell className="px-6 py-4 max-w-xs">
                        <div className="text-xs text-slate-700 bg-amber-50/70 p-2.5 rounded-xl border border-amber-100/80 italic">
                          "{t.reason}"
                        </div>
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        {isDelete ? (
                          <div className="text-xs font-bold text-rose-600 flex items-center gap-1 bg-rose-50 p-2 rounded-xl border border-rose-200/60">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Permanent Delete Requested
                          </div>
                        ) : (
                          <div className="space-y-1 text-xs">
                            {Object.entries(t.proposed_data || {}).map(([key, val]: any) => {
                              const curr = t.current_data?.[key];
                              return (
                                <div key={key} className="flex items-center gap-1.5 text-[11px]">
                                  <span className="font-semibold text-slate-500 capitalize">{key.replace(/_/g, ' ')}:</span>
                                  {curr !== undefined && <span className="line-through text-slate-400">{String(curr)}</span>}
                                  <span className="text-slate-400">➔</span>
                                  <span className="font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">{String(val)}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="px-6 py-4 text-right">
                        {isPending ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              disabled={isTicketActionLoading}
                              onClick={() => handleApproveTicket(t)}
                              className="h-8 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs cursor-pointer shadow-xs"
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isTicketActionLoading}
                              onClick={() => { setSelectedTicket(t); setIsRejectTicketModalOpen(true); }}
                              className="h-8 px-3 rounded-xl border-rose-200 hover:bg-rose-50 text-rose-700 font-bold text-xs cursor-pointer"
                            >
                              Reject
                            </Button>
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-500">
                            Reviewed by: <strong className="text-slate-800">{t.reviewed_by_name || 'Manager'}</strong>
                            {t.review_notes && <div className="text-[10px] text-slate-400 italic">"{t.review_notes}"</div>}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )
      ) : null}

      {/* ── TRANSACTIONS LIST ── */}
      {filterTab !== 'CHANGE_REQUESTS' && (filteredPawns.length === 0 ? (`.replace(/\r?\n/g, eol);

  if (code.includes(oldTableStart)) {
    code = code.replace(oldTableStart, newTableStart);
    console.log('✓ Added Change Requests Table in approvals/page.tsx');
  }

  // 6. Close the filterTab !== 'CHANGE_REQUESTS' block before Action Dialogs
  const oldTableEnd = `          </Table>
        </div>
      )}

      {/* ── TRANSACTION DOSSIER MODAL ── */}`.replace(/\r?\n/g, eol);

  const newTableEnd = `          </Table>
        </div>
      ))}

      {/* ── REJECT TICKET MODAL ── */}
      <Dialog open={isRejectTicketModalOpen} onOpenChange={setIsRejectTicketModalOpen}>
        <DialogContent className="max-w-md rounded-2xl bg-white p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-black text-slate-900">Reject Change Request Ticket</DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Please enter the reason for rejecting ticket {selectedTicket?.ticket_no}. The live data will remain untouched.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Textarea
              placeholder="e.g. Discrepancy in scale slips; customer must present physical receipt; or request not compliant."
              value={ticketRejectReason}
              onChange={e => setTicketRejectReason(e.target.value)}
              className="text-xs resize-none"
              rows={3}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => setIsRejectTicketModalOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              disabled={isTicketActionLoading || !ticketRejectReason.trim()}
              onClick={handleRejectTicket}
              className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs"
            >
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── TRANSACTION DOSSIER MODAL ── */}`.replace(/\r?\n/g, eol);

  if (code.includes(oldTableEnd)) {
    code = code.replace(oldTableEnd, newTableEnd);
    console.log('✓ Added Reject Ticket Modal in approvals/page.tsx');
  }

  fs.writeFileSync(file, code);
}

patchApprovalsPage();

