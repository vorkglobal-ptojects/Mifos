import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { recordAuditLog } from '@/lib/audit-logger';
import { sendFreeSms, buildPawnReceiptSms } from '@/lib/sms';
import { normalizeBranchId, getBranchSearchTerms, isNationalId, normalizeNationalId, formatBranchScopedId, formatBranchScopedBillNo, stripBranchPrefix, extractNumericBillNo, isSameNumericBill } from '@/lib/branch-mapping';
import { invalidateBranchInventoryCache } from '@/lib/redis';
import { invalidateClientsCache } from '@/app/api/clients/route';
import { getSriLankaDate } from '@/lib/date-utils';

export const dynamic = 'force-dynamic';

const isUUID = (str: string) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(str);
const HIGH_VALUE_APPROVAL_THRESHOLD = 100000; // Rs. 100,000 dual approval threshold

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const filterBranch = searchParams.get('filterBranch');
    const branchIdParam = searchParams.get('branchId');
    const rawBranch = (filterBranch && filterBranch !== '') ? filterBranch : branchIdParam;

    // Parse requested branches (e.g. "BOR" or "BOR,KHT" or "ALL")
    let branchTokens = rawBranch
      ? rawBranch.split(',').map(b => b.trim()).filter(Boolean)
      : [];

    // Enforce branch isolation for tellers and non-global branch staff:
    // A user logged into a branch (e.g. Panadura PND) can ONLY see that branch's pawns.
    // Admin, Auditor, or HQ staff can view all branches or specific selected branches.
    const userRole = (session.role || 'TELLER').toUpperCase();
    const isGlobalManager = ['ADMIN', 'AUDITOR'].includes(userRole) && (!session.branchId || session.branchId === 'HQ' || session.branchId === 'DHW' || session.branchId === 'ALL');

    if (!isGlobalManager && session.branchId && session.branchId !== 'HQ' && session.branchId !== 'DHW' && session.branchId !== 'ALL') {
      branchTokens = [session.branchId];
    } else if (branchTokens.length === 0) {
      if (session.branchId && session.branchId !== 'HQ' && session.branchId !== 'DHW' && session.branchId !== 'ALL') {
        branchTokens = [session.branchId];
      } else {
        branchTokens = ['HQ'];
      }
    }

    let query = adminSupabase.from('pawns').select('*').order('created_at', { ascending: false });

    // Filter by branch if specific branches are selected (not ALL)
    if (!branchTokens.includes('ALL') && branchTokens.length > 0) {
      const allTerms = branchTokens.flatMap(b => getBranchSearchTerms(b));
      if (allTerms.length > 0) {
        const orClause = allTerms.map(t => `branch_id.ilike.%${t}%`).join(',');
        query = query.or(orClause);
      }
    }

    const searchFilter = searchParams.get('search');
    if (searchFilter && searchFilter.trim() !== '') {
      const rawQ = searchFilter.trim();
      const cleanQ = rawQ.replace(/[,()"]/g, ' ').trim();
      if (cleanQ) {
        const strippedQ = stripBranchPrefix(cleanQ);
        query = query.or(`bill_no.ilike.%${cleanQ}%,bill_no.ilike.%${strippedQ}%,description.ilike.%${cleanQ}%`);
      }
    }

    const { data, error } = await query;
    if (error) throw error;

    const clientIds = Array.from(new Set((data || []).map((p: any) => p.client_id).filter(Boolean)));
    const pawnIds = (data || []).map((p: any) => p.id).filter(Boolean);
    const billStatuses = Array.from(new Set((data || []).map((p: any) => p.bill_no ? `BILL:${p.bill_no.trim()}` : null).filter(Boolean))) as string[];

    // Execute all subqueries in PARALLEL with Promise.all and lightweight column selections
    // This avoids downloading megabytes of base64 images per client/eval on every list call
    const [
      clientRowsRes,
      nicClientsRes,
      sigClientsRes,
      allItemsRes,
      evalsRes,
      evalsAirPhotosRes,
      evalsWaterPhotosRes,
      packetLogsRes
    ] = await Promise.all([
      // 1a. Fast client basic fields (no heavy base64 strings)
      clientIds.length > 0
        ? adminSupabase.from('clients').select('id, first_name, last_name, national_id, phone, address').in('id', clientIds)
        : Promise.resolve({ data: [] }),

      // 1b. Fast presence check for NIC image (returns only id)
      clientIds.length > 0
        ? adminSupabase.from('clients').select('id').in('id', clientIds).not('nic_image', 'is', null)
        : Promise.resolve({ data: [] }),

      // 1c. Fast presence check for Signature (returns only id)
      clientIds.length > 0
        ? adminSupabase.from('clients').select('id').in('id', clientIds).not('signature_image', 'is', null)
        : Promise.resolve({ data: [] }),

      // 2. Fetch pawn items for current pawns
      pawnIds.length > 0
        ? adminSupabase.from('pawn_items').select('*').in('pawn_id', pawnIds)
        : Promise.resolve({ data: [] }),

      // 3a. Egress optimization: Fetch scale evaluation numbers without multi-megabyte base64 photos
      billStatuses.length > 0
        ? adminSupabase.from('rejected_evaluations').select('status, air_weight, water_weight, created_at').in('status', billStatuses)
        : Promise.resolve({ data: [] }),

      // 3b. Fast presence check for Air Weight photo (returns only status)
      billStatuses.length > 0
        ? adminSupabase.from('rejected_evaluations').select('status').in('status', billStatuses).not('air_weight_photo_url', 'is', null)
        : Promise.resolve({ data: [] }),

      // 3c. Fast presence check for Water Weight photo (returns only status)
      billStatuses.length > 0
        ? adminSupabase.from('rejected_evaluations').select('status').in('status', billStatuses).not('water_weight_photo_url', 'is', null)
        : Promise.resolve({ data: [] }),

      // 4. Fetch packet sticker QR logs (scoped to active branches)
      (() => {
        let stickerQ = adminSupabase
          .from('audit_logs')
          .select('resource, details, action, branch_id')
          .in('action', ['PACKET_STICKER_ATTACHED', 'PACKET_STICKER_DELETED'])
          .order('created_at', { ascending: false })
          .limit(300);

        if (!branchTokens.includes('ALL') && branchTokens.length > 0) {
          stickerQ = stickerQ.in('branch_id', branchTokens);
        }
        return stickerQ;
      })()
    ]);

    // Map clients with lightweight boolean indicators for NIC and Signature
    const hasNicSet = new Set((nicClientsRes.data || []).map((c: any) => c.id));
    const hasSigSet = new Set((sigClientsRes.data || []).map((c: any) => c.id));
    const clientsByIdMap: Record<string, any> = {};

    if (clientRowsRes.data) {
      clientRowsRes.data.forEach((c: any) => {
        const clientObj = {
          ...c,
          nic_image: hasNicSet.has(c.id) ? '{"front":"captured"}' : null,
          signature_image: hasSigSet.has(c.id) ? 'captured' : null
        };
        clientsByIdMap[c.id] = clientObj;
        if (c.nationalId) clientsByIdMap[c.nationalId] = clientObj;
        if (c.national_id) clientsByIdMap[c.national_id] = clientObj;
      });
    }

    // Map pawn items
    const itemsMap: Record<string, any[]> = {};
    if (allItemsRes.data) {
      allItemsRes.data.forEach((item: any) => {
        if (!itemsMap[item.pawn_id]) itemsMap[item.pawn_id] = [];
        itemsMap[item.pawn_id].push(item);
      });
    }

    // Map scale evaluation records with presence indicators
    const hasAirPhotoSet = new Set((evalsAirPhotosRes.data || []).map((ev: any) => ev.status));
    const hasWaterPhotoSet = new Set((evalsWaterPhotosRes.data || []).map((ev: any) => ev.status));
    const evalsByBillMap: Record<string, any> = {};
    if (evalsRes.data) {
      evalsRes.data.forEach((ev: any) => {
        if (ev.status && ev.status.startsWith('BILL:')) {
          const bNo = ev.status.replace('BILL:', '').trim();
          const hasAir = hasAirPhotoSet.has(ev.status);
          const hasWater = hasWaterPhotoSet.has(ev.status);
          const evObj = {
            ...ev,
            air_weight_photo_url: hasAir ? 'present' : null,
            water_weight_photo_url: hasWater ? 'present' : null,
            has_air_photo: hasAir,
            has_water_photo: hasWater
          };
          evalsByBillMap[bNo] = evObj;
          evalsByBillMap[bNo.toUpperCase()] = evObj;
          evalsByBillMap[bNo.replace(/\s+/g, '')] = evObj;
          evalsByBillMap[bNo.replace(/\s+/g, '').toUpperCase()] = evObj;
        }
      });
    }

    // Map packet sticker QR codes
    const packetQrByPawnIdMap: Record<string, string | null> = {};
    const packetQrByBranchBillMap: Record<string, string | null> = {};
    const packetQrByBillMap: Record<string, string | null> = {};

    if (packetLogsRes.data) {
      packetLogsRes.data.forEach((l: any) => {
        const b = (l.resource || l.details?.bill_no || '').trim();
        const pawnId = l.details?.pawn_id;
        const branch = (l.branch_id || l.details?.branch_id || '').trim();

        if (l.action === 'PACKET_STICKER_DELETED') {
          if (pawnId) packetQrByPawnIdMap[pawnId] = null;
          if (branch && b) {
            packetQrByBranchBillMap[`${branch}::${b}`] = null;
            packetQrByBranchBillMap[`${branch}::${b.toUpperCase()}`] = null;
          }
          if (b) {
            packetQrByBillMap[b] = null;
            packetQrByBillMap[b.toUpperCase()] = null;
          }
        } else if (l.action === 'PACKET_STICKER_ATTACHED' && l.details?.packet_qr) {
          const qrVal = l.details.packet_qr;
          if (pawnId) packetQrByPawnIdMap[pawnId] = qrVal;
          if (branch && b) {
            packetQrByBranchBillMap[`${branch}::${b}`] = qrVal;
            packetQrByBranchBillMap[`${branch}::${b.toUpperCase()}`] = qrVal;
          }
          if (b) {
            packetQrByBillMap[b] = qrVal;
            packetQrByBillMap[b.toUpperCase()] = qrVal;
          }
        }
      });
    }

    const mappedData = (data || []).map((pawn: any) => {
       const pItems = itemsMap[pawn.id] || [];
       let totalWeight = (parseFloat(pawn.weight_grams) || 0) + ((parseFloat(pawn.weight_mg) || 0) / 1000);
       if (totalWeight === 0 && pItems.length > 0) {
           pItems.forEach((item: any) => {
               totalWeight += (parseFloat(item.weight_grams) || 0) + ((parseFloat(item.weight_mg) || 0) / 1000);
           });
       }
       pawn.weight = totalWeight;
       pawn.items = pItems;
       
       if (!pawn.clients && pawn.client_id && clientsByIdMap[pawn.client_id]) {
         pawn.clients = clientsByIdMap[pawn.client_id];
       }

       // Attach scale evaluation photos by bill number
       const cleanBill = (pawn.bill_no || '').trim();
       const descMatch = (pawn.description || '').match(/^([A-Za-z0-9]+)\s+([0-9]+)/);
       const altBill = descMatch ? `${descMatch[1]} ${descMatch[2]}` : '';
       const idBill = pawn.id ? pawn.id.substring(0, 8).toUpperCase() : '';

       const matchedEval = cleanBill ? (
         evalsByBillMap[cleanBill] ||
         evalsByBillMap[cleanBill.toUpperCase()] ||
         evalsByBillMap[cleanBill.replace(/\s+/g, '')] ||
         evalsByBillMap[cleanBill.replace(/\s+/g, '').toUpperCase()]
       ) : (
         altBill ? (evalsByBillMap[altBill] || evalsByBillMap[altBill.replace(/\s+/g, '')]) :
         evalsByBillMap[idBill]
       );

       if (matchedEval) {
         pawn.air_weight_photo_url = matchedEval.air_weight_photo_url;
         pawn.water_weight_photo_url = matchedEval.water_weight_photo_url;
         pawn.evaluation_air_weight = matchedEval.air_weight;
         pawn.evaluation_water_weight = matchedEval.water_weight;
       }

       // Strict Branch & Pawn-ID Isolation:
        // 1. Direct UUID match (guaranteed unique per pawn record)
        // 2. Branch-scoped bill key (branch_id + "::" + bill_no)
        // 3. Fallback to direct column or legacy un-scoped map
        const branchKey = `${pawn.branch_id || ''}::${cleanBill}`;
        const branchKeyUpper = `${pawn.branch_id || ''}::${cleanBill.toUpperCase()}`;

        if (pawn.id && packetQrByPawnIdMap[pawn.id] !== undefined) {
          pawn.packet_qr = packetQrByPawnIdMap[pawn.id];
        } else if (pawn.branch_id && packetQrByBranchBillMap[branchKey] !== undefined) {
          pawn.packet_qr = packetQrByBranchBillMap[branchKey];
        } else if (pawn.branch_id && packetQrByBranchBillMap[branchKeyUpper] !== undefined) {
          pawn.packet_qr = packetQrByBranchBillMap[branchKeyUpper];
        } else if (pawn.packet_qr !== undefined && pawn.packet_qr !== null) {
          pawn.packet_qr = pawn.packet_qr;
        } else if (packetQrByBillMap[cleanBill] === null || packetQrByBillMap[cleanBill.toUpperCase()] === null) {
          pawn.packet_qr = null;
        } else {
          pawn.packet_qr = packetQrByBillMap[cleanBill] || packetQrByBillMap[cleanBill.toUpperCase()] || null;
        }

        pawn.display_bill_no = stripBranchPrefix(pawn.bill_no);
        return pawn;
    });

    return NextResponse.json(mappedData);
  } catch (error: any) {
    console.error('Pawns GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Active login session is required to create a pawn ticket.' }, { status: 401 });
    }

    const body = await request.json();
    const { clientId, clientName, customerName, phone: clientPhone, address: clientAddress, description, appraisedValue, trueValue, disbursedAmount, branchId, createdByUserId, billNo, weight, weightGrams, weightMg, interestRate, periodMonths, itemType, items, date, airWeightPhoto, waterWeightPhoto, waterWeight, specificGravity, estimatedKarat } = body;

    if (!clientId || !disbursedAmount || !billNo || String(billNo).trim() === '') {
      return NextResponse.json({ error: 'Missing required fields: Customer, Disbursed Amount, and Bill Number (billNo)' }, { status: 400 });
    }

    if (session.role === 'AUDITOR') {
      return NextResponse.json({ error: 'Forbidden. Auditors are not permitted to originate loans.' }, { status: 403 });
    }

    // Determine target branch & user ID strictly from verified session
    let targetBranchId = normalizeBranchId(session.branchId || 'HQ');
    const targetUserId = session.user.id;

    if (session.role === 'ADMIN') {
      if (branchId) {
        targetBranchId = normalizeBranchId(branchId);
      }
    } else {
      // TELLER or MANAGER: strictly bound to session branch
      const normReq = normalizeBranchId(branchId);
      const normSess = normalizeBranchId(session.branchId);
      if (branchId && normReq !== normSess) {
        return NextResponse.json({ error: 'Forbidden. You cannot create pawn tickets for another branch.' }, { status: 403 });
      }
      targetBranchId = normSess;
    }

    // 1. Resolve valid Client UUID (with branch scoping for book ledger IDs)
    let targetClientId = clientId;
    let fullClientObj: any = null;

    if (!isUUID(clientId)) {
      const trimmedId = String(clientId).trim();
      const isGovId = isNationalId(trimmedId);
      const effectiveLookupId = isGovId ? normalizeNationalId(trimmedId) : formatBranchScopedId(trimmedId, targetBranchId);
      const cleanLookup = String(effectiveLookupId || '').replace(/[,()"]/g, '').trim();
      const cleanTrimmed = String(trimmedId || '').replace(/[,()"]/g, '').trim();
      const cleanBranch = String(targetBranchId || '').replace(/[,()"]/g, '').trim();

      let existingClients = null;
      let snakeQuery = adminSupabase.from('clients').select('*');
      if (isGovId) {
        snakeQuery = snakeQuery.or(`national_id.eq."${cleanLookup}",national_id.ilike."%${cleanTrimmed}%"`);
      } else {
        snakeQuery = snakeQuery.or(`national_id.eq."${cleanLookup}",and(national_id.eq."${cleanTrimmed}",branch_id.eq."${cleanBranch}")`);
      }
      const { data: snakeExisting } = await snakeQuery.limit(1);

      if (snakeExisting && snakeExisting.length > 0) {
        existingClients = snakeExisting;
      } else {
        let camelQuery = adminSupabase.from('clients').select('*');
        if (isGovId) {
          camelQuery = camelQuery.or(`nationalId.eq."${cleanLookup}",nationalId.ilike."%${cleanTrimmed}%"`);
        } else {
          camelQuery = camelQuery.or(`nationalId.eq."${cleanLookup}",and(nationalId.eq."${cleanTrimmed}",branchId.eq."${cleanBranch}")`);
        }
        const { data: camelExisting } = await camelQuery.limit(1);
        if (camelExisting && camelExisting.length > 0) {
          existingClients = camelExisting;
        }
      }

      if (existingClients && existingClients.length > 0) {
        targetClientId = existingClients[0].id;
        fullClientObj = existingClients[0];
        
        // Update client info if provided
        if (clientPhone || clientAddress) {
          const updateClient: any = {};
          if (clientPhone && clientPhone !== fullClientObj.phone) updateClient.phone = clientPhone;
          if (clientAddress && clientAddress !== fullClientObj.address) updateClient.address = clientAddress;
          
          if (Object.keys(updateClient).length > 0) {
            const { data: updatedClient, error: updateErr } = await adminSupabase
              .from('clients')
              .update(updateClient)
              .eq('id', targetClientId)
              .select()
              .single();
            if (updatedClient && !updateErr) {
              fullClientObj = updatedClient;
            }
          }
        }
      } else {
        // Auto-create client profile if missing
        const newClientId = crypto.randomUUID();
        const clientPayload: any = {
          id: newClientId,
          national_id: effectiveLookupId,
          first_name: (clientName && clientName.trim() !== '' && clientName !== 'Valued Customer') 
            ? clientName.trim() 
            : (customerName && customerName.trim() !== '' && customerName !== 'Valued Customer') 
              ? customerName.trim() 
              : 'Valued Customer',
          last_name: '.',
          phone: clientPhone || null,
          address: clientAddress || null,
          branch_id: targetBranchId,
          created_by_user_id: targetUserId,
          status: 'ACTIVE',
          created_at: new Date().toISOString()
        };
        const { data: createdClient, error: createErr } = await adminSupabase.from('clients').insert([clientPayload]).select().single();
        if (!createErr && createdClient) {
          targetClientId = createdClient.id;
          fullClientObj = createdClient;
        } else {
          console.error("Auto-client creation failed:", createErr);
        }
      }
      if (targetClientId) {
        invalidateClientsCache();
      }
    }

    const pawnId = crypto.randomUUID();
    const finalDisbursed = parseFloat(disbursedAmount) || 0;
    const finalAppraised = parseFloat(trueValue) || parseFloat(appraisedValue) || finalDisbursed;
    let finalWeightGrams = parseFloat(weightGrams) || parseFloat(weight) || 0;
    let finalWeightMg = parseFloat(weightMg) || 0;

    // Weight Normalization: If mg < 50 and mg > 0, user typed grams into mg field (e.g. 4.02)
    if (finalWeightMg > 0 && finalWeightMg < 50) {
      finalWeightGrams = finalWeightMg;
      finalWeightMg = Math.round(finalWeightGrams * 1000);
    } else if (finalWeightMg >= 50 && (!finalWeightGrams || finalWeightGrams <= 0)) {
      finalWeightGrams = parseFloat((finalWeightMg / 1000).toFixed(4));
    } else if (finalWeightGrams > 0 && (!finalWeightMg || finalWeightMg <= 0)) {
      finalWeightMg = Math.round(finalWeightGrams * 1000);
    }

    const finalInterestRate = parseFloat(interestRate) || 3.50;
    const finalPeriodMonths = parseInt(periodMonths, 10) || 3;
    const todaySriLanka = getSriLankaDate();
    const pawnDate = (date && String(date).trim()) ? String(date).trim() : todaySriLanka;

    // Determine accurate creation timestamp (prevent artificial 12:00:00Z / 5:30 PM)
    let pawnCreatedAt: string;
    if (date && String(date).includes('T')) {
      pawnCreatedAt = new Date(date).toISOString();
    } else if (pawnDate === todaySriLanka) {
      pawnCreatedAt = new Date().toISOString();
    } else if (date) {
      const now = new Date();
      const timePart = now.toISOString().split('T')[1];
      pawnCreatedAt = `${pawnDate}T${timePart}`;
    } else {
      pawnCreatedAt = new Date().toISOString();
    }

    // Determine initial pawn status (High-ValuePawns > Rs. 100,000 require Manager Approval)
    const initialStatus = finalDisbursed > HIGH_VALUE_APPROVAL_THRESHOLD ? 'PENDING_APPROVAL' : 'ACTIVE';

    const rawBillInput = stripBranchPrefix(String(billNo || '')).trim();
    if (!rawBillInput || /^REC-/i.test(rawBillInput) || /^TEMP-/i.test(rawBillInput) || /^[0-9A-F]{8}$/i.test(rawBillInput)) {
      return NextResponse.json({ error: "Valid Book Bill / Ticket Number is required (e.g. 1R 23001, 3R 15400, 12R 37611)" }, { status: 400 });
    }

    // Validate numeric bill uniqueness within the same branch only
    const numericPart = extractNumericBillNo(billNo);
    if (numericPart) {
      const branchTerms = getBranchSearchTerms(targetBranchId);

      const { data: existingPawns } = await adminSupabase
        .from('pawns')
        .select('id, bill_no, description, branch_id')
        .in('branch_id', branchTerms)
        .ilike('bill_no', `%${numericPart}%`)
        .limit(20);

      const hasDuplicatePawn = (existingPawns || []).some((p: any) => 
        isSameNumericBill(p.bill_no || p.description, billNo)
      );

      if (hasDuplicatePawn) {
        return NextResponse.json({
          error: `Duplicate Bill Number: Bill number ${numericPart} already exists in ${targetBranchId} branch.`
        }, { status: 400 });
      }

      const { data: existingStock } = await adminSupabase
        .from('stock_items')
        .select('id, bill_no, branch_id')
        .in('branch_id', branchTerms)
        .ilike('bill_no', `%${numericPart}%`)
        .limit(20);

      const hasDuplicateStock = (existingStock || []).some((s: any) => 
        isSameNumericBill(s.bill_no, billNo)
      );

      if (hasDuplicateStock) {
        return NextResponse.json({
          error: `Duplicate Bill Number: Bill number ${numericPart} already exists in ${targetBranchId} branch.`
        }, { status: 400 });
      }
    }

    // Format bill_no with branch prefix behind the scenes (e.g. "KDW-3R 14543")
    const scopedBillNo = formatBranchScopedBillNo(billNo, targetBranchId);

    // 2. Insert pawn ticket into DB
    const pawnPayload: any = {
      id: pawnId,
      client_id: targetClientId,
      description: description || `${finalPeriodMonths}M Pawn Ticket`,
      appraised_value: finalAppraised,
      disbursed_amount: finalDisbursed,
      branch_id: targetBranchId,
      created_by_user_id: targetUserId,
      status: initialStatus,
      created_at: pawnCreatedAt,
      bill_no: scopedBillNo || null,
      weight_grams: finalWeightGrams,
      weight_mg: finalWeightMg,
      interest_rate: finalInterestRate,
      period_months: finalPeriodMonths
    };

    const { data: newPawn, error: pawnErr } = await adminSupabase
      .from('pawns')
      .insert([pawnPayload])
      .select()
      .single();

    if (pawnErr) throw pawnErr;

    // Record Air Weight & Water Weight evaluation photos linked to the bill number
    const targetBill = scopedBillNo || billNo;
    if (targetBill && (airWeightPhoto || waterWeightPhoto)) {
      try {
        const computedAirWeight = finalWeightGrams > 0 ? finalWeightGrams : (finalWeightMg > 0 ? finalWeightMg / 1000 : 0);
        await adminSupabase.from('rejected_evaluations').insert([{
          air_weight: computedAirWeight,
          water_weight: parseFloat(waterWeight) || 0,
          specific_gravity: parseFloat(specificGravity) || 0,
          estimated_karat: estimatedKarat || '22K',
          asking_amount: finalDisbursed,
          true_value: finalAppraised,
          status: `BILL:${targetBill}`,
          air_weight_photo_url: airWeightPhoto || null,
          water_weight_photo_url: waterWeightPhoto || null,
        }]);
      } catch (evalErr) {
        console.warn("Could not insert evaluation photos for bill:", evalErr);
      }
    }

    // 3. Insert pawn collateral items into pawn_items and a single consolidated stock_item (Option 1)
    let cleanBillNo = stripBranchPrefix(billNo || '').trim();
    if (!cleanBillNo || cleanBillNo.startsWith('REC-') || cleanBillNo.startsWith('TEMP-')) {
      const descMatch = (description || '').match(/^([A-Za-z0-9]+\s+[0-9A-Za-z]+)\s*\|?\s*(.*)/);
      if (descMatch && descMatch[1]) {
        cleanBillNo = stripBranchPrefix(descMatch[1].trim());
      }
    }
    const baseBill = (cleanBillNo || stripBranchPrefix(scopedBillNo || '')).trim();

    if (Array.isArray(items) && items.length > 0) {
      const pawnItemsPayload = items.map((item: any) => {
        let itemMg = parseFloat(item.weightMg || item.weight_mg) || 0;
        let itemGrams = parseFloat(item.weightGrams || item.weight_grams) || 0;
        if (itemMg > 0 && itemMg < 50) {
          itemGrams = itemMg;
          itemMg = Math.round(itemGrams * 1000);
        } else if (itemMg >= 50) {
          itemGrams = parseFloat((itemMg / 1000).toFixed(4));
        } else if (itemGrams > 0) {
          itemMg = Math.round(itemGrams * 1000);
        }
        const itemAppraised = parseFloat(item.appraisedValue || item.appraised_value) || (finalAppraised / items.length);
        const rawType = item.itemType || item.item_type || itemType || 'Gold';
        const customText = item.customType || item.description || '';
        const itemTypeLabel = (rawType === 'OTHER' || rawType === 'Other') ? (customText || 'Other Gold Item') : rawType;
        const itemDescText = customText || itemTypeLabel;

        return {
          id: crypto.randomUUID(),
          pawn_id: pawnId,
          item_type: itemTypeLabel,
          purity: item.purity || '22K',
          weight_grams: itemGrams,
          weight_mg: itemMg,
          appraised_value: itemAppraised,
          description: `${itemDescText} (${baseBill})`
        };
      });

      let { error: itemsErr } = await adminSupabase.from('pawn_items').insert(pawnItemsPayload);
      if (itemsErr && itemsErr.message?.includes('purity')) {
        const fallbackPayload = pawnItemsPayload.map(({ purity, ...rest }: any) => rest);
        const retryRes = await adminSupabase.from('pawn_items').insert(fallbackPayload);
        itemsErr = retryRes.error;
      }

      if (itemsErr) {
        // Rollback created pawn so database is never left with an orphaned pawn without collateral
        await adminSupabase.from('pawns').delete().eq('id', pawnId);
        throw new Error(`Failed to save pawn collateral items: ${itemsErr.message}`);
      }

      // Create a SINGLE consolidated vault stock item for the entire pawn ticket (Option 1)
      const totalWeightGrams = pawnItemsPayload.reduce((sum: number, it: any) => sum + (it.weight_grams || 0), 0) || finalWeightGrams;
      
      const itemCodes = items.map((item: any) => {
        const rawType = item.itemType || item.item_type || itemType || 'CH';
        const is18K = item.purity === '18K' || String(item.purity || '').toUpperCase().startsWith('18');
        return (rawType === 'OTHER' || rawType === 'Other') 
          ? (item.customType || 'OTHER') 
          : (is18K ? `18K-${rawType}` : rawType);
      });
      const combinedItemType = itemCodes.join(', ');

      const singleStockPayload = {
        id: crypto.randomUUID(),
        bill_no: baseBill,
        branch_id: targetBranchId,
        item_type: combinedItemType || 'CH',
        weight: totalWeightGrams,
        price: finalDisbursed || finalAppraised,
        status: 'Active',
        date: pawnDate,
        created_at: pawnCreatedAt
      };

      const { error: stockErr } = await adminSupabase
        .from('stock_items')
        .upsert([singleStockPayload], { onConflict: 'branch_id, bill_no' });

      if (stockErr) {
        console.warn("Could not upsert matching vault stock item, retrying with fallback:", stockErr.message);
        const { data: existingStock } = await adminSupabase
          .from('stock_items')
          .select('id')
          .eq('branch_id', targetBranchId)
          .eq('bill_no', baseBill)
          .maybeSingle();

        if (existingStock) {
          await adminSupabase.from('stock_items').update({
            item_type: singleStockPayload.item_type,
            weight: singleStockPayload.weight,
            price: singleStockPayload.price,
            status: 'Active',
            date: pawnDate
          }).eq('id', existingStock.id);
        } else {
          await adminSupabase.from('stock_items').insert([singleStockPayload]);
        }
      }
    } else {
      // Single default collateral item when items array is empty (guarantees pawn_items is NEVER missing)
      const singleItemPayload = {
        id: crypto.randomUUID(),
        pawn_id: pawnId,
        item_type: (itemType === 'OTHER' || itemType === 'Other') ? 'OTHER' : (itemType || 'Gold'),
        purity: '22K',
        weight_grams: finalWeightGrams,
        weight_mg: finalWeightMg,
        appraised_value: finalAppraised,
        description: description || `${itemType || 'Gold'} Collateral (${baseBill})`
      };

      let { error: singleItemErr } = await adminSupabase.from('pawn_items').insert([singleItemPayload]);
      if (singleItemErr && singleItemErr.message?.includes('purity')) {
        const { purity, ...withoutPurity } = singleItemPayload;
        const retryRes = await adminSupabase.from('pawn_items').insert([withoutPurity]);
        singleItemErr = retryRes.error;
      }

      if (singleItemErr) {
        await adminSupabase.from('pawns').delete().eq('id', pawnId);
        throw new Error(`Failed to save pawn collateral item: ${singleItemErr.message}`);
      }

      // Single default stock item
      let defaultCode = (itemType === 'OTHER' || itemType === 'Other') ? 'OTHER' : (itemType || '');
      if (!defaultCode) {
        const d = (description || '').toUpperCase();
        if (d.includes('RING') || d.includes('මුදුව') || d.includes('මුද්ද')) defaultCode = 'PR';
        else if (d.includes('CHAIN') || d.includes('මාලය')) defaultCode = 'CH';
        else if (d.includes('PENDANT') || d.includes('පෙන්ඩන්ට්')) defaultCode = 'PP';
        else if (d.includes('EARRING') || d.includes('කරාබු')) defaultCode = 'EAR';
        else if (d.includes('BRACELET') || d.includes('බ්‍රේස්ලට්')) defaultCode = 'BRC';
        else if (d.includes('BANGLE') || d.includes('වළලු')) defaultCode = 'PB';
        else defaultCode = 'CH';
      }

      const singleStockPayload = {
        id: crypto.randomUUID(),
        bill_no: baseBill,
        branch_id: targetBranchId,
        item_type: defaultCode,
        weight: finalWeightGrams,
        price: finalDisbursed || finalAppraised,
        status: 'Active',
        date: pawnDate,
        created_at: pawnCreatedAt
      };

      const { error: singleStockErr } = await adminSupabase.from('stock_items').upsert([singleStockPayload], { onConflict: 'branch_id, bill_no' });
      if (singleStockErr) {
        console.warn("Could not insert matching vault stock item, retrying with fallback:", singleStockErr.message);
        const { data: existingStock } = await adminSupabase
          .from('stock_items')
          .select('id')
          .eq('branch_id', targetBranchId)
          .eq('bill_no', baseBill)
          .maybeSingle();

        if (existingStock) {
          await adminSupabase.from('stock_items').update({
            item_type: singleStockPayload.item_type,
            weight: singleStockPayload.weight,
            price: singleStockPayload.price,
            status: 'Active',
            date: pawnDate
          }).eq('id', existingStock.id);
        } else {
          await adminSupabase.from('stock_items').insert([singleStockPayload]);
        }
      }
    }

    // Invalidate affected branch inventory Redis cache
    try {
      await invalidateBranchInventoryCache(targetBranchId);
    } catch (cacheErr) {
      console.warn('[Cache Invalidation Warning]:', cacheErr);
    }

    await recordAuditLog(session, {
      action: 'ORIGINATE_PAWN',
      resource: 'pawns',
      branchId: targetBranchId,
      userId: targetUserId,
      details: { pawnId, disbursedAmount: finalDisbursed, billNo, clientId: targetClientId }
    });

    // 4b. Post Automated Double-Entry General Ledger Entry for standard loans (<= 100k)
    if (initialStatus === 'ACTIVE' && finalDisbursed > 0) {
      try {
        const jeId = `JE-AUTO-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
        const dateStr = getSriLankaDate();
        const pawnRef = scopedBillNo || billNo || pawnId.substring(0, 8).toUpperCase();

        const { error: jeErr } = await adminSupabase.from('journal_entry').insert([{
          id: jeId,
          date: dateStr,
          description: `Automated Posting - Originated Pawn: ${description || `${finalPeriodMonths}M Pawn Ticket`}`,
          reference: `PAWN-${pawnRef}`,
          total_debit: finalDisbursed,
          total_credit: finalDisbursed,
          created_by: session?.user?.email || targetUserId || 'Teller'
        }]);

        if (!jeErr) {
          await adminSupabase.from('journal_entry_line').insert([
            {
              journal_entry_id: jeId,
              account_name: 'Pawn Loan Portfolio (Asset)',
              debit: finalDisbursed,
              credit: 0
            },
            {
              journal_entry_id: jeId,
              account_name: 'Vault Cash (Asset)',
              debit: 0,
              credit: finalDisbursed
            }
          ]);
        }
      } catch (glErr) {
        console.warn('Standard pawn GL automated posting warning (non-fatal):', glErr);
      }
    }

    // 5. Trigger CCTV evidence recording request for active branch cameras
    try {
      const cctvPawnId = billNo || pawnId;
      const { data: branchCams } = await adminSupabase
        .from('cctv_cameras')
        .select('*')
        .eq('branch_id', targetBranchId)
        .eq('is_active', true);

      if (branchCams && branchCams.length > 0) {
        const cctvPayloads = branchCams.map((cam: any) => ({
          id: `REC-${cctvPawnId}-${cam.id}-${Date.now()}`,
          branch_id: targetBranchId,
          camera_id: cam.id,
          pawn_id: cctvPawnId,
          cashier_id: session?.user?.email || targetUserId,
          start_time: new Date(Date.now() - 20000).toISOString(),
          end_time: new Date().toISOString(),
          duration: 20,
          file_path: '',
          status: 'PENDING',
          created_at: new Date().toISOString()
        }));

        await adminSupabase.from('cctv_recordings').insert(cctvPayloads);
      }
    } catch (cctvErr) {
      console.warn("CCTV evidence trigger notice:", cctvErr);
    }

    // 6. Dispatch Free SMS Receipt via Android SIM Gateway
    const targetPhone = clientPhone || fullClientObj?.phone;
    if (targetPhone) {
      try {
        const ticketDisplay = stripBranchPrefix(scopedBillNo || billNo) || pawnId.substring(0, 8).toUpperCase();
        const cName = clientName || customerName || (fullClientObj ? `${fullClientObj.first_name || ''} ${fullClientObj.last_name || ''}`.trim() : 'Valued Customer');
        const smsMessage = buildPawnReceiptSms({
          customerName: cName,
          ticketNo: ticketDisplay,
          amount: finalDisbursed
        });
        await sendFreeSms({
          phone: targetPhone,
          message: smsMessage,
          ticketNo: ticketDisplay,
          amount: finalDisbursed,
          type: 'RECEIPT',
          branchId: targetBranchId
        });
      } catch (smsErr) {
        console.warn("SMS Auto-dispatch notice:", smsErr);
      }
    }

    // Attach client details and clean display_bill_no to response
    newPawn.display_bill_no = stripBranchPrefix(newPawn.bill_no);
    if (fullClientObj) {
      newPawn.clients = fullClientObj;
    }
    newPawn.items = Array.isArray(items) ? items : [];
    newPawn.weight = finalWeightGrams || (finalWeightMg / 1000) || 0;

    return NextResponse.json(newPawn, { status: 201 });
  } catch (error: any) {
    console.error('Pawns POST Exception:', error);
    return NextResponse.json({ error: error.message || 'Failed to create pawn ticket' }, { status: 500 });
  }
}
