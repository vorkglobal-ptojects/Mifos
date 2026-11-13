import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { normalizeBranchId } from '@/lib/branch-mapping';
import { invalidateClientsCache } from '../route';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: any) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }
    const { id } = await context.params;
    const sessionBranch = session.branchId ? normalizeBranchId(session.branchId) : '';
    const isGlobalRole = session.role === 'ADMIN' || session.role === 'AUDITOR' || sessionBranch === 'HQ';

    let query = adminSupabase.from('clients').select('*');
    if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id)) {
      query = query.eq('id', id);
    } else {
      query = query.ilike('national_id', id);
      if (!isGlobalRole && sessionBranch) {
        query = query.eq('branch_id', sessionBranch);
      }
      query = query.limit(1);
    }
    const { data, error } = await query.maybeSingle();
    if (error || !data) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: any) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (session.role === 'AUDITOR') {
      return NextResponse.json({ error: 'Forbidden. Auditors cannot modify customer records.' }, { status: 403 });
    }

    const { id } = await context.params;
    const { data: existingClient } = await adminSupabase
      .from('clients')
      .select('id, branch_id')
      .eq('id', id)
      .maybeSingle();

    if (!existingClient) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    const sessionBranch = session.branchId ? normalizeBranchId(session.branchId) : '';
    const isGlobalRole = session.role === 'ADMIN' || sessionBranch === 'HQ';
    const existingBranch = existingClient.branch_id ? normalizeBranchId(existingClient.branch_id) : '';
    if (!isGlobalRole && sessionBranch && existingBranch && existingBranch !== sessionBranch) {
      return NextResponse.json(
        { error: `Forbidden: Cannot modify client belonging to branch ${existingBranch}.` },
        { status: 403 }
      );
    }

    const body = await request.json();

    if (body.phone) {
      let formattedPhone = String(body.phone).trim();
      let phoneDigits = formattedPhone.replace(/\D/g, '');
      if (phoneDigits.length === 9 && phoneDigits.startsWith('7')) {
        formattedPhone = `0${phoneDigits}`;
        phoneDigits = formattedPhone.replace(/\D/g, '');
      } else if (phoneDigits.length === 11 && phoneDigits.startsWith('94')) {
        formattedPhone = `0${phoneDigits.substring(2)}`;
        phoneDigits = formattedPhone.replace(/\D/g, '');
      }
      if (phoneDigits.length < 10) {
        return NextResponse.json({ error: "invalid mobile number. Must be at least 10 digits (e.g. 0771234567)." }, { status: 400 });
      }
      body.phone = formattedPhone;
    }

    const updatePayload: Record<string, any> = {};
    if (body.nic !== undefined || body.national_id !== undefined || body.nationalId !== undefined) {
      updatePayload.national_id = body.nic || body.national_id || body.nationalId;
    }
    if (body.firstName !== undefined || body.first_name !== undefined) {
      updatePayload.first_name = body.firstName || body.first_name;
    }
    if (body.lastName !== undefined || body.last_name !== undefined) {
      updatePayload.last_name = body.lastName || body.last_name;
    }
    if (body.phone !== undefined) {
      updatePayload.phone = body.phone;
    }
    if (body.address !== undefined) {
      updatePayload.address = body.address;
    }
    if (body.nicImage !== undefined || body.nic_image !== undefined) {
      updatePayload.nic_image = body.nicImage || body.nic_image;
    }
    if (body.signatureImage !== undefined || body.signature_image !== undefined) {
      updatePayload.signature_image = body.signatureImage || body.signature_image;
    }
    if (body.status !== undefined) {
      updatePayload.status = body.status;
    }

    const { data, error } = await adminSupabase
      .from('clients')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (!error && data) {
      invalidateClientsCache();
      return NextResponse.json(data);
    }

    // Fallback: If column names differed, map to camelCase
    const camelFallback: Record<string, any> = {};
    if (updatePayload.national_id !== undefined) camelFallback.nationalId = updatePayload.national_id;
    if (updatePayload.first_name !== undefined) camelFallback.firstName = updatePayload.first_name;
    if (updatePayload.last_name !== undefined) camelFallback.lastName = updatePayload.last_name;
    if (updatePayload.phone !== undefined) camelFallback.phone = updatePayload.phone;
    if (updatePayload.address !== undefined) camelFallback.address = updatePayload.address;
    if (updatePayload.nic_image !== undefined) camelFallback.nic_image = updatePayload.nic_image;
    if (updatePayload.signature_image !== undefined) camelFallback.signature_image = updatePayload.signature_image;
    if (updatePayload.status !== undefined) camelFallback.status = updatePayload.status;

    const { data: camelData, error: camelErr } = await adminSupabase
      .from('clients')
      .update(camelFallback)
      .eq('id', id)
      .select()
      .single();

    if (camelErr) throw error || camelErr;
    invalidateClientsCache();
    return NextResponse.json(camelData);
  } catch (error: any) {
    console.error("API PATCH Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: any) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (session.role === 'TELLER' || session.role === 'AUDITOR') {
      return NextResponse.json({ 
        error: 'Direct customer deletion is strictly prohibited for this role. Please submit a Change Request Ticket.' 
      }, { status: 403 });
    }

    const { id } = await context.params;
    const { data: existingClient } = await adminSupabase
      .from('clients')
      .select('id, branch_id')
      .eq('id', id)
      .maybeSingle();
    if (!existingClient) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    const sessionBranch = session.branchId ? normalizeBranchId(session.branchId) : '';
    const isGlobalRole = session.role === 'ADMIN' || sessionBranch === 'HQ';
    const existingBranch = existingClient.branch_id ? normalizeBranchId(existingClient.branch_id) : '';
    if (!isGlobalRole && sessionBranch && existingBranch && existingBranch !== sessionBranch) {
      return NextResponse.json(
        { error: `Forbidden: Cannot delete client belonging to branch ${existingBranch}.` },
        { status: 403 }
      );
    }

    const { error } = await adminSupabase
      .from('clients')
      .delete()
      .eq('id', id);

    if (error) throw error;
    invalidateClientsCache();
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("API DELETE Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
