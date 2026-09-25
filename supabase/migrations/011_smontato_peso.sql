-- ============================================================
-- 011_smontato_peso.sql — Aggiunta campo Peso per i Fili
-- ============================================================

-- Aggiungiamo peso_totale (in grammi) alla tabella raw_items
ALTER TABLE raw_items ADD COLUMN IF NOT EXISTS weight numeric(10, 2) DEFAULT 0.0;
