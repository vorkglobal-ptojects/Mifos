-- Migration 010: Document and ensure unique_tag column on public.pawns (Pattern C Order Tag)
ALTER TABLE public.pawns
  ADD COLUMN IF NOT EXISTS unique_tag TEXT;

CREATE INDEX IF NOT EXISTS idx_pawns_unique_tag ON public.pawns(unique_tag);

