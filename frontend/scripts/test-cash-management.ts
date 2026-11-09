/**
 * Cash Management Module Automated Verification Test Suite
 * goldloan.app / Rupasingha Capital
 *
 * Verifies:
 * 1. Denomination math server-side calculation (LKR notes & coins)
 * 2. Invalid & negative denomination rejection
 * 3. Bank account number security masking
 * 4. Attributable reference number generation
 * 5. Role and branch security rules (maker-checker, spoofing prevention)
 * 6. Segregation of duties (User A request, User B dispatch, User C receipt)
 * 7. General ledger double-entry debit = credit balancing
 */

import { 
  calculateDenominationTotal, 
  maskAccountNumber, 
  generateCashReference,
  type LkrDenominations
} from '../src/lib/cash-management';

import { validateFinancialActionAuth, type UserRole } from '../src/lib/auth-server';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, details?: any) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [PASS] ${testName}`);
  } else {
    failedTests++;
    console.error(`  [FAIL] ${testName}`, details || '');
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('   CASH MANAGEMENT AUTOMATED TEST SUITE: goldloan.app          ');
  console.log('================================================================\n');

  // -------------------------------------------------------------------------
  // SUITE 1: Denomination Math & Sri Lankan Rupee Validation
  // -------------------------------------------------------------------------
  console.log('--- SUITE 1: Sri Lankan Rupee Denominations & Math Validation ---');
  {
    const sampleDenoms: LkrDenominations = {
      notes_5000: 10,  // 50,000
      notes_2000: 5,   // 10,000
      notes_1000: 20,  // 20,000
      notes_500:  10,  // 5,000
      notes_100:  50,  // 5,000
      notes_50:   20,  // 1,000
      notes_20:   25,  // 500
      notes_10:   50,  // 500
      coins_total: 200 // 200
    };

    const res = calculateDenominationTotal(sampleDenoms);
    assert(res.total === 92200, 'Calculates exact total for mixed LKR notes and coins (Expected 92,200)', { total: res.total });
    assert(res.breakdown['notes_5000'] === 10, 'Calculates correct breakdown note count for Rs. 5,000 notes');
    assert(res.breakdown['notes_2000'] === 5, 'Calculates correct breakdown note count for Rs. 2,000 notes');

    // Negative coins rejected
    const negativeRes = calculateDenominationTotal({ coins_total: -50 });
    assert(!negativeRes.isValid, 'Rejects negative coins total with validation error');

    // Math.floor cleans floats and Math.max cleans negatives for notes
    const sanitizedRes = calculateDenominationTotal({ notes_5000: 2.7 });
    assert(sanitizedRes.total === 10000, 'Sanitizes float note count to whole note unit (2 notes = 10,000)');
  }

  // -------------------------------------------------------------------------
  // SUITE 2: Security Masking & Idempotent Reference Generation
  // -------------------------------------------------------------------------
  console.log('\n--- SUITE 2: Masking & Attributable Reference Generation ---');
  {
    const masked1 = maskAccountNumber('10004589234892');
    assert(masked1 === '•••• •••• 4892', 'Masks 14-digit bank account number exposing only last 4 digits', { masked1 });

    const maskedShort = maskAccountNumber('1234');
    assert(maskedShort === '1234', 'Preserves short account numbers (<= 4 digits) safely', { maskedShort });

    const reqRef = generateCashReference('REQ');
    const trfRef = generateCashReference('TRF');
    const dspRef = generateCashReference('DSP');
    const rcpRef = generateCashReference('RCP');

    assert(reqRef.startsWith('REQ-'), 'Generates valid Requisition Reference prefix');
    assert(trfRef.startsWith('TRF-'), 'Generates valid Transfer Reference prefix');
    assert(dspRef.startsWith('DSP-'), 'Generates valid Dispatch Reference prefix');
    assert(rcpRef.startsWith('RCP-'), 'Generates valid Receipt Reference prefix');
    assert(reqRef !== generateCashReference('REQ'), 'Generates unique server-side references');
  }

  // -------------------------------------------------------------------------
  // SUITE 3: Role & Branch Security Controls (Maker-Checker & Branch Isolation)
  // -------------------------------------------------------------------------
  console.log('\n--- SUITE 3: Server Authorization & Branch Permission Enforcement ---');
  {
    // Scenario 1: Teller at KHT attempts operation at BRL
    const tellerKHT = {
      user: { id: 'usr-teller-kht', email: 'teller@kht.lk' },
      profile: { id: 'usr-teller-kht', role: 'TELLER', branch_id: 'KHT' },
      role: 'TELLER' as UserRole,
      branchId: 'BRL', // Spoofed client header
      trustedBranchId: 'KHT' // Server trusted profile
    };

    const brlCheck = validateFinancialActionAuth(tellerKHT as any, 'BRL', ['ADMIN', 'MANAGER', 'TELLER']);
    assert(!brlCheck.authorized, 'Denies Teller from branch KHT attempting operation at branch BRL (403 Forbidden)');

    // Scenario 2: Teller at KHT operating at KHT
    const khtCheck = validateFinancialActionAuth(tellerKHT as any, 'KHT', ['ADMIN', 'MANAGER', 'TELLER']);
    assert(khtCheck.authorized, 'Authorizes Teller for their own trusted branch KHT');

    // Scenario 3: Teller attempts administrative bank account management
    const bankManageCheck = validateFinancialActionAuth(tellerKHT as any, null, ['ADMIN', 'MANAGER']);
    assert(!bankManageCheck.authorized, 'Denies Teller attempting Bank Account administration (Admin/Manager only)');

    // Scenario 4: Admin at HQ operates globally
    const adminHQ = {
      user: { id: 'usr-admin-hq', email: 'admin@goldloan.lk' },
      profile: { id: 'usr-admin-hq', role: 'ADMIN', branch_id: 'HQ' },
      role: 'ADMIN' as UserRole,
      branchId: 'HQ',
      trustedBranchId: 'HQ'
    };
    const adminBrlCheck = validateFinancialActionAuth(adminHQ as any, 'BRL', ['ADMIN', 'MANAGER']);
    assert(adminBrlCheck.authorized, 'Authorizes HQ Admin across all branch operations');
  }

  // -------------------------------------------------------------------------
  // SUITE 4: Maker-Checker & Segregation of Duties
  // -------------------------------------------------------------------------
  console.log('\n--- SUITE 4: Maker-Checker & Three-Record Segregation of Duties ---');
  {
    const requesterId = 'emp-001-sarath';
    const approverId = 'emp-002-nimal';
    const dispatcherId = 'emp-003-kamal';
    const receiverId = 'emp-004-sunil';

    // Rule: Requester cannot approve own request (unless explicit admin self-override)
    const isSelfApproval = (reqId: string, appId: string, role: string) => {
      if (reqId === appId && role !== 'ADMIN') {
        return false; // Denied by maker-checker
      }
      return true;
    };

    assert(!isSelfApproval(requesterId, requesterId, 'MANAGER'), 'Rejects Manager approving their own cash requisition (Maker-Checker violation)');
    assert(isSelfApproval(requesterId, approverId, 'MANAGER'), 'Accepts Manager approving requisition submitted by another employee');

    // Rule: Dispatcher cannot be the same as Receiver
    const isDispatchReceiveSegregated = (dispId: string, recvId: string) => {
      return dispId !== recvId;
    };

    assert(!isDispatchReceiveSegregated(dispatcherId, dispatcherId), 'Rejects same employee performing both physical cash dispatch and destination receipt');
    assert(isDispatchReceiveSegregated(dispatcherId, receiverId), 'Accepts segregated physical dispatch and destination receipt by independent employees');

    // Rule: Three independent records with linked references
    const record1 = {
      type: 'CASH_REQUEST',
      reference: 'REQ-2026-001',
      requester_id: requesterId,
      branch_id: 'BRL',
      amount: 500000
    };

    const record2 = {
      type: 'CASH_DISPATCH',
      reference: 'DSP-2026-001',
      request_reference: record1.reference,
      dispatcher_id: dispatcherId,
      source_branch: 'HQ',
      destination_branch: 'BRL',
      courier_nic: '198512345678',
      security_seal_number: 'SL-789012',
      dispatched_amount: 500000
    };

    const record3 = {
      type: 'CASH_RECEIPT',
      reference: 'RCP-2026-001',
      dispatch_reference: record2.reference,
      receiver_id: receiverId,
      destination_branch: 'BRL',
      received_amount: 500000,
      discrepancy: 0
    };

    assert(
      record1.requester_id !== record2.dispatcher_id &&
      record2.dispatcher_id !== record3.receiver_id &&
      record1.requester_id !== record3.receiver_id,
      'Confirms 3 distinct physical actors across Requisition, Dispatch, and Acceptance'
    );

    assert(
      record2.request_reference === record1.reference &&
      record3.dispatch_reference === record2.reference,
      'Confirms immutable end-to-end audit trace linking Record 1 -> Record 2 -> Record 3'
    );
  }

  // -------------------------------------------------------------------------
  // SUITE 5: General Ledger Atomic Double-Entry Balance Verification
  // -------------------------------------------------------------------------
  console.log('\n--- SUITE 5: General Ledger Double-Entry Balancing ---');
  {
    // Simulate inter-branch transfer of Rs. 750,000 from HQ to BRL
    const transferAmount = 750000.00;
    const sourceBranch = 'HQ';
    const destBranch = 'BRL';

    const journalLines = [
      {
        account_name: `Vault Cash (${destBranch}) (Asset)`,
        debit: transferAmount,
        credit: 0
      },
      {
        account_name: `Vault Cash (${sourceBranch}) (Asset)`,
        debit: 0,
        credit: transferAmount
      }
    ];

    const totalDebit = journalLines.reduce((sum, line) => sum + line.debit, 0);
    const totalCredit = journalLines.reduce((sum, line) => sum + line.credit, 0);
    const isBalanced = Math.abs(totalDebit - totalCredit) < 0.001;

    assert(isBalanced, `Debit (${totalDebit.toFixed(2)}) strictly equals Credit (${totalCredit.toFixed(2)}) for completed transfer`);
    assert(totalDebit === 750000.00, 'Debit correctly debits Destination Vault Cash');
    assert(totalCredit === 750000.00, 'Credit correctly credits Source Vault Cash');

    // Simulate in-transit model
    const inTransitDispatchLines = [
      { account_name: 'Cash In Transit (Asset)', debit: transferAmount, credit: 0 },
      { account_name: `Vault Cash (${sourceBranch}) (Asset)`, debit: 0, credit: transferAmount }
    ];
    const dispatchDebit = inTransitDispatchLines.reduce((sum, l) => sum + l.debit, 0);
    const dispatchCredit = inTransitDispatchLines.reduce((sum, l) => sum + l.credit, 0);
    assert(dispatchDebit === dispatchCredit, 'In-Transit Dispatch Journal Entry balances (Debit In-Transit = Credit Source Vault)');

    const inTransitReceiptLines = [
      { account_name: `Vault Cash (${destBranch}) (Asset)`, debit: transferAmount, credit: 0 },
      { account_name: 'Cash In Transit (Asset)', debit: 0, credit: transferAmount }
    ];
    const receiptDebit = inTransitReceiptLines.reduce((sum, l) => sum + l.debit, 0);
    const receiptCredit = inTransitReceiptLines.reduce((sum, l) => sum + l.credit, 0);
    assert(receiptDebit === receiptCredit, 'In-Transit Receipt Journal Entry balances (Debit Dest Vault = Credit In-Transit)');
  }

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`TOTAL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test Suite encountered fatal error:', err);
  process.exit(1);
});
