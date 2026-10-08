-- ─────────────────────────────────────────────
-- 명세표·견적서 성명 칸에 찍을 도장
-- ─────────────────────────────────────────────

-- 도장 이미지를 공개 폴더(public)에 두면 주소만 알면 로그인 없이 누구나 받아 갈 수 있다.
-- 그래서 DB 에 넣어 두고, 로그인한 사람에게만 GET /api/companies/:id/stamp 로 내준다.
--
-- companies 에 열로 붙이지 않고 따로 둔 까닭: companies 는 여러 곳에서 SELECT * 로 읽는데,
-- 거기에 수십 KB 짜리 그림이 매번 딸려 오게 된다.
CREATE TABLE company_stamps (
  company_id INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  png        TEXT NOT NULL,                          -- PNG 를 base64 로
  updated_at TEXT NOT NULL DEFAULT (datetime('now')) -- 바꿀 때마다 그림 주소가 달라지게 쓴다
);
