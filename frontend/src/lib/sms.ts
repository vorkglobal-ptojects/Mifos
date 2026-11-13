import { adminSupabase } from '@/lib/auth-server';
import { getBranchSearchTerms, normalizeBranchId } from '@/lib/branch-mapping';
import {
  DEFAULT_SMS_TRIGGERS,
  SmsTemplateKey,
  SmsTemplatesConfig,
  SmsTriggerKey,
  SmsTriggersConfig,
  SmsType,
  normalizeSriLankaPhone,
} from '@/lib/sms-templates';

export * from '@/lib/sms-templates';

export interface BranchSmsConfig {
  branchId: string;
  branchName?: string;
  email?: string;
  deviceId?: string;
  apiKey?: string;
  gatewayUrl?: string;
  simSlot?: number;
  enabled?: boolean;
  updatedAt?: string;
}

export interface SmsGatewayConfig {
  enabled: boolean;
  provider: 'TEXTBEE';
  email?: string;
  deviceId: string;
  apiKey: string;
  gatewayUrl: string;
  simSlot: number;
  branches: Record<string, BranchSmsConfig>;
  triggers: SmsTriggersConfig;
  templates: SmsTemplatesConfig;
  updatedAt?: string;
}

export interface SendSmsParams {
  phone: string;
  message: string;
  ticketNo?: string;
  amount?: number;
  type?: SmsType;
  branchId?: string;
  forceGlobal?: boolean;
  triggerKey?: SmsTriggerKey;
  skipTriggerCheck?: boolean;
  dryRun?: boolean;
}

export interface SendSmsResult {
  success: boolean;
  status: 'SENT' | 'QUEUED' | 'FAILED' | 'DISABLED' | 'INVALID_PHONE' | 'NOT_CONFIGURED' | 'SKIPPED';
  logId?: string | null;
  phone: string;
  branchId?: string;
  notice?: string;
  error?: string;
  httpStatus?: number | null;
  usedBranchDevice?: boolean;
}

export interface TextBeeHealthStatus {
  configured: boolean;
  enabled: boolean;
  online: boolean;
  status: 'ONLINE' | 'STALE' | 'DISABLED' | 'ERROR' | 'NOT_CONFIGURED';
  branchId: string;
  usedBranchDevice: boolean;
  deviceIdTail?: string;
  brand?: string | null;
  model?: string | null;
  osVersion?: string | null;
  appVersion?: string | null;
  lastHeartbeat?: string | null;
  heartbeatAgeMinutes?: number | null;
  batteryPercentage?: number | null;
  isCharging?: boolean | null;
  networkType?: string | null;
  sentSMSCount?: number | null;
  sims?: Array<{ slot: number; carrier: string; displayName: string }>;
  error?: string | null;
}

export function maskApiKey(key?: string | null): string {
  if (!key || !key.trim()) return '';
  const trimmed = key.trim();
  if (trimmed.length <= 4) return '••••';
  return `••••${trimmed.slice(-4)}`;
}

export function buildTextBeeSendUrl(deviceId: string): string {
  return `https://api.textbee.dev/api/v1/gateway/devices/${encodeURIComponent(deviceId)}/send-sms`;
}

export async function getSmsGatewayConfig(): Promise<SmsGatewayConfig> {
  const { data: settingsData } = await adminSupabase
    .from('system_settings')
    .select('value')
    .eq('key', 'sms_gateway_config')
    .maybeSingle();

  const raw = (settingsData?.value && typeof settingsData.value === 'object') ? settingsData.value : {};
  const envDeviceId = process.env.TEXTBEE_DEVICE_ID || '';
  const envApiKey = process.env.TEXTBEE_API_KEY || '';
  const deviceId = String(raw.deviceId || envDeviceId || '').trim();
  const apiKey = String(raw.apiKey || envApiKey || '').trim();
  const gatewayUrl = String(raw.gatewayUrl || (deviceId ? buildTextBeeSendUrl(deviceId) : '')).trim();

  const rawTriggers = (raw.triggers && typeof raw.triggers === 'object') ? raw.triggers : {};
  const triggers: SmsTriggersConfig = {
    onPawnCreate: rawTriggers.onPawnCreate !== false,
    onPawnApprove: rawTriggers.onPawnApprove !== false,
    onPawnReject: rawTriggers.onPawnReject === true,
    onPawnRedeem: rawTriggers.onPawnRedeem !== false,
    onInterestPayment: rawTriggers.onInterestPayment !== false,
    onForfeitureWarning: rawTriggers.onForfeitureWarning !== false,
  };

  const templates: SmsTemplatesConfig = {};
  if (raw.templates && typeof raw.templates === 'object') {
    for (const key of ['RECEIPT', 'APPROVED', 'REJECTED', 'INTEREST', 'REDEEM', 'REMINDER', 'FORFEITURE'] as SmsTemplateKey[]) {
      if (typeof raw.templates[key] === 'string' && raw.templates[key].trim()) {
        templates[key] = raw.templates[key];
      }
    }
  }

  return {
    enabled: raw.enabled !== false,
    provider: 'TEXTBEE',
    email: String(raw.email || '').trim(),
    deviceId,
    apiKey,
    gatewayUrl,
    simSlot: Number(raw.simSlot) || 1,
    branches: (raw.branches && typeof raw.branches === 'object') ? raw.branches : {},
    triggers,
    templates,
    updatedAt: raw.updatedAt,
  };
}

