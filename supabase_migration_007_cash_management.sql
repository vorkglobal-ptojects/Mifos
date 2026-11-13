-- ================================================================================
-- MIFOS SYSTEM - MIGRATION 006: ENTERPRISE CASH & BANK MANAGEMENT MODULE
-- ================================================================================
-- This migration establishes the comprehensive data model for:
-- 1. Master Bank Accounts (with GL linkage & reconciliation)
-- 2. Cash Tills & Cashier Sessions (opening/closing cash & denomination tracking)
-- 3. Cash Requirements / Requisitions (Record 1: Request)
-- 4. Cash Transfers & Dispatches (Record 2: Handover / Transit)
-- 5. Cash Receipts & Acceptances (Record 3: Delivery Confirmation & Discrepancies)
-- 6. Denomination breakdown tables for LKR notes & coins
-- ================================================================================

-- 1. BANK ACCOUNTS
CREATE TABLE IF NOT EXISTS public.bank_accounts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    bank_name TEXT NOT NULL,
    account_name TEXT NOT NULL,
    account_number TEXT NOT NULL UNIQUE,
    currency TEXT NOT NULL DEFAULT 'LKR',
    branch_id TEXT REFERENCES public.branches(id) ON DELETE SET NULL,
    gl_account_name TEXT NOT NULL DEFAULT 'Bank Current Account (Asset)',
    opening_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    current_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    last_reconciled_at TIMESTAMPTZ,
    last_reconciled_balance NUMERIC(14, 2),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_branch ON public.bank_accounts(branch_id);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_active ON public.bank_accounts(is_active);

-- 2. CASH TILLS
CREATE TABLE IF NOT EXISTS public.cash_tills (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    branch_id TEXT NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    till_name TEXT NOT NULL,
    assigned_role TEXT NOT NULL DEFAULT 'TELLER',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_branch_till_name UNIQUE (branch_id, till_name)
);

CREATE INDEX IF NOT EXISTS idx_cash_tills_branch ON public.cash_tills(branch_id);

-- 3. TILL SESSIONS
CREATE TABLE IF NOT EXISTS public.till_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    till_id UUID NOT NULL REFERENCES public.cash_tills(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id),
    branch_id TEXT NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    session_date DATE NOT NULL DEFAULT CURRENT_DATE,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    opening_cash NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    system_expected_cash NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    actual_counted_cash NUMERIC(12, 2),
    variance_amount NUMERIC(12, 2) DEFAULT 0.00,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED', 'FLAGGED')),
    verified_by_user_id UUID REFERENCES auth.users(id),
    verified_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_till_sessions_branch ON public.till_sessions(branch_id);
CREATE INDEX IF NOT EXISTS idx_till_sessions_user ON public.till_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_till_sessions_status ON public.till_sessions(status);
CREATE INDEX IF NOT EXISTS idx_till_sessions_date ON public.till_sessions(session_date);

-- 4. TILL DENOMINATIONS
CREATE TABLE IF NOT EXISTS public.till_denominations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES public.till_sessions(id) ON DELETE CASCADE,
    count_type TEXT NOT NULL DEFAULT 'CLOSING' CHECK (count_type IN ('OPENING', 'CLOSING', 'SPOT_AUDIT')),
    notes_5000 INTEGER NOT NULL DEFAULT 0 CHECK (notes_5000 >= 0),
    notes_2000 INTEGER NOT NULL DEFAULT 0 CHECK (notes_2000 >= 0),
    notes_1000 INTEGER NOT NULL DEFAULT 0 CHECK (notes_1000 >= 0),
    notes_500 INTEGER NOT NULL DEFAULT 0 CHECK (notes_500 >= 0),
    notes_100 INTEGER NOT NULL DEFAULT 0 CHECK (notes_100 >= 0),
    notes_50 INTEGER NOT NULL DEFAULT 0 CHECK (notes_50 >= 0),
    notes_20 INTEGER NOT NULL DEFAULT 0 CHECK (notes_20 >= 0),
    notes_10 INTEGER NOT NULL DEFAULT 0 CHECK (notes_10 >= 0),
    coins_total NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (coins_total >= 0),
    total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (total_amount >= 0),
    counted_by_user_id UUID NOT NULL REFERENCES auth.users(id),
    counted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_till_denominations_session ON public.till_denominations(session_id);

