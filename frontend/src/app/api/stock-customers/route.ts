import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { normalizeBranchId, isNationalId, normalizeNationalId, formatBranchScopedId, stripBranchPrefix } from '@/lib/branch-mapping';
import { invalidateClientsCache } from '@/app/api/clients/route';

export const dynamic = 'force-dynamic';

const DUMMY_NICS = new Set(['0', '00', '000', '0000', '-', '--', 'N/A', 'NA', 'NONE', 'NULL', 'UNKNOWN', '.']);

function isDummyNic(nic: string | null | undefined): boolean {
  const trimmed = (nic || '').trim();
  if (!trimmed) return true;
  const upper = trimmed.toUpperCase();
  if (DUMMY_NICS.has(upper) || /^0+$/.test(trimmed) || upper.startsWith('PENDING-')) return true;
  return !/[A-Za-z0-9]/.test(trimmed);
}

function isDummyPhone(phone: string | null | undefined): boolean {
  const clean = normalizePhone(phone);
  return !clean || /^0+$/.test(clean) || clean === '0700000000' || clean.length < 9;
}

function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return '';
  let clean = phone.replace(/\D/g, '');
  if (clean.startsWith('94') && clean.length === 11) {
    clean = '0' + clean.slice(2);
  } else if (clean.length === 9 && !clean.startsWith('0')) {
    clean = '0' + clean;
  }
  return clean;
}

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    // 1. Paginated fetch of ALL stock_customers using adminSupabase (PostgREST caps single select at 1000)
    let allStockCustomers: any[] = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      const { data, error } = await adminSupabase
        .from('stock_customers')
        .select('*')
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) {
        console.error('Error fetching stock_customers page:', error);
        break;
      }

      if (data && data.length > 0) {
        allStockCustomers = allStockCustomers.concat(data);
        if (data.length < pageSize) {
          hasMore = false;
        } else {
          page++;
        }
      } else {
        hasMore = false;
      }
    }

    // 2. Fetch clients and stock_items only as fallback if a legacy row somehow lacks branch_id
    const { data: clientsData } = await adminSupabase
      .from('clients')
      .select('national_id, phone, branch_id')
      .limit(10000);

    const clientNicToBranches = new Map<string, Set<string>>();
    const clientPhoneToBranches = new Map<string, Set<string>>();
    if (clientsData && Array.isArray(clientsData)) {
      for (const cl of clientsData) {
        const normBr = cl.branch_id ? normalizeBranchId(cl.branch_id) : '';
        if (!normBr) continue;
        if (cl.national_id && !isDummyNic(cl.national_id)) {
          const rawNic = cl.national_id.trim().toUpperCase();
          if (!clientNicToBranches.has(rawNic)) clientNicToBranches.set(rawNic, new Set());
          clientNicToBranches.get(rawNic)!.add(normBr);
          if (isNationalId(rawNic)) {
            const normNic = normalizeNationalId(rawNic);
            if (!clientNicToBranches.has(normNic)) clientNicToBranches.set(normNic, new Set());
            clientNicToBranches.get(normNic)!.add(normBr);
          }
        }
        if (cl.phone && !isDummyPhone(cl.phone)) {
          const cP = normalizePhone(cl.phone);
          if (!clientPhoneToBranches.has(cP)) clientPhoneToBranches.set(cP, new Set());
          clientPhoneToBranches.get(cP)!.add(normBr);
        }
      }
    }

    const { data: itemsData } = await adminSupabase
      .from('stock_items')
      .select('bill_no, branch_id')
      .limit(10000);

    const itemBillToBranches = new Map<string, Set<string>>();
    if (itemsData && Array.isArray(itemsData)) {
      for (const it of itemsData) {
        if (!it.bill_no) continue;
        const normBr = it.branch_id ? normalizeBranchId(it.branch_id) : '';
        const cBill = stripBranchPrefix(it.bill_no).toUpperCase().replace(/[\s\-_/]+/g, '');
        if (!itemBillToBranches.has(cBill)) itemBillToBranches.set(cBill, new Set());
        if (normBr) itemBillToBranches.get(cBill)!.add(normBr);
      }
    }

    // 3. Fetch pawns joined with clients to link bills created in Pawning or registered clients
    const { data: pawnData, error: pawnErr } = await adminSupabase
      .from('pawns')
      .select('bill_no, branch_id, client_id, clients:client_id ( id, national_id, first_name, last_name, phone, address )')
      .not('bill_no', 'is', null)
      .limit(10000);

    if (pawnErr) {
      console.warn('Warning: Could not fetch pawns for stock customer sync:', pawnErr.message);
    }

    // Build unified map of customers indexed strictly by (branch_id :: bill_no)
    const unifiedList: any[] = [];
    const branchBillMap = new Set<string>();

    // Add existing stock_customers first, trusting stored sc.branch_id before fallbacks
    for (const sc of allStockCustomers) {
      let resolvedBranch = sc.branch_id ? normalizeBranchId(sc.branch_id) : null;

      // 1. Fallback via stock_items bill number ONLY if bill belongs to a single branch
      if (!resolvedBranch && sc.bill_numbers) {
        const bills = sc.bill_numbers.split(',').map((b: string) => stripBranchPrefix(b).toUpperCase().replace(/[\s\-_/]+/g, '')).filter(Boolean);
        const foundBranches = new Set<string>();
        for (const b of bills) {
          const brSet = itemBillToBranches.get(b);
          if (brSet && brSet.size === 1) {
            foundBranches.add(Array.from(brSet)[0]);
          }
        }
        if (foundBranches.size === 1) {
          resolvedBranch = Array.from(foundBranches)[0];
        }
      }

      // 2. Fallback via genuine client NIC ONLY if unambiguous (single branch)
      if (!resolvedBranch && sc.nic && !isDummyNic(sc.nic)) {
        const cNic = isNationalId(sc.nic) ? normalizeNationalId(sc.nic) : sc.nic.trim().toUpperCase();
        const brSet = clientNicToBranches.get(cNic);
        if (brSet && brSet.size === 1) {
          resolvedBranch = Array.from(brSet)[0];
        }
      }

      // 3. Fallback via non-dummy phone ONLY if unambiguous (single branch)
      if (!resolvedBranch && sc.tp && !isDummyPhone(sc.tp)) {
        const cP = normalizePhone(sc.tp);
        const brSet = clientPhoneToBranches.get(cP);
        if (brSet && brSet.size === 1) {
          resolvedBranch = Array.from(brSet)[0];
        }
      }

      const finalBranch = resolvedBranch || sc.branch_id || null;
      const enrichedSc = {
        ...sc,
        branch_id: finalBranch
      };

      unifiedList.push(enrichedSc);

      if (sc.bill_numbers && finalBranch) {
        const brKey = normalizeBranchId(finalBranch);
        sc.bill_numbers.split(',').forEach((b: string) => {
          const raw = b.trim();
          if (raw) {
            branchBillMap.add(`${brKey}::${raw.toUpperCase()}`);
            branchBillMap.add(`${brKey}::${raw.toUpperCase().replace(/[\s\-_/]+/g, '')}`);
            branchBillMap.add(`${brKey}::${stripBranchPrefix(raw).toUpperCase().replace(/[\s\-_/]+/g, '')}`);
          }
        });
      }
    }

    // Enrich with pawn customers if not already present in that branch's stock_customers
    if (pawnData && Array.isArray(pawnData)) {
      for (const p of pawnData) {
        const client = p.clients as any;
        if (!client || !p.bill_no) continue;
        const pBranch = p.branch_id ? normalizeBranchId(p.branch_id) : 'HQ';
        const rawBill = String(p.bill_no).trim();
        const cleanBill = rawBill.toUpperCase();
        const noSpaceBill = cleanBill.replace(/[\s\-_/]+/g, '');
        const strippedBill = stripBranchPrefix(rawBill).toUpperCase().replace(/[\s\-_/]+/g, '');

        if (
          !branchBillMap.has(`${pBranch}::${cleanBill}`) &&
          !branchBillMap.has(`${pBranch}::${noSpaceBill}`) &&
          !branchBillMap.has(`${pBranch}::${strippedBill}`)
        ) {
          unifiedList.push({
            id: `pawn-${client.id}-${rawBill}`,
            name: `${client.first_name || ''} ${client.last_name && client.last_name !== '.' ? client.last_name : ''}`.trim() || 'Valued Customer',
            tp: client.phone || '',
            nic: client.national_id || '',
            address: client.address || '',
            address_2: null,
            bill_numbers: rawBill,
            branch_id: pBranch,
            created_at: client.created_at || new Date().toISOString(),
            source: 'pawn'
          });
          branchBillMap.add(`${pBranch}::${cleanBill}`);
          branchBillMap.add(`${pBranch}::${noSpaceBill}`);
          branchBillMap.add(`${pBranch}::${strippedBill}`);
        }
      }
    }

    return NextResponse.json({
      success: true,
      customers: unifiedList,
      count: unifiedList.length
    });
  } catch (err: any) {
    console.error('Stock customers GET error:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch stock customers' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }
    if (session.role === 'AUDITOR') {
      return NextResponse.json({ error: 'Forbidden. Auditors cannot modify stock customer records.' }, { status: 403 });
    }

    const body = await request.json();
    const { id, name, address, address_2, tp, nic, bill_numbers, branch_id } = body;

    if (!name || !name.trim() || !address || !address.trim() || !tp || !tp.trim()) {
      return NextResponse.json({ error: 'Name, Address, and Telephone are required fields.' }, { status: 400 });
    }

    const cleanName = name.trim();
    const cleanAddress = address.trim();
    const cleanAddress2 = address_2 ? address_2.trim() : null;
    const fullAddress = cleanAddress2 ? `${cleanAddress}, ${cleanAddress2}` : cleanAddress;
    const formattedPhone = normalizePhone(tp);
    const cleanBills = (bill_numbers || '').trim();
    const headerBranch = request.headers.get('x-branch-id') || request.headers.get('X-Branch-Id');
    const sessionBranch = session.branchId ? normalizeBranchId(session.branchId) : '';
    const isGlobalRole = session.role === 'ADMIN' || sessionBranch === 'HQ';
    const requestedBranch = branch_id
      ? normalizeBranchId(branch_id)
      : headerBranch
      ? normalizeBranchId(headerBranch)
      : '';

    if (!isGlobalRole && sessionBranch && requestedBranch && requestedBranch !== sessionBranch) {
      return NextResponse.json(
        { error: `Forbidden: Cannot create or modify customer profile under branch ${requestedBranch}.` },
        { status: 403 }
      );
    }

    let effectiveBranch = !isGlobalRole && sessionBranch
      ? sessionBranch
      : (requestedBranch || sessionBranch || 'HQ');

    const billListForResolution = cleanBills.split(',').map((b: string) => b.trim()).filter(Boolean);
    if (effectiveBranch === 'HQ' && billListForResolution.length > 0) {
      const { data: matchingStock } = await adminSupabase
        .from('stock_items')
        .select('branch_id')
        .in('bill_no', billListForResolution);
      const uniqueBranches = Array.from(
        new Set((matchingStock || []).map((s: any) => normalizeBranchId(s.branch_id)).filter((b: string) => b && b !== 'HQ'))
      );
      if (uniqueBranches.length === 1) {
        effectiveBranch = uniqueBranches[0];
      }
    }

    const primaryBill = billListForResolution[0] || '';

    // Determine effective NIC for clients table (never treat '0', '-', 'N/A' as matchable NIC!)
    const rawTrimmedNic = nic ? String(nic).trim() : '';
    const trimmedNic = isDummyNic(rawTrimmedNic) ? '' : rawTrimmedNic;
    let effectiveNic = '';
    if (trimmedNic) {
      effectiveNic = isNationalId(trimmedNic)
        ? normalizeNationalId(trimmedNic)
        : formatBranchScopedId(trimmedNic, effectiveBranch);
    } else if (primaryBill) {
      effectiveNic = formatBranchScopedId(primaryBill, effectiveBranch);
    } else {
      effectiveNic = formatBranchScopedId(`BOOK-${Date.now()}`, effectiveBranch);
    }

    // Check explicit ID record upfront to prevent cross-branch mutation & preserve its branch
    let explicitStockCustomer: any = null;
    if (id && !String(id).startsWith('pawn-')) {
      const { data } = await adminSupabase
        .from('stock_customers')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      explicitStockCustomer = data;
      if (explicitStockCustomer?.branch_id) {
        const existingBr = normalizeBranchId(explicitStockCustomer.branch_id);
        if (!isGlobalRole && sessionBranch && existingBr !== sessionBranch) {
          return NextResponse.json(
            { error: `Forbidden: Cannot modify customer belonging to branch ${existingBr}.` },
            { status: 403 }
          );
        }
        if (!requestedBranch) {
          effectiveBranch = existingBr;
        }
      }
    }

    // 1. SAVE / SYNC INTO CLIENTS (Customer) TABLE — STRICTLY SCOPED TO effectiveBranch
    let existingClient: any = null;
    if (trimmedNic && isNationalId(trimmedNic)) {
      const { data } = await adminSupabase
        .from('clients')
        .select('*')
        .eq('branch_id', effectiveBranch)
        .ilike('national_id', normalizeNationalId(trimmedNic))
        .limit(1)
        .maybeSingle();
      existingClient = data;
    }

    if (!existingClient && effectiveNic) {
      const { data } = await adminSupabase
        .from('clients')
        .select('*')
        .eq('branch_id', effectiveBranch)
        .ilike('national_id', effectiveNic)
        .limit(1)
        .maybeSingle();
      existingClient = data;
    }
    // Phone number fallback is intentionally disabled to prevent overwriting existing clients
    // who share a phone number or use dummy numbers (e.g. 0000000000, 0700000000).
    // Client profile updates are strictly keyed on (branch_id, national_id).

    let savedClient: any = null;
    if (existingClient) {
      // Update existing same-branch client profile ONLY — NEVER overwrite branch_id across branches!
      const { data: updated, error: updateErr } = await adminSupabase
        .from('clients')
        .update({
          first_name: cleanName,
          last_name: existingClient.last_name || '.',
          phone: (isDummyPhone(formattedPhone) ? null : formattedPhone) || existingClient.phone,
          address: fullAddress || existingClient.address
        })
        .eq('id', existingClient.id)
        .select()
        .single();

      if (!updateErr && updated) {
        savedClient = updated;
      } else {
        savedClient = existingClient;
      }
    } else {
      // Create new branch-scoped client record in clients table
      const newClientId = crypto.randomUUID();
      const newClientPayload = {
        id: newClientId,
        national_id: effectiveNic,
        first_name: cleanName,
        last_name: '.',
        phone: (isDummyPhone(formattedPhone) ? null : formattedPhone) || null,
        address: fullAddress || null,
        branch_id: effectiveBranch,
        created_by_user_id: session?.user?.id || null,
        status: 'ACTIVE',
        created_at: new Date().toISOString()
      };

      const { data: created, error: insertErr } = await adminSupabase
        .from('clients')
        .insert([newClientPayload])
        .select()
        .single();

      if (insertErr) {
        console.warn('Warning: Could not insert client into clients table:', insertErr.message);
      } else {
        savedClient = created;
      }
    }

    invalidateClientsCache();

    // 2. SAVE / SYNC INTO STOCK_CUSTOMERS TABLE — STRICTLY SCOPED TO effectiveBranch
    let targetStockCustomer: any = explicitStockCustomer;

    if (!targetStockCustomer && trimmedNic && (isNationalId(trimmedNic) || trimmedNic.length >= 5)) {
      const { data } = await adminSupabase
        .from('stock_customers')
        .select('*')
        .eq('branch_id', effectiveBranch)
        .ilike('nic', trimmedNic)
        .limit(1)
        .maybeSingle();
      targetStockCustomer = data;
    }
    // Loose substring bill matching is intentionally removed.
    // A customer profile must NEVER be adopted or overwritten across branches or via dummy NICs.

    let savedStockCustomer: any = null;
    if (targetStockCustomer) {
      // Merge bill numbers so prior bills in this branch are not lost
      const existingBills = (targetStockCustomer.bill_numbers || '')
        .split(',')
        .map((b: string) => b.trim())
        .filter(Boolean);
      const newBills = cleanBills
        .split(',')
        .map((b: string) => b.trim())
        .filter(Boolean);
      const mergedBills = Array.from(new Set([...existingBills, ...newBills])).join(', ');
      const preservedNic = trimmedNic || (!isDummyNic(targetStockCustomer.nic) ? targetStockCustomer.nic : null);

      const { data: updatedStock, error: stockUpErr } = await adminSupabase
        .from('stock_customers')
        .update({
          name: cleanName,
          address: cleanAddress,
          address_2: cleanAddress2,
          tp: formattedPhone || targetStockCustomer.tp,
          nic: preservedNic,
          bill_numbers: mergedBills || cleanBills,
          branch_id: effectiveBranch
        })
        .eq('id', targetStockCustomer.id)
        .select()
        .single();

      if (stockUpErr) throw stockUpErr;
      savedStockCustomer = updatedStock;
    } else {
      const { data: insertedStock, error: stockInErr } = await adminSupabase
        .from('stock_customers')
        .insert([{
          name: cleanName,
          address: cleanAddress,
          address_2: cleanAddress2,
          tp: formattedPhone,
          nic: trimmedNic || null,
          bill_numbers: cleanBills,
          branch_id: effectiveBranch,
          created_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (stockInErr) throw stockInErr;
      savedStockCustomer = insertedStock;
    }

    // 3. LINK MATCHING BILLS IN PAWNS TABLE TO CLIENT (STRICTLY SAME BRANCH ONLY)
    if (savedClient?.id && cleanBills) {
      const billList = cleanBills.split(',').map((b: string) => b.trim()).filter(Boolean);
      for (const bill of billList) {
        try {
          await adminSupabase
            .from('pawns')
            .update({ client_id: savedClient.id })
            .eq('branch_id', effectiveBranch)
            .ilike('bill_no', bill)
            .is('client_id', null);
        } catch (linkErr) {
          console.warn(`Could not link bill ${bill} in pawns:`, linkErr);
        }
      }
    }

    return NextResponse.json({
      success: true,
      customer: savedStockCustomer,
      client: savedClient
    }, { status: 201 });
  } catch (err: any) {
    console.error('Stock customers POST error:', err);
    return NextResponse.json({ error: err.message || 'Failed to save customer profile' }, { status: 500 });
  }
}
