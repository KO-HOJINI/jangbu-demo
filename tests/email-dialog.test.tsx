import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MailAccount } from '../shared/types';

// PDF 만들기는 화면을 그림으로 뜨는 일이라 여기서는 흉내만 낸다
vi.mock('../src/lib/pdf', () => ({
  savePdf: vi.fn(async () => {}),
  blobToBase64: vi.fn(async () => 'JVBERi0='),
}));

import EmailDialog, { defaultAccount, mailSubject } from '../src/components/EmailDialog';
import MailAccountsCard from '../src/components/settings/MailAccountsCard';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const DARA: MailAccount = { id: 3, label: '다라중기', username: 'dara', address: 'dara@naver.com', fixed: false };
const GANA: MailAccount = { id: 5, label: '가나중기', username: 'gana', address: 'gana@naver.com', fixed: false };

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let copied: string[];
let accounts: MailAccount[];
/** 서버로 간 요청 (메서드 + 주소 + 보낸 내용) */
let sent: { method: string; path: string; body: any }[];

beforeEach(() => {
  copied = [];
  sent = [];
  accounts = [DARA, GANA];
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      sent.push({ method, path: String(url), body });
      const answer =
        url === '/api/mail/accounts' && method === 'GET'
          ? { accounts, canAdd: true }
          : url === '/api/mail/accounts'
            ? { id: 9 }
            : String(url).endsWith('/recipients')
              ? []
              : { ok: true };
      return new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } });
    })
  );
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('open', vi.fn());
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text: string) => void copied.push(text) },
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 20))));

function button(label: string, within: ParentNode = document.body) {
  const found = [...within.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label
  );
  if (!found) throw new Error(`「${label}」 단추가 없다`);
  return found;
}

function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

async function show(ui: React.ReactNode) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>
    );
  });
  await settle();
}

const dialog = () =>
  show(<EmailDialog doc="quotes" id={7} fileName="26년 10월 가나 견적서" supplierName="가나중기" makePdf={async () => new Blob(['x'])} onClose={() => {}} />);

async function fill() {
  const box = document.body.querySelector('[role="dialog"]')!;
  const [to, subject] = [...box.querySelectorAll('input')];
  await act(async () => {
    type(to, 'kim@example.com');
    type(subject, '10월 견적서 보내 드립니다');
    type(box.querySelector('textarea')!, '확인 부탁드립니다.');
  });
  return box;
}

describe('처음 골라 둘 보내는 계정', () => {
  it('이 회사로 마지막에 쓴 계정 → 이름이 회사 이름과 같은 계정 → 첫 번째', () => {
    expect(defaultAccount([DARA, GANA], '가나중기', 3)).toBe(DARA);
    expect(defaultAccount([DARA, GANA], '가나중기', null)).toBe(GANA);
    expect(defaultAccount([DARA, GANA], '마바중기', null)).toBe(DARA);
    // 지워진 계정을 기억하고 있어도 넘어간다
    expect(defaultAccount([DARA, GANA], '가나중기', 99)).toBe(GANA);
    expect(defaultAccount([], '가나중기', null)).toBeUndefined();
  });
});

