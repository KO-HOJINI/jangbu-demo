import type {
  BackupEntry,
  Client,
  Company,
  DashboardResponse,
  DraftState,
  LedgerResponse,
  Masters,
  Operator,
  OperatorOt,
  OperatorPay,
  OperatorPayResponse,
  OperatorSalary,
  PresenceResponse,
  Quote,
  QuoteCreateInput,
  QuoteDetail,
  QuoteLine,
  QuoteListItem,
  SessionEntry,
  Site,
  SiteDetail,
  SiteInput,
  SiteListItem,
  Statement,
  StatementCreateInput,
  StatementDetail,
  StatementLine,
  StatementListItem,
  StatementPayInput,
  StatementPreview,
  MailAccount,
  RateLearned,
  SummaryResponse,
  User,
  WorkLog,
  WorkLogQuery,
  WorkLogRow,
} from '../../shared/types';

import type { OverdueSite } from '../../shared/issueDue';

export interface OverdueResponse {
  today: string;
  items: OverdueSite[];
  count: number;
  amount: number;
}

/** 메일로 보낼 수 있는 문서 — 주소의 첫 마디와 같다 */
export type MailDoc = 'statements' | 'quotes';

/** 비밀번호를 비우면(고칠 때) 원래 것을 그대로 둔다 */
export interface MailAccountInput {
  label: string;
  username: string;
  password: string;
}

export interface SentEmail {
  to_addrs: string;
  subject: string | null;
  status: 'sent' | 'failed';
  error: string | null;
  /** 보낸 계정. 네이버 메일 창·메일 앱으로 보낸 기록은 비어 있다 */
  from_addr: string | null;
  sent_at: string;
}

export interface PushDevice {
  endpoint: string;
  device: string;
  createdAt: string;
  lastSentAt: string | null;
  lastStatus: string | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init?.headers } : init?.headers,
  });

  if (!res.ok) {
    // 로그인이 끝났으면(30일이 지났거나 다른 기기에서 비밀번호를 바꿈) 로그인 화면으로 돌려보낸다
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('jangbu:signed-out'));
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? `요청에 실패했습니다. (${res.status})`, res.status);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

const toQuery = (query: object) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '' && value !== null) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
};

