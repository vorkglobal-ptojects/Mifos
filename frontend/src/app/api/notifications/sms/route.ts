import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { recordAuditLog } from '@/lib/audit-logger';
import { sendFreeSms } from '@/lib/sms';

export const dynamic = 'force-dynamic';

/**
 * Dispatches automated SMS receipts via local Android SIM SMS Gateway
 */
export async function POST(req: Request) {
  try {
    const session = await getAuthenticatedUser(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }
    if (session.role === 'AUDITOR') {
      return NextResponse.json({ error: 'Forbidden. Auditors cannot dispatch SMS alerts.' }, { status: 403 });
    }
    const body = await req.json();
    const { phone, message, ticketNo, amount, type } = body;

    if (!phone || !message) {
      return NextResponse.json({ error: 'Phone number and message are required' }, { status: 400 });
    }

    const result = await sendFreeSms({
      phone,
      message,
      ticketNo,
      amount,
      type: type || 'RECEIPT',
      branchId: session?.branchId || 'HQ'
    });

    if (session) {
      await recordAuditLog(session, {
        action: 'SMS_DISPATCH',
        resource: `sms:${result.phone || phone}`,
        details: { phone: result.phone || phone, ticketNo, amount, status: result.status, notice: result.notice }
      });
    }

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('Error in /api/notifications/sms:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * GET handler to check SMS logs and gateway configuration
 */
export async function GET(req: Request) {
  try {
    const session = await getAuthenticatedUser(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }

    const { data: logs } = await adminSupabase
      .from('sms_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    const { data: settingsData } = await adminSupabase
      .from('system_settings')
      .select('value')
      .eq('key', 'sms_gateway_config')
      .single();

    const { data: branchesData } = await adminSupabase
      .from('branches')
      .select('*')
      .order('name', { ascending: true });

    const isAdmin = session.role === 'ADMIN';
    const rawConfig = settingsData?.value || {
      enabled: true,
      provider: 'TEXTBEE',
      deviceId: '6aa2895cccb6c72709fa5556',
      apiKey: 'txb_SQX87S1btDchmgxYURa40D3I3WEjxSqg',
      gatewayUrl: 'https://api.textbee.dev/api/v1/gateway/devices/6aa2895cccb6c72709fa5556/send-sms',
      simSlot: 1,
      branches: {}
    };

    const safeConfig = isAdmin
      ? rawConfig
      : { ...rawConfig, apiKey: rawConfig.apiKey ? '***REDACTED***' : '', branches: {} };

    return NextResponse.json({
      logs: logs || [],
      isAdmin,
      userBranchId: session.branchId || 'HQ',
      branches: branchesData || [{ id: 'HQ', name: 'Head Office' }],
      config: safeConfig
    });
  } catch (err: any) {
    return NextResponse.json({ logs: [], config: {}, branches: [], isAdmin: false });
  }
}
