import type { Masters, WorkLogRow } from '../../shared/types';
import { parseTimeRangeInput, rateFor, shortDate, timeRange } from './format';

/**
 * 수기 장부 사진에서 읽은 줄 → 장부에 올릴 줄.
 * AI 가 읽은 글자를 현장·기사님 목록에 맞추고, 이미 장부에 있는 줄을 가려 둔다.
 * 부모님이 화면에서 확인·고친 뒤에만 올라간다 (components/PhotoImport.tsx).
 */

/** AI 가 돌려주는 한 줄 (worker/routes/photoLogs.ts 의 프롬프트 모양) */
export interface PhotoRowRaw {
  date?: unknown;
  site?: unknown;
  /** 확인서의 「현장소재지」 — 현장의 주소. 「현장명」 칸을 비우고 여기에만 적기도 한다 */
  place?: unknown;
  /** 확인서의 「건설업자(임차인)」 — 거래처 */
  client?: unknown;
  work?: unknown;
  time?: unknown;
  m?: unknown;
  ot?: unknown;
  pour?: unknown;
  amount?: unknown;
  operator?: unknown;
  /** AI 가 장부의 현장 목록에서 고른 현장 (장부 표기 그대로). 없으면 새 현장 */
  site_pick?: unknown;
  /** AI 가 기사님 목록에서 고른 이름 */
  operator_pick?: unknown;
}

export interface PhotoRow {
  key: number;
  /** 올릴지 — 이미 있는 줄·현장을 모르는 줄은 처음에 꺼 둔다 */
  include: boolean;
  work_date: string;
  site_id: number | null;
  /** 사진에 적힌 현장 글자 (목록에서 못 찾았을 때 보여 준다) */
  site_text: string;
  /** 글자가 조금 달라 비슷한 현장으로 짐작했으면 true — 체크를 풀어 두고 부모님께 확인받는다 */
  site_guessed: boolean;
  /** 사진에 적힌 건설업자(거래처) 글자와, 목록에서 찾았으면 그 거래처 — 없는 현장을 새로 만들 때 쓴다 */
  client_text: string;
  client_id: number | null;
  /** 「현장명」과 「현장소재지」가 다 적혀 있을 때의 「현장소재지」 — 새 현장을 만들 때 주소로 넣는다 */
  address_text: string;
  description: string;
  /** 「07:00~17:00」 */
  time: string;
  boom_size: number | null;
  ot_hours: number;
  pour_volume: number | null;
  base_amount: number;
  /** 금액을 사진에서 못 읽어 단가표에서 채웠으면 1 */
  amount_auto: number;
  operator_id: number | null;
  operator_text: string;
  /** 이미 장부에 있는 줄 같으면 그 줄 */
  duplicateOf: { id: number; label: string } | null;
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const t = text(v).replace(/[,\s원]/g, '');
  if (!t) return null;
  // 「140만」 을 AI 가 그대로 넘겨도 알아듣는다
  const man = /^(\d+(?:\.\d+)?)만$/.exec(t);
  if (man) return Math.round(Number(man[1]) * 10_000);
  const n = Number(t.replace(/[^\d.-]/g, ''));
  return t.replace(/[^\d.-]/g, '') && Number.isFinite(n) ? n : null;
};
/** 띄어쓰기·괄호·가운뎃점을 빼고 견준다 — 「나래 한강」 = 「나래(한강)」 */
const squash = (s: string) => s.replace(/[\s()（）·.\-_]/g, '').toLowerCase();

/** 사진의 현장 글자 → 현장 (보관한 현장은 빼고) */
export function matchSite(raw: string, sites: Masters['sites']): number | null {
  if (!raw) return null;
  const live = sites.filter((s) => !s.archived);
  const exact = live.find((s) => s.label === raw);
  if (exact) return exact.id;
  const key = squash(raw);
  const same = live.filter((s) => squash(s.label) === key);
  if (same.length === 1) return same[0].id;
  // 「광장」 처럼 현장 이름만 적었을 때 — 하나로 딱 떨어질 때만
  const partial = live.filter((s) => squash(s.label).includes(key) || key.includes(squash(s.name)));
  return partial.length === 1 ? partial[0].id : null;
}

