import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BackupEntry } from '../../../shared/types';
import { api } from '../../lib/api';
import { Loading } from '../Loading';
import ScrollBox from '../ScrollBox';
import { inputClass } from './inputClass';

// ── 백업 ────────────────────────────────────────────────────────────────
export default function BackupsTab() {
  const queryClient = useQueryClient();
  const backups = useQuery({ queryKey: ['backups'], queryFn: api.backups });

  const run = useMutation({
    mutationFn: api.runBackup,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['backups'] }),
  });

  // 되돌릴 백업을 고르면 표 위에 확인 상자가 열린다. 그 백업의 날짜를 그대로 적어야 단추가 눌린다
  const [target, setTarget] = useState<BackupEntry | null>(null);
  const [typed, setTyped] = useState('');
  const [restored, setRestored] = useState<string | null>(null);
  const close = () => {
    setTarget(null);
    setTyped('');
  };
  const restore = useMutation({
    mutationFn: (b: BackupEntry) => api.restoreBackup(b.key, typed),
    onSuccess: (_result, b) => {
      setRestored(b.date);
      close();
      // 장부·거래처·명세표가 모두 바뀌었으니 화면에 담아 둔 것을 전부 다시 불러온다
      queryClient.invalidateQueries();
    },
  });

  const rows = backups.data ?? [];
  // 「마지막 백업」은 매일 도는 것만 센다 (되돌리기 직전에 떠 둔 것은 빼고)
  const latest = rows.find((b) => !b.note);
  const stale = latest ? (Date.now() - new Date(latest.createdAt).getTime()) / 86_400_000 > 2 : true;

  return (
    <>
      <p className="mb-4 text-caption text-slate-600">
        매일 새벽 3시에 장부 전체를 한 벌 따로 저장해 두고, 60일치를 보관합니다. 장부를 잘못 고치거나 지웠을 때 저장해
        둔 날의 모습으로 되돌릴 수 있습니다.
      </p>

      {/* 단추마다 무엇을 하는지 — 「되돌리기」가 장부를 바꾸는 유일한 단추라 맨 앞에 적는다 */}
      <dl className="mb-4 space-y-2 rounded-2xl border border-slate-200 bg-white p-4 text-caption leading-relaxed">
        {(
          [
            ['되돌리기', '장부를 그날 저장해 둔 모습으로 되돌립니다. 그 뒤에 적은 것은 사라지므로, 누르면 한 번 더 묻습니다.'],
            ['내려받기', '그날 장부를 파일로 이 기기에 받아 둡니다. 장부는 바뀌지 않습니다.'],
            ['지금 백업', '지금 장부를 바로 한 벌 저장합니다. 크게 고치기 전에 눌러 두면 좋습니다.'],
          ] as const
        ).map(([term, text]) => (
          <div key={term} className="sm:flex sm:gap-3">
            <dt className="shrink-0 font-bold text-slate-900 sm:w-20">{term}</dt>
            <dd className="text-slate-700">{text}</dd>
          </div>
        ))}
      </dl>

      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={() => run.mutate()}
          disabled={run.isPending}
          className="shrink-0 rounded-xl bg-slate-900 px-4 py-2 text-caption font-medium whitespace-nowrap text-white hover:bg-slate-800 disabled:opacity-40"
        >
          {run.isPending ? '백업 중…' : '지금 백업'}
        </button>
        {latest && (
          <span className={`text-caption ${stale ? 'text-amber-700' : 'text-slate-600'}`}>
            마지막 백업 {new Date(latest.createdAt).toLocaleString('ko-KR')}
            {stale && ' — 이틀 넘게 안 돌았습니다'}
          </span>
        )}
      </div>

      {run.error && (
        <p className="mb-4 anim-reveal rounded-xl bg-rose-50 px-4 py-3 text-caption text-rose-700">{run.error.message}</p>
      )}

      {restored && !target && (
        <p className="anim-reveal mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-caption text-emerald-800">
          {restored} 백업으로 되돌렸습니다. 되돌리기 직전의 장부는 목록에 「되돌리기 직전」으로 남겨 두었습니다.
        </p>
      )}

      {target && (
        <section className="anim-reveal mb-4 rounded-2xl border border-rose-300 bg-rose-50 p-4">
          <h2 className="mb-2 text-body font-bold text-rose-900">{target.date} 백업으로 되돌리기</h2>
          <p className="mb-3 text-caption leading-relaxed text-slate-800">
            작업일보·명세표·견적서·거래처·현장이 모두 이 백업을 만든 때로 돌아갑니다. 그 뒤에 적은 것은 사라집니다.
            지금 장부는 먼저 따로 백업해 두고, 로그인 계정은 그대로 둡니다.
          </p>
          <label className="block">
            <span className="mb-1 block text-caption font-medium text-slate-800">
              맞으면 날짜 {target.date} 를 그대로 적어 주세요
            </span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={target.date}
              inputMode="numeric"
              autoComplete="off"
              className={`${inputClass} tabular sm:w-48`}
            />
          </label>
          {restore.error && <p className="mt-3 text-caption text-rose-700">{restore.error.message}</p>}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => restore.mutate(target)}
              disabled={typed.trim() !== target.date || restore.isPending}
              className="rounded-xl bg-rose-700 px-4 py-2 text-caption font-medium whitespace-nowrap text-white hover:bg-rose-800 disabled:opacity-40"
            >
              {restore.isPending ? '되돌리는 중…' : '되돌리기'}
            </button>
            <button
              type="button"
              onClick={close}
              disabled={restore.isPending}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-caption whitespace-nowrap hover:bg-slate-50"
            >
              그만두기
            </button>
          </div>
        </section>
      )}

      <ScrollBox className="rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-caption">
          <thead>
            <tr className="bg-slate-50 text-caption font-medium text-slate-600">
              {/* 휴대폰에서는 날짜와 되돌리기·내려받기만 남겨 옆으로 밀지 않고 보이게 한다 */}
              {['날짜', '만든 시각', '크기', '기록 수', ''].map((h) => (
                <th
                  key={h}
                  className={`border-b border-slate-200 px-3 py-2 text-left whitespace-nowrap ${h === '만든 시각' || h === '크기' || h === '기록 수' ? 'max-sm:hidden' : ''}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.key} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-3 py-2 font-medium whitespace-nowrap tabular">
                  {b.date}
                  {b.note && <span className="font-normal text-slate-600 max-sm:block sm:ml-2">{b.note}</span>}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-slate-600 tabular max-sm:hidden">
                  {b.createdAt ? new Date(b.createdAt).toLocaleString('ko-KR') : ''}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-slate-600 tabular max-sm:hidden">{Math.round(b.bytes / 1024).toLocaleString()} KB</td>
                <td className="px-3 py-2 whitespace-nowrap text-slate-600 tabular max-sm:hidden">{b.rows.toLocaleString()}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {/* 부모님은 내려받기보다 되돌리기를 쓴다 — 되돌리기를 앞에, 더 눈에 띄게 */}
                  <button
                    type="button"
                    onClick={() => {
                      setTarget(b);
                      setTyped('');
                      setRestored(null);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="min-h-11 rounded-xl border border-rose-300 bg-white px-3 font-medium text-rose-700 hover:bg-rose-50"
                  >
                    되돌리기
                  </button>
                  <a
                    href={api.backupUrl(b.key)}
                    download
                    className="ml-2 inline-flex min-h-11 items-center rounded-xl border border-slate-300 bg-white px-3 text-slate-700 hover:bg-slate-50"
                  >
                    내려받기
                  </a>
                </td>
              </tr>
            ))}

            {backups.isPending && (
              <tr>
                <td colSpan={5} className="py-12 text-center">
                  <Loading />
                </td>
              </tr>
            )}

            {!rows.length && !backups.isPending && (
              <tr>
                <td colSpan={5} className="py-12 text-center text-slate-500">
                  아직 백업이 없습니다. 「지금 백업」을 한 번 눌러 두세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ScrollBox>

      <p className="mt-4 text-caption text-slate-600">
        {/* 부모님이 보는 화면이라 터미널 명령은 적지 않는다 — 되돌리는 방법은 README 에 있다 */}
        되돌리다 막히면 김재현의 친구 고민준에게 연락 주세요.
      </p>
    </>
  );
}
