import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { normalizeBranchId, getBranchSearchTerms } from '@/lib/branch-mapping';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const branchParam = searchParams.get('branch') || '';
    const dateParam = searchParams.get('date') || '';
    const monthParam = searchParams.get('month') || '';
    const yearParam = searchParams.get('year') || '';
    const searchParam = (searchParams.get('search') || '').trim().toLowerCase();
    const enteredByParam = (searchParams.get('enteredBy') || '').trim();

    // 1. Fetch pawns query with order by created_at desc
    let query = adminSupabase
      .from('pawns')
      .select('id, bill_no, branch_id, appraised_value, disbursed_amount, status, description, created_at, created_by_user_id, client_id, period_months, interest_rate, weight_grams, weight_mg, unique_tag')
      .order('created_at', { ascending: false })
      .limit(1000);

    // Multi-tenant branch scope: non-admins locked to their own branch
    const isHQ = !session.branchId || normalizeBranchId(session.branchId) === 'HQ' || session.branchId.toUpperCase() === 'HEAD OFFICE';
    if (!isHQ && session.role !== 'ADMIN' && session.role !== 'AUDITOR') {
      const terms = getBranchSearchTerms(session.branchId);
      query = query.in('branch_id', terms);
    } else if (branchParam && branchParam !== 'ALL') {
      const terms = getBranchSearchTerms(branchParam);
      query = query.in('branch_id', terms);
    }

    const { data: pawns, error: pawnErr } = await query;
    if (pawnErr) {
      console.error('Entry history pawns error:', pawnErr);
      return NextResponse.json({ error: pawnErr.message }, { status: 500 });
    }

    const pawnList = pawns || [];

    // 2. Collect unique client IDs and fetch customer details in bulk
    const clientIds = Array.from(new Set(pawnList.map((p: any) => p.client_id).filter(Boolean)));
    const clientMap: Record<string, any> = {};

    if (clientIds.length > 0) {
      // Fetch in chunks of 100
      for (let i = 0; i < clientIds.length; i += 100) {
        const chunk = clientIds.slice(i, i + 100);
        const { data: clients } = await adminSupabase
          .from('clients')
          .select('id, first_name, last_name, national_id, phone, address')
          .in('id', chunk);
        (clients || []).forEach((c: any) => {
          clientMap[c.id] = c;
        });
      }
    }

    // 3. Collect staff / auth user map for "entered person" resolution
    const { data: authData } = await adminSupabase.auth.admin.listUsers({ perPage: 1000 });
    const userMap: Record<string, { email: string; name: string }> = {};

    const emailNameMap: Record<string, string> = {
      'madushaniperera9617@gmail.com': 'Madushani',
      'erandiperera25@gmail.com': 'Erandi',
      'erandiauditor@gmail.com': 'Erandi',
      'sanduminiauditor@gmail.com': 'Sandhumini',
      'nishanthimanager@gmail.com': 'Nishanthi',
      'manishadias@gmail.com': 'Manisha',
      'kavika2030@gmail.com': 'Imashi',
      'a.v.chamika.sonali@hrpulse.com': 'Chamika',
      'chathudissanayake63@gmail.com': 'Chathurika',
      'dahami.divyanjali@hrpulse.com': 'Dahami',
      'sachininirasha462@gmail.com': 'Sachini',
      'dilinisamudra8210@gmail.com': 'Dilini',
      'tharushisandumini1111@gmail.com': 'Tharushi',
      'kdrasikapriyangani80@gmail.com': 'Rasika',
      'chamilka.botheju@hrpulse.com': 'Chamilka',
      'chandimaperera501@gmail.com': 'Chandima',
      'chasirasulani@gmail.com': 'Chaseera',
      'tharushiaps99@icloud.com': 'Tharushi',
      'harshaha825@gmail.com': 'Harsha',
      'pereralakshi90@gmail.com': 'Lakshika',
      'geethanganipeiri2912@gmail.com': 'Geethangani',
      'dilupathamari9@gmail.com': 'Dilupa',
      'auditor@gmail.com': 'Auditor',
      'sanjay.rupasinghe@gmail.com': 'Sanjay',
      'manager@gmail.com': 'Manager',
      'admin@gmail.com': 'Admin',
      'admin@rupasinghe.com': 'Admin',
      'admin_sasindu@gmail.com': 'Sasindu',
      'admin_nisal@gmail.com': 'Nisal',
      'admin_dinusha@gmail.com': 'Dinusha',
      'admin_janani@gmail.com': 'Janani',
      'dilkiisanka3@gmail.com': 'Dilki'
    };

    (authData?.users || []).forEach((u: any) => {
      const email = (u.email || '').toLowerCase().trim();
      const metaName = u.user_metadata?.full_name || u.user_metadata?.first_name || '';
      const resolved = emailNameMap[email] || metaName || email.split('@')[0] || 'Staff';
      userMap[u.id] = {
        email: u.email || '',
        name: resolved
      };
    });

    // 4. Transform and filter entries
    let entries = pawnList.map((p: any) => {
      const client = clientMap[p.client_id] || null;
      const user = userMap[p.created_by_user_id] || { email: '', name: 'Branch Staff' };
      const customerName = client ? `${client.first_name || ''} ${client.last_name || ''}`.trim() : 'Customer';
      const customerNic = client?.national_id || '';
      const customerPhone = client?.phone || '';

      const dt = new Date(p.created_at);
      const year = dt.getFullYear().toString();
      const month = (dt.getMonth() + 1).toString().padStart(2, '0');
      const day = dt.getDate().toString().padStart(2, '0');
      const dateString = `${year}-${month}-${day}`;

      return {
        id: p.id,
        billNo: p.bill_no,
        branchId: p.branch_id,
        amount: parseFloat(p.disbursed_amount) || 0,
        appraisedValue: parseFloat(p.appraised_value) || 0,
        status: p.status,
        description: p.description,
        weightGrams: p.weight_grams,
        weightMg: p.weight_mg,
        periodMonths: p.period_months,
        uniqueTag: p.unique_tag,
        createdAt: p.created_at,
        dateString,
        year,
        month,
        day,
        enteredById: p.created_by_user_id,
        enteredByName: user.name,
        enteredByEmail: user.email,
        customerId: p.client_id,
        customerName,
        customerNic,
        customerPhone,
      };
    });

    // 5. In-memory exact date/month/year/enteredBy/search filters
    if (dateParam) {
      entries = entries.filter(e => e.dateString === dateParam);
    }
    if (yearParam && yearParam !== 'ALL') {
      entries = entries.filter(e => e.year === yearParam);
    }
    if (monthParam && monthParam !== 'ALL') {
      entries = entries.filter(e => e.month === monthParam.padStart(2, '0'));
    }
    if (enteredByParam && enteredByParam !== 'ALL') {
      entries = entries.filter(e => 
        e.enteredById === enteredByParam || 
        e.enteredByName.toLowerCase() === enteredByParam.toLowerCase() ||
        e.enteredByEmail.toLowerCase() === enteredByParam.toLowerCase()
      );
    }

    if (searchParam) {
      entries = entries.filter(e => {
        return (
          e.billNo?.toLowerCase().includes(searchParam) ||
          e.customerName.toLowerCase().includes(searchParam) ||
          e.customerNic.toLowerCase().includes(searchParam) ||
          e.customerPhone.toLowerCase().includes(searchParam) ||
          e.enteredByName.toLowerCase().includes(searchParam) ||
          e.enteredByEmail.toLowerCase().includes(searchParam) ||
          e.branchId?.toLowerCase().includes(searchParam) ||
          e.description?.toLowerCase().includes(searchParam)
        );
      });
    }

    // 6. Return staff list for dropdown filter
    const staffOptions = Array.from(new Set(entries.map(e => JSON.stringify({ id: e.enteredById, name: e.enteredByName }))))
      .map(s => JSON.parse(s))
      .filter(s => s.id);

    return NextResponse.json({
      entries,
      totalCount: entries.length,
      staffOptions,
      isHQ
    });
  } catch (error: any) {
    console.error('Entry history GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

