import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import MutationGuard from '../src/components/MutationGuard';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function createTestClient() {
  return new QueryClient({
    mutationCache: new MutationCache(),
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function TestMutator({ onMutate }: { onMutate: () => Promise<void> }) {
  const mutation = useMutation({
    mutationFn: onMutate,
  });
  return (
    <div>
      <button id="mutate-btn" onClick={() => mutation.mutate()}>저장 실행</button>
      {mutation.isPending && <span>뮤테이션 진행 중</span>}
    </div>
  );
}

describe('MutationGuard (전역 쓰기 요청 중복 클릭 방지 가드)', () => {
  it('진행 중인 뮤테이션이 없을 때는 아무것도 렌더링하지 않는다 (null)', () => {
    const queryClient = createTestClient();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MutationGuard />
        </QueryClientProvider>
      );
    });

    expect(container.firstChild).toBeNull();
    expect(document.querySelector('[data-testid="mutation-guard-overlay"]')).toBeNull();
    expect(document.querySelector('[role="status"]')).toBeNull();

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('저장 중에는 진행 띠만 띄우고 화면은 막지 않는다. 같은 단추를 또 누른 것만 걸러 낸다', async () => {
    const queryClient = createTestClient();
    let resolveMutation: () => void = () => {};
    const mutationPromise = new Promise<void>((resolve) => {
      resolveMutation = resolve;
    });
    let calls = 0;
    let otherClicks = 0;

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MutationGuard />
          <TestMutator
            onMutate={() => {
              calls += 1;
              return mutationPromise;
            }}
          />
          <button id="other-btn" onClick={() => (otherClicks += 1)}>다른 단추</button>
        </QueryClientProvider>
      );
    });

    const click = (id: string) => document.getElementById(id)!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    await act(async () => {
      click('mutate-btn');
      await new Promise((r) => setTimeout(r, 20));
    });

    // 저장 중: 화면을 덮는 막은 없고 진행 띠만 있다
    expect(document.querySelector('[data-testid="mutation-guard-overlay"]')).toBeNull();
    const status = document.querySelector('[role="status"]') as HTMLDivElement;
    expect(status).not.toBeNull();
    expect(status.getAttribute('aria-label')).toBe('저장 중');
    expect(status.className).toContain('pointer-events-none');

    // 같은 단추를 또 눌러도 요청은 한 번뿐, 다른 단추는 그대로 눌린다
    await act(async () => {
      click('mutate-btn');
      click('other-btn');
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(calls).toBe(1);
    expect(otherClicks).toBe(1);

    await act(async () => {
      resolveMutation();
      await mutationPromise;
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(document.querySelector('[role="status"]')).toBeNull();

    // 저장이 끝나면 같은 단추도 다시 눌린다
    await act(async () => {
      click('mutate-btn');
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(calls).toBe(2);

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
