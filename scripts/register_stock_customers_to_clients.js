const { Client } = require(require.resolve('pg', { paths: ['d:/Mifos/frontend'] }));
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres.ielkaetihagxgnrrasch:pLlwUBNfHWUmxGJD@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres';

function normalizeBranchId(branchId) {
  if (!branchId) return 'HQ';
  const clean = branchId.trim().toUpperCase();
  const map = {
    'TEST': 'TEST', 'TESTBRANCH': 'TEST',
    'KAH': 'KHT', 'KHT': 'KHT', 'KAHATHUDUWA': 'KHT',
    'PAN': 'PND', 'PND': 'PND', 'PANADURA': 'PND',
    'DEM': 'DMT', 'DMT': 'DMT', 'DEMATAGODA': 'DMT',
    'BOR': 'BRL', 'BRL': 'BRL', 'BORELLA': 'BRL',
    'KAD': 'KDW', 'KDW': 'KDW', 'KADAWATHA': 'KDW',
    'KTW': 'KTW', 'KOTTAWA': 'KTW',
    'KOT': 'KOT', 'KOTIKAWATTA': 'KOT',
    'HOM': 'HMG', 'HMG': 'HMG', 'HOMAGAMA': 'HMG',
    'KIR': 'KIR', 'KIR1': 'KIR', 'KIR2': 'KIR', 'KIRIBATHGODA': 'KIR',
    'WAT2': 'W2', 'W2': 'W2',
    'WAT3': 'W3', 'W3': 'W3',
    'WAT4': 'W4', 'W4': 'W4',
    'DHW': 'DHW', 'DEHIWALA': 'DHW',
    'HQ': 'HQ'
  };
  return map[clean] || clean;
}

function cleanNationalId(id) {
  if (!id) return null;
  const clean = id.trim().toUpperCase().replace(/[\s\-_/.]/g, '');
  if (/^[0-9]{9}[VX]$/.test(clean) || /^[0-9]{12}$/.test(clean)) return clean;
  if (/^[0-9]{9}$/.test(clean)) return clean + 'V';
  return null;
}

function cleanPhone(raw) {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits || digits.length < 9) return null;
  if (digits === '0000000000' || digits === '000000000' || /^0+$/.test(digits)) return null;
  if (digits.length === 9 && (digits.startsWith('7') || digits.startsWith('1'))) {
    return '0' + digits;
  }
  if (digits.length === 10 && digits.startsWith('0')) {
    return digits;
  }
  if (digits.length === 11 && digits.startsWith('94')) {
    return '0' + digits.substring(2);
  }
  if (digits.length >= 10) {
    return digits.slice(-10);
  }
  return null;
}

function splitName(fullName) {
  const clean = (fullName || 'Customer').trim().replace(/\s+/g, ' ');
  const parts = clean.split(' ');
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '.' };
  }
  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts[parts.length - 1]
  };
}

