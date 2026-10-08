import { describe, expect, it, vi } from 'vitest';
import type { Masters } from '../shared/types';
import { findClient, findSite, matchOperator, modelLabel, newSiteDraft, normalizeRows, wantsNewSite } from '../src/lib/photoLog';
import { firstAnswer, geminiText, photoPrompt, readFailure, readPlan } from '../worker/routes/photoLogs';

/**
 * 손글씨를 AI 가 조금 틀리게 읽어도 현장·기사님·작업 내용을 알아보는지.
 * 2026-10-01 악필 공책 시험에서 AI 가 실제로 돌려준 글자들이다 (「시흥아라」「장기대」).
 */
const site = (id: number, client_id: number, name: string, label: string, archived = 0) =>
  ({ id, client_id, name, label, archived }) as Masters['sites'][number];

const masters = {
  clients: [
    { id: 2, name: '나래' },
    { id: 7, name: '새봄' },
    { id: 8, name: '아라' },
    { id: 9, name: '마루' },
    { id: 10, name: '가온' },
    { id: 11, name: '다솜' },
  ],
  sites: [
    { ...site(3, 2, '한강', '나래(한강)'), address: '동북선 도시철도 3-1공구' },
    { ...site(11, 2, '금강', '나래(금강)'), address: '동북선 도시철도 3-1공구' },
    { ...site(2, 8, '광장', '아라(광장)'), prime_contractor: '한빛' },
    { ...site(5, 8, '시흥', '아라(시흥)'), address: '월곶~판교 복선전철 5공구(2구간)' },
    site(6, 7, '시흥', '새봄(시흥)'),
    site(12, 9, '용산', '마루(용산)'),
    site(13, 8, '부천', '아라(부천)'),
    site(14, 10, '부천', '가온(부천)'),
    site(15, 8, '서울-광명 고속도로', '아라(서울-광명 고속도로)'),
    site(16, 11, '다솜', '다솜'),
  ],
  operators: [
    { id: 1, name: '김', archived: 0 },
    { id: 2, name: '한별', archived: 0 },
    { id: 3, name: '하늘', archived: 0 },
    { id: 4, name: '보람', archived: 0 },
    { id: 5, name: '박', archived: 0 },
    { id: 6, name: '이', archived: 0 },
  ],
  rates: [{ site_id: 13, boom_size: 52, half_day_amount: null, full_day_amount: 1_500_000 }],
  suggestions: { descriptions: ['s/v', '채움', '기초', '벽체', '라이닝', '장비대', '1단벽체'], boomSizes: [], baseAmounts: [], businessOwners: [] },
} as unknown as Masters;

describe('현장 알아보기', () => {
  it('거래처와 현장 이름을 이어 적으면 (「시흥아라」「용산마루」) 확실히 맞춘다', () => {
    expect(findSite('시흥아라', masters)).toEqual({ id: 5, guessed: false });
    expect(findSite('용산 마루', masters)).toEqual({ id: 12, guessed: false });
    expect(findSite('아라시흥', masters)).toEqual({ id: 5, guessed: false });
  });

  it('글자가 조금 틀리면 가장 가까운 현장을 짐작한다', () => {
    expect(findSite('나래(한갈)', masters)).toEqual({ id: 3, guessed: true });
    expect(findSite('광잔', masters)).toEqual({ id: 2, guessed: true });
  });

  it('두 현장에 똑같이 가까우면 고르지 않는다', () => {
    expect(findSite('시흥', masters)).toEqual({ id: null, guessed: false });
    expect(findSite('시홍', masters)).toEqual({ id: null, guessed: false });
    expect(findSite('부천', masters)).toEqual({ id: null, guessed: false });
  });

  it('어느 현장과도 멀면 고르지 않는다', () => {
    expect(findSite('동탄', masters)).toEqual({ id: null, guessed: false });
    expect(findSite('김포비전', masters)).toEqual({ id: null, guessed: false });
  });
});

