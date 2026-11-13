export type SmsTriggerKey =
  | 'onPawnCreate'
  | 'onPawnApprove'
  | 'onPawnReject'
  | 'onPawnRedeem'
  | 'onInterestPayment'
  | 'onForfeitureWarning';

export type SmsTemplateKey =
  | 'RECEIPT'
  | 'APPROVED'
  | 'REJECTED'
  | 'INTEREST'
  | 'REDEEM'
  | 'REMINDER'
  | 'FORFEITURE';

export type SmsType =
  | 'RECEIPT'
  | 'APPROVED'
  | 'REJECTED'
  | 'INTEREST'
  | 'REDEEM'
  | 'REMINDER'
  | 'FORFEITURE'
  | 'ALERT'
  | 'TEST';

export type SmsTriggersConfig = Record<SmsTriggerKey, boolean>;
export type SmsTemplatesConfig = Partial<Record<SmsTemplateKey, string>>;

export const DEFAULT_SMS_TRIGGERS: SmsTriggersConfig = {
  onPawnCreate: true,
  onPawnApprove: true,
  onPawnReject: false,
  onPawnRedeem: true,
  onInterestPayment: true,
  onForfeitureWarning: true,
};

export const SMS_TRIGGER_META: Array<{
  key: SmsTriggerKey;
  label: string;
  description: string;
  templateKey: SmsTemplateKey;
}> = [
  {
    key: 'onPawnCreate',
    label: 'New Pawn Origination Receipt',
    description: 'Automatically send SMS when a new pawn ticket is created.',
    templateKey: 'RECEIPT',
  },
  {
    key: 'onPawnApprove',
    label: 'Manager Loan Approval Alert',
    description: 'Automatically notify customer when Branch Manager approves the loan.',
    templateKey: 'APPROVED',
  },
  {
    key: 'onInterestPayment',
    label: 'Interest Payment Confirmation',
    description: 'Automatically send receipt when monthly/partial interest is recorded.',
    templateKey: 'INTEREST',
  },
  {
    key: 'onPawnRedeem',
    label: 'Pawn Redemption Receipt',
    description: 'Automatically send settlement confirmation when pawn collateral is redeemed.',
    templateKey: 'REDEEM',
  },
  {
    key: 'onForfeitureWarning',
    label: 'Forfeiture Warning Alerts',
    description: 'Allow overdue forfeiture warning SMS alerts via Operations / Forfeiture.',
    templateKey: 'FORFEITURE',
  },
  {
    key: 'onPawnReject',
    label: 'Loan Return / Recheck Alert (Optional)',
    description: 'Notify customer if a loan is returned for recheck (off by default to avoid internal recheck noise).',
    templateKey: 'REJECTED',
  },
];

