import { useState } from 'react';

/**
 * 창을 닫을 때 온 길로 나가는 움직임(index.css 의 is-leaving)을 보여 준 뒤에 치운다.
 *   const [leaving, leave] = useLeaving(200);
 *   <div className={`anim-overlay ${leaving ? 'is-leaving' : ''}`}> … <button onClick={() => leave(onClose)}>
 */
export function useLeaving(ms: number) {
  const [leaving, setLeaving] = useState(false);
  const leave = (then: () => void) => {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(() => {
      // 창이 화면에 남아 다시 열리는 경우(사진 확인 창)를 위해 되돌려 둔다
      setLeaving(false);
      then();
    }, ms);
  };
  return [leaving, leave] as const;
}