describe('사진 줄 다듬기 — 짐작', () => {
  const rows = normalizeRows(
    [
      { date: '9/22', site: '나래한갈', work: '장기대', operator: '보랍' },
      { date: '9/22', site: '시흥아라', work: '벽체', operator: '한별' },
      { date: '9/23', site: '광장', work: '지하 옹벽', operator: '잔' },
    ],
    masters,
    '2026-10-01'
  );

  it('짐작한 현장은 골라 두되 체크는 풀어 둔다', () => {
    expect(rows[0]).toMatchObject({ site_id: 3, site_guessed: true, include: false, site_text: '나래한갈' });
  });

  it('확실히 맞춘 현장은 체크해 둔다', () => {
    expect(rows[1]).toMatchObject({ site_id: 5, site_guessed: false, include: true });
    expect(rows[2]).toMatchObject({ site_id: 2, site_guessed: false, include: true });
  });

  it('작업 내용은 자주 쓰는 말과 아주 가까울 때만 고친다', () => {
    expect(rows.map((r) => r.description)).toEqual(['장비대', '벽체', '지하 옹벽']);
  });

  it('두 글자 넘는 기사님 이름은 한 글자 틀려도 알아본다', () => {
    expect(rows[0].operator_id).toBe(4);
    expect(rows[1].operator_id).toBe(2);
  });

  it('한 글자 기사님 이름은 짐작하지 않는다', () => {
    expect(rows[2].operator_id).toBeNull();
    expect(matchOperator('댜', masters.operators)).toBeNull();
  });
});

/**
 * 확인서에는 건설업자(거래처)·현장명·현장소재지 칸이 따로 있다.
 * 2026-10-04 실제 확인서에서 AI 가 돌려준 글자: 「아라개발」「광명 - 로하스 고속로」(적힌 것은 「광명-서울 고속도로」).
 */
