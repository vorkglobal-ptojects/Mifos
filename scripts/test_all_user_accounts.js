const http = require('http');

const USERS = [
  { name: "Manisha Dias", email: "manishadias@gmail.com", pass: "fancyangle79" },
  { name: "Imashi Pramodya", email: "kavika2030@gmail.com", pass: "r3al141Voice" },
  { name: "Chamika Sonali", email: "a.v.chamika.sonali@hrpulse.com", pass: "larG3fOot42" },
  { name: "D.M.N.K. Dissanayake", email: "chathudissanayake63@gmail.com", pass: "!nk95humble" },
  { name: "Dahami Divyanjali", email: "dahami.divyanjali@hrpulse.com", pass: "9333hugeNos3" },
  { name: "L.A. Sachini Nisha de Silva", email: "sachininirasha462@gmail.com", pass: "tall52Lam6" },
  { name: "Dilini Senarathne", email: "dilinisamudra8210@gmail.com", pass: "1466wit+YmETAl" },
  { name: "Tharushi Sandumini", email: "tharushisandumini1111@gmail.com", pass: "Bell$mart49" },
  { name: "Rasika Priyangani", email: "kdrasikapriyangani80@gmail.com", pass: "SHINY444oc3aN" },
  { name: "Chamilka Botheju", email: "chamilka.botheju@hrpulse.com", pass: "B!g228Musk" },
  { name: "Chandima Perera", email: "chandimaperera501@gmail.com", pass: "25SmallIn)igo" },
  { name: "K.A. Chaseera Sulani Perera", email: "chasirasulani@gmail.com", pass: "LoWOWl558" },
  { name: "Tharushi Apsara", email: "tharushiaps99@icloud.com", pass: "784JOlLyV!Ew" },
  { name: "Harsha Thamali", email: "harshaha825@gmail.com", pass: "9487$amePaste" },
  { name: "Lakshika Perera", email: "pereralakshi90@gmail.com", pass: "5902StoryV!vid" },
  { name: "K.U. Geethangani Peiris", email: "geethanganipeiri2912@gmail.com", pass: "$wift3360Coal" },
  { name: "Erandi Perera", email: "erandiperera25@gmail.com", pass: "8065+hicksnail" },
  { name: "Chathurika Madushani", email: "madushaniperera9617@gmail.com", pass: "07$ubtleSea" },
  { name: "Admin", email: "admin@gmail.com", pass: "admin@123" },
  { name: "Auditor", email: "auditor@gmail.com", pass: "auditor123" },
  { name: "Manager", email: "manager@gmail.com", pass: "manager123" },
  { name: "Test", email: "test@gmail.com", pass: "test123" }
];

