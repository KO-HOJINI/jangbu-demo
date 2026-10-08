import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Operator, OperatorSalary } from '../../../shared/types';
import { salaryFor } from '../../../shared/operatorPay';
import { api } from '../../lib/api';
import { manwon, won } from '../../lib/format';
import Fold from '../Fold';
import { monthLabel, toAmount } from './payFormat';

const inputClass =
  'min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-body outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200';
const lineButtonClass = 'min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-caption whitespace-nowrap hover:bg-slate-50';

/**
 * 우리 기사님(월급을 주는 분) 상자 — 지금 월급을 보이고, 「월급 바꾸기」로 「몇 월부터 얼마」를 적는다.
 * 지난달 통계는 그때 금액 그대로여야 해서, 고치지 않고 새 줄을 쌓는다 (같은 달을 또 적으면 그 달 금액만 바뀐다).
 */
export default function StaffBox({
  staff,
  others,
  salaries,
  thisMonth,
  onError,
}: {
  staff: Operator[];
  /** 우리 기사님으로 옮길 수 있는 이름 (숨기지 않은 다른 사장님) */
  others: Operator[];
  salaries: OperatorSalary[];
  thisMonth: string;
  onError: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<number | null>(null);
  const [moveId, setMoveId] = useState('');

  const move = useMutation({
    mutationFn: (v: { id: number; is_staff: number }) => api.updateOperator(v.id, { is_staff: v.is_staff }),
    onSuccess: () => {
      setMoveId('');
      setOpenId(null);
      return queryClient.invalidateQueries();
    },
    onError: (e: Error) => onError(e.message),
  });

  return (
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="mb-4 text-body font-bold text-slate-900">우리 기사님</h2>

      {staff.length === 0 && <p className="mb-4 text-caption text-slate-600">아직 없습니다. 아래에서 이름을 골라 옮겨 주세요.</p>}

      <ul className="divide-y divide-slate-100">
        {staff.map((op) => {
          const now = salaryFor(salaries, op.id, thisMonth);
          const open = openId === op.id;
          return (
            <li key={op.id} className="py-2 first:pt-0">
              <div className="flex items-center gap-3">
                <span className="min-w-0 truncate font-bold text-slate-900">{op.name}</span>
                <span className={`ml-auto shrink-0 tabular ${now ? 'text-slate-900' : 'text-slate-600'}`}>
                  {now ? `${won(now)}원` : '월급 안 정함'}
                </span>
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : op.id)}
                  aria-expanded={open}
                  className={`shrink-0 ${lineButtonClass}`}
                >
                  {open ? '닫기' : '월급 바꾸기'}
                </button>
              </div>
              <Fold open={open}>
                <SalaryForm
                  operator={op}
                  salaries={salaries.filter((s) => s.operator_id === op.id)}
                  thisMonth={thisMonth}
                  onError={onError}
                  onMoveOut={() =>
                    confirm(`'${op.name}' 을 다른 사장님으로 옮길까요? 적어 둔 월급은 그대로 남습니다.`) &&
                    move.mutate({ id: op.id, is_staff: 0 })
                  }
                />
              </Fold>
            </li>
          );
        })}
      </ul>

      {others.length > 0 && (
        <div className="mt-4 flex gap-2 border-t border-slate-100 pt-4">
          <select
            value={moveId}
            onChange={(e) => setMoveId(e.target.value)}
            aria-label="우리 기사님으로 옮길 이름"
            className={`${inputClass} min-w-0 flex-1 sm:w-56 sm:flex-none`}
          >
            <option value="">이름 고르기</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!moveId || move.isPending}
            onClick={() => move.mutate({ id: Number(moveId), is_staff: 1 })}
            className={`shrink-0 ${lineButtonClass} disabled:opacity-40`}
          >
            우리 기사님으로
          </button>
        </div>
      )}
    </section>
  );
}

function SalaryForm({
  operator,
  salaries,
  thisMonth,
  onError,
  onMoveOut,
}: {
  operator: Operator;
  salaries: OperatorSalary[];
  thisMonth: string;
  onError: (message: string) => void;
  onMoveOut: () => void;
}) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [fromMonth, setFromMonth] = useState(thisMonth);
  const value = toAmount(amount);

  const invalidate = () => queryClient.invalidateQueries();
  const save = useMutation({
    mutationFn: () => api.setSalary(operator.id, { from_month: fromMonth, amount: value ?? 0 }),
    onSuccess: () => {
      setAmount('');
      return invalidate();
    },
    onError: (e: Error) => onError(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteSalary(id),
    onSuccess: invalidate,
    onError: (e: Error) => onError(e.message),
  });

  return (
    <div className="mt-2 rounded-xl bg-slate-50 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 sm:flex-none">
          <span className="mb-1 block text-caption text-slate-600">한 달 월급</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && value != null && save.mutate()}
            inputMode="numeric"
            placeholder="3,000,000"
            className={`${inputClass} w-full bg-white text-right tabular sm:w-40`}
          />
        </label>
        <label>
          <span className="mb-1 block text-caption text-slate-600">언제부터</span>
          <input
            type="month"
            value={fromMonth}
            onChange={(e) => setFromMonth(e.target.value)}
            className={`${inputClass} bg-white tabular`}
          />
        </label>
        <button
          type="button"
          disabled={value == null || !fromMonth || save.isPending}
          onClick={() => save.mutate()}
          className="min-h-11 rounded-xl bg-slate-900 px-4 py-2 text-caption font-medium whitespace-nowrap text-white hover:bg-slate-800 disabled:opacity-40"
        >
          저장
        </button>
      </div>
      {/* 0 을 하나 더 치거나 덜 친 것을 알아보게 만 단위로 읽어 준다 */}
      {value ? <p className="mt-1 text-caption text-slate-600">{manwon(value)}</p> : null}

      {salaries.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-200 border-t border-slate-200">
          {[...salaries].reverse().map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-1 text-caption">
              <span className="text-slate-600">{monthLabel(s.from_month)}부터</span>
              <span className="ml-auto tabular text-slate-900">{won(s.amount)}원</span>
              <button
                type="button"
                onClick={() => confirm(`${monthLabel(s.from_month)}부터 ${won(s.amount)}원을 지울까요?`) && remove.mutate(s.id)}
                className="min-h-11 shrink-0 rounded-xl border border-rose-200 bg-white px-3 py-2 text-caption text-rose-700 hover:bg-rose-50"
              >
                지우기
              </button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" onClick={onMoveOut} className={`mt-3 bg-white ${lineButtonClass}`}>
        다른 사장님으로 옮기기
      </button>
    </div>
  );
}
