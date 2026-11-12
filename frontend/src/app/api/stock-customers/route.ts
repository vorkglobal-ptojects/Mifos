import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { normalizeBranchId, isNationalId, normalizeNationalId, formatBranchScopedId, stripBranchPrefix } from '@/lib/branch-mapping';
import { invalidateClientsCache } from '@/app/api/clients/route';

export const dynamic = 'force-dynamic';

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

    // 2. Fetch clients and stock_items to resolve branch_id for stock_customers
    const { data: clientsData } = await adminSupabase
      .from('clients')
      .select('national_id, phone, branch_id')
      .limit(10000);

    const clientNicToBranch = new Map<string, string>();
    const clientPhoneToBranch = new Map<string, string>();
    if (clientsData && Array.isArray(clientsData)) {
      for (const cl of clientsData) {
        const normBr = normalizeBranchId(cl.branch_id);
        if (cl.national_id) {
          const cNic = cl.national_id.trim().toUpperCase();
          clientNicToBranch.set(cNic, normBr);
        }
        if (cl.phone) {
          const cP = normalizePhone(cl.phone);
          if (cP) clientPhoneToBranch.set(cP, normBr);
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
        const normBr = normalizeBranchId(it.branch_id);
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

    // Build unified map of customers indexed by bill numbers
    const unifiedList: any[] = [];
    const billMap = new Set<string>();

    // Add existing stock_customers first, enriched with accurate branch_id
    for (const sc of allStockCustomers) {
      let resolvedBranch = sc.branch_id ? normalizeBranchId(sc.branch_id) : null;

      // 1. Resolve branch via client NIC
      if (!resolvedBranch && sc.nic) {
        const cNic = sc.nic.trim().toUpperCase();
        if (clientNicToBranch.has(cNic)) {
          resolvedBranch = clientNicToBranch.get(cNic)!;
        }
      }

      // 2. Resolve branch via stock_items bills
      if (!resolvedBranch && sc.bill_numbers) {
        const bills = sc.bill_numbers.split(',').map((b: string) => stripBranchPrefix(b).toUpperCase().replace(/[\s\-_/]+/g, '')).filter(Boolean);
        for (const b of bills) {
          const brSet = itemBillToBranches.get(b);
          if (brSet && brSet.size === 1) {
            resolvedBranch = Array.from(brSet)[0];
            break;
          }
        }
      }

      // 3. Resolve branch via phone
      if (!resolvedBranch && sc.tp) {
        const cP = normalizePhone(sc.tp);
        if (cP && clientPhoneToBranch.has(cP)) {
          resolvedBranch = clientPhoneToBranch.get(cP)!;
        }
      }

      const enrichedSc = {
        ...sc,
        branch_id: resolvedBranch || sc.branch_id || null
      };

      unifiedList.push(enrichedSc);

      if (sc.bill_numbers) {
        sc.bill_numbers.split(',').forEach((b: string) => {
          const raw = b.trim();
          if (raw) {
            billMap.add(raw.toUpperCase());
            billMap.add(raw.toUpperCase().replace(/[\s\-_/]+/g, ''));
            billMap.add(stripBranchPrefix(raw).toUpperCase().replace(/[\s\-_/]+/g, ''));
          }
        });
      }
    }

    // Enrich with pawn customers if not already present in stock_customers
    if (pawnData && Array.isArray(pawnData)) {
      for (const p of pawnData) {
        const client = p.clients as any;
        if (!client || !p.bill_no) continue;
        const rawBill = String(p.bill_no).trim();
        const cleanBill = rawBill.toUpperCase();
        const noSpaceBill = cleanBill.replace(/[\s\-_/]+/g, '');
        const strippedBill = stripBranchPrefix(rawBill).toUpperCase().replace(/[\s\-_/]+/g, '');

        if (!billMap.has(cleanBill) && !billMap.has(noSpaceBill) && !billMap.has(strippedBill)) {
          unifiedList.push({
            id: `pawn-${client.id}-${rawBill}`,
            name: `${client.first_name || ''} ${client.last_name && client.last_name !== '.' ? client.last_name : ''}`.trim() || 'Valued Customer',
            tp: client.phone || '',
            nic: client.national_id || '',
            address: client.address || '',
            address_2: null,
            bill_numbers: rawBill,
            branch_id: p.branch_id,
            created_at: client.created_at || new Date().toISOString(),
            source: 'pawn'
          });
          billMap.add(cleanBill);
          billMap.add(noSpaceBill);
          billMap.add(strippedBill);
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
    const effectiveBranch = normalizeBranchId(branch_id || headerBranch || session?.branchId || 'HQ');
    const primaryBill = cleanBills.split(',')[0]?.trim() || '';

    // Determine effective NIC for clients table
    const trimmedNic = nic ? String(nic).trim() : '';
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

    // 1. SAVE / SYNC INTO CLIENTS (Customer) TABLE
    let existingClient: any = null;
    if (trimmedNic && isNationalId(trimmedNic)) {
      const { data } = await adminSupabase
        .from('clients')
        .select('*')
        .ilike('national_id', trimmedNic)
        .limit(1)
        .maybeSingle();
      existingClient = data;
    }

    if (!existingClient && effectiveNic) {
      const { data } = await adminSupabase
        .from('clients')
        .select('*')
        .ilike('national_id', effectiveNic)
        .limit(1)
        .maybeSingle();
      existingClient = data;
    }
    // Phone number fallback is intentionally disabled to prevent overwriting existing clients
    // who share a phone number or use dummy numbers (e.g. 0000000000, 0700000000).
    // Client profile updates are strictly keyed on unique National ID.

    let savedClient: any = null;
    if (existingClient) {
      // Update existing client profile with latest details
      const { data: updated, error: updateErr } = await adminSupabase
        .from('clients')
        .update({
          first_name: cleanName,
          last_name: existingClient.last_name || '.',
          phone: formattedPhone || existingClient.phone,
          address: fullAddress || existingClient.address,
          branch_id: effectiveBranch || existingClient.branch_id
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
      // Create new client record in clients table
      const newClientId = crypto.randomUUID();
      const newClientPayload = {
        id: newClientId,
        national_id: effectiveNic,
        first_name: cleanName,
        last_name: '.',
        phone: formattedPhone || null,
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

    // 2. SAVE / SYNC INTO STOCK_CUSTOMERS TABLE
    let targetStockCustomer: any = null;
    if (id && !String(id).startsWith('pawn-')) {
      const { data } = await adminSupabase
        .from('stock_customers')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      targetStockCustomer = data;
    }

    if (!targetStockCustomer && trimmedNic) {
      const { data } = await adminSupabase
        .from('stock_customers')
        .select('*')
        .ilike('nic', trimmedNic)
        .limit(1)
        .maybeSingle();
      targetStockCustomer = data;
    }
    // Loose substring bill matching is intentionally removed.
    // A customer profile must NEVER be adopted or overwritten based on a partial bill number match.
    // If an explicit ID or NIC match was not found, this customer is treated as new and inserted.

    let savedStockCustomer: any = null;
    if (targetStockCustomer) {
      // Merge bill numbers so prior bills are not lost
      const existingBills = (targetStockCustomer.bill_numbers || '')
        .split(',')
        .map((b: string) => b.trim())
        .filter(Boolean);
      const newBills = cleanBills
        .split(',')
        .map((b: string) => b.trim())
        .filter(Boolean);
      const mergedBills = Array.from(new Set([...existingBills, ...newBills])).join(', ');

      const { data: updatedStock, error: stockUpErr } = await adminSupabase
        .from('stock_customers')
        .update({
          name: cleanName,
          address: cleanAddress,
          address_2: cleanAddress2,
          tp: formattedPhone || targetStockCustomer.tp,
          nic: trimmedNic || targetStockCustomer.nic,
          bill_numbers: mergedBills || cleanBills
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
          created_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (stockInErr) throw stockInErr;
      savedStockCustomer = insertedStock;
    }

    // 3. LINK MATCHING BILLS IN PAWNS TABLE TO CLIENT
    if (savedClient?.id && cleanBills) {
      const billList = cleanBills.split(',').map((b: string) => b.trim()).filter(Boolean);
      for (const bill of billList) {
        try {
          await adminSupabase
            .from('pawns')
            .update({ client_id: savedClient.id })
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
