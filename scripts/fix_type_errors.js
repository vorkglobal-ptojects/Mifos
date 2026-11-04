const fs = require('fs');
const path = require('path');

function replaceFile(filePath, search, replacement) {
  let content = fs.readFileSync(filePath, 'utf8');
  const isCRLF = content.includes('\r\n');
  const normContent = content.replace(/\r\n/g, '\n');
  const normSearch = search.replace(/\r\n/g, '\n');
  const normReplacement = replacement.replace(/\r\n/g, '\n');
  if (!normContent.includes(normSearch)) {
    console.warn(`[WARN] Search text not found in ${filePath}`);
    return false;
  }
  const result = normContent.replace(normSearch, normReplacement);
  fs.writeFileSync(filePath, isCRLF ? result.replace(/\n/g, '\r\n') : result, 'utf8');
  console.log(`✓ Fixed ${filePath}`);
  return true;
}

// 1. Fix approve route: session.email
const approveFile = path.join(__dirname, '..', 'frontend', 'src', 'app', 'api', 'change-requests', '[id]', 'approve', 'route.ts');
replaceFile(
  approveFile,
  `    await applyApprovedChange(ticket, {
      name: session.user?.name || session.email || 'Manager',
      email: session.user?.email || session.email || 'manager@branch'
    });

    // 3. Mark ticket as APPROVED
    const nowIso = new Date().toISOString();
    const updatedTicket: ChangeRequestTicket = {
      ...ticket,
      status: 'APPROVED',
      reviewed_by_user_id: session.user?.id,
      reviewed_by_name: session.user?.name || session.email || 'Manager',`,
  `    const managerEmail = session.user?.email || session.profile?.email || 'manager@branch';
    const managerName = session.user?.name || session.user?.user_metadata?.name || session.profile?.first_name || managerEmail.split('@')[0] || 'Manager';

    await applyApprovedChange(ticket, {
      name: managerName,
      email: managerEmail
    });

    // 3. Mark ticket as APPROVED
    const nowIso = new Date().toISOString();
    const updatedTicket: ChangeRequestTicket = {
      ...ticket,
      status: 'APPROVED',
      reviewed_by_user_id: session.user?.id,
      reviewed_by_name: managerName,`
);

// 2. Fix reject route: session.email
const rejectFile = path.join(__dirname, '..', 'frontend', 'src', 'app', 'api', 'change-requests', '[id]', 'reject', 'route.ts');
replaceFile(
  rejectFile,
  `    const nowIso = new Date().toISOString();
    const updatedTicket: ChangeRequestTicket = {
      ...ticket,
      status: 'REJECTED',
      reviewed_by_user_id: session.user?.id,
      reviewed_by_name: session.user?.name || session.email || 'Manager',`,
  `    const nowIso = new Date().toISOString();
    const managerEmail = session.user?.email || session.profile?.email || 'manager@branch';
    const managerName = session.user?.name || session.user?.user_metadata?.name || session.profile?.first_name || managerEmail.split('@')[0] || 'Manager';

    const updatedTicket: ChangeRequestTicket = {
      ...ticket,
      status: 'REJECTED',
      reviewed_by_user_id: session.user?.id,
      reviewed_by_name: managerName,`
);

// 3. Fix change-requests route: session.email
const changeReqRouteFile = path.join(__dirname, '..', 'frontend', 'src', 'app', 'api', 'change-requests', 'route.ts');
replaceFile(
  changeReqRouteFile,
  `      requested_by_user_id: session.user?.id,
      requested_by_name: session.user?.name || session.user?.user_metadata?.name || session.email?.split('@')[0] || 'Teller',
      requested_by_email: session.user?.email || session.email || 'teller@branch',`,
  `      requested_by_user_id: session.user?.id,
      requested_by_name: session.user?.name || session.user?.user_metadata?.name || session.profile?.first_name || (session.user?.email || '').split('@')[0] || 'Teller',
      requested_by_email: session.user?.email || session.profile?.email || 'teller@branch',`
);

// 4. Fix ChangeRequestModal.tsx: textarea & e type
const modalFile = path.join(__dirname, '..', 'frontend', 'src', 'components', 'ChangeRequestModal.tsx');
replaceFile(
  modalFile,
  `import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';`,
  `import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';`
);

replaceFile(
  modalFile,
  `            <Textarea
              required
              rows={3}
              placeholder="e.g. Typo in manual scale reading; customer requested weight re-verification; or customer settled cash but bill was recorded under wrong counter."
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="rounded-xl text-xs resize-none"
            />`,
  `            <textarea
              required
              rows={3}
              placeholder="e.g. Typo in manual scale reading; customer requested weight re-verification; or customer settled cash but bill was recorded under wrong counter."
              value={reason}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value)}
              className="w-full rounded-xl border border-slate-200 p-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 resize-none"
            />`
);

