const fs = require('fs');
const path = require('path');

function replaceNormalize(content, searchStr, replaceStr) {
  const normContent = content.replace(/\r\n/g, '\n');
  const normSearch = searchStr.replace(/\r\n/g, '\n');
  const normReplace = replaceStr.replace(/\r\n/g, '\n');
  if (!normContent.includes(normSearch)) {
    return null;
  }
  const isCRLF = content.includes('\r\n');
  const patched = normContent.replace(normSearch, normReplace);
  return isCRLF ? patched.replace(/\n/g, '\r\n') : patched;
}

// 1. Patch loans/page.tsx
function patchLoans() {
  const file = path.join(__dirname, '..', 'frontend', 'src', 'app', 'loans', 'page.tsx');
  let content = fs.readFileSync(file, 'utf8');

  // Import
  if (!content.includes('ChangeRequestModal')) {
    content = content.replace(
      `import { CustomerSelectionModal } from "@/components/CustomerSelectionModal"`,
      `import { CustomerSelectionModal } from "@/components/CustomerSelectionModal"\nimport ChangeRequestModal from "@/components/ChangeRequestModal"`
    );
  }

  // State
  if (!content.includes('changeRequestTarget')) {
    const targetState = `  // KYC Photo Upload Step (after inline registration)
  const [showKycStep, setShowKycStep]             = useState(false);
  const [newClientId, setNewClientId]             = useState<string>('');`;

    const replaceState = `  // KYC Photo Upload Step (after inline registration)
  const [showKycStep, setShowKycStep]             = useState(false);
  const [newClientId, setNewClientId]             = useState<string>('');

  // Maker-Checker Change Request Modal State
  const [changeRequestTarget, setChangeRequestTarget] = useState<{
    isOpen: boolean;
    actionType: 'UPDATE' | 'DELETE';
    pawn: any;
    proposedData?: Record<string, any>;
  }>({
    isOpen: false,
    actionType: 'DELETE',
    pawn: null,
    proposedData: {}
  });

  const openChangeRequest = (pawn: any, actionType: 'UPDATE' | 'DELETE', proposedData?: Record<string, any>) => {
    setChangeRequestTarget({
      isOpen: true,
      actionType,
      pawn,
      proposedData
    });
  };`;
    content = replaceNormalize(content, targetState, replaceState) || content;
  }

  // HandleSave intercept for Teller edits
  if (!content.includes('openChangeRequest(editingPawn, \'UPDATE\'')) {
    const targetSave = `  const handleSave = async () => {
    if (!clientId || !amount) {
      toast.error('Missing required fields', { description: 'Please select a Customer and enter Disbursed Amount.' });
      return;
    }`;

    const replaceSave = `  const handleSave = async () => {
    if (!clientId || !amount) {
      toast.error('Missing required fields', { description: 'Please select a Customer and enter Disbursed Amount.' });
      return;
    }

    // Intercept Teller edit mutations to route through Change Request system
    if (editingPawn && userRole === 'TELLER') {
      const cleanBill = billNo.trim();
      const finalBillNo = cleanBill ? (billPrefix ? \`\${billPrefix} \${cleanBill}\` : cleanBill) : editingPawn.bill_no;
      openChangeRequest(editingPawn, 'UPDATE', {
        disbursed_amount: amount,
        appraised_value: appraisal,
        weight_grams: weightGrams,
        weight_mg: weightMg,
        description: \`\${finalBillNo} | \${description}\`.trim(),
        period_months: periodMonths
      });
      setIsOpen(false);
      return;
    }`;
    content = replaceNormalize(content, targetSave, replaceSave) || content;
  }

  // Lock Table Approve button from TELLER
  if (content.includes(`pawn.status === 'PENDING_APPROVAL' && (`)) {
    content = replaceNormalize(content, `pawn.status === 'PENDING_APPROVAL' && (`, `pawn.status === 'PENDING_APPROVAL' && userRole !== 'TELLER' && (`) || content;
  }

  // Table action dropdown
  const targetDropdown = `                          <DropdownMenuItem onClick={() => openEdit(pawn)} className="gap-2 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer">
                            <Pencil className="w-3.5 h-3.5 text-slate-500" /> Edit Pawn Record
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="my-1 bg-slate-100" />
                          <DropdownMenuItem onClick={() => handleDelete(pawn)} className="gap-2 px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer">
                            <Trash2 className="w-3.5 h-3.5 text-rose-500" /> Delete Ticket
                          </DropdownMenuItem>`;

  const replaceDropdown = `                          {userRole === 'TELLER' ? (
                            <>
                              <DropdownMenuItem onClick={() => openEdit(pawn)} className="gap-2 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer">
                                <Pencil className="w-3.5 h-3.5 text-amber-500" /> Request Edit Ticket
                              </DropdownMenuItem>
                              <DropdownMenuSeparator className="my-1 bg-slate-100" />
                              <DropdownMenuItem onClick={() => openChangeRequest(pawn, 'DELETE')} className="gap-2 px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer">
                                <Trash2 className="w-3.5 h-3.5 text-rose-500" /> Request Delete Ticket
                              </DropdownMenuItem>
                            </>
                          ) : (
                            <>
                              <DropdownMenuItem onClick={() => openEdit(pawn)} className="gap-2 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer">
                                <Pencil className="w-3.5 h-3.5 text-slate-500" /> Edit Pawn Record
                              </DropdownMenuItem>
                              <DropdownMenuSeparator className="my-1 bg-slate-100" />
                              <DropdownMenuItem onClick={() => handleDelete(pawn)} className="gap-2 px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer">
                                <Trash2 className="w-3.5 h-3.5 text-rose-500" /> Delete Ticket
                              </DropdownMenuItem>
                            </>
                          )}`;

  if (content.includes(targetDropdown)) {
    content = replaceNormalize(content, targetDropdown, replaceDropdown) || content;
  }

  // Modal Save button label
  const targetBtn = `{isSaving ? 'Processing...' : (editingPawn ? 'Update Pawn Ticket' : 'Issue Pawn Ticket')}`;
  const replaceBtn = `{isSaving ? 'Processing...' : (editingPawn ? (userRole === 'TELLER' ? 'Submit Edit Request (Checker Required)' : 'Update Pawn Ticket') : 'Issue Pawn Ticket')}`;
  if (content.includes(targetBtn)) {
    content = replaceNormalize(content, targetBtn, replaceBtn) || content;
  }

  // Render ChangeRequestModal at bottom
  if (!content.includes('entityType="PAWN"')) {
    const targetEnd = `      </DialogContent>
    </Dialog>
  );
}`;
    const replaceEnd = `      </DialogContent>
    </Dialog>

    {/* Maker-Checker Change Request Modal */}
    <ChangeRequestModal
      isOpen={changeRequestTarget.isOpen}
      onClose={() => setChangeRequestTarget(prev => ({ ...prev, isOpen: false }))}
      entityType="PAWN"
      actionType={changeRequestTarget.actionType}
      entityId={changeRequestTarget.pawn?.id || ''}
      referenceNo={changeRequestTarget.pawn?.bill_no || changeRequestTarget.pawn?.pawn_ticket_no || changeRequestTarget.pawn?.id?.substring(0, 8) || 'PAWN'}
      branchId={changeRequestTarget.pawn?.branch_id || branchId || 'HQ'}
      currentData={changeRequestTarget.pawn || {}}
      initialProposedData={changeRequestTarget.proposedData}
      onSubmitted={() => {
        loadPawns();
      }}
    />
  );
}`;
    content = replaceNormalize(content, targetEnd, replaceEnd) || content;
  }

  fs.writeFileSync(file, content, 'utf8');
  console.log('✓ Patched loans/page.tsx');
}

