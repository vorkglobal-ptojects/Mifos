const https = require('https');
const fs = require('fs');
const path = require('path');

const USERS = [
  { name: "Admin", email: "admin@gmail.com", pass: "admin@123", expectedRole: "ADMIN", defaultBranch: "HQ" },
  { name: "Manager", email: "manager@gmail.com", pass: "manager123", expectedRole: "MANAGER", defaultBranch: "HQ" },
  { name: "Auditor", email: "auditor@gmail.com", pass: "auditor123", expectedRole: "AUDITOR", defaultBranch: "HQ" },
  { name: "Manisha Dias", email: "manishadias@gmail.com", pass: "fancyangle79", expectedRole: "TELLER", defaultBranch: "PND" },
  { name: "Imashi Pramodya", email: "kavika2030@gmail.com", pass: "r3al141Voice", expectedRole: "TELLER", defaultBranch: "KHT" },
  { name: "Chamika Sonali", email: "a.v.chamika.sonali@hrpulse.com", pass: "larG3fOot42", expectedRole: "TELLER", defaultBranch: "KTW" },
  { name: "D.M.N.K. Dissanayake", email: "chathudissanayake63@gmail.com", pass: "!nk95humble", expectedRole: "TELLER", defaultBranch: "W4" },
  { name: "Dahami Divyanjali", email: "dahami.divyanjali@hrpulse.com", pass: "9333hugeNos3", expectedRole: "TELLER", defaultBranch: "KOT" },
  { name: "L.A. Sachini Nisha de Silva", email: "sachininirasha462@gmail.com", pass: "tall52Lam6", expectedRole: "TELLER", defaultBranch: "KDW" },
  { name: "Dilini Senarathne", email: "dilinisamudra8210@gmail.com", pass: "1466wit+YmETAl", expectedRole: "TELLER", defaultBranch: "KIR" },
  { name: "Tharushi Sandumini", email: "tharushisandumini1111@gmail.com", pass: "Bell$mart49", expectedRole: "TELLER", defaultBranch: "HMG" },
  { name: "Rasika Priyangani", email: "kdrasikapriyangani80@gmail.com", pass: "SHINY444oc3aN", expectedRole: "TELLER", defaultBranch: "BRL" },
  { name: "Chamilka Botheju", email: "chamilka.botheju@hrpulse.com", pass: "B!g228Musk", expectedRole: "TELLER", defaultBranch: "DMT" },
  { name: "Chandima Perera", email: "chandimaperera501@gmail.com", pass: "25SmallIn)igo", expectedRole: "TELLER", defaultBranch: "W2" },
  { name: "K.A. Chaseera Sulani Perera", email: "chasirasulani@gmail.com", pass: "LoWOWl558", expectedRole: "TELLER", defaultBranch: "W3" },
  { name: "Tharushi Apsara", email: "tharushiaps99@icloud.com", pass: "784JOlLyV!Ew", expectedRole: "TELLER", defaultBranch: "DHW" },
  { name: "Harsha Thamali", email: "harshaha825@gmail.com", pass: "9487$amePaste", expectedRole: "TELLER", defaultBranch: "TEST" },
  { name: "Lakshika Perera", email: "pereralakshi90@gmail.com", pass: "5902StoryV!vid", expectedRole: "TELLER", defaultBranch: "KHT" },
  { name: "K.U. Geethangani Peiris", email: "geethanganipeiri2912@gmail.com", pass: "$wift3360Coal", expectedRole: "TELLER", defaultBranch: "PND" },
  { name: "Erandi Perera", email: "erandiperera25@gmail.com", pass: "8065+hicksnail", expectedRole: "TELLER", defaultBranch: "KTW" },
  { name: "Chathurika Madushani", email: "madushaniperera9617@gmail.com", pass: "07$ubtleSea", expectedRole: "TELLER", defaultBranch: "KDW" },
  { name: "Test User", email: "test@gmail.com", pass: "test123", expectedRole: "TELLER", defaultBranch: "TEST" }
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function request(options, postData) {
  return new Promise((resolve) => {
    const payload = postData ? (typeof postData === 'string' ? postData : JSON.stringify(postData)) : null;
    const reqOptions = { ...options };
    reqOptions.headers = { ...(reqOptions.headers || {}) };
    if (payload) {
      reqOptions.headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (!reqOptions.headers['User-Agent']) {
      reqOptions.headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Mifos-Deep-Audit';
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

async function auditAccount(user) {
  const branch = user.defaultBranch;
  console.log(`\n🔍 AUDITING: ${user.name} (${user.email}) - Branch: ${branch} [Expected: ${user.expectedRole}]`);

  const report = {
    name: user.name,
    email: user.email,
    expectedRole: user.expectedRole,
    branch,
    loginStatus: null,
    actualRole: null,
    tokenReceived: false,
    errors: [],
    warnings: [],
    endpoints: {}
  };

  // 1. Live Login
  const loginRes = await request({
    hostname: 'www.goldloan.app',
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: user.email, password: user.pass, branch: branch, branchId: branch });

  report.loginStatus = loginRes.status;

  if (loginRes.status !== 200 || !loginRes.data?.user) {
    report.errors.push(`Login Failed (HTTP ${loginRes.status}): ${loginRes.data?.error || loginRes.raw}`);
    console.log(`   ❌ Login failed! HTTP ${loginRes.status} (${loginRes.data?.error || 'error'})`);
    return report;
  }

  const token = loginRes.data?.token || '';
  const cookie = parseCookies(loginRes.headers);
  const actualUser = loginRes.data.user;
  report.tokenReceived = !!token;
  report.actualRole = (actualUser.role || 'TELLER').toUpperCase();

  console.log(`   ✅ Logged in successfully as ${report.actualRole}`);

  const authHeaders = {
    'Authorization': `Bearer ${token}`,
    'Cookie': cookie,
    'x-user-role': report.actualRole,
    'x-user-branch': branch,
    'x-branch-id': branch,
    'Content-Type': 'application/json'
  };

  await sleep(200);

  // 2. Test Pawning GET
  const pawnsRes = await request({
    hostname: 'www.goldloan.app',
    path: `/api/pawns?filterBranch=${branch}`,
    method: 'GET',
    headers: authHeaders
  });
  report.endpoints.pawnsGet = pawnsRes.status;
  if (pawnsRes.status === 200) {
    const count = Array.isArray(pawnsRes.data) ? pawnsRes.data.length : 0;
    console.log(`   ✅ Pawning Loans: ${count} loaded (HTTP 200)`);
  } else {
    report.errors.push(`/api/pawns GET failed with HTTP ${pawnsRes.status}`);
    console.log(`   ❌ Pawning Loans: HTTP ${pawnsRes.status}`);
  }

  await sleep(200);

  // 3. Test Stock GET
  const stockRes = await request({
    hostname: 'www.goldloan.app',
    path: `/api/stock?branch=${branch}`,
    method: 'GET',
    headers: authHeaders
  });
  report.endpoints.stockGet = stockRes.status;
  if (stockRes.status === 200) {
    const count = Array.isArray(stockRes.data?.data) ? stockRes.data.data.length : 0;
    console.log(`   ✅ Stock Vault: ${count} items (HTTP 200)`);
  } else {
    report.errors.push(`/api/stock GET failed with HTTP ${stockRes.status}`);
    console.log(`   ❌ Stock Vault: HTTP ${stockRes.status}`);
  }

  await sleep(200);

  // 4. Test Interest GET
  const interestRes = await request({
    hostname: 'www.goldloan.app',
    path: `/api/stock/interest?branch=${branch}`,
    method: 'GET',
    headers: authHeaders
  });
  report.endpoints.interestGet = interestRes.status;
  if (interestRes.status === 200) {
    const count = Array.isArray(interestRes.data?.data) ? interestRes.data.data.length : 0;
    console.log(`   ✅ Interest Records: ${count} records (HTTP 200)`);
  } else {
    report.errors.push(`/api/stock/interest GET failed with HTTP ${interestRes.status}`);
    console.log(`   ❌ Interest Records: HTTP ${interestRes.status}`);
  }

  await sleep(200);

  // 5. Test Daily Ledger GET
  const today = '2026-11-06';
  const ledgerRes = await request({
    hostname: 'www.goldloan.app',
    path: `/api/ledger/daily?branch_id=${branch}&branch=${branch}&date=${today}`,
    method: 'GET',
    headers: authHeaders
  });
  report.endpoints.ledgerGet = ledgerRes.status;
  if (ledgerRes.status === 200) {
    console.log(`   ✅ Daily Ledger (${today}): HTTP 200 (Status: ${ledgerRes.data?.ledger?.status || 'NEW'})`);
  } else {
    report.errors.push(`/api/ledger/daily GET failed with HTTP ${ledgerRes.status}`);
    console.log(`   ❌ Daily Ledger: HTTP ${ledgerRes.status}`);
  }

  await sleep(200);

  // 6. Test Approvals / Change Requests GET
  const crRes = await request({
    hostname: 'www.goldloan.app',
    path: `/api/change-requests?branch=${branch}&status=PENDING`,
    method: 'GET',
    headers: authHeaders
  });
  report.endpoints.changeRequestsGet = crRes.status;
  if (crRes.status === 200) {
    const tickets = Array.isArray(crRes.data?.tickets) ? crRes.data.tickets : [];
    console.log(`   ✅ Change Tickets: ${tickets.length} pending tickets (HTTP 200)`);
  } else {
    if (report.actualRole === 'TELLER' && crRes.status === 403) {
      console.log(`   🔒 Change Requests: 403 Forbidden as expected for Teller`);
    } else {
      report.warnings.push(`/api/change-requests returned HTTP ${crRes.status}`);
      console.log(`   ⚠️ Change Requests: HTTP ${crRes.status}`);
    }
  }

  await sleep(200);

  // 7. Test Teller Stock Withdrawal Authorization (Dry Run check)
  const withdrawRes = await request({
    hostname: 'www.goldloan.app',
    path: '/api/stock',
    method: 'PUT',
    headers: authHeaders
  }, {
    id: '00000000-0000-0000-0000-000000000000',
    action: 'WITHDRAW',
    withdrawal_reason: 'AUDIT_CHECK',
    withdrawal_notes: 'System verification dry run',
    withdrawal_date: today
  });
  report.endpoints.stockWithdrawCheck = withdrawRes.status;
  if (withdrawRes.status === 403) {
    report.errors.push(`CRITICAL BUG: Stock Withdrawal returned HTTP 403 Forbidden for Teller!`);
    console.log(`   ❌ Stock Withdrawal: BLOCKED with 403 Forbidden!`);
  } else {
    console.log(`   ✅ Stock Withdrawal Permission: Open (HTTP ${withdrawRes.status} not 403)`);
  }

  return report;
}

async function runAll() {
  console.log('====================================================================');
  console.log('🚀 RUNNING LIVE DEEP AUDIT OF ALL 22 ACCOUNTS ON WWW.GOLDLOAN.APP');
  console.log('====================================================================\n');

  const allReports = [];

  for (const user of USERS) {
    try {
      const res = await auditAccount(user);
      allReports.push(res);
      await sleep(400);
    } catch (e) {
      allReports.push({
        name: user.name,
        email: user.email,
        expectedRole: user.expectedRole,
        branch: user.defaultBranch,
        error: e.message
      });
    }
  }

  const outPath = path.resolve('scripts/live_all_accounts_audit_report.json');
  fs.writeFileSync(outPath, JSON.stringify(allReports, null, 2));

  console.log('\n====================================================================');
  console.log('📊 LIVE DEEP AUDIT SUMMARY ACROSS ALL 22 ACCOUNTS');
  console.log('====================================================================');

  const failedLogins = allReports.filter(r => r.loginStatus !== 200);
  const totalErrors = allReports.reduce((acc, r) => acc + (r.errors?.length || 0), 0);
  const totalWarnings = allReports.reduce((acc, r) => acc + (r.warnings?.length || 0), 0);

  console.log(`Total Accounts Tested: ${allReports.length}`);
  console.log(`Successful Logins:     ${allReports.length - failedLogins.length} / ${allReports.length}`);
  console.log(`Failed Logins:         ${failedLogins.length}`);
  console.log(`Total Critical Errors: ${totalErrors}`);
  console.log(`Total Warnings:        ${totalWarnings}`);

  if (failedLogins.length > 0) {
    console.log('\n❌ Accounts with Failed Logins:');
    failedLogins.forEach(f => console.log(`   - ${f.name} (${f.email}): ${f.errors?.join(', ') || 'Login failed'}`));
  }

  const accountsWithErrors = allReports.filter(r => r.errors?.length > 0 && r.loginStatus === 200);
  if (accountsWithErrors.length > 0) {
    console.log('\n⚠️ Logged-in Accounts with Operational Errors:');
    accountsWithErrors.forEach(a => {
      console.log(`   - ${a.name} (${a.email}) [Role: ${a.actualRole}, Branch: ${a.branch}]:`);
      a.errors.forEach(err => console.log(`       * ${err}`));
    });
  }

  console.log(`\n📄 Detailed JSON report written to: ${outPath}\n`);
}

runAll().catch(console.error);