// 5. Fix clients/page.tsx: customers -> clients
const clientsPage = path.join(__dirname, '..', 'frontend', 'src', 'app', 'clients', 'page.tsx');
replaceFile(
  clientsPage,
  `  const handleDeleteCustomer = async (id: string) => {
    if (userRole === 'TELLER') {
      const targetCust = customers.find(c => c.id === id);
      setClientDeleteModal({ isOpen: true, client: targetCust || { id } });
      return;
    }`,
  `  const handleDeleteCustomer = async (id: string) => {
    if (userRole === 'TELLER') {
      const targetCust = clients.find((c: any) => c.id === id);
      setClientDeleteModal({ isOpen: true, client: targetCust || { id } });
      return;
    }`
);

// 6. Fix approvals/page.tsx: add handlers and reject modal
const approvalsPage = path.join(__dirname, '..', 'frontend', 'src', 'app', 'operations', 'approvals', 'page.tsx');
let appContent = fs.readFileSync(approvalsPage, 'utf8');
const isCRLF = appContent.includes('\r\n');
let normApp = appContent.replace(/\r\n/g, '\n');

if (!normApp.includes('const handleApproveTicket =')) {
  const handlerTarget = `  // 4. Action 2: Return / Reject for Recheck
  const handleConfirmReturn = async () => {`;

  const handlerReplacement = `  // Maker-Checker Change Request Handlers
  const handleApproveTicket = async (ticket: any) => {
    setIsTicketActionLoading(true);
    const toastId = toast.loading(\`Approving ticket \${ticket.ticket_no}...\`);
    try {
      const res = await fetch(\`/api/change-requests/\${ticket.id}/approve\`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ notes: 'Approved by Branch Manager' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(\`Ticket \${ticket.ticket_no} approved and applied to database!\`, { id: toastId });
      loadDashboardData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to approve ticket', { id: toastId });
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
    const toastId = toast.loading(\`Rejecting ticket \${selectedTicket.ticket_no}...\`);
    try {
      const res = await fetch(\`/api/change-requests/\${selectedTicket.id}/reject\`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ notes: ticketRejectReason.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(\`Ticket \${selectedTicket.ticket_no} marked as REJECTED.\`, { id: toastId });
      setIsRejectTicketModalOpen(false);
      setTicketRejectReason('');
      setSelectedTicket(null);
      loadDashboardData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to reject ticket', { id: toastId });
    } finally {
      setIsTicketActionLoading(false);
    }
  };

  // 4. Action 2: Return / Reject for Recheck
  const handleConfirmReturn = async () => {`;

  normApp = normApp.replace(handlerTarget, handlerReplacement);
  console.log('✓ Added ticket handlers to approvals/page.tsx');
}

// Add Reject Ticket Dialog modal
if (!normApp.includes('isRejectTicketModalOpen')) {
  console.log('Warning: isRejectTicketModalOpen not in approvals');
} else if (!normApp.includes('<Dialog open={isRejectTicketModalOpen}')) {
  const modalTarget = `      {/* ── MODAL: CONFIRM RETURN / RECHECK ── */}`;
  const modalReplacement = `      {/* ── MODAL: REJECT CHANGE REQUEST TICKET (MAKER-CHECKER) ── */}
      <Dialog open={isRejectTicketModalOpen} onOpenChange={setIsRejectTicketModalOpen}>
        <DialogContent className="max-w-md rounded-3xl border-slate-200 p-6 space-y-4">
          <DialogHeader>
            <DialogTitle className="text-lg font-black text-slate-900 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-rose-500" />
              Reject Ticket {selectedTicket?.ticket_no}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Provide an auditor justification explaining why this modification or deletion request was rejected. The live database will remain untouched.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-700">Manager Justification *</label>
            <textarea
              rows={3}
              required
              placeholder="e.g. Loan amount is correct as per signed receipt; weight verified on safe ledger."
              value={ticketRejectReason}
              onChange={(e) => setTicketRejectReason(e.target.value)}
              className="w-full rounded-xl border border-slate-200 p-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 resize-none"
            />
          </div>

          <DialogFooter className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => { setIsRejectTicketModalOpen(false); setTicketRejectReason(''); }}
              className="rounded-xl text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isTicketActionLoading || !ticketRejectReason.trim()}
              onClick={handleRejectTicket}
              className="bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold"
            >
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── MODAL: CONFIRM RETURN / RECHECK ── */}`;

  normApp = normApp.replace(modalTarget, modalReplacement);
  console.log('✓ Added Reject Ticket modal to approvals/page.tsx');
}

fs.writeFileSync(approvalsPage, isCRLF ? normApp.replace(/\n/g, '\r\n') : normApp, 'utf8');
console.log('Finished applying type fixes!');

