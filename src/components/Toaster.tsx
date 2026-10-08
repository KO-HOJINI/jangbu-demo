import { useEffect, useState } from 'react';

/** 사라지는 움직임(index.css 의 .toast, 200ms)이 끝난 뒤 글자를 치운다 */
const LEAVE_MS = 220;

/**
 * toast() 로 보낸 알림을 화면 아래에 1.8초 보여준다. 이어서 오면 시간만 늘어난다.
 * 올라왔다가 같은 쪽으로 내려간다 — 내려가는 동안에도 글자가 보여야 해서 글자와 보임을 따로 든다.
 */
export default function Toaster() {
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let hide: number | undefined;
    let clear: number | undefined;
    const show = (e: Event) => {
      setMessage((e as CustomEvent<string>).detail);
      setOpen(true);
      window.clearTimeout(hide);
      window.clearTimeout(clear);
      hide = window.setTimeout(() => {
        setOpen(false);
        clear = window.setTimeout(() => setMessage(null), LEAVE_MS);
      }, 1800);
    };
    window.addEventListener('jangbu:toast', show);
    return () => {
      window.removeEventListener('jangbu:toast', show);
      window.clearTimeout(hide);
      window.clearTimeout(clear);
    };
  }, []);

  // 화면 읽기 프로그램이 알림을 읽도록 상자는 늘 두고 글자만 바꾼다
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 lg:bottom-6 print:hidden"
    >
      {message && (
        <span className={`toast rounded-full bg-slate-900 px-5 py-3 text-body font-medium text-white shadow-lg ${open ? 'is-open' : ''}`}>
          {message}
        </span>
      )}
    </div>
  );
}
