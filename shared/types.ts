/** 워커와 프론트가 함께 쓰는 타입 정의 */

/** KV 에 보관된 백업 한 벌 */
export interface BackupEntry {
  key: string;
  /** YYYY-MM-DD */
  date: string;
  createdAt: string;
  bytes: number;
  rows: number;
  /** 되돌리기 직전에 자동으로 떠 둔 것이면 그 사연 */
  note?: string;
}

export interface User {
  id: number;
  /** 로그인 아이디 (이메일 아님) */
  username: string;
  name: string;
}

export interface Company {
  id: number;
  name: string;
  biz_no: string;
  ceo_name: string | null;
  address: string | null;
  biz_type: string | null;
  biz_item: string | null;
  tel: string | null;
  fax: string | null;
  is_default: number;
  sort_order: number;
  /** 보관한 회사는 새 명세표·견적서에서 고를 수 없다 (0012 를 돌리기 전에는 값이 없다) */
  archived?: number;
  /** 도장을 바꾼 시각. 없으면 도장이 없는 것 (목록 조회에서만 붙는다) */
  stamp_updated_at?: string | null;
}

export interface Client {
  id: number;
  name: string;
  full_name: string | null;
  biz_no: string | null;
  ceo_name: string | null;
  address: string | null;
  tel: string | null;
  memo: string | null;
  archived: number;
}

export interface Site {
  id: number;
  client_id: number;
  name: string;
  /** 장부(시트용) 표기 그대로. 예: 아라(광장) */
  label: string;
  /** 원청 (샘플건설, 예시건설 …) */
  prime_contractor: string | null;
  address: string | null;
  /** 사업자 구분 — 이 현장을 어느 회사 이름으로 청구하는지 */
  company_id: number | null;
  closing_day: string | null;
  issue_day: string | null;
  registered_at: string | null;
  memo: string | null;
  archived: number;
}

/** 현장별 규격 단가 */
export interface SiteRate {
  id?: number;
  site_id?: number;
  boom_size: number;
  half_day_amount: number | null;
  full_day_amount: number | null;
}

export interface SiteContact {
  id?: number;
  site_id?: number;
  name: string;
  phone: string | null;
  email: string | null;
  sort_order?: number;
}

/** 현장 관리 목록의 한 줄 */
export interface SiteListItem extends Site {
  client_name: string;
  client_full_name: string | null;
  company_name: string | null;
  /** 이 현장이 장부에 쓰인 횟수 — 0 이어야 삭제할 수 있다 */
  work_count: number;
  rate_count: number;
  contact_count: number;
}

/** 현장 상세 — 엑셀의 현장별 시트(예: 새봄(양재))에 해당 */
export interface SiteDetail {
  site: Site;
  client: Client;
  company: Company | null;
  rates: SiteRate[];
  contacts: SiteContact[];
  /** 월별로 묶은 작업과 그 달의 명세표 합계 */
  months: {
    month: string;
    rows: WorkLogRow[];
    supplyAmount: number;
    vatAmount: number;
    totalAmount: number;
  }[];
}

export interface SiteInput {
  client_name: string;
  client_full_name?: string | null;
  name: string;
  label?: string | null;
  prime_contractor?: string | null;
  address?: string | null;
  company_id?: number | null;
  closing_day?: string | null;
  issue_day?: string | null;
  memo?: string | null;
  rates?: SiteRate[];
  contacts?: SiteContact[];
}

export interface Operator {
  id: number;
  name: string;
  memo: string | null;
  archived: number;
  /** 1 = 우리 기사님(월급을 주는 분), 0 = 다른 사장님(외주) */
  is_staff: number;
}

/** 기사님 월급 — 「이 달부터 얼마」 */
export interface OperatorSalary {
  id: number;
  operator_id: number;
  /** YYYY-MM */
  from_month: string;
  amount: number;
}

/** 기사님·달마다 적는 것: 그 달 월급을 줬는지 */
export interface OperatorPay {
  operator_id: number;
  /** YYYY-MM */
  month: string;
  /** 준 날. 안 줬으면 null */
  paid_date: string | null;
  /** 줄 때의 월급 */
  paid_salary: number | null;
}

/** 야간수당 한 건 — 월급과 따로, 건마다 적고 건마다 줬는지 표시한다 */
export interface OperatorOt {
  id: number;
  operator_id: number;
  /** 야간 작업을 한 날 (YYYY-MM-DD) */
  work_date: string;
  amount: number;
  note: string | null;
  /** 준 날. 안 줬으면 null */
  paid_date: string | null;
}

export interface OperatorPayResponse {
  salaries: OperatorSalary[];
  pays: OperatorPay[];
  ots: OperatorOt[];
}