// 2. Patch operations/eod/page.tsx
function patchEod() {
  const file = path.join(__dirname, '..', 'frontend', 'src', 'app', 'operations', 'eod', 'page.tsx');
  let content = fs.readFileSync(file, 'utf8');

  // Import
  if (!content.includes('ChangeRequestModal')) {
    content = content.replace(
      `import { getAuthHeaders } from "@/lib/getAuthHeaders";`,
      `import { getAuthHeaders } from "@/lib/getAuthHeaders";\nimport ChangeRequestModal from "@/components/ChangeRequestModal";`
    );
  }

  // State
  if (!content.includes('stockChangeModal')) {
    const targetState = `  // Restore Modal State
  const [showRestoreModal, setShowRestoreModal] = useState(false);`;

    const replaceState = `  // Maker-Checker Change Request Modal State
  const [stockChangeModal, setStockChangeModal] = useState<{
    isOpen: boolean;
    entityType: 'STOCK' | 'INTEREST';
    actionType: 'UPDATE' | 'DELETE' | 'RESTORE' | 'VOID_INTEREST';
    entityId: string;
    referenceNo: string;
    branchId: string;
    currentData: Record<string, any>;
    initialProposedData?: Record<string, any>;
  }>({
    isOpen: false,
    entityType: 'STOCK',
    actionType: 'DELETE',
    entityId: '',
    referenceNo: '',
    branchId: '',
    currentData: {}
  });

  // Restore Modal State
  const [showRestoreModal, setShowRestoreModal] = useState(false);`;
    content = replaceNormalize(content, targetState, replaceState) || content;
  }

  // Intercept Delete Stock for TELLER
  const targetDelStock = `  const handleDeleteStock = async (item: any) => {
    const cleanDisplayBill = stripBranchPrefix(item.bill_no);`;

  const replaceDelStock = `  const handleDeleteStock = async (item: any) => {
    const cleanDisplayBill = stripBranchPrefix(item.bill_no);
    if (currentUser?.role === 'TELLER') {
      setStockChangeModal({
        isOpen: true,
        entityType: 'STOCK',
        actionType: 'DELETE',
        entityId: item.id || item.item_id || item.bill_no,
        referenceNo: cleanDisplayBill,
        branchId: item.branch_id || selectedBranch || 'HQ',
        currentData: item
      });
      return;
    }`;
  if (!content.includes("currentUser?.role === 'TELLER'") || !content.includes("actionType: 'DELETE'")) {
    content = replaceNormalize(content, targetDelStock, replaceDelStock) || content;
  }

  // Intercept Restore Stock for TELLER
  const targetRestoreStock = `  const handleRestoreStock = async () => {
    if (!selectedItemForRestore) return;`;

  const replaceRestoreStock = `  const handleRestoreStock = async () => {
    if (!selectedItemForRestore) return;
    if (currentUser?.role === 'TELLER') {
      setStockChangeModal({
        isOpen: true,
        entityType: 'STOCK',
        actionType: 'RESTORE',
        entityId: selectedItemForRestore.id || selectedItemForRestore.item_id || selectedItemForRestore.bill_no,
        referenceNo: stripBranchPrefix(selectedItemForRestore.bill_no),
        branchId: selectedItemForRestore.branch_id || selectedBranch || 'HQ',
        currentData: selectedItemForRestore,
        initialProposedData: {
          restore_date: restoreDate,
          interest_amount: restoreInterest,
          notes: restoreNotes
        }
      });
      setShowRestoreModal(false);
      return;
    }`;
  if (!content.includes("actionType: 'RESTORE'")) {
    content = replaceNormalize(content, targetRestoreStock, replaceRestoreStock) || content;
  }

  // Intercept Delete Interest for TELLER
  const targetDelInterest = `  const handleDeleteInterest = async (id: string) => {
    try {`;

  const replaceDelInterest = `  const handleDeleteInterest = async (id: string) => {
    if (currentUser?.role === 'TELLER') {
      setStockChangeModal({
        isOpen: true,
        entityType: 'INTEREST',
        actionType: 'VOID_INTEREST',
        entityId: String(id),
        referenceNo: \`INT-\${id}\`,
        branchId: selectedBranch || 'HQ',
        currentData: { id }
      });
      return;
    }
    try {`;
  if (!content.includes("actionType: 'VOID_INTEREST'")) {
    content = replaceNormalize(content, targetDelInterest, replaceDelInterest) || content;
  }

  // Render ChangeRequestModal before last closing div/tag
  if (!content.includes('entityType={stockChangeModal.entityType}')) {
    const targetModal = `      {/* Active Stock Item Details Modal */}`;
    const replaceModal = `      {/* Maker-Checker Change Request Modal for Teller Actions */}
      <ChangeRequestModal
        isOpen={stockChangeModal.isOpen}
        onClose={() => setStockChangeModal(prev => ({ ...prev, isOpen: false }))}
        entityType={stockChangeModal.entityType}
        actionType={stockChangeModal.actionType}
        entityId={stockChangeModal.entityId}
        referenceNo={stockChangeModal.referenceNo}
        branchId={stockChangeModal.branchId}
        currentData={stockChangeModal.currentData}
        initialProposedData={stockChangeModal.initialProposedData}
        onSubmitted={() => {
          fetchStockItems();
        }}
      />

      {/* Active Stock Item Details Modal */}`;
    content = replaceNormalize(content, targetModal, replaceModal) || content;
  }

  fs.writeFileSync(file, content, 'utf8');
  console.log('✓ Patched operations/eod/page.tsx');
}

