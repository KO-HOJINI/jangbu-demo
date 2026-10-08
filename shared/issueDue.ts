/**
 * 「발행일이 되었는데 아직 명세표를 안 낸 작업」을 가리는 규칙.
 * 화면(맨 위 알림 띠)과 서버(매일 아침 휴대폰 알림)가 같은 규칙을 쓰도록 여기에 둔다.
 *
 *   발행일  : 현장의 발행일(예: 25일) 중 내일까지 돌아오는 가장 최근 날 (하루 전부터 알린다). 적혀 있지 않으면 25일.
 *   마감일  : 그 발행 때 담는 마지막 작업 날. 마감일이 발행일보다 뒤 날짜면(예: 마감 말일·발행 5일)
 *            지난달 마감이다. 적혀 있지 않으면 발행일과 같은 날로 본다.
 *   밀린 작업: 마감일까지의 작업 중 아직 어떤 명세표에도 담기지 않은 것.
 */

/**
 * 이 날 이후의 작업만 알린다.
 * 2026년 6~8월 장부는 엑셀에서 옮겨 온 것으로, 명세표는 이미 엑셀·종이로 냈다 (사용자 확인 2026-09-29).
 * 앱에서는 「미발행」으로 보이지만 매일 알림을 울리면 안 된다. 현장별 화면의 미발행 표시는 그대로 둔다.
 */
export const ALERT_FROM = '2026-09-01';

/**
 * 발행일 며칠 전부터 알릴지. 당일 아침에야 알면 준비할 틈이 없어 하루 전부터 알린다 (사용자 결정 2026-10-03).
 * 화면의 알림 띠·메뉴의 점·아침 휴대폰 알림이 모두 이 값을 따른다.
 */
export const ALERT_LEAD_DAYS = 1;

/** YYYY-MM-DD 에 n 일을 더한다 (달·해 넘김 포함) */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 현장에 발행일이 안 적혀 있을 때 쓰는 기본값 (보통 25일이 마감) */
export const DEFAULT_ISSUE_DAY = 25;

/** "25일", "25", "말일" -> 25 / 'last'. 못 읽으면 fallback. */
export function parseDayOfMonth(raw: string | null | undefined, fallback: number | 'last' = DEFAULT_ISSUE_DAY): number | 'last' {
  if (!raw) return fallback;
  if (/말/.test(raw)) return 'last';
  const n = Number(String(raw).replace(/[^\d]/g, ''));
  return n >= 1 && n <= 31 ? n : fallback;
}

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (year: number, month: number) => new Date(year, month, 0).getDate();
/** 그 달에 그 날짜가 없으면(2월 30일) 그 달 말일로 */
const dateIn = (year: number, month: number, day: number | 'last') =>
  `${year}-${pad(month)}-${pad(day === 'last' ? lastDay(year, month) : Math.min(day, lastDay(year, month)))}`;
const prevMonth = (year: number, month: number): [number, number] => (month === 1 ? [year - 1, 12] : [year, month - 1]);

export interface DuePeriod {
  /** 가장 최근 발행일 (오늘 포함) YYYY-MM-DD */
  issueDate: string;
  /** 이 발행에 담을 마지막 작업 날 YYYY-MM-DD */
  cutoff: string;
}

/** 오늘 기준으로 이미 돌아온 발행일과 그때 담을 작업의 마지막 날 */
export function duePeriod(
  site: { issue_day: string | null; closing_day: string | null },
  today: string
): DuePeriod {
  const [y, m] = today.split('-').map(Number);
  const issueDay = parseDayOfMonth(site.issue_day);

  // 이번 달 발행일이 아직 안 왔으면 지난달 발행일이 가장 최근이다
  let [iy, im] = [y, m];
  if (dateIn(y, m, issueDay) > today) [iy, im] = prevMonth(y, m);
  const issueDate = dateIn(iy, im, issueDay);

  const closingDay = parseDayOfMonth(site.closing_day, issueDay);
  let cutoff = dateIn(iy, im, closingDay);
  // 마감이 발행보다 뒤 날짜면 지난달 마감분을 이번 달에 발행하는 것이다
  if (cutoff > issueDate) {
    const [cy, cm] = prevMonth(iy, im);
    cutoff = dateIn(cy, cm, closingDay);
  }
  return { issueDate, cutoff };
}

/** 발행일·마감일만 있으면 된다. 현장을 안 골랐으면(거래처 전체 · 직접 입력) null — 25일로 본다 */
type DaySite = { issue_day: string | null; closing_day: string | null } | null | undefined;

const nextMonth = (year: number, month: number): [number, number] => (month === 12 ? [year + 1, 1] : [year, month + 1]);

