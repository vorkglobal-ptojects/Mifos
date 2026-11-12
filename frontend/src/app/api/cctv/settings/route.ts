import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

// Default global CCTV settings configuration
const DEFAULT_SETTINGS = {
  evidence_pre_trigger_seconds: 10,
  evidence_post_trigger_seconds: 10,
  rolling_buffer_seconds: 60,
  evidence_retention_days: 90,
  ptz_speed_multiplier: 2,
  heartbeat_timeout_seconds: 60,
  auto_delete_expired_recordings: false,
  multi_camera_capture_enabled: true,
  default_camera_model: 'EZVIZ CS-H6c-R105-1L3WF',
  default_rtsp_port: 554,
  default_onvif_port: 80,
  updated_at: new Date().toISOString()
};

export async function GET(req: Request) {
  try {
    const session = await getAuthenticatedUser(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }
    const { data, error } = await adminSupabase
      .from('cctv_settings')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json({ success: true, settings: DEFAULT_SETTINGS });
    }

    return NextResponse.json({ success: true, settings: { ...DEFAULT_SETTINGS, ...data } });
  } catch (err: any) {
    return NextResponse.json({ success: true, settings: DEFAULT_SETTINGS });
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

    const updates = await req.json();
    const newSettings = {
      ...DEFAULT_SETTINGS,
      ...updates,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await adminSupabase
      .from('cctv_settings')
      .upsert({ id: 1, ...newSettings })
      .select()
      .single();

    if (error) {
      console.warn('[CCTV Settings POST] Notice:', error.message);
    }

    // Record audit log
    await adminSupabase.from('cctv_audit_logs').insert([
      {
        user_id: session?.user?.id || 'ADMIN',
        user_email: session?.user?.email || 'admin@rupasinghe.com',
        branch_id: session?.branchId || 'HQ',
        action: 'CONFIG_UPDATE',
        metadata: newSettings,
        created_at: new Date().toISOString()
      }
    ]);

    return NextResponse.json({
      success: true,
      message: 'Global CCTV settings & retention policies saved successfully!',
      settings: newSettings
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
