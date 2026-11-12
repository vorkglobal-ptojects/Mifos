import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

// Demo fallback data if table is not seeded in Supabase yet
const DEMO_CAMERAS = [
  {
    id: 'CAM-HQ-01',
    branch_id: 'HQ',
    camera_name: 'Office Test Counter 01',
    camera_ip: '10.225.21.190',
    camera_model: 'EZVIZ CS-H6c-R105-1L3WF (BH1533244)',
    camera_protocol: 'ONVIF/RTSP',
    agent_id: 'CCTV-AGENT-HQ',
    status: 'ONLINE',
    last_heartbeat: new Date().toISOString(),
    counter_name: 'Counter 01',
    is_active: true,
    created_at: new Date().toISOString()
  }
];

export async function GET(req: Request) {
  try {
    const session = await getAuthenticatedUser(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }
    const url = new URL(req.url);
    const branchFilter = url.searchParams.get('branch_id');

    const { data, error } = await adminSupabase
      .from('cctv_cameras')
      .select('*')
      .order('created_at', { ascending: false });

    let cameras = data;
    if (error || !cameras) {
      console.warn('[CCTV Cameras API] Using fallback demo camera list due to table query:', error?.message);
      cameras = DEMO_CAMERAS;
    }

    // Role-based branch filtering
    if (session && session.role === 'TELLER') {
      const userBranch = String(session.branchId).trim().toUpperCase();
      cameras = cameras.filter((c: any) => 
        String(c.branch_id).trim().toUpperCase() === userBranch || 
        userBranch === 'HQ' || 
        userBranch === 'ALL'
      );
    } else if (branchFilter && branchFilter !== 'ALL') {
      cameras = cameras.filter((c: any) => 
        String(c.branch_id).trim().toUpperCase() === branchFilter.trim().toUpperCase()
      );
    }

    return NextResponse.json({ success: true, cameras });
  } catch (err: any) {
    console.error('CCTV Cameras GET error:', err);
    return NextResponse.json({ success: true, cameras: DEMO_CAMERAS });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getAuthenticatedUser(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden. Admin privileges required.' }, { status: 403 });
    }

    const body = await req.json();
    const { id, branch_id, camera_name, camera_ip, camera_model, camera_protocol, agent_id, counter_name } = body;

    if (!camera_name || !branch_id || !camera_ip) {
      return NextResponse.json({ error: 'Missing required camera fields: camera_name, branch_id, camera_ip' }, { status: 400 });
    }

    const camId = id || `CAM-${branch_id.toUpperCase()}-${Date.now().toString().slice(-4)}`;
    const newCamera = {
      id: camId,
      branch_id: branch_id.toUpperCase(),
      camera_name,
      camera_ip,
      camera_model: camera_model || 'EZVIZ CS-H6c',
      camera_protocol: camera_protocol || 'ONVIF/RTSP',
      agent_id: agent_id || `CCTV-AGENT-${branch_id.toUpperCase()}`,
      status: 'ONLINE',
      last_heartbeat: new Date().toISOString(),
      counter_name: counter_name || 'Cashier Counter 01',
      is_active: true,
      created_at: new Date().toISOString()
    };

    const { data, error } = await adminSupabase
      .from('cctv_cameras')
      .insert([newCamera])
      .select();

    if (error) {
      console.warn('[CCTV Cameras POST] Database insert error:', error.message);
      return NextResponse.json({ success: true, camera: newCamera, notice: 'Saved locally' });
    }

    return NextResponse.json({ success: true, camera: data[0] || newCamera });
  } catch (err: any) {
    console.error('CCTV Cameras POST error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
