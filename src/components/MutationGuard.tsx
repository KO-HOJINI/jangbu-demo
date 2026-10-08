import { useEffect, useRef } from 'react';
import { useIsMutating } from '@tanstack/react-query';

/**
 * 저장(생성·수정·삭제) 요청이 가는 동안의 보호 장치.
 *
 * 처음에는 화면 전체를 투명한 막으로 덮어 아무것도 못 누르게 했는데, 칸을 고치고 바로 다음 칸·메뉴를 누르면
 * 그 누름이 먹히지 않아 느리게 느껴졌다 (2026-10-04 사용자: 「전체 화면 클릭 금지는 과하다」).
 * 저장 중에 다른 화면으로 넘어가도 요청은 끝까지 가므로 막을 필요가 없다. 실제로 탈이 나는 두 가지만 막는다:
 *   1. 같은 단추를 연달아 누르는 것 — 같은 요청이 두 번 간다. 방금 누른 그 단추만 저장이 끝날 때까지 다시 눌리지 않는다.
 *   2. 저장 중에 창을 닫거나 새로 고치는 것 — 요청이 끊길 수 있어 브라우저가 한 번 묻게 한다.
 * 화면 맨 위의 얇은 진행 띠는 그대로 둔다 (눌림을 막지 않는다).
 */
export default function MutationGuard() {
  const isMutating = useIsMutating() > 0;
  const mutating = useRef(isMutating);
  mutating.current = isMutating;

  useEffect(() => {
    let last: Element | null = null;
    const onClick = (e: MouseEvent) => {
      const button = e.target instanceof Element ? e.target.closest('button, [role="button"]') : null;
      if (!button) return;
      if (mutating.current && button === last) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      last = button;
    };
    const onLeave = (e: BeforeUnloadEvent) => {
      if (mutating.current) e.preventDefault();
    };
    // 잡는 단계에서 받아야 단추의 onClick 보다 먼저 걸러 낸다
    document.addEventListener('click', onClick, true);
    window.addEventListener('beforeunload', onLeave);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('beforeunload', onLeave);
    };
  }, []);

  if (!isMutating) return null;

  return (
    <div
      role="status"
      aria-label="저장 중"
      className="pointer-events-none fixed inset-x-0 top-0 z-[10000] h-[2.5px] overflow-hidden bg-slate-200/60 print:hidden"
    >
      <div className="anim-mutation-progress h-full bg-slate-800" />
    </div>
  );
}