export function isAutoTriggerEnabled(config: SmsGatewayConfig, triggerKey?: SmsTriggerKey): boolean {
  if (!triggerKey) return true;
  return config?.triggers?.[triggerKey] ?? DEFAULT_SMS_TRIGGERS[triggerKey];
}

export function findBranchConfig(
  branches: Record<string, BranchSmsConfig>,
  branchId?: string | null
): { key: string; config: BranchSmsConfig } | null {
  if (!branchId || !branches) return null;
  const trimmed = String(branchId).trim();
  if (!trimmed || trimmed.toUpperCase() === 'GLOBAL') return null;

  if (branches[trimmed]) return { key: trimmed, config: branches[trimmed] };
  const normTarget = normalizeBranchId(trimmed);
  if (branches[normTarget]) return { key: normTarget, config: branches[normTarget] };

  const searchTerms = getBranchSearchTerms(normTarget).map((t) => t.toUpperCase());
  for (const [k, v] of Object.entries(branches)) {
    if (!v) continue;
    if (normalizeBranchId(k) === normTarget || searchTerms.includes(k.toUpperCase())) {
      return { key: k, config: v };
    }
  }
  return null;
}

export function resolveBranchSmsConfig(
  globalConfig: SmsGatewayConfig,
  branchId?: string | null,
  forceGlobal = false
) {
  const normBranch = !branchId || String(branchId).toUpperCase() === 'GLOBAL'
    ? 'HQ'
    : normalizeBranchId(branchId);

  const matched = forceGlobal ? null : findBranchConfig(globalConfig.branches, normBranch);
  const branchConfig = matched?.config || null;
  const hasCustomDevice = Boolean(branchConfig?.deviceId && branchConfig.deviceId.trim());
  const targetDeviceId = hasCustomDevice ? branchConfig!.deviceId!.trim() : globalConfig.deviceId;
  const targetApiKey = (branchConfig?.apiKey && branchConfig.apiKey.trim())
    ? branchConfig.apiKey.trim()
    : globalConfig.apiKey;
  const targetSimSlot = Number(branchConfig?.simSlot || globalConfig.simSlot || 1) || 1;
  const targetEnabled = branchConfig
    ? (branchConfig.enabled !== false && globalConfig.enabled !== false)
    : globalConfig.enabled !== false;

  const targetUrl = targetDeviceId ? buildTextBeeSendUrl(targetDeviceId) : '';

  return {
    normBranch,
    branchConfig,
    hasCustomDevice,
    targetDeviceId,
    targetApiKey,
    targetSimSlot,
    targetEnabled,
    targetUrl,
  };
}

export function sanitizeSmsGatewayConfig(config: SmsGatewayConfig, isAdmin: boolean) {
  const sanitizedBranches: Record<string, any> = {};
  if (isAdmin && config.branches) {
    for (const [k, b] of Object.entries(config.branches)) {
      if (!b) continue;
      const keyStr = b.apiKey || '';
      sanitizedBranches[k] = {
        branchId: b.branchId || k,
        branchName: b.branchName || k,
        email: b.email || '',
        deviceId: b.deviceId || '',
        hasApiKey: Boolean(keyStr),
        maskedApiKey: maskApiKey(keyStr),
        gatewayUrl: b.deviceId ? buildTextBeeSendUrl(b.deviceId) : (b.gatewayUrl || ''),
        simSlot: Number(b.simSlot) || 1,
        enabled: b.enabled !== false,
        updatedAt: b.updatedAt || null,
      };
    }
  }

  return {
    enabled: config.enabled !== false,
    provider: 'TEXTBEE' as const,
    email: isAdmin ? (config.email || '') : '',
    deviceId: isAdmin ? config.deviceId : '',
    hasApiKey: Boolean(config.apiKey),
    maskedApiKey: isAdmin ? maskApiKey(config.apiKey) : '',
    gatewayUrl: isAdmin && config.deviceId ? buildTextBeeSendUrl(config.deviceId) : '',
    simSlot: config.simSlot || 1,
    branches: sanitizedBranches,
    configuredBranchCount: Object.values(config.branches || {}).filter((b) => Boolean(b?.deviceId)).length,
    triggers: config.triggers,
    templates: isAdmin ? config.templates : {},
    updatedAt: config.updatedAt || null,
  };
}