export const DEFAULT_SMS_TEMPLATES: Record<SmsTemplateKey, string> = {
  RECEIPT: `RUPASINGHA CAPITAL
Dear {{customer_name}},
Pawn Ticket No: #{{ticket_no}}
Disbursed Amount: Rs. {{amount}}
Issued Date: {{date}}

ඔබගේ උකස් රිසිට්පත නිකුත් කරන ලදී.
உங்களின் அடகு ரசீது வழங்கப்பட்டது.
Thank you for banking with us!`,

  APPROVED: `RUPASINGHA CAPITAL
Dear {{customer_name}},
Your Pawn Ticket #{{ticket_no}}{{branch_tag}} (Rs. {{amount}}) has been APPROVED and is now ACTIVE.

ඔබගේ උකස් බිල්පත අනුමත කරන ලදී.
உங்கள் அடகு ரசீது அங்கீகரிக்கப்பட்டது.
Thank you!`,

  REJECTED: `RUPASINGHA CAPITAL
Dear {{customer_name}},
Notice regarding Pawn Ticket #{{ticket_no}}{{branch_tag}}: Returned for verification ({{reason}}).
Please contact our branch for details.`,

  INTEREST: `RUPASINGHA CAPITAL
Dear {{customer_name}},
Interest Payment Received for Ticket #{{ticket_no}}{{branch_tag}}.
Paid Amount: Rs. {{interest_amount}}
Date: {{date}}

ඔබගේ උකස් පොලී ගෙවීම සාර්ථකව සටහන් කරන ලදී.
உங்கள் அடகு வட்டி செலுத்துதல் பதிவு செய்யப்பட்டது.
Thank you!`,

  REDEEM: `RUPASINGHA CAPITAL
Dear {{customer_name}},
Pawn Ticket No: #{{ticket_no}}
Status: REDEEMED (උකස් බේරාගන්නා ලදී)
Settlement Amount: Rs. {{settlement_amount}}

ඔබගේ උකස් භාණ්ඩ සාර්ථකව බේරාගන්නා ලදී.
அடகு பொருட்கள் மீட்கப்பட்டன.
Thank you!`,

  REMINDER: `RUPASINGHA CAPITAL
Dear {{customer_name}},
Reminder: Pawn Ticket No: #{{ticket_no}} (Rs. {{amount}}).
Please visit our branch for interest payment or renewal.

ඔබගේ උකස් පොලිය ගෙවීමට පැමිණෙන්න.
அடகு வட்டி செலுத்த வரவும்.
Thank you!`,

  FORFEITURE: `RUPASINGHA CAPITAL
Dear {{customer_name}},
URGENT: Pawn Ticket #{{ticket_no}}{{branch_tag}}{{date_info}}
Principal: Rs. {{principal}} | Expired: {{expiry_date}}{{paid_info}}
Due Overdue Interest: Rs. {{interest_due}}
Please settle immediately to avoid collateral forfeiture/auction.
කරුණාකර භාණ්ඩ සින්න වීම වැළැක්වීමට වහාම ශාඛාව අමතන්න.{{phone_text}}`,
};

export const SMS_TEMPLATE_LABELS: Record<SmsTemplateKey, { label: string; placeholders: string[] }> = {
  RECEIPT: {
    label: 'New Pawn Receipt',
    placeholders: ['{{customer_name}}', '{{ticket_no}}', '{{amount}}', '{{date}}'],
  },
  APPROVED: {
    label: 'Manager Loan Approval',
    placeholders: ['{{customer_name}}', '{{ticket_no}}', '{{amount}}', '{{branch_name}}'],
  },
  INTEREST: {
    label: 'Interest Payment Receipt',
    placeholders: ['{{customer_name}}', '{{ticket_no}}', '{{interest_amount}}', '{{date}}', '{{branch_name}}'],
  },
  REDEEM: {
    label: 'Pawn Redemption',
    placeholders: ['{{customer_name}}', '{{ticket_no}}', '{{settlement_amount}}'],
  },
  REMINDER: {
    label: 'Payment Reminder',
    placeholders: ['{{customer_name}}', '{{ticket_no}}', '{{amount}}', '{{branch_name}}'],
  },
  FORFEITURE: {
    label: 'Forfeiture Overdue Warning',
    placeholders: ['{{customer_name}}', '{{ticket_no}}', '{{principal}}', '{{interest_due}}', '{{expiry_date}}', '{{branch_name}}'],
  },
  REJECTED: {
    label: 'Loan Return / Recheck Notice',
    placeholders: ['{{customer_name}}', '{{ticket_no}}', '{{reason}}', '{{branch_name}}'],
  },
};

export interface NormalizedPhoneResult {
  valid: boolean;
  e164: string;
  localDisplay: string;
  reason?: string;
}

