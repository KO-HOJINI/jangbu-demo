-- ─────────────────────────────────────────────
-- 명세표 입금(수금) 및 미수금 관리
-- ─────────────────────────────────────────────

-- 1. statements 테이블에 입금일자, 실제 입금액, 입금 메모 추가
ALTER TABLE statements ADD COLUMN paid_at TEXT;
ALTER TABLE statements ADD COLUMN paid_amount INTEGER;
ALTER TABLE statements ADD COLUMN paid_memo TEXT;

-- 2. 입금일자 조회용 인덱스
CREATE INDEX idx_statements_paid ON statements(paid_at);