export const api = {
  login: (username: string, password: string) =>
    request<User>('/auth/login', { method: 'POST', ...json({ username, password }) }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  me: () => request<User>('/auth/me'),
  changePassword: (current: string, next: string) =>
    request<void>('/auth/password', { method: 'POST', ...json({ current, next }) }),

  /** 「나 아직 여기 있다」고 알리고, 지금 접속 중인 목록을 받는다 */
  presence: (view: string | null, label: string | null) =>
    request<PresenceResponse>('/presence', { method: 'POST', ...json({ view, label }) }),
  // 수기 장부 사진 읽기 (Workers AI) — 읽기만 하고 올리기는 createWorkLog 로 한 줄씩
  readPhotoLog: (image: string, careful = false) =>
    request<{ model: string; seconds: number; rows: unknown[] }>('/photo-logs/read', { method: 'POST', ...json({ image, careful }) }),

  // 메일 보내는 네이버 계정 (설정 > 계정). canAdd 가 false 면 서버에 비밀번호를 잠글 열쇠가 없어 등록할 수 없다
  mailAccounts: () => request<{ accounts: MailAccount[]; canAdd: boolean }>('/mail/accounts'),
  addMailAccount: (input: MailAccountInput) => request<{ id: number }>('/mail/accounts', { method: 'POST', ...json(input) }),
  updateMailAccount: (id: number, input: MailAccountInput) =>
    request<void>(`/mail/accounts/${id}`, { method: 'PATCH', ...json(input) }),
  deleteMailAccount: (id: number) => request<void>(`/mail/accounts/${id}`, { method: 'DELETE' }),

  // 거래명세표·견적서를 메일로 (doc 은 'statements' 또는 'quotes')
  docRecipients: (doc: MailDoc, id: number) => request<{ email: string; label: string }[]>(`/${doc}/${id}/recipients`),
  docEmails: (doc: MailDoc, id: number) => request<SentEmail[]>(`/${doc}/${id}/emails`),
  emailDoc: (
    doc: MailDoc,
    id: number,
    input: { account_id: number; to: string[]; subject: string; text: string; pdf: string; filename: string }
  ) => request<{ ok: true; to: string[]; from: string }>(`/${doc}/${id}/email`, { method: 'POST', ...json(input) }),
  logDocEmail: (doc: MailDoc, id: number, input: { to: string[]; subject: string }) =>
    request<{ ok: true }>(`/${doc}/${id}/email-log`, { method: 'POST', ...json(input) }),

  // 발행일 알림 — 맨 위 알림 띠와 휴대폰·PC 알림
  overdue: () => request<OverdueResponse>('/alerts/overdue'),
  pushKey: () => request<{ publicKey: string; ready: boolean }>('/push/key'),
  pushDevices: () => request<PushDevice[]>('/push/devices'),
  pushSubscribe: (sub: PushSubscriptionJSON) => request<void>('/push/subscribe', { method: 'POST', ...json(sub) }),
  pushUnsubscribe: (endpoint: string) => request<void>('/push/unsubscribe', { method: 'POST', ...json({ endpoint }) }),
  pushTest: (endpoint: string) => request<{ ok: true }>('/push/test', { method: 'POST', ...json({ endpoint }) }),

  sessions: () => request<SessionEntry[]>('/sessions'),
  logoutOthers: () => request<{ removed: number }>('/sessions/others', { method: 'DELETE' }),

  draft: <T>(kind: string) => request<DraftState<T> | null>(`/drafts/${kind}`),
  saveDraft: <T>(kind: string, payload: T) =>
    request<DraftState<T>>(`/drafts/${kind}`, { method: 'PUT', ...json({ payload }) }),
  undoDraft: <T>(kind: string) => request<DraftState<T>>(`/drafts/${kind}/undo`, { method: 'POST' }),
  redoDraft: <T>(kind: string) => request<DraftState<T>>(`/drafts/${kind}/redo`, { method: 'POST' }),
  restoreDraft: <T>(kind: string, id: number) =>
    request<DraftState<T>>(`/drafts/${kind}/restore`, { method: 'POST', ...json({ id }) }),
  clearDraft: (kind: string) => request<void>(`/drafts/${kind}`, { method: 'DELETE' }),

  usage: () => request<{ operators: Record<string, number>; clients: Record<string, number>; operatorLast: Record<string, string> }>(
      '/usage'
    ),

  backups: () => request<BackupEntry[]>('/backups'),
  runBackup: () => request<BackupEntry>('/backups', { method: 'POST' }),
  /** confirm 은 그 백업의 날짜(YYYY-MM-DD) — 실수로 누르는 것을 막는다 */
  restoreBackup: (key: string, confirm: string) =>
    request<{ safety: BackupEntry }>('/backups/restore', { method: 'POST', ...json({ key, confirm }) }),
  backupUrl: (key: string) => `/api/backups/${encodeURIComponent(key)}`,
  createCompany: (input: { name: string; biz_no: string }) =>
    request<Company>('/companies', { method: 'POST', ...json(input) }),
  updateCompany: (id: number, patch: Partial<Company>) =>
    request<Company>(`/companies/${id}`, { method: 'PATCH', ...json(patch) }),
  /** png 는 base64 (data: 앞머리 없이) */
  uploadStamp: (id: number, png: string) =>
    request<{ stamp_updated_at: string }>(`/companies/${id}/stamp`, { method: 'PUT', ...json({ png }) }),
  removeStamp: (id: number) => request<void>(`/companies/${id}/stamp`, { method: 'DELETE' }),
  updateClient: (id: number, patch: Partial<Client>) =>
    request<Client>(`/clients/${id}`, { method: 'PATCH', ...json(patch) }),
  createOperator: (name: string) =>
    request<Operator>('/operators', { method: 'POST', ...json({ name }) }),
  updateOperator: (id: number, patch: Partial<Operator>) =>
    request<Operator>(`/operators/${id}`, { method: 'PATCH', ...json(patch) }),
  deleteOperator: (id: number) => request<void>(`/operators/${id}`, { method: 'DELETE' }),
  /** 기사님 월급, 달마다의 지급 기록, 야간수당. from·to 는 YYYY-MM (없으면 전부) */
  operatorPay: (query: { from?: string; to?: string } = {}) => request<OperatorPayResponse>(`/operator-pay${toQuery(query)}`),
  setSalary: (operatorId: number, body: { from_month: string; amount: number }) =>
    request<OperatorSalary>(`/operators/${operatorId}/salary`, { method: 'PUT', ...json(body) }),
  deleteSalary: (id: number) => request<void>(`/operator-salaries/${id}`, { method: 'DELETE' }),
  /** 그 달 월급을 준 날을 적는다 (null 이면 되돌림) */
  setOperatorPay: (operatorId: number, month: string, body: { paid_date: string | null }) =>
    request<OperatorPay>(`/operator-pay/${operatorId}/${month}`, { method: 'PUT', ...json(body) }),
  /** 야간수당 한 건 */
  addOperatorOt: (body: { operator_id: number; work_date: string; amount: number; note: string | null }) =>
    request<OperatorOt>('/operator-ot', { method: 'POST', ...json(body) }),
  /** 금액을 고치거나(amount), 준 날을 적는다(paid_date, null 이면 되돌림) */
  updateOperatorOt: (id: number, body: { amount?: number; paid_date?: string | null }) =>
    request<OperatorOt>(`/operator-ot/${id}`, { method: 'PATCH', ...json(body) }),
  deleteOperatorOt: (id: number) => request<void>(`/operator-ot/${id}`, { method: 'DELETE' }),

  masters: () => request<Masters>('/masters'),

  sites: () => request<SiteListItem[]>('/sites'),
  site: (id: number) => request<SiteDetail>(`/sites/${id}`),
  archiveSite: (id: number, archived: boolean) =>
    request<Site>(`/sites/${id}/archive`, { method: 'PATCH', ...json({ archived: archived ? 1 : 0 }) }),
  deleteSite: (id: number) => request<void>(`/sites/${id}`, { method: 'DELETE' }),
  createSite: (input: SiteInput) => request<Site>('/sites', { method: 'POST', ...json(input) }),
  updateSite: (id: number, input: SiteInput) =>
    request<Site>(`/sites/${id}`, { method: 'PUT', ...json(input) }),

  ledger: (query: WorkLogQuery) => request<LedgerResponse>(`/work-logs${toQuery(query)}`),

  createWorkLog: (input: NewWorkLog) =>
    request<WorkLogRow & { rate_learned?: RateLearned }>('/work-logs', { method: 'POST', ...json(input) }),
  updateWorkLog: (id: number, patch: Partial<WorkLog>) =>
    request<WorkLogRow>(`/work-logs/${id}`, { method: 'PATCH', ...json(patch) }),
  deleteWorkLog: (id: number) => request<void>(`/work-logs/${id}`, { method: 'DELETE' }),

  statements: (query: { clientId?: number; siteId?: number; from?: string; to?: string } = {}) =>
    request<StatementListItem[]>(`/statements${toQuery(query)}`),
  statementPreview: (query: { clientId: number; siteId?: number; from: string; to: string }) =>
    request<StatementPreview>(`/statements/preview${toQuery(query)}`),
  statement: (id: number) => request<StatementDetail>(`/statements/${id}`),
  createStatement: (input: StatementCreateInput) =>
    request<{ id: number }>('/statements', { method: 'POST', ...json(input) }),
  updateStatement: (id: number, patch: Partial<Statement>) =>
    request<void>(`/statements/${id}`, { method: 'PATCH', ...json(patch) }),
  updateStatementLine: (id: number, lineId: number, patch: Partial<StatementLine>) =>
    request<void>(`/statements/${id}/lines/${lineId}`, { method: 'PATCH', ...json(patch) }),
  addStatementLine: (id: number) => request<void>(`/statements/${id}/lines`, { method: 'POST' }),
  deleteStatementLine: (id: number, lineId: number) =>
    request<void>(`/statements/${id}/lines/${lineId}`, { method: 'DELETE' }),
  payStatement: (id: number, input?: StatementPayInput) =>
    request<{ ok: boolean; paid_at: string; paid_amount: number; paid_memo: string | null }>(
      `/statements/${id}/pay`,
      { method: 'POST', ...json(input ?? {}) }
    ),
  unpayStatement: (id: number) => request<{ ok: boolean }>(`/statements/${id}/unpay`, { method: 'POST' }),

  quotes: () => request<QuoteListItem[]>('/quotes'),
  quote: (id: number) => request<QuoteDetail>(`/quotes/${id}`),
  quotePreview: (siteId: number) =>
    request<{ lines: Pick<QuoteLine, 'item_name' | 'spec' | 'basis' | 'supply_amount'>[] }>(
      `/quotes/preview?siteId=${siteId}`
    ),
  createQuote: (input: QuoteCreateInput) =>
    request<{ id: number }>('/quotes', { method: 'POST', ...json(input) }),
  updateQuote: (id: number, patch: Partial<Quote>) =>
    request<void>(`/quotes/${id}`, { method: 'PATCH', ...json(patch) }),
  updateQuoteLine: (id: number, lineId: number, patch: Partial<QuoteLine>) =>
    request<void>(`/quotes/${id}/lines/${lineId}`, { method: 'PATCH', ...json(patch) }),
  addQuoteLine: (id: number) => request<void>(`/quotes/${id}/lines`, { method: 'POST' }),
  deleteQuoteLine: (id: number, lineId: number) =>
    request<void>(`/quotes/${id}/lines/${lineId}`, { method: 'DELETE' }),
  voidQuote: (id: number) => request<void>(`/quotes/${id}/void`, { method: 'POST' }),
  deleteQuote: (id: number) => request<void>(`/quotes/${id}`, { method: 'DELETE' }),

  summary: (query: { from?: string; to?: string; clientId?: number } = {}) =>
    request<SummaryResponse>(`/summary${toQuery(query)}`),

  dashboard: (query: { from?: string; to?: string } = {}) =>
    request<DashboardResponse>(`/dashboard${toQuery(query)}`),

  voidStatement: (id: number) => request<void>(`/statements/${id}/void`, { method: 'POST' }),
  reissueStatement: (id: number) => request<void>(`/statements/${id}/reissue`, { method: 'POST' }),
  deleteStatement: (id: number) => request<void>(`/statements/${id}`, { method: 'DELETE' }),
};

/** 새 작업 한 줄. rate_slot 은 단가가 없던 현장·규격에 시간 없이 적었을 때 사용자가 고른 하루·반나절 */
export type NewWorkLog = Partial<WorkLog> & { rate_slot?: RateLearned['slot'] };