async function runRegistration() {
  console.log('Connecting to PostgreSQL database...');
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  console.log('Fetching existing clients, stock customers, stock items, and branches...');
  const [clientsRes, custRes, stockRes, branchRes, adminRes] = await Promise.all([
    client.query('SELECT id, national_id, first_name, last_name, phone, address, branch_id FROM public.clients'),
    client.query('SELECT * FROM public.stock_customers ORDER BY created_at ASC'),
    client.query('SELECT bill_no, branch_id FROM public.stock_items'),
    client.query('SELECT id FROM public.branches'),
    client.query('SELECT id FROM public.profiles WHERE role = \'ADMIN\' LIMIT 1')
  ]);

  const existingClients = clientsRes.rows;
  const stockCustomers = custRes.rows;
  const stockItems = stockRes.rows;
  const validBranches = new Set(branchRes.rows.map(b => b.id.toUpperCase()));
  const adminId = adminRes.rows[0]?.id || null;

  console.log(`Initial State: ${existingClients.length} clients in system, ${stockCustomers.length} stock customers.`);

  // Lookup map for stock items (branch-collision safe: track Set of branches per bill)
  const stockBranchesByBill = new Map();
  stockItems.forEach(s => {
    if (s.bill_no && s.branch_id) {
      const norm = s.bill_no.trim().toLowerCase().replace(/[\s\-_/]+/g, '');
      if (!stockBranchesByBill.has(norm)) stockBranchesByBill.set(norm, new Set());
      stockBranchesByBill.get(norm).add(normalizeBranchId(s.branch_id));
    }
  });

  // Track branch-scoped (branch_id, national_id) pairs so multi-branch customers never collide
  const registeredBranchNics = new Set();

  existingClients.forEach(c => {
    if (c.national_id && c.branch_id) {
      const clean = cleanNationalId(c.national_id) || c.national_id.trim().toUpperCase();
      registeredBranchNics.add(`${normalizeBranchId(c.branch_id)}__${clean}`);
    }
  });

  const skipped = [];
  const toInsert = [];

  stockCustomers.forEach((sc) => {
    const genuineNic = cleanNationalId(sc.nic);
    const validPhone = cleanPhone(sc.tp);
    const { firstName, lastName } = splitName(sc.name);

    // Determine branch from stock_customers.branch_id first, then unambiguous stock_items bills
    let branch = sc.branch_id ? normalizeBranchId(sc.branch_id) : null;
    if (!branch || !validBranches.has(branch) || branch === 'HQ') {
      branch = null;
      if (sc.bill_numbers) {
        const parts = sc.bill_numbers.split(',').map(s => s.trim()).filter(Boolean);
        for (const p of parts) {
          const norm = p.toLowerCase().replace(/[\s\-_/]+/g, '');
          const branches = stockBranchesByBill.get(norm);
          if (branches && branches.size === 1) {
            const b = [...branches][0];
            if (validBranches.has(b)) {
              branch = b;
              break;
            }
          }
          const prefix = p.match(/^[a-zA-Z0-9]+/)?.[0];
          if (prefix) {
            const normPref = normalizeBranchId(prefix);
            if (validBranches.has(normPref)) {
              branch = normPref;
              break;
            }
          }
        }
      }
    }
    if (!branch || !validBranches.has(branch)) {
      branch = 'HQ';
    }

    // Check if already registered in THIS branch
    let skipReason = null;
    if (genuineNic && registeredBranchNics.has(`${branch}__${genuineNic}`)) {
      skipReason = `NIC already registered in branch ${branch} (${genuineNic})`;
    }

    if (skipReason) {
      skipped.push({
        id: sc.id,
        name: sc.name,
        branch,
        nic: sc.nic,
        phone: sc.tp,
        reason: skipReason
      });
      return;
    }

    // Assign national_id
    let finalNationalId;
    if (genuineNic) {
      finalNationalId = genuineNic;
    } else {
      const shortCode = sc.id.replace(/-/g, '').slice(0, 8).toUpperCase();
      finalNationalId = `PENDING-${branch}-${shortCode}`;
    }

    // Guard unique (branch_id, national_id) constraint
    let branchKey = `${branch}__${finalNationalId}`;
    if (registeredBranchNics.has(branchKey)) {
      const extraCode = sc.id.replace(/-/g, '').slice(0, 10).toUpperCase();
      finalNationalId = `PENDING-${branch}-${extraCode}`;
      branchKey = `${branch}__${finalNationalId}`;
    }

    let fullAddress = (sc.address || '').trim();
    if (sc.address_2 && sc.address_2.trim() && sc.address_2.trim() !== '0') {
      fullAddress = fullAddress ? `${fullAddress}, ${sc.address_2.trim()}` : sc.address_2.trim();
    }

    const newClient = {
      id: crypto.randomUUID(),
      national_id: finalNationalId,
      first_name: firstName,
      last_name: lastName,
      phone: validPhone,
      address: fullAddress || null,
      branch_id: branch,
      status: 'ACTIVE',
      created_by_user_id: adminId,
      created_at: sc.created_at || new Date().toISOString(),
      nic_image: null,
      signature_image: null
    };

    toInsert.push(newClient);
    registeredBranchNics.add(branchKey);
  });

  console.log(`\nEvaluation Complete:`);
  console.log(`- Already Registered (Skipped): ${skipped.length}`);
  console.log(`- New Clients to Register: ${toInsert.length}`);

  if (toInsert.length === 0) {
    console.log('No new clients to register.');
    await client.end();
    return;
  }

  console.log('\nStarting database insertion transaction (BATCH OF ' + toInsert.length + ')...');
  await client.query('BEGIN');

  try {
    const batchSize = 100;
    for (let i = 0; i < toInsert.length; i += batchSize) {
      const batch = toInsert.slice(i, i + batchSize);
      
      const values = [];
      const valuePlaceholders = [];
      let paramIdx = 1;

      batch.forEach(r => {
        valuePlaceholders.push(`($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3}, $${paramIdx+4}, $${paramIdx+5}, $${paramIdx+6}, $${paramIdx+7}, $${paramIdx+8}, $${paramIdx+9}, $${paramIdx+10})`);
        values.push(
          r.id,
          r.national_id,
          r.first_name,
          r.last_name,
          r.phone,
          r.address,
          r.branch_id,
          r.status,
          r.created_by_user_id,
          r.created_at,
          null // nic_image
        );
        paramIdx += 11;
      });

      const sql = `
        INSERT INTO public.clients (
          id, national_id, first_name, last_name, phone, address, branch_id, status, created_by_user_id, created_at, nic_image
        ) VALUES ${valuePlaceholders.join(', ')}
      `;

      await client.query(sql, values);
      process.stdout.write(`Inserted ${Math.min(i + batchSize, toInsert.length)} / ${toInsert.length} clients...\r`);
    }

    await client.query('COMMIT');
    console.log('\nAll new clients successfully registered and committed to database!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nTransaction failed and was rolled back:', err);
    throw err;
  }

  // Final count verification
  const finalCountRes = await client.query('SELECT count(*) FROM public.clients');
  console.log(`\nVerification: Total clients in database now: ${finalCountRes.rows[0].count}`);

  // Write audit summary report
  const summaryReport = {
    timestamp: new Date().toISOString(),
    previouslyRegistered: existingClients.length,
    stockCustomersProcessed: stockCustomers.length,
    skippedAlreadyRegistered: skipped.length,
    newlyRegisteredCount: toInsert.length,
    totalClientsNow: parseInt(finalCountRes.rows[0].count),
    branchDistribution: {}
  };

  toInsert.forEach(r => {
    summaryReport.branchDistribution[r.branch_id] = (summaryReport.branchDistribution[r.branch_id] || 0) + 1;
  });

  const reportPath = path.join('d:', 'Mifos', 'exports', 'client_registration_audit_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(summaryReport, null, 2), 'utf8');
  console.log(`Audit report written to: ${reportPath}`);

  await client.end();
}

runRegistration().catch(err => {
  console.error('Fatal error during registration:', err);
  process.exit(1);
});