function request(options, body) {
  return new Promise((resolve) => {
    const postData = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { json = { raw: data }; }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });

    req.on('error', (err) => {
      resolve({ status: 500, error: err.message });
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function loginUser(email, pass, branch) {
  const res = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email, password: pass, branch });
  return res;
}

async function testUserAccount(user, branch) {
  const result = {
    name: user.name,
    email: user.email,
    testedBranch: branch,
    loginSuccess: false,
    role: null,
    branchId: null,
    token: null,
    errors: [],
    checks: {}
  };

  // 1. Attempt Login
  const loginRes = await loginUser(user.email, user.pass, branch);
  if (loginRes.status !== 200 || !loginRes.body?.user) {
    result.errors.push(`Login failed with status ${loginRes.status}: ${loginRes.body?.error || JSON.stringify(loginRes.body)}`);
    return result;
  }

  result.loginSuccess = true;
  result.role = (loginRes.body.user.role || 'TELLER').toUpperCase();
  result.branchId = loginRes.body.user.branchId || loginRes.body.user.branch_id || 'HQ';
  result.token = loginRes.body.token || '';

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${result.token}`,
    'x-user-role': result.role,
    'x-user-branch': result.branchId,
    'Cookie': loginRes.headers['set-cookie'] ? loginRes.headers['set-cookie'].map(c => c.split(';')[0]).join('; ') : ''
  };

  // 2. Test Pawns DELETE lock (should be 403 for TELLER)
  const dummyPawnId = '00000000-0000-0000-0000-000000000001';
  const pawnDelRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/pawns/${dummyPawnId}`,
    method: 'DELETE',
    headers: authHeaders
  });

  if (result.role === 'TELLER') {
    if (pawnDelRes.status === 403) {
      result.checks.pawnDeleteLocked = true;
    } else {
      result.checks.pawnDeleteLocked = false;
      result.errors.push(`SECURITY LEAK: Teller got HTTP ${pawnDelRes.status} instead of 403 Forbidden on pawn DELETE!`);
    }
  } else {
    result.checks.pawnDeleteAllowedForChecker = (pawnDelRes.status === 404 || pawnDelRes.status === 200);
  }

  // 3. Test Stock Item DELETE lock (should be 403 for TELLER)
  const stockDelRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/stock/delete',
    method: 'POST',
    headers: authHeaders
  }, { id: 'dummy-stock-id', bill_no: 'TEST-999', branch_id: branch });

  if (result.role === 'TELLER') {
    if (stockDelRes.status === 403) {
      result.checks.stockDeleteLocked = true;
    } else {
      result.checks.stockDeleteLocked = false;
      result.errors.push(`SECURITY LEAK: Teller got HTTP ${stockDelRes.status} instead of 403 Forbidden on stock DELETE!`);
    }
  }

  // 4. Test Stock Item RESTORE lock (should be 403 for TELLER)
  const stockRestoreRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/stock/restore',
    method: 'POST',
    headers: authHeaders
  }, { id: 'dummy-stock-id', bill_no: 'TEST-999', branch_id: branch, restoreDate: '2026-11-04' });

  if (result.role === 'TELLER') {
    if (stockRestoreRes.status === 403) {
      result.checks.stockRestoreLocked = true;
    } else {
      result.checks.stockRestoreLocked = false;
      result.errors.push(`SECURITY LEAK: Teller got HTTP ${stockRestoreRes.status} instead of 403 Forbidden on stock RESTORE!`);
    }
  }

  // 5. Test Stock Interest DELETE lock (should be 403 for TELLER)
  const interestDelRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/stock/interest?id=999999',
    method: 'DELETE',
    headers: authHeaders
  });

  if (result.role === 'TELLER') {
    if (interestDelRes.status === 403) {
      result.checks.interestDeleteLocked = true;
    } else {
      result.checks.interestDeleteLocked = false;
      result.errors.push(`SECURITY LEAK: Teller got HTTP ${interestDelRes.status} instead of 403 Forbidden on interest DELETE!`);
    }
  }

  // 6. Test Client DELETE lock (should be 403 for TELLER)
  const clientDelRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/clients/00000000-0000-0000-0000-000000000002`,
    method: 'DELETE',
    headers: authHeaders
  });

  if (result.role === 'TELLER') {
    if (clientDelRes.status === 403) {
      result.checks.clientDeleteLocked = true;
    } else {
      result.checks.clientDeleteLocked = false;
      result.errors.push(`SECURITY LEAK: Teller got HTTP ${clientDelRes.status} instead of 403 Forbidden on client DELETE!`);
    }
  }

  // 7. Test Maker-Checker Ticket Submission (POST /api/change-requests)
  const testTicketNo = `CR-TEST-CHK-${Date.now().toString().slice(-4)}`;
  const ticketRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/change-requests',
    method: 'POST',
    headers: authHeaders
  }, {
    entity_type: 'PAWN',
    action_type: 'UPDATE',
    entity_id: '00000000-0000-0000-0000-000000000003',
    reference_no: testTicketNo,
    branch_id: branch,
    reason: `Automated live account verification for ${user.email} on branch ${branch}`,
    current_data: { disbursed_amount: 10000 },
    proposed_data: { disbursed_amount: 12000 }
  });

  if (ticketRes.status === 200 || ticketRes.status === 201) {
    result.checks.ticketSubmission = true;
    const ticketId = ticketRes.body?.ticket?.id;

    // 8. Test Change Ticket Self-Approve lock (TELLER must NOT be able to approve tickets!)
    if (ticketId && result.role === 'TELLER') {
      const approveRes = await request({
        hostname: 'localhost',
        port: 3000,
        path: `/api/change-requests/${ticketId}/approve`,
        method: 'POST',
        headers: authHeaders
      }, { notes: 'Attempted self-approval by teller' });

      if (approveRes.status === 403) {
        result.checks.ticketApproveBlockedForTeller = true;
      } else {
        result.checks.ticketApproveBlockedForTeller = false;
        result.errors.push(`SECURITY LEAK: Teller was allowed to approve change ticket with HTTP ${approveRes.status}!`);
      }
    }
  } else {
    result.checks.ticketSubmission = false;
    result.errors.push(`Ticket creation failed with HTTP ${ticketRes.status}: ${ticketRes.body?.error || JSON.stringify(ticketRes.body)}`);
  }

  // 9. If user is MANAGER or ADMIN, verify they can fetch change tickets
  if (result.role === 'MANAGER' || result.role === 'ADMIN') {
    const listRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: `/api/change-requests?branch=${branch}`,
      method: 'GET',
      headers: authHeaders
    });

    if (listRes.status === 200 && Array.isArray(listRes.body?.tickets)) {
      result.checks.checkerTicketListing = true;
    } else {
      result.checks.checkerTicketListing = false;
      result.errors.push(`Manager/Admin ticket listing failed with HTTP ${listRes.status}: ${listRes.body?.error}`);
    }
  }

  // 10. Test Stock List Access Permission (CRITICAL REQUIREMENT: Tellers cannot retrieve stock list)
  const stockListRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/stock?branch=${branch}`,
    method: 'GET',
    headers: authHeaders
  });

  const stockOldRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/stock/old`,
    method: 'GET',
    headers: authHeaders
  });

  if (result.role === 'TELLER') {
    if (stockListRes.status === 403 && stockOldRes.status === 403) {
      result.checks.stockListBlockedForTeller = true;
    } else {
      result.checks.stockListBlockedForTeller = false;
      result.errors.push(`SECURITY VIOLATION: Teller was allowed to fetch stock list! (stock: ${stockListRes.status}, old: ${stockOldRes.status})`);
    }
  } else {
    // Admin, Manager, Auditor should still be able to fetch stock list
    if (stockListRes.status === 200) {
      result.checks.stockListAllowedForElevatedRole = true;
    } else {
      result.checks.stockListAllowedForElevatedRole = false;
      result.errors.push(`FAILED: ${result.role} could not fetch stock list (HTTP ${stockListRes.status})`);
    }
  }

  return result;
}

async function runAllTests() {
  console.log('================================================================');
  console.log('STARTING FULL AUDIT OF ALL 22 USER ACCOUNTS ACROSS TEST & REAL BRANCHES');
  console.log('================================================================\n');

  const allResults = [];
  const realBranches = ['KHT', 'DHW', 'KTW', 'PND', 'HMG'];

  for (let i = 0; i < USERS.length; i++) {
    const user = USERS[i];
    console.log(`[${i + 1}/${USERS.length}] Auditing User: ${user.name} (${user.email})...`);

    // 1. Audit on TEST branch
    const testBranchResult = await testUserAccount(user, 'TEST');
    allResults.push(testBranchResult);

    // 2. Audit on REAL branch (assigned or KHT)
    const realBranchToTest = testBranchResult.branchId && testBranchResult.branchId !== 'TEST' && testBranchResult.branchId !== 'HQ' 
      ? testBranchResult.branchId 
      : 'KHT';
    const realBranchResult = await testUserAccount(user, realBranchToTest);
    allResults.push(realBranchResult);
  }

  console.log('\n================================================================');
  console.log('AUDIT COMPLETED. PROCESSING RESULTS & ERROR SUMMARY...');
  console.log('================================================================\n');

  const fs = require('fs');
  fs.writeFileSync('scripts/audit_all_users_results.json', JSON.stringify(allResults, null, 2), 'utf8');
  console.log('Detailed results written to scripts/audit_all_users_results.json');

  // Print summary
  let successfulLogins = 0;
  let failedLogins = 0;
  let totalErrors = 0;

  allResults.forEach(r => {
    if (r.loginSuccess) successfulLogins++;
    else failedLogins++;
    totalErrors += r.errors.length;
  });

  console.log(`\nTotal Test Runs: ${allResults.length}`);
  console.log(`Successful Logins: ${successfulLogins}`);
  console.log(`Failed Logins: ${failedLogins}`);
  console.log(`Total Errors/Violations Detected: ${totalErrors}\n`);
}

runAllTests().catch(e => {
  console.error('Fatal execution error:', e);
});

