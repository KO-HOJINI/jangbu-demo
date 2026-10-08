import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MailAccount } from '../../../shared/types';
import { api, type MailAccountInput } from '../../lib/api';
import { toast } from '../../lib/toast';
import { Loading } from '../Loading';
import { inputClass } from './inputClass';

const EMPTY: MailAccountInput = { label: '', username: '', password: '' };

/**
 * 메일 보내는 네이버 계정.
 * 여러 개 등록해 두고, 명세표·견적서를 보낼 때 「보내는 계정」에서 고른다.
 * 비밀번호는 서버가 잠가서 보관하고 화면으로 다시 오지 않는다 — 고칠 때 비워 두면 원래 것을 그대로 쓴다.
 */
export default function MailAccountsCard() {
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ['mail-accounts'], queryFn: api.mailAccounts });

  // 'new' 는 새 계정, 숫자는 고치는 계정의 번호, null 은 적는 칸을 닫은 상태
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [form, setForm] = useState<MailAccountInput>(EMPTY);

  const done = (message: string) => {
    queryClient.invalidateQueries({ queryKey: ['mail-accounts'] });
    setEditing(null);
    setForm(EMPTY);
    toast(message);
  };

  const save = useMutation({
    mutationFn: () => (editing === 'new' ? api.addMailAccount(form).then(() => undefined) : api.updateMailAccount(editing as number, form)),
    onSuccess: () => done(editing === 'new' ? '메일 계정을 등록했습니다' : '메일 계정을 고쳤습니다'),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteMailAccount(id),
    onSuccess: () => done('메일 계정을 지웠습니다'),
  });

  const open = (target: MailAccount | 'new') => {
    save.reset();
    remove.reset();
    setEditing(target === 'new' ? 'new' : target.id);
    setForm(target === 'new' ? EMPTY : { label: target.label ?? '', username: target.username, password: '' });
  };

  const list = accounts.data?.accounts ?? [];
  const set = (key: keyof MailAccountInput) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const error = save.error ?? remove.error;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="mb-4 font-bold">메일 보내는 계정</h2>

      {accounts.isPending ? (
        <Loading className="text-caption" />
      ) : (
        <>
          {list.length === 0 && editing === null && (
            <p className="mb-3 text-caption text-slate-600">
              등록된 계정이 없습니다. 네이버 계정을 등록하면 명세표·견적서를 여기서 바로 메일로 보낼 수 있습니다.
            </p>
          )}

          <ul className="space-y-2">
            {list.map((a) => (
              <li key={a.id} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-body font-medium break-words text-slate-900">
                    {a.label || (a.fixed ? '서버에 넣어 둔 계정' : a.username)}
                  </div>
                  <div className="text-caption break-all text-slate-600">{a.address}</div>
                </div>
                {!a.fixed && (
                  <>
                    <button
                      type="button"
                      onClick={() => open(a)}
                      className="shrink-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-caption hover:bg-slate-50"
                    >
                      수정
                    </button>
                    <button
                      type="button"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (confirm(`${a.address} 계정을 지울까요? 이 계정으로는 더 보낼 수 없게 됩니다.`)) remove.mutate(a.id);
                      }}
                      className="shrink-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-caption text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                    >
                      삭제
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>

          {editing !== null && (
            <form
              className="anim-reveal mt-4 space-y-3 border-t border-slate-200 pt-4"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate();
              }}
            >
              <label className="block">
                <span className="mb-1 block text-caption font-medium text-slate-600">이름 (어느 회사 메일인지)</span>
                <input value={form.label} onChange={set('label')} placeholder="한강중기" className={inputClass} />
              </label>
              <label className="block">
                <span className="mb-1 block text-caption font-medium text-slate-600">네이버 아이디</span>
                <input
                  value={form.username}
                  onChange={set('username')}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="off"
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-caption font-medium text-slate-600">애플리케이션 비밀번호 (12자리)</span>
                <input
                  type="password"
                  value={form.password}
                  onChange={set('password')}
                  autoComplete="new-password"
                  placeholder={editing === 'new' ? '' : '바꾸지 않으려면 비워 두세요'}
                  className={inputClass}
                />
              </label>
              <p className="text-caption text-slate-600">
                네이버에 로그인할 때 쓰는 비밀번호가 아닙니다. 네이버 내정보 &gt; 보안설정 &gt; 2단계 인증 관리의 「애플리케이션 비밀번호」에서
                만든 12자리를 적어 주세요. 네이버 메일 환경설정에서 「IMAP/SMTP 사용」도 켜져 있어야 합니다.
              </p>

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={save.isPending || !form.username.trim() || (editing === 'new' && !form.password.trim())}
                  className="flex-1 rounded-xl bg-slate-900 py-2.5 font-medium text-white hover:bg-slate-800 disabled:opacity-40"
                >
                  {save.isPending ? '네이버에 확인하는 중…' : editing === 'new' ? '등록' : '저장'}
                </button>
                <button
                  type="button"
                  disabled={save.isPending}
                  onClick={() => setEditing(null)}
                  className="rounded-xl border border-slate-300 px-4 py-2.5 text-caption hover:bg-slate-50 disabled:opacity-40"
                >
                  그만두기
                </button>
              </div>
            </form>
          )}

          {error && (
            <p className="mt-3 anim-reveal rounded-xl bg-rose-50 px-4 py-3 text-caption text-rose-700">{error.message}</p>
          )}

          {editing === null &&
            (accounts.data?.canAdd ? (
              <button
                type="button"
                onClick={() => open('new')}
                className="mt-4 w-full rounded-xl border border-slate-300 py-2.5 text-caption font-medium hover:bg-slate-50"
              >
                계정 추가
              </button>
            ) : (
              <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-caption text-amber-900">
                메일 계정을 저장할 서버 열쇠가 없어 등록할 수 없습니다. 김재현의 친구 고민준에게 연락 주세요.
              </p>
            ))}
        </>
      )}
    </div>
  );
}
