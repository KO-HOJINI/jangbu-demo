-- ─────────────────────────────────────────────
-- 장부 한 줄이 어떻게 들어왔는지 남긴다
-- ─────────────────────────────────────────────

-- 금액을 현장 단가표(M별 금액)에서 자동으로 채웠으면 1.
-- 손으로 고치면 0 으로 돌아간다. 화면에 「자동」 딱지를 붙이는 데 쓴다.
-- 이미 있던 줄은 엑셀에서 옮겨 온 것이라 0 으로 둔다.
ALTER TABLE work_logs ADD COLUMN amount_auto INTEGER NOT NULL DEFAULT 0;

-- 줄을 만든 방법. NULL = 화면에서 직접 입력, 'photo' = 수기 장부 사진에서 읽어 올림.
ALTER TABLE work_logs ADD COLUMN entry_source TEXT;
