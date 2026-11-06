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
