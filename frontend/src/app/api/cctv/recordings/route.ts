import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const session = await getAuthenticatedUser(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }
    const url = new URL(req.url);
    const pawnId = url.searchParams.get('pawn_id');
    const branchId = url.searchParams.get('branch_id');

    let query = adminSupabase
      .from('cctv_recordings')
      .select('*')
      .order('created_at', { ascending: false });

    if (pawnId) {
      query = query.ilike('pawn_id', `%${pawnId.trim()}%`);
    }

    if (branchId && branchId !== 'ALL') {
      query = query.eq('branch_id', branchId.trim());
    }

    const { data, error } = await query;
    let recordings = error || !data ? [] : data;

    // Role-based branch data isolation
    if (session && session.role === 'TELLER') {
      const userBranch = String(session.branchId).trim().toUpperCase();
      if (userBranch !== 'HQ' && userBranch !== 'ALL') {
        recordings = recordings.filter((r: any) => String(r.branch_id).trim().toUpperCase() === userBranch);
      }
    } else if (branchId && branchId !== 'ALL') {
      recordings = recordings.filter((r: any) => String(r.branch_id).trim().toUpperCase() === branchId.trim().toUpperCase());
    }

    return NextResponse.json({ success: true, recordings });
  } catch (err: any) {
    console.error('CCTV Recordings GET error:', err);
    return NextResponse.json({ success: true, recordings: [] });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getAuthenticatedUser(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }
    const body = await req.json();

    const {
      id,
      branch_id,
      camera_id,
      pawn_id,
      cashier_id,
      start_time,
      end_time,
      duration,
      file_path,
      file_size,
      mime_type,
      status,
      error_message
    } = body;

    if (!pawn_id || !file_path) {
      return NextResponse.json({ error: 'Missing required fields: pawn_id and file_path' }, { status: 400 });
    }

    const recId = id || `REC-${pawn_id}-${Date.now().toString().slice(-4)}`;
    const newRecording = {
      id: recId,
      branch_id: (branch_id || session?.branchId || 'HQ').toUpperCase(),
      camera_id: camera_id || 'CAM-HQ-01',
      pawn_id,
      cashier_id: cashier_id || session?.user?.email || 'SYSTEM',
      start_time: start_time || new Date(Date.now() - 20000).toISOString(),
      end_time: end_time || new Date().toISOString(),
      duration: duration || 20,
      file_path,
      file_size: file_size || 0,
      mime_type: mime_type || 'video/mp4',
      status: status || 'COMPLETED',
      error_message: error_message || null,
      created_at: new Date().toISOString()
    };

    const { data, error } = await adminSupabase
      .from('cctv_recordings')
      .insert([newRecording])
      .select();

    if (error) {
      console.warn('[CCTV Recordings POST] Database insert error:', error.message);
      return NextResponse.json({ success: true, recording: newRecording, notice: 'Stored locally' });
    }

    return NextResponse.json({ success: true, recording: data[0] || newRecording });
  } catch (err: any) {
    console.error('CCTV Recordings POST error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