async function dispatchToTextBeeApi(params: {
  deviceId: string;
  apiKey: string;
  phone: string;
  message: string;
  dryRun?: boolean;
}) {
  const { deviceId, apiKey, phone, message, dryRun } = params;
  const endpoint = buildTextBeeSendUrl(deviceId);

  if (dryRun) {
    return {
      ok: true,
      transientFailure: false,
      httpStatus: 200,
      responseBody: { dryRun: true, message: 'Dry run simulation' },
      notice: 'Dry-run simulation OK',
      error: null as string | null,
    };
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        recipients: [phone],
        message,
      }),
      signal: AbortSignal.timeout(8000),
    });

    const rawText = await res.text();
    let parsed: any = rawText;
    try {
      parsed = JSON.parse(rawText);
    } catch {}

    if (res.ok) {
      return {
        ok: true,
        transientFailure: false,
        httpStatus: res.status,
        responseBody: parsed,
        notice: 'Dispatched via TextBee Android SIM Gateway.',
        error: null as string | null,
      };
    }

    const errMsg = typeof parsed === 'object' && parsed !== null
      ? (parsed.message || parsed.error || JSON.stringify(parsed))
      : rawText;

    return {
      ok: false,
      transientFailure: res.status >= 500 || res.status === 429,
      httpStatus: res.status,
      responseBody: parsed,
      notice: `TextBee HTTP ${res.status}: ${String(errMsg).slice(0, 200)}`,
      error: String(errMsg).slice(0, 300),
    };
  } catch (err: any) {
    return {
      ok: false,
      transientFailure: true,
      httpStatus: null,
      responseBody: null,
      notice: `TextBee connection/timeout error: ${err?.message || 'Gateway unreachable'}`,
      error: err?.message || 'Gateway unreachable',
    };
  }
}

