import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import { manwon } from '../lib/format';
import { overdueTitle } from '../../shared/issueDue';

const DISMISS_KEY = 'jangbu:overdue-dismissed';

/** 「오늘은 그만 보기」 — 이 브라우저에만, 날짜가 바뀌면 다시 뜬다 */
function dismissedToday(today: string) {
  try {
    return localStorage.getItem(DISMISS_KEY) === today;
  } catch {
    return false;
  }
}

/**
 * 화면 맨 위 알림 띠: 발행일이 내일까지 돌아오는데 아직 명세표를 안 낸 현장 (하루 전부터 알린다). 같은 때 메뉴의 「명세표」에도 점이 붙는다 (App.tsx).
 * 휴대폰 알림을 켜지 않았어도 장부를 열면 바로 보인다.
 */
export default function OverdueBanner() {
  const { pathname } = useLocation();
  const overdue = useQuery({ queryKey: ['overdue'], queryFn: api.overdue, staleTime: 5 * 60_000 });
  const [hidden, setHidden] = useState(false);

  const data = overdue.data;
  // 현장별 화면에는 같은 내용이 표로 있다
  if (!data || !data.items.length || hidden || pathname.startsWith('/sites') || dismissedToday(data.today)) return null;

  const names = data.items.slice(0, 2).map((i) => i.site_label);
  const more = data.items.length > 2 ? ` 외 ${data.items.length - 2}곳` : '';

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-caption text-amber-900 print:hidden"
    >
      <span className="font-bold">
        {overdueTitle(data.items, data.today)} · {manwon(data.amount)}
      </span>
      <span className="text-amber-800">
        {names.join(', ')}
        {more}
      </span>
      <span className="ml-auto flex gap-2">
        <Link
          to="/sites"
          className="rounded-xl bg-amber-700 px-3 py-1.5 font-medium whitespace-nowrap text-white hover:bg-amber-800"
        >
          현장별에서 보기
        </Link>
        <button
          type="button"
          onClick={() => {
            try {
              localStorage.setItem(DISMISS_KEY, data.today);
            } catch {
              /* 저장이 안 되는 브라우저면 이번 화면에서만 숨긴다 */
            }
            setHidden(true);
          }}
          className="rounded-xl border border-amber-300 px-3 py-1.5 whitespace-nowrap hover:bg-amber-100"
        >
          오늘은 그만 보기
        </button>
      </span>
    </div>
  );
}