/** 한글을 자음·모음으로 풀어 둔다 — 「빌나」와 「빌라」는 자모 하나만 다르다 */
function jamo(s: string): string[] {
  const out: string[] = [];
  for (const ch of s) {
    const c = ch.charCodeAt(0) - 0xac00;
    if (c < 0 || c > 11171) {
      out.push(ch);
      continue;
    }
    out.push(`초${Math.floor(c / 588)}`, `중${Math.floor((c % 588) / 28)}`);
    if (c % 28) out.push(`종${c % 28}`);
  }
  return out;
}

/** 자모를 몇 개 고쳐야 같아지는지로 잰 닮은 정도 (1 이면 같다) */
function likeness(a: string, b: string): number {
  const x = jamo(a);
  const y = jamo(b);
  if (!x.length || !y.length) return 0;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[y.length] / Math.max(x.length, y.length);
}

/**
 * 가장 닮은 후보. 충분히 닮았고(least), 둘째보다 확실히 앞설 때만 고른다 —
 * 「시흥」처럼 두 현장에 똑같이 가까우면 고르지 않는다.
 */
function closest<T>(raw: string, candidates: { item: T; forms: string[] }[], least: number): T | null {
  const scored = candidates
    .map((c) => ({ item: c.item, score: Math.max(...c.forms.map((f) => likeness(raw, f))) }))
    .sort((a, b) => b.score - a.score);
  const [first, second] = scored;
  if (!first || first.score < least) return null;
  return second && first.score - second.score < 0.08 ? null : first.item;
}

/** 현장을 부르는 여러 이름 — 장부 표기, 현장 이름, 거래처와 현장 이름을 이어 적은 것 (「시흥아라」) */
function siteForms(s: Masters['sites'][number], clients: Masters['clients'] | undefined): string[] {
  const client = clients?.find((c) => c.id === s.client_id)?.name;
  const forms = [s.label, s.name];
  if (client && client !== s.name) forms.push(client + s.name, s.name + client);
  return forms.map(squash);
}

/**
 * 사진의 현장 글자 → 현장. 이름이 같거나 한 곳에만 들어맞으면 확실히 맞춘 것,
 * 글자가 조금 달라 가장 닮은 현장을 고른 것이면 짐작(guessed)이다.
 */
export function findSite(raw: string, masters: Pick<Masters, 'sites' | 'clients'>): { id: number | null; guessed: boolean } {
  const none = { id: null, guessed: false };
  if (!raw) return none;
  const live = masters.sites.filter((s) => !s.archived);
  const key = squash(raw);
  const named = live.filter((s) => siteForms(s, masters.clients).includes(key));
  if (named.length === 1) return { id: named[0].id, guessed: false };
  if (named.length > 1) return none;
  const sure = matchSite(raw, live);
  if (sure != null) return { id: sure, guessed: false };
  const near = closest(key, live.map((s) => ({ item: s.id, forms: siteForms(s, masters.clients) })), 0.7);
  return near == null ? none : { id: near, guessed: true };
}

/** 「아라개발(주)」 → 「아라」 — 거래처는 꼬리를 뗀 짧은 이름으로 적어 둔다 (lib/print.ts 의 파일 이름 규칙과 같다) */
const clientShort = (s: string) =>
  s
    .replace(/\((주|유|합)\)|주식회사|㈜/g, '')
    .replace(/(종합건설|개발|건설|산업|중기|기업)\s*$/, '')
    .trim();
const clientKey = (s: string) => squash(clientShort(s));