-- 5. CASH REQUESTS (Record 1: Cash Requisition)
CREATE TABLE IF NOT EXISTS public.cash_requests (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    request_ref TEXT NOT NULL UNIQUE,
    requesting_branch_id TEXT NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    requested_by_user_id UUID NOT NULL REFERENCES auth.users(id),
    requested_by_email TEXT NOT NULL,
    current_branch_cash NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    requested_amount NUMERIC(12, 2) NOT NULL CHECK (requested_amount > 0),
    approved_amount NUMERIC(12, 2) CHECK (approved_amount IS NULL OR approved_amount > 0),
    purpose TEXT NOT NULL,
    required_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'RETURNED', 'DISPATCHED', 'IN_TRANSIT', 'DISCREPANCY_FLAGGED', 'COMPLETED', 'CANCELLED')),
    rejection_reason TEXT,
    approved_by_user_id UUID REFERENCES auth.users(id),
    approved_by_email TEXT,
    approved_at TIMESTAMPTZ,
    assigned_source_type TEXT CHECK (assigned_source_type IN ('BRANCH', 'BANK')),
    assigned_source_branch_id TEXT REFERENCES public.branches(id),
    assigned_source_bank_id UUID REFERENCES public.bank_accounts(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_requests_branch ON public.cash_requests(requesting_branch_id);
CREATE INDEX IF NOT EXISTS idx_cash_requests_status ON public.cash_requests(status);
CREATE INDEX IF NOT EXISTS idx_cash_requests_created ON public.cash_requests(created_at DESC);

-- 6. CASH TRANSFERS (Transfer Parent Lifecycle & Transit Coordination)
CREATE TABLE IF NOT EXISTS public.cash_transfers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    transfer_ref TEXT NOT NULL UNIQUE,
    request_id UUID REFERENCES public.cash_requests(id) ON DELETE SET NULL,
    source_branch_id TEXT NOT NULL REFERENCES public.branches(id),
    destination_branch_id TEXT NOT NULL REFERENCES public.branches(id),
    source_bank_id UUID REFERENCES public.bank_accounts(id),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    status TEXT NOT NULL DEFAULT 'ASSIGNED' CHECK (status IN ('ASSIGNED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'ACCEPTED', 'DISCREPANCY_FLAGGED', 'CANCELLED')),
    gl_journal_entry_id TEXT REFERENCES public.journal_entry(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_transfers_source ON public.cash_transfers(source_branch_id);
CREATE INDEX IF NOT EXISTS idx_cash_transfers_dest ON public.cash_transfers(destination_branch_id);
CREATE INDEX IF NOT EXISTS idx_cash_transfers_status ON public.cash_transfers(status);

-- 7. CASH DISPATCHES (Record 2: Handover from Source)
CREATE TABLE IF NOT EXISTS public.cash_dispatches (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    dispatch_ref TEXT NOT NULL UNIQUE,
    transfer_id UUID NOT NULL REFERENCES public.cash_transfers(id) ON DELETE CASCADE,
    dispatched_by_user_id UUID NOT NULL REFERENCES auth.users(id),
    dispatched_by_email TEXT NOT NULL,
    dispatched_amount NUMERIC(12, 2) NOT NULL CHECK (dispatched_amount > 0),
    transport_carrier_type TEXT NOT NULL DEFAULT 'INTERNAL_STAFF' CHECK (transport_carrier_type IN ('INTERNAL_STAFF', 'SECURITY_COURIER', 'MANAGER_TRANSPORT')),
    carrier_person_name TEXT NOT NULL,
    carrier_person_nic TEXT NOT NULL,
    carrier_vehicle_no TEXT,
    security_bag_seal_no TEXT NOT NULL,
    handover_notes TEXT,
    dispatched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_dispatches_transfer ON public.cash_dispatches(transfer_id);

-- 8. CASH RECEIPTS (Record 3: Acceptance at Destination)
CREATE TABLE IF NOT EXISTS public.cash_receipts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    receipt_ref TEXT NOT NULL UNIQUE,
    transfer_id UUID NOT NULL REFERENCES public.cash_transfers(id) ON DELETE CASCADE,
    dispatch_id UUID NOT NULL REFERENCES public.cash_dispatches(id) ON DELETE CASCADE,
    received_by_user_id UUID NOT NULL REFERENCES auth.users(id),
    received_by_email TEXT NOT NULL,
    received_amount NUMERIC(12, 2) NOT NULL CHECK (received_amount >= 0),
    discrepancy_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    security_seal_verified BOOLEAN NOT NULL DEFAULT TRUE,
    discrepancy_reason TEXT,
    resolution_notes TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_receipts_transfer ON public.cash_receipts(transfer_id);
CREATE INDEX IF NOT EXISTS idx_cash_receipts_dispatch ON public.cash_receipts(dispatch_id);

-- 9. CASH TRANSFER DENOMINATIONS (Breakdown for Dispatch and Receipt)
CREATE TABLE IF NOT EXISTS public.cash_transfer_denominations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    transfer_id UUID NOT NULL REFERENCES public.cash_transfers(id) ON DELETE CASCADE,
    stage TEXT NOT NULL CHECK (stage IN ('DISPATCH', 'RECEIPT')),
    notes_5000 INTEGER NOT NULL DEFAULT 0 CHECK (notes_5000 >= 0),
    notes_2000 INTEGER NOT NULL DEFAULT 0 CHECK (notes_2000 >= 0),
    notes_1000 INTEGER NOT NULL DEFAULT 0 CHECK (notes_1000 >= 0),
    notes_500 INTEGER NOT NULL DEFAULT 0 CHECK (notes_500 >= 0),
    notes_100 INTEGER NOT NULL DEFAULT 0 CHECK (notes_100 >= 0),
    notes_50 INTEGER NOT NULL DEFAULT 0 CHECK (notes_50 >= 0),
    notes_20 INTEGER NOT NULL DEFAULT 0 CHECK (notes_20 >= 0),
    notes_10 INTEGER NOT NULL DEFAULT 0 CHECK (notes_10 >= 0),
    coins_total NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (coins_total >= 0),
    total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (total_amount >= 0),
    recorded_by_user_id UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_transfer_stage UNIQUE (transfer_id, stage)
);

-- ================================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ================================================================================
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_tills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.till_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.till_denominations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_transfer_denominations ENABLE ROW LEVEL SECURITY;

-- Enable RLS across all Cash Management tables
-- All financial mutations and cross-branch operations are strictly routed through
-- backend API endpoints using the service role key and validateFinancialActionAuth().
-- Direct browser client mutations are denied by default.

