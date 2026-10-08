import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Operator, OperatorOt } from '../../../shared/types';
import { api } from '../../lib/api';
import { shortDate, today, won } from '../../lib/format';
import { shortDay, toAmount } from './payFormat';

const inputClass =
  'min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2 text-body outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200';
const lineButtonClass = 'min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-caption whitespace-nowrap hover:bg-slate-50';

/**
 * 야간수당 — 월급과 따로, 한 건씩 적고 건마다 「줬음」을 누른다 (2026-10-06 사용자 결정: 달마다 모으지 않는다).
 * 처음에는 아직 안 준 것만 달과 상관없이 모두 보이고, 「준 것도 보기」로 전부 본다.
 * 준 건은 고치거나 지우지 못한다 — 「되돌리기」로 푼 뒤에 한다.
 */
export default function OtBox({
  operators,
  ots,
  onError,
}: {
  /** 모든 기사님 — 적는 칸에는 우리 기사님만 나오고, 이름은 옮겨 간 분의 옛 줄에도 쓴다 */
  operators: Operator[];
  ots: OperatorOt[];
  onError: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const staff = operators.filter((o) => o.is_staff);
  const [showPaid, setShowPaid] = useState(false);
  const [operatorId, setOperatorId] = useState('');
  const [workDate, setWorkDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const value = toAmount(amount);
  const chosen = operatorId || (staff.length === 1 ? String(staff[0].id) : '');

  const invalidate = () => queryClient.invalidateQueries();
  const fail = (e: Error) => onError(e.message);
  const add = useMutation({
    mutationFn: () => api.addOperatorOt({ operator_id: Number(chosen), work_date: workDate, amount: value ?? 0, note: note.trim() || null }),
    onSuccess: () => {
      setAmount('');
      setNote('');
      return invalidate();
    },
    onError: fail,
  });
  const update = useMutation({
    mutationFn: (v: { id: number; body: { amount?: number; paid_date?: string | null } }) => api.updateOperatorOt(v.id, v.body),
    onSuccess: invalidate,
    onError: fail,
  });
  const remove = useMutation({ mutationFn: (id: number) => api.deleteOperatorOt(id), onSuccess: invalidate, onError: fail });

  const nameOf = (id: number) => operators.find((o) => o.id === id)?.name ?? '';
  const unpaid = ots.filter((o) => !o.paid_date).reduce((sum, o) => sum + o.amount, 0);
  const paidCount = ots.filter((o) => o.paid_date).length;
  const shown = showPaid ? ots : ots.filter((o) => !o.paid_date);
  const canAdd = !!chosen && !!workDate && !!value && !add.isPending;

  /** 금액 칸 — 칸을 벗어나면 저장한다. 준 건은 글자로만 보인다 */
  const amountCell = (o: OperatorOt) =>
    o.paid_date ? (
      <span className="tabular text-slate-900">{won(o.amount)}원</span>
    ) : (
      <input
        key={`${o.id}-${o.amount}`}
        defaultValue={won(o.amount)}
        aria-label={`${nameOf(o.operator_id)} ${shortDate(o.work_date)} 야간수당`}
        inputMode="numeric"
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        onBlur={(e) => {
          const next = toAmount(e.target.value);
          if (!next) {
            e.target.value = won(o.amount);
            onError('야간수당 금액은 숫자로 적어 주세요.');
          } else if (next !== o.amount) {
            update.mutate({ id: o.id, body: { amount: next } });
          }
        }}
        className={`${inputClass} w-28 text-right font-medium tabular text-rose-700`}
      />
    );

  const paidCell = (o: OperatorOt) =>
    o.paid_date ? (
      <span className="inline-flex items-center gap-2">
        <span className="font-medium whitespace-nowrap text-emerald-800">{shortDay(o.paid_date)} 줌</span>
        <button
          type="button"
          disabled={update.isPending}
          onClick={() => update.mutate({ id: o.id, body: { paid_date: null } })}
          className={lineButtonClass}
        >
          되돌리기
        </button>
      </span>
    ) : (
      <span className="inline-flex items-center gap-2">
        <button
          type="button"
          disabled={update.isPending}
          onClick={() => update.mutate({ id: o.id, body: { paid_date: today() } })}
          className="min-h-11 rounded-xl bg-slate-900 px-4 py-2 text-caption font-medium whitespace-nowrap text-white hover:bg-slate-800 disabled:opacity-40"
        >
          줬음
        </button>
        <button
          type="button"
          disabled={remove.isPending}
          onClick={() =>
            confirm(`${nameOf(o.operator_id)} ${shortDate(o.work_date)} 야간수당 ${won(o.amount)}원을 지울까요?`) && remove.mutate(o.id)
          }
          className="min-h-11 rounded-xl border border-rose-200 bg-white px-3 py-2 text-caption whitespace-nowrap text-rose-700 hover:bg-rose-50"
        >
          지우기
        </button>
      </span>
    );

  return (
    <section className="mb-4 min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-body font-bold text-slate-900">야간수당</h2>
        {ots.length > 0 && (
          <span className={`text-caption font-medium tabular ${unpaid ? 'text-rose-700' : 'text-emerald-800'}`}>
            {unpaid ? `아직 안 준 돈 ${won(unpaid)}원` : '모두 줌'}
          </span>
        )}
        {paidCount > 0 && (
          <button type="button" onClick={() => setShowPaid(!showPaid)} aria-pressed={showPaid} className={`ml-auto ${lineButtonClass}`}>
            {showPaid ? '안 준 것만 보기' : `준 것도 보기 (${paidCount}건)`}
          </button>
        )}
      </div>

      {staff.length > 0 && (
        <div className="mb-4 grid grid-cols-[2fr_3fr] items-end gap-2 rounded-xl bg-slate-50 p-3 sm:flex sm:flex-wrap">
          <label className="min-w-0">
            <span className="mb-1 block text-caption text-slate-600">기사님</span>
            <select value={chosen} onChange={(e) => setOperatorId(e.target.value)} className={`${inputClass} w-full sm:w-32`}>
              {staff.length > 1 && <option value="">고르기</option>}
              {staff.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0">
            <span className="mb-1 block text-caption text-slate-600">날짜</span>
            <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} className={`${inputClass} w-full tabular sm:w-auto`} />
          </label>
          <label className="min-w-0">
            <span className="mb-1 block text-caption text-slate-600">금액</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && canAdd && add.mutate()}
              inputMode="numeric"
              placeholder="100,000"
              className={`${inputClass} w-full text-right tabular sm:w-32`}
            />
          </label>
          <label className="min-w-0 sm:flex-1">
            <span className="mb-1 block text-caption text-slate-600">메모</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && canAdd && add.mutate()}
              maxLength={100}
              className={`${inputClass} w-full sm:min-w-32`}
            />
          </label>
          <button
            type="button"
            disabled={!canAdd}
            onClick={() => add.mutate()}
            className="col-span-2 min-h-11 rounded-xl bg-slate-900 px-4 py-2 text-caption font-medium whitespace-nowrap text-white hover:bg-slate-800 disabled:opacity-40"
          >
            추가
          </button>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="py-8 text-center text-caption text-slate-500">
          {staff.length === 0 ? '우리 기사님이 없습니다.' : ots.length ? '안 준 야간수당이 없습니다.' : '적은 야간수당이 없습니다.'}
        </p>
      ) : (
        <>
          {/* 휴대폰: 건마다 두 줄 — 윗줄에 날짜·이름·메모, 아랫줄에 금액과 「줬음」 */}
          <ul className="divide-y divide-slate-100 sm:hidden">
            {shown.map((o) => (
              <li key={o.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-baseline gap-2">
                  <span className="shrink-0 tabular text-slate-600">{shortDate(o.work_date)}</span>
                  <span className="shrink-0 font-bold text-slate-900">{nameOf(o.operator_id)}</span>
                  <span className="min-w-0 truncate text-caption text-slate-600">{o.note}</span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  {amountCell(o)}
                  <span className="ml-auto">{paidCell(o)}</span>
                </div>
              </li>
            ))}
          </ul>

          <div className="-mx-4 -mb-4 overflow-x-auto border-t border-slate-200 max-sm:hidden">
            <table className="w-full whitespace-nowrap text-left text-caption [&_td]:px-3 [&_th]:px-3 [&_td:first-child]:pl-4 [&_th:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:last-child]:pr-4">
              <thead>
                <tr className="h-11 border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="font-medium">날짜</th>
                  <th className="font-medium">기사님</th>
                  <th className="w-full font-medium">메모</th>
                  <th className="text-right font-medium">금액</th>
                  <th className="text-right font-medium">줬는지</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((o) => (
                  <tr key={o.id} className="h-14">
                    <td className="tabular text-slate-700">{o.work_date}</td>
                    <td className="font-bold text-slate-900">{nameOf(o.operator_id)}</td>
                    <td className="max-w-0 truncate text-slate-700">{o.note}</td>
                    <td className="text-right">{amountCell(o)}</td>
                    <td className="text-right">{paidCell(o)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