describe('확인서 — 거래처와 현장을 따로 읽은 줄', () => {
  const form = (raw: object) => normalizeRows([{ date: '10/2', m: 32, ...raw }], masters, '2026-10-04')[0];

  it('건설업자의 꼬리(개발·건설·(주))를 떼고 거래처를 알아본다', () => {
    expect(findClient('아라개발', masters.clients)).toBe(8);
    expect(findClient('(주)마루건설', masters.clients)).toBe(9);
    expect(findClient('한솔건설', masters.clients)).toBeNull();
    // 「(주)」만 떼고 이름 속의 주·유·합 글자는 그대로 둔다
    expect(newSiteDraft({ client_id: null, client_text: '유진합동건설(주)', site_text: '', address_text: '' }, masters).client_name).toBe('유진합동');
    expect(findClient('', masters.clients)).toBeNull();
  });

  it('거래처와 현장명이 맞으면 확실히 맞춘다 — 「부천」이 두 거래처에 있어도', () => {
    expect(form({ client: '아라개발', site: '부천', place: null })).toMatchObject({ site_id: 13, site_guessed: false, include: true, client_id: 8 });
  });

  it('현장명 칸이 비어 있으면 현장소재지로 맞춘다', () => {
    expect(form({ client: '아라개발', site: null, place: '광장' })).toMatchObject({ site_id: 2, site_guessed: false, client_text: '아라개발', site_text: '광장' });
  });

  it('그 거래처의 현장 가운데 닮은 것이 있으면 짐작한다 (체크는 풀어 둔다)', () => {
    expect(form({ client: '아라개발', site: null, place: '광잔' })).toMatchObject({ site_id: 2, site_guessed: true, include: false });
  });

  it('거래처는 알지만 그런 현장이 없으면 현장을 비워 둔다 — 새 현장이다', () => {
    expect(form({ client: '아라개발', site: null, place: '안양 물류센터' })).toMatchObject({
      site_id: null,
      client_id: 8,
      client_text: '아라개발',
      site_text: '안양 물류센터',
      include: false,
    });
  });

  // 2026-10-05 사용자가 바로잡음: 「현장명」 칸(KCC건설·예시건설건설)이 현장 이름이고, 「현장소재지」는 그 현장의 주소다
  it('두 칸이 다 차 있으면 현장명 칸이 현장 이름, 현장소재지는 주소다', () => {
    expect(form({ client: '다솜건설', site: 'KCC건설', place: '7호선 연장 2공구(청라)' })).toMatchObject({
      site_id: null,
      site_text: 'KCC건설',
      address_text: '7호선 연장 2공구(청라)',
    });
    // 현장명 칸으로 못 찾아도 현장소재지가 이미 있는 현장의 이름·주소와 맞으면 그 현장
    expect(form({ client: '아라개발', site: 'SK건설', place: '서울-광명 고속도로' })).toMatchObject({ site_id: 15, site_guessed: false, site_text: 'SK건설' });
  });

  it('현장명 칸이 비어 있으면 현장소재지가 현장 이름이 된다 (주소는 비운다)', () => {
    expect(form({ client: '아라개발', site: null, place: '안양 물류센터' })).toMatchObject({ site_text: '안양 물류센터', address_text: '' });
  });

  it('같은 현장을 낱말 순서만 바꿔 적어도 (「광명-서울 고속도로」) 알아본다', () => {
    expect(form({ client: '아라개발', site: null, place: '광명-서울 고속도로' })).toMatchObject({ site_id: 15, site_guessed: false });
  });

  it('그 거래처 현장 가운데 꽤 닮았으면 (「광명-포천 고속도로」) 짐작해 두고 확인받는다', () => {
    expect(form({ client: '아라개발', site: null, place: '광명-포천 고속도로' })).toMatchObject({ site_id: 15, site_guessed: true, include: false });
  });

  it('현장소재지로 못 찾으면 현장명 칸으로도 찾아본다', () => {
    expect(form({ client: '아라개발', site: '광장', place: '여의도' })).toMatchObject({ site_id: 2, site_guessed: false });
  });

  // 2026-10-05: 「아라개발 / 광명-서울 고속도로」 확인서 — 현장 이름(부천)은 어디에도 없고, 현장 주소 칸에만 그 도로 이름이 있었다
  it('현장 이름과 달라도 현장소재지가 그 현장의 주소에 들어 있으면 그 현장이다', () => {
    expect(form({ client: '아라개발', site: null, place: '월곶-판교 복선전철' })).toMatchObject({ site_id: 5, site_guessed: false, include: true });
    expect(form({ client: '아라개발', site: 'SK건설', place: '판교 월곶 복선전철 5공구' })).toMatchObject({ site_id: 5, site_guessed: false });
    // 거래처 칸을 못 읽었어도 주소가 한 현장에만 맞으면
    expect(form({ client: null, site: null, place: '월곶-판교 복선전철' })).toMatchObject({ site_id: 5, site_guessed: false });
  });

  it('주소가 같은 현장이 둘이면 고르지 않는다', () => {
    expect(form({ client: '나래', site: null, place: '동북선 도시철도' })).toMatchObject({ site_id: null, include: false });
  });

  it('짧은 글자(「판교」)만으로는 주소에 들어 있어도 고르지 않는다', () => {
    expect(form({ client: '아라개발', site: null, place: '판교' }).site_id).toBeNull();
  });

  it('현장소재지가 비어 있고 현장명 칸의 원청만 같으면 그 현장을 짐작한다 (체크는 풀어 둔다)', () => {
    expect(form({ client: '아라개발', site: '한빛건설', place: null })).toMatchObject({ site_id: 2, site_guessed: true, include: false });
  });

  // 2026-10-05 사용자가 겪음: 「새봄건설 / 신안산선 / 예시건설건설」 이 원청이 예시건설인 「새봄(양재)」로 골라졌다 — 같은 원청의 다른 현장이었다
  it('현장소재지가 적혀 있는데 못 찾았으면 원청이 같아도 짐작하지 않는다 — 새 현장이다', () => {
    const row = form({ client: '아라개발', site: '한빛건설(주)', place: '마포 어딘가' });
    expect(row).toMatchObject({ site_id: null, site_guessed: false, client_id: 8 });
    expect(wantsNewSite(row)).toBe(true);
  });

  it('현장 글자가 하나도 없으면 그 규격 단가가 있는 현장이 하나일 때 그 현장을 짐작한다', () => {
    expect(form({ client: '아라개발', site: null, place: null, m: 52 })).toMatchObject({ site_id: 13, site_guessed: true, include: false });
    // 현장 글자가 적혀 있는데 못 찾은 것은 새 현장일 수 있어 규격으로 짐작하지 않는다
    expect(form({ client: '아라개발', site: null, place: '안양 물류센터', m: 52 }).site_id).toBeNull();
  });

  it('현장을 못 찾았고 사진에 거래처나 현장 글자가 있으면 새 현장 상자를 열어 둔다', () => {
    expect(wantsNewSite(form({ client: '아라개발', site: null, place: '안양 물류센터' }))).toBe(true);
    expect(wantsNewSite(form({ client: '한솔건설', site: null, place: null }))).toBe(true);
    expect(wantsNewSite(form({ client: '아라개발', site: null, place: '광장' }))).toBe(false);
    expect(wantsNewSite(form({ client: null, site: null, place: null }))).toBe(false);
  });

  /**
   * AI 가 읽으면서 장부의 현장·기사님도 같이 골라 준다 (site_pick·operator_pick, 2026-10-05 사용자 요청).
   * 전에 목록에서 고르게만 했을 때는 못 읽은 현장도 아무 이름으로 채워 맞춘 줄처럼 올라갔다 —
   * 그래서 앱이 찾은 것과 같을 때만 확실로 보고, AI 만 고른 것은 체크를 풀어 둔다.
   */
  it('앱이 못 찾은 현장을 AI 가 골랐으면 그 현장을 짐작으로 둔다', () => {
    expect(form({ client: '아라개발', site: null, place: '여의도 의사당', site_pick: '아라(광장)' })).toMatchObject({ site_id: 2, site_guessed: true, include: false });
  });

  it('앱의 짐작과 AI 가 고른 현장이 같으면 확실히 맞춘 것으로 본다', () => {
    expect(form({ client: '아라개발', site: null, place: '광잔', site_pick: '아라(광장)' })).toMatchObject({ site_id: 2, site_guessed: false, include: true });
  });

  it('앱이 확실히 맞춘 현장은 AI 가 다른 곳을 골라도 그대로다', () => {
    expect(form({ client: '아라개발', site: '부천', place: null, site_pick: '아라(광장)' })).toMatchObject({ site_id: 13, site_guessed: false });
  });

  it('AI 가 고른 현장이 다른 거래처 것이거나 목록에 없는 이름이면 버린다 — 새 현장이다', () => {
    expect(form({ client: '아라개발', site: null, place: '안양 물류센터', site_pick: '가온(부천)' }).site_id).toBeNull();
    expect(form({ client: '아라개발', site: null, place: '안양 물류센터', site_pick: '아라(안양)' }).site_id).toBeNull();
  });

  // 2026-10-05 Flash Lite 가 실제로 그랬다: 「다솜건설 / KCC건설」 에 현장 이름이 따로 없는 「다솜」 을 골라, 새 현장 상자가 열리지 않았다
  it('확인서에 현장 글자가 있는데 AI 가 거래처 이름뿐인 현장을 골랐으면 버린다', () => {
    const row = form({ client: '다솜건설', site: 'KCC건설', place: '7호선 연장 2공구(청라)', site_pick: '다솜' });
    expect(row).toMatchObject({ site_id: null, site_guessed: false });
    expect(wantsNewSite(row)).toBe(true);
    // 현장 글자가 없으면 받는다 — 앱도 그 거래처의 하나뿐인 현장으로 짐작하므로 둘이 같아 확실로 본다
    expect(form({ client: '다솜건설', site: null, place: null, site_pick: '다솜' })).toMatchObject({ site_id: 16, site_guessed: false });
  });

  it('앱이 못 찾은 기사님을 AI 가 목록에서 골랐으면 그 기사님으로 둔다', () => {
    expect(form({ client: '아라개발', place: '광장', operator: '최가나', operator_pick: '한별' }).operator_id).toBe(2);
    expect(form({ client: '아라개발', place: '광장', operator: '최가나', operator_pick: '없는 사람' }).operator_id).toBeNull();
    // 앱이 찾은 기사님이 먼저다
    expect(form({ client: '아라개발', place: '광장', operator: '이효진', operator_pick: '한별' }).operator_id).toBe(6);
  });

  it('조정사 이름 석 자의 성이 한 글자 기사님과 같으면 그 기사님으로 둔다 (「이효진」→「이」)', () => {
    expect(form({ client: '아라개발', place: '광장', operator: '이효진' }).operator_id).toBe(6);
    expect(form({ client: '아라개발', place: '광장', operator: '한별' }).operator_id).toBe(2);
    expect(form({ client: '아라개발', place: '광장', operator: '황두리' }).operator_id).toBeNull();
  });

  it('새 현장으로 추가할 때 채워 둘 값 — 아는 거래처는 그 이름, 모르는 거래처는 꼬리를 뗀 이름', () => {
    expect(newSiteDraft(form({ client: '아라개발', site: 'SK건설', place: '광명 - 로하스' }), masters)).toEqual({ client_name: '아라', name: 'SK건설', address: '광명 - 로하스' });
    expect(newSiteDraft(form({ client: '(주)한솔건설', site: null, place: '동탄' }), masters)).toEqual({ client_name: '한솔', name: '동탄', address: '' });
  });

  it('모르는 거래처면 다른 거래처의 현장을 골라 두지 않는다 — 「신안산선」에 「바다(안산)」이 골라져 있으면 그대로 올리기 쉽다', () => {
    expect(form({ client: '한솔건설', site: null, place: '광장' })).toMatchObject({ site_id: null, site_guessed: false, include: false, client_id: null });
  });

  // 실제로 AI 가 돌려준 글자: 「아라캐피탈」「아라개발5」「새봄생신」 — 앞머리는 맞게 읽는다
  it('건설업자 글자의 앞머리가 거래처 이름 하나와만 같으면 그 거래처로 본다', () => {
    expect(findClient('아라캐피탈', masters.clients)).toBe(8);
    expect(findClient('아라개발5', masters.clients)).toBe(8);
    expect(findClient('새봄생신', masters.clients)).toBe(7);
    expect(findClient('우', masters.clients)).toBeNull();
  });

  it('모르는 거래처면 거래처도 현장도 비워 둔다', () => {
    expect(form({ client: '한솔건설', site: '동탄', place: null })).toMatchObject({ site_id: null, client_id: null, client_text: '한솔건설', site_text: '동탄' });
  });
});

