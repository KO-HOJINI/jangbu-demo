import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export default function LoginPage({ notice }: { notice?: string | null }) {
  // 쓰는 사람이 정해져 있어 아이디는 미리 넣어 둔다 — 비밀번호만 치면 된다
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const queryClient = useQueryClient();

  const login = useMutation({
    mutationFn: () => api.login(username, password),
    onSuccess: (user) => {
      queryClient.setQueryData(['me'], user);
      queryClient.invalidateQueries();
    },
  });

  return (
    <div className="gutter-balance">
    <main className="grid min-h-dvh place-items-center px-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate();
        }}
        className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-8 shadow-sm"
      >
        <h1 className="text-title font-bold tracking-tight">장부</h1>
        <p className="mt-1 text-caption text-slate-600">거래명세표 관리</p>

        <label className="mt-8 block text-caption font-medium text-slate-700">
          아이디
          <input
            type="text"
            name="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="off"
            autoCorrect="off"
            required
            className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2 text-body outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          />
        </label>

        <label className="mt-4 block text-caption font-medium text-slate-700">
          비밀번호
          <input
            type="password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
            required
            className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2 text-body outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          />
        </label>

        {(login.error || notice) && (
          <p className="mt-4 anim-reveal rounded-xl bg-rose-50 px-4 py-3 text-caption text-rose-700">
            {login.error?.message ?? notice}
          </p>
        )}

        <button
          type="submit"
          disabled={login.isPending}
          className="mt-6 w-full rounded-xl bg-slate-900 py-2.5 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {login.isPending ? '확인 중…' : '로그인'}
        </button>
      </form>
    </main>
    </div>
  );
}
