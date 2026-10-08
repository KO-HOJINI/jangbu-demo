import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from '../src/pages/SettingsPage';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** 설정 화면은 탭마다 파일이 따로 있다 (src/components/settings). 탭을 눌렀을 때 각 파일이 제대로 그려지는지 본다 */
const MASTERS = {
  companies: [
    { id: 1, name: '가나중기', biz_no: '111-11-11111', ceo_name: '홍길동', address: '서울', biz_type: '건설', biz_item: '펌프카', tel: '02-000-0000', fax: null, archived: 0, has_stamp: 0 },
  ],
  clients: [{ id: 1, name: '다라건설', biz_no: null, tel: null, address: null }],
  sites: [],
  operators: [{ id: 1, name: '김기사', tel: null, active: 1 }],
  rates: [],
  contacts: [],
};

const ANSWERS: Record<string, unknown> = {
  '/api/masters': MASTERS,
  '/api/usage': { operators: { 1: 3 }, clients: { 1: 2 }, operatorLast: { 1: '2026-09-30' } },
};

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url).split('?')[0];
      return new Response(JSON.stringify(ANSWERS[path] ?? []), { status: 200, headers: { 'Content-Type': 'application/json' } });
    })
  );
  // jsdom 에는 없다 (탭 표시·스크롤 그림자가 쓴다)
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

describe('설정 화면 탭', () => {
  it('탭 다섯 개가 모두 그려진다', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <SettingsPage />
          </MemoryRouter>
        </QueryClientProvider>
      );
    });
    await settle();

    const tabs = [...host.querySelectorAll<HTMLButtonElement>('nav button')];
    expect(tabs.map((b) => b.textContent)).toEqual(['내 회사', '거래처', '현장', '백업', '계정']);

    // 처음은 내 회사
    expect(host.textContent).toContain('가나중기');

    const seen: Record<string, string> = {};
    for (const tab of tabs) {
      await act(async () => tab.click());
      await settle();
      expect(tab.getAttribute('aria-pressed')).toBe('true');
      seen[tab.textContent!] = host.querySelector('.anim-page')!.textContent ?? '';
      expect(seen[tab.textContent!].length).toBeGreaterThan(10);
    }

    expect(seen['거래처']).toContain('다라건설');
    expect(seen['계정']).toContain('비밀번호');
  });
});
