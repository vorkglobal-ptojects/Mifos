const path = require('path');
const pgPath = path.resolve(__dirname, '../frontend/node_modules/pg');
const xlsxPath = path.resolve(__dirname, '../frontend/node_modules/xlsx');
const { Client } = require(pgPath);
const XLSX = require(xlsxPath);
const fs = require('fs');

const connectionString = 'postgresql://postgres.ielkaetihagxgnrrasch:5N62wFUee8fqCRfh@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres';

function stripBranchPrefix(billNo) {
  if (!billNo) return '';
  return billNo.replace(/^(w3|w2|w4|kdw|kht|pnd|dmt|ktw|hq|kir|hmg|brl|kot|dhw|b1|b2|b3|b4|b5|b6|b7|b8|b9|b10|b11|b12|b13|b14|b15)\s*[-/:]?\s*/i, '').trim();
}

function normalizeKey(str) {
  if (!str) return '';
  return str.trim().toLowerCase().replace(/[\s\-_/]+/g, '');
}

function fixDateString(rawDate, fallbackDate = null) {
  let target = rawDate || fallbackDate;
  if (!target) return '';
  if (target instanceof Date) {
    if (isNaN(target.getTime())) return '';
    return target.toISOString().split('T')[0];
  }
  let str = String(target).trim();
  if (str.startsWith('20026-')) {
    str = '2026-' + str.slice(6);
  }
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }
  return str.split('T')[0];
}

function calculateAgeDays(dateStr, todayStr = '2026-10-30') {
  if (!dateStr) return { days: 0, bucket: '0 – 30 Days' };
  const d = new Date(dateStr + 'T00:00:00Z');
  const t = new Date(todayStr + 'T00:00:00Z');
  if (isNaN(d.getTime())) return { days: 0, bucket: '0 – 30 Days' };
  const diffTime = t.getTime() - d.getTime();
  const days = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));

  let bucket = '0 – 30 Days';
  if (days > 365) {
    bucket = '> 365 Days';
  } else if (days > 180) {
    bucket = '181 – 365 Days';
  } else if (days > 90) {
    bucket = '91 – 180 Days';
  } else if (days > 60) {
    bucket = '61 – 90 Days';
  } else if (days > 30) {
    bucket = '31 – 60 Days';
  }

  return { days, bucket };
}