export async function sendFreeSms(params: SendSmsParams): Promise<SendSmsResult> {
  const {
    phone,
    message,
    ticketNo,
    amount,
    type = 'RECEIPT',
    branchId = 'HQ',
    forceGlobal = false,
    triggerKey,
    skipTriggerCheck = false,
    dryRun = false,
  } = params;

  if (!phone || !message || !message.trim()) {
    return { success: false, status: 'FAILED', phone: phone || '', error: 'Phone number and message are required.' };
  }

  const normalizedPhone = normalizeSriLankaPhone(phone);
  if (!normalizedPhone.valid) {
    return {
      success: false,
      status: 'INVALID_PHONE',
      phone: phone.trim(),
      branchId: normalizeBranchId(branchId),
      notice: normalizedPhone.reason,
      error: normalizedPhone.reason,
    };
  }

  try {
    const globalConfig = await getSmsGatewayConfig();
    if (triggerKey && !skipTriggerCheck && !isAutoTriggerEnabled(globalConfig, triggerKey)) {
      return {
        success: false,
        status: 'SKIPPED',
        phone: normalizedPhone.e164,
        branchId: normalizeBranchId(branchId),
        notice: `Auto-SMS trigger '${triggerKey}' is disabled.`,
      };
    }

    const resolved = resolveBranchSmsConfig(globalConfig, branchId, forceGlobal);
    if (!resolved.targetEnabled) {
      return {
        success: false,
        status: 'DISABLED',
        phone: normalizedPhone.e164,
        branchId: resolved.normBranch,
        notice: `SMS Gateway is disabled for branch ${resolved.normBranch}.`,
      };
    }

    if (!resolved.targetDeviceId || !resolved.targetApiKey) {
      const notice = `TextBee credentials not configured for branch ${resolved.normBranch}.`;
      const nowIso = new Date().toISOString();
      const { data: inserted } = await adminSupabase
        .from('sms_logs')
        .insert([{
          recipient_phone: normalizedPhone.e164,
          message_text: message,
          branch_id: resolved.normBranch,
          status: 'FAILED',
          gateway_response: {
            notice,
            error: notice,
            provider: 'TEXTBEE',
            ticket_no: ticketNo || null,
            amount: amount ?? null,
            type,
            attempts: 1,
            last_attempt_at: nowIso,
          },
          created_at: nowIso,
        }])
        .select('id')
        .maybeSingle();

      return {
        success: false,
        status: 'NOT_CONFIGURED',
        logId: inserted?.id || null,
        phone: normalizedPhone.e164,
        branchId: resolved.normBranch,
        notice,
        error: notice,
      };
    }

    const dispatchRes = await dispatchToTextBeeApi({
      deviceId: resolved.targetDeviceId,
      apiKey: resolved.targetApiKey,
      phone: normalizedPhone.e164,
      message,
      dryRun,
    });

    const finalStatus: 'SENT' | 'QUEUED' | 'FAILED' = dispatchRes.ok
      ? 'SENT'
      : dispatchRes.transientFailure
      ? 'QUEUED'
      : 'FAILED';

    const scopeLabel = forceGlobal
      ? 'Master Global Gateway'
      : resolved.hasCustomDevice
      ? `Branch [${resolved.normBranch}] SIM`
      : `Master Fallback (via ${resolved.normBranch})`;

    const fullNotice = dispatchRes.ok
      ? `SMS sent via ${scopeLabel}.`
      : `${scopeLabel} - ${dispatchRes.notice}`;

    const nowIso = new Date().toISOString();
    const { data: insertedLog, error: logErr } = await adminSupabase
      .from('sms_logs')
      .insert([{
        recipient_phone: normalizedPhone.e164,
        message_text: message,
        branch_id: resolved.normBranch,
        status: finalStatus,
        gateway_response: {
          notice: fullNotice,
          error: dispatchRes.error,
          http_status: dispatchRes.httpStatus,
          provider: 'TEXTBEE',
          device_id_tail: resolved.targetDeviceId.slice(-4),
          used_branch_device: resolved.hasCustomDevice,
          force_global: Boolean(forceGlobal),
          sim_slot: resolved.targetSimSlot,
          ticket_no: ticketNo || null,
          amount: amount ?? null,
          type,
          attempts: 1,
          last_attempt_at: nowIso,
          dry_run: Boolean(dryRun),
        },
        created_at: nowIso,
      }])
      .select('id')
      .maybeSingle();

    if (logErr) {
      console.warn('sms_logs insert notice:', logErr.message);
    }

    return {
      success: dispatchRes.ok,
      status: finalStatus,
      logId: insertedLog?.id || null,
      phone: normalizedPhone.e164,
      branchId: resolved.normBranch,
      notice: fullNotice,
      error: dispatchRes.error || undefined,
      httpStatus: dispatchRes.httpStatus,
      usedBranchDevice: resolved.hasCustomDevice,
    };
  } catch (err: any) {
    console.warn('sendFreeSms exception:', err);
    return {
      success: false,
      status: 'FAILED',
      phone: normalizedPhone.e164 || phone,
      branchId: normalizeBranchId(branchId),
      error: err?.message || 'Failed to dispatch SMS',
    };
  }
}

