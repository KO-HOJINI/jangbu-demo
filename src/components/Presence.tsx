import { Link } from 'react-router-dom';
import { useClashes, useOthers } from '../lib/presence';

/**
 * 동시 접속 표시. PC 는 위쪽 메뉴 줄 안에, 휴대폰은 화면 맨 위 오른쪽에 둔다 (App.tsx 가 두 곳에 놓고 className 으로 가른다).
 * 휴대폰에서 아래에 떠 있는 메뉴 안에 점과 숫자로 두었더니 새 알림처럼 보여서 위로 올리고 글로 적는다.
 */
export function PresenceBadge({ className = '' }: { className?: string }) {
  const others = useOthers();
  if (!others.length) return null;

  const where = others
    .map((s) => [s.device, s.viewingLabel].filter(Boolean).join(' · '))
    .join('\n');

  return (
    <Link
      to="/settings"
      title={`지금 함께 접속 중\n${where}`}
      className={`shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-emerald-700 hover:bg-emerald-100 ${className}`}
    >
      <span className="text-[10px] leading-none">●</span>
      <span className="text-caption font-medium tabular">
        {others.length}
        <span className="font-normal">대 함께 접속 중</span>
      </span>
    </Link>
  );
}

/**
 * 같은 문서를 다른 기기에서도 열어 두었을 때의 경고.
 *
 * 아이디를 함께 쓰시므로 두 분이 같은 명세표를 동시에 고치면 나중에 고친 쪽만 남는다.
 * 그 사고가 나기 전에 알려 주는 것이 이 줄의 목적이다.
 */
export function ClashBanner({ viewKey, what }: { viewKey: string; what: string }) {
  const clashes = useClashes(viewKey);
  if (!clashes.length) return null;

  const who = clashes.map((s) => s.device).join(', ');

  return (
    <p className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-caption text-amber-900 print:hidden">
      <strong className="font-bold">지금 {who}에서도 이 {what}를 열어 두었습니다.</strong>{' '}
      같이 고치시면 나중에 고친 내용만 남습니다. 한 분씩 번갈아 고쳐 주세요.
    </p>
  );
}
