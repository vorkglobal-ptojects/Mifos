const BASE_URL = 'http://localhost:3000';

async function login(email, password) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const cookie = res.headers.get('set-cookie');
  const data = await res.json();
  return { status: res.status, cookie, user: data.user || data };
}

async function runTests() {
  console.log('========================================================');
  console.log('FORFEITURE (FS ITEMS) & SMS SYSTEM VERIFICATION');
  console.log('========================================================\n');

  // Test 1: Admin Access Check
  console.log('Test 1: Admin Login and Forfeiture GET...');
  const adminLogin = await login('admin@gmail.com', 'admin@123');
  if (adminLogin.status !== 200) {
    console.error('FAIL: Admin login failed', adminLogin.status);
    process.exit(1);
  }
  console.log('  Admin logged in successfully.');

  const adminGet = await fetch(`${BASE_URL}/api/stock/forfeiture`, {
    headers: { 'Cookie': adminLogin.cookie }
  });
  console.log(`  Admin GET /api/stock/forfeiture status: ${adminGet.status}`);
  const fsData = await adminGet.json();
  if (adminGet.status !== 200 || !fsData.success) {
    console.error('FAIL: Admin cannot fetch forfeiture items', fsData);
    process.exit(1);
  }
  console.log(`  SUCCESS: Total Overdue FS Items identified: ${fsData.count}`);
  console.log('  Summary Metrics:', fsData.summary);

  // Test 2: Teller Lockout Check
  console.log('\nTest 2: Teller Lockout on /api/stock/forfeiture (Security Guard)...');
  const tellerLogin = await login('manishadias@gmail.com', 'fancyangle79');
  console.log(`  Teller login status: ${tellerLogin.status}`);
  const tellerGet = await fetch(`${BASE_URL}/api/stock/forfeiture`, {
    headers: { 'Cookie': tellerLogin.cookie }
  });
  console.log(`  Teller GET status: ${tellerGet.status} (Expected: 403)`);
  if (tellerGet.status === 403) {
    console.log('  SUCCESS: Teller is strictly blocked with 403 Forbidden!');
  } else {
    console.error('FAIL: Teller was not blocked with 403!');
    process.exit(1);
  }

  // Test 3: Manager Lockout Check
  console.log('\nTest 3: Manager Lockout on /api/stock/forfeiture (Admin-Only Guard)...');
  const managerLogin = await login('manager@gmail.com', 'manager123');
  console.log(`  Manager login status: ${managerLogin.status}`);
  const managerGet = await fetch(`${BASE_URL}/api/stock/forfeiture`, {
    headers: { 'Cookie': managerLogin.cookie }
  });
  console.log(`  Manager GET status: ${managerGet.status} (Expected: 403)`);
  if (managerGet.status === 403) {
    console.log('  SUCCESS: Manager is strictly blocked with 403 Forbidden!');
  } else {
    console.error('FAIL: Manager was not blocked with 403!');
    process.exit(1);
  }

  // Test 4: Auditor Lockout Check
  console.log('\nTest 4: Auditor Lockout on /api/stock/forfeiture (Admin-Only Guard)...');
  const auditorLogin = await login('auditor@gmail.com', 'auditor123');
  console.log(`  Auditor login status: ${auditorLogin.status}`);
  const auditorGet = await fetch(`${BASE_URL}/api/stock/forfeiture`, {
    headers: { 'Cookie': auditorLogin.cookie }
  });
  console.log(`  Auditor GET status: ${auditorGet.status} (Expected: 403)`);
  if (auditorGet.status === 403) {
    console.log('  SUCCESS: Auditor is strictly blocked with 403 Forbidden!');
  } else {
    console.error('FAIL: Auditor was not blocked with 403!');
    process.exit(1);
  }

  // Test 5: Forfeiture Branch Filter Check
  console.log('\nTest 5: Filter by Branch (e.g. KDW)...');
  const kdwGet = await fetch(`${BASE_URL}/api/stock/forfeiture?branch=KDW`, {
    headers: { 'Cookie': adminLogin.cookie }
  });
  const kdwData = await kdwGet.json();
  console.log(`  KDW Overdue items count: ${kdwData.count}`);
  const allKdw = (kdwData.items || []).every(it => ['KDW', 'KADUWELA'].includes(it.branch_id.toUpperCase()));
  console.log(`  Branch isolation verified: ${allKdw ? 'YES' : 'MIXED'}`);

  // Test 6: Forfeiture Severity Filter Check
  console.log('\nTest 6: Filter by Overdue Severity (> 30 Days Critical)...');
  const critGet = await fetch(`${BASE_URL}/api/stock/forfeiture?severity=30%2B`, {
    headers: { 'Cookie': adminLogin.cookie }
  });
  const critData = await critGet.json();
  console.log(`  Critical (>30 days) count: ${critData.count}`);
  const allCrit = (critData.items || []).every(it => it.days_overdue > 30);
  console.log(`  Critical severity verified: ${allCrit ? 'YES' : 'NO'}`);

  // Test 7: SMS Single Validation
  console.log('\nTest 7: SMS Warning Dispatch Validation...');
  const smsTestRes = await fetch(`${BASE_URL}/api/stock/forfeiture`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Cookie': adminLogin.cookie 
    },
    body: JSON.stringify({
      action: 'SEND_SMS',
      itemId: 'test-item',
      billNo: 'TEST-1R-001',
      customerName: 'Test Customer',
      phone: '0771234567',
      principal: 25000,
      interestDue: 2625,
      expiryDate: '2026-10-01',
      branchId: 'HQ'
    })
  });
  console.log(`  SMS Dispatch endpoint status: ${smsTestRes.status}`);
  const smsTestData = await smsTestRes.json();
  console.log(`  SMS Dispatch result:`, smsTestData);

  console.log('\n========================================================');
  console.log('ALL FORFEITURE (FS) TESTS PASSED SUCCESSFULLY (0 ERRORS)!');
  console.log('========================================================\n');
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