export async function retrySmsLogEntry(params: {
  logId: string;
  isAdmin: boolean;
  allowedBranch?: string | null;
  dryRun?: boolean;
}) {
  const { logId, isAdmin, allowedBranch, dryRun = false } = params;

  const { data: logRow, error: fetchErr } = await adminSupabase
    .from('sms_logs')
    .select('*')
    .eq('id', logId)
    .maybeSingle();

  if (fetchErr || !logRow) {
    return { success: false, status: 404, error: 'SMS log entry not found.' };
  }

  const normLogBranch = normalizeBranchId(logRow.branch_id || 'HQ');
  if (!isAdmin && allowedBranch) {
    const normCaller = normalizeBranchId(allowedBranch);
    if (normCaller && normCaller !== 'ALL' && normCaller !== 'HQ' && normLogBranch !== normCaller) {
      return { success: false, status: 403, error: 'Forbidden. Cannot retry SMS logs from another branch.' };
    }
  }

  if (logRow.status === 'SENT') {
    return { success: true, status: 200, alreadySent: true, message: 'This SMS was already delivered.' };
  }

  const normalizedPhone = normalizeSriLankaPhone(logRow.recipient_phone);
  if (!normalizedPhone.valid) {
    return { success: false, status: 400, error: normalizedPhone.reason || 'Invalid phone number on log.' };
  }

  const prevMeta = (logRow.gateway_response && typeof logRow.gateway_response === 'object')
    ? logRow.gateway_response
    : { legacy_notice: typeof logRow.gateway_response === 'string' ? logRow.gateway_response : '' };

  const globalConfig = await getSmsGatewayConfig();
  const forceGlobal = Boolean(prevMeta.force_global);
  const resolved = resolveBranchSmsConfig(globalConfig, normLogBranch, forceGlobal);

  if (!resolved.targetEnabled) {
    return { success: false, status: 400, error: `SMS Gateway is disabled for branch ${resolved.normBranch}.` };
  }
  if (!resolved.targetDeviceId || !resolved.targetApiKey) {
    return { success: false, status: 400, error: `TextBee credentials not configured for branch ${resolved.normBranch}.` };
  }

  const dispatchRes = await dispatchToTextBeeApi({
    deviceId: resolved.targetDeviceId,
    apiKey: resolved.targetApiKey,
    phone: normalizedPhone.e164,
    message: logRow.message_text,
    dryRun,
  });

  const nextStatus: 'SENT' | 'QUEUED' | 'FAILED' = dispatchRes.ok
    ? 'SENT'
    : dispatchRes.transientFailure
    ? 'QUEUED'
    : 'FAILED';

  const nowIso = new Date().toISOString();
  const prevAttempts = Number(prevMeta.attempts) || 1;
  const notice = dispatchRes.ok
    ? `Retry succeeded via ${resolved.hasCustomDevice ? `Branch [${resolved.normBranch}] SIM` : 'Master Gateway'}.`
    : `Retry failed - ${dispatchRes.notice}`;

  const updatedMeta = {
    ...prevMeta,
    notice,
    error: dispatchRes.error,
    http_status: dispatchRes.httpStatus,
    provider: 'TEXTBEE',
    device_id_tail: resolved.targetDeviceId.slice(-4),
    used_branch_device: resolved.hasCustomDevice,
    sim_slot: resolved.targetSimSlot,
    attempts: prevAttempts + 1,
    last_attempt_at: nowIso,
    retried_at: nowIso,
  };

  const { data: updatedRow, error: updErr } = await adminSupabase
    .from('sms_logs')
    .update({
      status: nextStatus,
      gateway_response: updatedMeta,
    })
    .eq('id', logId)
    .select('*')
    .single();

  if (updErr) {
    return { success: false, status: 500, error: updErr.message };
  }

  return {
    success: dispatchRes.ok,
    status: 200,
    smsStatus: nextStatus,
    notice,
    error: dispatchRes.error || undefined,
    log: formatSmsLogRow(updatedRow),
  };
}