describe('메일로 보내기 — 고른 계정으로 바로 보내기', () => {
  it('회사 이름과 같은 계정이 골라져 있고, 바꿔 고른 계정으로 적은 내용이 그대로 간다', async () => {
    await dialog();
    const box = await fill();

    const select = box.querySelector('select')!;
    expect(select.value).toBe('5');
    expect([...select.options].map((o) => o.textContent)).toEqual(['다라중기 (dara@naver.com)', '가나중기 (gana@naver.com)']);

    await act(async () => {
      select.value = '3';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => button('보내기').click());
    await settle();

    const request = sent.find((r) => r.path === '/api/quotes/7/email')!;
    expect(request.method).toBe('POST');
    expect(request.body).toMatchObject({
      account_id: 3,
      to: ['kim@example.com'],
      subject: '10월 견적서 보내 드립니다',
      text: '확인 부탁드립니다.',
      filename: '26년 10월 가나 견적서',
    });
    expect(box.textContent).toContain('dara@naver.com 에서 kim@example.com 에 보냈습니다.');

    // 보낸 뒤에는 네이버 메일의 보낸메일함을 열어 확인할 수 있다
    await act(async () => button('보낸 메일 확인하기').click());
    expect(window.open).toHaveBeenCalledWith('https://mail.naver.com/v2/folders/1', '_blank');

    // 다음에 같은 회사 문서를 열면 방금 쓴 계정이 골라져 있다
    expect(window.localStorage.getItem('jangbu:mail-from:가나중기')).toBe('3');
  });

  it('받는 사람을 적기 전에는 보낼 수 없다', async () => {
    await dialog();
    expect(button('보내기').disabled).toBe(true);
  });

  it('제목은 「회사 N월 문서입니다.」 이고 내용은 비워 둔다', async () => {
    await dialog();
    const box = document.body.querySelector('[role="dialog"]')!;
    expect(box.querySelectorAll('input')[1].value).toBe('가나중기 10월 견적서입니다.');
    expect(box.querySelector('textarea')!.value).toBe('');
  });

  it('제목에는 회사 이름 뒤 괄호를 빼고, 달은 파일 이름에서 읽는다', () => {
    expect(mailSubject('거래명세표', '한강중기(샘플중기)', '26년 8월 아라 광장')).toBe('한강중기 8월 거래명세표입니다.');
    expect(mailSubject('견적서', '가나중기', '가나 견적서')).toBe('가나중기 견적서입니다.');
  });

  it('내용을 비운 채로 보내면 빈 내용이 그대로 간다', async () => {
    await dialog();
    const box = document.body.querySelector('[role="dialog"]')!;
    await act(async () => type(box.querySelectorAll('input')[0], 'kim@example.com'));
    await act(async () => button('보내기').click());
    await settle();
    expect(sent.find((r) => r.path === '/api/quotes/7/email')!.body).toMatchObject({ subject: '가나중기 10월 견적서입니다.', text: '' });
  });

  it('등록된 계정이 없으면 「보내기」 대신 설정으로 가는 안내가 나온다', async () => {
    accounts = [];
    await dialog();
    const box = document.body.querySelector('[role="dialog"]')!;
    expect(box.querySelector('select')).toBeNull();
    expect(box.querySelector('a[href="/settings?tab=account"]')).not.toBeNull();
    expect(() => button('보내기')).toThrow();
    expect(button('네이버 메일 창으로 보내기')).toBeTruthy();
  });
});

describe('메일로 보내기 — 네이버 메일 창을 연 뒤', () => {
  it('적은 받는 사람·제목·내용을 하나씩 복사할 수 있다', async () => {
    await dialog();
    const box = await fill();

    await act(async () => button('네이버 메일 창으로 보내기').click());
    await settle();
    expect(window.open).toHaveBeenCalled();

    // 네이버 메일 창은 밖에서 적은 내용을 받아 주지 않는다 — 창을 연 뒤에도 적은 것이 남아 있고, 하나씩 복사할 수 있어야 한다
    expect(box.textContent).toContain('kim@example.com');
    expect(box.textContent).toContain('10월 견적서 보내 드립니다');
    expect(box.textContent).toContain('확인 부탁드립니다.');

    copied = [];
    await act(async () => button('제목 복사').click());
    await act(async () => button('내용 복사').click());
    await act(async () => button('받는 사람 복사').click());
    expect(copied).toEqual(['10월 견적서 보내 드립니다', '확인 부탁드립니다.', 'kim@example.com']);

    // 보냈다고 기록해 둔다
    expect(sent.find((r) => r.path === '/api/quotes/7/email-log')?.body).toEqual({ to: ['kim@example.com'], subject: '10월 견적서 보내 드립니다' });
  });
});

describe('설정 > 계정 — 메일 보내는 계정', () => {
  it('등록된 계정이 보이고, 새 계정을 적어 등록한다', async () => {
    await show(<MailAccountsCard />);
    expect(host.textContent).toContain('다라중기');
    expect(host.textContent).toContain('gana@naver.com');

    await act(async () => button('계정 추가', host).click());
    const [label, username, password] = [...host.querySelectorAll('input')];
    expect(password.type).toBe('password');
    await act(async () => {
      type(label, '마바중기');
      type(username, 'maba');
      type(password, 'ABCD1234EFGH');
    });
    await act(async () => button('등록', host).click());
    await settle();

    expect(sent.find((r) => r.method === 'POST' && r.path === '/api/mail/accounts')?.body).toEqual({
      label: '마바중기',
      username: 'maba',
      password: 'ABCD1234EFGH',
    });
    // 적는 칸이 닫히고 비밀번호가 화면에 남지 않는다
    expect(host.querySelector('input')).toBeNull();
  });

  it('고칠 때는 비밀번호 칸이 비어 있고, 비운 채 저장하면 이름만 바뀐다', async () => {
    await show(<MailAccountsCard />);
    await act(async () => button('수정', host).click());
    const [label, username, password] = [...host.querySelectorAll('input')];
    expect([label.value, username.value, password.value]).toEqual(['다라중기', 'dara', '']);

    await act(async () => type(label, '다라중기 본사'));
    await act(async () => button('저장', host).click());
    await settle();
    expect(sent.find((r) => r.method === 'PATCH')).toMatchObject({
      path: '/api/mail/accounts/3',
      body: { label: '다라중기 본사', username: 'dara', password: '' },
    });
  });

  it('지우기 전에 한 번 묻는다', async () => {
    const ask = vi.fn(() => false);
    vi.stubGlobal('confirm', ask);
    await show(<MailAccountsCard />);

    await act(async () => button('삭제', host).click());
    expect(ask).toHaveBeenCalled();
    expect(sent.some((r) => r.method === 'DELETE')).toBe(false);

    ask.mockReturnValue(true);
    await act(async () => button('삭제', host).click());
    await settle();
    expect(sent.find((r) => r.method === 'DELETE')?.path).toBe('/api/mail/accounts/3');
  });
});
