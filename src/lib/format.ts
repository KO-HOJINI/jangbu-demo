// 발행일 규칙은 서버(매일 아침 알림)와 같이 쓰도록 shared/issueDue.ts 에 있다
import { DEFAULT_ISSUE_DAY, parseDayOfMonth } from '../../shared/issueDue';
import type { RateLearned } from '../../shared/types';

const WON = new Intl.NumberFormat('ko-KR');

export const won = (value: number | null | undefined) => (value == null ? '' : WON.format(value));

/** 2026-06-22 -> 6/22 */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}

/** 2026-06-22 -> 2026년 6월 22일 */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${y}년 ${Number(m)}월 ${Number(d)}일`;
}

export { DEFAULT_ISSUE_DAY };

/** "25일", "25", "말일" -> 25 / 'last'. 못 읽으면 기본값. */
export function parseIssueDay(raw: string | null | undefined): number | 'last' {
  return parseDayOfMonth(raw, DEFAULT_ISSUE_DAY);
}

export interface IssueDeadline {
  /** 다음 발행 마감일 YYYY-MM-DD */
  date: string;
  /** 오늘 기준 남은 날 수 (오늘이면 0) */
  daysLeft: number;
  /** 화면에 그대로 쓰는 문구 */
  label: string;
  urgency: 'normal' | 'soon' | 'today';
}

/**
 * 다음 발행 마감일을 구한다.
 * 이번 달 마감일이 아직 안 지났으면 이번 달, 지났으면 다음 달이 된다.
 */
export function issueDeadline(issueDay: string | null | undefined, from = today()): IssueDeadline {
  const day = parseIssueDay(issueDay);
  const [y, m, d] = from.split('-').map(Number);

  const dayOf = (year: number, month: number) => {
    const last = new Date(year, month, 0).getDate();
    return day === 'last' ? last : Math.min(day, last);
  };

  let year = y;
  let month = m;
  if (d > dayOf(y, m)) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  const target = dayOf(year, month);
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${year}-${pad(month)}-${pad(target)}`;

  const daysLeft = Math.round(
    (new Date(`${date}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86_400_000
  );

  const urgency = daysLeft <= 0 ? 'today' : daysLeft <= 3 ? 'soon' : 'normal';
  const label =
    daysLeft === 0 ? '오늘 발행' : daysLeft === 1 ? '내일 발행' : `발행까지 ${daysLeft}일`;

  return { date, daysLeft, label, urgency };
}

const pad2 = (v: string) => v.padStart(2, '0');

/** "8/13", "2026-08-13", "2026.8.13" 을 모두 YYYY-MM-DD 로. 연도가 없으면 base 의 연도를 쓴다. */
export function parseDateInput(input: string, base: string): string | null {
  const text = input.trim();

  const full = /^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?$/.exec(text);
  if (full) return `${full[1]}-${pad2(full[2])}-${pad2(full[3])}`;

  const short = /^(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?$/.exec(text);
  if (short) return `${base.slice(0, 4)}-${pad2(short[1])}-${pad2(short[2])}`;

  return null;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
export const weekday = (iso: string) => WEEKDAYS[new Date(`${iso}T00:00:00`).getDay()];

export const today = () => new Date().toLocaleDateString('sv-SE'); // sv-SE 로케일이 YYYY-MM-DD

/** 그 달의 1일 / 말일 */
export function monthRange(iso: string): [string, string] {
  const [y, m] = iso.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${pad(last)}`];
}

/** 기준일로부터 delta개월 이동한 달의 1일 / 말일 */
export function shiftMonthRange(iso: string, delta: number): [string, string] {
  const [y, m] = iso.split('-').map(Number);
  const base = new Date(y, m - 1 + delta, 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  const by = base.getFullYear();
  const bm = base.getMonth() + 1;
  return monthRange(`${by}-${pad(bm)}-01`);
}

const DIGITS = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const PLACES = ['', '십', '백', '천'];
const GROUPS = ['', '만', '억', '조'];

/**
 * 거래명세표 금액란용 한글 표기.
 *   1200000 -> "일백이십만원정 (₩1,200,000)"
 *
 * 원본 엑셀은 자릿수를 하나씩 잘라 붙이는 수식이라 1,204,000 같은 값에서
 * "만" 위치가 틀어졌다. 여기서는 4자리씩 묶어 계산해 그 문제를 없앴다.
 */
export function koreanAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount === 0) return `영원정 (₩0)`;

  const sign = amount < 0 ? '마이너스 ' : '';
  let rest = Math.abs(Math.trunc(amount));

  const chunks: string[] = [];
  for (let g = 0; rest > 0; g++) {
    const chunk = rest % 10_000;
    rest = Math.floor(rest / 10_000);
    if (chunk === 0) continue;

    let text = '';
    for (let p = 3; p >= 0; p--) {
      const digit = Math.floor(chunk / 10 ** p) % 10;
      if (digit) text += DIGITS[digit] + PLACES[p];
    }
    chunks.unshift(text + GROUPS[g]);
  }

  return `${sign}${chunks.join('')}원정 (₩${WON.format(amount)})`;
}

/**
 * 금액을 만 단위로 읽는다 — 1,400,000 → 「140만 원」, 120,500 → 「12만 500원」.
 * 큰 금액을 칠 때 0 을 하나 더 치거나 덜 친 것을 한눈에 알아보게 금액 칸 아래에 보여준다.
 */
