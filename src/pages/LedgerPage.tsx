import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import type { WorkLogQuery, WorkLogRow } from '../../shared/types';
import { api } from '../lib/api';
import PageTitle from '../components/PageTitle';
import { exportLedger } from '../lib/exports';
import { monthRange, shiftMonthRange, today, won } from '../lib/format';
import { nextAutoBack } from '../lib/ledgerAutoMonth';
import { filterSummary } from '../lib/ledgerFilterSummary';
import { statementFileName } from '../lib/print';
import { nextSortDir, sortRows, type SortDir, type SortValue } from '../lib/sortRows';
import LedgerCard from '../components/LedgerCard';
import LedgerRow from '../components/LedgerRow';
import NewLogForm from '../components/NewLogForm';
import Fold from '../components/Fold';
import NewLogRow from '../components/NewLogRow';
import { Loading, PageLoading, Pending } from '../components/Loading';
import { allSitesValue, clientIdFromValue } from '../lib/siteSelect';
import { useViewing } from '../lib/presence';
import ScrollBox from '../components/ScrollBox';

/**
 * 열 정의 — 순서는 엑셀 '2026년 장부' 시트와 동일하게 맞춘다.
 *   월일 · 현장명 · 작업내용 · 작업시간 · 타설 · M · OT · OT금액 · 금액 · 기사님 · 사업자 · 주유 · 기타
 * 공급가액은 엑셀 장부에 없는 계산 열이라 맨 뒤에 붙였다.
 * table-fixed 와 함께 폭을 못 박아 표가 찌그러지지 않게 한다 (작업 내용만 나머지 폭을 차지).
 * sort 가 있는 열은 머리글을 눌러 정렬한다 (오름 → 내림 → 원래 순서).
 * 화면에 빈 칸으로 보이는 0(OT·OT금액·금액)은 빈 칸과 같이 맨 아래로 보낸다.
 */
const COLUMNS: { label: string; width: string | undefined; sort?: (row: WorkLogRow) => SortValue }[] = [
  // 폭은 2026년 장부 114행의 가장 긴 값(과 머리글)을 실제로 그려서 잰 값에 조금 여유를 둔 것이다.
  // 금액 열은 「원」까지 한 줄에 들어가게 잡았다 (1년치 합계 171,110,000원 포함 — 합계 줄은 옆 여백을 줄여 맞춘다).
  // 1366px 노트북 화면(양옆 스크롤 막대 폭 15px 씩·옆 여백·테두리를 빼면 표 자리 1302px)에서도 옆으로 밀지 않고, 작업 내용은 118px 남짓을 받는다.
  { label: '월 일', width: '60px', sort: (r) => r.work_date }, //      8/27
  { label: '현장명', width: '100px', sort: (r) => r.site_label }, //    라온(샘플리)
  { label: '작업 내용', width: undefined, sort: (r) => r.description }, // 환기구 수직구벽체 (남는 폭을 전부 받는다)
  { label: '작업 시간', width: '120px', sort: (r) => r.start_time && `${r.start_time}~${r.end_time ?? ''}` }, // 07:00~17:00 (크롬 시간칸 대신 글자 한 칸)
  { label: '타설', width: '56px', sort: (r) => r.pour_volume },
  { label: 'M', width: '48px', sort: (r) => r.boom_size },
  { label: 'OT', width: '44px', sort: (r) => r.ot_hours || null },
  { label: 'OT 금액', width: '100px', sort: (r) => r.ot_amount || null }, //  2,200,000원 (1년 합계)
  { label: '금액', width: '124px', sort: (r) => r.base_amount || null }, //     14,000,000원
  { label: '기사님', width: '56px', sort: (r) => r.operator_name },
  { label: '사업자', width: '56px', sort: (r) => r.business_owner },
  { label: '주유', width: '112px', sort: (r) => r.fuel_amount }, //     21,225,232원 (1년 합계)
  { label: '기타', width: '76px', sort: (r) => r.extra_amount }, //      66,000
  { label: '공급가액', width: '124px', sort: (r) => r.supply_amount }, // 14,000,000원
  { label: '', width: '108px' }, //         8월 아라 광장 (발행된 줄의 명세표 이름)
];