/** 사진의 건설업자 글자 → 거래처. 꼬리를 떼고 같으면 그 거래처, 아니면 아주 닮은 하나 */
export function findClient(raw: string, clients: Masters['clients'] | undefined): number | null {
  const key = clientKey(raw);
  if (!key || !clients?.length) return null;
  const live = clients.filter((c) => !c.archived);
  const forms = (c: Masters['clients'][number]) => [c.name, c.full_name ?? ''].filter(Boolean).flatMap((n) => [squash(n), clientKey(n)]);
  const same = live.filter((c) => forms(c).includes(key) || forms(c).includes(squash(raw)));
  if (same.length === 1) return same[0].id;
  if (same.length > 1) return null;
  const near = closest(key, live.map((c) => ({ item: c.id, forms: forms(c) })), 0.75);
  if (near != null) return near;
  // 손글씨는 회사 이름의 꼬리를 자주 틀리게 읽는다 (「아라캐피탈」「새봄생신」) — 앞머리가 두 글자 넘는 거래처 이름 하나와만 같으면 그 거래처
  const head = live.filter((c) => squash(c.name).length >= 2 && squash(raw).startsWith(squash(c.name)));
  return head.length === 1 ? head[0].id : null;
}

/**
 * 확인서 한 장의 현장 찾기. 거래처를 알면 그 거래처의 현장 안에서만 찾는다 —
 * 「부천」이 두 거래처에 있어도 하나로 정해지고, 현장 글자를 틀리게 읽어도 후보가 적어 짐작이 잘 맞는다.
 * 그 거래처에 닮은 현장이 없으면 비워 둔다 (새 현장).
 */
/** 낱말 순서만 다르게 적은 같은 이름 — 「광명-서울 고속도로」 = 「서울-광명 고속도로」 */
const words = (s: string) =>
  s
    .split(/[^0-9A-Za-z가-힣]+/)
    .filter(Boolean)
    .sort()
    .join('')
    .toLowerCase();

function findFormSite(siteRaw: string, clientId: number | null, masters: Pick<Masters, 'sites' | 'clients'>): { id: number | null; guessed: boolean } {
  if (clientId == null) return findSite(siteRaw, masters);
  const own = masters.sites.filter((s) => !s.archived && s.client_id === clientId);
  if (!own.length) return { id: null, guessed: false };
  if (!siteRaw) return own.length === 1 ? { id: own[0].id, guessed: true } : { id: null, guessed: false };
  const keys = [squash(siteRaw), words(siteRaw)];
  const forms = (s: Masters['sites'][number]) => [...siteForms(s, masters.clients), words(s.name)];
  const named = own.filter((s) => forms(s).some((f) => keys.includes(f)));
  if (named.length === 1) return { id: named[0].id, guessed: false };
  // 한 거래처의 현장은 몇 곳뿐이라 반쯤만 닮아도 짐작해 둔다 — 짐작은 체크를 풀어 두고 확인받는다
  const near = keys.map((k) => closest(k, own.map((s) => ({ item: s.id, forms: forms(s) })), 0.5)).find((id) => id != null);
  return near == null ? { id: null, guessed: false } : { id: near, guessed: true };
}

const tokens = (s: string) => s.toLowerCase().split(/[^0-9a-z가-힣]+/).filter(Boolean);

/**
 * 사진의 글자가 현장 주소에 들어 있는지 — 「광명-서울 고속도로」 는 주소 「샘플 고속도로 2공구」 안에 있다.
 * 확인서의 「현장소재지」에는 장부의 현장 이름(「부천」) 대신 도로·노선 이름을 적기도 한다.
 * 「판교」처럼 짧은 글자는 여러 주소에 우연히 들어가므로 네 글자부터 본다.
 */
function inAddress(raw: string, address: string | null): boolean {
  if (!address) return false;
  const [a, b] = [tokens(raw), tokens(address)];
  const within = (x: string[], y: string[]) => x.join('').length >= 4 && (x.every((t) => y.includes(t)) || y.join('').includes(x.join('')));
  return within(a, b) || within(b, a);
}

