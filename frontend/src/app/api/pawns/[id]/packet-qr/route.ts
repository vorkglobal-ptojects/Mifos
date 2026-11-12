import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

const isUUID = (str: string) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(str);

// Extract clean bill number if QR string has structured format e.g. "BILL: BRL-0001 | BRANCH: ..."
export function extractBillNoFromQr(qrText: string): string | null {
  if (!qrText) return null;
  const billMatch = qrText.match(/BILL:\s*([A-Za-z0-9\-_]+)/i);
  if (billMatch && billMatch[1]) {
    return billMatch[1].trim();
  }
  return null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthenticatedUser(request);
    const { id } = await params;

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }

    // Role check: Only AUDITOR and ADMIN can add/update packet sticker QR
    if (session.role !== 'AUDITOR' && session.role !== 'ADMIN') {
      return NextResponse.json({ 
        error: `Forbidden. Only users with the AUDITOR role are permitted to assign or modify packet sticker QR codes.` 
      }, { status: 403 });
    }

    const body = await request.json();
    const { packet_qr, notes, branch_id } = body;

    if (!packet_qr || typeof packet_qr !== 'string' || packet_qr.trim() === '') {
      return NextResponse.json({ error: 'Valid packet QR or barcode content is required.' }, { status: 400 });
    }

    const cleanPacketQr = packet_qr.trim();

    // 1. Fetch Pawn Details by unique UUID or (bill_no + branch_id)
    let query = adminSupabase.from('pawns').select('*');
    if (isUUID(id)) {
      query = query.eq('id', id);
    } else {
      query = query.eq('bill_no', id);
      const targetBranch = branch_id || (session.branchId && session.branchId !== 'HQ' && session.branchId !== 'ALL' ? session.branchId : null);
      if (targetBranch) {
        query = query.eq('branch_id', targetBranch);
      }
    }
    const { data: pawn, error: fetchErr } = await query.maybeSingle();

    if (fetchErr || !pawn) {
      return NextResponse.json({ error: 'Pawn ticket not found in specified branch.' }, { status: 404 });
    }

    const cleanBill = pawn.bill_no || pawn.id.substring(0, 8).toUpperCase();
    const auditorId = session.user?.id || (session as any).id || 'AUDITOR';
    const auditorEmail = session.user?.email || (session as any).email || 'auditor@mifos.lk';
    const branchId = pawn.branch_id || session.branchId || 'HQ';
    const timestamp = new Date().toISOString();

    // 2. Record packet sticker binding in immutable audit_logs
    const packetPayload = {
      pawn_id: pawn.id,
      bill_no: cleanBill,
      packet_qr: cleanPacketQr,
      notes: notes || '',
      attached_by: auditorEmail,
      attached_by_role: session.role,
      branch_id: branchId,
      scanned_at: timestamp
    };

    const { error: logErr } = await adminSupabase
      .from('audit_logs')
      .insert([{
        user_id: auditorId,
        user_email: auditorEmail,
        role: session.role,
        branch_id: branchId,
        action: 'PACKET_STICKER_ATTACHED',
        resource: cleanBill,
        details: packetPayload,
        created_at: timestamp
      }]);

    if (logErr) {
      console.error('Error inserting audit log for packet sticker:', logErr);
    }

    // 3. Attempt direct update on pawns table if column exists
    try {
      await adminSupabase
        .from('pawns')
        .update({ packet_qr: cleanPacketQr })
        .eq('id', pawn.id);
    } catch (colErr) {
      console.warn('Direct column update failed (column may not exist yet, using audit_logs):', colErr);
    }

    return NextResponse.json({
      success: true,
      message: `Packet sticker QR saved successfully for Bill #${cleanBill}.`,
      bill_no: cleanBill,
      pawn_id: pawn.id,
      packet_qr: cleanPacketQr,
      scanned_at: timestamp,
      attached_by: auditorEmail
    });
  } catch (err: any) {
    console.error('POST /api/pawns/[id]/packet-qr error:', err);
    return NextResponse.json({ error: err.message || 'Failed to save packet sticker QR' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthenticatedUser(request);
    const { id } = await params;

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }

    // Role check: Only AUDITOR and ADMIN can delete packet sticker QR
    if (session.role !== 'AUDITOR' && session.role !== 'ADMIN') {
      return NextResponse.json({ 
        error: `Forbidden. Only users with the AUDITOR role are permitted to delete packet sticker QR codes.` 
      }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const branch_id = searchParams.get('branch_id');

    // 1. Fetch Pawn Details by UUID or (bill_no + branch_id)
    let query = adminSupabase.from('pawns').select('*');
    if (isUUID(id)) {
      query = query.eq('id', id);
    } else {
      query = query.eq('bill_no', id);
      const targetBranch = branch_id || (session.branchId && session.branchId !== 'HQ' && session.branchId !== 'ALL' ? session.branchId : null);
      if (targetBranch) {
        query = query.eq('branch_id', targetBranch);
      }
    }
    const { data: pawn, error: fetchErr } = await query.maybeSingle();

    if (fetchErr || !pawn) {
      return NextResponse.json({ error: 'Pawn ticket not found.' }, { status: 404 });
    }

    const cleanBill = pawn.bill_no || pawn.id.substring(0, 8).toUpperCase();
    const auditorId = session.user?.id || (session as any).id || 'AUDITOR';
    const auditorEmail = session.user?.email || (session as any).email || 'auditor@mifos.lk';
    const branchId = pawn.branch_id || session.branchId || 'HQ';
    const timestamp = new Date().toISOString();

    // 2. Record deletion in immutable audit_logs
    const deletePayload = {
      pawn_id: pawn.id,
      bill_no: cleanBill,
      previous_packet_qr: (pawn as any).packet_qr || null,
      deleted_by: auditorEmail,
      deleted_by_role: session.role,
      branch_id: branchId,
      deleted_at: timestamp
    };

    await adminSupabase
      .from('audit_logs')
      .insert([{
        user_id: auditorId,
        user_email: auditorEmail,
        role: session.role,
        branch_id: branchId,
        action: 'PACKET_STICKER_DELETED',
        resource: cleanBill,
        details: deletePayload,
        created_at: timestamp
      }]);

    // 3. Clear column on pawns table
    try {
      await adminSupabase
        .from('pawns')
        .update({ packet_qr: null })
        .eq('id', pawn.id);
    } catch (colErr) {
      console.warn('Direct column update failed:', colErr);
    }

    return NextResponse.json({
      success: true,
      message: `Packet sticker QR code successfully deleted for Bill #${cleanBill}.`,
      bill_no: cleanBill
    });
  } catch (err: any) {
    console.error('DELETE /api/pawns/[id]/packet-qr error:', err);
    return NextResponse.json({ error: err.message || 'Failed to delete packet sticker QR' }, { status: 500 });
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const branch_id = searchParams.get('branch_id');

    // 1. Fetch Pawn Details
    let query = adminSupabase.from('pawns').select('*');
    if (isUUID(id)) {
      query = query.eq('id', id);
    } else {
      query = query.eq('bill_no', id);
      if (branch_id) {
        query = query.eq('branch_id', branch_id);
      }
    }
    const { data: pawn, error: fetchErr } = await query.maybeSingle();

    if (fetchErr || !pawn) {
      return NextResponse.json({ error: 'Pawn ticket not found.' }, { status: 404 });
    }

    const cleanBill = pawn.bill_no || pawn.id.substring(0, 8).toUpperCase();

    // Check latest audit_logs strictly for this pawn's UUID or branch + bill
    const { data: logs } = await adminSupabase
      .from('audit_logs')
      .select('*')
      .in('action', ['PACKET_STICKER_ATTACHED', 'PACKET_STICKER_DELETED'])
      .order('created_at', { ascending: false })
      .limit(50);

    const latest = (logs || []).find((l: any) => {
      if (l.details?.pawn_id && l.details.pawn_id === pawn.id) return true;
      if (l.branch_id === pawn.branch_id && (l.resource === cleanBill || l.details?.bill_no === cleanBill)) return true;
      return false;
    });
    if (latest) {
      if (latest.action === 'PACKET_STICKER_DELETED') {
        return NextResponse.json({
          bill_no: cleanBill,
          packet_qr: null,
          deleted_at: latest.created_at,
          deleted_by: latest.user_email
        });
      }
      return NextResponse.json({
        bill_no: cleanBill,
        packet_qr: latest.details?.packet_qr || null,
        scanned_at: latest.details?.scanned_at || latest.created_at || null,
        attached_by: latest.details?.attached_by || latest.user_email || null
      });
    }

    // Check if column has it
    if ((pawn as any).packet_qr) {
      return NextResponse.json({
        bill_no: cleanBill,
        packet_qr: (pawn as any).packet_qr,
        attached_at: pawn.created_at
      });
    }

    return NextResponse.json({
      bill_no: cleanBill,
      packet_qr: null
    });
  } catch (err: any) {
    console.error('GET /api/pawns/[id]/packet-qr error:', err);
    return NextResponse.json({ error: err.message || 'Failed to retrieve packet QR' }, { status: 500 });
  }
}