describe('사진 읽기 프롬프트', () => {
  const prompt = photoPrompt({
    year: '2026',
    sites: [
      { label: '아라(광장)', client: '아라', name: '광장', client_full: '아라개발(주)', address: '여의도동 1' },
      { label: '다솜', client: '다솜', name: '다솜', client_full: null, address: null },
    ],
    operators: ['박', '한별'],
    booms: [37, 42],
    works: ['s/v', '채움'],
  });

  it('현장은 적힌 글자 그대로 쓰게 한다 — 목록 이름으로 바꾸면 틀린 현장이 맞춘 것처럼 들어온다', () => {
    expect(prompt).toContain('적힌 글자 그대로');
    expect(prompt).not.toContain('가장 가까운 것을 그대로');
  });

  it('거래처·현장 이름과 자주 쓰는 작업 내용을 칸마다 따로 알려 준다', () => {
    expect(prompt).toContain('건설업자 칸에 자주 나오는 이름: 아라, 다솜\n');
  });

  it('장부의 현장을 거래처·주소와 함께 알려 주고, 그 가운데서 고르게 한다 (확실하지 않으면 null)', () => {
    expect(prompt).toContain('- 아라(광장) | 아라개발(주) | 여의도동 1\n');
    expect(prompt).toContain('- 다솜 | 다솜 | \n');
    expect(prompt).toContain('"site_pick":null');
    expect(prompt).toContain('"operator_pick":null');
    expect(prompt).toContain('확실하지 않으면 null');
    expect(prompt).toContain('자주 쓰는 작업 내용: s/v, 채움');
  });
});