export function normalizeSriLankaPhone(raw?: string | null): NormalizedPhoneResult {
  if (!raw || typeof raw !== 'string') {
    return { valid: false, e164: '', localDisplay: '', reason: 'Phone number is missing.' };
  }

  let cleaned = raw.trim().replace(/[^\d+]/g, '');
  if (!cleaned) {
    return { valid: false, e164: '', localDisplay: '', reason: 'Phone number is empty.' };
  }

  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.slice(2);
  }

  const digitsOnly = cleaned.replace(/\D/g, '');
  if (!digitsOnly || digitsOnly.length < 9 || /^0+$/.test(digitsOnly)) {
    return { valid: false, e164: '', localDisplay: '', reason: 'Phone number is too short or invalid.' };
  }

  if (cleaned.startsWith('+')) {
    if (cleaned.startsWith('+94')) {
      const rest = cleaned.slice(3).replace(/^0+/, '');
      const e164 = `+94${rest}`;
      if (!/^\+94[1-9]\d{8}$/.test(e164)) {
        return { valid: false, e164: '', localDisplay: '', reason: 'Invalid Sri Lankan (+94) phone number length.' };
      }
      return { valid: true, e164, localDisplay: `0${rest}` };
    }

    if (!/^\+[1-9]\d{7,14}$/.test(cleaned)) {
      return { valid: false, e164: '', localDisplay: '', reason: 'Invalid international E.164 phone number.' };
    }
    return { valid: true, e164: cleaned, localDisplay: cleaned };
  }

  // Without leading '+'
  if (digitsOnly.startsWith('94') && digitsOnly.length === 11) {
    const rest = digitsOnly.slice(2);
    const e164 = `+94${rest}`;
    if (!/^\+94[1-9]\d{8}$/.test(e164)) {
      return { valid: false, e164: '', localDisplay: '', reason: 'Invalid Sri Lankan mobile number.' };
    }
    return { valid: true, e164, localDisplay: `0${rest}` };
  }

  if (digitsOnly.startsWith('0') && digitsOnly.length === 10 && digitsOnly[1] !== '0') {
    const rest = digitsOnly.slice(1);
    return { valid: true, e164: `+94${rest}`, localDisplay: digitsOnly };
  }

  if (!digitsOnly.startsWith('0') && digitsOnly.length === 9 && /^[1-9]\d{8}$/.test(digitsOnly)) {
    return { valid: true, e164: `+94${digitsOnly}`, localDisplay: `0${digitsOnly}` };
  }

  return {
    valid: false,
    e164: '',
    localDisplay: '',
    reason: `Unrecognized Sri Lankan phone format (${digitsOnly.length} digits). Expected 07XXXXXXXX or +947XXXXXXXX.`,
  };
}

const GSM_7BIT_REGEX =
  /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà\^{}\\\[~\]|€]*$/;

export function calculateSmsParts(message: string): {
  encoding: 'GSM' | 'UNICODE';
  chars: number;
  parts: number;
  perPartLimit: number;
} {
  const text = String(message || '');
  const isGsm = GSM_7BIT_REGEX.test(text);
  const singleLimit = isGsm ? 160 : 70;
  const multiLimit = isGsm ? 153 : 67;
  const chars = text.length;
  const parts = chars === 0 ? 0 : chars <= singleLimit ? 1 : Math.ceil(chars / multiLimit);
  return {
    encoding: isGsm ? 'GSM' : 'UNICODE',
    chars,
    parts,
    perPartLimit: parts <= 1 ? singleLimit : multiLimit,
  };
}

export function renderSmsTemplate(
  templateKey: SmsTemplateKey,
  vars: Record<string, string | number | undefined | null>,
  customTemplate?: string
): string {
  const base = (customTemplate && customTemplate.trim()) ? customTemplate : DEFAULT_SMS_TEMPLATES[templateKey];
  return base.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const val = vars[key];
    return val !== undefined && val !== null ? String(val) : '';
  });
}

function cleanCustomerName(customerName?: string): string {
  return customerName && customerName !== '.' && customerName !== 'Valued Customer'
    ? customerName.trim()
    : 'Valued Customer';
}

export function buildPawnReceiptSms(params: {
  customerName: string;
  ticketNo: string;
  amount: number;
  dateStr?: string;
  customTemplate?: string;
}): string {
  const { customerName, ticketNo, amount, dateStr, customTemplate } = params;
  return renderSmsTemplate(
    'RECEIPT',
    {
      customer_name: cleanCustomerName(customerName),
      ticket_no: ticketNo,
      amount: (Number(amount) || 0).toLocaleString(),
      date: dateStr || new Date().toLocaleDateString('en-GB'),
    },
    customTemplate
  );
}

export function buildPawnApprovedSms(params: {
  customerName: string;
  ticketNo: string;
  amount: number;
  branchName?: string;
  customTemplate?: string;
}): string {
  const { customerName, ticketNo, amount, branchName, customTemplate } = params;
  return renderSmsTemplate(
    'APPROVED',
    {
      customer_name: cleanCustomerName(customerName),
      ticket_no: ticketNo,
      amount: (Number(amount) || 0).toLocaleString(),
      branch_name: branchName || '',
      branch_tag: branchName ? ` [${branchName}]` : '',
    },
    customTemplate
  );
}

