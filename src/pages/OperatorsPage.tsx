import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { payRows } from '../../shared/operatorPay';
import { api } from '../lib/api';
import { today } from '../lib/format';
import { useViewing } from '../lib/presence';
import { PageLoading } from '../components/Loading';
import PageTitle from '../components/PageTitle';
import StaffBox from '../components/operators/StaffBox';
import MonthPayBox from '../components/operators/MonthPayBox';
import OtBox from '../components/operators/OtBox';
import OtherOperators from '../components/operators/OtherOperators';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * 기사님 — 우리 기사님(김·이·박)의 월급과 달마다 줬는지, 한 건씩 적는 야간수당, 그리고 다른 사장님(외주) 이름 관리.
 * 통계의 「기사님 월급」 상자에서 달을 눌러 오면 그 달이 열린다 (/operators?month=2026-09).
 */
export default function OperatorsPage() {
  useViewing('operators', '기사님');
  const thisMonth = today().slice(0, 7);
  const [params, setParams] = useSearchParams();
  const asked = params.get('month') ?? '';
  const month = MONTH.test(asked) ? asked : thisMonth;
  const [error, setError] = useState<string | null>(null);

  const masters = useQuery({ queryKey: ['masters'], queryFn: api.masters });
  const usage = useQuery({ queryKey: ['usage'], queryFn: api.usage });
  const pay = useQuery({ queryKey: ['operatorPay'], queryFn: () => api.operatorPay() });

  if (masters.isPending || pay.isPending) return <PageLoading />;
  const failed = masters.error ?? pay.error;
  if (failed) return <p className="text-rose-600">{failed.message}</p>;

  const operators = masters.data!.operators;
  const staff = operators.filter((o) => o.is_staff);
  const others = operators.filter((o) => !o.is_staff);
  const { salaries, pays, ots } = pay.data!;
  const rows = payRows(staff, salaries, pays, month);

  return (
    <>
      <PageTitle>기사님</PageTitle>
      {error && (
        <p className="mb-4 anim-reveal rounded-xl bg-rose-50 px-4 py-3 text-caption text-rose-700">
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-3 text-rose-600">
            닫기
          </button>
        </p>
      )}

      <div className="mb-4 grid items-start gap-4 lg:grid-cols-[2fr_3fr]">
        <StaffBox
          staff={staff}
          others={others.filter((o) => !o.archived)}
          salaries={salaries}
          thisMonth={thisMonth}
          onError={setError}
        />
        <MonthPayBox
          month={month}
          thisMonth={thisMonth}
          rows={rows}
          onMonth={(next) => setParams(next === thisMonth ? {} : { month: next }, { replace: true })}
          onError={setError}
        />
      </div>

      <OtBox operators={operators} ots={ots} onError={setError} />

      <h2 className="mb-4 text-body font-bold text-slate-900">다른 사장님</h2>
      <OtherOperators operators={others} usage={usage.data?.operators} last={usage.data?.operatorLast} />
    </>
  );
}
