/**
 * 밀어야 나머지가 보이는 상자(components/ScrollBox.tsx)의 잘린 쪽 가장자리에 그림자를 지게 해 「더 있다」는 것을 알린다.
 * 끝에 가까워질수록 그쪽 그림자가 옅어지고, 끝까지 밀면 사라진다. 그림자 모양은 index.css 의 .scroll-box,
 * 여기서는 미는 칸(.scroll-hint)을 재서 바깥 상자에 네 값을 넣는다:
 *   --scroll-x / --scroll-y    옆으로 / 아래로 밀리는 상자인가 (0 또는 1)
 *   --more-start / --more-end  앞쪽(왼쪽·위) / 뒤쪽(오른쪽·아래)이 얼마나 잘렸는가 (0~1, 끝에서 FADE_PX 안쪽이면 줄어든다)
 */
type Box = Pick<HTMLElement, 'clientWidth' | 'clientHeight' | 'scrollWidth' | 'scrollHeight' | 'scrollLeft' | 'scrollTop'>;

/** 어느 쪽으로 밀면 더 나오는지. 1px 안쪽 차이는 반올림 오차로 보고 끝에 닿은 것으로 친다 */
export function moreToScroll(box: Box) {
  const x = box.scrollWidth - box.clientWidth;
  const y = box.scrollHeight - box.clientHeight;
  return {
    left: x > 1 && box.scrollLeft > 1,
    right: x > 1 && box.scrollLeft < x - 1,
    up: y > 1 && box.scrollTop > 1,
    down: y > 1 && box.scrollTop < y - 1,
  };
}

/** 끝에서 이만큼 안쪽부터 그림자가 옅어지기 시작한다 */
export const FADE_PX = 48;

/** 남은 거리 -> 그림자 짙기 (0~1) */
const strength = (left: number) => Math.max(0, Math.min(1, left / FADE_PX));

/** 바깥 상자에 넣을 값. 그림자 겹은 앞쪽·뒤쪽 두 장이라, 옆과 아래 중 밀리는 쪽의 것을 쓴다 */
export function hintVars(box: Box) {
  const more = moreToScroll(box);
  const x = more.left || more.right;
  const y = more.up || more.down;
  // 앞쪽으로 남은 거리 / 뒤쪽으로 남은 거리
  const before = x ? box.scrollLeft : y ? box.scrollTop : 0;
  const after = x
    ? box.scrollWidth - box.clientWidth - box.scrollLeft
    : y
      ? box.scrollHeight - box.clientHeight - box.scrollTop
      : 0;
  return {
    '--scroll-x': x ? 1 : 0,
    '--scroll-y': y ? 1 : 0,
    '--more-start': more.left || more.up ? strength(before) : 0,
    '--more-end': more.right || more.down ? strength(after) : 0,
  };
}

function update(el: HTMLElement) {
  // 그림자는 밀리지 않는 바깥 상자(.scroll-box)가 그린다
  const box = el.closest<HTMLElement>('.scroll-box');
  if (!box) return;
  for (const [name, amount] of Object.entries(hintVars(el))) {
    const value = String(Math.round(amount * 100) / 100);
    if (box.style.getPropertyValue(name) !== value) box.style.setProperty(name, value);
  }
}

export function watchScrollHints() {
  const scan = () => document.querySelectorAll<HTMLElement>('.scroll-hint').forEach(update);

  // 밀 때: scroll 은 위로 전해지지 않아 잡는 단계(capture)에서 받는다
  document.addEventListener(
    'scroll',
    (e) => {
      if (e.target instanceof HTMLElement && e.target.classList.contains('scroll-hint')) update(e.target);
    },
    { capture: true, passive: true }
  );

  // 내용이 바뀌거나(줄이 늘어남) 창 크기가 바뀌면 다시 잰다 — 한 화면에 몇 개뿐이라 통째로 훑는다
  let queued = false;
  const queue = () => {
    if (queued) return;
    queued = true;
    // 숨은 탭에서는 requestAnimationFrame 이 돌지 않아 시간으로 미룬다
    setTimeout(() => {
      queued = false;
      scan();
    });
  };
  new MutationObserver(queue).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', queue);
  window.addEventListener('load', queue);
  queue();
}
