import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { Loading } from '../Loading';


/**
 * 지금 로그인되어 있는 기기 목록.
 *
 * 아이디를 함께 쓰시므로, 누가 어디서 무엇을 보고 있는지 여기서 확인하실 수 있다.
 * 20초마다 소식이 오므로 그 안에 소식이 있으면 「지금 접속 중」으로 본다.
 */
const ALIVE_MS = 75_000;
/**
 * 로그인은 30일 유지되므로, 한 달 쓰면 지난 로그인이 수십 줄 쌓인다.
 * 최근 것만 펼쳐 두고 그보다 오래된 것은 접어 둔다.
 */
const RECENT_MS = 3 * 86_400_000;

export default function DevicesCard() {
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: api.sessions, refetchInterval: 20_000 });
  const cutOthers = useMutation({
    mutationFn: api.logoutOthers,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });

  const [showOld, setShowOld] = useState(false);

  const rows = sessions.data ?? [];
  const age = (iso: string) => Date.now() - new Date(iso).getTime();
  const alive = (iso: string) => age(iso) < ALIVE_MS;
  const liveCount = rows.filter((r) => alive(r.lastSeen)).length;

  // 지금 접속 중이거나 최근 것만 펼쳐 두고, 오래된 로그인은 눌러야 보이게 접는다
  const fresh = rows.filter((r) => r.self || age(r.lastSeen) < RECENT_MS);
  const old = rows.filter((r) => !r.self && age(r.lastSeen) >= RECENT_MS);
  const shown = showOld ? [...fresh, ...old] : fresh;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="mb-1 font-bold">로그인된 기기</h2>
      <p className="mb-4 text-caption text-slate-600">
        {liveCount > 1
          ? `지금 ${liveCount}대가 함께 접속해 있습니다. 같은 명세표를 동시에 고치면 나중에 고친 내용만 남습니다.`
          : '지금은 이 기기에서만 접속해 있습니다.'}{' '}
        로그인은 30일 동안 유지되므로, 쓰지 않는 기기는 아래에서 끊어 두시면 됩니다.
      </p>

      {sessions.isPending ? (
        <Loading className="text-caption" />
      ) : (
        <ul className="space-y-2">
          {shown.map((r, i) => (
            <li
              key={i}
              className={`rounded-xl border px-3 py-2 text-caption ${
                alive(r.lastSeen) ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'
              }`}
            >
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="font-medium">{r.device}</span>
                {r.self && (
                  <span className="rounded-md bg-slate-900 px-1.5 py-0.5 text-caption text-white">지금 이 기기</span>
                )}
                <span className="ml-auto text-caption text-slate-600">
                  {alive(r.lastSeen) ? '접속 중' : timeAgo(r.lastSeen)}
                </span>
              </div>
              <div className="mt-0.5 text-caption text-slate-600">
                {r.userName}
                {r.viewingLabel ? ` · ${r.viewingLabel}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}

      {old.length > 0 && (
        <button
          type="button"
          onClick={() => setShowOld((v) => !v)}
          className="mt-2 text-caption text-sky-700 hover:underline"
        >
          {showOld ? '오래된 로그인 접기' : `사흘 넘게 조용한 로그인 ${old.length}개 더 보기`}
        </button>
      )}

      {rows.length > 1 && (
        <button
          type="button"
          onClick={() => {
            if (confirm('이 기기만 남기고 다른 곳의 로그인을 모두 끊을까요?')) cutOthers.mutate();
          }}
          disabled={cutOthers.isPending}
          className="mt-4 w-full rounded-xl border border-slate-300 py-2.5 text-caption hover:bg-slate-50 disabled:opacity-40"
        >
          {cutOthers.isPending ? '끊는 중…' : '다른 기기 로그아웃'}
        </button>
      )}
    </div>
  );
}
