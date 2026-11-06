const path = require('path');
const fs = require('fs');
const pgPath = path.resolve(__dirname, '../frontend/node_modules/pg');
const exceljsPath = path.resolve(__dirname, '../frontend/node_modules/exceljs');
const { Client } = require(pgPath);
const ExcelJS = require(exceljsPath);

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

function calculateAgeDays(dateStr, todayStr = '2026-11-02') {
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

// Styling definitions
const NAVY_HEADER_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1E293B' } // Slate-800
};

const NAVY_HEADER_FONT = {
  name: 'Calibri',
  size: 11,
  bold: true,
  color: { argb: 'FFFFFFFF' }
};

const BLACKOUT_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF000000' } // Pure Black
};

const BLACKOUT_FONT = {
  name: 'Calibri',
  size: 11,
  bold: true,
  color: { argb: 'FF000000' } // Pure Black (Invisible on black fill, secure on copy)
};

const TOTAL_ROW_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF1F5F9' } // Slate-100
};

const TOTAL_ROW_FONT = {
  name: 'Calibri',
  size: 11,
  bold: true,
  color: { argb: 'FF0F172A' }
};

const THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
};

const TOTAL_BORDER = {
  top: { style: 'thin', color: { argb: 'FF64748B' } },
  left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  bottom: { style: 'double', color: { argb: 'FF0F172A' } },
  right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
};