export function buildPawnReturnedSms(params: {
  customerName: string;
  ticketNo: string;
  reason?: string;
  branchName?: string;
  customTemplate?: string;
}): string {
  const { customerName, ticketNo, reason, branchName, customTemplate } = params;
  return renderSmsTemplate(
    'REJECTED',
    {
      customer_name: cleanCustomerName(customerName),
      ticket_no: ticketNo,
      reason: reason || 'Details require recheck',
      branch_name: branchName || '',
      branch_tag: branchName ? ` [${branchName}]` : '',
    },
    customTemplate
  );
}

export function buildInterestPaymentSms(params: {
  customerName: string;
  ticketNo: string;
  interestAmount: number;
  dateStr?: string;
  branchName?: string;
  customTemplate?: string;
}): string {
  const { customerName, ticketNo, interestAmount, dateStr, branchName, customTemplate } = params;
  return renderSmsTemplate(
    'INTEREST',
    {
      customer_name: cleanCustomerName(customerName),
      ticket_no: ticketNo,
      interest_amount: (Number(interestAmount) || 0).toLocaleString(),
      date: dateStr || new Date().toLocaleDateString('en-GB'),
      branch_name: branchName || '',
      branch_tag: branchName ? ` [${branchName}]` : '',
    },
    customTemplate
  );
}

export function buildPawnRedeemSms(params: {
  customerName: string;
  ticketNo: string;
  settlementAmount: number;
  principalAmount?: number;
  branchName?: string;
  customTemplate?: string;
}): string {
  const { customerName, ticketNo, settlementAmount, principalAmount, branchName, customTemplate } = params;
  return renderSmsTemplate(
    'REDEEM',
    {
      customer_name: cleanCustomerName(customerName),
      ticket_no: ticketNo,
      settlement_amount: (Number(settlementAmount) || 0).toLocaleString(),
      principal: (Number(principalAmount) || 0).toLocaleString(),
      branch_name: branchName || '',
    },
    customTemplate
  );
}

export function buildPawnReminderSms(params: {
  customerName: string;
  ticketNo: string;
  amount: number;
  branchName?: string;
  customTemplate?: string;
}): string {
  const { customerName, ticketNo, amount, branchName, customTemplate } = params;
  return renderSmsTemplate(
    'REMINDER',
    {
      customer_name: cleanCustomerName(customerName),
      ticket_no: ticketNo,
      amount: (Number(amount) || 0).toLocaleString(),
      branch_name: branchName || '',
    },
    customTemplate
  );
}

export function buildForfeitureWarningSms(params: {
  customerName: string;
  ticketNo: string;
  principal: number;
  interestDue: number;
  expiryDate: string;
  branchName?: string;
  branchPhone?: string;
  originationDate?: string;
  periodMonths?: number;
  interestPaid?: number;
  coveredMonths?: number;
  lastInterestDate?: string | null;
  customTemplate?: string;
}): string {
  const {
    customerName,
    ticketNo,
    principal,
    interestDue,
    expiryDate,
    branchName,
    branchPhone,
    originationDate,
    periodMonths,
    interestPaid = 0,
    coveredMonths = 0,
    lastInterestDate,
    customTemplate,
  } = params;

  const phoneText = branchPhone ? ` Tel: ${branchPhone}` : '';
  const dateInfo = originationDate ? ` (Date: ${originationDate}, ${periodMonths || 3}M)` : '';
  const paidInfo =
    interestPaid > 0
      ? `\nInterest Paid: Rs. ${interestPaid.toLocaleString()} (${coveredMonths} mo. covered${lastInterestDate ? `, last: ${lastInterestDate}` : ''})`
      : '\nInterest Paid: Rs. 0 (None)';

  return renderSmsTemplate(
    'FORFEITURE',
    {
      customer_name: cleanCustomerName(customerName),
      ticket_no: ticketNo,
      branch_name: branchName || '',
      branch_tag: branchName ? ` [${branchName}]` : '',
      date_info: dateInfo,
      principal: (Number(principal) || 0).toLocaleString(),
      expiry_date: expiryDate || 'N/A',
      paid_info: paidInfo,
      interest_due: (Number(interestDue) || 0).toLocaleString(),
      phone_text: phoneText,
    },
    customTemplate
  );
}

