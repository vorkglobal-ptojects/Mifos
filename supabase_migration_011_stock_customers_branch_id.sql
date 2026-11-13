-- Migration 011: Enforce strict branch isolation on stock_customers
-- Prevents overlapping bill numbers across branches (e.g. KIR vs KDW 1R 20291)
-- from associating wrong customers across branches.

ALTER TABLE public.stock_customers
  ADD COLUMN IF NOT EXISTS branch_id TEXT REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS stock_customers_branch_id_idx
  ON public.stock_customers(branch_id);

CREATE INDEX IF NOT EXISTS stock_customers_branch_nic_idx
  ON public.stock_customers(branch_id, upper(nic))
  WHERE nic IS NOT NULL AND btrim(nic) <> '' AND btrim(nic) <> '0';