async function buildAgingReport() {
  console.log('Connecting to PostgreSQL database...');
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  console.log('Fetching database tables...');
  const [stockRes, custRes, pawnRes, interestRes, branchRes] = await Promise.all([
    client.query('SELECT * FROM public.stock_items'),
    client.query('SELECT * FROM public.stock_customers'),
    client.query('SELECT p.bill_no, p.branch_id, c.first_name, c.last_name, c.national_id FROM public.pawns p LEFT JOIN public.clients c ON p.client_id = c.id WHERE p.bill_no IS NOT NULL'),
    client.query('SELECT * FROM public.stock_interests'),
    client.query('SELECT id, name FROM public.branches')
  ]);

  await client.end();
  console.log('Database query finished. Processing dataset...');

  const stockItems = stockRes.rows;
  const customers = custRes.rows;
  const pawns = pawnRes.rows;
  const interests = interestRes.rows;
  const branches = branchRes.rows;

  // Branch map
  const branchMap = {};
  branches.forEach(b => {
    branchMap[b.id.toUpperCase()] = b.name;
  });

  // Interest map
  const interestMap = new Map();
  interests.forEach(i => {
    if (i.bill_no) {
      const key = normalizeKey(i.bill_no);
      const val = parseFloat(i.interest_value) || 0;
      interestMap.set(key, (interestMap.get(key) || 0) + val);
    }
  });

  // Customer map
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

    if (stripped && stripped.length >= 3) {
      for (const [key, cust] of billToCustMap.entries()) {
        if (key.endsWith(stripped) || stripped.endsWith(key)) {
          return cust;
        }
      }
    }
    return { name: null, nic: null, hasRecord: false };
  }

  // Process all items
  const processedItems = stockItems.map(item => {
    const branchId = (item.branch_id || 'UNKNOWN').toUpperCase();
    const branchName = branchMap[branchId] || branchId;
    const cleanDate = fixDateString(item.date, item.created_at);
    const ageInfo = calculateAgeDays(cleanDate, '2026-11-02');
    const cust = findCustomer(item.bill_no);
    const normBill = normalizeKey(item.bill_no);
    const strippedBill = normalizeKey(stripBranchPrefix(item.bill_no));
    const interestPaid = interestMap.get(normBill) || interestMap.get(strippedBill) || 0;

    return {
      id: item.id,
      branchId,
      branchName,
      billNo: item.bill_no || '-',
      hasRecord: cust.hasRecord,
      itemType: item.item_type || '-',
      weight: item.weight ? parseFloat(parseFloat(item.weight).toFixed(3)) : 0,
      price: item.price ? parseFloat(parseFloat(item.price).toFixed(2)) : 0,
      date: cleanDate,
      ageDays: ageInfo.days,
      agingBucket: ageInfo.bucket,
      status: item.status || 'Active',
      withdrawalDate: fixDateString(item.withdrawal_date) || '-',
      withdrawalReason: item.withdrawal_reason || '-',
      interestPaid: parseFloat(interestPaid.toFixed(2))
    };
  });

  // Sort items: First by Branch Name, then by Bill Number / Item ID (as explicitly requested!)
  processedItems.sort((a, b) => {
    const bComp = a.branchName.localeCompare(b.branchName);
    if (bComp !== 0) return bComp;
    return a.billNo.localeCompare(b.billNo, undefined, { numeric: true, sensitivity: 'base' });
  });

  // Initialize ExcelJS Workbook
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Mifos Core Banking System';
  wb.created = new Date();
  wb.modified = new Date();

  // -----------------------------------------------------------------------------------
  // 1. EXECUTIVE AGING SUMMARY MATRIX SHEET
  // -----------------------------------------------------------------------------------
  console.log('Generating Sheet 1: Executive Aging Summary Matrix...');
  const wsSummary = wb.addWorksheet('Executive Summary', {
    views: [{ showGridLines: true, state: 'frozen', ySplit: 2 }]
  });

  const bucketKeys = ['0 – 30 Days', '31 – 60 Days', '61 – 90 Days', '91 – 180 Days', '181 – 365 Days', '> 365 Days'];

  // Calculate aggregation
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
      bs.buckets[item.agingBucket].count++;
      bs.buckets[item.agingBucket].val += item.price;

      overallMatrix.active.count++;
      overallMatrix.active.val += item.price;
      overallMatrix.active.weight += item.weight;
      overallMatrix.buckets[item.agingBucket].count++;
      overallMatrix.buckets[item.agingBucket].val += item.price;
    } else {
      bs.withdrawnItems++;
      bs.withdrawnVal += item.price;

      overallMatrix.withdrawn.count++;
      overallMatrix.withdrawn.val += item.price;
    }
  });

  // Setup summary columns cleanly starting from cell A1
  wsSummary.columns = [
    { header: 'Branch Code', key: 'branchCode', width: 14 },
    { header: 'Branch Name', key: 'branchName', width: 22 },
    { header: '0–30d (Qty)', key: 'b0_qty', width: 13 },
    { header: '0–30d (LKR)', key: 'b0_val', width: 16 },
    { header: '31–60d (Qty)', key: 'b31_qty', width: 13 },
    { header: '31–60d (LKR)', key: 'b31_val', width: 16 },
    { header: '61–90d (Qty)', key: 'b61_qty', width: 13 },
    { header: '61–90d (LKR)', key: 'b61_val', width: 16 },
    { header: '91–180d (Qty)', key: 'b91_qty', width: 14 },
    { header: '91–180d (LKR)', key: 'b91_val', width: 16 },
    { header: '181–365d (Qty)', key: 'b181_qty', width: 14 },
    { header: '181–365d (LKR)', key: 'b181_val', width: 16 },
    { header: '>365d (Qty)', key: 'b365_qty', width: 13 },
    { header: '>365d (LKR)', key: 'b365_val', width: 16 },
    { header: 'Active Qty', key: 'act_qty', width: 14 },
    { header: 'Active Value (LKR)', key: 'act_val', width: 20 },
    { header: 'Active Wt (g)', key: 'act_wt', width: 15 },
    { header: 'Withdrawn Qty', key: 'w_qty', width: 15 },
    { header: 'Withdrawn Value (LKR)', key: 'w_val', width: 22 },
    { header: 'Total Stock Qty', key: 'tot_qty', width: 16 },
    { header: 'Total Portfolio (LKR)', key: 'tot_val', width: 22 }
  ];

  // Insert a clean header banner at Row 1
  wsSummary.spliceRows(1, 0, [
    'BRANCH-WISE STOCK AGING & PORTFOLIO AUDIT REPORT (LIVE AS OF 2026-11-02)'
  ]);
  wsSummary.mergeCells('A1:U1');
  const bannerCell = wsSummary.getCell('A1');
  bannerCell.font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  bannerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  bannerCell.alignment = { vertical: 'middle', horizontal: 'center' };
  wsSummary.getRow(1).height = 30;

  // Format table header row (Row 2)
  const summaryHeaderRow = wsSummary.getRow(2);
  summaryHeaderRow.height = 26;
  summaryHeaderRow.eachCell((cell) => {
    cell.fill = NAVY_HEADER_FILL;
    cell.font = NAVY_HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = THIN_BORDER;
  });

  // Sort branches alphabetically by branch name
  const sortedBranchCodes = Object.keys(branchSummary).sort((a, b) => 
    branchSummary[a].branchName.localeCompare(branchSummary[b].branchName)
  );

  let currentSummaryRowIdx = 3;
  sortedBranchCodes.forEach(bCode => {
    const b = branchSummary[bCode];
    const row = wsSummary.addRow({
      branchCode: b.branchCode,
      branchName: b.branchName,
      b0_qty: b.buckets['0 – 30 Days'].count,
      b0_val: b.buckets['0 – 30 Days'].val,
      b31_qty: b.buckets['31 – 60 Days'].count,
      b31_val: b.buckets['31 – 60 Days'].val,
      b61_qty: b.buckets['61 – 90 Days'].count,
      b61_val: b.buckets['61 – 90 Days'].val,
      b91_qty: b.buckets['91 – 180 Days'].count,
      b91_val: b.buckets['91 – 180 Days'].val,
      b181_qty: b.buckets['181 – 365 Days'].count,
      b181_val: b.buckets['181 – 365 Days'].val,
      b365_qty: b.buckets['> 365 Days'].count,
      b365_val: b.buckets['> 365 Days'].val,
      act_qty: b.activeItems,
      act_val: b.activeVal,
      act_wt: b.activeWeight,
      w_qty: b.withdrawnItems,
      w_val: b.withdrawnVal,
      tot_qty: b.totalItems,
      tot_val: b.totalVal
    });

    row.height = 20;
    const isEven = (currentSummaryRowIdx % 2 === 0);
    const rowFill = isEven ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } } : null;

    row.eachCell((cell, colNumber) => {
      if (rowFill) cell.fill = rowFill;
      cell.border = THIN_BORDER;
      cell.font = { name: 'Calibri', size: 10 };

      if (colNumber === 1) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else if (colNumber === 2) {
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      } else if ([3, 5, 7, 9, 11, 13, 15, 18, 20].includes(colNumber)) {
        cell.numFmt = '#,##0';
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      } else if (colNumber === 17) {
        cell.numFmt = '#,##0.000';
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      } else {
        cell.numFmt = '#,##0';
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      }
    });

    currentSummaryRowIdx++;
  });

  // Grand Total Row
  const totalRow = wsSummary.addRow({
    branchCode: 'TOTAL',
    branchName: 'ALL BRANCHES (GRAND TOTAL)',
    b0_qty: overallMatrix.buckets['0 – 30 Days'].count,
    b0_val: overallMatrix.buckets['0 – 30 Days'].val,
    b31_qty: overallMatrix.buckets['31 – 60 Days'].count,
    b31_val: overallMatrix.buckets['31 – 60 Days'].val,
    b61_qty: overallMatrix.buckets['61 – 90 Days'].count,
    b61_val: overallMatrix.buckets['61 – 90 Days'].val,
    b91_qty: overallMatrix.buckets['91 – 180 Days'].count,
    b91_val: overallMatrix.buckets['91 – 180 Days'].val,
    b181_qty: overallMatrix.buckets['181 – 365 Days'].count,
    b181_val: overallMatrix.buckets['181 – 365 Days'].val,
    b365_qty: overallMatrix.buckets['> 365 Days'].count,
    b365_val: overallMatrix.buckets['> 365 Days'].val,
    act_qty: overallMatrix.active.count,
    act_val: overallMatrix.active.val,
    act_wt: overallMatrix.active.weight,
    w_qty: overallMatrix.withdrawn.count,
    w_val: overallMatrix.withdrawn.val,
    tot_qty: stockItems.length,
    tot_val: overallMatrix.active.val + overallMatrix.withdrawn.val
  });

  totalRow.height = 24;
  totalRow.eachCell((cell, colNumber) => {
    cell.fill = TOTAL_ROW_FILL;
    cell.font = TOTAL_ROW_FONT;
    cell.border = TOTAL_BORDER;

    if (colNumber === 1 || colNumber === 2) {
      cell.alignment = { vertical: 'middle', horizontal: colNumber === 1 ? 'center' : 'left' };
    } else if (colNumber === 17) {
      cell.numFmt = '#,##0.000';
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
    } else {
      cell.numFmt = '#,##0';
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
    }
  });


  // -----------------------------------------------------------------------------------
  // HELPER FUNCTION TO POPULATE A STOCK TABLE (Master Sheet or Branch Sheet)
  // -----------------------------------------------------------------------------------
  function populateStockWorksheet(ws, items, titleText = '') {
    ws.views = [{ showGridLines: true, state: 'frozen', ySplit: 1 }];

    ws.columns = [
      { header: 'Branch Code', key: 'branchId', width: 13 },
      { header: 'Branch Name', key: 'branchName', width: 18 },
      { header: 'Bill Number', key: 'billNo', width: 16 },
      { header: 'Customer Name', key: 'custName', width: 22 },
      { header: 'Customer NIC', key: 'custNic', width: 18 },
      { header: 'Item Type', key: 'itemType', width: 12 },
      { header: 'Gold Weight (g)', key: 'weight', width: 16 },
      { header: 'Principal Valuation (LKR)', key: 'price', width: 24 },
      { header: 'Pawn / Stock Date', key: 'date', width: 18 },
      { header: 'Stock Status', key: 'status', width: 14 },
      { header: 'Age (Days)', key: 'ageDays', width: 13 },
      { header: 'Aging Bracket', key: 'agingBucket', width: 16 },
      { header: 'Withdrawal Date', key: 'withdrawalDate', width: 16 },
      { header: 'Withdrawal Reason', key: 'withdrawalReason', width: 25 },
      { header: 'Interest Paid (LKR)', key: 'interestPaid', width: 18 }
    ];

    // Format Header Row (Row 1)
    const headerRow = ws.getRow(1);
    headerRow.height = 26;
    headerRow.eachCell((cell) => {
      cell.fill = NAVY_HEADER_FILL;
      cell.font = NAVY_HEADER_FONT;
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = THIN_BORDER;
    });

    // Add Data Rows
    items.forEach((item, index) => {
      const row = ws.addRow({
        branchId: item.branchId,
        branchName: item.branchName,
        billNo: item.billNo,
        custName: item.hasRecord ? '████████████' : '(Unlinked Stock)',
        custNic: item.hasRecord ? '██████████' : '(No NIC)',
        itemType: item.itemType,
        weight: item.weight,
        price: item.price,
        date: item.date,
        status: item.status,
        ageDays: item.ageDays,
        agingBucket: item.agingBucket,
        withdrawalDate: item.withdrawalDate,
        withdrawalReason: item.withdrawalReason,
        interestPaid: item.interestPaid
      });

      row.height = 20;
      const isEven = (index % 2 === 1);
      const rowFill = isEven ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } } : null;

      row.eachCell((cell, colNumber) => {
        if (rowFill) cell.fill = rowFill;
        cell.border = THIN_BORDER;
        cell.font = { name: 'Calibri', size: 10 };

        // Formatting & Alignments
        if (colNumber === 1 || colNumber === 6 || colNumber === 9 || colNumber === 10 || colNumber === 13) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        } else if (colNumber === 3) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
          cell.font = { name: 'Calibri', size: 10, bold: true };
        } else if (colNumber === 4 || colNumber === 5) {
          // Blackout formatting for Customer Name (4) and NIC (5)
          if (item.hasRecord) {
            cell.fill = BLACKOUT_FILL;
            cell.font = BLACKOUT_FONT;
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
          } else {
            cell.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF94A3B8' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
          }
        } else if (colNumber === 7) {
          cell.numFmt = '#,##0.000';
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
        } else if (colNumber === 8 || colNumber === 15) {
          cell.numFmt = '#,##0';
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
        } else if (colNumber === 11) {
          cell.numFmt = '#,##0';
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
        } else if (colNumber === 12) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
          // Color code aging bracket
          if (item.agingBucket === '> 365 Days') {
            cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFDC2626' } }; // Red
          } else if (item.agingBucket === '181 – 365 Days') {
            cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFD97706' } }; // Amber
          }
        } else {
          cell.alignment = { vertical: 'middle', horizontal: 'left' };
        }
      });
    });

    // Total Row
    const totWeight = items.reduce((acc, i) => acc + i.weight, 0);
    const totVal = items.reduce((acc, i) => acc + i.price, 0);
    const totInterest = items.reduce((acc, i) => acc + i.interestPaid, 0);

    const bTotalRow = ws.addRow({
      branchId: 'TOTAL',
      branchName: titleText || `${items.length} Total Items`,
      billNo: `${items.length} Records`,
      custName: '-',
      custNic: '-',
      itemType: '-',
      weight: totWeight,
      price: totVal,
      date: '-',
      status: '-',
      ageDays: '',
      agingBucket: '-',
      withdrawalDate: '-',
      withdrawalReason: '-',
      interestPaid: totInterest
    });

    bTotalRow.height = 24;
    bTotalRow.eachCell((cell, colNumber) => {
      cell.fill = TOTAL_ROW_FILL;
      cell.font = TOTAL_ROW_FONT;
      cell.border = TOTAL_BORDER;

      if (colNumber === 1 || colNumber === 2 || colNumber === 3) {
        cell.alignment = { vertical: 'middle', horizontal: colNumber === 1 ? 'center' : 'left' };
      } else if (colNumber === 7) {
        cell.numFmt = '#,##0.000';
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      } else if (colNumber === 8 || colNumber === 15) {
        cell.numFmt = '#,##0';
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      } else {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      }
    });

    // Set auto-filter across columns
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: items.length + 1, column: 15 }
    };
  }

  // -----------------------------------------------------------------------------------
  // 2. MASTER CONSOLIDATED SHEET (All Branches ordered by Branch then Bill No)
  // -----------------------------------------------------------------------------------
  console.log('Generating Sheet 2: Master Stock Aging (All Branches)...');
  const wsMaster = wb.addWorksheet('Master Stock Aging');
  populateStockWorksheet(wsMaster, processedItems, 'Grand Total (All Branches)');

  // -----------------------------------------------------------------------------------
  // 3. INDIVIDUAL BRANCH SHEETS ("One by one by branch")
  // -----------------------------------------------------------------------------------
  sortedBranchCodes.forEach(bCode => {
    const branchItems = processedItems.filter(i => i.branchId === bCode);
    if (branchItems.length === 0) return;

    const bName = branchMap[bCode] || bCode;
    console.log(`Generating Branch Sheet: ${bCode} (${bName}) - ${branchItems.length} items...`);

    const safeSheetName = `${bCode} - ${bName}`.slice(0, 31).replace(/[:*?/\\\[\]]/g, '');
    const wsBranch = wb.addWorksheet(safeSheetName);
    populateStockWorksheet(wsBranch, branchItems, `${bName} Branch Total`);
  });

  // Ensure export directory exists
  const exportDir = path.resolve('exports');
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  const exportPath = path.join(exportDir, 'Professional_Stock_Aging_Report_2026-11-02.xlsx');
  await wb.xlsx.writeFile(exportPath);

  // Also copy to artifacts directory
  const artifactPath = path.join('C:\\Users\\a12u\\.gemini\\antigravity\\brain\\20f89f0c-0f64-438b-ae66-93e271072001', 'Professional_Stock_Aging_Report_2026-11-02.xlsx');
  await wb.xlsx.writeFile(artifactPath);

  console.log(`\nWorkbook successfully created!`);
  console.log(`File saved to: ${exportPath}`);
  console.log(`Artifact copy saved to: ${artifactPath}`);
  console.log(`Total sheets created: ${wb.worksheets.length}`);
}

buildAgingReport().catch(err => {
  console.error('Fatal error building aging report:', err);
  process.exit(1);
});

