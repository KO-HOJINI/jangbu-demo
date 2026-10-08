-- 내 회사 보관: 안 쓰게 된 회사를 새 명세표·견적서에서 고르지 못하게 숨긴다.
-- 이미 발행한 명세표는 공급자 칸을 따로 적어 두므로 그대로다.
ALTER TABLE companies ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