/**
 * 「현장명」 칸으로 먼저 찾고, 못 찾으면 「현장소재지」로도 찾는다. 확실히 맞춘 쪽이 짐작보다 앞선다.
 * 현장 이름으로 못 찾으면 확인서의 다른 내용으로 가려 본다 (2026-10-05 사용자 요청):
 *   주소가 맞는 현장이 하나면 그 현장 → 이름이 닮은 현장(짐작) → 현장소재지가 비어 있으면 원청이 같은 현장(짐작)
 *   → 현장 글자가 아예 없으면 그 규격 단가가 있는 현장이 하나일 때 그 현장(짐작).
 * 현장소재지가 적혀 있는데 못 찾은 것은 새 현장이다 — 원청이 같다고 고르면 같은 원청의 다른 현장이 된다
 * (「새봄건설 / 신안산선 / 예시건설건설」 이 「새봄(양재)」로 골라졌다).
 * 짐작은 체크를 풀어 두고 확인받는다. 끝까지 못 찾으면 새 현장이다 (wantsNewSite).
 */
function findAmong(
  texts: string[],
  clientId: number | null,
  masters: Pick<Masters, 'sites' | 'clients' | 'rates'>,
  boom: number | null,
  hasPlace: boolean
): { id: number | null; guessed: boolean } {
  const found = (texts.length ? texts : ['']).map((t) => findFormSite(t, clientId, masters));
  const sure = found.find((f) => f.id != null && !f.guessed);
  if (sure) return sure;

  const own = masters.sites.filter((s) => !s.archived && (clientId == null || s.client_id === clientId));
  const only = (list: typeof own) => (list.length === 1 ? list[0].id : null);
  const byAddress = only(own.filter((s) => texts.some((t) => inAddress(t, s.address))));
  if (byAddress != null) return { id: byAddress, guessed: false };

  const near = found.find((f) => f.id != null);
  if (near) return near;
  // 거래처를 모르면 여기서 그친다 — 원청·규격만으로 온 장부에서 고르면 엉뚱한 거래처의 현장이 된다
  if (clientId == null) return { id: null, guessed: false };

  if (hasPlace) return { id: null, guessed: false };

  const primes = texts.map(clientKey).filter(Boolean);
  const byPrime = only(own.filter((s) => s.prime_contractor && primes.includes(clientKey(s.prime_contractor))));
  if (byPrime != null) return { id: byPrime, guessed: true };

  const byBoom = !texts.length && boom != null ? only(own.filter((s) => masters.rates?.some((r) => r.site_id === s.id && r.boom_size === boom))) : null;
  return byBoom != null ? { id: byBoom, guessed: true } : { id: null, guessed: false };
}

/** 현장을 끝내 못 찾았는데 사진에 거래처나 현장 글자가 있는 줄 — 「새 현장으로 추가」 상자를 열어 둔다 */
export function wantsNewSite(row: Pick<PhotoRow, 'site_id' | 'site_text' | 'client_text'>): boolean {
  return row.site_id == null && (row.site_text !== '' || row.client_text !== '');
}

/** 사진 줄을 「새 현장으로 추가」할 때 채워 둘 값. 아는 거래처면 그 이름, 모르면 꼬리(건설·개발)를 뗀 이름 */
export function newSiteDraft(
  row: Pick<PhotoRow, 'client_id' | 'client_text' | 'site_text' | 'address_text'>,
  masters: Pick<Masters, 'clients'>
): { client_name: string; name: string; address: string } {
  const known = masters.clients?.find((c) => c.id === row.client_id);
  return { client_name: known?.name ?? clientShort(row.client_text), name: row.site_text, address: row.address_text };
}