// 3. Patch accounting/ledger/entry/page.tsx
function patchLedger() {
  const file = path.join(__dirname, '..', 'frontend', 'src', 'app', 'accounting', 'ledger', 'entry', 'page.tsx');
  let content = fs.readFileSync(file, 'utf8');

  // Import
  if (!content.includes('ChangeRequestModal')) {
    content = content.replace(
      `import { getAuthHeaders } from '@/lib/getAuthHeaders';`,
      `import { getAuthHeaders } from '@/lib/getAuthHeaders';\nimport ChangeRequestModal from '@/components/ChangeRequestModal';`
    );
  }

  // State
  if (!content.includes('ledgerCorrectionModal')) {
    const targetState = `  const [currentUser, setCurrentUser] = useState<any>(null);`;
    const replaceState = `  const [currentUser, setCurrentUser] = useState<any>(null);
  const [hasExistingLedger, setHasExistingLedger] = useState<boolean>(false);
  const [existingLedgerData, setExistingLedgerData] = useState<any>(null);
  const [ledgerCorrectionModal, setLedgerCorrectionModal] = useState<boolean>(false);`;
    content = replaceNormalize(content, targetState, replaceState) || content;
  }

  // Track existing ledger in fetchLedgerData
  const targetFetch = `        if (data.ledger) {
          const l = data.ledger;`;
  const replaceFetch = `        if (data.ledger) {
          const l = data.ledger;
          setHasExistingLedger(true);
          setExistingLedgerData(l);`;
  if (!content.includes('setHasExistingLedger(true)')) {
    content = replaceNormalize(content, targetFetch, replaceFetch) || content;
  }

  const targetReset = `        } else {
          // Reset form for fresh date`;
  const replaceReset = `        } else {
          setHasExistingLedger(false);
          setExistingLedgerData(null);
          // Reset form for fresh date`;
  if (!content.includes('setHasExistingLedger(false)')) {
    content = replaceNormalize(content, targetReset, replaceReset) || content;
  }

  // HandleSave intercept for Teller
  const targetSave = `  // Save Handler
  const handleSaveLedger = async () => {
    setSaving(true);
    setFeedback(null);`;

  const replaceSave = `  // Save Handler
  const handleSaveLedger = async () => {
    // If an existing ledger is already saved and user is TELLER, redirect to Maker-Checker ticket
    if (hasExistingLedger && currentUser?.role === 'TELLER') {
      setLedgerCorrectionModal(true);
      return;
    }
    setSaving(true);
    setFeedback(null);`;

  if (!content.includes('setLedgerCorrectionModal(true)')) {
    content = replaceNormalize(content, targetSave, replaceSave) || content;
  }

  // Button text update
  const targetBtn = `<button
            onClick={handleSaveLedger}
            disabled={saving || loading}
            className="flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition shadow-lg shadow-emerald-600/30 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            Save Daily Ledger
          </button>`;

  const replaceBtn = `<button
            onClick={handleSaveLedger}
            disabled={saving || loading}
            className={\`flex items-center gap-2 px-6 py-3 \${hasExistingLedger && currentUser?.role === 'TELLER' ? 'bg-amber-600 hover:bg-amber-500 shadow-amber-600/30' : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/30'} text-white font-bold rounded-xl transition shadow-lg disabled:opacity-50\`}
          >
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            {hasExistingLedger && currentUser?.role === 'TELLER' ? 'Request Ledger Correction (Manager Approval)' : 'Save Daily Ledger'}
          </button>`;

  if (content.includes(targetBtn)) {
    content = replaceNormalize(content, targetBtn, replaceBtn) || content;
  }

  // Render ChangeRequestModal
  if (!content.includes('actionType="LEDGER_ADJUST"')) {
    const targetEnd = `    </div>
  );
}`;
    const replaceEnd = `      {/* Maker-Checker Ledger Correction Modal */}
      <ChangeRequestModal
        isOpen={ledgerCorrectionModal}
        onClose={() => setLedgerCorrectionModal(false)}
        entityType="DAILY_LEDGER"
        actionType="LEDGER_ADJUST"
        entityId={existingLedgerData?.id || \`\${normalizeBranchId(selectedBranch || 'HQ')}_\${ledgerDate}\`}
        referenceNo={\`\${normalizeBranchId(selectedBranch || 'HQ')} (\${ledgerDate})\`}
        branchId={normalizeBranchId(selectedBranch || 'HQ')}
        currentData={existingLedgerData || {}}
        initialProposedData={{
          closing_balance: userClosingBalance !== '' ? Number(userClosingBalance) : calculatedClosing,
          expenses_total: expensesTotal,
          opening_balance: openingBalance,
          transfer_in: transferIn,
          transfer_out: transferOut,
          loan_issued_total: loanIssuedTotal,
          redemption_total: redemptionTotal,
          interest_rec_total: interestRecTotal
        }}
        onSubmitted={() => {
          fetchLedgerData();
        }}
      />
    </div>
  );
}`;
    content = replaceNormalize(content, targetEnd, replaceEnd) || content;
  }

  fs.writeFileSync(file, content, 'utf8');
  console.log('✓ Patched accounting/ledger/entry/page.tsx');
}

