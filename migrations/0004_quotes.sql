-- 견적서 — 일 시작 전에 현장에 단가를 제시하는 문서.
-- 엑셀 '견적서' 시트(아래쪽 판, 23~33행)에 해당한다.

CREATE TABLE quotes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  client_id  INTEGER NOT NULL REFERENCES clients(id)   ON DELETE RESTRICT,
  site_id    INTEGER REFERENCES sites(id) ON DELETE RESTRICT,
  issue_date TEXT NOT NULL,

  -- 공급자 스냅샷 (발행 후 회사 정보가 바뀌어도 견적서는 그대로)
  supplier_name     TEXT NOT NULL,
  supplier_biz_no   TEXT,
  supplier_ceo      TEXT,
  supplier_address  TEXT,
  supplier_biz_type TEXT,
  supplier_biz_item TEXT,
  supplier_tel      TEXT,
  supplier_fax      TEXT,

  -- 공급받는자 스냅샷
  customer_name         TEXT NOT NULL,
  customer_site_name    TEXT,
  customer_site_address TEXT,

  note       TEXT,
  status     TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('draft','issued','void')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_quotes_client ON quotes(client_id, issue_date);
CREATE INDEX idx_quotes_site   ON quotes(site_id, issue_date);

CREATE TABLE quote_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id      INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  line_no       INTEGER NOT NULL,
  item_name     TEXT,                       -- 품명 (펌프카 장비)
  spec          TEXT,                       -- 규격 (42M)
  basis         TEXT,                       -- 기준 (하루 / 반나절)
  supply_amount INTEGER NOT NULL DEFAULT 0,
  vat_amount    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_quote_lines_quote ON quote_lines(quote_id, line_no);
