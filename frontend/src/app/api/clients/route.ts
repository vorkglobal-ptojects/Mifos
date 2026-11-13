import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { normalizeBranchId, getBranchSearchTerms, isNationalId, normalizeNationalId, formatBranchScopedId, stripBranchPrefix } from '@/lib/branch-mapping';
import { syncClientAcrossModules } from '@/lib/cross-sync';

export const dynamic = 'force-dynamic';

const isUUID = (str: string) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(str);

// In-memory cache for clients directory to prevent multi-megabyte socket timeouts
interface CacheEntry {
  data: any[];
  expiresAt: number;
}
const clientsMemoryCache = new Map<string, CacheEntry>();

export function invalidateClientsCache() {
  clientsMemoryCache.clear();
}

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const requestedBranch = searchParams.get('branchId');
    const searchParam = searchParams.get('search');
    const isMinimal = searchParams.get('minimal') === 'true';

    // Parse requested branches (e.g. "PAN" or "PAN,W3" or "ALL")
    let branchTokens = requestedBranch
      ? requestedBranch.split(',').map(b => b.trim()).filter(Boolean)
      : [];

    // Default to user's assigned branch if no explicit branch is requested
    if (branchTokens.length === 0) {
      if (session?.branchId && session.branchId !== 'HQ' && session.branchId !== 'DHW' && session.branchId !== 'ALL') {
        branchTokens = [session.branchId];
      } else {
        branchTokens = ['ALL'];
      }
    }

    const isAll = branchTokens.includes('ALL');
    const noCache = searchParams.get('fresh') === 'true' || searchParams.get('nocache') === 'true';
    const cacheKey = `${isAll ? 'ALL' : branchTokens.map(b => b.toUpperCase()).sort().join(',')}${isMinimal ? ':min' : ''}`;
    const cached = clientsMemoryCache.get(cacheKey);
    if (!noCache && !searchParam && cached && Date.now() < cached.expiresAt) {
      return NextResponse.json(cached.data);
    }

    // Egress Optimization: Never select raw base64 images (nic_image, signature_image) in directory queries.
    // Full base64 images are fetched individually on-demand via /api/clients/[id].
    let clientRows: any[] = [];
    try {
      let query = adminSupabase
        .from('clients')
        .select('id, national_id, first_name, last_name, phone, address, branch_id, status, created_at, created_by_user_id')
        .order('created_at', { ascending: false });

      // When searchParam is provided, search globally across all branches
      // so users can always locate customers across branches by NIC, name, or phone.
      if (searchParam && searchParam.trim()) {
        const rawQ = searchParam.trim();
        const cleanQ = rawQ.replace(/[,()"]/g, ' ');
        const digitsQ = rawQ.replace(/\D/g, '');
        const normNic = normalizeNationalId(rawQ);
        const alphanumericQ = rawQ.replace(/[^a-zA-Z0-9]/g, '');
        const clauses = new Set<string>();

        if (cleanQ) {
          clauses.add(`national_id.ilike.%${cleanQ}%`);
          clauses.add(`first_name.ilike.%${cleanQ}%`);
          clauses.add(`last_name.ilike.%${cleanQ}%`);
        }
        if (normNic && normNic !== cleanQ) {
          clauses.add(`national_id.ilike.%${normNic}%`);
        }
        if (alphanumericQ && alphanumericQ.length >= 3 && alphanumericQ !== cleanQ) {
          clauses.add(`national_id.ilike.%${alphanumericQ}%`);
        }
        if (digitsQ && digitsQ.length >= 3) {
          clauses.add(`phone.ilike.%${digitsQ}%`);
          clauses.add(`national_id.ilike.%${digitsQ}%`);
        }
        // Support multi-word name searches (e.g. "Namali Priyanka")
        const words = cleanQ.split(/\s+/).filter(w => w.length >= 2);
        for (const w of words) {
          clauses.add(`first_name.ilike.%${w}%`);
          clauses.add(`last_name.ilike.%${w}%`);
        }

        if (clauses.size > 0) {
          query = query.or(Array.from(clauses).join(','));
        }
      } else if (!isAll && branchTokens.length > 0) {
        // Only restrict by branch when NOT doing a specific customer search
        const allTerms = branchTokens.flatMap(b => getBranchSearchTerms(b));
        if (allTerms.length > 0) {
          const orClause = allTerms.map(t => `branch_id.ilike.%${t}%`).join(',');
          query = query.or(orClause);
        }
      }

      // Fetch full client directory across PostgREST's 1000-row batch boundary
      let rawClients: any[] = [];
      let pageIndex = 0;
      const batchSize = 1000;
      let hasMoreBatches = true;
      while (hasMoreBatches) {
        const from = pageIndex * batchSize;
        const to = from + batchSize - 1;
        const res = await query.range(from, to);
        if (res.error) throw res.error;
        const batch = res.data || [];
        rawClients = rawClients.concat(batch);
        if (batch.length < batchSize) {
          hasMoreBatches = false;
        } else {
          pageIndex++;
        }
      }

      if (isMinimal) {
        // Fast-path: When minimal fields are requested (e.g. loans lookup map), skip 10k photo presence scans
        clientRows = rawClients.map((c: any) => ({
          ...c,
          has_nic_image: false,
          has_signature: false,
          nic_image: null,
          signature_image: null,
          display_national_id: stripBranchPrefix(c.national_id || c.nationalId)
        }));
      } else {
        // Egress-safe photo presence: Query IDs with photos directly to avoid URL overflow with 1000+ IDs
        const [nicCheckRes, sigCheckRes] = await Promise.all([
          adminSupabase.from('clients').select('id').not('nic_image', 'is', null).range(0, 9999),
          adminSupabase.from('clients').select('id').not('signature_image', 'is', null).range(0, 9999)
        ]);

        const hasNicSet = new Set((nicCheckRes.data || []).map((r: any) => r.id));
        const hasSigSet = new Set((sigCheckRes.data || []).map((r: any) => r.id));

        clientRows = rawClients.map((c: any) => {
          const hasNic = hasNicSet.has(c.id);
          const hasSig = hasSigSet.has(c.id);
          return {
            ...c,
            has_nic_image: hasNic,
            has_signature: hasSig,
            // Supply lightweight indicator with front and back so frontend stats & icons light up accurately
            nic_image: hasNic ? '{"front":"captured","back":"captured"}' : null,
            signature_image: hasSig ? 'captured' : null,
            display_national_id: stripBranchPrefix(c.national_id || c.nationalId)
          };
        });
      }
    } catch (e: any) {
      console.error('[Clients API] Query failed:', e?.message || e);
      if (cached && cached.data) {
        return NextResponse.json(cached.data);
      }
      throw e;
    }

    // Cache valid data for 30 seconds to prevent burst egress while keeping lists fresh
    if (clientRows && clientRows.length > 0) {
      clientsMemoryCache.set(cacheKey, {
        data: clientRows,
        expiresAt: Date.now() + 30_000
      });
    }

    return NextResponse.json(clientRows);
  } catch (error: any) {
    console.error("API GET Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }
    if (session.role === 'AUDITOR') {
      return NextResponse.json({ error: 'Forbidden. Auditors cannot create or overwrite customer records.' }, { status: 403 });
    }

    const body = await request.json();
    const nic = body.nic || body.nationalId || body.national_id;
    const firstName = body.firstName || body.first_name || (body.name ? body.name.split(' ')[0] : '');
    const lastName = body.lastName || body.last_name || (body.name ? body.name.split(' ').slice(1).join(' ') : '');
    let phone = body.phone || body.mobile || '';
    const address = body.address || '';
    const nicImage = body.nicImage || body.nic_image;
    const signatureImage = body.signatureImage || body.signature_image;
    const branchId = body.branchId || body.branch_id;
    const effectiveUserId = session.user?.id;

    if (!effectiveUserId) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    if (!nic || !String(nic).trim()) {
      return NextResponse.json({ error: "NIC / National ID is required" }, { status: 400 });
    }
    if (!firstName || !String(firstName).trim()) {
      return NextResponse.json({ error: "Customer first name is required" }, { status: 400 });
    }

    let formattedPhone = String(phone || '').trim();
    let phoneDigits = formattedPhone.replace(/\D/g, '');
    if (phoneDigits.length === 9 && (phoneDigits.startsWith('7') || phoneDigits.startsWith('1'))) {
      formattedPhone = `0${phoneDigits}`;
      phoneDigits = formattedPhone.replace(/\D/g, '');
    } else if (phoneDigits.length === 11 && phoneDigits.startsWith('94')) {
      formattedPhone = `0${phoneDigits.substring(2)}`;
      phoneDigits = formattedPhone.replace(/\D/g, '');
    }
    if (formattedPhone && (!phoneDigits || phoneDigits.length < 10)) {
      return NextResponse.json({ error: "Invalid mobile number. Must be at least 10 digits (e.g. 0771234567)." }, { status: 400 });
    }
    phone = formattedPhone;

    const trimmedNic = String(nic).trim();
    const headerBranch = request.headers.get('x-branch-id') || request.headers.get('X-Branch-Id');
    let effectiveBranchId = normalizeBranchId(branchId || headerBranch || session?.branchId || 'HQ');

    const isHeadSession = !session?.branchId || normalizeBranchId(session.branchId) === 'HQ' || session.branchId.toUpperCase() === 'HEAD OFFICE';
    if (session && !isHeadSession && session.role !== 'ADMIN') {
      effectiveBranchId = normalizeBranchId(session.branchId || branchId || headerBranch);
    }

    // Reject placeholder/dummy NICs (e.g. '0', '-', 'N/A') from global/cross-client collisions
    const DUMMY_NICS = new Set(['0', '00', '000', '0000', '-', '--', 'N/A', 'NA', 'NONE', 'NULL', 'UNKNOWN', '.']);
    const isDummy = DUMMY_NICS.has(trimmedNic.toUpperCase()) || /^0+$/.test(trimmedNic) || !/[A-Za-z0-9]/.test(trimmedNic);

    // 0. SCOPED IDENTIFIER LOGIC:
    // Postgres enforces UNIQUE(branch_id, national_id) — all lookups & updates MUST stay within effectiveBranchId.
    const isGovNic = !isDummy && isNationalId(trimmedNic);
    const effectiveNic = isDummy
      ? `PENDING-${effectiveBranchId}-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`
      : isGovNic
      ? normalizeNationalId(trimmedNic)
      : formatBranchScopedId(trimmedNic, effectiveBranchId);

    // DUPLICATE PREVENTION (strictly branch-scoped to effectiveBranchId):
    const cleanEffectiveNic = String(effectiveNic || '').replace(/[,()"]/g, '').trim();
    const cleanTrimmedNic = String(trimmedNic || '').replace(/[,()"]/g, '').trim();
    const cleanBranchId = String(effectiveBranchId || '').replace(/[,()"]/g, '').trim();
    let existingClient = null;
    if (isGovNic) {
      let snakeQ = adminSupabase
        .from('clients')
        .select('*')
        .or(`national_id.ilike."${cleanEffectiveNic}",national_id.ilike."${cleanTrimmedNic}"`);
      if (cleanBranchId) snakeQ = snakeQ.eq('branch_id', cleanBranchId);
      const { data: snakeGov } = await snakeQ.limit(1).maybeSingle();
      existingClient = snakeGov;
      if (!existingClient) {
        let camelQ = adminSupabase
          .from('clients')
          .select('*')
          .or(`nationalId.ilike."${cleanEffectiveNic}",nationalId.ilike."${cleanTrimmedNic}"`);
        if (cleanBranchId) camelQ = camelQ.eq('branchId', cleanBranchId);
        const { data: camelGov } = await camelQ.limit(1).maybeSingle();
        existingClient = camelGov;
      }
    } else if (!isDummy) {
      // 1. Try branch-scoped ID within branch
      let scopedQ = adminSupabase.from('clients').select('*').ilike('national_id', cleanEffectiveNic);
      if (cleanBranchId) scopedQ = scopedQ.eq('branch_id', cleanBranchId);
      const { data: scopedMatch } = await scopedQ.limit(1).maybeSingle();
      if (scopedMatch) {
        existingClient = scopedMatch;
      } else if (cleanBranchId) {
        // 2. Try raw non-NIC ID within current branch
        const { data: branchMatch } = await adminSupabase
          .from('clients')
          .select('*')
          .ilike('national_id', cleanTrimmedNic)
          .eq('branch_id', cleanBranchId)
          .limit(1)
          .maybeSingle();
        existingClient = branchMatch;
      }
    }

    if (existingClient) {
      const existingFirst = existingClient.first_name || existingClient.firstName || '';
      const validNewFirst = (firstName && firstName.trim() !== '' && firstName !== 'Valued Customer') ? firstName.trim() : null;
      const finalFirst = validNewFirst || existingFirst || 'Valued Customer';

      const existingLast = existingClient.last_name || existingClient.lastName || '.';
      const validNewLast = (lastName && lastName.trim() !== '' && lastName !== '.') ? lastName.trim() : null;
      const finalLast = validNewLast || existingLast;

      const finalPhone = (phone && phone.trim() !== '') ? phone.trim() : (existingClient.phone || null);
      const finalAddress = (address && address.trim() !== '') ? address.trim() : (existingClient.address || null);
      const finalNicImage = (nicImage && nicImage.trim() !== '') ? nicImage : (existingClient.nic_image || existingClient.nicImage || null);
      const finalSigImage = (signatureImage && signatureImage.trim() !== '') ? signatureImage : (existingClient.signature_image || existingClient.signatureImage || null);

      // 1. Try snake_case update first (matching active database schema)
      const snakeUpdateData: any = {
        first_name: finalFirst,
        last_name: finalLast,
        phone: finalPhone,
        address: finalAddress,
        nic_image: finalNicImage,
        signature_image: finalSigImage
      };
      if (isGovNic && effectiveNic) {
        snakeUpdateData.national_id = effectiveNic;
      }
      
      const { data: updatedClient, error: updateErr } = await adminSupabase
        .from('clients')
        .update(snakeUpdateData)
        .eq('id', existingClient.id)
        .select()
        .single();

      if (!updateErr && updatedClient) {
        await syncClientAcrossModules({
          clientId: updatedClient.id,
          branchId: effectiveBranchId,
          oldNationalId: existingClient.national_id || existingClient.nationalId,
          newNationalId: updatedClient.national_id || effectiveNic,
          firstName: updatedClient.first_name || finalFirst,
          lastName: updatedClient.last_name || finalLast,
          phone: updatedClient.phone || finalPhone,
          address: updatedClient.address || finalAddress,
          oldPhone: existingClient.phone,
          oldName: existingClient.first_name || existingClient.firstName,
        });
        return NextResponse.json(updatedClient, { status: 200 });
      }

      // 2. Fallback to camelCase update if needed
      const camelUpdateData: any = {
        firstName: finalFirst,
        lastName: finalLast,
        phone: finalPhone,
        address: finalAddress,
        nicImage: finalNicImage,
        signatureImage: finalSigImage
      };
      if (isGovNic && effectiveNic) {
        camelUpdateData.nationalId = effectiveNic;
      }

      const { data: camelUpdatedClient } = await adminSupabase
        .from('clients')
        .update(camelUpdateData)
        .eq('id', existingClient.id)
        .select()
        .single();

      await syncClientAcrossModules({
        clientId: existingClient.id,
        branchId: effectiveBranchId,
        oldNationalId: existingClient.national_id || existingClient.nationalId,
        newNationalId: effectiveNic,
        firstName: finalFirst,
        lastName: finalLast,
        phone: finalPhone,
        address: finalAddress,
        oldPhone: existingClient.phone,
        oldName: existingClient.first_name || existingClient.firstName,
      });
      return NextResponse.json(camelUpdatedClient || updatedClient || existingClient, { status: 200 });
    }

    const clientId = crypto.randomUUID();

    // 1. Try snake_case insert first (matching active database schema)
    const snakePayload: any = {
      id: clientId,
      national_id: effectiveNic,
      first_name: firstName,
      last_name: lastName || '.',
      phone: phone || null,
      branch_id: effectiveBranchId,
      created_by_user_id: effectiveUserId,
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      address: address || null,
      nic_image: nicImage || null,
      signature_image: signatureImage || null
    };

    const { data: snakeData, error: snakeErr } = await adminSupabase
      .from('clients')
      .insert([snakePayload])
      .select()
      .single();

    if (!snakeErr && snakeData) {
      await syncClientAcrossModules({
        clientId: snakeData.id,
        branchId: effectiveBranchId,
        oldNationalId: effectiveNic,
        newNationalId: effectiveNic,
        firstName: firstName,
        lastName: lastName || '.',
        phone: phone || undefined,
        address: address || undefined,
      });
      return NextResponse.json(snakeData, { status: 201 });
    }

    // 2. Fallback to camelCase insert if database uses camelCase schema
    const camelPayload: any = {
      id: clientId,
      nationalId: trimmedNic,
      firstName: firstName,
      lastName: lastName || '.',
      phone: phone || null,
      branchId: effectiveBranchId,
      createdByUserId: effectiveUserId,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      address: address || null,
      nic_image: nicImage || null,
      signature_image: signatureImage || null
    };

    const { data: camelData, error: camelErr } = await adminSupabase
      .from('clients')
      .insert([camelPayload])
      .select()
      .single();

    if (!camelErr && camelData) {
      await syncClientAcrossModules({
        clientId: camelData.id || clientId,
        branchId: effectiveBranchId,
        oldNationalId: effectiveNic,
        newNationalId: effectiveNic,
        firstName: firstName,
        lastName: lastName || '.',
        phone: phone || undefined,
        address: address || undefined,
      });
      return NextResponse.json(camelData, { status: 201 });
    }

    console.error("Clients POST Error (Both schemas failed):", snakeErr, camelErr);
    return NextResponse.json({ error: snakeErr?.message || camelErr?.message || "Failed to save customer record to database." }, { status: 500 });
  } catch (error: any) {
    console.error("API POST Exception:", error);
    return NextResponse.json({ error: error.message || 'Failed to save customer' }, { status: 500 });
  }
}
