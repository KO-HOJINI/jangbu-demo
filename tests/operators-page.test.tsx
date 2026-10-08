import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OperatorsPage from '../src/pages/OperatorsPage';
import { toAmount } from '../src/components/operators/payFormat';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** 기사님 화면: 우리 기사님의 월급·그 달에 줬는지, 한 건씩 적는 야간수당, 다른 사장님 목록이 한 화면에 나온다 */
const ANSWERS: Record<string, unknown> = {
  '/api/masters': {
    companies: [],
    clients: [],
    sites: [],
    rates: [],
    operators: [
      { id: 1, name: '가기사', memo: null, archived: 0, is_staff: 1 },
      { id: 2, name: '나기사', memo: null, archived: 0, is_staff: 1 },
      { id: 3, name: '다중기', memo: null, archived: 0, is_staff: 0 },
    ],
  },
  '/api/usage': { operators: { 3: 4 }, clients: {}, operatorLast: { 3: '2026-08-30' } },
  '/api/operator-pay': {
    salaries: [
      { id: 1, operator_id: 1, from_month: '2026-06', amount: 3_000_000 },
      { id: 2, operator_id: 2, from_month: '2026-06', amount: 2_800_000 },
    ],
    pays: [{ operator_id: 2, month: '2026-09', paid_date: '2026-10-05', paid_salary: 2_700_000 }],
    ots: [
      { id: 7, operator_id: 1, work_date: '2026-09-12', amount: 150_000, note: '밤샘 타설', paid_date: null },
      { id: 8, operator_id: 2, work_date: '2026-08-03', amount: 80_000, note: null, paid_date: '2026-08-10' },
    ],
  },
};

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let calls: { url: string; method: string; body: unknown }[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
      const path = String(url).split('?')[0];
      return new Response(JSON.stringify(ANSWERS[path] ?? {}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    })
  );
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

async function show(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <OperatorsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );
  });
  await settle();
}

describe('기사님 화면', () => {
  it('우리 기사님과 다른 사장님을 따로 보인다', async () => {
    await show('/operators?month=2026-09');
    const [staffBox, payBox, otBox] = [...host.querySelectorAll('section')];

    expect(staffBox.textContent).toContain('가기사');
    expect(staffBox.textContent).toContain('3,000,000원');
    expect(staffBox.textContent).not.toContain('다중기3건');

    expect(payBox.querySelector('h2')!.textContent).toBe('2026년 9월 월급');
    // 가기사: 월급 300만 (야간수당은 여기 더하지 않는다). 나기사: 줄 때 금액(270만) 그대로
    expect(payBox.textContent).not.toContain('3,150,000원');
    expect(payBox.textContent).toContain('2,700,000원');
    expect(payBox.textContent).toContain('10/5 줌');
    expect(payBox.querySelector('dl')!.textContent).toBe('합계5,700,000원아직 안 준 돈3,000,000원');

    // 야간수당: 처음에는 안 준 것만, 달과 상관없이
    expect(otBox.querySelector('h2')!.textContent).toBe('야간수당');
    expect(otBox.textContent).toContain('아직 안 준 돈 150,000원');
    expect(otBox.textContent).toContain('밤샘 타설');
    expect(otBox.textContent).not.toContain('8/10 줌');
    const more = [...otBox.querySelectorAll('button')].find((b) => b.textContent === '준 것도 보기 (1건)') as HTMLButtonElement;
    await act(async () => more.click());
    expect(otBox.textContent).toContain('8/10 줌');

    // 다른 사장님 목록
    expect(host.textContent).toContain('4건 보기');
  });

  it('「줬음」을 누르면 그 달에 오늘 날짜로 적는다', async () => {
    await show('/operators?month=2026-09');
    const payBox = host.querySelectorAll('section')[1];
    const button = [...payBox.querySelectorAll('table button')].find((b) => b.textContent === '줬음') as HTMLButtonElement;
    await act(async () => button.click());
    await settle();

    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toContain('/api/operator-pay/1/2026-09');
    expect((put.body as { paid_date: string }).paid_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('야간수당은 건마다 「줬음」을 누른다', async () => {
    await show('/operators');
    const otBox = host.querySelectorAll('section')[2];
    const button = [...otBox.querySelectorAll('table button')].find((b) => b.textContent === '줬음') as HTMLButtonElement;
    await act(async () => button.click());
    await settle();

    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toContain('/api/operator-ot/7');
    expect((patch.body as { paid_date: string }).paid_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('금액 칸 읽기', () => {
  it('쉼표와 「원」은 버리고, 숫자가 아니면 null', () => {
    expect(toAmount('3,000,000')).toBe(3_000_000);
    expect(toAmount(' 150000원 ')).toBe(150_000);
    expect(toAmount('0')).toBe(0);
    expect(toAmount('')).toBeNull();
    expect(toAmount('삼백만')).toBeNull();
    expect(toAmount('-5')).toBeNull();
  });
});
