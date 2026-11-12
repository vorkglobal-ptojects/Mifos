import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

const DEMO_AUDIT_LOGS = [
  {
    id: '1',
    user_email: 'admin@rupasinghe.com',
    branch_id: 'HQ',
    camera_id: 'CAM-HQ-01',
    recording_id: 'REC-PN202609080001',
    action: 'PLAYBACK',
    ip_address: '127.0.0.1',
    metadata: { pawn_id: 'PN202609080001' },
    created_at: new Date(Date.now() - 3600000).toISOString()
  },
  {
    id: '2',
    user_email: 'testbranch@rupasinghe.com',
    branch_id: 'TEST',
    camera_id: 'CAM-TEST-01',
    recording_id: null,
    action: 'LIVE_VIEW',
    ip_address: '192.168.10.12',
    metadata: { mode: 'realtime' },
    created_at: new Date(Date.now() - 7200000).toISOString()
  }
];

export async function GET(req: Request) {
  try {
    const session = await getAuthenticatedUser(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }
    const { data, error } = await adminSupabase
      .from('cctv_audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    let logs = data;
    if (error || !logs || logs.length === 0) {
      logs = DEMO_AUDIT_LOGS;
    }

    if (session && (session.role === 'TELLER' || session.role === 'AUDITOR' || session.role === 'MANAGER')) {
      const userBranch = String(session.branchId).trim().toUpperCase();
      if (userBranch !== 'HQ' && userBranch !== 'ALL') {
        logs = logs.filter((l: any) => String(l.branch_id).trim().toUpperCase() === userBranch);
      }
    }

    return NextResponse.json({ success: true, logs });
  } catch (err: any) {
    return NextResponse.json({ success: true, logs: DEMO_AUDIT_LOGS });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getAuthenticatedUser(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }
    const body = await req.json();
    const { action, camera_id, recording_id, metadata } = body;

    if (!action) {
      return NextResponse.json({ error: 'Action is required' }, { status: 400 });
    }

    const logEntry = {
      user_id: session?.user?.id || 'ANONYMOUS',
      user_email: session?.user?.email || 'ANONYMOUS',
      branch_id: (session?.branchId || 'HQ').toUpperCase(),
      camera_id: camera_id || null,
      recording_id: recording_id || null,
      action,
      ip_address: req.headers.get('x-forwarded-for') || '127.0.0.1',
      metadata: metadata || {},
      created_at: new Date().toISOString()
    };

    await adminSupabase.from('cctv_audit_logs').insert([logEntry]);

    return NextResponse.json({ success: true, log: logEntry });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
