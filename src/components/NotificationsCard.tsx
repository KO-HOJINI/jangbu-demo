import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { currentSubscription, disablePush, enablePush, pushSupport } from '../lib/push';
import { timeAgo } from '../lib/format';

/**
 * 설정 > 계정 — 「이 기기에서 알림 받기」.
 * 발행일 하루 전부터, 안 낸 명세표가 있으면 매일 아침 9시에 이 기기로 알림이 온다.
 */
export default function NotificationsCard() {
  const support = pushSupport();
  const queryClient = useQueryClient();
  const devices = useQuery({ queryKey: ['push-devices'], queryFn: api.pushDevices });
  const key = useQuery({ queryKey: ['push-key'], queryFn: api.pushKey });

  // 이 기기의 등록 상태는 브라우저에 있다 (서버 목록만으로는 어느 것이 이 기기인지 모른다)
  const [endpoint, setEndpoint] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    currentSubscription()
      .then((s) => setEndpoint(s?.endpoint ?? null))
      .catch(() => setEndpoint(null));
  }, []);

  const on = endpoint != null && (devices.data ?? []).some((d) => d.endpoint === endpoint);

  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ tone: 'ok', text: await work() });
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      queryClient.invalidateQueries({ queryKey: ['push-devices'] });
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="mb-1 font-bold">발행일 알림</h2>
      <p className="mb-4 text-caption text-slate-600">
        현장 발행일 하루 전부터, 아직 명세표를 안 낸 작업이 있으면 매일 아침 9시에 이 기기로 알려 드립니다. 화면 맨
        위에도 같은 내용이 뜹니다.
      </p>

      {support === 'ios-needs-home-screen' ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-caption text-amber-900">
          아이폰은 <b>홈 화면 아이콘으로 연 장부</b>에서만 알림을 켤 수 있습니다. Safari 에서 공유 버튼 → 「홈 화면에
          추가」 를 누른 뒤, 홈 화면의 장부 아이콘으로 열어 여기서 다시 눌러 주세요. (예전에 추가해 둔 아이콘은 지우고
          다시 추가해야 합니다)
        </p>
      ) : support === 'unsupported' ? (
        <p className="rounded-xl bg-slate-100 px-3 py-2 text-caption text-slate-700">
          이 브라우저는 알림을 받을 수 없습니다. 크롬·엣지·사파리 최신판에서 열어 주세요.
        </p>
      ) : key.data && !key.data.ready ? (
        <p className="rounded-xl bg-slate-100 px-3 py-2 text-caption text-slate-700">
          서버에 알림 열쇠가 아직 준비되지 않았습니다.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-0.5 text-caption font-bold ${
              on ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
            }`}
          >
            {endpoint === undefined ? '확인 중…' : on ? '이 기기: 알림 켜짐' : '이 기기: 알림 꺼짐'}
          </span>
          {on ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api.pushTest(endpoint!);
                    return '시험 알림을 보냈습니다. 잠시 뒤 이 기기에 알림이 뜨는지 봐 주세요.';
                  })
                }
                className="rounded-xl bg-slate-900 px-4 py-2 text-caption font-medium text-white hover:bg-slate-800 disabled:opacity-40"
              >
                시험 알림 보내기
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await disablePush();
                    setEndpoint(null);
                    return '이 기기의 알림을 껐습니다.';
                  })
                }
                className="rounded-xl border border-slate-300 px-4 py-2 text-caption hover:bg-slate-50 disabled:opacity-40"
              >
                알림 끄기
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={busy || endpoint === undefined}
              onClick={() =>
                run(async () => {
                  const sub = await enablePush();
                  setEndpoint(sub.endpoint);
                  return '이 기기에서 알림을 받습니다. 「시험 알림 보내기」로 확인해 보세요.';
                })
              }
              className="rounded-xl bg-slate-900 px-4 py-2 text-caption font-medium text-white hover:bg-slate-800 disabled:opacity-40"
            >
              {busy ? '켜는 중…' : '이 기기에서 알림 받기'}
            </button>
          )}
        </div>
      )}

      {message && (
        <p className={`mt-3 text-caption ${message.tone === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>{message.text}</p>
      )}

      {(devices.data?.length ?? 0) > 0 && (
        <ul className="mt-4 space-y-1 border-t border-slate-200 pt-3 text-caption text-slate-600">
          <li className="font-medium text-slate-700">알림을 받는 기기 {devices.data!.length}대</li>
          {devices.data!.map((d) => (
            <li key={d.endpoint} className="flex flex-wrap gap-x-2">
              <span>{d.device}</span>
              {d.endpoint === endpoint && <span className="text-slate-900">(이 기기)</span>}
              <span className="ml-auto">
                {d.lastSentAt
                  ? `${timeAgo(d.lastSentAt)} ${d.lastStatus === 'ok' ? '보냄' : '보내기 실패'}`
                  : '아직 보낸 적 없음'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