async function main() {
  console.log('Connecting to PostgreSQL database...');
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  console.log('Fetching stock_items, stock_customers, pawns/clients, stock_interests, branches...');
  const stockRes = await client.query('SELECT * FROM public.stock_items ORDER BY branch_id, date DESC, bill_no');
  const custRes = await client.query('SELECT * FROM public.stock_customers ORDER BY created_at DESC');
  const pawnRes = await client.query('SELECT p.bill_no, p.branch_id, c.first_name, c.last_name, c.national_id FROM public.pawns p LEFT JOIN public.clients c ON p.client_id = c.id WHERE p.bill_no IS NOT NULL');
  const interestRes = await client.query('SELECT * FROM public.stock_interests ORDER BY date DESC');
  const branchRes = await client.query('SELECT id, name FROM public.branches ORDER BY id');

  await client.end();
  console.log('Database query complete. Processing data...');

  const stockItems = stockRes.rows;
  const customers = custRes.rows;
  const pawns = pawnRes.rows;
  const interests = interestRes.rows;
  const branches = branchRes.rows;

  console.log(`Loaded: ${stockItems.length} stock items, ${customers.length} stock customers, ${pawns.length} pawn records, ${interests.length} interest payments, ${branches.length} branches.`);

  // 1. Build branch name lookup map
  const branchMap = {};
  branches.forEach(b => {
    branchMap[b.id.toUpperCase()] = b.name;
  });

  // 2. Build interest summary lookup map
  const interestMap = new Map();
  interests.forEach(i => {
    if (i.bill_no) {
      const key = normalizeKey(i.bill_no);
      const val = parseFloat(i.interest_value) || 0;
      if (!interestMap.has(key)) {
        interestMap.set(key, val);
      } else {
        interestMap.set(key, interestMap.get(key) + val);
      }
    }
  });

  // 3. Build customer lookup maps
  const billToCustMap = new Map();
  customers.forEach(c => {
    if (!c.bill_numbers) return;
    const parts = c.bill_numbers.split(',').map(s => s.trim()).filter(Boolean);
    parts.forEach(b => {
      const norm = normalizeKey(b);
      const stripped = normalizeKey(stripBranchPrefix(b));
      const record = { name: c.name, nic: c.nic, hasRecord: true };
      if (!billToCustMap.has(norm)) billToCustMap.set(norm, record);
      if (stripped && !billToCustMap.has(stripped)) billToCustMap.set(stripped, record);
    });
  });

  // Enrich with pawns
  pawns.forEach(p => {
    const raw = p.bill_no;
    const norm = normalizeKey(raw);
    const stripped = normalizeKey(stripBranchPrefix(raw));
    const fullName = ((p.first_name || '') + ' ' + (p.last_name && p.last_name !== '.' ? p.last_name : '')).trim() || 'Valued Customer';
    const record = { name: fullName, nic: p.national_id, hasRecord: true };
    if (!billToCustMap.has(norm)) billToCustMap.set(norm, record);
    if (stripped && !billToCustMap.has(stripped)) billToCustMap.set(stripped, record);
  });

  function findCustomer(stockBill) {
    if (!stockBill) return { name: null, nic: null, hasRecord: false };
    const norm = normalizeKey(stockBill);
    if (billToCustMap.has(norm)) return billToCustMap.get(norm);

    const stripped = normalizeKey(stripBranchPrefix(stockBill));
    if (stripped && billToCustMap.has(stripped)) return billToCustMap.get(stripped);

    // Suffix match
    if (stripped && stripped.length >= 3) {
      for (const [key, cust] of billToCustMap.entries()) {
        if (key.endsWith(stripped) || stripped.endsWith(key)) {
          return cust;
        }
      }
    }
    return { name: null, nic: null, hasRecord: false };
  }

  // 4. Process all items
  const processedItems = stockItems.map(item => {
    const branchId = (item.branch_id || 'UNKNOWN').toUpperCase();
    const branchName = branchMap[branchId] || branchId;
    const cleanDate = fixDateString(item.date, item.created_at);
    const ageInfo = calculateAgeDays(cleanDate, '2026-10-30');
    const cust = findCustomer(item.bill_no);
    const normBill = normalizeKey(item.bill_no);
    const strippedBill = normalizeKey(stripBranchPrefix(item.bill_no));
    const interestPaid = interestMap.get(normBill) || interestMap.get(strippedBill) || 0;

    // Option B: Redacted Text for Customer Name & NIC
    const redactedName = cust.hasRecord ? '████████████' : '(No Customer Record)';
    const redactedNic = cust.hasRecord ? (cust.nic ? '██████████' : '(No NIC On File)') : '(No Customer Record)';
    const recordStatus = cust.hasRecord ? 'Customer Linked (Redacted)' : 'Unlinked Stock';

    return {
      branchId,
      branchName,
      billNo: item.bill_no,
      redactedName,
      redactedNic,
      recordStatus,
      itemType: item.item_type || '-',
      weight: item.weight ? parseFloat(parseFloat(item.weight).toFixed(3)) : 0,
      price: item.price ? parseFloat(parseFloat(item.price).toFixed(2)) : 0,
      date: cleanDate,
      ageDays: ageInfo.days,
      agingBucket: ageInfo.bucket,
      status: item.status || 'Active',
      withdrawalDate: fixDateString(item.withdrawal_date) || '',
      withdrawalReason: item.withdrawal_reason || '',
      interestPaid: parseFloat(interestPaid.toFixed(2))
    };
  });

  // -------------------------------------------------------------------------
  // SHEET 1: AGING SUMMARY MATRIX
  // -------------------------------------------------------------------------
  const bucketKeys = ['0 – 30 Days', '31 – 60 Days', '61 – 90 Days', '91 – 180 Days', '181 – 365 Days', '> 365 Days'];

  // Group by branch
  const branchSummary = {};
  const overallMatrix = {
    active: { count: 0, val: 0, weight: 0 },
    withdrawn: { count: 0, val: 0, weight: 0 },
    buckets: {}
  };
  bucketKeys.forEach(k => {
    overallMatrix.buckets[k] = { count: 0, val: 0 };
  });

  processedItems.forEach(item => {
    const b = item.branchId;
    if (!branchSummary[b]) {
      branchSummary[b] = {
        branchCode: b,
        branchName: item.branchName,
        totalItems: 0,
        activeItems: 0,
        withdrawnItems: 0,
        totalVal: 0,
        activeVal: 0,
        withdrawnVal: 0,
        totalWeight: 0,
        activeWeight: 0,
        withdrawnWeight: 0,
        buckets: {}
      };
      bucketKeys.forEach(k => {
        branchSummary[b].buckets[k] = { count: 0, val: 0 };
      });
    }

    const bs = branchSummary[b];
    bs.totalItems++;
    bs.totalVal += item.price;
    bs.totalWeight += item.weight;

    if (item.status === 'Active') {
      bs.activeItems++;
      bs.activeVal += item.price;
      bs.activeWeight += item.weight;
      if (!bs.buckets[item.agingBucket]) {
        bs.buckets[item.agingBucket] = { count: 0, val: 0 };
      }
      bs.buckets[item.agingBucket].count++;
      bs.buckets[item.agingBucket].val += item.price;

      overallMatrix.active.count++;
      overallMatrix.active.val += item.price;
      overallMatrix.active.weight += item.weight;
      if (!overallMatrix.buckets[item.agingBucket]) {
        overallMatrix.buckets[item.agingBucket] = { count: 0, val: 0 };
      }
      overallMatrix.buckets[item.agingBucket].count++;
      overallMatrix.buckets[item.agingBucket].val += item.price;
    } else {
      bs.withdrawnItems++;
      bs.withdrawnVal += item.price;
      bs.withdrawnWeight += item.weight;

      overallMatrix.withdrawn.count++;
      overallMatrix.withdrawn.val += item.price;
      overallMatrix.withdrawn.weight += item.weight;
    }
  });

  // Build matrix rows for Table 1: Active Stock Aging Matrix
  const matrixRows = [
    {
      'METRIC': 'REPORT TITLE:',
      'BRANCH / BUCKET': 'BRANCH-WISE STOCK AGING & PORTFOLIO ANALYSIS',
      'DETAILS': `Live As Of: 2026-10-30 | Total Stock Items: ${stockItems.length}`
    },
    {},
    {
      'METRIC': 'TABLE 1: ACTIVE VAULT STOCK AGING MATRIX BY BRANCH (COUNT & LKR VALUATION)'
    }
  ];

  const sortedBranchCodes = Object.keys(branchSummary).sort((a, b) => branchSummary[b].totalItems - branchSummary[a].totalItems);

  sortedBranchCodes.forEach(bCode => {
    const b = branchSummary[bCode];
    matrixRows.push({
      'Branch Code': b.branchCode,
      'Branch Name': b.branchName,
      '0–30 Days (Count)': b.buckets['0 – 30 Days'].count,
      '0–30 Days (LKR)': Math.round(b.buckets['0 – 30 Days'].val),
      '31–60 Days (Count)': b.buckets['31 – 60 Days'].count,
      '31–60 Days (LKR)': Math.round(b.buckets['31 – 60 Days'].val),
      '61–90 Days (Count)': b.buckets['61 – 90 Days'].count,
      '61–90 Days (LKR)': Math.round(b.buckets['61 – 90 Days'].val),
      '91–180 Days (Count)': b.buckets['91 – 180 Days'].count,
      '91–180 Days (LKR)': Math.round(b.buckets['91 – 180 Days'].val),
      '181–365 Days (Count)': b.buckets['181 – 365 Days'].count,
      '181–365 Days (LKR)': Math.round(b.buckets['181 – 365 Days'].val),
      '>365 Days (Count)': b.buckets['> 365 Days'].count,
      '>365 Days (LKR)': Math.round(b.buckets['> 365 Days'].val),
      'Total Active Items': b.activeItems,
      'Total Active Valuation (LKR)': Math.round(b.activeVal),
      'Total Active Weight (g)': parseFloat(b.activeWeight.toFixed(3)),
      'Withdrawn Items': b.withdrawnItems,
      'Withdrawn Valuation (LKR)': Math.round(b.withdrawnVal),
      'Total All Items': b.totalItems,
      'Total All Valuation (LKR)': Math.round(b.totalVal)
    });
  });

  // Add Grand Total Row
  matrixRows.push({
    'Branch Code': 'TOTAL',
    'Branch Name': 'ALL BRANCHES (GRAND TOTAL)',
    '0–30 Days (Count)': overallMatrix.buckets['0 – 30 Days'].count,
    '0–30 Days (LKR)': Math.round(overallMatrix.buckets['0 – 30 Days'].val),
    '31–60 Days (Count)': overallMatrix.buckets['31 – 60 Days'].count,
    '31–60 Days (LKR)': Math.round(overallMatrix.buckets['31 – 60 Days'].val),
    '61–90 Days (Count)': overallMatrix.buckets['61 – 90 Days'].count,
    '61–90 Days (LKR)': Math.round(overallMatrix.buckets['61 – 90 Days'].val),
    '91–180 Days (Count)': overallMatrix.buckets['91 – 180 Days'].count,
    '91–180 Days (LKR)': Math.round(overallMatrix.buckets['91 – 180 Days'].val),
    '181–365 Days (Count)': overallMatrix.buckets['181 – 365 Days'].count,
    '181–365 Days (LKR)': Math.round(overallMatrix.buckets['181 – 365 Days'].val),
    '>365 Days (Count)': overallMatrix.buckets['> 365 Days'].count,
    '>365 Days (LKR)': Math.round(overallMatrix.buckets['> 365 Days'].val),
    'Total Active Items': overallMatrix.active.count,
    'Total Active Valuation (LKR)': Math.round(overallMatrix.active.val),
    'Total Active Weight (g)': parseFloat(overallMatrix.active.weight.toFixed(3)),
    'Withdrawn Items': overallMatrix.withdrawn.count,
    'Withdrawn Valuation (LKR)': Math.round(overallMatrix.withdrawn.val),
    'Total All Items': stockItems.length,
    'Total All Valuation (LKR)': Math.round(overallMatrix.active.val + overallMatrix.withdrawn.val)
  });

  // -------------------------------------------------------------------------
  // SHEET 2: CONSOLIDATED MASTER LIST
  // -------------------------------------------------------------------------
  const masterListRows = processedItems.map(item => ({
    'Branch Code': item.branchId,
    'Branch Name': item.branchName,
    'Bill Number': item.billNo,
    'Customer Name (Redacted)': item.redactedName,
    'Customer NIC (Redacted)': item.redactedNic,
    'Customer Link Status': item.recordStatus,
    'Item Type': item.itemType,
    'Gold Weight (g)': item.weight,
    'Principal Valuation (LKR)': item.price,
    'Stock / Issue Date': item.date,
    'Stock Status': item.status,
    'Age as of Today (Days)': item.ageDays,
    'Aging Bucket': item.agingBucket,
    'Withdrawal Date': item.withdrawalDate,
    'Withdrawal Reason': item.withdrawalReason,
    'Interest Paid (LKR)': item.interestPaid
  }));

  // -------------------------------------------------------------------------
  // ASSEMBLE WORKBOOK WITH XLSX
  // -------------------------------------------------------------------------
  const wb = XLSX.utils.book_new();

  // Tab 1: Aging Summary Matrix
  const wsMatrix = XLSX.utils.json_to_sheet(matrixRows, { skipHeader: false });
  wsMatrix['!cols'] = [
    { wch: 14 }, // Branch Code
    { wch: 28 }, // Branch Name
    { wch: 18 }, // 0-30 Days Count
    { wch: 18 }, // 0-30 Days LKR
    { wch: 18 }, // 31-60 Days Count
    { wch: 18 }, // 31-60 Days LKR
    { wch: 18 }, // 61-90 Days Count
    { wch: 18 }, // 61-90 Days LKR
    { wch: 18 }, // 91-180 Days Count
    { wch: 18 }, // 91-180 Days LKR
    { wch: 18 }, // 181-365 Days Count
    { wch: 18 }, // 181-365 Days LKR
    { wch: 18 }, // >365 Days Count
    { wch: 18 }, // >365 Days LKR
    { wch: 18 }, // Total Active Items
    { wch: 26 }, // Total Active Val LKR
    { wch: 22 }, // Total Active Weight
    { wch: 18 }, // Withdrawn Items
    { wch: 26 }, // Withdrawn Val LKR
    { wch: 18 }, // Total All Items
    { wch: 26 }  // Total All Val LKR
  ];
  XLSX.utils.book_append_sheet(wb, wsMatrix, 'Aging Summary Matrix');

  // Tab 2: Consolidated Master List
  const wsMaster = XLSX.utils.json_to_sheet(masterListRows);
  wsMaster['!cols'] = [
    { wch: 14 }, // Branch Code
    { wch: 22 }, // Branch Name
    { wch: 18 }, // Bill Number
    { wch: 24 }, // Customer Name
    { wch: 20 }, // Customer NIC
    { wch: 26 }, // Customer Link Status
    { wch: 12 }, // Item Type
    { wch: 16 }, // Gold Weight (g)
    { wch: 24 }, // Principal Valuation (LKR)
    { wch: 18 }, // Stock / Issue Date
    { wch: 14 }, // Stock Status
    { wch: 22 }, // Age as of Today (Days)
    { wch: 18 }, // Aging Bucket
    { wch: 18 }, // Withdrawal Date
    { wch: 26 }, // Withdrawal Reason
    { wch: 18 }  // Interest Paid (LKR)
  ];
  XLSX.utils.book_append_sheet(wb, wsMaster, 'Consolidated Master List');

  // Tabs 3+: Individual Branch Sheets
  sortedBranchCodes.forEach(bCode => {
    const branchItems = processedItems.filter(i => i.branchId === bCode);
    if (branchItems.length === 0) return;

    const branchRows = branchItems.map(item => ({
      'Branch Code': item.branchId,
      'Branch Name': item.branchName,
      'Bill Number': item.billNo,
      'Customer Name (Redacted)': item.redactedName,
      'Customer NIC (Redacted)': item.redactedNic,
      'Customer Link Status': item.recordStatus,
      'Item Type': item.itemType,
      'Gold Weight (g)': item.weight,
      'Principal Valuation (LKR)': item.price,
      'Stock / Issue Date': item.date,
      'Stock Status': item.status,
      'Age as of Today (Days)': item.ageDays,
      'Aging Bucket': item.agingBucket,
      'Withdrawal Date': item.withdrawalDate,
      'Withdrawal Reason': item.withdrawalReason,
      'Interest Paid (LKR)': item.interestPaid
    }));

    // Add branch total row
    const bTotalVal = branchItems.reduce((acc, i) => acc + i.price, 0);
    const bTotalWeight = branchItems.reduce((acc, i) => acc + i.weight, 0);
    const bTotalInterest = branchItems.reduce((acc, i) => acc + i.interestPaid, 0);

    branchRows.push({
      'Branch Code': 'TOTAL',
      'Branch Name': `${branchItems[0].branchName} Total`,
      'Bill Number': `${branchItems.length} Items`,
      'Customer Name (Redacted)': '-',
      'Customer NIC (Redacted)': '-',
      'Customer Link Status': '-',
      'Item Type': '-',
      'Gold Weight (g)': parseFloat(bTotalWeight.toFixed(3)),
      'Principal Valuation (LKR)': Math.round(bTotalVal),
      'Stock / Issue Date': '-',
      'Stock Status': '-',
      'Age as of Today (Days)': '-',
      'Aging Bucket': '-',
      'Withdrawal Date': '-',
      'Withdrawal Reason': '-',
      'Interest Paid (LKR)': Math.round(bTotalInterest)
    });

    const safeSheetName = `${bCode} (${branchMap[bCode] || bCode})`.slice(0, 31).replace(/[:*?/\\\[\]]/g, '');
    const wsBranch = XLSX.utils.json_to_sheet(branchRows);
    wsBranch['!cols'] = wsMaster['!cols'];
    XLSX.utils.book_append_sheet(wb, wsBranch, safeSheetName);
  });

  // Ensure export directory exists
  const exportDir = path.resolve('exports');
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  const exportPath = path.join(exportDir, 'Branch_Wise_Stock_Aging_Report_2026-10-30.xlsx');
  XLSX.writeFile(wb, exportPath);

  console.log(`Successfully generated workbook: ${exportPath}`);
  console.log(`Total sheets created: ${wb.SheetNames.length}`);
  console.log(`Sheets: ${wb.SheetNames.join(', ')}`);
}

main().catch(err => {
  console.error('Error generating report:', err);
  process.exit(1);
});
