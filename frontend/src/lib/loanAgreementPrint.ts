export interface AgreementDetails {
  clientNumber: string;
  agreementDate: string;
  borrowerName: string;
  nicNumber: string;
  address: string;
  loanLimit: string;
  serviceFee: string;
  interestRate: string;
  verificationCode: string;
}

export function printLoanAgreement(details: AgreementDetails) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert("Please allow pop-ups to print the loan agreement.");
    return;
  }

  const dateObj = new Date(details.agreementDate);
  const formattedDate = isNaN(dateObj.getTime()) 
    ? details.agreementDate 
    : dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Loan Agreement - ${details.clientNumber}</title>
      <style>
        /* Base Styles */
        body {
          font-family: "Times New Roman", Times, serif;
          line-height: 1.5;
          color: #333;
          font-size: 11pt;
          margin: 0.8in 0.6in;
        }
        h1, h2, h3, h4 {
          color: #111;
          font-family: Arial, sans-serif;
          text-align: center;
          margin-top: 20px;
          margin-bottom: 10px;
        }
        h1 {
          font-size: 16pt;
          font-weight: bold;
          text-transform: uppercase;
          margin-bottom: 5px;
        }
        h2 {
          font-size: 13pt;
          font-weight: bold;
          text-transform: uppercase;
        }
        .header-section {
          text-align: center;
          margin-bottom: 30px;
        }
        .meta-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
        }
        .meta-table td {
          padding: 6px;
          vertical-align: top;
        }
        .meta-table td.label {
          font-weight: bold;
          width: 25%;
        }
        .section-title {
          font-family: Arial, sans-serif;
          font-weight: bold;
          font-size: 11pt;
          margin-top: 25px;
          margin-bottom: 8px;
          text-transform: uppercase;
          border-bottom: 1px solid #ddd;
          padding-bottom: 3px;
        }
        ol, ul {
          margin-top: 5px;
          margin-bottom: 5px;
          padding-left: 20px;
        }
        li {
          margin-bottom: 6px;
          text-align: justify;
        }
        .bold {
          font-weight: bold;
        }
        .justify {
          text-align: justify;
        }
        .page-break {
          page-break-after: always;
        }
        .signatures {
          margin-top: 50px;
          width: 100%;
        }
        .signature-box {
          width: 48%;
          display: inline-block;
          vertical-align: top;
          border: 1px solid #ccc;
          border-radius: 8px;
          padding: 15px;
          background: #fbfbfb;
          box-sizing: border-box;
        }
        .signature-box:last-child {
          float: right;
        }
        .signature-title {
          font-family: Arial, sans-serif;
          font-weight: bold;
          font-size: 10pt;
          text-transform: uppercase;
          color: #555;
          margin-bottom: 10px;
          border-bottom: 1px solid #eee;
          padding-bottom: 5px;
        }
        .signature-field {
          margin-top: 15px;
          font-size: 9pt;
        }
        .signature-field span {
          font-weight: bold;
          color: #111;
        }
        .watermark {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%) rotate(-45deg);
          font-size: 80pt;
          color: rgba(0, 0, 0, 0.03);
          font-family: Arial, sans-serif;
          font-weight: bold;
          pointer-events: none;
          z-index: -1000;
        }
        @page { size: A4; margin: 0.8in 0.6in; }
        @media print {
          body { margin: 0; }
          .no-print {
            display: none !important;
          }
        }
      </style>
    </head>
    <body>
      <!-- THE AGREEMENT CONTENT -->
      <div id="agreement-content">
        <div class="watermark">RUPASINGHA CAPITAL</div>

        <!-- PAGE 1: TITLE & RECITALS -->
        <div class="header-section">
          <h1>General Terms and Conditions</h1>
          <h2>Of the Loan Agreement</h2>
          <div class="bold" style="font-size: 12pt; margin-top: 5px;">NO. ${details.clientNumber}</div>
        </div>

        <p class="justify"><span class="bold">THIS LOAN AGREEMENT</span> made on <span class="bold">${formattedDate}</span></p>

        <p class="bold" style="margin-top: 20px;">BETWEEN</p>
        <p class="justify">
          (1) <span class="bold">${details.borrowerName}</span>, residing at ${details.address} bearing NIC No. ${details.nicNumber} (hereinafter referred to as the <span class="bold">"Borrower"</span>) which term or expression as herein used shall where the context so requires or admits mean and include the said ${details.borrowerName} and his respective heirs, executors and administrators;
        </p>
        <p class="bold" style="margin-top: 10px;">AND</p>
        <p class="justify">
          (2) <span class="bold">RUPASINGHA CAPITAL</span>, a company duly incorporated under the laws of Sri Lanka, having its registered head office in Sri Lanka (hereinafter referred to as the <span class="bold">"Lender"</span>) which term or expression shall where the context so requires include its successors and permitted assigns.
        </p>
        <p class="justify" style="margin-top: 10px;">The Borrower and the Lender are hereinafter individually referred to as a "Party" and collectively as the "Parties".</p>

        <div class="section-title">Recitals</div>
        <ol type="A">
          <li>WHEREAS the Borrower connects with the Lender either through the branch offices or platform provided by the Lender where the Borrower has a personal verified profile subject to the terms and conditions of this Agreement.</li>
          <li>The Borrower for purpose of personal consumption or gold collateral credit may apply for a loan (hereinafter referred to as the "Loan") by indicating the requested loan amount from the Lender repayable subject to the terms and conditions of this Agreement. The total Loan amount to be provided is subject to the creditworthiness review and valuation process of the Lender.</li>
          <li>The Borrower agrees hereby to pay the Lender Loan Service Fee and Interest, as the case may be. The Borrower agrees hereby that the said fees are fair, justified, reasonable and equal in the circumstances, and that the Borrower shall make no claims otherwise.</li>
          <li>Lender shall promote, market, and sell Loan online on a private-label basis, under the commercial/Brand name of "Fino.lk" and its trade name, trademark, and logo.</li>
          <li>The Borrower shall hereby agree to the Special terms of the Agreement and the General Terms and Conditions of the Agreement he consented to either via the Platform owned and operated by the Lender or a Voice Call and that forms an integral part of this Agreement.</li>
          <li>This Agreement shall be governed by the Electronic Transactions Act No.19 of 2006 as amended by the Electronic Transactions (Amendment) Act, No. 25 of 2017. The Verification Code received by the Borrower via short message service (SMS) (hereinafter sometimes referred to as the "Verification code") shall be the electronic signature of the Borrower as his ACCEPTANCE to the Agreement herein.</li>
          <li>By signing the Agreement, both parties acknowledge to have read, understood and agreed to be bound by the provisions of this Agreement.</li>
          <li>The terms and definitions used in this Agreement shall have the same meaning in the Special terms and the General Terms and Conditions and vice versa.</li>
        </ol>

        <div class="page-break"></div>

        <!-- PAGE 2: DEFINITIONS -->
        <div class="section-title">1. Definitions</div>
        <p class="justify"><span class="bold">Fino.lk</span> – the commercial / brand name of the financial services provided by the Lender.</p>
        <p class="justify"><span class="bold">Loan Service Fee</span> – a fee payable by the Borrower to the Lender in accordance with the Section 6 of this Agreement.</p>
        <p class="justify"><span class="bold">Interest</span> – Remuneration to the Lender for the use of the Loan amount paid by the Borrower to the Lender.</p>
        <p class="justify"><span class="bold">Onboarding fee</span> – a commission charged for the online client registration process, which includes verification of identity documents (KYC), assessment of creditworthiness, and completion of the electronic signature process using a one-time password (OTP).</p>
        <p class="justify"><span class="bold">Disbursement date</span> – the date when the Loan has been disbursed to Borrower's bank account (provided by the Borrower either via Platform or via a Voice Call and specified in the Special terms of the Agreement).</p>
        <p class="justify"><span class="bold">Notice to the Borrower</span> – the notifications/approvals/confirmations on willful failure to repay, Final Reminders, Letters of Termination, Letters of Demand or any other correspondence (where applicable) sent by the Lender to the Borrower.</p>
        <p class="justify"><span class="bold">Due date</span> – the date of expiration of the loan tenor when the Total amount due shall be repaid to the Lender.</p>
        <p class="justify"><span class="bold">Payment Agency</span> – payment services provider as appointed by the Lender from time to time.</p>
        <p class="justify"><span class="bold">Collection Agency</span> – any entity, firm, or individual, including but not limited to an authorized agent or assignee of the Lender, engaged by the Lender to provide services related to the recovery of debts from the Borrower.</p>
        <p class="justify"><span class="bold">Platform</span> – an internet-based lending platform owned and operated by the Lender with the brand name "Fino.lk", using the domain www.fino.lk or downloadable mobile application "Fino".</p>
        <p class="justify"><span class="bold">Loan Extension Fee</span> – a fee payable to the Lender for the extension of the Due date. The applicable amount of the Loan Extension Fee shall be specified in the Special Terms of this Agreement.</p>
        <p class="justify"><span class="bold">Services</span> – services which could be used by the Borrower either through the online Platform or a Voice Call or otherwise.</p>
        <p class="justify"><span class="bold">Total amount due</span> – the amount calculated at the time of concluding the Agreement, consisting of the total amount of the approved and disbursed Loan and costs, including interest (if any), the Loan Service Fee and other applicable charges.</p>
        <p class="justify"><span class="bold">Verification Code</span> – a digital code sent via short message service (SMS) to Borrower's mobile phone number.</p>
        <p class="justify"><span class="bold">Voice Call</span> – Voice call between the Lender and the Borrower. The Lender may record any Voice Call to serve as evidence of the information transmitted via the Voice Call.</p>
        <p class="justify"><span class="bold">Payment Schedule</span> – A structured repayment plan that allows the Borrower to repay the Total Amount Due in monthly installments over a maximum period of six (06) months, following the full utilization of the approved loan limit, as agreed with the Lender and communicated via Notice.</p>
        <p class="justify"><span class="bold">Installment</span> – A fixed portion of the Total Amount Due (including principal and applicable fees) payable by the Borrower at regular monthly intervals under the Payment Schedule.</p>
        <p class="justify"><span class="bold">Additional Service Fee</span> – A fee imposed by the Lender upon activation of the Payment Schedule, the amount of which shall be determined at the sole discretion of the Lender based on the outstanding loan balance, repayment history of the Borrower, and other relevant administrative costs.</p>
        <p class="justify"><span class="bold">Approved Loan Limit</span> – The maximum loan amount sanctioned and disbursed by the Lender to the Borrower under this Agreement, as specified in the Special Terms.</p>
        <p class="justify"><span class="bold">Activation Date</span> – The date on which the Payment Schedule is initiated and comes into effect, following the Borrower's request and the Lender's approval.</p>

        <div class="page-break"></div>

        <!-- PAGE 3: LOAN, MINIMUM CRITERIA, DETAILS OF LOAN -->
        <div class="section-title">2. Loan</div>
        <p class="justify">2.1. The Lender, relying upon each of the representations and subject to the obligations of the Borrower set herein, hereby agrees to lend to the Borrower the Loan in the amount set out in the Special terms of the Agreement (i.e., the Loan amount approved and disbursed) in the manner hereinafter set out in the Agreement. The Loan amount requested by the Borrower via the application for Loan made by the Borrower shall only serve as a mere request for a Loan which is equal to or less than the requested Loan amount. The total Loan amount to be provided is subject to the creditworthiness review and approval process of the Lender in its absolute discretion.</p>
        <p class="justify">2.2. Total amount due shall include all the applicable charges and any other payment as set out herein. Total amount due shall be repaid on or before the Due date (as defined and set out in the Special terms).</p>
        <p class="justify">2.3. The Borrower agrees with the Lender that the said interest, service and additional fees are fair, justified, reasonable and equal in the circumstances, and that the Borrower shall make no claims otherwise.</p>
        <p class="justify">2.4. The Borrower shall be entitled to apply either through the Platform or via a Voice Call for multiple loan amounts within his credit limit during the tenor of the Agreement. The Lender in its absolute discretion may approve such application(s) for one or more additional loan amounts.</p>
        <p class="justify">2.5. The Parties acknowledge and agree that the Lender shall have the absolute right, in its sole discretion, to terminate this Agreement without any liability whatsoever in the event when the mobile phone verification of Borrower cannot be successfully performed or any other intentional or unintentional breach of this Agreement.</p>
        <p class="justify">2.6. The Borrower shall have a right to withdraw from the Agreement by repaying the Loan principal in full to the Lender within 24 hours of the Loan disbursement. In such a case the Lender will not apply any charges (i.e., Loan Service Fee, etc.).</p>

        <div class="section-title">3. Minimum Criteria</div>
        <p class="justify">3.1. The Borrower represents and warrants to the Lender that the Borrower satisfies these minimum criteria:</p>
        <ul>
          <li>The Borrower's age is above twenty (20) years when applying for the Loan;</li>
          <li>The Borrower's residential address is located within Sri Lanka;</li>
          <li>The Borrower provides his/her Verification Code;</li>
          <li>The Borrower is answering verification call placed to the Borrower by the Lender, if any; and</li>
          <li>The Borrower's references verifying the information supplied by the Borrower, if the Lender contacts them.</li>
        </ul>

        <div class="section-title">4. Details of the Loan</div>
        <p class="justify">4.1. The Loan amount, Due date, Interest and Loan Service Fee (${details.serviceFee}% of principal) are set out in this Agreement.</p>
        <p class="justify">4.2. The total Interest payable on this Loan shall be zero (0%) per centum. The Lender however at its discretion may change the interest rate from time to time by Notice to Borrower.</p>
        <p class="justify">4.3. Total amount due shall be repaid by the Borrower not later than on the Due date. The Borrower reserves the right to fully repay and settle the Total amount due at any time before the Due date.</p>
        <p class="justify">4.4. The Borrower shall be required to pay a Late Payment Fee as set out in Clause 4.5, if the Borrower defaults in payment and if the total amount of outstanding payment is more than Rs. 250/- (the "Grace Sum").</p>
        <p class="justify">4.5. The Late Payment Fee of 10% from the unpaid principal shall be charged on the 3rd, 6th, 11th, 16th and 30th day after the Due date.</p>
        <p class="justify">4.6. The approved Loan amount shall be disbursed to the Borrower's bank account.</p>

        <div class="page-break"></div>

        <!-- PAGE 4: SERVICES, REPAYMENT, NOTICE, RIGHTS -->
        <div class="section-title">5. Services and Services Acceptance</div>
        <p class="justify">5.1. In order to mitigate financial risks, the Borrower hereby intends to use the Services through the online Platform or a Voice Call and the Lender hereby agrees to render the Services to the Borrower.</p>
        <p class="justify">5.2. Early repayment is possible at any time.</p>
        <p class="justify">5.3. The Lender may conduct a credit risk assessment of the Borrower by itself, at its cost, through a third party.</p>
        <p class="justify">5.4. The Lender shall have the right to contact the Borrower or reference(s) through various means, including SMS, WhatsApp, emails, and voice calls.</p>

        <div class="section-title">6. Loan Service Fee</div>
        <p class="justify">6.1. The Loan Service Fee consists of the fee payable by the Borrower to the Lender for received Services under the Agreement and in accordance with the terms and conditions hereof.</p>
        <p class="justify">6.2. The amount of Loan Service Fee is configured at the rate of ${details.serviceFee}% of the principal loan amount.</p>
        <p class="justify">6.3. The Loan Service Fee shall be paid by the Borrower along with the Loan repayment.</p>
        <p class="justify">6.4. The Loan Service Fee will not be refunded for any reason in any event.</p>

        <div class="section-title">7. Repayment/Prepayment of the Loan</div>
        <p class="justify">7.1. The Borrower shall be required to repay to the Lender all amount due or payable in respect of the Loan on the Due date.</p>
        <p class="justify">7.2. The Borrower has the right to initiate Due date extension by paying the Loan Extension Fee as set out in the Special Terms of the Agreement.</p>
        <p class="justify">7.3. The approved and disbursed Loan amount and fees shall be repaid by the Borrower directly to the bank account of the Lender.</p>
        <p class="justify">7.4. Payments made by the Borrower shall be allocated in the priority order: (i) The Loan Service Fee; (ii) the Late payment Fee; (iii) interest, if any; (iv) Principal loan amount; and (v) any other payables.</p>

        <div class="section-title">8. Repayment Schedule Upon Full Utilization</div>
        <p class="justify">8.1. In the event the Borrower has fully utilized the approved loan limit and is unable to make a one-time repayment of the Total Amount Due, the Borrower may opt into a Payment Schedule to repay the outstanding balance on an installment basis.</p>
        <p class="justify">8.2. This Payment Schedule shall be valid for a maximum period of six (06) months, starting from the date of activation, consisting of monthly installment payments.</p>

        <div class="section-title">9. Notice to the Borrower</div>
        <p class="justify">9.1. The Borrower hereby acknowledges and agrees to receive Notices via short message service (SMS) or email from the Lender.</p>

        <div class="page-break"></div>

        <!-- PAGE 5: RIGHTS & RESPONSIBILITIES, EVENT OF DEFAULT, SIGNATURES -->
        <div class="section-title">10. Rights and Obligations of the Lender</div>
        <p class="justify">The Lender has the absolute right to approve/refuse loan applications, record communications, request full repayment at any time if deemed necessary, and engage Collection Agencies to recover unpaid loan amounts in accordance with local laws.</p>

        <div class="section-title">11. Responsibilities and Obligations of the Borrower</div>
        <p class="justify">The Borrower agrees to perform obligations in a timely manner, fully repay the Loan and Service Fee on the Due date, and keep the Lender indemnified against liabilities arising from transactions.</p>

        <div class="section-title">12. Event of Default</div>
        <p class="justify">Events of default include failure to repay when due, breach of representation/warranties, or providing incorrect or misleading information. In such event, the Lender is entitled to declare all outstanding amounts immediately due and payable.</p>

        <div class="section-title">13. Governing Law & Dispute Resolution</div>
        <p class="justify">This Agreement shall be governed and interpreted in accordance with the laws of Sri Lanka, subject to the jurisdiction of the competent courts of Sri Lanka.</p>

        <div class="section-title">14. Signatures and Electronic Consent</div>
        <p class="justify">
          The Borrower explicitly acknowledges that the verification code entered below constitutes their electronic signature under the Electronic Transactions Act No.19 of 2006, expressing full consent and acceptance of all terms and conditions of this Loan Agreement.
        </p>

        <div class="signatures">
          <div class="signature-box">
            <div class="signature-title">Signed by the Borrower</div>
            <div class="signature-field">Name: <span>${details.borrowerName}</span></div>
            <div class="signature-field">NIC: <span>${details.nicNumber}</span></div>
            <div class="signature-field" style="margin-top: 20px;">Verification Code (Electronic Signature):</div>
            <div class="bold" style="font-size: 16pt; color: #1e40af; margin-top: 5px; letter-spacing: 2px;">
              ${details.verificationCode}
            </div>
            <div class="signature-field" style="font-size: 8pt; color: #888; margin-top: 15px;">
              Signed electronically via SMS Verification on ${formattedDate}
            </div>
          </div>

          <div class="signature-box">
            <div class="signature-title">Signed by the Lender</div>
            <div class="signature-field">Company: <span>RUPASINGHA CAPITAL</span></div>
            <div class="signature-field">Brand: <span>RUPASINGHA CAPITAL</span></div>
            <div class="signature-field" style="margin-top: 20px;">Lender Signature (Verification Code):</div>
            <div class="bold" style="font-size: 16pt; color: #555; margin-top: 5px; letter-spacing: 2px;">
              RUPASINGHA-AUTH
            </div>
            <div class="signature-field" style="font-size: 8pt; color: #888; margin-top: 15px;">
              Authorized Branch Representative Signature
            </div>
          </div>
        </div>

        <div class="no-print" style="margin-top: 40px; text-align: center;">
          <button onclick="window.print()" style="padding: 10px 20px; font-weight: bold; background-color: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer;">
            Print / Save as PDF
          </button>
        </div>
      </div>

      <script>
        window.onload = function() {
          setTimeout(function() {
            window.print();
          }, 100);
        };
      </script>
    </body>
  </html>`;

  printWindow.document.write(htmlContent);
  printWindow.document.close();
}
