import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { recordAuditLog } from '@/lib/audit-logger';
import { sendFreeSms, buildForfeitureWarningSms } from '@/lib/sms';
import { getBranchSearchTerms, normalizeBranchId, extractNumericBillNo, stripBranchPrefix, isSameNumericBill } from '@/lib/branch-mapping';
import { invalidateBranchInventoryCache } from '@/lib/redis';

export const dynamic = 'force-dynamic';

function extractPeriodMonths(billNo?: string, itemType?: string, defaultPeriod = 3): number {
  if (!billNo) return defaultPeriod;
  const upper = billNo.toUpperCase();
  const match = upper.match(/(\d+)R/);
  if (match) {
    const p = parseInt(match[1], 10);
    if ([1, 2, 3, 6, 12].includes(p)) return p;
  }
  return defaultPeriod;
}

function getFsThresholdMonths(billNo?: string): number {
  if (!billNo) return 3;
  const upper = billNo.toUpperCase().trim();
  if (upper.startsWith('1R')) return 3;           // 1R FS at 3 months
  if (upper.startsWith('3R') || upper.startsWith('3M')) return 5; // 3R / 3M FS at 5 months
  if (upper.startsWith('12R') || upper.startsWith('A')) return 13; // 12R & A FS at 13 months
  if (upper.startsWith('6R')) return 8;           // 6R (legacy fallback)
  return 3;
}

function extractBillTag(billNo?: string): string {
  if (!billNo) return 'OTHER';
  const upper = billNo.toUpperCase().trim();
  if (upper.startsWith('1R')) return '1R';
  if (upper.startsWith('3R')) return '3R';
  if (upper.startsWith('3M')) return '3M';
  if (upper.startsWith('12R')) return '12R';
  if (upper.startsWith('A')) return 'A';
  if (upper.startsWith('6R')) return '6R';
  const match = upper.match(/(\d+R)/);
  if (match) return match[1];
  return 'OTHER';
}

function isValidPhone(p?: string | null): boolean {
  if (!p) return false;
  const digits = String(p).replace(/\D/g, '');
  if (!digits || digits.length < 9) return false;
  if (/^0+$/.test(digits)) return false;
  if (digits === '07' || digits === '077' || digits === '071') return false;
  return true;
}