/** 그 달 발행분에 담는 마지막 작업 날과, 그 날이 든 해·달 */
function cutoffIn(site: DaySite, year: number, month: number): { cutoff: string; at: [number, number] } {
  const issueDay = parseDayOfMonth(site?.issue_day);
  const closingDay = parseDayOfMonth(site?.closing_day, issueDay);
  // 마감이 발행보다 뒤 날짜면 지난달 마감분을 이번 달에 발행하는 것이다 (duePeriod 와 같은 규칙)
  const at: [number, number] =
    dateIn(year, month, closingDay) > dateIn(year, month, issueDay) ? prevMonth(year, month) : [year, month];
  return { cutoff: dateIn(at[0], at[1], closingDay), at };
}

/**
 * 그 달에 발행하는 명세표에 담는 한 달. [시작, 끝] YYYY-MM-DD.
 * 발행일이 25일이면 지난달 26일 ~ 이번 달 25일 (사용자 지시 2026-10-04). 발행일이 다르면 그 날에 맞춘 한 달이고,
 * 마감일이 따로 적혀 있으면 마감일까지 담는다.
 */
export function billingPeriod(site: DaySite, year: number, month: number): [string, string] {
  const { cutoff, at } = cutoffIn(site, year, month);
  const closingDay = parseDayOfMonth(site?.closing_day, parseDayOfMonth(site?.issue_day));
  const [py, pm] = prevMonth(at[0], at[1]);
  return [addDays(dateIn(py, pm, closingDay), 1), cutoff];
}

/** 오늘이 든 달에 발행하는 명세표의 한 달 */
export function currentBillingPeriod(site: DaySite, today: string): [string, string] {
  const [y, m] = today.split('-').map(Number);
  return billingPeriod(site, y, m);
}

/**
 * 지금 보고 있는 기간(끝 날 to)에서 delta 달 옮긴 한 달.
 * 현장을 바꿨을 때는 was 에 앞 현장을 넘긴다 — 보던 달은 그대로 두고 새 현장의 발행일에 맞춘다.
 */
export function shiftBillingPeriod(site: DaySite, to: string, delta: number, was: DaySite = site): [string, string] {
  let [y, m] = to.split('-').map(Number);
  // 지난달 마감분을 내는 현장은 끝 날의 다음 달이 발행 달이다
  const [ny, nm] = nextMonth(y, m);
  if (billingPeriod(was, y, m)[1] !== to && billingPeriod(was, ny, nm)[1] === to) [y, m] = [ny, nm];
  const moved = new Date(Date.UTC(y, m - 1 + delta, 1));
  return billingPeriod(site, moved.getUTCFullYear(), moved.getUTCMonth() + 1);
}

export interface OverdueSite {
  site_id: number;
  site_label: string;
  issue_date: string;
  cutoff: string;
  count: number;
  amount: number;
}

/**
 * 밀린 작업을 현장별로 모은다.
 * unbilled: 아직 어떤 명세표에도 담기지 않은 작업 (취소된 명세표에 있던 것 포함)
 */
export function collectOverdue(
  sites: { id: number; label: string; issue_day: string | null; closing_day: string | null; archived?: number }[],
  unbilled: { site_id: number; work_date: string; supply_amount: number }[],
  today: string
): OverdueSite[] {
  // 하루 전부터 알리므로 「내일까지 돌아오는 발행일」을 본다
  const until = addDays(today, ALERT_LEAD_DAYS);
  const periods = new Map(sites.map((s) => [s.id, { site: s, ...duePeriod(s, until) }]));
  const bySite = new Map<number, OverdueSite>();

  for (const log of unbilled) {
    const p = periods.get(log.site_id);
    if (!p || log.work_date > p.cutoff || log.work_date < ALERT_FROM) continue;
    const entry = bySite.get(log.site_id) ?? {
      site_id: log.site_id,
      site_label: p.site.label,
      issue_date: p.issueDate,
      cutoff: p.cutoff,
      count: 0,
      amount: 0,
    };
    entry.count += 1;
    entry.amount += log.supply_amount;
    bySite.set(log.site_id, entry);
  }

  return [...bySite.values()].sort((a, b) => b.amount - a.amount);
}

/**
 * 화면 맨 위 알림 띠의 제목. 오늘이 발행일인 현장과 발행일이 이미 지난 현장을 다르게 말한다
 * — 오늘 것까지 「지났는데 안 낸」이라고 하면 아직 늦지 않았는데 재촉하는 말이 된다.
 */
export function overdueTitle(items: { issue_date: string }[], today: string): string {
  const due = items.filter((i) => i.issue_date === today).length;
  const soon = items.filter((i) => i.issue_date > today).length;
  const late = items.length - due - soon;
  if (!due && !soon) return `발행일이 지났는데 안 낸 명세표 ${late}곳`;

  // 급한 순서: 오늘, 내일, 지난 것. 맨 앞에만 「발행할 명세표」를 붙인다
  const parts: string[] = [];
  if (due) parts.push(`오늘 발행할 명세표 ${due}곳`);
  if (soon) parts.push(due ? `내일 ${soon}곳` : `내일 발행할 명세표 ${soon}곳`);
  if (late) parts.push(`발행일이 지난 것 ${late}곳`);
  return parts.join(', ');
}
