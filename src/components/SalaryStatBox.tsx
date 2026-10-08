import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { payMonths } from '../../shared/operatorPay';
import { api } from '../lib/api';
import { today, won } from '../lib/format';

/**
 * 통계의 「기사님 월급」 — 고른 기간의 달마다 우리 기사님께 줄 돈(월급 + 그 달에 일한 야간수당)과 아직 안 준 돈.
 * 고치는 곳은 기사님 화면이라, 달을 누르면 그 달의 기사님 화면으로 간다.
 */
export default function SalaryStatBox({ from, to, className = '' }: { from: string; to: string; className?: string }) {
  const masters = useQuery({ queryKey: ['masters'], queryFn: api.masters });
  const pay = useQuery({ queryKey: ['operatorPay'], queryFn: () => api.operatorPay() });
  if (!masters.data || !pay.data) return null;

  const staff = masters.data.operators.filter((o) => o.is_staff);
  const months = payMonths(staff, pay.data.salaries, pay.data.pays, pay.data.ots, from.slice(0, 7), to.slice(0, 7), today().slice(0, 7));
  // 표의 칸은 그 기간에 줄 돈이 있는 기사님만
  const columns = staff.filter((op) => months.some((m) => m.rows.some((r) => r.operatorId === op.id)));
  const unpaid = months.reduce((sum, m) => sum + m.unpaid, 0);
  const total = months.reduce((sum, m) => sum + m.total, 0);

  return (
    <div className={`min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 ${className}`}>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-body font-bold text-slate-900">기사님 월급</h2>
        {months.length > 0 && (
          <span className="text-caption tabular text-slate-600 max-sm:order-last max-sm:w-full">
            합계 {won(total)}원
            {unpaid > 0 ? (
              <span className="ml-3 font-medium max-sm:ml-0 max-sm:block text-rose-700">아직 안 준 돈 {won(unpaid)}원</span>
            ) : (
              <span className="ml-3 font-medium max-sm:ml-0 max-sm:block text-emerald-800">모두 줌</span>
            )}
          </span>
        )}
        <Link
          to="/operators"
          className="ml-auto inline-flex shrink-0 items-center rounded-xl border border-slate-300 px-3 py-2 text-caption font-medium whitespace-nowrap text-slate-700 hover:bg-slate-50 active:bg-slate-100"
        >
          월급 고치기
        </Link>
      </div>

      {months.length === 0 ? (
        <p className="py-8 text-center text-caption text-slate-500">
          {pay.data.salaries.length || pay.data.ots.length ? '해당 기간에 줄 돈이 없습니다.' : '월급을 아직 정하지 않았습니다.'}
        </p>
      ) : (
        <>
          {/* 휴대폰: 달마다 두 줄. 줄을 누르면 그 달의 기사님 화면으로 간다 */}
          <ul className="divide-y divide-slate-100 sm:hidden">
            {months.map((m) => (
              <li key={m.month} className="py-2.5 first:pt-0 last:pb-0">
                <Link to={`/operators?month=${m.month}`} className="-mx-2 block rounded-lg px-2 transition-colors duration-150 active:bg-slate-100">
                  <div className="flex items-baseline gap-2">
                    <span className="font-bold whitespace-nowrap text-slate-900">{m.month}</span>
                    <span className="ml-auto shrink-0 font-medium text-slate-900 tabular">{won(m.total)}원</span>
                  </div>
                  <dl className="mt-1.5 flex flex-wrap gap-x-4 text-caption tabular">
                    {m.rows.map((r) => (
                      <div key={r.operatorId} className="flex gap-1.5">
                        <dt className="text-slate-600">{r.name}</dt>
                        <dd className="text-slate-900">{won(r.total)}원</dd>
                      </div>
                    ))}
                    <div className="flex gap-1.5">
                      <dt className="text-slate-600">{m.unpaid ? '안 준 돈' : ''}</dt>
                      <dd className={`font-medium ${m.unpaid ? 'text-rose-700' : 'text-emerald-800'}`}>
                        {m.unpaid ? `${won(m.unpaid)}원` : '모두 줌'}
                      </dd>
                    </div>
                  </dl>
                </Link>
              </li>
            ))}
          </ul>

          <div className="-mx-4 -mb-4 overflow-x-auto border-t border-slate-200 max-sm:hidden">
            <table className="w-full whitespace-nowrap text-left text-caption [&_td]:px-3 [&_th]:px-3 [&_td:first-child]:pl-4 [&_th:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:last-child]:pr-4">
              <thead>
                <tr className="h-11 border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="font-medium">월</th>
                  {columns.map((op) => (
                    <th key={op.id} className="text-right font-medium">
                      {op.name}
                    </th>
                  ))}
                  <th className="text-right font-medium">합계</th>
                  <th className="text-right font-medium">아직 안 준 돈</th>
                  <th className="text-right font-medium">기사님</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {months.map((m) => (
                  <tr key={m.month} className="h-12 hover:bg-slate-50">
                    <td className="font-bold text-slate-900">{m.month}</td>
                    {columns.map((op) => {
                      const row = m.rows.find((r) => r.operatorId === op.id);
                      return (
                        <td key={op.id} className="text-right tabular text-slate-700">
                          {row ? `${won(row.total)}원` : '-'}
                        </td>
                      );
                    })}
                    <td className="text-right font-medium tabular text-slate-900">{won(m.total)}원</td>
                    <td className={`text-right font-medium tabular ${m.unpaid ? 'text-rose-700' : 'text-emerald-800'}`}>
                      {m.unpaid ? `${won(m.unpaid)}원` : '모두 줌'}
                    </td>
                    <td className="text-right">
                      <Link
                        to={`/operators?month=${m.month}`}
                        className="inline-flex items-center rounded-xl border border-slate-300 px-3 py-1 text-caption font-medium whitespace-nowrap text-slate-700 hover:bg-slate-50 active:bg-slate-100"
                      >
                        열기
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
