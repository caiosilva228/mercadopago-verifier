-- ==============================================================================
-- MERCADO PAGO VERIFIER - MIGRATION INICIAL (SCHEMA mercadopago)
-- ==============================================================================

CREATE SCHEMA IF NOT EXISTS mercadopago;

-- 1. Permissões de uso do schema
GRANT USAGE ON SCHEMA mercadopago TO authenticated, anon, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA mercadopago TO authenticated, anon, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA mercadopago TO authenticated, anon, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA mercadopago GRANT ALL ON TABLES TO authenticated, anon, service_role;

-- 2. Tabela mercadopago.receipts
CREATE TABLE IF NOT EXISTS mercadopago.receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    original_filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    storage_path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    ocr_raw_text TEXT,
    ocr_confidence NUMERIC(5,2),
    amount_minor BIGINT,
    amount_display NUMERIC(14,2),
    currency TEXT DEFAULT 'ARS',
    transaction_date DATE,
    transaction_time TIME,
    bank_name TEXT,
    sender_name TEXT,
    recipient_name TEXT,
    destination_alias TEXT,
    transaction_reference TEXT,
    operation_number TEXT,
    transaction_number TEXT,
    extraction_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_receipts_sha256 ON mercadopago.receipts(sha256);
CREATE INDEX IF NOT EXISTS idx_receipts_user_id ON mercadopago.receipts(user_id);
CREATE INDEX IF NOT EXISTS idx_receipts_transaction_date ON mercadopago.receipts(transaction_date);

-- 3. Tabela mercadopago.verification_jobs
CREATE TABLE IF NOT EXISTS mercadopago.verification_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID NOT NULL REFERENCES mercadopago.receipts(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'uploaded',
    attempts INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_verification_jobs_status ON mercadopago.verification_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_verification_jobs_receipt_id ON mercadopago.verification_jobs(receipt_id);

-- 4. Tabela mercadopago.mercadopago_reports
CREATE TABLE IF NOT EXISTS mercadopago.mercadopago_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_date DATE NOT NULL,
    mercadopago_task_id TEXT NOT NULL,
    mercadopago_statement_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    currency TEXT NOT NULL DEFAULT 'ARS',
    file_name_csv TEXT,
    file_name_json TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    available_at TIMESTAMPTZ,
    downloaded_at TIMESTAMPTZ,
    raw_metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_mp_reports_date ON mercadopago.mercadopago_reports(report_date, status);
CREATE INDEX IF NOT EXISTS idx_mp_reports_task_id ON mercadopago.mercadopago_reports(mercadopago_task_id);

-- 5. Tabela mercadopago.mercadopago_transactions
CREATE TABLE IF NOT EXISTS mercadopago.mercadopago_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID REFERENCES mercadopago.mercadopago_reports(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL,
    pay_bank_transfer_id TEXT,
    external_reference TEXT,
    transaction_type TEXT NOT NULL,
    transaction_amount_minor BIGINT NOT NULL,
    transaction_currency TEXT NOT NULL,
    payment_method_type TEXT NOT NULL,
    payment_method TEXT NOT NULL,
    transaction_date TIMESTAMPTZ NOT NULL,
    settlement_date TIMESTAMPTZ,
    settlement_net_amount_minor BIGINT,
    description TEXT,
    raw_row JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_mp_tx_amount_date_curr ON mercadopago.mercadopago_transactions(transaction_amount_minor, transaction_date, transaction_currency);
CREATE INDEX IF NOT EXISTS idx_mp_tx_source_id ON mercadopago.mercadopago_transactions(source_id);
CREATE INDEX IF NOT EXISTS idx_mp_tx_pay_bank_transfer ON mercadopago.mercadopago_transactions(pay_bank_transfer_id);

-- 6. Tabela mercadopago.verification_matches
CREATE TABLE IF NOT EXISTS mercadopago.verification_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID NOT NULL REFERENCES mercadopago.receipts(id) ON DELETE CASCADE,
    transaction_id UUID REFERENCES mercadopago.mercadopago_transactions(id) ON DELETE SET NULL,
    status TEXT NOT NULL,
    confidence_score NUMERIC(5,2),
    time_difference_seconds INTEGER,
    match_reasons JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_verification_matches_receipt ON mercadopago.verification_matches(receipt_id);
CREATE INDEX IF NOT EXISTS idx_verification_matches_tx ON mercadopago.verification_matches(transaction_id);

-- Proteção estrita contra reutilização: unique index para SOURCE_ID/transaction_id nas verificações confirmadas (status = 'verified')
CREATE UNIQUE INDEX IF NOT EXISTS unique_verified_transaction_id 
ON mercadopago.verification_matches (transaction_id) 
WHERE status = 'verified';

-- 7. Tabela mercadopago.audit_logs
CREATE TABLE IF NOT EXISTS mercadopago.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_event ON mercadopago.audit_logs(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON mercadopago.audit_logs(entity_type, entity_id);

-- 8. Habilitar RLS em todas as tabelas
ALTER TABLE mercadopago.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercadopago.verification_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercadopago.mercadopago_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercadopago.mercadopago_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercadopago.verification_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercadopago.audit_logs ENABLE ROW LEVEL SECURITY;

-- Policies para receipts
CREATE POLICY receipts_authenticated_select ON mercadopago.receipts
    FOR SELECT TO authenticated
    USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY receipts_authenticated_insert ON mercadopago.receipts
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY receipts_authenticated_update ON mercadopago.receipts
    FOR UPDATE TO authenticated
    USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY receipts_authenticated_delete ON mercadopago.receipts
    FOR DELETE TO authenticated
    USING (user_id = auth.uid() OR user_id IS NULL);

-- Policies para jobs, reports, transactions e matches
CREATE POLICY jobs_authenticated_select ON mercadopago.verification_jobs FOR SELECT TO authenticated USING (true);
CREATE POLICY jobs_authenticated_insert ON mercadopago.verification_jobs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY jobs_authenticated_update ON mercadopago.verification_jobs FOR UPDATE TO authenticated USING (true);

CREATE POLICY reports_authenticated_select ON mercadopago.mercadopago_reports FOR SELECT TO authenticated USING (true);
CREATE POLICY transactions_authenticated_select ON mercadopago.mercadopago_transactions FOR SELECT TO authenticated USING (true);

CREATE POLICY matches_authenticated_select ON mercadopago.verification_matches FOR SELECT TO authenticated USING (true);
CREATE POLICY matches_authenticated_insert ON mercadopago.verification_matches FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY matches_authenticated_update ON mercadopago.verification_matches FOR UPDATE TO authenticated USING (true);

CREATE POLICY audit_logs_authenticated_select ON mercadopago.audit_logs FOR SELECT TO authenticated USING (user_id = auth.uid() OR user_id IS NULL);
CREATE POLICY audit_logs_authenticated_insert ON mercadopago.audit_logs FOR INSERT TO authenticated WITH CHECK (true);

-- 9. Bucket Supabase Storage privado 'payment-receipts'
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'payment-receipts',
    'payment-receipts',
    false,
    10485760, -- 10MB
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

CREATE POLICY "Authenticated users can upload payment-receipts"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'payment-receipts');

CREATE POLICY "Authenticated users can view payment-receipts"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'payment-receipts');

CREATE POLICY "Authenticated users can delete payment-receipts"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'payment-receipts');
