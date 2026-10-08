import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { Operator } from '../../../shared/types';
import { api } from '../../lib/api';
import { monthRange, today } from '../../lib/format';
import { Pending } from '../Loading';

/** 그 기사님이 마지막으로 일한 달만 걸러 본 작업일보 주소 */
function ledgerLink(operatorId: number, lastDate?: string) {
  const [from, to] = monthRange(lastDate ?? today());
  return `/ledger?operatorId=${operatorId}&from=${from}&to=${to}`;
}

/** 다른 사장님(외주) 목록 — 이름 고치기·숨김·삭제. 우리 기사님은 StaffBox 가 맡는다 */
export default function OtherOperators({
  operators,
  usage,
  last,
}: {
  operators: Operator[];
  usage?: Record<string, number>;
  /** 기사님마다 마지막으로 일한 날 */
  last?: Record<string, string>;
}) {
  // usage 가 없으면 아직 불러오는 중 — 건수를 모르니 삭제 단추도 감춘다
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  const invalidate = () => queryClient.invalidateQueries();
  const onError = (e: Error) => setError(e.message);

  const update = useMutation({
    mutationFn: (v: { id: number; patch: Partial<Operator> }) => api.updateOperator(v.id, v.patch),
    onSuccess: invalidate,
    onError,
  });
  const create = useMutation({
    mutationFn: () => api.createOperator(newName.trim()),
    onSuccess: () => {
      setNewName('');
      invalidate();
    },
    onError,
  });
  const remove = useMutation({ mutationFn: (id: number) => api.deleteOperator(id), onSuccess: invalidate, onError });

  return (
    <>
      <p className="mb-4 text-caption text-slate-600">
        지금 안 쓰는 이름은 「숨김」으로 두면 장부 선택 목록에서 빠지고, 기록은 그대로 남습니다.
      </p>
      {error && (
        <p className="mb-4 anim-reveal rounded-xl bg-rose-50 px-4 py-3 text-caption text-rose-700">
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-3 text-rose-600">
            닫기
          </button>
        </p>
      )}

      <div className="mb-4 flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && newName.trim() && create.mutate()}
          placeholder="새 이름"
          className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-body sm:w-56 sm:flex-none"
        />
        <button
          type="button"
          onClick={() => create.mutate()}
          disabled={!newName.trim() || create.isPending}
          className="shrink-0 rounded-xl bg-slate-900 px-4 py-2 text-caption font-medium whitespace-nowrap text-white hover:bg-slate-800 disabled:opacity-40"
        >
          추가
        </button>
      </div>

      {/* 휴대폰은 한 상자 안에 줄로 잇는다 — 한 명마다 상자를 두면 열몇 명이 두 화면을 넘는다 */}
      <div className="grid gap-2 max-sm:gap-0 max-sm:overflow-hidden max-sm:rounded-2xl max-sm:border max-sm:border-slate-200 max-sm:bg-white sm:grid-cols-2 lg:grid-cols-3">
        {operators.map((op) => {
          const count = usage ? (usage[op.id] ?? 0) : null;
          return (
            <div
              key={op.id}
              className={`flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 max-sm:rounded-none max-sm:border-x-0 max-sm:border-t-0 max-sm:py-1 max-sm:last:border-b-0 ${
                op.archived ? 'opacity-50' : ''
              }`}
            >
              <input
                key={op.name}
                defaultValue={op.name}
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  if (next && next !== op.name) update.mutate({ id: op.id, patch: { name: next } });
                }}
                className="w-0 min-w-0 flex-1 rounded-md px-2 py-2 text-body outline-none focus:bg-sky-50 focus:ring-2 focus:ring-sky-400"
              />
              {/* 이 기사님이 마지막으로 일한 달의 작업일보로 넘어간다 (건수는 지금까지 전부) */}
              {count ? (
                <Link
                  to={ledgerLink(op.id, last?.[op.id])}
                  className="tap inline-flex shrink-0 items-center rounded-xl border border-slate-300 px-3 py-2 text-caption whitespace-nowrap tabular hover:bg-slate-50"
                >
                  {count}건 보기
                </Link>
              ) : (
                <span className="shrink-0 text-caption text-slate-600 tabular">
                  {count == null ? <Pending unit="건" /> : `${count}건`}
                </span>
              )}
              <button
                type="button"
                onClick={() => update.mutate({ id: op.id, patch: { archived: op.archived ? 0 : 1 } })}
                className="shrink-0 rounded-xl border border-slate-300 px-3 py-2 text-caption hover:bg-slate-50"
              >
                {op.archived ? '되살리기' : '숨김'}
              </button>
              {count === 0 && (
                <button
                  type="button"
                  onClick={() => confirm(`'${op.name}' 을 지울까요?`) && remove.mutate(op.id)}
                  className="shrink-0 rounded-xl border border-rose-200 px-3 py-2 text-caption text-rose-700 hover:bg-rose-50 sm:ml-2"
                >
                  삭제
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
