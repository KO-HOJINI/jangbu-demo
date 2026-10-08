import { Children, useState, useMemo, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { DashboardClientStat } from '../../shared/types';
import { ALERT_FROM } from '../../shared/issueDue';
import { api } from '../lib/api';
import { won, today, monthRange, shiftMonthRange } from '../lib/format';
import { useViewing } from '../lib/presence';
import { useMarker } from '../lib/useMarker';
import { PresenceBadge } from '../components/Presence';
import { Loading } from '../components/Loading';
import ScrollBox from '../components/ScrollBox';
import Fold from '../components/Fold';
import SalaryStatBox from '../components/SalaryStatBox';

type PeriodPreset = 'this_month' | 'last_month' | 'last_3_months' | 'year' | 'all' | 'custom';

export default function DashboardPage() {
  useViewing('dashboard', '통계');

  const todayIso = today();
  const currentYear = todayIso.slice(0, 4);

  // 처음에는 이번 달 — 평소 궁금한 것은 이번 달에 얼마 했고 얼마 받을지다 (2026-10-05 사용자 결정)
  const [preset, setPreset] = useState<PeriodPreset>('this_month');

  const [presetsRef, presetMarker] = useMarker<HTMLDivElement>('button[aria-pressed="true"]', preset);
  const [from, setFrom] = useState(() => monthRange(todayIso)[0]);
  const [to, setTo] = useState(() => monthRange(todayIso)[1]);

  const selectPreset = (p: PeriodPreset) => {
    setPreset(p);
    if (p === 'this_month') {
      const [start, end] = monthRange(todayIso);
      setFrom(start);
      setTo(end);
    } else if (p === 'last_month') {
      const [start, end] = shiftMonthRange(todayIso, -1);
      setFrom(start);
      setTo(end);
    } else if (p === 'last_3_months') {
      const [start] = shiftMonthRange(todayIso, -2);
      const [, end] = monthRange(todayIso);
      setFrom(start);
      setTo(end);
    } else if (p === 'year') {
      setFrom(`${currentYear}-01-01`);
      setTo(`${currentYear}-12-31`);
    } else if (p === 'all') {
      setFrom('2020-01-01');
      setTo('2030-12-31');
    }
  };

  // 기간을 바꾸는 동안에는 앞 기간의 숫자를 흐리게 남겨 둔다 — 화면이 비었다가 다시 차면 눈이 자리를 잃는다
  const { data, isPending, isPlaceholderData, error } = useQuery({
    queryKey: ['dashboard', from, to],
    queryFn: () => api.dashboard({ from, to }),
    placeholderData: keepPreviousData,
  });

  // 규격(Boom)별 최대 매출 (비율 막대 기준)
  const maxBoomSupply = useMemo(() => {
    if (!data?.byBoomSize?.length) return 1;
    return Math.max(...data.byBoomSize.map((b) => b.supplyAmount), 1);
  }, [data?.byBoomSize]);

  // 기사님별 최대 매출
  const maxOperatorSupply = useMemo(() => {
    if (!data?.byOperator?.length) return 1;
    return Math.max(...data.byOperator.map((o) => o.supplyAmount), 1);
  }, [data?.byOperator]);

  // 휴대폰 규격 목록은 다섯 줄만 먼저 보이므로 많이 번 규격부터 (PC 표는 작은 규격부터 그대로)
  const phoneBooms = useMemo(
    () => [...(data?.byBoomSize ?? [])].sort((a, b) => b.supplyAmount - a.supplyAmount),
    [data?.byBoomSize]
  );

  // 월별 최대 매출
  const maxMonthSupply = useMemo(() => {
    if (!data?.byMonth?.length) return 1;
    return Math.max(...data.byMonth.map((m) => m.supplyAmount), 1);
  }, [data?.byMonth]);

  const controlClass =
    'rounded-xl border border-slate-300 bg-white px-3 py-2 text-caption text-slate-800 focus:border-slate-500 focus:outline-none';

  return (
    <div className="space-y-6 lg:space-y-4">
      {/* 1. 상단 타이틀 및 기간 선택 바 */}
      {/* 휴대폰에서는 기간 줄이 화면 위에 붙어 있게, 이 묶음과 아래 묶음을 풀어(contents) 긴 내용과 같은 상자에 둔다 */}
      <div className="flex flex-wrap items-center justify-between gap-4 max-lg:contents">
        <div className="flex min-h-11 items-center max-lg:mb-1">
          <h1 className="text-title font-bold tracking-tight text-slate-900">통계</h1>
          <PresenceBadge className="ml-auto flex lg:hidden" />
        </div>

        {/* 기간 컨트롤 그룹 */}
        <div className="flex flex-wrap items-center gap-2 max-lg:contents">
          {/* 빠른 프리셋 — PC 는 회색 상자 안의 흰 상자, 옆 날짜 칸과 같은 높이(44px).
              휴대폰은 아래에 떠 있는 메뉴가 이미 알약 모양이라 밑줄로 표시하고, 내려 읽는 동안에도 화면 위에 붙어 있다.
              전역 「단추 44px」 규칙이 유틸리티보다 세서 단추에는 min-h-0! 로 적는다 */}
          <div
            ref={presetsRef}
            className="relative flex text-caption max-lg:sticky max-lg:top-0 max-lg:z-20 max-lg:-mx-4 max-lg:mb-3 max-lg:border-b max-lg:border-slate-200 max-lg:bg-slate-100 max-lg:px-4 lg:inline-flex lg:h-11 lg:rounded-xl lg:border lg:border-slate-200 lg:bg-slate-50 lg:p-1"
          >
            {/* 고른 기간 표시(PC 흰 상자, 휴대폰 밑줄) — 다른 기간을 누르면 미끄러져 간다. 날짜를 직접 고르면 사라진다.
                휴대폰에서는 칸을 글자 길이만큼 주고 남는 폭을 똑같이 나눈다 (똑같은 폭으로 나누면 긴 이름끼리 붙어 보인다) */}
            {presetMarker && <span aria-hidden="true" className="seg-marker" style={presetMarker} />}
            <button
              type="button"
              onClick={() => selectPreset('this_month')}
              aria-pressed={preset === 'this_month'}
              className={`relative flex-auto px-1 py-1.5 whitespace-nowrap transition lg:min-h-0! lg:flex-none lg:rounded-lg lg:px-2.5 lg:py-0 ${
                preset === 'this_month' ? 'font-medium text-slate-900' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              이번 달
            </button>
            <button
              type="button"
              onClick={() => selectPreset('last_month')}
              aria-pressed={preset === 'last_month'}
              className={`relative flex-auto px-1 py-1.5 whitespace-nowrap transition lg:min-h-0! lg:flex-none lg:rounded-lg lg:px-2.5 lg:py-0 ${
                preset === 'last_month' ? 'font-medium text-slate-900' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              지난 달
            </button>
            <button
              type="button"
              onClick={() => selectPreset('last_3_months')}
              aria-pressed={preset === 'last_3_months'}
              className={`relative flex-auto px-1 py-1.5 whitespace-nowrap transition lg:min-h-0! lg:flex-none lg:rounded-lg lg:px-2.5 lg:py-0 ${
                preset === 'last_3_months' ? 'font-medium text-slate-900' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              최근 3개월
            </button>
            <button
              type="button"
              onClick={() => selectPreset('year')}
              aria-pressed={preset === 'year'}
              className={`relative flex-auto px-1 py-1.5 whitespace-nowrap transition lg:min-h-0! lg:flex-none lg:rounded-lg lg:px-2.5 lg:py-0 ${
                preset === 'year' ? 'font-medium text-slate-900' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              올해 전체
            </button>
            <button
              type="button"
              onClick={() => selectPreset('all')}
              aria-pressed={preset === 'all'}
              className={`relative flex-auto px-1 py-1.5 whitespace-nowrap transition lg:min-h-0! lg:flex-none lg:rounded-lg lg:px-2.5 lg:py-0 ${
                preset === 'all' ? 'font-medium text-slate-900' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              전체
            </button>
          </div>

          {/* 직접 날짜 선택 */}
          <div className="flex items-center gap-1.5 max-lg:mb-6">
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPreset('custom');
              }}
              className={`${controlClass} min-w-0 flex-1 max-lg:text-body tabular lg:flex-none`}
            />
            <span className="text-slate-600">~</span>
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPreset('custom');
              }}
              className={`${controlClass} min-w-0 flex-1 max-lg:text-body tabular lg:flex-none`}
            />
          </div>
        </div>
      </div>

      {isPending && (
        <div className="grid h-64 place-items-center">
          <Loading />
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-caption text-rose-800">
          통계 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </div>
      )}

      {data && (
        <>
          {/* 2. 핵심 KPI 요약 카드 (가로 6단 배치) */}
          <div className={`dash-group grid grid-cols-2 gap-3 transition-opacity duration-200 sm:grid-cols-3 lg:grid-cols-6 ${isPlaceholderData ? 'opacity-50' : ''}`}>
            {/* 총 작업 건수 */}
            <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 lg:py-3">
              <span className="block text-caption font-medium text-slate-500">작업 건수</span>
              <div className="mt-1 whitespace-nowrap text-lead font-bold tabular tracking-tight sm:text-title text-slate-900">
                {won(data.kpi.workCount)}
                <span className="text-body font-normal text-slate-600">건</span>
              </div>
              {/* 두 값을 한 줄에 이어 쓰면 좁은 상자에서 금액 중간이 꺾인다. 이름은 왼쪽, 값은 오른쪽으로 한 줄씩 */}
              <dl className="mt-1 text-caption text-slate-600 tabular">
                <div className="flex justify-between gap-2">
                  <dt>타설</dt>
                  <dd className="whitespace-nowrap text-slate-900">{won(data.kpi.pourVolume)}m³</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>OT</dt>
                  <dd className="whitespace-nowrap text-slate-900">{data.kpi.otHours}시간</dd>
                </div>
              </dl>
            </div>

            {/* 총 공급가액 (매출) */}
            <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 lg:py-3">
              <span className="block text-caption font-medium text-slate-500">총 공급가액 (매출)</span>
              <div className="mt-1 whitespace-nowrap text-lead font-bold tabular tracking-tight sm:text-title text-slate-900">
                {won(data.kpi.supplyAmount)}
                <span className="text-body font-normal text-slate-600">원</span>
              </div>
              {/* 두 값을 한 줄에 이어 쓰면 좁은 상자에서 금액 중간이 꺾인다. 이름은 왼쪽, 값은 오른쪽으로 한 줄씩 */}
              <dl className="mt-1 text-caption text-slate-600 tabular">
                <div className="flex justify-between gap-2">
                  <dt className="shrink-0 whitespace-nowrap">기본</dt>
                  <dd className="whitespace-nowrap text-slate-900">{won(data.kpi.baseAmount)}원</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>OT</dt>
                  <dd className="whitespace-nowrap text-slate-900">{won(data.kpi.otAmount)}원</dd>
                </div>
              </dl>
            </div>

            {/* 주유비 지출 */}
            <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 lg:py-3">
              <span className="block text-caption font-medium text-slate-500">주유비 지출</span>
              <div className="mt-1 whitespace-nowrap text-lead font-bold tabular tracking-tight sm:text-title text-slate-900">
                {won(data.kpi.fuelAmount)}
                <span className="text-body font-normal text-slate-600">원</span>
              </div>
              <p className="mt-1 text-caption text-slate-600 tabular">
                매출 대비 {data.kpi.supplyAmount > 0 ? ((data.kpi.fuelAmount / data.kpi.supplyAmount) * 100).toFixed(1) : 0}%
              </p>
            </div>

            {/* 순매출 (공급가액 - 주유비) */}
            <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 lg:py-3">
              <span className="block text-caption font-medium text-slate-500">순매출 (매출-지출)</span>
              <div className="mt-1 whitespace-nowrap text-lead font-bold tabular tracking-tight sm:text-title text-slate-900">
                {won(data.kpi.netAmount)}
                <span className="text-body font-normal text-slate-600">원</span>
              </div>
              <p className="mt-1 text-caption text-slate-600 tabular">
                기타지출 {won(data.kpi.extraAmount)}원 차감
              </p>
            </div>

            {/* 미발행 금액 */}
            <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 lg:py-3">
              <span className="block text-caption font-medium text-slate-500">미발행 금액</span>
              <div className="mt-1 whitespace-nowrap text-lead font-bold tabular tracking-tight sm:text-title text-amber-700">
                {won(data.kpi.unbilledAmount)}
                <span className="text-body font-normal text-slate-600">원</span>
              </div>
              {/* 엑셀에서 옮겨 온 옛 장부는 명세표를 이미 냈으므로 세지 않는다 (서버의 UNBILLED_AMOUNT) */}
              <p className="mt-1 text-caption text-slate-600">{Number(ALERT_FROM.slice(5, 7))}월 작업부터 셉니다</p>
            </div>

            {/* 미수금 금액 */}
            <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 lg:py-3">
              <span className="block text-caption font-medium text-slate-500">미수금 금액</span>
              <div className="mt-1 whitespace-nowrap text-lead font-bold tabular tracking-tight sm:text-title text-rose-700">
                {won(data.kpi.unpaidAmount)}
                <span className="text-body font-normal text-slate-600">원</span>
              </div>
              <p className="mt-1 text-caption text-slate-600">발행 후 미입금 금액</p>
            </div>
          </div>

          {/* 휴대폰: 거래처별 매출과 받을 돈을 숫자 상자 바로 밑에 (PC 는 아래 월별 표 옆) */}
          <div className={`dash-group transition-opacity duration-200 [--base:6] lg:hidden ${isPlaceholderData ? 'opacity-50' : ''}`}>
            <ClientBox clients={data.byClient} phone />
          </div>

          {/* 3. 메인 섹션: 차량 규격(호기 M)별 vs 기사님별 실적 (PC 2열 그리드) */}
          <div className={`dash-group grid gap-4 transition-opacity duration-200 [--base:6] lg:grid-cols-2 ${isPlaceholderData ? 'opacity-50' : ''}`}>
            {/* 3-A. 차량 규격(붐길이 M)별 통계 */}
            <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-body font-bold text-slate-900">차량 규격(붐 M)별 실적</h2>
                </div>
                <span className="shrink-0 whitespace-nowrap text-caption text-slate-500">총 {data.byBoomSize.length}개 규격</span>
              </div>

              {/* 이 상자와 옆 기사님 상자는 PC 에서 높이를 맞춘다. 대시보드가 한 화면에 들어오게 표 높이는 창 높이를 따른다
                  — 넉넉하면 머리줄 + 여덟 줄, 좁으면 네 줄까지 줄고 넘치는 줄은 표 안에서 민다 (아래 월별 표는 두 줄까지) */}
              {data.byBoomSize.length === 0 ? (
                <p className="py-8 text-center text-caption text-slate-500">해당 기간의 규격별 작업이 없습니다.</p>
              ) : (
                <>
                {/* 휴대폰: 6열 표는 옆으로 밀어야 해서 규격마다 두 줄로 적는다 */}
                <PhoneList>
                  {phoneBooms.map((b) => (
                    <PhoneRow
                      key={b.label}
                      name={b.label}
                      count={b.count}
                      amount={b.supplyAmount}
                      ratio={b.supplyAmount / maxBoomSupply}
                      details={[
                        // 주유비율은 주유비 뒤 괄호로 — 따로 적으면 한 줄에 안 들어가 줄이 꺾였다
                        ['주유', `${won(b.fuelAmount)}원 (${b.fuelRatio}%)`],
                        ['건당', `${won(b.avgSupply)}원`],
                      ]}
                    />
                  ))}
                </PhoneList>
                <ScrollBox
                  className="-mx-4 -mb-4 border-t border-slate-200 [--scroll-head:44px] max-sm:hidden"
                  viewClassName="overflow-auto lg:max-h-[clamp(236px,calc(100dvh-582px),428px)]"
                >
                  <table className="w-full whitespace-nowrap [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50 [&_th]:shadow-[inset_0_-1px_0_var(--color-slate-200)] text-left text-caption [&_td]:px-3 [&_th]:px-3 [&_td:first-child]:pl-4 [&_th:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:last-child]:pr-4">
                    <thead>
                      <tr className="h-11 border-b border-slate-200 bg-slate-50 text-slate-600">
                        <th className="font-medium">규격</th>
                        <th className="text-right font-medium">건수</th>
                        <th className="text-right font-medium">공급가액</th>
                        <th className="text-right font-medium">주유비</th>
                        <th className="text-right font-medium">건당 평균</th>
                        <th className="text-right font-medium">주유비율</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.byBoomSize.map((b) => {
                        const ratio = Math.min(100, Math.round((b.supplyAmount / maxBoomSupply) * 100));
                        return (
                          <tr key={b.label} className="h-12 hover:bg-slate-50">
                            <td className="font-bold text-slate-900">
                              <div className="flex items-center gap-2">
                                {/* 이름 칸 폭을 고정해 막대가 모두 같은 자리에서 시작하게 한다 */}
                                <span className="w-12 shrink-0 truncate">{b.label}</span>
                                <div className="hidden h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-slate-100 sm:block">
                                  <div className="dash-bar h-full bg-slate-700" style={{ width: `${ratio}%` }} />
                                </div>
                              </div>
                            </td>
                            <td className="text-right tabular text-slate-700">{won(b.count)}건</td>
                            <td className="text-right font-medium tabular text-slate-900">
                              {won(b.supplyAmount)}원
                            </td>
                            <td className="text-right tabular text-slate-600">{won(b.fuelAmount)}원</td>
                            <td className="text-right tabular text-slate-700">{won(b.avgSupply)}원</td>
                            <td className="text-right tabular text-slate-500">{b.fuelRatio}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </ScrollBox>
                </>
              )}
            </div>

            {/* 3-B. 기사님별 실적 통계 */}
            <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-body font-bold text-slate-900">기사님별 작업 및 정산 실적</h2>
                </div>
                <span className="shrink-0 whitespace-nowrap text-caption text-slate-500">총 {data.byOperator.length}명</span>
              </div>

              {data.byOperator.length === 0 ? (
                <p className="py-8 text-center text-caption text-slate-500">해당 기간의 기사님별 작업이 없습니다.</p>
              ) : (
                <>
                {/* 휴대폰: 기사님마다 두 줄. 줄을 누르면 그 기사님의 작업일보로 간다 (단추를 따로 두면 줄마다 44px 씩 길어진다) */}
                <PhoneList>
                  {data.byOperator.map((op) => (
                    <PhoneRow
                      key={op.operatorName}
                      name={op.operatorName}
                      count={op.count}
                      amount={op.supplyAmount}
                      ratio={op.supplyAmount / maxOperatorSupply}
                      details={[
                        ['주유', `${won(op.fuelAmount)}원`],
                        ...(op.otHours > 0 ? ([['OT', `${op.otHours}시간`]] as [string, string][]) : []),
                      ]}
                      to={op.operatorId ? `/ledger?operatorId=${op.operatorId}&from=${from}&to=${to}` : undefined}
                      toLabel="작업 보기"
                    />
                  ))}
                </PhoneList>
                <ScrollBox
                  className="-mx-4 -mb-4 border-t border-slate-200 [--scroll-head:44px] max-sm:hidden"
                  viewClassName="overflow-auto lg:max-h-[clamp(236px,calc(100dvh-582px),428px)]"
                >
                  <table className="w-full whitespace-nowrap [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50 [&_th]:shadow-[inset_0_-1px_0_var(--color-slate-200)] text-left text-caption [&_td]:px-3 [&_th]:px-3 [&_td:first-child]:pl-4 [&_th:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:last-child]:pr-4">
                    <thead>
                      <tr className="h-11 border-b border-slate-200 bg-slate-50 text-slate-600">
                        <th className="font-medium">기사님</th>
                        <th className="text-right font-medium">건수</th>
                        <th className="text-right font-medium">공급가액</th>
                        <th className="text-right font-medium">주유비</th>
                        <th className="text-right font-medium">OT시간</th>
                        <th className="text-right font-medium">작업일보</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.byOperator.map((op) => {
                        const ratio = Math.min(100, Math.round((op.supplyAmount / maxOperatorSupply) * 100));
                        return (
                          <tr key={op.operatorName} className="h-12 hover:bg-slate-50">
                            <td className="font-bold text-slate-900">
                              <div className="flex items-center gap-2">
                                <span className="w-14 shrink-0 truncate" title={op.operatorName}>{op.operatorName}</span>
                                <div className="hidden h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-slate-100 sm:block">
                                  <div className="dash-bar h-full bg-slate-700" style={{ width: `${ratio}%` }} />
                                </div>
                              </div>
                            </td>
                            <td className="text-right tabular text-slate-700">{won(op.count)}건</td>
                            <td className="text-right font-medium tabular text-slate-900">
                              {won(op.supplyAmount)}원
                            </td>
                            <td className="text-right tabular text-slate-600">{won(op.fuelAmount)}원</td>
                            <td className="text-right tabular text-slate-600">
                              {op.otHours > 0 ? `${op.otHours}h` : '-'}
                            </td>
                            <td className="text-right">
                              {op.operatorId ? (
                                <Link
                                  to={`/ledger?operatorId=${op.operatorId}&from=${from}&to=${to}`}
                                  className="inline-flex items-center rounded-xl border border-slate-300 px-3 py-1 text-caption font-medium whitespace-nowrap text-slate-700 hover:bg-slate-50 active:bg-slate-100"
                                >
                                  조회
                                </Link>
                              ) : (
                                <span className="text-caption text-slate-500">-</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </ScrollBox>
                </>
              )}
            </div>
          </div>

          {/* 4. 하단 섹션: 월별 실적 추이 및 사업자별 비중 (PC 그리드) */}
          <div className={`dash-group grid gap-4 transition-opacity duration-200 [--base:8] lg:grid-cols-3 ${isPlaceholderData ? 'opacity-50' : ''}`}>
            {/* 4-A. 월별 실적 추이 (2 컬럼 차지) */}
            <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 lg:col-span-2">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-body font-bold text-slate-900">월별 실적 추이</h2>
                </div>
                <span className="shrink-0 whitespace-nowrap text-caption text-slate-500">{data.byMonth.length}개 월</span>
              </div>

              {data.byMonth.length === 0 ? (
                <p className="py-8 text-center text-caption text-slate-500">해당 기간의 월별 기록이 없습니다.</p>
              ) : (
                <>
                {/* 휴대폰: 달마다 두 줄 */}
                <ul className="divide-y divide-slate-100 sm:hidden">
                  {data.byMonth.map((m) => (
                    <PhoneRow
                      key={m.month}
                      name={m.month}
                      count={m.count}
                      amount={m.supplyAmount}
                      ratio={m.supplyAmount / maxMonthSupply}
                      details={[
                        ['주유', `${won(m.fuelAmount)}원`],
                        ['순매출', `${won(m.netAmount)}원`, 'font-medium text-emerald-800'],
                        ['타설', `${won(m.pourVolume)}m³`],
                      ]}
                    />
                  ))}
                </ul>
                <ScrollBox className="-mx-4 -mb-4 border-t border-slate-200 [--scroll-head:44px] max-sm:hidden" viewClassName="overflow-auto lg:max-h-[max(140px,calc(100dvh-870px))]">
                  <table className="w-full whitespace-nowrap [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50 [&_th]:shadow-[inset_0_-1px_0_var(--color-slate-200)] text-left text-caption [&_td]:px-3 [&_th]:px-3 [&_td:first-child]:pl-4 [&_th:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:last-child]:pr-4">
                    <thead>
                      <tr className="h-11 border-b border-slate-200 bg-slate-50 text-slate-600">
                        <th className="font-medium">월</th>
                        <th className="text-right font-medium">작업 건수</th>
                        <th className="text-right font-medium">공급가액</th>
                        <th className="text-right font-medium">주유비</th>
                        <th className="text-right font-medium">순매출</th>
                        <th className="text-right font-medium">타설량</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.byMonth.map((m) => {
                        const barWidth = Math.min(100, Math.round((m.supplyAmount / maxMonthSupply) * 100));
                        return (
                          <tr key={m.month} className="h-12 hover:bg-slate-50">
                            <td className="font-bold text-slate-900">
                              <div className="flex items-center gap-2">
                                <span>{m.month}</span>
                                <div className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-slate-100 sm:block">
                                  <div className="dash-bar h-full bg-slate-800" style={{ width: `${barWidth}%` }} />
                                </div>
                              </div>
                            </td>
                            <td className="text-right tabular text-slate-700">{won(m.count)}건</td>
                            <td className="text-right font-medium tabular text-slate-900">
                              {won(m.supplyAmount)}원
                            </td>
                            <td className="text-right tabular text-slate-600">{won(m.fuelAmount)}원</td>
                            <td className="text-right font-medium tabular text-emerald-800">
                              {won(m.netAmount)}원
                            </td>
                            <td className="text-right tabular text-slate-600">{won(m.pourVolume)}m³</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </ScrollBox>
                </>
              )}
            </div>

            {/* 4-B. 거래처별 매출과 받을 돈 (PC) */}
            <ClientBox clients={data.byClient} className="max-lg:hidden" />

            {/* 4-C. 사업자별 현황 (한강중기 / 금강중기) — 구분이 하나뿐이면(전부 미지정 등) 100% 한 줄이라 보이지 않는다 */}
            {data.byOwner.length > 1 && (
            <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-4">
                <h2 className="text-body font-bold text-slate-900">사업자 구분별 매출</h2>
              </div>

              {data.byOwner.length === 0 ? (
                <p className="py-8 text-center text-caption text-slate-500">데이터가 없습니다.</p>
              ) : (
                <div className="space-y-4 pt-1">
                  {data.byOwner.map((o) => {
                    const pct = data.kpi.supplyAmount > 0 ? Math.round((o.supplyAmount / data.kpi.supplyAmount) * 100) : 0;
                    return (
                      <div key={o.owner} className="space-y-1.5">
                        <div className="flex items-center justify-between text-caption">
                          <span className="font-bold text-slate-900">{o.owner}</span>
                          <span className="tabular font-medium text-slate-900">
                            {won(o.supplyAmount)}원 <span className="font-normal text-slate-500">({pct}%)</span>
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                          <div className="dash-bar h-full bg-slate-800" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="flex justify-between text-caption text-slate-600 tabular">
                          <span>작업 {won(o.count)}건</span>
                          <span>주유 {won(o.fuelAmount)}원</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            )}
          </div>

          {/* 5. 기사님 월급 — 우리 기사님께 달마다 줄 돈과 아직 안 준 돈 */}
          <div className="dash-group [--base:10]">
            <SalaryStatBox from={from} to={to} />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 휴대폰 목록: 처음에는 다섯 줄만 보이고 「모두 보기」로 나머지를 편다.
 * 기사님이 열여섯 분이면 그 목록만 화면 한 장 반이라, 많이 번 순서의 위쪽만 먼저 보인다.
 */
const PHONE_LIMIT = 5;

function PhoneList({ children, always = false }: { children: ReactNode; always?: boolean }) {
  const [open, setOpen] = useState(false);
  const rows = Children.toArray(children);
  const rest = rows.slice(PHONE_LIMIT);
  return (
    <div className={always ? '' : 'sm:hidden'}>
      <ul className="divide-y divide-slate-100">{rows.slice(0, PHONE_LIMIT)}</ul>
      {rest.length > 0 && (
        <>
          <Fold open={open}>
            <ul className="mt-1.5 divide-y divide-slate-100 border-t border-slate-100 pt-2.5">{rest}</ul>
          </Fold>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 text-caption font-medium text-slate-800 hover:bg-slate-50"
          >
            {open ? '접기' : `모두 보기 (${rows.length})`}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * 거래처별 매출과 받을 돈. 많이 번 거래처부터, 못 받은 돈(명세표는 냈는데 미입금)과 아직 명세표를 안 낸 돈을 같이 적는다.
 * 휴대폰은 다섯 곳만 먼저 보이고, PC 는 옆 월별 표 높이에 맞춰 상자 안에서 민다.
 */
function ClientBox({ clients, phone = false, className = '' }: { clients: DashboardClientStat[]; phone?: boolean; className?: string }) {
  const max = Math.max(...clients.map((c) => c.supplyAmount), 1);
  const rows = clients.map((c) => (
    <PhoneRow
      key={c.clientId}
      name={c.name}
      count={c.count}
      amount={c.supplyAmount}
      ratio={c.supplyAmount / max}
      details={[
        ...(c.unpaidAmount > 0 ? ([['받을 돈', `${won(c.unpaidAmount)}원`, 'font-medium text-rose-700']] as [string, string, string][]) : []),
        ...(c.unbilledAmount > 0 ? ([['미발행', `${won(c.unbilledAmount)}원`, 'font-medium text-amber-700']] as [string, string, string][]) : []),
      ]}
    />
  ));
  return (
    <div className={`min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-body font-bold text-slate-900">거래처별 매출과 받을 돈</h2>
        <span className="shrink-0 whitespace-nowrap text-caption text-slate-500">총 {clients.length}곳</span>
      </div>
      {clients.length === 0 ? (
        <p className="py-8 text-center text-caption text-slate-500">해당 기간의 작업이 없습니다.</p>
      ) : phone ? (
        <PhoneList always>{rows}</PhoneList>
      ) : (
        <ScrollBox
          className="-mx-4 -mb-4 border-t border-slate-200"
          viewClassName="overflow-y-auto px-4 py-3 lg:max-h-[max(140px,calc(100dvh-870px))]"
        >
          <ul className="divide-y divide-slate-100">{rows}</ul>
        </ScrollBox>
      )}
    </div>
  );
}

/**
 * 휴대폰에서 표 한 줄을 대신하는 두 줄짜리 항목.
 * 윗줄에 이름·건수·공급가액, 그 밑에 공급가액 막대(가장 큰 값 대비), 아랫줄에 나머지 값을 이름과 함께 적는다.
 * to 를 주면 줄 전체가 그곳으로 가는 누름 칸이 되고, 아랫줄 끝에 toLabel 을 적어 누를 수 있음을 알린다.
 */
function PhoneRow({
  name,
  count,
  amount,
  ratio,
  details,
  to,
  toLabel,
}: {
  name: string;
  count: number;
  amount: number;
  /** 0~1, 가장 큰 공급가액 대비 */
  ratio: number;
  /** [이름, 값, 값에 줄 색] */
  details: [string, string, string?][];
  to?: string;
  toLabel?: string;
}) {
  const width = Math.min(100, Math.round((Number.isFinite(ratio) ? ratio : 0) * 100));
  const body = (
    <>
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 truncate font-bold text-slate-900">{name}</span>
        <span className="shrink-0 text-caption text-slate-600 tabular">{won(count)}건</span>
        <span className="ml-auto shrink-0 font-medium text-slate-900 tabular">{won(amount)}원</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="dash-bar h-full bg-slate-700" style={{ width: `${width}%` }} />
      </div>
      {(details.length > 0 || (to && toLabel)) && (
      <div className="mt-1.5 flex items-center gap-3">
        <dl className="flex min-w-0 flex-1 flex-wrap gap-x-4 text-caption tabular">
          {details.map(([label, value, tone]) => (
            <div key={label} className="flex gap-1.5">
              <dt className="text-slate-600">{label}</dt>
              <dd className={tone ?? 'text-slate-900'}>{value}</dd>
            </div>
          ))}
        </dl>
        {to && toLabel && <span className="shrink-0 text-caption font-medium text-sky-800">{toLabel}</span>}
      </div>
      )}
    </>
  );
  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      {to ? (
        <Link to={to} className="-mx-2 block rounded-lg px-2 transition-colors duration-150 active:bg-slate-100">
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}