export interface WorkLog {
  id: number;
  work_date: string;
  site_id: number;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
  pour_volume: number | null;
  boom_size: number | null;
  ot_hours: number;
  base_amount: number;
  operator_id: number | null;
  /** 사업자 (엑셀 L열) — 자유 입력 */
  business_owner: string | null;
  fuel_amount: number | null;
  extra_amount: number | null;
  note: string | null;
  sort_order: number;
  /** 금액을 현장 단가표에서 자동으로 채웠으면 1 (손으로 고치면 0) — 화면의 「자동」 딱지 */
  amount_auto: number;
  /** 줄을 만든 방법: null = 화면에서 입력, 'photo' = 수기 장부 사진에서 읽어 올림 */
  entry_source: 'photo' | null;
  /** DB 계산 컬럼: base_amount × 0.1 × ot_hours (원 단위 반올림) */
  ot_amount: number;
  /** DB 계산 컬럼: base_amount + ot_amount */
  supply_amount: number;
}

/** 메일 보내는 네이버 계정 (비밀번호는 화면으로 오지 않는다) */
export interface MailAccount {
  id: number;
  /** 화면에 보일 이름 (예: 한강중기) */
  label: string | null;
  username: string;
  /** 보내는 주소 — 아이디만 적었으면 @naver.com 이 붙는다 */
  address: string;
  /** 서버 비밀값으로 넣어 둔 계정 — 화면에서 고치거나 지울 수 없다 */
  fixed: boolean;
}

/** 새 작업을 올릴 때 그 현장·규격의 단가가 없어, 이번 금액이 단가로 등록되었으면 답에 같이 온다 */
export interface RateLearned {
  slot: 'half_day' | 'full_day';
  amount: number;
}

/** 장부 목록에 붙는 조인 필드 */
export interface WorkLogRow extends WorkLog {
  site_label: string;
  client_id: number;
  client_name: string;
  operator_name: string | null;
  /** 이미 발행된 명세표에 포함된 건이면 그 명세표 id */
  statement_id: number | null;
}

export type WorkLogInput = Omit<
  WorkLog,
  'id' | 'ot_amount' | 'supply_amount' | 'sort_order' | 'amount_auto' | 'entry_source'
> & { sort_order?: number; amount_auto?: number; entry_source?: 'photo' | null };

export interface Masters {
  companies: Company[];
  clients: Client[];
  sites: Site[];
  operators: Operator[];
  /** 현장별 규격 단가 — 장부에서 금액을 자동으로 채울 때 쓴다 */
  rates: SiteRate[];
  /** 입력 자동완성 후보 — 과거 장부에서 실제 쓰인 값들 */
  suggestions: {
    descriptions: string[];
    boomSizes: number[];
    baseAmounts: number[];
    businessOwners: string[];
  };
}

export interface WorkLogQuery {
  from?: string;
  to?: string;
  siteId?: number;
  clientId?: number;
  operatorId?: number;
  q?: string;
}

// ── 거래명세표 ──────────────────────────────────────────────────────────

export interface Statement {
  id: number;
  company_id: number;
  client_id: number;
  site_id: number | null;
  issue_date: string;
  period_start: string;
  period_end: string;

  supplier_name: string;
  supplier_biz_no: string | null;
  supplier_ceo: string | null;
  supplier_address: string | null;
  supplier_biz_type: string | null;
  supplier_biz_item: string | null;
  supplier_tel: string | null;
  supplier_fax: string | null;

  customer_name: string;
  customer_biz_no: string | null;
  customer_ceo: string | null;
  customer_address: string | null;
  customer_site_name: string | null;

  vat_rate: number;
  note: string | null;
  status: 'draft' | 'issued' | 'void';
  /** YYYY-MM-DD (입금 완료된 날짜, 미수금이면 null) */
  paid_at: string | null;
  /** 실제 입금된 금액 (기본값: null = 합계 금액 전액) */
  paid_amount: number | null;
  /** 입금 메모 (예: 국민은행 입금, 3.3% 차인) */
  paid_memo: string | null;
  created_at: string;
  created_by: number | null;
}

export interface StatementPayInput {
  paid_at?: string;
  paid_amount?: number | null;
  paid_memo?: string | null;
}

export interface StatementLine {
  id: number;
  statement_id: number;
  work_log_id: number | null;
  line_no: number;
  work_date: string;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
  ot_hours: number;
  boom_size: number | null;
  supply_amount: number;
  vat_amount: number;
  source_hash: string | null;
  /** 명세표에서 직접 고친 줄 (이후 장부와 대조하지 않는다) */
  edited: number;
}

export interface StatementTotals {
  count: number;
  supplyAmount: number;
  vatAmount: number;
  totalAmount: number;
}

