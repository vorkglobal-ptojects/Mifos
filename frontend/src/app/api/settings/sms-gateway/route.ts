import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { recordAuditLog } from '@/lib/audit-logger';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const session = await getAuthenticatedUser(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden. Only Admins can modify SMS Gateway settings.' }, { status: 403 });
    }

    const body = await req.json();
    const { branchId, branchName, email, deviceId, gatewayUrl, apiKey, simSlot, enabled } = body;

    // Fetch existing settings to preserve other branch configs
    const { data: existingData } = await adminSupabase
      .from('system_settings')
      .select('value')
      .eq('key', 'sms_gateway_config')
      .single();

    const existingConfig = existingData?.value || {
      enabled: true,
      provider: 'TEXTBEE',
      deviceId: '6aa2895cccb6c72709fa5556',
      apiKey: 'txb_SQX87S1btDchmgxYURa40D3I3WEjxSqg',
      gatewayUrl: 'https://api.textbee.dev/api/v1/gateway/devices/6aa2895cccb6c72709fa5556/send-sms',
      simSlot: 1,
      branches: {}
    };

    const updatedBranches = { ...(existingConfig.branches || {}) };

    if (branchId) {
      // Update specific branch config
      updatedBranches[branchId] = {
        branchId,
        branchName: branchName || branchId,
        email: email || '',
        deviceId: deviceId || '',
        apiKey: apiKey || '',
        gatewayUrl: gatewayUrl || (deviceId ? `https://api.textbee.dev/api/v1/gateway/devices/${deviceId}/send-sms` : ''),
        simSlot: parseInt(simSlot) || 1,
        enabled: enabled !== false,
        updatedAt: new Date().toISOString()
      };
    }

    const configValue = {
      ...existingConfig,
      gatewayUrl: !branchId ? (gatewayUrl || existingConfig.gatewayUrl) : existingConfig.gatewayUrl,
      apiKey: !branchId ? (apiKey || existingConfig.apiKey) : existingConfig.apiKey,
      deviceId: !branchId ? (deviceId || existingConfig.deviceId) : existingConfig.deviceId,
      simSlot: !branchId ? (parseInt(simSlot) || existingConfig.simSlot || 1) : existingConfig.simSlot,
      enabled: !branchId ? (enabled !== false) : existingConfig.enabled,
      branches: updatedBranches,
      updatedAt: new Date().toISOString()
    };

    const { data, error } = await adminSupabase
      .from('system_settings')
      .upsert({
        key: 'sms_gateway_config',
        value: configValue,
        updated_at: new Date().toISOString()
      }, { onConflict: 'key' })
      .select()
      .single();

    if (error) {
      throw error;
    }

    if (session) {
      await recordAuditLog(session, {
        action: 'UPDATE_SMS_GATEWAY_CONFIG',
        resource: 'system_settings:sms_gateway_config',
        details: { branchId: branchId || 'GLOBAL', config: configValue }
      });
    }

    return NextResponse.json({ success: true, config: configValue });

  } catch (err: any) {
    console.error('Error in /api/settings/sms-gateway:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
