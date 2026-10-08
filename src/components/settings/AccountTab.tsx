import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import NotificationsCard from '../NotificationsCard';
import DevicesCard from './DevicesCard';
import MailAccountsCard from './MailAccountsCard';
import { inputClass } from './inputClass';

// ── 계정 ────────────────────────────────────────────────────────────────
export default function AccountTab() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmed, setConfirmed] = useState('');
  const [done, setDone] = useState(false);

  const change = useMutation({
    mutationFn: () => api.changePassword(current, next),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setConfirmed('');
      setDone(true);
    },
  });

  const mismatch = next !== '' && confirmed !== '' && next !== confirmed;

  return (
    // PC: 왼쪽에 알림·비밀번호를 위아래로, 오른쪽에 긴 「로그인된 기기」 — 기기 목록이 길어도 왼쪽 두 상자 사이가 벌어지지 않게 남는 높이는 둘째 줄이 받는다
    // 넓은 화면(1280px~): 세 줄기로 나란히 — 아래로 내리지 않아도 다 보인다
    // 「메일 보내는 계정」은 짧은 알림 상자 바로 밑에 둔다 (맨 아래에 두면 긴 상자들 밑으로 밀려 찾기 어렵다)
    <div className="grid max-w-4xl items-start gap-4 md:grid-cols-2 md:grid-rows-[auto_1fr] xl:max-w-none xl:grid-cols-3 xl:grid-rows-1">
    <div className="space-y-4">
      <NotificationsCard />
      <MailAccountsCard />
    </div>
    <div className="md:col-start-2 md:row-span-2 md:row-start-1 xl:col-start-3 xl:row-span-1">
      <DevicesCard />
    </div>

    <div className="rounded-2xl border border-slate-200 bg-white p-4 xl:col-start-2 xl:row-start-1">
      <h2 className="mb-1 font-bold">비밀번호 변경</h2>
      <p className="mb-4 text-caption text-slate-600">
        바꾸고 나면 다른 기기에서 열어 둔 로그인은 모두 끊깁니다.
      </p>

      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-caption font-medium text-slate-600">지금 비밀번호</span>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-caption font-medium text-slate-600">새 비밀번호</span>
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-caption font-medium text-slate-600">새 비밀번호 확인</span>
          <input
            type="password"
            value={confirmed}
            onChange={(e) => setConfirmed(e.target.value)}
            autoComplete="new-password"
            className={inputClass}
          />
        </label>
      </div>

      {next && next.length < 10 && (
        <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-caption text-amber-800">
          짧은 비밀번호는 자동 프로그램이 금방 맞춥니다. 인터넷에 열린 주소이니 10자 이상을 권합니다.
        </p>
      )}
      {mismatch && <p className="mt-3 text-caption text-rose-700">새 비밀번호가 서로 다릅니다.</p>}
      {change.error && (
        <p className="mt-3 anim-reveal rounded-xl bg-rose-50 px-4 py-3 text-caption text-rose-700">{change.error.message}</p>
      )}
      {done && (
        <p className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-caption text-emerald-800">
          비밀번호를 바꿨습니다.
        </p>
      )}

      <button
        type="button"
        onClick={() => {
          setDone(false);
          change.mutate();
        }}
        disabled={!current || !next || next !== confirmed || change.isPending}
        className="mt-4 w-full rounded-xl bg-slate-900 py-2.5 font-medium text-white hover:bg-slate-800 disabled:opacity-40"
      >
        {change.isPending ? '바꾸는 중…' : '비밀번호 바꾸기'}
      </button>

      <p className="mt-4 text-caption text-slate-600">
        계정을 더 만들려면 김재현의 친구 고민준에게 연락 주세요.{' '}
        <Link to="/ledger" className="whitespace-nowrap text-sky-700 hover:underline">
          작업일보로 돌아가기
        </Link>
      </p>
    </div>
    </div>
  );
}
