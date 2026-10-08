-- 거래명세표 관리 — 초기 스키마 (Cloudflare D1 / SQLite)

PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────
-- 계정
-- ─────────────────────────────────────────────
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,                -- 아이디 (이메일 아님)
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,                       -- pbkdf2$<iter>$<salt>$<hash>
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,                       -- 랜덤 토큰
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- ─────────────────────────────────────────────
-- 기준 정보
-- ─────────────────────────────────────────────

-- 공급자 = 내 회사 (한강중기 / 금강중기)
CREATE TABLE companies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,          -- 한강중기(샘플중기)
  biz_no     TEXT NOT NULL UNIQUE,   -- 123-45-67890
  ceo_name   TEXT,                   -- 김대표
  address    TEXT,
  biz_type   TEXT,                   -- 업태: 건설업
  biz_item   TEXT,                   -- 종목: 건설기계대여
  tel        TEXT,
  fax        TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- 공급받는자 = 거래처
CREATE TABLE clients (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL UNIQUE,    -- 장부 표기 그대로: 아라
  full_name TEXT,                    -- 명세표에 찍힐 정식 상호: 아라개발(주)
  biz_no    TEXT,
  ceo_name  TEXT,
  address   TEXT,
  tel       TEXT,
  memo      TEXT,
  archived  INTEGER NOT NULL DEFAULT 0
);

-- 현장 — 장부의 현장명 하나가 곧 여기 한 행 (이름별로 전부 구분)
--   엑셀 '거래처 등록용' 시트 한 줄이 여기 한 행에 대응한다.
CREATE TABLE sites (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id        INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  name             TEXT NOT NULL,           -- 광장 / 부천 / 다솜
  label            TEXT NOT NULL UNIQUE,    -- 장부(시트용) 표기: 아라(광장), 다솜
  prime_contractor TEXT,                    -- 원청 (샘플건설, 예시건설 …)
  address          TEXT,                    -- 현장 주소
  -- 사업자 구분: 이 현장을 어느 회사 이름으로 청구하는지 (한강중기 / 금강중기)
  company_id       INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  closing_day      TEXT,                    -- 마감일 (예: 25일)
  issue_day        TEXT,                    -- 발행일 (예: 25일)
  registered_at    TEXT,                    -- 등록일자
  memo             TEXT,
  archived         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sites_client ON sites(client_id);

-- 현장별 규격(붐 길이)별 단가표. 장부에 금액을 넣을 때 자동으로 채워 준다.
CREATE TABLE site_rates (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id         INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  boom_size       INTEGER NOT NULL,        -- 26 / 32 / 37 / 42 …
  half_day_amount INTEGER,                 -- 반나절
  full_day_amount INTEGER,                 -- 하루
  UNIQUE (site_id, boom_size)
);

-- 현장 담당자 (한 현장에 여러 명)
CREATE TABLE site_contacts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id    INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,                -- 관리부장 김철수
  phone      TEXT,
  email      TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_site_contacts_site ON site_contacts(site_id);

-- 기사님 (일부는 외주 업체명 — 정리는 설정 화면에서)
CREATE TABLE operators (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT NOT NULL UNIQUE,
  memo     TEXT,
  archived INTEGER NOT NULL DEFAULT 0
);

-- ─────────────────────────────────────────────
-- 장부 — 작업 1건 = 1행
-- ─────────────────────────────────────────────
CREATE TABLE work_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  work_date   TEXT    NOT NULL,                       -- YYYY-MM-DD
  site_id     INTEGER NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  description TEXT,                                   -- 작업 내용
  start_time  TEXT,                                   -- HH:MM
  end_time    TEXT,                                   -- HH:MM
  pour_volume REAL,                                   -- 타설 (m3)
  boom_size   INTEGER,                                -- 규격 M
  ot_hours    REAL    NOT NULL DEFAULT 0,             -- OT 시간
  base_amount INTEGER NOT NULL DEFAULT 0,             -- 기본 장비대
  operator_id INTEGER REFERENCES operators(id) ON DELETE SET NULL,
  business_owner TEXT,                                -- 사업자 (엑셀 L열)
  fuel_amount INTEGER,                                -- 주유 (엑셀 M열)
  extra_amount INTEGER,                               -- 기타 (엑셀 N열, 주유와 병합된 칸)
  note        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,             -- 같은 날짜 안에서의 순서
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),

  -- 엑셀 수식과 동일: OT금액 = 기본금액 x 0.1 x OT시간, 공급가액 = 기본 + OT
  ot_amount     INTEGER GENERATED ALWAYS AS (CAST(base_amount * ot_hours / 10.0 AS INTEGER)) VIRTUAL,
  supply_amount INTEGER GENERATED ALWAYS AS (base_amount + CAST(base_amount * ot_hours / 10.0 AS INTEGER)) VIRTUAL
);
CREATE INDEX idx_work_logs_date      ON work_logs(work_date);
CREATE INDEX idx_work_logs_site_date ON work_logs(site_id, work_date);

-- ─────────────────────────────────────────────
-- 거래명세표 — 발행 시점 스냅샷
--   장부를 나중에 고쳐도 이미 발행한 명세표 금액은 바뀌지 않는다.
-- ─────────────────────────────────────────────
CREATE TABLE statements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  client_id    INTEGER NOT NULL REFERENCES clients(id)   ON DELETE RESTRICT,
  site_id      INTEGER REFERENCES sites(id) ON DELETE RESTRICT,   -- NULL = 거래처 전체
  issue_date   TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,

  -- 공급자 스냅샷
  supplier_name     TEXT NOT NULL,
  supplier_biz_no   TEXT,
  supplier_ceo      TEXT,
  supplier_address  TEXT,
  supplier_biz_type TEXT,
  supplier_biz_item TEXT,
  supplier_tel      TEXT,
  supplier_fax      TEXT,

  -- 공급받는자 스냅샷
  customer_name      TEXT NOT NULL,
  customer_biz_no    TEXT,
  customer_ceo       TEXT,
  customer_address   TEXT,
  customer_site_name TEXT,

  vat_rate   REAL NOT NULL DEFAULT 0.1,
  note       TEXT,
  status     TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('draft','issued','void')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_statements_client ON statements(client_id, period_start);
CREATE INDEX idx_statements_site   ON statements(site_id, period_start);

CREATE TABLE statement_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  statement_id  INTEGER NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
  work_log_id   INTEGER REFERENCES work_logs(id) ON DELETE SET NULL,  -- 원본 추적
  line_no       INTEGER NOT NULL,
  work_date     TEXT NOT NULL,
  description   TEXT,
  start_time    TEXT,
  end_time      TEXT,
  ot_hours      REAL    NOT NULL DEFAULT 0,
  boom_size     INTEGER,
  supply_amount INTEGER NOT NULL,          -- 발행 시점 확정 금액
  vat_amount    INTEGER NOT NULL,
  source_hash   TEXT,                      -- 원본 work_log 해시 → 사후 변경 감지
  -- 명세표에서 직접 고친 줄. 이후로는 장부와 비교하지 않는다(엉뚱한 변경 경고 방지)
  edited        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_statement_lines_stmt    ON statement_lines(statement_id, line_no);
CREATE INDEX idx_statement_lines_worklog ON statement_lines(work_log_id);