/** 읽은 모델을 화면에 적을 이름으로 — 「gemini-3.6-flash」→「Gemini 3.6 Flash」 */
export function modelLabel(model: string): string {
  if (model.startsWith('gemini-')) {
    return model
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
  const qwen = /qwen(\d[\d.]*)/.exec(model);
  if (qwen) return `Qwen ${qwen[1]}`;
  const llama = /llama-(\d[\d.]*)-(scout)?/.exec(model);
  if (llama) return llama[2] ? `Llama ${llama[1]} Scout` : `Llama ${llama[1]}`;
  return model;
}

export function matchOperator(raw: string, operators: Masters['operators']): number | null {
  if (!raw) return null;
  const live = operators.filter((o) => !o.archived);
  const same = live.find((o) => o.name === raw) ?? live.find((o) => squash(o.name) === squash(raw));
  if (same) return same.id;
  // 「대」「장」 같은 한 글자 이름은 짐작하면 엉뚱한 분이 되기 쉬워, 두 글자 넘는 이름만
  if (squash(raw).length < 2) return null;
  const long = live.filter((o) => squash(o.name).length >= 2);
  const near = closest(squash(raw), long.map((o) => ({ item: o.id, forms: [squash(o.name)] })), 0.7);
  if (near != null) return near;
  // 확인서에는 이름 석 자(「윤효진」)를, 장부에는 성만(「윤」) 적는다 — 성이 같은 한 글자 기사님이 한 분이면 그분
  if (squash(raw).length !== 3) return null;
  const surname = live.filter((o) => o.name === squash(raw)[0]);
  return surname.length === 1 ? surname[0].id : null;
}

/** 작업 내용 — 자주 쓰는 말(장부에 많이 나온 순서 앞쪽)과 아주 닮았을 때만 그 말로 고친다 (「장기대」→「장비대」) */
export function snapWork(raw: string, descriptions: string[] | undefined): string {
  const key = squash(raw);
  if (key.length < 2 || !descriptions?.length) return raw;
  const common = descriptions.slice(0, 30);
  const same = common.find((d) => squash(d) === key);
  if (same) return raw;
  return closest(key, common.map((d) => ({ item: d, forms: [squash(d)] })), 0.75) ?? raw;
}

/**
 * 「9/1」 → 2026-09-01. 연도가 없으면 올해로 보되, 그러면 오늘보다 한참 뒤가 되는 날짜
 * (1월에 12월 장부를 찍은 경우)는 작년으로 본다.
 */
export function photoDate(raw: string, today: string): string | null {
  const full = /(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/.exec(raw);
  if (full) return `${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}`;
  const md = /(\d{1,2})\s*[-./월]\s*(\d{1,2})/.exec(raw);
  if (!md) return null;
  const [m, d] = [Number(md[1]), Number(md[2])];
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  let year = Number(today.slice(0, 4));
  const iso = (y: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const soon = new Date(`${today}T00:00:00`);
  soon.setDate(soon.getDate() + 31);
  if (iso(year) > soon.toISOString().slice(0, 10)) year -= 1;
  return iso(year);
}

export function normalizeRows(raw: unknown[], masters: Masters, today: string): PhotoRow[] {
  let lastDate = today;
  return raw
    .filter((r): r is PhotoRowRaw => !!r && typeof r === 'object')
    .map((r, i) => {
      // 날짜를 한 번만 적고 이어 쓴 줄은 윗줄 날짜
      const date = photoDate(text(r.date), today) ?? lastDate;
      lastDate = date;

      // 「현장명」 칸(KCC건설·예시건설건설)이 현장 이름이고 「현장소재지」는 그 현장의 주소다 (2026-10-05 사용자가 바로잡음 —
      // 그 전에는 거꾸로 현장소재지를 이름, 현장명 칸을 원청으로 넣었다). 현장명 칸이 비어 있으면 현장소재지가 이름이 된다
      const [place, named] = [text(r.place), text(r.site)];
      const site_text = named || place;
      const address_text = named ? place : '';
      const client_text = text(r.client);
      const client_id = findClient(client_text, masters.clients);
      const boom = num(r.m);
      // 거래처가 적혀 있는데 목록에 없으면 새 거래처다 — 이름이 비슷한 다른 거래처의 현장을 골라 두지 않는다
      const unknownClient = client_text !== '' && client_id == null;
      const found = unknownClient ? { id: null, guessed: false } : findAmong([named, place].filter(Boolean), client_id, masters, boom, place !== '');
      // AI 가 고른 현장은 목록에 있는 이름이고 거래처가 어긋나지 않을 때만 받는다.
      // 앱이 확실히 맞춘 것이 먼저이고, 앱의 짐작과 같으면 확실, AI 만 골랐으면 짐작(체크를 풀어 둔다)
      // 현장 이름이 거래처 이름뿐인 현장(「다솜」)은 AI 가 「그 거래처면 여기」 하고 고르기 쉽다 — 확인서에 현장 글자가 있으면 받지 않는다
      const catchAll = (s: Masters['sites'][number]) => s.name === masters.clients?.find((c) => c.id === s.client_id)?.name;
      const picked = masters.sites.find(
        (s) => !s.archived && s.label === text(r.site_pick) && (client_id == null || s.client_id === client_id) && !(site_text !== '' && catchAll(s))
      );
      const { id: site_id, guessed: site_guessed } =
        found.id != null && !found.guessed
          ? found
          : picked && found.id === picked.id
            ? { id: picked.id, guessed: false }
            : found.id != null
              ? found
              : { id: picked?.id ?? null, guessed: picked != null };
      const operator_text = text(r.operator);
      const times = parseTimeRangeInput(text(r.time));

      const written = num(r.amount);
      const rate = site_id != null && boom != null ? rateFor(masters.rates, site_id, boom) : null;
      const base_amount = written ?? rate ?? 0;

      return {
        key: i,
        include: site_id != null && !site_guessed,
        work_date: date,
        site_id,
        site_text,
        site_guessed,
        client_text,
        client_id,
        address_text,
        description: snapWork(text(r.work), masters.suggestions?.descriptions),
        time: times ? timeRange(times.start, times.end) : text(r.time),
        boom_size: boom,
        ot_hours: num(r.ot) ?? 0,
        pour_volume: num(r.pour),
        base_amount,
        amount_auto: written == null && rate != null ? 1 : 0,
        // 앱이 못 찾은 기사님만 AI 가 목록에서 고른 이름으로 채운다
        operator_id:
          matchOperator(operator_text, masters.operators) ??
          masters.operators.find((o) => !o.archived && o.name === text(r.operator_pick))?.id ??
          null,
        operator_text,
        duplicateOf: null,
      };
    });
}

/**
 * 이미 장부에 있는 줄 가리기.
 * 같은 날·같은 현장·같은 규격이면 같은 작업으로 본다. 한 현장에 같은 날 펌프카가 여러 대 가면
 * 그 줄 수만큼만 짝지어, 장부보다 많이 적힌 줄은 새 작업으로 남긴다.
 * 양쪽 다 기사님이 적혀 있는데 다르면 다른 작업이다.
 */
export function markDuplicates(rows: PhotoRow[], existing: WorkLogRow[]): PhotoRow[] {
  const used = new Set<number>();
  return rows.map((row) => {
    if (row.site_id == null) return row;
    const candidates = existing.filter(
      (e) =>
        !used.has(e.id) &&
        e.work_date === row.work_date &&
        e.site_id === row.site_id &&
        (e.boom_size ?? null) === (row.boom_size ?? null) &&
        !(e.operator_id != null && row.operator_id != null && e.operator_id !== row.operator_id)
    );
    // 기사님까지 같은 줄을 먼저 짝짓는다
    const match = candidates.find((e) => e.operator_id === row.operator_id) ?? candidates[0];
    if (!match) return row;
    used.add(match.id);
    return {
      ...row,
      include: false,
      duplicateOf: {
        id: match.id,
        label: [shortDate(match.work_date), match.site_label, match.boom_size ? `${match.boom_size}M` : '', match.operator_name ?? '']
          .filter(Boolean)
          .join(' '),
      },
    };
  });
}
