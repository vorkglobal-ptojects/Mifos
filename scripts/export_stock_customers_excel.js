const { Client } = require(require.resolve('pg', { paths: ['d:/Mifos/frontend'] }));
const XLSX = require(require.resolve('xlsx', { paths: ['d:/Mifos/frontend'] }));
const fs = require('fs');
const path = require('path');

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres.ielkaetihagxgnrrasch:pLlwUBNfHWUmxGJD@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres';

function stripBranchPrefix(billNo) {
  if (!billNo) return '';
  return billNo.replace(/^(w3|kdw|kht|pnd|dmt|ktw|hq|kir|b1|b2|b3|b4|b5|b6|b7|b8|b9|b10|b11|b12|b13|b14|b15)\s*[-/:]?\s*/i, '').trim();
}

function normalizeKey(str) {
  if (!str) return '';
  return str.trim().toLowerCase().replace(/[\s\-_/]+/g, '');
}

async function exportStockCustomersExcel() {
  console.log('Connecting to PostgreSQL database...');
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  console.log('Fetching stock_customers, stock_items, stock_interests, branches...');
  const [custRes, stockRes, interestRes, branchRes] = await Promise.all([
    client.query('SELECT * FROM public.stock_customers ORDER BY created_at DESC'),
    client.query('SELECT * FROM public.stock_items ORDER BY branch_id, bill_no'),
    client.query('SELECT * FROM public.stock_interests ORDER BY date DESC'),
    client.query('SELECT id, name FROM public.branches')
  ]);

  await client.end();

  const customers = custRes.rows;
  const stockItems = stockRes.rows;
  const interests = interestRes.rows;
  const branches = branchRes.rows;

  console.log(`Loaded: ${customers.length} customers, ${stockItems.length} stock items, ${interests.length} interest payments, ${branches.length} branches.`);

  // Build branch map
  const branchMap = {};
  branches.forEach(b => {
    branchMap[b.id.toUpperCase()] = b.name;
  });

  // Build branch-aware stock items lookup maps
  const stockByBranchAndBill = new Map();
  const stockByNormMap = new Map();

  stockItems.forEach(item => {
    if (item.bill_no) {
      const itemBranch = (item.branch_id || '').trim().toUpperCase();
      const normKey = normalizeKey(item.bill_no);
      const stripped = normalizeKey(stripBranchPrefix(item.bill_no));
      if (itemBranch && normKey) {
        stockByBranchAndBill.set(`${itemBranch}::${normKey}`, item);
      }
      if (itemBranch && stripped && stripped.length >= 3) {
        stockByBranchAndBill.set(`${itemBranch}::${stripped}`, item);
      }
      if (normKey) {
        if (!stockByNormMap.has(normKey)) stockByNormMap.set(normKey, []);
        stockByNormMap.get(normKey).push(item);
      }
    }
  });

  // Build interest map by branch+bill_no and fallback bill_no
  const interestMap = new Map();
  interests.forEach(i => {
    if (i.bill_no) {
      const key = normalizeKey(i.bill_no);
      const brKey = i.branch_id ? `${i.branch_id.trim().toUpperCase()}::${key}` : null;
      const val = parseFloat(i.interest_value) || 0;
      for (const k of [brKey, key].filter(Boolean)) {
        if (!interestMap.has(k)) {
          interestMap.set(k, { total: val, count: 1, lastPaymentDate: i.date, notes: i.notes || '' });
        } else {
          const curr = interestMap.get(k);
          curr.total += val;
          curr.count += 1;
        }
      }
    }
  });

  function findStockItemForBill(billNo, customerBranchId) {
    if (!billNo) return null;
    const normKey = normalizeKey(billNo);
    const stripped = normalizeKey(stripBranchPrefix(billNo));
    const prefBr = (customerBranchId || '').trim().toUpperCase();

    if (prefBr) {
      if (stockByBranchAndBill.has(`${prefBr}::${normKey}`)) return stockByBranchAndBill.get(`${prefBr}::${normKey}`);
      if (stripped && stockByBranchAndBill.has(`${prefBr}::${stripped}`)) return stockByBranchAndBill.get(`${prefBr}::${stripped}`);
    }

    const candidates = stockByNormMap.get(normKey) || [];
    if (candidates.length === 1) return candidates[0];
    return null;
  }

  // ----------------------------------------------------
  // SHEET 1: Bill-Wise Customer Details (One row per bill)
  // ----------------------------------------------------
  const billWiseRows = [];
  const processedBills = new Set();

  customers.forEach(cust => {
    const rawBills = cust.bill_numbers ? cust.bill_numbers.split(',').map(s => s.trim()).filter(Boolean) : [];
    
    if (rawBills.length === 0) {
      // Customer without bill number
      billWiseRows.push({
        'Bill Number': '(No Bill Specified)',
        'Branch Code': '-',
        'Branch Name': '-',
        'Customer Name': cust.name || '',
        'Telephone (TP)': cust.tp || '',
        'NIC Number': cust.nic || '',
        'Address Line 1': cust.address || '',
        'Address Line 2': cust.address_2 || '',
        'Stock Item Type': '-',
        'Gold Weight (g)': '',
        'Principal Amount (LKR)': '',
        'Stock Status': '-',
        'Issue Date': '',
        'Interest Paid (LKR)': '',
        'Customer Registered': cust.created_at ? new Date(cust.created_at).toISOString().split('T')[0] : ''
      });
      return;
    }

    rawBills.forEach(billNo => {
      processedBills.add(normalizeKey(billNo));
      const stock = findStockItemForBill(billNo, cust.branch_id);
      const branchId = cust.branch_id ? cust.branch_id.trim().toUpperCase() : (stock?.branch_id || (billNo.match(/^[a-zA-Z]+/)?.[0] || '-').toUpperCase());
      const branchName = branchMap[branchId] || branchId;

      const normBill = normalizeKey(billNo);
      const interestInfo = interestMap.get(`${branchId}::${normBill}`) || interestMap.get(normBill);

      billWiseRows.push({
        'Bill Number': billNo,
        'Branch Code': branchId,
        'Branch Name': branchName,
        'Customer Name': cust.name || '',
        'Telephone (TP)': cust.tp || '',
        'NIC Number': cust.nic || '',
        'Address Line 1': cust.address || '',
        'Address Line 2': cust.address_2 || '',
        'Stock Item Type': stock?.item_type || '-',
        'Gold Weight (g)': stock?.weight ? parseFloat(stock.weight) : '',
        'Principal Amount (LKR)': stock?.price ? parseFloat(stock.price) : '',
        'Stock Status': stock?.status || (stock ? 'Unknown' : 'Unmatched Stock'),
        'Issue Date': stock?.date ? new Date(stock.date).toISOString().split('T')[0] : '',
        'Interest Paid (LKR)': interestInfo ? interestInfo.total : 0,
        'Customer Registered': cust.created_at ? new Date(cust.created_at).toISOString().split('T')[0] : ''
      });
    });
  });

  // Sort by Bill Number
  billWiseRows.sort((a, b) => a['Bill Number'].localeCompare(b['Bill Number']));

  // ----------------------------------------------------
  // SHEET 2: Customer Master Directory (1,526 customers)
  // ----------------------------------------------------
  const customerMasterRows = customers.map(cust => {
    const rawBills = cust.bill_numbers ? cust.bill_numbers.split(',').map(s => s.trim()).filter(Boolean) : [];
    
    // Find branches associated
    const branchesFound = new Set();
    if (cust.branch_id) branchesFound.add(cust.branch_id.trim().toUpperCase());
    rawBills.forEach(b => {
      const st = findStockItemForBill(b, cust.branch_id);
      if (st?.branch_id) branchesFound.add(st.branch_id);
    });

    return {
      'Customer ID': cust.id,
      'Customer Name': cust.name || '',
      'Telephone (TP)': cust.tp || '',
      'NIC Number': cust.nic || '',
      'Address Line 1': cust.address || '',
      'Address Line 2': cust.address_2 || '',
      'Associated Bills': cust.bill_numbers || '',
      'Total Bills Count': rawBills.length,
      'Associated Branches': Array.from(branchesFound).join(', ') || '-',
      'Registration Date': cust.created_at ? new Date(cust.created_at).toISOString().split('T')[0] : ''
    };
  });

  // ----------------------------------------------------
  // SHEET 3: Complete Stock Inventory with Customer Link Status
  // ----------------------------------------------------
  // Build fast branch-scoped reverse lookup from (branch_id::bill) to customer
  const billToCustomerByBranch = new Map();
  const billToCustomersAny = new Map();
  customers.forEach(cust => {
    if (!cust.bill_numbers) return;
    const custBranch = (cust.branch_id || '').trim().toUpperCase();
    const parts = cust.bill_numbers.split(',').map(s => s.trim()).filter(Boolean);
    parts.forEach(b => {
      const norm = normalizeKey(b);
      const stripped = normalizeKey(stripBranchPrefix(b));
      if (custBranch && norm) {
        billToCustomerByBranch.set(`${custBranch}::${norm}`, cust);
      }
      if (custBranch && stripped && stripped.length >= 3) {
        billToCustomerByBranch.set(`${custBranch}::${stripped}`, cust);
      }
      if (norm && !custBranch) {
        billToCustomersAny.set(norm, cust);
      }
    });
  });

  function findCustomerForStock(stockBill, stockBranchId) {
    if (!stockBill) return null;
    const br = (stockBranchId || '').trim().toUpperCase();
    const norm = normalizeKey(stockBill);
    const stripped = normalizeKey(stripBranchPrefix(stockBill));
    if (br) {
      if (billToCustomerByBranch.has(`${br}::${norm}`)) return billToCustomerByBranch.get(`${br}::${norm}`);
      if (stripped && billToCustomerByBranch.has(`${br}::${stripped}`)) return billToCustomerByBranch.get(`${br}::${stripped}`);
    }
    if (billToCustomersAny.has(norm)) return billToCustomersAny.get(norm);
    if (stripped && billToCustomersAny.has(stripped)) return billToCustomersAny.get(stripped);
    return null;
  }

  const stockInventoryRows = stockItems.map(item => {
    const cust = findCustomerForStock(item.bill_no, item.branch_id);
    const branchName = branchMap[item.branch_id?.toUpperCase()] || item.branch_id || '-';

    return {
      'Bill Number': item.bill_no,
      'Branch Code': item.branch_id || '-',
      'Branch Name': branchName,
      'Item Type': item.item_type || '-',
      'Weight (g)': item.weight ? parseFloat(item.weight) : '',
      'Principal Amount (LKR)': item.price ? parseFloat(item.price) : '',
      'Pawn Date': item.date ? new Date(item.date).toISOString().split('T')[0] : '',
      'Status': item.status || 'Active',
      'Customer Linked?': cust ? 'YES' : 'NO',
      'Customer Name': cust?.name || '-',
      'Customer Phone': cust?.tp || '-',
      'Customer NIC': cust?.nic || '-',
      'Customer Address': cust?.address || '-'
    };
  });

  // ----------------------------------------------------
  // SHEET 4: Branch Summary & Key Statistics
  // ----------------------------------------------------
  const branchSummaryMap = {};
  stockItems.forEach(item => {
    const b = item.branch_id || 'UNKNOWN';
    if (!branchSummaryMap[b]) {
      branchSummaryMap[b] = {
        branchCode: b,
        branchName: branchMap[b.toUpperCase()] || b,
        totalItems: 0,
        linkedItems: 0,
        totalValuation: 0,
        totalWeight: 0
      };
    }
    branchSummaryMap[b].totalItems++;
    branchSummaryMap[b].totalValuation += (parseFloat(item.price) || 0);
    branchSummaryMap[b].totalWeight += (parseFloat(item.weight) || 0);

    const cust = findCustomerForStock(item.bill_no, item.branch_id);
    if (cust) {
      branchSummaryMap[b].linkedItems++;
    }
  });

  const branchSummaryRows = Object.values(branchSummaryMap).map(b => ({
    'Branch Code': b.branchCode,
    'Branch Name': b.branchName,
    'Total Stock Items': b.totalItems,
    'Customer Info Linked': b.linkedItems,
    'Pending Customer Info': b.totalItems - b.linkedItems,
    'Customer Match %': ((b.linkedItems / b.totalItems) * 100).toFixed(1) + '%',
    'Total Weight (g)': parseFloat(b.totalWeight.toFixed(3)),
    'Total Valuation (LKR)': Math.round(b.totalValuation)
  }));

  // Overall metrics row
  const totalStockCount = stockItems.length;
  const totalLinkedCount = stockInventoryRows.filter(r => r['Customer Linked?'] === 'YES').length;
  const totalValuationAll = stockItems.reduce((acc, s) => acc + (parseFloat(s.price) || 0), 0);

  branchSummaryRows.push({
    'Branch Code': 'TOTAL',
    'Branch Name': 'ALL BRANCHES',
    'Total Stock Items': totalStockCount,
    'Customer Info Linked': totalLinkedCount,
    'Pending Customer Info': totalStockCount - totalLinkedCount,
    'Customer Match %': ((totalLinkedCount / totalStockCount) * 100).toFixed(1) + '%',
    'Total Weight (g)': parseFloat(stockItems.reduce((acc, s) => acc + (parseFloat(s.weight) || 0), 0).toFixed(3)),
    'Total Valuation (LKR)': Math.round(totalValuationAll)
  });

  // ----------------------------------------------------
  // CREATE WORKBOOK & APPEND SHEETS
  // ----------------------------------------------------
  const wb = XLSX.utils.book_new();

  // Helper to set column widths
  function autoFitCols(ws, rows) {
    if (!rows || rows.length === 0) return;
    const keys = Object.keys(rows[0]);
    ws['!cols'] = keys.map(k => {
      let maxLen = k.length;
      for (let i = 0; i < Math.min(rows.length, 200); i++) {
        const val = rows[i][k];
        if (val !== null && val !== undefined) {
          maxLen = Math.max(maxLen, String(val).length);
        }
      }
      return { wch: Math.min(Math.max(maxLen + 3, 12), 45) };
    });
  }

  // Sheet 1: Bill-Wise Customers
  const ws1 = XLSX.utils.json_to_sheet(billWiseRows);
  autoFitCols(ws1, billWiseRows);
  XLSX.utils.book_append_sheet(wb, ws1, 'Bill_Wise_Customers');

  // Sheet 2: Customer Master Directory
  const ws2 = XLSX.utils.json_to_sheet(customerMasterRows);
  autoFitCols(ws2, customerMasterRows);
  XLSX.utils.book_append_sheet(wb, ws2, 'Customer_Master_List');

  // Sheet 3: Stock Inventory & Status
  const ws3 = XLSX.utils.json_to_sheet(stockInventoryRows);
  autoFitCols(ws3, stockInventoryRows);
  XLSX.utils.book_append_sheet(wb, ws3, 'Stock_Inventory_Matched');

  // Sheet 4: Summary by Branch
  const ws4 = XLSX.utils.json_to_sheet(branchSummaryRows);
  autoFitCols(ws4, branchSummaryRows);
  XLSX.utils.book_append_sheet(wb, ws4, 'Summary_By_Branch');

  // Output file paths
  const exportsDir = path.join('d:', 'Mifos', 'exports');
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 10);
  const outExcelPath = path.join(exportsDir, `MIFOS_Stock_Customers_by_Bill_${timestamp}.xlsx`);
  const standardExcelPath = path.join(exportsDir, `MIFOS_Stock_Customers_by_Bill.xlsx`);

  XLSX.writeFile(wb, outExcelPath);
  XLSX.writeFile(wb, standardExcelPath);

  // Also write CSV version for instant viewing or importing
  const csvPath = path.join(exportsDir, `MIFOS_Stock_Customers_by_Bill.csv`);
  const csvContent = XLSX.utils.sheet_to_csv(ws1);
  fs.writeFileSync(csvPath, csvContent, 'utf8');

  console.log(`\nSUCCESS! Excel workbook created:`);
  console.log(`1. ${outExcelPath}`);
  console.log(`2. ${standardExcelPath}`);
  console.log(`3. CSV: ${csvPath}`);
  console.log(`\nStatistics:`);
  console.log(`- Bill-wise entries generated: ${billWiseRows.length}`);
  console.log(`- Customer master profiles: ${customerMasterRows.length}`);
  console.log(`- Stock inventory items: ${stockInventoryRows.length}`);
}

exportStockCustomersExcel().catch(err => {
  console.error('Fatal export error:', err);
  process.exit(1);
});