function cleanPhoneDisplay(p?: string | null): string {
  if (!p) return '';
  const digits = String(p).replace(/\D/g, '');
  if (digits.length === 9) return '0' + digits;
  if (digits.length === 11 && digits.startsWith('94')) return '0' + digits.substring(2);
  return digits;
}

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    // Role Security: Strictly Admin-only
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ 
        error: 'Access Denied: Only Administrators can view or manage Forfeited Stock (FS Items).' 
      }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const modeParam = (searchParams.get('mode') || '').toLowerCase();
    const branchParam = searchParams.get('branch') || 'ALL';

    // Mode: Return only items explicitly marked as Forfeited ('F/S') in stock_items
    if (modeParam === 'fs_marked') {
      let fsMarked: any[] = [];
      let mPage = 0;
      const mSize = 1000;
      while (true) {
        let mq = adminSupabase
          .from('stock_items')
          .select('id, bill_no, branch_id, date, item_type, weight, status, withdrawal_reason, withdrawal_date, created_at')
          .eq('withdrawal_reason', 'F/S')
          .order('branch_id', { ascending: true })
          .order('date', { ascending: true })
          .range(mPage * mSize, (mPage + 1) * mSize - 1);

        if (branchParam !== 'ALL' && branchParam.trim() !== '') {
          mq = mq.in('branch_id', getBranchSearchTerms(branchParam));
        }

        const { data, error } = await mq;
        if (error) throw error;
        if (data && data.length > 0) {
          fsMarked = fsMarked.concat(data);
          if (data.length < mSize) break;
          mPage++;
        } else {
          break;
        }
      }
      return NextResponse.json({
        success: true,
        count: fsMarked.length,
        items: fsMarked
      });
    }

    const severityParam = searchParams.get('severity') || 'ALL';
    const periodParam = searchParams.get('period') || 'ALL';
    const billTagParam = (searchParams.get('billTag') || 'ALL').toUpperCase();
    const interestStatusParam = (searchParams.get('interestStatus') || 'ALL').toUpperCase();
    const searchParam = (searchParams.get('search') || '').trim().toLowerCase();

    // 1. Paginated fetch of all active stock items
    let allStock: any[] = [];
    let page = 0;
    const pageSize = 1000;
    while (true) {
      let query = adminSupabase
        .from('stock_items')
        .select('*')
        .eq('status', 'Active')
        .order('created_at', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (branchParam !== 'ALL' && branchParam.trim() !== '') {
        const branchTerms = getBranchSearchTerms(branchParam);
        query = query.in('branch_id', branchTerms);
      }

      const { data, error } = await query;
      if (error) throw error;
      if (data && data.length > 0) {
        allStock = allStock.concat(data);
        if (data.length < pageSize) break;
        page++;
      } else {
        break;
      }
    }

    // 2. Fetch Active Pawns
    let pawnsQuery = adminSupabase
      .from('pawns')
      .select('id, bill_no, branch_id, client_id, disbursed_amount, appraised_value, period_months, interest_rate, created_at, status')
      .eq('status', 'ACTIVE');

    if (branchParam !== 'ALL' && branchParam.trim() !== '') {
      const branchTerms = getBranchSearchTerms(branchParam);
      const orClause = branchTerms.map(t => `branch_id.ilike.%${t}%`).join(',');
      pawnsQuery = pawnsQuery.or(orClause);
    }
    const { data: pawnsData } = await pawnsQuery;
    const pawns = pawnsData || [];

    // Index pawns by branch + numeric bill
    const pawnsByBillMap: Record<string, any> = {};
    pawns.forEach(p => {
      const bKey = (p.branch_id || '').toUpperCase() + '::' + extractNumericBillNo(p.bill_no);
      pawnsByBillMap[bKey] = p;
      if (p.bill_no) {
        pawnsByBillMap[p.bill_no.trim().toUpperCase()] = p;
      }
    });

    // 3. Fetch Stock Interests
    let interestQuery = adminSupabase
      .from('stock_interests')
      .select('*')
      .order('date', { ascending: false });

    if (branchParam !== 'ALL' && branchParam.trim() !== '') {
      interestQuery = interestQuery.eq('branch', branchParam.toUpperCase());
    }
    const { data: interestData } = await interestQuery;
    const interests = interestData || [];

    // Group interests by branch + numeric bill
    const interestsByBillMap: Record<string, any[]> = {};
    interests.forEach(i => {
      const bKey = (i.branch || '').toUpperCase() + '::' + extractNumericBillNo(i.bill_no);
      if (!interestsByBillMap[bKey]) interestsByBillMap[bKey] = [];
      interestsByBillMap[bKey].push(i);
      const rawKey = (i.bill_no || '').trim().toUpperCase();
      if (rawKey) {
        if (!interestsByBillMap[rawKey]) interestsByBillMap[rawKey] = [];
        interestsByBillMap[rawKey].push(i);
      }
    });

    // 4. Fetch Clients & Stock Customers for phone/contact resolution
    const [clientsRes, scRes, smsLogsRes] = await Promise.all([
      adminSupabase.from('clients').select('id, national_id, first_name, last_name, phone, address, branch_id'),
      adminSupabase.from('stock_customers').select('name, nic, tp, address, bill_numbers, branch_id'),
      adminSupabase.from('sms_logs').select('recipient_phone, message_text, status, created_at').order('created_at', { ascending: false }).limit(200)
    ]);

    const clientsMap: Record<string, any> = {};
    (clientsRes.data || []).forEach(c => {
      if (c.id) clientsMap[c.id] = c;
      if (c.national_id && c.branch_id) {
        clientsMap[`${normalizeBranchId(c.branch_id)}::${c.national_id.trim().toUpperCase()}`] = c;
      }
    });

    const scByBranchFullBillMap: Record<string, any> = {};
    const scByBranchNumericBillMap: Record<string, any> = {};
    const scUnassignedNumericBillMap: Record<string, any> = {};
    (scRes.data || []).forEach(sc => {
      if (sc.bill_numbers) {
        const scBr = sc.branch_id ? normalizeBranchId(sc.branch_id) : '';
        const parts = String(sc.bill_numbers).split(/[,;]/);
        parts.forEach(p => {
          const trimmed = p.trim();
          const normFull = stripBranchPrefix(trimmed).toUpperCase().replace(/[\s\-_/]+/g, '');
          const num = extractNumericBillNo(trimmed);
          if (scBr) {
            if (normFull) scByBranchFullBillMap[`${scBr}::${normFull}`] = sc;
            if (num) scByBranchNumericBillMap[`${scBr}::${num}`] = sc;
          } else if (num) {
            scUnassignedNumericBillMap[num] = sc;
          }
        });
      }
    });

    // Index SMS logs by recipient phone
    const recentSmsByPhoneMap: Record<string, any> = {};
    (smsLogsRes.data || []).forEach(log => {
      const p = cleanPhoneDisplay(log.recipient_phone);
      if (p && !recentSmsByPhoneMap[p]) {
        recentSmsByPhoneMap[p] = log;
      }
    });

    const now = new Date();
    const fsItems: any[] = [];

    // Process each active stock item
    for (const item of allStock) {
      const branch = (item.branch_id || 'HQ').toUpperCase();
      const numBill = extractNumericBillNo(item.bill_no);
      const billKey = `${branch}::${numBill}`;
      const rawBillKey = (item.bill_no || '').trim().toUpperCase();

      // Find linked pawn
      const linkedPawn = pawnsByBillMap[billKey] || pawnsByBillMap[rawBillKey] || null;

      // Determine period, tag, and rates
      const periodMonths = linkedPawn?.period_months || extractPeriodMonths(item.bill_no, item.item_type, 3);
      const fsThresholdMonths = getFsThresholdMonths(item.bill_no);
      const billTag = extractBillTag(item.bill_no);
      const interestRate = parseFloat(linkedPawn?.interest_rate) || 3.50;
      const principal = parseFloat(linkedPawn?.disbursed_amount) || parseFloat(item.price) || 0;
      const weight = parseFloat(item.weight) || 0;

      // Determine origination date (Pawn Start Date)
      const origDateStr = linkedPawn?.created_at || item.date || item.created_at;
      const origDate = new Date(origDateStr);
      if (isNaN(origDate.getTime())) continue;

      // Elapsed duration from Pawn Start Date
      const diffTime = now.getTime() - origDate.getTime();
      const elapsedDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));
      const elapsedMonths = Math.max(0, Math.floor(elapsedDays / 30.4375));

      // Business FS Rules:
      // 1R -> 3 months, 3R/3M -> 5 months, 12R & A -> 13 months, 6R -> 8 months
      const baseFsDate = new Date(origDate);
      baseFsDate.setMonth(baseFsDate.getMonth() + fsThresholdMonths);

      // Check interest records
      const intList = interestsByBillMap[billKey] || interestsByBillMap[rawBillKey] || [];
      let totalInterestPaid = 0;
      let coveredMonths = 0;
      let lastInterestDate: string | null = null;
      let lastInterestAmount = 0;

      intList.forEach(intRec => {
        const val = parseFloat(intRec.interest_value) || 0;
        totalInterestPaid += val;
        lastInterestAmount = val;
        if (intRec.date && (!lastInterestDate || intRec.date > lastInterestDate)) {
          lastInterestDate = intRec.date;
        }

        const notes = (intRec.notes || '').toUpperCase();
        const mMatch = notes.match(/I\s*\(?\s*(\d+)\s*\)?/);
        if (mMatch) {
          coveredMonths += parseInt(mMatch[1], 10);
        } else if (principal > 0 && interestRate > 0) {
          const monthlyExpected = principal * (interestRate / 100);
          coveredMonths += Math.max(1, Math.round(val / monthlyExpected));
        } else {
          coveredMonths += 1;
        }
      });

      // Effective FS Date = baseFsDate + coveredMonths
      // If customer paid interest for N months, FS date moves forward by N months
      const effectiveFsDate = new Date(baseFsDate);
      effectiveFsDate.setMonth(effectiveFsDate.getMonth() + coveredMonths);

      const hasPaidInterest = totalInterestPaid > 0 || coveredMonths > 0;
      const isFsEligible = effectiveFsDate <= now;

      // Days Overdue beyond effective FS threshold
      const daysOverdue = isFsEligible
        ? Math.floor((now.getTime() - effectiveFsDate.getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      // Calculate total elapsed months and outstanding interest
      const unpaidMonths = Math.max(1, Math.max(0, elapsedMonths - coveredMonths));
      const monthlyInterest = principal * (interestRate / 100);
      const outstandingInterest = Math.round(unpaidMonths * monthlyInterest);

      // Resolve Customer Information
      let customerName = 'Valued Customer';
      let customerPhone = '';
      let customerNic = '';
      let customerAddress = '';

      const matchedSc =
        scByBranchFullBillMap[`${branch}::${stripBranchPrefix(item.bill_no || '').toUpperCase().replace(/[\s\-_/]+/g, '')}`] ||
        (numBill ? (scByBranchNumericBillMap[billKey] || scUnassignedNumericBillMap[numBill]) : null);

      if (linkedPawn?.client_id && clientsMap[linkedPawn.client_id]) {
        const c = clientsMap[linkedPawn.client_id];
        customerName = `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Valued Customer';
        customerPhone = cleanPhoneDisplay(c.phone);
        customerNic = c.national_id || '';
        customerAddress = c.address || '';
      } else if (matchedSc) {
        customerName = matchedSc.name || 'Valued Customer';
        customerPhone = cleanPhoneDisplay(matchedSc.tp);
        customerNic = matchedSc.nic || '';
        customerAddress = matchedSc.address || '';
      }

      // SMS status check
      const recentSms = customerPhone ? recentSmsByPhoneMap[customerPhone] : null;

      const fsRecord = {
        id: item.id,
        pawn_id: linkedPawn?.id || null,
        bill_no: item.bill_no,
        bill_tag: billTag,
        branch_id: branch,
        item_type: item.item_type,
        weight_grams: weight,
        principal: principal,
        interest_rate: interestRate,
        period_months: periodMonths,
        fs_threshold_months: fsThresholdMonths,
        elapsed_months: elapsedMonths,
        elapsed_days: elapsedDays,
        origination_date: origDate.toISOString().split('T')[0],
        initial_maturity_date: baseFsDate.toISOString().split('T')[0],
        effective_expiry_date: effectiveFsDate.toISOString().split('T')[0],
        is_fs_eligible: isFsEligible,
        days_overdue: daysOverdue,
        covered_months: coveredMonths,
        total_interest_paid: totalInterestPaid,
        last_interest_date: lastInterestDate,
        last_interest_amount: lastInterestAmount,
        outstanding_interest: outstandingInterest,
        has_paid_interest: hasPaidInterest,
        customer_name: customerName,
        customer_phone: customerPhone,
        customer_nic: customerNic,
        customer_address: customerAddress,
        has_phone: isValidPhone(customerPhone),
        last_sms_sent_at: recentSms?.created_at || null,
        last_sms_status: recentSms?.status || null
      };

      // Default view when periodParam === 'ALL' and severityParam === 'ALL' shows all items eligible for FS
      if (periodParam === 'ALL' && severityParam === 'ALL') {
        if (!isFsEligible) continue;
      }

      // Filter 1: Severity
      if (severityParam === '1-14') {
        if (!isFsEligible || daysOverdue < 1 || daysOverdue > 14) continue;
      } else if (severityParam === '15-30') {
        if (!isFsEligible || daysOverdue < 15 || daysOverdue > 30) continue;
      } else if (severityParam === '30+' || severityParam === '30 ' || severityParam === '30%2B') {
        if (!isFsEligible || daysOverdue <= 30) continue;
      }

      // Filter 2: Period / Elapsed Months from Start Date
      if (periodParam !== 'ALL') {
        if (periodParam === '13' || periodParam === '13+') {
          if (elapsedMonths < 13) continue;
        } else {
          const reqM = parseInt(periodParam, 10);
          if (!isNaN(reqM) && elapsedMonths !== reqM) continue;
        }
      }

      // Filter 3: Bill Tag (1R, 3R, 3M, 12R, A, 6R, OTHER)
      if (billTagParam !== 'ALL') {
        if (billTagParam === 'OTHER') {
          if (['1R', '3R', '3M', '12R', 'A', '6R'].includes(billTag)) continue;
        } else if (billTag !== billTagParam) {
          continue;
        }
      }

      // Filter 4: Interest Payment Status (PAID >= 1 mo vs UNPAID / Zero Paid)
      if (interestStatusParam === 'PAID') {
        if (!fsRecord.has_paid_interest) continue;
      } else if (interestStatusParam === 'UNPAID') {
        if (fsRecord.has_paid_interest) continue;
      }

      // Filter 5: Search Query
      if (searchParam) {
        const targetStr = `${fsRecord.bill_no} ${fsRecord.customer_name} ${fsRecord.customer_phone} ${fsRecord.customer_nic} ${fsRecord.branch_id} ${fsRecord.item_type}`.toLowerCase();
        if (!targetStr.includes(searchParam)) continue;
      }

      fsItems.push(fsRecord);
    }

    // Sort by days_overdue descending (highest urgency first)
    fsItems.sort((a, b) => b.days_overdue - a.days_overdue);

    // Compute Summary KPIs
    const totalPrincipalAtRisk = fsItems.reduce((acc, it) => acc + (it.principal || 0), 0);
    const totalInterestDue = fsItems.reduce((acc, it) => acc + (it.outstanding_interest || 0), 0);
    const criticalOverdueCount = fsItems.filter(it => it.days_overdue > 30).length;
    const withPhoneCount = fsItems.filter(it => it.has_phone).length;
    const hasPaidInterestCount = fsItems.filter(it => it.has_paid_interest).length;

    return NextResponse.json({
      success: true,
      count: fsItems.length,
      summary: {
        total_at_risk_count: fsItems.length,
        total_principal_at_risk: totalPrincipalAtRisk,
        total_interest_due: totalInterestDue,
        critical_overdue_count: criticalOverdueCount,
        with_phone_count: withPhoneCount,
        has_paid_interest_count: hasPaidInterestCount,
        zero_interest_count: fsItems.length - hasPaidInterestCount
      },
      items: fsItems
    });
  } catch (err: any) {
    console.error('Forfeiture GET error:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch forfeiture items' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    // Role Security: Strictly Admin-only
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ 
        error: 'Access Denied: Only Administrators can dispatch SMS warnings or mark items as Forfeited.' 
      }, { status: 403 });
    }

    const body = await request.json();
    const { action } = body;

    // Action 1: Single SMS Warning
    if (action === 'SEND_SMS') {
      const { 
        itemId, billNo, customerName, phone, principal, interestDue, 
        expiryDate, branchId, customMessage, originationDate, periodMonths, 
        interestPaid, coveredMonths, lastInterestDate 
      } = body;

      if (!phone || !isValidPhone(phone)) {
        return NextResponse.json({ error: 'A valid customer mobile phone number is required to send SMS.' }, { status: 400 });
      }

      const message = (customMessage && typeof customMessage === 'string' && customMessage.trim() !== '')
        ? customMessage.trim()
        : buildForfeitureWarningSms({
            customerName: customerName || 'Valued Customer',
            ticketNo: billNo || 'N/A',
            principal: parseFloat(principal) || 0,
            interestDue: parseFloat(interestDue) || 0,
            expiryDate: expiryDate || 'N/A',
            branchName: branchId || 'Rupasingha Capital',
            originationDate,
            periodMonths: parseInt(periodMonths, 10) || 3,
            interestPaid: parseFloat(interestPaid) || 0,
            coveredMonths: parseInt(coveredMonths, 10) || 0,
            lastInterestDate
          });

      const smsRes = await sendFreeSms({
        phone,
        message,
        ticketNo: billNo,
        amount: parseFloat(interestDue) || 0,
        type: 'REMINDER',
        branchId: branchId || session.branchId || 'HQ'
      });

      await recordAuditLog(session, {
        action: 'FORFEITURE_SMS_WARNING',
        resource: `bill:${billNo || itemId}`,
        details: {
          itemId,
          billNo,
          customerName,
          phone,
          principal,
          interestDue,
          smsStatus: smsRes.status,
          notice: smsRes.notice,
          isCustom: Boolean(customMessage)
        }
      });

      return NextResponse.json({
        success: true,
        message: 'Forfeiture warning SMS sent successfully.',
        smsResult: smsRes
      });
    }

    // Action 2: Bulk SMS Warning
    if (action === 'BULK_SEND_SMS') {
      const { items, customTemplate } = body;
      if (!Array.isArray(items) || items.length === 0) {
        return NextResponse.json({ error: 'No items selected for SMS dispatch.' }, { status: 400 });
      }

      let sentCount = 0;
      let failedCount = 0;
      let skippedNoPhone = 0;
      const results: any[] = [];

      for (const it of items) {
        if (!it.phone || !isValidPhone(it.phone)) {
          skippedNoPhone++;
          continue;
        }

        try {
          let message = '';
          if (customTemplate && typeof customTemplate === 'string' && customTemplate.trim() !== '') {
            message = customTemplate
              .replace(/\{customer_name\}/gi, it.customerName || 'Valued Customer')
              .replace(/\{bill_no\}/gi, it.billNo || 'N/A')
              .replace(/\{branch\}/gi, it.branchId || 'Branch')
              .replace(/\{principal\}/gi, parseFloat(it.principal || 0).toLocaleString())
              .replace(/\{interest_due\}/gi, parseFloat(it.interestDue || 0).toLocaleString())
              .replace(/\{expiry_date\}/gi, it.expiryDate || 'N/A')
              .replace(/\{origination_date\}/gi, it.originationDate || 'N/A')
              .replace(/\{interest_paid\}/gi, parseFloat(it.interestPaid || 0).toLocaleString());
          } else {
            message = buildForfeitureWarningSms({
              customerName: it.customerName || 'Valued Customer',
              ticketNo: it.billNo || 'N/A',
              principal: parseFloat(it.principal) || 0,
              interestDue: parseFloat(it.interestDue) || 0,
              expiryDate: it.expiryDate || 'N/A',
              branchName: it.branchId || 'Rupasingha Capital',
              originationDate: it.originationDate,
              periodMonths: parseInt(it.periodMonths, 10) || 3,
              interestPaid: parseFloat(it.interestPaid) || 0,
              coveredMonths: parseInt(it.coveredMonths, 10) || 0,
              lastInterestDate: it.lastInterestDate
            });
          }

          const smsRes = await sendFreeSms({
            phone: it.phone,
            message,
            ticketNo: it.billNo,
            amount: parseFloat(it.interestDue) || 0,
            type: 'REMINDER',
            branchId: it.branchId || session.branchId || 'HQ'
          });

          if (smsRes.success) sentCount++;
          else failedCount++;

          results.push({
            billNo: it.billNo,
            phone: it.phone,
            status: smsRes.status
          });
        } catch (smsErr) {
          failedCount++;
        }
      }

      await recordAuditLog(session, {
        action: 'FORFEITURE_BULK_SMS',
        resource: 'forfeiture:bulk_sms',
        details: {
          totalSelected: items.length,
          sentCount,
          failedCount,
          skippedNoPhone,
          hasCustomTemplate: Boolean(customTemplate)
        }
      });

      return NextResponse.json({
        success: true,
        sentCount,
        failedCount,
        skippedNoPhone,
        totalProcessed: items.length,
        results
      });
    }

    // Action 3: Mark Item as Forfeited (Move to F/S Inventory)
    if (action === 'MARK_FORFEITED') {
      const { itemId, billNo, branchId, notes } = body;
      if (!itemId && !billNo) {
        return NextResponse.json({ error: 'itemId or billNo is required.' }, { status: 400 });
      }
      if (!itemId && !branchId) {
        return NextResponse.json({ error: 'branchId is required when forfeiting by billNo without itemId.' }, { status: 400 });
      }

      const finalNotes = notes || 'F/S (Forfeited Collateral transferred to auction due to expired period)';
      const nowIso = new Date().toISOString();

      // Lookup target stock item first to get authoritative branch_id & bill_no
      let stockLookup = adminSupabase.from('stock_items').select('id, bill_no, branch_id');
      if (itemId) {
        stockLookup = stockLookup.eq('id', itemId);
      } else {
        stockLookup = stockLookup.eq('bill_no', billNo).in('branch_id', getBranchSearchTerms(String(branchId)));
      }
      const { data: targetStockRows, error: lookupErr } = await stockLookup.limit(2);
      if (lookupErr) throw lookupErr;
      if (!targetStockRows || targetStockRows.length === 0) {
        return NextResponse.json({ error: 'Stock item not found for forfeiture.' }, { status: 404 });
      }
      const targetStock = targetStockRows[0];
      const effectiveBranch = normalizeBranchId(String(targetStock.branch_id || branchId || ''));
      const effectiveBillNo = String(targetStock.bill_no || billNo || '').trim();

      // 1. Update stock_items status to Withdrawn with reason F/S
      const { error: stockErr } = await adminSupabase
        .from('stock_items')
        .update({
          status: 'Withdrawn',
          withdrawal_reason: 'F/S',
          withdrawal_date: nowIso.split('T')[0],
          withdrawal_notes: finalNotes
        })
        .eq('id', targetStock.id);
      if (stockErr) throw stockErr;

      // 2. If pawn exists in the SAME branch, update matching pawn status to FORFEITED
      if (effectiveBillNo && effectiveBranch) {
        const branchTerms = getBranchSearchTerms(effectiveBranch);
        const numericBill = extractNumericBillNo(effectiveBillNo);
        const { data: candidatePawns, error: pFetchErr } = await adminSupabase
          .from('pawns')
          .select('id, bill_no, description, branch_id')
          .in('branch_id', branchTerms)
          .ilike('bill_no', `%${numericBill || stripBranchPrefix(effectiveBillNo)}%`)
          .limit(50);

        if (pFetchErr) {
          console.warn('Forfeiture pawn lookup warning:', pFetchErr.message);
        } else {
          const matchingPawnIds = (candidatePawns || [])
            .filter((p: any) =>
              normalizeBranchId(p.branch_id) === effectiveBranch &&
              isSameNumericBill(p.bill_no || p.description, effectiveBillNo)
            )
            .map((p: any) => p.id);

          if (matchingPawnIds.length > 0) {
            const { error: pUpdErr } = await adminSupabase
              .from('pawns')
              .update({
                status: 'FORFEITED',
                description: `${finalNotes}`
              })
              .in('id', matchingPawnIds);
            if (pUpdErr) {
              console.warn('Forfeiture pawn update warning:', pUpdErr.message);
            }
          }
        }
      }

      if (effectiveBranch) {
        await invalidateBranchInventoryCache(effectiveBranch).catch(() => {});
      }

      await recordAuditLog(session, {
        action: 'STOCK_WITHDRAW',
        resource: `stock:${effectiveBillNo || targetStock.id}`,
        details: {
          itemId: targetStock.id,
          billNo: effectiveBillNo,
          branchId: effectiveBranch || branchId,
          reason: 'F/S',
          notes: finalNotes
        }
      });

      return NextResponse.json({
        success: true,
        message: `Item #${effectiveBillNo || targetStock.id} marked as Forfeited (F/S) successfully.`
      });
    }

    return NextResponse.json({ error: 'Invalid action provided.' }, { status: 400 });
  } catch (err: any) {
    console.error('Forfeiture POST error:', err);
    return NextResponse.json({ error: err.message || 'Failed to process forfeiture action' }, { status: 500 });
  }
}