/**
 * 같은 사진·같은 안내문인데 답이 4초에 오기도 50초에 오기도 한다 (Cloudflare 쪽 대기, 2026-10-04 잼).
 * 늦어지면 같은 요청을 한 번 더 보내 먼저 온 답을 쓴다.
 */
describe('늦으면 한 번 더 보내기', () => {
  const later = <T,>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));

  it('제때 오면 한 번만 보낸다', async () => {
    vi.useFakeTimers();
    const run = vi.fn(() => later(3000, ['줄']));
    const p = firstAnswer(run, [7000]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await p).toEqual(['줄']);
    await vi.advanceTimersByTimeAsync(10000);
    expect(run).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('늦어지면 한 번 더 보내 먼저 온 답을 쓴다', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockImplementationOnce(() => later(40000, ['늦은 답'])).mockImplementationOnce(() => later(4000, ['빠른 답']));
    const p = firstAnswer(run, [7000]);
    await vi.advanceTimersByTimeAsync(11000);
    expect(await p).toEqual(['빠른 답']);
    expect(run).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('처음 것이 바로 실패하면 기다리지 않고 다시 보낸다', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockImplementationOnce(() => Promise.reject(new Error('막힘'))).mockImplementationOnce(() => later(2000, ['답']));
    const p = firstAnswer(run, [7000]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await p).toEqual(['답']);
    vi.useRealTimers();
  });

  it('처음부터 둘을 같이 보내고, 둘 다 늦을 때만 셋째를 보낸다', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockImplementationOnce(() => later(30000, ['첫째'])).mockImplementationOnce(() => later(5000, ['둘째']));
    const p = firstAnswer(run, [0, 7000]);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toEqual(['둘째']);
    await vi.advanceTimersByTimeAsync(10000);
    expect(run).toHaveBeenCalledTimes(2);

    const slow = vi.fn().mockImplementationOnce(() => later(30000, ['첫째'])).mockImplementationOnce(() => later(30000, ['둘째'])).mockImplementationOnce(() => later(4000, ['셋째']));
    const q = firstAnswer(slow, [0, 7000]);
    await vi.advanceTimersByTimeAsync(11000);
    expect(await q).toEqual(['셋째']);
    vi.useRealTimers();
  });

  it('둘 다 못 읽으면 null, 둘 다 실패하면 마지막 오류를 던진다', async () => {
    expect(await firstAnswer(() => Promise.resolve(null), [10])).toBeNull();
    await expect(firstAnswer(() => Promise.reject(new Error('한도')), [10])).rejects.toThrow('한도');
  });
});

