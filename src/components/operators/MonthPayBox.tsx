import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PayRow } from '../../../shared/operatorPay';
import { shiftMonth } from '../../../shared/operatorPay';
import { api } from '../../lib/api';
import { today, won } from '../../lib/format';
import { monthLabel, shortDay } from './payFormat';

const stepButtonClass = 'min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-caption whitespace-nowrap hover:bg-slate-50';

/**
 * 그 달 우리 기사님의 월급 — 주고 나면 「줬음」을 누른다. 준 달은 그때 금액으로 굳는다.
 * 야간수당은 달과 상관없이 한 건씩이라 여기 넣지 않는다 (OtBox).
 */
export default function MonthPayBox({
  month,
  thisMonth,
  rows,
  onMonth,
  onError,
}: {
  month: string;
  thisMonth: string;
  rows: PayRow[];
  onMonth: (month: string) => void;
  onError: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (v: { operatorId: number; body: { paid_date: string | null } }) =>
      api.setOperatorPay(v.operatorId, month, v.body),
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (e: Error) => onError(e.message),
  });

  const total = rows.reduce((sum, r) => sum + r.salary, 0);
  const unpaid = rows.reduce((sum, r) => sum + (r.paidDate ? 0 : r.salary), 0);

  const paidCell = (r: PayRow) =>
    r.paidDate ? (
      <span className="inline-flex items-center gap-2">
        <span className="font-medium whitespace-nowrap text-emerald-800">{shortDay(r.paidDate)} 줌</span>
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => save.mutate({ operatorId: r.operatorId, body: { paid_date: null } })}
          className="min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-caption whitespace-nowrap hover:bg-slate-50"
        >
          되돌리기
        </button>
      </span>
    ) : (
      <button
        type="button"
        disabled={r.salary === 0 || save.isPending}
        onClick={() => save.mutate({ operatorId: r.operatorId, body: { paid_date: today() } })}
        className="min-h-11 rounded-xl bg-slate-900 px-4 py-2 text-caption font-medium whitespace-nowrap text-white hover:bg-slate-800 disabled:opacity-40"
      >
        줬음
      </button>
    );

  const salaryText = (r: PayRow) => (r.salary ? `${won(r.salary)}원` : '월급 안 정함');
  /** 아직 안 준 월급만 빨갛게 */
  const amountClass = (r: PayRow) => (!r.salary ? 'text-slate-600' : r.paidDate ? 'text-slate-900' : 'font-medium text-rose-700');

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-body font-bold text-slate-900">{monthLabel(month)} 월급</h2>
        <div className="flex w-full justify-between gap-2 sm:ml-auto sm:w-auto sm:justify-start">
          <button type="button" onClick={() => onMonth(shiftMonth(month, -1))} className={stepButtonClass}>
            ‹ 지난 달
          </button>
          <button type="button" onClick={() => onMonth(thisMonth)} className={stepButtonClass}>
            이번 달
          </button>
          <button type="button" onClick={() => onMonth(shiftMonth(month, 1))} className={stepButtonClass}>
            다음 달 ›
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-caption text-slate-500">우리 기사님이 없습니다.</p>
      ) : (
        <>
          {/* 휴대폰: 기사님마다 한 줄 — 이름, 월급, 「줬음」 */}
          <ul className="divide-y divide-slate-100 sm:hidden">
            {rows.map((r) => (
              <li key={r.operatorId} className="flex items-center gap-2 py-2 first:pt-0">
                <span className="min-w-0 truncate font-bold text-slate-900">{r.name}</span>
                <span className={`ml-auto shrink-0 tabular ${amountClass(r)}`}>{salaryText(r)}</span>
                <span className="shrink-0">{paidCell(r)}</span>
              </li>
            ))}
          </ul>

          <div className="-mx-4 overflow-x-auto border-t border-slate-200 max-sm:hidden">
            <table className="w-full whitespace-nowrap text-left text-caption [&_td]:px-3 [&_th]:px-3 [&_td:first-child]:pl-4 [&_th:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:last-child]:pr-4">
              <thead>
                <tr className="h-11 border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="font-medium">기사님</th>
                  <th className="text-right font-medium">월급</th>
                  <th className="text-right font-medium">줬는지</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.operatorId} className="h-14">
                    <td className="font-bold text-slate-900">{r.name}</td>
                    <td className={`text-right tabular ${amountClass(r)}`}>{salaryText(r)}</td>
                    <td className="text-right">{paidCell(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <dl className="-mx-4 -mb-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-slate-200 bg-slate-50 px-4 py-3 text-caption tabular">
            <div className="flex gap-2">
              <dt className="text-slate-600">합계</dt>
              <dd className="font-medium text-slate-900">{won(total)}원</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-slate-600">아직 안 준 돈</dt>
              <dd className={`font-medium ${unpaid ? 'text-rose-700' : 'text-emerald-800'}`}>
                {unpaid ? `${won(unpaid)}원` : total ? '모두 줌' : '0원'}
              </dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}