export default function LedgerPage() {
  useViewing('ledger', '작업일보');
  // 현장별 화면에서 넘어올 때 ?siteId=..&from=..&to=.. 로 조건을 물려받는다
  const [searchParams] = useSearchParams();

  const [from, setFrom] = useState(() => searchParams.get('from') ?? monthRange(today())[0]);
  const [to, setTo] = useState(() => searchParams.get('to') ?? monthRange(today())[1]);
  const [siteId, setSiteId] = useState(() => searchParams.get('siteId') ?? '');
  // 현장 하나 대신 거래처 전체를 볼 때 쓴다 (목록의 「○○ 전체」 줄). 둘 중 하나만 값이 있다.
  const [clientId, setClientId] = useState('');
  // 설정 → 기사님, 대시보드에서 「이 기사님 작업 보기」로 넘어올 때 주소에 실려 온다
  const [operatorId, setOperatorId] = useState(() => searchParams.get('operatorId') ?? '');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  // 휴대폰에서만 쓴다 — 고르는 칸을 펼쳤는지 (PC 는 늘 펼쳐 있다)
  const [filtersOpen, setFiltersOpen] = useState(false);

  const query: WorkLogQuery = {
    from,
    to,
    siteId: siteId ? Number(siteId) : undefined,
    clientId: clientId ? Number(clientId) : undefined,
    operatorId: operatorId ? Number(operatorId) : undefined,
    q: q.trim() || undefined,
  };

  const siteSelectValue = siteId || (clientId ? allSitesValue(clientId) : '');
  const chooseSite = (value: string) => {
    const allOf = clientIdFromValue(value);
    setSiteId(allOf != null ? '' : value);
    setClientId(allOf != null ? String(allOf) : '');
  };

  const masters = useQuery({ queryKey: ['masters'], queryFn: api.masters });
  const ledger = useQuery({ queryKey: ['ledger', query], queryFn: () => api.ledger(query) });

  // 첫 화면이 빈 달이면 작업이 있는 달이 나올 때까지 한 달씩 거슬러 간다.
  // 값은 이번 달에서 몇 달 거슬러 왔는지, null 이면 찾기를 끝냈다(현장별 화면에서 기간을 받아 온 경우 포함).
  const autoBack = useRef<number | null>(searchParams.get('from') || searchParams.get('to') ? null : 0);

  useEffect(() => {
    const step = autoBack.current;
    if (step == null || !ledger.isSuccess) return;
    // 찾는 사이 사용자가 달이나 조건을 바꿨으면 그만둔다
    const [expectStart, expectEnd] = shiftMonthRange(today(), -step);
    if (from !== expectStart || to !== expectEnd || siteId || clientId || operatorId || q.trim()) {
      autoBack.current = null;
      return;
    }
    const next = nextAutoBack(step, ledger.data.rows.length > 0);
    if (next === 'stop') {
      autoBack.current = null;
      return;
    }
    autoBack.current = next === 'reset' ? null : next;
    const [start, end] = next === 'reset' ? monthRange(today()) : shiftMonthRange(today(), -next);
    setFrom(start);
    setTo(end);
  }, [ledger.isSuccess, ledger.data, from, to, siteId, clientId, operatorId, q]);

  // 발행된 작업에 「명세 #12」 같은 내부 번호 대신 「8월 아라 광장」처럼 명세표 이름을 붙인다.
  // 거래명세표 화면과 같은 열쇠라 목록을 한 번만 받는다.
  const statementList = useQuery({ queryKey: ['statements', {}], queryFn: () => api.statements() });
  const statementNames = useMemo(
    () =>
      new Map((statementList.data ?? []).map((s) => [s.id, statementFileName(s).replace(/^\d+년 /, '')])),
    [statementList.data]
  );

  // 표 머리글을 눌러 고른 정렬. null 이면 장부 원래 순서(날짜·입력 순서)
  const [sort, setSort] = useState<{ column: number; dir: SortDir } | null>(null);
  const sortedRows = useMemo(() => {
    const list = ledger.data?.rows ?? [];
    const by = sort && COLUMNS[sort.column].sort;
    return sort && by ? sortRows(list, by, sort.dir) : list;
  }, [ledger.data, sort]);
  const toggleSort = (column: number) => {
    const dir = nextSortDir(sort?.column === column ? sort.dir : null);
    setSort(dir ? { column, dir } : null);
  };

  // 같은 날짜가 이어지면 첫 행에만 날짜를 찍는다 (엑셀 장부와 같은 모양)
  const dateFlags = useMemo(() => {
    let previous = '';
    return sortedRows.map((row) => {
      const first = row.work_date !== previous;
      previous = row.work_date;
      return first;
    });
  }, [sortedRows]);

  if (masters.isPending) return <PageLoading />;
  if (masters.error) return <p className="text-rose-600">{masters.error.message}</p>;

  const m = masters.data!;
  const rows = ledger.data?.rows ?? [];
  const totals = ledger.data?.totals;

  const shiftMonth = (delta: number) => {
    const [start, end] = shiftMonthRange(from, delta);
    setFrom(start);
    setTo(end);
  };

  const exportExcel = () => totals && exportLedger(rows, totals, from, to);

  const summary = filterSummary({
    from,
    to,
    site: siteId
      ? m.sites.find((s) => String(s.id) === siteId)?.label
      : clientId
        ? `${m.clients.find((c) => String(c.id) === clientId)?.name ?? ''} 전체`
        : undefined,
    operator: m.operators.find((o) => String(o.id) === operatorId)?.name,
    q,
  });

  return (
    <>
      {/* 입력 자동완성 후보 — 과거 장부에서 실제 쓰인 값들 */}
      <datalist id="descriptions">
        {m.suggestions.descriptions.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
      <datalist id="boom-sizes">
        {m.suggestions.boomSizes.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
      <datalist id="base-amounts">
        {m.suggestions.baseAmounts.map((a) => (
          <option key={a} value={a} />
        ))}
      </datalist>
      <datalist id="business-owners">
        {m.suggestions.businessOwners.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>

      <PageTitle>작업일보</PageTitle>

      <NewLogForm masters={m} defaultSiteId={siteId} />

      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
        {/* 「새 작업 추가」 상자와 헷갈리지 않게 무엇을 하는 상자인지 제목을 단다 */}
        {/* 휴대폰에서는 엑셀 단추를 제목 오른쪽에 둔다 — 맨 아래 혼자 한 줄을 차지하지 않게.
            단추(44px)가 줄을 키워 제목이 내려가지 않게 단추 위아래를 음수 여백으로 줄인다 */}
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-body font-bold">작업일보 찾아보기</h2>
          <button
            type="button"
            onClick={exportExcel}
            disabled={!rows.length}
            className="-my-2 rounded-xl border border-slate-300 px-3 py-2 text-caption whitespace-nowrap hover:bg-slate-50 disabled:opacity-40 lg:hidden"
          >
            엑셀로 내보내기
          </button>
        </div>
        {/* 휴대폰: 처음에는 고른 조건 한 줄과 합계만 보이고, 고르는 칸은 「검색 조건 바꾸기」를 눌러야 펼쳐진다 */}
        <div className="mt-1 flex items-center gap-3 lg:hidden">
          <p className="min-w-0 flex-1 text-body leading-snug">{summary}</p>
          <button
            type="button"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((open) => !open)}
            className="shrink-0 rounded-xl border border-slate-300 px-3 py-2 text-caption whitespace-nowrap hover:bg-slate-50"
          >
            {filtersOpen ? '접기' : '검색 조건 바꾸기'}
          </button>
        </div>
        <Fold open={filtersOpen} lgOpen>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3 max-lg:mt-2">
          {/* 좁은 화면에서는 날짜 두 칸이 한 줄을 다 쓰고, 달 이동 버튼이 아랫줄로 내려간다 */}
          <Field label="기간" className="w-full lg:w-auto">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
              <div className="flex w-full min-w-0 items-center gap-2 lg:w-auto">
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className={`${controlClass} min-w-0 flex-1 tabular lg:flex-none`}
                />
                <span className="shrink-0 text-slate-500">~</span>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className={`${controlClass} min-w-0 flex-1 tabular lg:flex-none`}
                />
              </div>
              {/* 휴대폰: 지난 달은 왼쪽 끝, 이번 달은 가운데, 다음 달은 오른쪽 끝 */}
              <div className="flex w-full shrink-0 justify-between gap-2 lg:w-auto lg:justify-start">
                <button type="button" onClick={() => shiftMonth(-1)} className={stepButtonClass}>
                  ‹ 지난 달
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const [start, end] = monthRange(today());
                    setFrom(start);
                    setTo(end);
                  }}
                  className={stepButtonClass}
                >
                  이번 달
                </button>
                <button type="button" onClick={() => shiftMonth(1)} className={stepButtonClass}>
                  다음 달 ›
                </button>
              </div>
            </div>
          </Field>

          <Field label="현장" className="min-w-0 flex-1 lg:flex-none">
            {/* 명세표와 같이 거래처끼리 묶고, 묶음마다 「○○ 전체」로 그 거래처 작업을 모아 볼 수 있다 */}
            <select value={siteSelectValue} onChange={(e) => chooseSite(e.target.value)} className={`${controlClass} w-full`}>
              <option value="">전체</option>
              {m.clients.map((c) => {
                const own = m.sites.filter((s) => s.client_id === c.id);
                if (!own.length) return null;
                return (
                  <optgroup key={c.id} label={c.name}>
                    <option value={allSitesValue(c.id)}>{c.name} 전체</option>
                    {own.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </Field>

          <Field label="기사님" className="min-w-0 flex-1 lg:flex-none">
            <select
              value={operatorId}
              onChange={(e) => setOperatorId(e.target.value)}
              className={`${controlClass} w-full`}
            >
              <option value="">전체</option>
              {m.operators.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="글자로 찾기" className="w-full lg:w-48">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="작업 내용, 현장, 메모로 찾기"
              className={`${controlClass} w-full`}
            />
          </Field>

          {/* 누르는 버튼은 PC 에서 오른쪽 끝에 — 고르는 칸(현장·기사님·검색)과 섞이지 않게 */}
          <button
            type="button"
            onClick={exportExcel}
            disabled={!rows.length}
            className="hidden rounded-xl border border-slate-300 px-4 py-2 text-caption whitespace-nowrap hover:bg-slate-50 disabled:opacity-40 lg:ml-auto lg:block"
          >
            엑셀로 내보내기
          </button>
        </div>
        </Fold>

        {/*
          불러오는 동안에도 상자는 그대로 두고 값만 「–」 — 달을 넘길 때 화면이 들썩이지 않게.
          합계 줄은 PC 에서도 고르는 칸과 줄 하나로 나눈다 (현장별 화면과 같은 모양).
        */}
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-200 pt-4 sm:grid-cols-4">
          <Stat label="건수" value={totals ? `${totals.count}건` : <Pending unit="건" />} />
          <Stat label="공급가액" value={totals ? `${won(totals.supplyAmount)}원` : <Pending unit="원" />} />
          <Stat label="세액" value={totals ? `${won(totals.vatAmount)}원` : <Pending unit="원" />} />
          <Stat label="합계" value={totals ? `${won(totals.totalAmount)}원` : <Pending unit="원" />} strong />
        </div>
      </div>

      {error && (
        <p className="mb-4 flex items-center gap-3 anim-reveal rounded-xl bg-rose-50 px-4 py-3 text-caption text-rose-700">
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-auto text-rose-600 hover:text-rose-700">
            닫기
          </button>
        </p>
      )}

      {/* 좁은 화면: 카드 목록 — 15열 표는 폰에서 읽지도 고치지도 못한다 */}
      <div className="space-y-2 lg:hidden">
        {rows.map((row) => (
          <LedgerCard
            key={row.id}
            row={row}
            masters={m}
            statementName={row.statement_id ? statementNames.get(row.statement_id) : undefined}
            onError={setError}
          />
        ))}

        {ledger.isPending && (
          <p className="rounded-2xl border border-slate-200 bg-white py-16 text-center">
            <Loading />
          </p>
        )}
        {!rows.length && !ledger.isPending && (
          <p className="rounded-2xl border border-slate-200 bg-white py-16 text-center text-slate-500">
            이 기간에 등록된 작업이 없습니다.
          </p>
        )}

        {totals && rows.length > 0 && (
          <div className="rounded-2xl border border-slate-300 bg-slate-50 p-4">
            <div className="flex justify-between text-caption">
              <span className="text-slate-600">{totals.count}건 공급가액</span>
              <span className="font-medium tabular">{won(totals.supplyAmount)}원</span>
            </div>
            <div className="mt-1 flex justify-between text-caption">
              <span className="text-slate-600">세액</span>
              <span className="tabular">{won(totals.vatAmount)}원</span>
            </div>
            <div className="mt-2 flex justify-between border-t border-slate-300 pt-2 text-lead font-bold">
              <span>합계</span>
              <span className="tabular">{won(totals.totalAmount)}원</span>
            </div>
          </div>
        )}
      </div>

      {/* 넓은 화면: 엑셀과 같은 표 */}
      <ScrollBox className="hidden rounded-2xl border border-slate-200 bg-white lg:block">
        <table className="w-full min-w-[1302px] table-fixed text-caption">
          <colgroup>
            {COLUMNS.map((c, i) => (
              <col key={i} style={c.width ? { width: c.width } : undefined} />
            ))}
          </colgroup>
          <thead>
            <tr className="bg-slate-50 text-caption font-medium text-slate-600">
              {COLUMNS.map((c, i) => {
                const dir = sort?.column === i ? sort.dir : null;
                return (
                  <th
                    key={i}
                    aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}
                    className="border-b border-r border-slate-200 p-0 whitespace-nowrap last:border-r-0"
                  >
                    {c.sort ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(i)}
                        title={dir === 'asc' ? '내림차순으로' : dir === 'desc' ? '원래 순서로' : '오름차순으로'}
                        className={`relative flex min-h-11 w-full cursor-pointer items-center justify-center ${dir ? 'pr-[22px] pl-1 bg-sky-50 font-semibold text-sky-800 shadow-[inset_0_-2px_0_var(--color-sky-500)]' : 'px-3.5 hover:bg-slate-100'}`}
                      >
                        {c.label}
                        {dir && (
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 10 6"
                            className={`absolute right-2 top-1/2 h-1.5 w-2.5 -translate-y-1/2 text-sky-600 ${dir === 'desc' ? 'rotate-180' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.25"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M1 5 5 1l4 4" />
                          </svg>
                        )}
                      </button>
                    ) : (
                      c.label || <span className="sr-only">발행·삭제</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {/* 맨 윗줄에서 엑셀처럼 바로 적는다 (위 「새 작업 추가」 상자와 같은 규칙) */}
            <NewLogRow masters={m} columnCount={COLUMNS.length} defaultSiteId={siteId} period={{ from, to }} />
            {sortedRows.map((row, i) => (
              <LedgerRow
                key={row.id}
                row={row}
                masters={m}
                showDate={dateFlags[i]}
                statementName={row.statement_id ? statementNames.get(row.statement_id) : undefined}
                onError={setError}
              />
            ))}

            {ledger.isPending && (
              <tr>
                <td colSpan={COLUMNS.length} className="py-16 text-center">
                  <Loading />
                </td>
              </tr>
            )}
            {!rows.length && !ledger.isPending && (
              <tr>
                <td colSpan={COLUMNS.length} className="py-16 text-center text-slate-500">
                  이 기간에 등록된 작업이 없습니다.
                </td>
              </tr>
            )}
          </tbody>

          {totals && rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-medium">
                <td colSpan={7} className="px-2 py-2 text-right text-slate-600">
                  {totals.count}건 합계
                </td>
                <td className="border-l border-slate-200 px-1 py-2 text-right whitespace-nowrap tabular">{won(totals.otAmount)}원</td>
                <td className="border-l border-slate-200 px-1 py-2 text-right whitespace-nowrap tabular">{won(totals.baseAmount)}원</td>
                <td className="border-l border-slate-200" />
                <td className="border-l border-slate-200" />
                <td className="border-l border-slate-200 px-1 py-2 text-right whitespace-nowrap text-slate-600 tabular">
                  {totals.fuelAmount ? `${won(totals.fuelAmount)}원` : ''}
                </td>
                <td className="border-l border-slate-200" />
                <td className="border-l border-slate-200 px-1 py-2 text-right whitespace-nowrap tabular">{won(totals.supplyAmount)}원</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </ScrollBox>
    </>
  );
}

// 휴대폰(iOS)은 글자가 16px 보다 작은 입력칸을 누르면 화면을 확대해 버린다
const controlClass =
  'rounded-xl border border-slate-300 px-3 py-2 text-body outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200';
const stepButtonClass =
  'min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-caption whitespace-nowrap hover:bg-slate-50';

function Field({ label, className = '', children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-caption font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  // 이름 바로 아래에 값이 오게 왼쪽으로 맞춘다 — 오른쪽 맞춤은 칸이 넓어지면 이름과 값이 따로 놀았다
  return (
    <div className="min-w-0">
      <div className="text-caption text-slate-600">{label}</div>
      {/* 금액이 길어도 상자를 밀지 않도록 넘치면 줄바꿈한다 */}
      <div className={`tabular break-all ${strong ? 'text-title font-bold' : 'text-lead font-medium'}`}>{value}</div>
    </div>
  );
}
