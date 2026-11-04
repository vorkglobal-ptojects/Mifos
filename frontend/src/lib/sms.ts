import { adminSupabase } from '@/lib/auth-server';

export interface SendSmsParams {
  phone: string;
  message: string;
  ticketNo?: string;
  amount?: number;
  type?: 'RECEIPT' | 'REDEEM' | 'REMINDER' | 'ALERT';
  branchId?: string;
}

export async function sendFreeSms(params: SendSmsParams) {
  const { phone, message, ticketNo, amount, type = 'RECEIPT', branchId = 'HQ' } = params;

  if (!phone || !message) {
    return { success: false, error: 'Phone and message required' };
  }

  // Format phone number to E.164 (e.g. +94771234567 or 0771234567)
  let cleanPhone = phone.replace(/[^\d+]/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '+94' + cleanPhone.substring(1);
  }

  let smsSuccess = false;
  let dispatchNotice = '';

  try {
    // 1. Fetch Gateway Settings
    const { data: settingsData } = await adminSupabase
      .from('system_settings')
      .select('value')
      .eq('key', 'sms_gateway_config')
      .single();

    const defaultTextbeeApiKey = 'txb_SQX87S1btDchmgxYURa40D3I3WEjxSqg';
    const defaultDeviceId = '6aa2895cccb6c72709fa5556';
    const defaultTextbeeUrl = `https://api.textbee.dev/api/v1/gateway/devices/${defaultDeviceId}/send-sms`;

    const globalConfig = settingsData?.value || {};

    // Check branch-specific config
    const branchConfig = (branchId && globalConfig?.branches?.[branchId]) ? globalConfig.branches[branchId] : null;

    const targetDeviceId = branchConfig?.deviceId || globalConfig?.deviceId || defaultDeviceId;
    const targetApiKey = branchConfig?.apiKey || globalConfig?.apiKey || defaultTextbeeApiKey;
    const targetUrl = branchConfig?.gatewayUrl || globalConfig?.gatewayUrl || defaultTextbeeUrl;
    const targetEnabled = branchConfig?.enabled !== undefined ? branchConfig.enabled : (globalConfig?.enabled !== false);
    const isBranchCustom = !!(branchConfig?.deviceId && branchConfig?.apiKey);

    if (!targetEnabled) {
      return {
        success: false,
        status: 'DISABLED',
        phone: cleanPhone,
        notice: `SMS Gateway disabled for branch ${branchId || 'HQ'}`
      };
    }

    if (targetUrl.includes('textbee.dev') || globalConfig?.provider === 'TEXTBEE' || targetDeviceId) {
      try {
        const textbeeEndpoint = targetUrl.includes('/send-sms')
          ? targetUrl
          : `https://api.textbee.dev/api/v1/gateway/devices/${targetDeviceId}/send-sms`;

        const smsRes = await fetch(textbeeEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': targetApiKey
          },
          body: JSON.stringify({
            recipients: [cleanPhone],
            message: message
          }),
          signal: AbortSignal.timeout(6000)
        });

        if (smsRes.ok) {
          smsSuccess = true;
          dispatchNotice = `SMS dispatched via ${isBranchCustom ? `Branch [${branchId}]` : 'Default'} TextBee Gateway!`;
        } else {
          const errText = await smsRes.text();
          dispatchNotice = `TextBee Gateway returned HTTP ${smsRes.status}: ${errText}`;
        }
      } catch (textbeeErr: any) {
        dispatchNotice = `TextBee Error: ${textbeeErr?.message || 'Gateway connection failed'}`;
      }
    } else if (targetUrl.startsWith('http')) {
      try {
        const smsRes = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${targetApiKey}`
          },
          body: JSON.stringify({
            to: cleanPhone,
            message: message,
            simSlot: branchConfig?.simSlot || globalConfig?.simSlot || 1
          }),
          signal: AbortSignal.timeout(4000)
        });

        if (smsRes.ok) {
          smsSuccess = true;
          dispatchNotice = `SMS dispatched via ${isBranchCustom ? `Branch [${branchId}]` : 'Default'} Android SIM Gateway!`;
        } else {
          dispatchNotice = `Android Gateway returned HTTP ${smsRes.status}`;
        }
      } catch (gatewayErr: any) {
        dispatchNotice = 'Local Android SIM Gateway offline or unreachable.';
      }
    } else {
      dispatchNotice = 'SMS Gateway URL not configured yet.';
    }

    // 2. Insert into sms_logs
    try {
      await adminSupabase.from('sms_logs').insert([{
        recipient_phone: cleanPhone,
        message_text: message,
        branch_id: branchId || null,
        status: smsSuccess ? 'SENT' : 'QUEUED',
        gateway_response: dispatchNotice,
        created_at: new Date().toISOString()
      }]);
    } catch (insertErr) {
      console.warn('sms_logs insert notice:', insertErr);
    }

    return {
      success: true,
      status: smsSuccess ? 'SENT' : 'QUEUED',
      phone: cleanPhone,
      notice: dispatchNotice
    };
  } catch (err: any) {
    console.warn('sendFreeSms exception:', err);
    return { success: false, error: err?.message || 'Failed to dispatch SMS' };
  }
}

/**
 * Trilingual Branded SMS Template Builders for Rupasinghe Pawning (PVT) Ltd
 * (Strictly excludes 'Mifos' branding, includes Customer Name and clear company header)
 */

export function buildPawnReceiptSms(params: {
  customerName: string;
  ticketNo: string;
  amount: number;
  dateStr?: string;
}): string {
  const { customerName, ticketNo, amount, dateStr } = params;
  const nameDisplay = (customerName && customerName !== '.' && customerName !== 'Valued Customer') 
    ? customerName 
    : 'Valued Customer';
  const today = dateStr || new Date().toLocaleDateString('en-GB');

  return `RUPASINGHE PAWNING (PVT) LTD
Dear ${nameDisplay},
Pawn Ticket No: #${ticketNo}
Disbursed Amount: Rs. ${amount.toLocaleString()}
Issued Date: ${today}

ඔබගේ උකස් රිසිට්පත නිකුත් කරන ලදී.
உங்களின் அடகு ரිසිට්ப்பத்து வழங்கப்பட்டது.
Thank you for banking with us!`;
}

export function buildPawnRedeemSms(params: {
  customerName: string;
  ticketNo: string;
  settlementAmount: number;
  principalAmount?: number;
}): string {
  const { customerName, ticketNo, settlementAmount } = params;
  const nameDisplay = (customerName && customerName !== '.' && customerName !== 'Valued Customer') 
    ? customerName 
    : 'Valued Customer';

  return `RUPASINGHE PAWNING (PVT) LTD
Dear ${nameDisplay},
Pawn Ticket No: #${ticketNo}
Status: REDEEMED (උකස් බේරාගන්නා ලදී)
Settlement Amount: Rs. ${settlementAmount.toLocaleString()}

ඔබගේ උකස් භාණ්ඩ සාර්ථකව බේරාගන්නා ලදී.
அடகு பொருட்கள் மீட்கப்பட்டன.
Thank you!`;
}

export function buildPawnReminderSms(params: {
  customerName: string;
  ticketNo: string;
  amount: number;
}): string {
  const { customerName, ticketNo, amount } = params;
  const nameDisplay = (customerName && customerName !== '.' && customerName !== 'Valued Customer') 
    ? customerName 
    : 'Valued Customer';

  return `RUPASINGHE PAWNING (PVT) LTD
Dear ${nameDisplay},
Reminder: Pawn Ticket No: #${ticketNo} (Rs. ${amount.toLocaleString()}).
Please visit our branch for interest payment or renewal.

ඔබගේ උකස් පොලිය ගෙවීමට පැමිණෙන්න.
அடகு வட்டி செலுத்த வரவும்.
Thank you!`;
}


export function buildForfeitureWarningSms(params: {
  customerName: string;
  ticketNo: string;
  principal: number;
  interestDue: number;
  expiryDate: string;
  branchName?: string;
  branchPhone?: string;
}): string {
  const { customerName, ticketNo, principal, interestDue, expiryDate, branchPhone } = params;
  const nameDisplay = (customerName && customerName !== '.' && customerName !== 'Valued Customer') 
    ? customerName 
    : 'Valued Customer';
  const phoneText = branchPhone ? ` Tel: ${branchPhone}` : '';

  return `RUPASINGHE PAWNING (PVT) LTD
Dear ${nameDisplay},
URGENT: Pawn Ticket #${ticketNo} (Principal: Rs. ${principal.toLocaleString()}) expired on ${expiryDate}.
Unpaid Interest: Rs. ${interestDue.toLocaleString()}.
Please settle immediately to prevent item forfeiture/auction.
කරුණාකර භාණ්ඩ සින්න වීම වැළැක්වීමට වහාම ශාඛාව අමතන්න.${phoneText}`;
}