export function manwon(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount) || amount === 0) return '';
  const n = Math.abs(Math.round(amount));
  const eok = Math.floor(n / 100_000_000);
  const man = Math.floor((n % 100_000_000) / 10_000);
  const rest = n % 10_000;

  const parts: string[] = [];
  if (eok) parts.push(`${WON.format(eok)}억`);
  if (man) parts.push(`${WON.format(man)}만`);
  if (rest) parts.push(WON.format(rest));
  // 「140만 원」 처럼 단위로 끝나면 띄우고, 「12만 500원」 처럼 숫자로 끝나면 붙인다
  return `${amount < 0 ? '-' : ''}${parts.join(' ')}${rest ? '원' : ' 원'}`;
}

/**
 * 현장 + 규격(M) 으로 그 현장의 단가를 찾는다.
 * 반나절 단가는 따로 있지만, 장부 입력에서는 하루 단가를 기본으로 넣는다.
 */
export function rateFor(
  rates: { site_id?: number; boom_size: number; half_day_amount: number | null; full_day_amount: number | null }[],
  siteId: number | null,
  boomSize: number | null
): number | null {
  if (siteId == null || boomSize == null) return null;
  const rate = rates.find((r) => r.site_id === siteId && r.boom_size === boomSize);
  return rate?.full_day_amount ?? rate?.half_day_amount ?? null;
}

/** 「42M 하루 단가 1,400,000원」 — 새 작업의 금액이 단가로 등록되었을 때 알리는 말 */
export function learnedRateText(boomSize: number | null, learned: RateLearned): string {
  return `${boomSize}M ${learned.slot === 'half_day' ? '반나절' : '하루'} 단가 ${won(learned.amount)}원`;
}

/** 07:00 ~ 16:00 (한쪽만 있으면 있는 쪽만) */
export function timeRange(start: string | null, end: string | null): string {
  if (start && end) return `${start}~${end}`;
  return start ?? end ?? '';
}

/**
 * 작업시간 한 칸을 읽는다. 엑셀에 쓰시던 대로 「07:00~17:00」 으로 적되,
 * 「7~17」, 「7:30-16」, 「0700 1700」, 「07001700」 처럼 대충 적어도 알아듣는다.
 * 비우면 둘 다 지운 것으로, 알아들을 수 없으면 null.
 */
export function parseTimeRangeInput(text: string): { start: string | null; end: string | null } | null {
  const t = text.trim();
  if (!t) return { start: null, end: null };

  let pieces = t.split(/\s*[~\-–]\s*|\s+/).filter(Boolean);
  if (pieces.length === 1 && /^\d{8}$/.test(pieces[0])) pieces = [pieces[0].slice(0, 4), pieces[0].slice(4)];
  if (pieces.length > 2) return null;

  const one = (p: string): string | null => {
    let h: number;
    let m: number;
    const colon = /^(\d{1,2})(?::(\d{2}))?$/.exec(p);
    const packed = /^(\d{3,4})$/.exec(p);
    if (colon) {
      h = Number(colon[1]);
      m = colon[2] ? Number(colon[2]) : 0;
    } else if (packed) {
      const s = packed[1].padStart(4, '0');
      h = Number(s.slice(0, 2));
      m = Number(s.slice(2));
    } else {
      return null;
    }
    if (h > 24 || m > 59 || (h === 24 && m > 0)) return null;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const start = one(pieces[0]);
  if (!start) return null;
  if (pieces.length === 1) return { start, end: null };
  const end = one(pieces[1]);
  return end ? { start, end } : null;
}

/** '방금 전' · '3분 전' · '오후 2:31' — 부모님이 바로 읽으실 수 있게 */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${minutes}분 전`;

  return new Date(then).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
}

/** '오후 2:31' — 되돌아갈 지점 목록처럼 시각 자체를 보여줄 때 */
export const clockTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });

/** 「9/29 오후 2:05」 — 메일 보낸 기록처럼 날짜와 시각이 같이 필요할 때 */
export const clockDate = (iso: string) => `${shortDate(new Date(iso).toLocaleDateString('sv-SE'))} ${clockTime(iso)}`;

/**
 * 새 작업을 올리면 단가가 없던 현장·규격은 그 금액이 단가로 등록된다.
 * 시간을 적었으면 시간으로 반나절·하루를 가르지만, 안 적었으면 알 수 없어 먼저 묻는다.
 */
export function shouldAskRateSlot(
  rates: { site_id?: number; boom_size: number }[],
  log: { siteId: number | null; boomSize: number | null; amount: number | null; hasTime: boolean }
): boolean {
  if (log.hasTime || log.siteId == null || log.boomSize == null || !log.amount || log.amount <= 0) return false;
  return !rates.some((r) => r.site_id === log.siteId && r.boom_size === log.boomSize);
}

/**
 * 새 작업에서 현장·규격을 바꿨을 때 금액 칸을 어떻게 할지. 바꿀 것이 없으면 null.
 *   - 손으로 친 금액은 건드리지 않는다.
 *   - 비어 있거나 자동으로 채운 그대로면 새 단가를 넣는다.
 *   - 자동으로 채운 금액인데 바꾼 현장·규격에 단가가 없으면 지운다. 그대로 두면 앞 현장의 금액이
 *     「자동」 딱지를 단 채 올라가고, 단가가 없던 새 현장의 단가로 등록된다.
 */
export function autoAmount(
  current: string,
  autoFilled: string | null,
  rate: number | null
): { amount: string; autoFilled: string | null } | null {
  const filled = current.trim() !== '' && current === autoFilled;
  if (current.trim() !== '' && !filled) return null;
  if (rate != null) return { amount: String(rate), autoFilled: String(rate) };
  return filled ? { amount: '', autoFilled: null } : null;
}
