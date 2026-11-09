import React, { forwardRef } from 'react';

export interface PawnBillData {
  billNo: string;
  months: number;
  date: string;
  customerName: string;
  customerAddress: string;
  nic: string;
  phone: string;
  amount: string;
  description: string;
  valuation: string;
  weight: string;
  lastDate: string;
  branchAddress?: string;
  branchPhone?: string;
}

// 80mm thermal receipt — 576px wide (72mm printable @ 8px/mm)
// Compact portrait layout optimised for ESC/POS image printing via html2canvas
export const PawnBill80mmReceipt = forwardRef<HTMLDivElement, { data: PawnBillData }>(({ data }, ref) => {
  const sep = '─'.repeat(42);
  const dashedSep = '- '.repeat(21);

  return (
    <div
      ref={ref}
      style={{
        width: '576px',
        backgroundColor: '#ffffff',
        color: '#000000',
        fontFamily: '"Courier New", Courier, monospace',
        padding: '16px 14px',
        boxSizing: 'border-box',
        fontSize: '13px',
        lineHeight: '1.45',
      }}
    >
      {/* ── HEADER ── */}
      <div style={{ textAlign: 'center', marginBottom: '10px' }}>
        <div style={{ fontSize: '16px', fontWeight: '900', letterSpacing: '1px' }}>
          RUPASINGHE TRUST
        </div>
        <div style={{ fontSize: '13px', fontWeight: '900' }}>INVESTMENTS LTD.</div>
        <div style={{ fontSize: '10px', marginTop: '2px' }}>
          (PREV. L.S. RUPASINGHE PAWN BROKERS)
        </div>
        <div style={{ fontSize: '11px', marginTop: '4px' }}>
          {data.branchAddress || 'No. 3/B/1, Station Road, Dehiwala.'}
        </div>
        <div style={{ fontSize: '11px' }}>Tel: {data.branchPhone || '011 7006588'}</div>
      </div>

      <div style={{ textAlign: 'center', fontSize: '11px' }}>{sep}</div>

      {/* ── PAWN BILL TITLE ── */}
      <div style={{ textAlign: 'center', fontWeight: '900', fontSize: '14px', margin: '6px 0' }}>
        ** PAWN BILL **
      </div>

      <div style={{ textAlign: 'center', fontSize: '11px', marginBottom: '8px' }}>{sep}</div>

      {/* ── META ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '12px' }}>
        <span>R No: <strong>{data.billNo}</strong></span>
        <span>Date: <strong>{data.date}</strong></span>
      </div>
      <div style={{ marginBottom: '8px', fontSize: '12px' }}>
        Months: <strong>{data.months}</strong>
      </div>

      <div style={{ fontSize: '11px', marginBottom: '8px' }}>{sep}</div>

      {/* ── CUSTOMER ── */}
      <div style={{ fontSize: '12px', marginBottom: '4px' }}>
        I the undersigned: <strong>{data.customerName}</strong>
      </div>
      <div style={{ fontSize: '12px', marginBottom: '4px' }}>
        of: {data.customerAddress}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
        <span>NIC: <strong>{data.nic}</strong></span>
        <span>Ph: {data.phone}</span>
      </div>
      <div style={{ fontSize: '12px', marginBottom: '6px' }}>
        being the lawful owner of the articles mentioned below
        has sold out right for
      </div>

      {/* ── AMOUNT ── */}
      <div style={{
        border: '2px solid #000',
        textAlign: 'center',
        padding: '6px',
        fontSize: '20px',
        fontWeight: '900',
        letterSpacing: '2px',
        marginBottom: '8px',
      }}>
        Rs. {parseFloat(data.amount || '0').toLocaleString()}
      </div>

      <div style={{ fontSize: '11px', marginBottom: '8px' }}>{sep}</div>

      {/* ── ARTICLES ── */}
      <div style={{ fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>
        Articles Description:
      </div>
      <div style={{ fontSize: '13px', fontWeight: '900', marginBottom: '8px' }}>
        {data.description}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', borderTop: '1px solid #888', paddingTop: '6px', marginBottom: '8px' }}>
        <span>Appraised: Rs. <strong>{data.valuation}</strong></span>
        <span>Wt: <strong>{data.weight}</strong></span>
      </div>

      <div style={{ fontSize: '11px', marginBottom: '8px' }}>{sep}</div>

      {/* ── TERMS ── */}
      <div style={{ fontSize: '10px', marginBottom: '8px', lineHeight: '1.4' }}>
        I hold responsible and liable for any claims that may arise
        on the sale of the articles.
      </div>
      <div style={{ fontSize: '10px', fontWeight: 'bold', marginBottom: '4px' }}>
        I have read, understood, and agreed to these terms.
      </div>
      <div style={{ fontSize: '10px', marginBottom: '8px' }}>
        Articles must be redeemed or interest renewed before the Last Date,
        otherwise they will be sold.
      </div>

      <div style={{ fontSize: '11px', marginBottom: '8px' }}>{sep}</div>

      {/* ── LAST DATE & SIGNATURES ── */}
      <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '6px' }}>
        Last Date: <strong>{data.lastDate}</strong>
      </div>
      <div style={{ fontSize: '12px', marginBottom: '4px' }}>
        Name: {data.customerName}
      </div>
      <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ borderBottom: '1px solid #000', width: '160px', marginBottom: '4px' }}></div>
          <div>Authorized Signature</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ border: '1px dashed #888', width: '80px', height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#666' }}>
            STAMP
          </div>
        </div>
      </div>

      {/* ── PERFORATED TEAR LINE ── */}
      <div style={{ borderTop: '3px dashed #000', margin: '20px -14px', position: 'relative' }}>
        <div style={{ position: 'absolute', top: '-9px', left: '14px', background: '#fff', padding: '0 6px', fontSize: '10px' }}>
          ✂ CUT
        </div>
      </div>

      {/* ── TEAR-OFF STUB ── */}
      <div style={{ paddingTop: '8px', paddingBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', fontWeight: 'bold' }}>
        <div>R No. <strong>{data.billNo}</strong></div>
        <div style={{ textAlign: 'right' }}>
          <div>{'_'.repeat(20)}</div>
          <div style={{ fontSize: '11px', marginTop: '2px' }}>Signature</div>
        </div>
      </div>
    </div>
  );
});

PawnBill80mmReceipt.displayName = 'PawnBill80mmReceipt';
