import type { ReactNode, Ref, UIEventHandler } from 'react';

/**
 * 밀어야 나머지가 보이는 상자. 잘려서 안 보이는 쪽 가장자리에 옅은 그림자가 져서 「더 있다」는 것을 알리고,
 * 끝까지 밀면 그쪽 그림자는 사라진다 (어느 쪽이 잘렸는지는 lib/scrollHints.ts 가 잰다).
 *
 * 그림자는 내용 위에 덮이되 같이 밀리면 안 되므로 두 겹으로 나눈다.
 *   className      바깥 상자 — 테두리·둥근 모서리·바탕, 보일지 말지 (hidden lg:block 등)
 *   viewClassName  안쪽의 미는 칸 — 안 주면 옆으로 미는 칸. 아래로 미는 창은 overflow-y-auto 와 안쪽 여백을 준다
 * ref 와 onScroll 은 미는 칸에 달린다.
 */
export default function ScrollBox({
  className = '',
  // 옆으로만 미는 칸: 높이가 소수점으로 어긋나 1px 남으면 세로 스크롤 막대가 생기므로 세로는 막아 둔다
  viewClassName = 'overflow-x-auto overflow-y-hidden',
  ref,
  onScroll,
  children,
}: {
  className?: string;
  viewClassName?: string;
  ref?: Ref<HTMLDivElement>;
  onScroll?: UIEventHandler<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div className={`scroll-box ${className}`}>
      <div ref={ref} onScroll={onScroll} className={`scroll-hint ${viewClassName}`}>
        {children}
      </div>
    </div>
  );
}
