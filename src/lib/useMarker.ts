import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react';

/**
 * 단추 묶음에서 지금 고른 칸 뒤에 깔리는 표시의 자리.
 * 고른 칸이 바뀌면 표시가 그 자리로 미끄러져 간다 (움직임은 index.css 의 .nav-marker · .seg-marker).
 *
 * 돌려주는 ref 를 묶음(position: relative)에 달고, style 을 표시에 준다. 고른 칸이 없으면 style 은 undefined.
 * 묶음이 나중에 그려져도(불러오는 동안에는 없다가) 그때 재도록 ref 를 값으로 들고 있는다.
 */
export function useMarker<T extends HTMLElement>(
  /** 묶음 안에서 지금 고른 칸을 찾는 CSS 선택자. 여럿이면 앞의 것부터 찾고, 화면에 보이는 칸만 친다 */
  selector: string | string[],
  /** 고른 칸이 바뀌는 값 — 바뀌면 다시 잰다 */
  key: unknown
): [(el: T | null) => void, CSSProperties | undefined] {
  const [group, setGroup] = useState<T | null>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  // 처음 그릴 때는 미끄러지지 않고 제자리에 바로 놓는다
  const [slide, setSlide] = useState(false);

  useLayoutEffect(() => {
    if (!group) return;
    const measure = () => {
      // 감춘 칸(휴대폰 메뉴의 견적서)은 건너뛴다 — 폭이 0 이라 표시가 사라진다
      const active = [selector]
        .flat()
        .flatMap((s) => [...group.querySelectorAll<HTMLElement>(s)])
        .find((el) => el.offsetWidth > 0);
      setBox(
        active
          ? { left: active.offsetLeft, top: active.offsetTop, width: active.offsetWidth, height: active.offsetHeight }
          : null
      );
    };
    measure();
    // 글꼴이 늦게 오거나 창 폭이 바뀌면 칸 자리가 달라진다
    const observer = new ResizeObserver(measure);
    observer.observe(group);
    return () => observer.disconnect();
  }, [group, String(selector), key]);

  useEffect(() => {
    if (box) setSlide(true);
  }, [box]);

  const style = box
    ? {
        translate: `${box.left}px ${box.top}px`,
        width: box.width,
        height: box.height,
        transitionDuration: slide ? undefined : '0s',
      }
    : undefined;
  return [setGroup, style];
}