/** 발행 후 원본 장부가 바뀌었는지 표시하기 위한 상태 */
export interface StatementLineStatus extends StatementLine {
  /** 원본 장부 행이 발행 이후 수정됨 */
  changed: boolean;
  /** 원본 장부 행이 삭제됨 */
  missing: boolean;
}

export interface StatementDetail {
  statement: Statement;
  lines: StatementLineStatus[];
  totals: StatementTotals;
}

export interface StatementListItem extends Statement {
  client_name: string;
  site_label: string | null;
  line_count: number;
  supply_amount: number;
  vat_amount: number;
  total_amount: number;
}

/** 아직 발행하지 않은 후보 줄 (장부에서 그대로 가져온 것) */
export interface StatementPreviewLine {
  work_log_id: number;
  work_date: string;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
  ot_hours: number;
  boom_size: number | null;
  supply_amount: number;
  vat_amount: number;
  /** 이미 다른 명세표에 들어간 작업이면 그 명세표 id */
  issued_statement_id: number | null;
}

export interface StatementPreview {
  lines: StatementPreviewLine[];
  totals: StatementTotals;
}

export interface StatementCreateInput {
  company_id: number;
  /** 직접 입력이면 비워도 된다 (서버가 숨은 「직접 입력」 거래처에 묶는다) */
  client_id: number | null;
  site_id: number | null;
  issue_date: string;
  period_start: string;
  period_end: string;
  work_log_ids: number[];
  note?: string | null;
  /** 「직접 입력」: 장부에 없는 곳 — 상호 칸에 찍힐 받는 곳 이름. 주면 client_id 는 쓰지 않는다 */
  customer_name?: string | null;
  /** 장부에 없는 줄을 손으로 적어 함께 발행한다 (임시 현장, 추가 요금 등) */
  manual_lines?: StatementManualLine[];
}

/** 명세표에 손으로 적어 넣는 한 줄 (장부와 연결되지 않는다) */
export interface StatementManualLine {
  work_date: string;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
  ot_hours: number;
  boom_size: number | null;
  supply_amount: number;
}

// ── 견적서 ──────────────────────────────────────────────────────────────

export interface Quote {
  id: number;
  company_id: number;
  client_id: number;
  site_id: number | null;
  issue_date: string;

  supplier_name: string;
  supplier_biz_no: string | null;
  supplier_ceo: string | null;
  supplier_address: string | null;
  supplier_biz_type: string | null;
  supplier_biz_item: string | null;
  supplier_tel: string | null;
  supplier_fax: string | null;

  customer_name: string;
  customer_site_name: string | null;
  customer_site_address: string | null;

  note: string | null;
  status: 'draft' | 'issued' | 'void';
  created_at: string;
  created_by: number | null;
}

export interface QuoteLine {
  id: number;
  quote_id: number;
  line_no: number;
  /** 품명 — 펌프카 장비 */
  item_name: string | null;
  /** 규격 — 42M */
  spec: string | null;
  /** 기준 — 하루 / 반나절 */
  basis: string | null;
  supply_amount: number;
  vat_amount: number;
}

export interface QuoteDetail {
  quote: Quote;
  lines: QuoteLine[];
}

export interface QuoteListItem extends Quote {
  client_name: string;
  site_label: string | null;
  line_count: number;
}

export interface QuoteCreateInput {
  company_id: number;
  client_id: number;
  site_id: number | null;
  issue_date: string;
  note?: string | null;
  /** 안 넘기면 현장의 단가표에서 자동으로 만든다 */
  lines?: Pick<QuoteLine, 'item_name' | 'spec' | 'basis' | 'supply_amount'>[];
}

// ── 현장별 집계 ─────────────────────────────────────────────────────────

/** 현장 하나의 한 달치 합계 */
export interface SiteMonthCell {
  site_id: number;
  site_label: string;
  client_id: number;
  client_name: string;
  /** YYYY-MM */
  month: string;
  count: number;
  supply_amount: number;
  /** 아직 어떤 명세표에도 담기지 않은 금액 */
  unbilled_amount: number;
  unbilled_count: number;
  /** 명세표가 발행되었으나 아직 입금되지 않은 금액 (미수금) */
  unpaid_amount: number;
  unpaid_count: number;
}

export interface SummaryResponse {
  cells: SiteMonthCell[];
  /** 기간 안에 실제로 작업이 있었던 달 (오름차순) */
  months: string[];
}

export interface LedgerResponse {
  rows: WorkLogRow[];
  totals: {
    count: number;
    baseAmount: number;
    otAmount: number;
    supplyAmount: number;
    vatAmount: number;
    totalAmount: number;
    fuelAmount: number;
  };
}

// ── 동시 접속 ────────────────────────────────────────────────────────────