describe('어느 모델로 읽을지', () => {
  it('처음에는 생각하기를 끈 Qwen (15초쯤), 안 되면 Llama 4 Scout', () => {
    const plan = readPlan(false);
    expect(plan.map((p) => p.model)).toEqual(['@cf/qwen/qwen3.8-27b', '@cf/meta/llama-4-scout-17b-16e-instruct']);
    expect(plan[0].extra).toEqual({ chat_template_kwargs: { enable_thinking: false } });
  });

  it('「꼼꼼히 다시 읽기」는 생각하기를 켠 Qwen 만 (1분쯤)', () => {
    expect(readPlan(true)).toEqual([{ model: '@cf/qwen/qwen3.8-27b', extra: {} }]);
  });

  it('Gemini 키가 있으면 처음에는 3.6 Flash, 한도·혼잡이면 Flash Lite, 그래도 안 되면 하던 대로 Qwen → Llama', () => {
    expect(readPlan(false, true).map((p) => p.model)).toEqual([
      'gemini-3.6-flash',
      'gemini-3.5-flash-lite',
      '@cf/qwen/qwen3.8-27b',
      '@cf/meta/llama-4-scout-17b-16e-instruct',
    ]);
  });

  it('Gemini 키가 있으면 「꼼꼼히 다시 읽기」는 처음 읽기와 다른 모델부터: 3.5 Flash → 3.7 Flash, 그래도 안 되면 생각하기를 켠 Qwen', () => {
    expect(readPlan(true, true).map((p) => p.model)).toEqual([
      'gemini-3.5-flash',
      'gemini-3.7-flash',
      '@cf/qwen/qwen3.8-27b',
    ]);
  });
});