// 4. Patch clients/page.tsx
function patchClients() {
  const file = path.join(__dirname, '..', 'frontend', 'src', 'app', 'clients', 'page.tsx');
  let content = fs.readFileSync(file, 'utf8');

  // Import
  if (!content.includes('ChangeRequestModal')) {
    content = content.replace(
      `import { toast } from "sonner"`,
      `import { toast } from "sonner"\nimport ChangeRequestModal from "@/components/ChangeRequestModal"`
    );
  }

  // State
  if (!content.includes('clientDeleteModal')) {
    const targetState = `  const [editingClient, setEditingClient] = useState<any>(null);`;
    const replaceState = `  const [editingClient, setEditingClient] = useState<any>(null);
  const [clientDeleteModal, setClientDeleteModal] = useState<{
    isOpen: boolean;
    client: any;
  }>({
    isOpen: false,
    client: null
  });`;
    content = replaceNormalize(content, targetState, replaceState) || content;
  }

  // Intercept handleDelete
  const targetDel = `  const handleDelete = async (client: any) => {`;
  const replaceDel = `  const handleDelete = async (client: any) => {
    if (userRole === 'TELLER') {
      setClientDeleteModal({ isOpen: true, client });
      return;
    }`;
  if (!content.includes("setClientDeleteModal({ isOpen: true, client })")) {
    content = replaceNormalize(content, targetDel, replaceDel) || content;
  }

  // Intercept handleDeleteCustomer
  const targetDelCust = `  const handleDeleteCustomer = async (id: string) => {`;
  const replaceDelCust = `  const handleDeleteCustomer = async (id: string) => {
    if (userRole === 'TELLER') {
      const targetCust = customers.find(c => c.id === id);
      setClientDeleteModal({ isOpen: true, client: targetCust || { id } });
      return;
    }`;
  if (!content.includes("const targetCust = customers.find(c => c.id === id)")) {
    content = replaceNormalize(content, targetDelCust, replaceDelCust) || content;
  }

  // Dropdown text
  const targetDrop = `<DropdownMenuItem onClick={() => handleDelete(client)} className="gap-3 px-4 py-3 rounded-xl font-bold text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer">
                          <Trash2 className="w-4 h-4" /> Delete Record
                        </DropdownMenuItem>`;
  const replaceDrop = `<DropdownMenuItem onClick={() => handleDelete(client)} className="gap-3 px-4 py-3 rounded-xl font-bold text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer">
                          <Trash2 className="w-4 h-4" /> {userRole === 'TELLER' ? 'Request Delete (Checker Required)' : 'Delete Record'}
                        </DropdownMenuItem>`;
  if (content.includes(targetDrop)) {
    content = replaceNormalize(content, targetDrop, replaceDrop) || content;
  }

  // Render ChangeRequestModal
  if (!content.includes('entityType="CLIENT"')) {
    const targetEnd = `    </div>
  );
}`;
    const replaceEnd = `      {/* Maker-Checker Client Deletion Modal */}
      <ChangeRequestModal
        isOpen={clientDeleteModal.isOpen}
        onClose={() => setClientDeleteModal(prev => ({ ...prev, isOpen: false }))}
        entityType="CLIENT"
        actionType="DELETE"
        entityId={clientDeleteModal.client?.id || ''}
        referenceNo={clientDeleteModal.client?.national_id || clientDeleteModal.client?.nationalId || clientDeleteModal.client?.id || 'CLIENT'}
        branchId={clientDeleteModal.client?.branch_id || 'HQ'}
        currentData={clientDeleteModal.client || {}}
        onSubmitted={() => {
          loadClients();
        }}
      />
    </div>
  );
}`;
    content = replaceNormalize(content, targetEnd, replaceEnd) || content;
  }

  fs.writeFileSync(file, content, 'utf8');
  console.log('✓ Patched clients/page.tsx');
}

try {
  patchLoans();
  patchEod();
  patchLedger();
  patchClients();
  console.log('All 4 frontend pages successfully patched with ChangeRequestModal!');
} catch (e) {
  console.error('Error patching frontend pages:', e);
  process.exit(1);
}