/** 지금 살아 있는 로그인 한 벌 */
export interface SessionEntry {
  /** 사용자 이름 (계정을 여럿 만들었을 때 구분용) */
  userName: string;
  /** '윈도우 크롬' 처럼 사람이 알아볼 기기 이름 */
  device: string;
  /** 'statement:12' — 같은 문서를 보고 있는지 맞춰보는 열쇠 */
  viewing: string | null;
  /** '26년 8월 아라 광장' — 화면에 그대로 보여줄 이름 */
  viewingLabel: string | null;
  /** ISO 8601 (UTC) */
  lastSeen: string;
  /** 지금 이 브라우저인가 */
  self: boolean;
}

export interface PresenceResponse {
  sessions: SessionEntry[];
  /** 장부가 마지막으로 바뀐 시각의 표시. 앞서 받은 값과 다르면 그 사이에 누군가 저장한 것이다 (없으면 null) */
  changed: string | null;
}

// ── 임시저장 ─────────────────────────────────────────────────────────────

/** 되돌아갈 수 있는 지점 하나 */
export interface DraftPoint {
  id: number;
  /** ISO 8601 (UTC) */
  savedAt: string;
  /** 지금 보고 있는 지점인가 */
  current: boolean;
}

export interface DraftState<T = unknown> {
  payload: T;
  /** ISO 8601 (UTC) */
  savedAt: string;
  canUndo: boolean;
  canRedo: boolean;
  /** 최근 것이 앞에 온다 */
  points: DraftPoint[];
}

/** 거래명세표 작성 중인 내용 */
export interface StatementDraft {
  companyId: number | null;
  clientId: number | null;
  siteId: string;
  from: string;
  to: string;
  issueDate: string;
  note: string;
  /** 빼놓은 장부 줄 (work_log_id) */
  excluded: number[];
  /** 「직접 입력」으로 적은 현장 이름 (등록하지 않은 임시 현장). 없으면 목록에서 고른 현장 */
  siteName?: string | null;
  /** 손으로 적은 명세 줄 (예전 임시저장에는 없다) */
  manualLines?: StatementManualLine[];
}

/** 견적서 작성 중인 내용 */
export interface QuoteDraft {
  companyId: number | null;
  clientId: number | null;
  siteId: string;
  issueDate: string;
  note: string;
  /** 양식에서 줄을 고쳤을 때만 담긴다. 없으면 현장 단가표를 그대로 따른다 */
  lines?: QuoteDraftLine[] | null;
  /** 양식에서 고친 머리 칸 (현장명·소재지·공급자 칸). 발행할 때 덮어쓴다 */
  headerEdits?: Record<string, string | null>;
}

/** 발행 전 견적 줄 (id 는 화면에서만 쓰는 번호) */
export interface QuoteDraftLine {
  id: number;
  item_name: string | null;
  spec: string | null;
  basis: string | null;
  supply_amount: number;
}

/** 대시보드 통계 */
export interface DashboardKpi {
  workCount: number;
  supplyAmount: number;
  baseAmount: number;
  otAmount: number;
  fuelAmount: number;
  extraAmount: number;
  netAmount: number;
  pourVolume: number;
  otHours: number;
  unbilledAmount: number;
  unpaidAmount: number;
}

export interface DashboardBoomStat {
  boomSize: number | null;
  label: string;
  count: number;
  supplyAmount: number;
  fuelAmount: number;
  pourVolume: number;
  otHours: number;
  avgSupply: number;
  fuelRatio: number;
}

export interface DashboardOperatorStat {
  operatorId: number | null;
  operatorName: string;
  /** 우리 기사님(월급을 주는 분)인지 — 표에서 맨 위에 온다 */
  isStaff: boolean;
  count: number;
  supplyAmount: number;
  fuelAmount: number;
  extraAmount: number;
  pourVolume: number;
  otHours: number;
  avgSupply: number;
  fuelRatio: number;
}

export interface DashboardMonthStat {
  month: string;
  count: number;
  supplyAmount: number;
  fuelAmount: number;
  netAmount: number;
  pourVolume: number;
}

export interface DashboardOwnerStat {
  owner: string;
  count: number;
  supplyAmount: number;
  fuelAmount: number;
}

export interface DashboardClientStat {
  clientId: number;
  name: string;
  count: number;
  supplyAmount: number;
  /** 아직 명세표를 안 낸 금액 (엑셀로 낸 옛 장부는 빼고) */
  unbilledAmount: number;
  /** 명세표는 냈는데 아직 못 받은 금액 */
  unpaidAmount: number;
}

export interface DashboardResponse {
  period: { from: string; to: string };
  kpi: DashboardKpi;
  byBoomSize: DashboardBoomStat[];
  byOperator: DashboardOperatorStat[];
  byMonth: DashboardMonthStat[];
  byOwner: DashboardOwnerStat[];
  byClient: DashboardClientStat[];
}