describe('geminiText — Gemini 답에서 글만 꺼내기', () => {
  it('여러 조각으로 온 글을 이어 붙인다', () => {
    expect(geminiText({ candidates: [{ content: { parts: [{ text: '[{"date":' }, { text: '"10/2"}]' }] } }] })).toBe('[{"date":"10/2"}]');
  });

  it('답이 비었거나 모양이 다르면 빈 글', () => {
    expect(geminiText({})).toBe('');
    expect(geminiText({ candidates: [{ finishReason: 'SAFETY' }] })).toBe('');
    expect(geminiText(null)).toBe('');
  });
});

/**
 * 2026-10-05 사용자가 겪음: Gemini 한도가 남았는데 「오늘 무료로 읽을 수 있는 양을 다 썼습니다」가 떴다.
 * 마지막에 시도한 모델(Cloudflare)의 오류만 보고 문구를 정해서였다. 모델마다의 결과(오류 글, 답은 왔지만 줄이 없으면 null)를 모두 본다.
 */
describe('사진을 못 읽었을 때의 안내', () => {
  const quota = 'Error: Gemini 429 You exceeded your current quota';
  const neurons = 'Error: 4006: you have used up your daily free allocation of 10,000 neurons';
  const busy = 'Error: Gemini 503 The model is overloaded';
  const timeout = 'TimeoutError: The operation was aborted due to timeout';

  it('모든 모델이 한도에 걸렸을 때만 「다 썼습니다」', () => {
    expect(readFailure([quota, quota, neurons, neurons])).toMatchObject({ status: 429, error: expect.stringContaining('다 썼습니다') });
  });

  it('한 곳이라도 붐비거나 늦어서 실패했으면 잠시 뒤 다시 하라고 한다', () => {
    expect(readFailure([quota, busy, neurons, neurons])).toMatchObject({ status: 503, error: expect.stringContaining('잠시 뒤') });
    expect(readFailure([quota, timeout, neurons])).toMatchObject({ status: 503 });
  });

  it('답은 왔는데 줄을 못 찾은 모델이 있으면 사진을 다시 찍으라고 한다', () => {
    expect(readFailure([quota, null, neurons])).toMatchObject({ status: 422, error: expect.stringContaining('다시 찍어') });
    expect(readFailure([null, null])).toMatchObject({ status: 422 });
  });
});

describe('읽은 모델 이름', () => {
  it('화면에 적을 짧은 이름으로 바꾼다', () => {
    expect(modelLabel('gemini-3.6-flash')).toBe('Gemini 3.6 Flash');
    expect(modelLabel('gemini-3.5-flash-lite')).toBe('Gemini 3.5 Flash Lite');
    expect(modelLabel('@cf/qwen/qwen3.8-27b')).toBe('Qwen 3.8');
    expect(modelLabel('@cf/meta/llama-4-scout-17b-16e-instruct')).toBe('Llama 4 Scout');
    expect(modelLabel('다른-모델')).toBe('다른-모델');
  });
});