export async function checkTextBeeDeviceHealth(
  branchId?: string | null,
  forceGlobal = false
): Promise<TextBeeHealthStatus> {
  const globalConfig = await getSmsGatewayConfig();
  const resolved = resolveBranchSmsConfig(globalConfig, branchId, forceGlobal);

  if (!resolved.targetDeviceId || !resolved.targetApiKey) {
    return {
      configured: false,
      enabled: resolved.targetEnabled,
      online: false,
      status: 'NOT_CONFIGURED',
      branchId: resolved.normBranch,
      usedBranchDevice: resolved.hasCustomDevice,
      error: 'Device ID or API Key is not configured.',
    };
  }

  if (!resolved.targetEnabled) {
    return {
      configured: true,
      enabled: false,
      online: false,
      status: 'DISABLED',
      branchId: resolved.normBranch,
      usedBranchDevice: resolved.hasCustomDevice,
      deviceIdTail: resolved.targetDeviceId.slice(-4),
      error: 'Gateway is disabled for this branch.',
    };
  }

  try {
    const res = await fetch(
      `https://api.textbee.dev/api/v1/gateway/devices/${encodeURIComponent(resolved.targetDeviceId)}`,
      {
        headers: { 'x-api-key': resolved.targetApiKey },
        signal: AbortSignal.timeout(6000),
      }
    );

    if (!res.ok) {
      return {
        configured: true,
        enabled: true,
        online: false,
        status: 'ERROR',
        branchId: resolved.normBranch,
        usedBranchDevice: resolved.hasCustomDevice,
        deviceIdTail: resolved.targetDeviceId.slice(-4),
        error: `TextBee API returned HTTP ${res.status}`,
      };
    }

    const json = await res.json();
    const d = json?.data || json || {};
    const lastHeartbeat = d.lastHeartbeat || null;
    const heartbeatAgeMinutes = lastHeartbeat
      ? Math.max(0, Math.round((Date.now() - new Date(lastHeartbeat).getTime()) / 60000))
      : null;

    const deviceEnabled = d.enabled !== false;
    const isFresh = heartbeatAgeMinutes !== null && heartbeatAgeMinutes <= 30;
    const online = deviceEnabled && isFresh;

    const simsRaw = Array.isArray(d.simInfo?.sims) ? d.simInfo.sims : [];
    const sims = simsRaw.map((s: any, idx: number) => ({
      slot: typeof s.simSlotIndex === 'number' ? s.simSlotIndex + 1 : idx + 1,
      carrier: String(s.carrierName || s.displayName || 'SIM'),
      displayName: String(s.displayName || s.carrierName || `SIM ${idx + 1}`),
    }));

    return {
      configured: true,
      enabled: deviceEnabled,
      online,
      status: !deviceEnabled ? 'DISABLED' : isFresh ? 'ONLINE' : 'STALE',
      branchId: resolved.normBranch,
      usedBranchDevice: resolved.hasCustomDevice,
      deviceIdTail: resolved.targetDeviceId.slice(-4),
      brand: d.brand || null,
      model: d.model || null,
      osVersion: d.osVersion || null,
      appVersion: d.appVersionName || null,
      lastHeartbeat,
      heartbeatAgeMinutes,
      batteryPercentage: typeof d.batteryInfo?.percentage === 'number' ? d.batteryInfo.percentage : null,
      isCharging: typeof d.batteryInfo?.isCharging === 'boolean' ? d.batteryInfo.isCharging : null,
      networkType: d.networkInfo?.networkType || null,
      sentSMSCount: typeof d.sentSMSCount === 'number' ? d.sentSMSCount : null,
      sims,
      error: null,
    };
  } catch (err: any) {
    return {
      configured: true,
      enabled: true,
      online: false,
      status: 'ERROR',
      branchId: resolved.normBranch,
      usedBranchDevice: resolved.hasCustomDevice,
      deviceIdTail: resolved.targetDeviceId.slice(-4),
      error: err?.message || 'Failed to reach TextBee Cloud API',
    };
  }
}

export function formatSmsLogRow(row: any) {
  const rawMeta = row?.gateway_response;
  const meta = (rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta)) ? rawMeta : {};
  const legacyString = typeof rawMeta === 'string' ? rawMeta : '';

  const phone = row?.recipient_phone || row?.phone || '';
  const message = row?.message_text || row?.message || '';
  const notice = meta.notice || meta.legacy_notice || legacyString || (row?.status === 'SENT' ? 'Dispatched via TextBee' : 'Pending / Queued');

  return {
    id: row?.id,
    branch_id: row?.branch_id || 'HQ',
    phone,
    recipient_phone: phone,
    message,
    message_text: message,
    ticket_no: row?.ticket_no || meta.ticket_no || null,
    amount: row?.amount ?? meta.amount ?? null,
    type: row?.type || meta.type || 'RECEIPT',
    status: row?.status || 'QUEUED',
    notice,
    dispatch_notice: notice,
    error: meta.error || null,
    http_status: meta.http_status ?? null,
    attempts: Number(meta.attempts) || 1,
    sim_slot: meta.sim_slot ?? null,
    used_branch_device: Boolean(meta.used_branch_device),
    device_id_tail: meta.device_id_tail || null,
    retried_at: meta.retried_at || null,
    created_at: row?.created_at,
  };
}

export async function resolvePawnCustomerContact(pawn: any): Promise<{ phone: string; name: string }> {
  let phone = String(pawn?.phone || pawn?.client_phone || '').trim();
  let name = String(pawn?.client_name || pawn?.customer_name || '').trim();

  if ((!phone || !name) && pawn?.client_id) {
    const { data: clientRow } = await adminSupabase
      .from('clients')
      .select('phone, first_name, last_name')
      .eq('id', pawn.client_id)
      .maybeSingle();

    if (clientRow) {
      if (!phone && clientRow.phone) phone = String(clientRow.phone).trim();
      if (!name) name = `${clientRow.first_name || ''} ${clientRow.last_name || ''}`.trim();
    }
  }

  return {
    phone,
    name: name || 'Valued Customer',
  };
}
