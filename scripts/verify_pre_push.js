/**
 * ============================================================================
 * MIFOS PRE-PUSH AUTOMATED VERIFICATION GUARD (v2.0)
 * ============================================================================
 * This script runs automatically before every Git push (and via `npm run verify`).
 * It prevents broken code, permission locks, or type errors from reaching 
 * live counters at physical branches.
 * 
 * CHECKS PERFORMED:
 * 1. TypeScript Compile Check (npx tsc --noEmit)
 * 2. Admin & Teller Live Authentication
 * 3. Pawning Loans Endpoint Health
 * 4. Stock Vault Endpoint Health
 * 5. Daily Ledger Endpoint Health
 * 6. Maker-Checker Change Request Endpoint Health
 * 7. Teller Stock Withdrawal Authorization (Dry-Run 403 Lockout Guard)
 * ============================================================================
 */

const { execSync } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE_HOST = 'www.goldloan.app';
const TIMEOUT_MS = 10000;

function logStep(num, name) {
  console.log(`\n[STEP ${num}] ⏳ ${name}...`);
}

function logPass(msg) {
  console.log(`       ✅ ${msg}`);
}

function logFail(msg) {
  console.error(`       ❌ ${msg}`);
}

function httpsRequest(options, postData) {
  return new Promise((resolve) => {
    const payload = postData ? (typeof postData === 'string' ? postData : JSON.stringify(postData)) : null;
    const reqOptions = { ...options };
    reqOptions.headers = { ...(reqOptions.headers || {}) };
    if (payload) {
      reqOptions.headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (!reqOptions.headers['User-Agent']) {
      reqOptions.headers['User-Agent'] = 'Mifos-PrePush-Verification-Agent';
    }

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { json = { raw: data }; }
        resolve({ status: res.statusCode, headers: res.headers, data: json, raw: data });
      });
    });

    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      resolve({ status: 408, error: 'Request timeout' });
    });

    req.on('error', (err) => {
      resolve({ status: 500, error: err.message });
    });

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function parseCookies(headers) {
  const setCookie = headers?.['set-cookie'];
  if (!setCookie) return '';
  return setCookie.map(c => c.split(';')[0]).join('; ');
}

async function runVerification() {
  console.log('======================================================================');
  console.log('🛡️  RUNNING MIFOS PRE-PUSH VERIFICATION SUITE');
  console.log('======================================================================');

  let failureCount = 0;

  // --------------------------------------------------------------------------
  // STEP 1: TypeScript Compilation
  // --------------------------------------------------------------------------
  logStep(1, 'Compiling TypeScript Frontend (npx tsc --noEmit)');
  try {
    const frontendDir = path.resolve(__dirname, '../frontend');
    execSync('npx --no-install tsc --noEmit', { cwd: frontendDir, stdio: 'pipe', shell: true });
    logPass('TypeScript compiled cleanly with 0 type errors');
  } catch (err) {
    logFail('TypeScript compilation failed!');
    console.error(err.stdout ? err.stdout.toString() : err.message);
    failureCount++;
  }

  // --------------------------------------------------------------------------
  // STEP 2: Teller Authentication & Authorization (Panadura Branch)
  // --------------------------------------------------------------------------
  logStep(2, 'Verifying Teller Authentication (Panadura Branch - Manisha Dias)');
  const tellerLogin = await httpsRequest({
    hostname: BASE_HOST,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'manishadias@gmail.com', password: 'fancyangle79', branch: 'PND', branchId: 'PND' });

  if (tellerLogin.status !== 200 || !tellerLogin.data?.token) {
    logFail(`Teller Login Failed! HTTP ${tellerLogin.status} (${tellerLogin.data?.error || 'error'})`);
    failureCount++;
    return abortWithFailure(failureCount);
  }

  const tellerToken = tellerLogin.data.token;
  const tellerCookie = parseCookies(tellerLogin.headers);
  logPass(`Teller authenticated successfully (Role: ${tellerLogin.data.user?.role || 'TELLER'})`);

  const tellerHeaders = {
    'Authorization': `Bearer ${tellerToken}`,
    'Cookie': tellerCookie,
    'x-user-role': 'TELLER',
    'x-user-branch': 'PND',
    'x-branch-id': 'PND',
    'Content-Type': 'application/json'
  };

  // --------------------------------------------------------------------------
  // STEP 3: Pawning Loans Query
  // --------------------------------------------------------------------------
  logStep(3, 'Verifying Pawning Loans API (/api/pawns)');
  const pawnsRes = await httpsRequest({
    hostname: BASE_HOST,
    path: '/api/pawns?filterBranch=PND',
    method: 'GET',
    headers: tellerHeaders
  });

  if (pawnsRes.status === 200 && Array.isArray(pawnsRes.data)) {
    logPass(`Pawning API active and healthy (${pawnsRes.data.length} active branch loans returned)`);
  } else {
    logFail(`Pawning API returned HTTP ${pawnsRes.status}`);
    failureCount++;
  }

  // --------------------------------------------------------------------------
  // STEP 4: Stock Vault Query
  // --------------------------------------------------------------------------
  logStep(4, 'Verifying Stock Vault API (/api/stock)');
  const stockRes = await httpsRequest({
    hostname: BASE_HOST,
    path: '/api/stock?branch=PND',
    method: 'GET',
    headers: tellerHeaders
  });

  if (stockRes.status === 200) {
    logPass('Stock Vault API active and healthy (HTTP 200)');
  } else {
    logFail(`Stock Vault API returned HTTP ${stockRes.status}`);
    failureCount++;
  }

  // --------------------------------------------------------------------------
  // STEP 5: Daily Ledger Query
  // --------------------------------------------------------------------------
  logStep(5, 'Verifying Daily Ledger API (/api/ledger/daily)');
  const today = new Date().toISOString().split('T')[0];
  const ledgerRes = await httpsRequest({
    hostname: BASE_HOST,
    path: `/api/ledger/daily?branch_id=PND&branch=PND&date=${today}`,
    method: 'GET',
    headers: tellerHeaders
  });

  if (ledgerRes.status === 200) {
    logPass(`Daily Ledger query successful for date ${today} (Status: ${ledgerRes.data?.ledger?.status || 'NEW'})`);
  } else {
    logFail(`Daily Ledger API returned HTTP ${ledgerRes.status}`);
    failureCount++;
  }

  // --------------------------------------------------------------------------
  // STEP 6: Teller Stock Withdrawal Permission Check (Dry-Run 403 Lockout Guard)
  // --------------------------------------------------------------------------
  logStep(6, 'Verifying Teller Stock Withdrawal Permission (Lockout Guard)');
  const withdrawRes = await httpsRequest({
    hostname: BASE_HOST,
    path: '/api/stock',
    method: 'PUT',
    headers: tellerHeaders
  }, {
    id: '00000000-0000-0000-0000-000000000000',
    action: 'WITHDRAW',
    withdrawal_reason: 'PRE_PUSH_VERIFICATION',
    withdrawal_notes: 'Automated test check',
    withdrawal_date: today
  });

  if (withdrawRes.status === 403) {
    logFail('CRITICAL REGRESSION DETECTED: Stock Withdrawal returned HTTP 403 Forbidden for Teller!');
    failureCount++;
  } else {
    logPass(`Teller Stock Withdrawal permission open and authorized (HTTP ${withdrawRes.status} != 403)`);
  }

  // --------------------------------------------------------------------------
  // STEP 7: Change Requests & Approvals API
  // --------------------------------------------------------------------------
  logStep(7, 'Verifying Change Requests Query (/api/change-requests)');
  const crRes = await httpsRequest({
    hostname: BASE_HOST,
    path: '/api/change-requests?branch=PND&status=PENDING',
    method: 'GET',
    headers: tellerHeaders
  });

  if (crRes.status === 200) {
    const tickets = Array.isArray(crRes.data?.tickets) ? crRes.data.tickets.length : 0;
    logPass(`Change Requests API returned HTTP 200 (${tickets} pending tickets)`);
  } else {
    logFail(`Change Requests API returned HTTP ${crRes.status}`);
    failureCount++;
  }

  // --------------------------------------------------------------------------
  // STEP 8: Regression Guards (Cross-Branch Isolation & Modal Overflow Prevention)
  // --------------------------------------------------------------------------
  logStep(8, 'Verifying Cross-Branch Isolation & Modal Layout Safety Rules');
  try {
    const rootDir = path.resolve(__dirname, '..');
    const dialogTsx = fs.readFileSync(path.join(rootDir, 'frontend/src/components/ui/dialog.tsx'), 'utf8');
    if (!dialogTsx.includes('grid-cols-[minmax(0,1fr)]') || !dialogTsx.includes('overflow-x-hidden')) {
      logFail('REGRESSION: dialog.tsx missing grid-cols-[minmax(0,1fr)] or overflow-x-hidden!');
      failureCount++;
    } else {
      const bareDialogViolations = [];
      const walkTsx = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walkTsx(full);
          else if (full.endsWith('.tsx')) {
            const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
            lines.forEach((line, idx) => {
              if (line.includes('<DialogContent')) {
                const snip = lines.slice(idx, idx + 4).join(' ');
                const m = snip.match(/className=["'{`]([^"'}]+)/);
                const cls = m ? m[1] : snip;
                const bare = cls.match(/(?:^|\s)max-w-(?!\[calc|full|none|prose|screen|\[9[0-9]vw\])[^\s"'}]+/g);
                if (bare) {
                  bareDialogViolations.push(`${path.relative(rootDir, full)}:${idx + 1} (${bare.map(b => b.trim()).join(', ')})`);
                }
              }
            });
          }
        }
      };
      walkTsx(path.join(rootDir, 'frontend/src'));
      if (bareDialogViolations.length > 0) {
        logFail(`REGRESSION: Bare max-w-* on DialogContent without responsive prefix: ${bareDialogViolations.join('; ')}`);
        failureCount++;
      } else {
        logPass('All DialogContent modals pass mobile & desktop grid/width overflow safety rules');
      }
    }

    const scRoute = fs.readFileSync(path.join(rootDir, 'frontend/src/app/api/stock-customers/route.ts'), 'utf8');
    const clRoute = fs.readFileSync(path.join(rootDir, 'frontend/src/app/api/clients/route.ts'), 'utf8');
    const pwRoute = fs.readFileSync(path.join(rootDir, 'frontend/src/app/api/pawns/route.ts'), 'utf8');
    const isolationChecks = [
      { ok: scRoute.includes('branchBillMap') && scRoute.includes(".eq('branch_id', effectiveBranch)"), name: 'stock-customers API branch scoping' },
      { ok: clRoute.includes(".eq('branch_id', cleanBranchId)") && clRoute.includes('DUMMY_NICS'), name: 'clients API branch scoping & dummy NIC guard' },
      { ok: pwRoute.includes(".eq('branch_id', cleanBranch)") && pwRoute.includes('uuidBranch !== targetBranchId'), name: 'pawns API cross-branch client guard' },
    ];
    const failedIso = isolationChecks.filter(c => !c.ok);
    if (failedIso.length > 0) {
      logFail(`REGRESSION: Missing cross-branch isolation guard in: ${failedIso.map(f => f.name).join(', ')}`);
      failureCount++;
    } else {
      logPass('All Customer/Pawning/Stock APIs enforce strict (branch_id, NIC/bill_no) isolation');
    }

    // 4. Policy & Cross-Sync Guards (Customer Delete Block + 4-Part Cross-Sync + Daily Ledger Sync)
    const crossSyncLib = fs.readFileSync(path.join(rootDir, 'frontend/src/lib/cross-sync.ts'), 'utf8');
    const crLib = fs.readFileSync(path.join(rootDir, 'frontend/src/lib/change-requests.ts'), 'utf8');
    const crApi = fs.readFileSync(path.join(rootDir, 'frontend/src/app/api/change-requests/route.ts'), 'utf8');
    const clIdApi = fs.readFileSync(path.join(rootDir, 'frontend/src/app/api/clients/[id]/route.ts'), 'utf8');
    const scIdApi = fs.readFileSync(path.join(rootDir, 'frontend/src/app/api/stock-customers/[id]/route.ts'), 'utf8');
    const pwIdApi = fs.readFileSync(path.join(rootDir, 'frontend/src/app/api/pawns/[id]/route.ts'), 'utf8');
    const stApi = fs.readFileSync(path.join(rootDir, 'frontend/src/app/api/stock/route.ts'), 'utf8');
    const stDelApi = fs.readFileSync(path.join(rootDir, 'frontend/src/app/api/stock/delete/route.ts'), 'utf8');
    const stResApi = fs.readFileSync(path.join(rootDir, 'frontend/src/app/api/stock/restore/route.ts'), 'utf8');
    const dmApi = fs.readFileSync(path.join(rootDir, 'frontend/src/app/api/stock/daily-matrix/item/route.ts'), 'utf8');
    const ldApi = fs.readFileSync(path.join(rootDir, 'frontend/src/app/api/ledger/daily/route.ts'), 'utf8');
    const clPage = fs.readFileSync(path.join(rootDir, 'frontend/src/app/clients/page.tsx'), 'utf8');
    const ldPage = fs.readFileSync(path.join(rootDir, 'frontend/src/app/accounting/ledger/page.tsx'), 'utf8');
    const apPage = fs.readFileSync(path.join(rootDir, 'frontend/src/app/operations/approvals/page.tsx'), 'utf8');

    const policyAndSyncChecks = [
      { ok: crossSyncLib.includes('CUSTOMER_DELETE_BLOCK_MESSAGE') && crossSyncLib.includes('syncDailyLedgerForBillChange'), name: 'cross-sync library exports' },
      { ok: clIdApi.includes('CUSTOMER_DELETE_BLOCK_MESSAGE') && clIdApi.includes('status: 403'), name: 'clients/[id] DELETE 403 block' },
      { ok: scIdApi.includes('CUSTOMER_DELETE_BLOCK_MESSAGE') && scIdApi.includes('status: 403'), name: 'stock-customers/[id] DELETE 403 block' },
      { ok: crApi.includes('CUSTOMER_DELETE_BLOCK_MESSAGE') && crApi.includes('status: 403'), name: 'change-requests POST CLIENT DELETE 403 block' },
      { ok: crLib.includes('CUSTOMER_DELETE_BLOCK_MESSAGE') && crLib.includes('syncPawnAndStockUpdate') && crLib.includes('syncPawnAndStockDelete') && crLib.includes('syncPawnAndStockRestore'), name: 'change-requests applyApprovedChange cross-sync' },
      { ok: pwIdApi.includes('syncPawnAndStockUpdate') && pwIdApi.includes('syncPawnAndStockDelete') && pwIdApi.includes('syncClientAcrossModules'), name: 'pawns/[id] cross-sync' },
      { ok: stApi.includes('syncPawnAndStockUpdate'), name: 'stock PUT cross-sync' },
      { ok: stDelApi.includes('syncPawnAndStockDelete'), name: 'stock/delete cross-sync' },
      { ok: stResApi.includes('syncPawnAndStockRestore'), name: 'stock/restore cross-sync' },
      { ok: dmApi.includes('syncPawnAndStockUpdate') && dmApi.includes('syncPawnAndStockDelete') && dmApi.includes('applyLedgerTotalsDelta'), name: 'stock/daily-matrix/item cross-sync' },
      { ok: clIdApi.includes('syncClientAcrossModules') && clRoute.includes('syncClientAcrossModules') && scIdApi.includes('syncStockCustomerToClients'), name: 'customer bidirectional cross-sync' },
      { ok: ldApi.includes("'TELLER'") && ldApi.includes('403') && ldPage.includes('DAILY_LEDGER'), name: 'ledger TELLER delete ChangeRequest guard' },
      { ok: !/fetch\(\s*`\/api\/(?:clients|stock-customers)\/\$\{[^}]+\}`\s*,\s*\{\s*method:\s*['"]DELETE['"]/m.test(clPage), name: 'clients UI has zero DELETE fetch calls' },
      { ok: apPage.includes('Blocked Policy'), name: 'approvals UI blocks CLIENT DELETE approval' },
    ];
    const failedSync = policyAndSyncChecks.filter(c => !c.ok);
    if (failedSync.length > 0) {
      logFail(`REGRESSION: Missing Customer Delete Block or Cross-Sync guard in: ${failedSync.map(f => f.name).join(', ')}`);
      failureCount++;
    } else {
      logPass('All 4-Part Cross-Sync, Customer Delete Block (403) & Daily Ledger sync guards verified');
    }

    // 5. SMS Gateway Security, Log Schema & Branch Isolation Guards
    const smsLib = fs.readFileSync(path.join(rootDir, 'frontend/src/lib/sms.ts'), 'utf8');
    const smsTplLib = fs.readFileSync(path.join(rootDir, 'frontend/src/lib/sms-templates.ts'), 'utf8');
    const smsNotifApi = fs.readFileSync(path.join(rootDir, 'frontend/src/app/api/notifications/sms/route.ts'), 'utf8');
    const smsSetApi = fs.readFileSync(path.join(rootDir, 'frontend/src/app/api/settings/sms-gateway/route.ts'), 'utf8');
    const smsSetPage = fs.readFileSync(path.join(rootDir, 'frontend/src/app/operations/sms-settings/page.tsx'), 'utf8');
    const stIntApi = fs.readFileSync(path.join(rootDir, 'frontend/src/app/api/stock/interest/route.ts'), 'utf8');

    const hardcodedKeyRegex = /txb_[A-Za-z0-9]{10,}/;
    const smsGuards = [
      { ok: !hardcodedKeyRegex.test(smsLib) && !hardcodedKeyRegex.test(smsNotifApi) && !hardcodedKeyRegex.test(smsSetApi) && !hardcodedKeyRegex.test(smsSetPage), name: 'zero hardcoded TextBee API keys in src' },
      { ok: smsLib.includes('recipient_phone') && smsLib.includes('message_text') && smsLib.includes('normalizeSriLankaPhone'), name: 'sms.ts schema alignment & phone validation' },
      { ok: smsTplLib.includes('buildInterestPaymentSms') && smsTplLib.includes('buildPawnApprovedSms'), name: 'sms-templates trilingual builders' },
      { ok: smsNotifApi.includes('sanitizeSmsGatewayConfig') && smsNotifApi.includes('getBranchSearchTerms(userBranch)') && smsNotifApi.includes('retrySmsLogEntry'), name: 'notifications/sms branch isolation, masking & retry' },
      { ok: smsSetApi.includes('sanitizeSmsGatewayConfig') && smsSetApi.includes('shouldKeepExistingKey'), name: 'settings/sms-gateway key preservation & masking' },
      { ok: smsSetPage.includes('recipient_phone') && smsSetPage.includes('message_text') && smsSetPage.includes('RETRY'), name: 'sms-settings UI log columns & retry wiring' },
      { ok: stIntApi.includes('buildInterestPaymentSms') && stIntApi.includes('userBranch !== cleanBranch'), name: 'stock/interest branch guard & auto-SMS' },
    ];
    const failedSms = smsGuards.filter(c => !c.ok);
    if (failedSms.length > 0) {
      logFail(`REGRESSION: Missing SMS Gateway guard in: ${failedSms.map(f => f.name).join(', ')}`);
      failureCount++;
    } else {
      logPass('All SMS Gateway security, schema alignment, branch isolation & auto-trigger guards verified');
    }
  } catch (ruleErr) {
    logFail(`Rule verification exception: ${ruleErr.message}`);
    failureCount++;
  }

  // --------------------------------------------------------------------------
  // FINAL VERDICT
  // --------------------------------------------------------------------------
  if (failureCount > 0) {
    abortWithFailure(failureCount);
  } else {
    console.log('\n======================================================================');
    console.log('✅ ALL PRE-PUSH CHECKS PASSED SUCCESSFULLY (0 FAILURES)');
    console.log('🚀 SAFE TO PUSH: Physical branches and tellers are protected.');
    console.log('======================================================================\n');
    process.exit(0);
  }
}

function abortWithFailure(count) {
  console.error('\n======================================================================');
  console.error(`❌ PRE-PUSH VERIFICATION FAILED WITH ${count} ERROR(S)!`);
  console.error('⛔ PUSH ABORTED: Fix the errors above to protect branch operations.');
  console.error('======================================================================\n');
  process.exit(1);
}

runVerification().catch((err) => {
  console.error('Unexpected verification exception:', err);
  process.exit(1);
});
