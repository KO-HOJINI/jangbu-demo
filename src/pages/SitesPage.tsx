import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { SiteMonthCell } from '../../shared/types';
import { api } from '../lib/api';
import PageTitle from '../components/PageTitle';
import { exportSummary } from '../lib/exports';
import { issueDeadline, today, won } from '../lib/format';
import { useViewing } from '../lib/presence';
import { Loading, Pending } from '../components/Loading';
import ScrollBox from '../components/ScrollBox';
import { nextSortDir, sortRows, type SortDir, type SortValue } from '../lib/sortRows';

/** 'YYYY-MM' -> '6월' (해가 바뀌면 '2027년 1월') */
function monthLabel(month: string, baseYear: string): string {
  const [y, m] = month.split('-');
  return y === baseYear ? `${Number(m)}월` : `${y}년 ${Number(m)}월`;
}

export default function SitesPage() {
  useViewing('sites', '현장별');
  const thisYear = today().slice(0, 4);
  const [from, setFrom] = useState(`${thisYear}-01-01`);
  const [to, setTo] = useState(`${thisYear}-12-31`);
  const [onlyUnbilled, setOnlyUnbilled] = useState(false);
  const [onlyUnpaid, setOnlyUnpaid] = useState(false);

  const query = { from, to };
  const { data, isPending, error } = useQuery({
    queryKey: ['summary', query],
    queryFn: () => api.summary(query),
  });
  // 현장마다 발행일이 다르므로 기준정보에서 가져와 마감까지 남은 날을 센다
  const masters = useQuery({ queryKey: ['masters'], queryFn: api.masters });
  const issueDayBySite = useMemo(
    () => new Map((masters.data?.sites ?? []).map((s) => [s.id, s.issue_day])),
    [masters.data]
  );

  /** 현장별로 묶고, 월별 값을 표에 바로 꽂을 수 있게 정리한다 */
  const siteList = useMemo(() => {
    const byId = new Map<
      number,
      {
        site_id: number;
        site_label: string;
        client_name: string;
        byMonth: Map<string, SiteMonthCell>;
        count: number;
        supply: number;
        unbilled: number;
        unbilledCount: number;
        unpaid: number;
        unpaidCount: number;
      }
    >();

    for (const cell of data?.cells ?? []) {
      const entry = byId.get(cell.site_id) ?? {
        site_id: cell.site_id,
        site_label: cell.site_label,
        client_name: cell.client_name,
        byMonth: new Map(),
        count: 0,
        supply: 0,
        unbilled: 0,
        unbilledCount: 0,
        unpaid: 0,
        unpaidCount: 0,
      };
      entry.byMonth.set(cell.month, cell);
      entry.count += cell.count;
      entry.supply += cell.supply_amount;
      entry.unbilled += cell.unbilled_amount;
      entry.unbilledCount += cell.unbilled_count;
      entry.unpaid += cell.unpaid_amount ?? 0;
      entry.unpaidCount += cell.unpaid_count ?? 0;
      byId.set(cell.site_id, entry);
    }

    return [...byId.values()]
      .filter((s) => (!onlyUnbilled || s.unbilledCount > 0) && (!onlyUnpaid || s.unpaidCount > 0))
      // 원래 순서는 이름 가나다순 — 기간을 바꿔도 현장이 늘 같은 자리에 있고, 같은 거래처 현장이 붙어 나온다.
      // (예전에는 공급가액이 큰 순서였다. 그 순서는 「공급가액」 머리글을 한 번 누르면 된다)
      .sort((a, b) => a.site_label.localeCompare(b.site_label, 'ko', { numeric: true }));
  }, [data, onlyUnbilled, onlyUnpaid]);

  // 표 머리글을 눌러 고른 정렬 (작업일보 표와 같은 방식). null 이면 원래 순서.
  // 열쇠는 site·count·supply·unbilled·unpaid 또는 월('2026-07')
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(null);
  const sites = useMemo(() => {
    if (!sort) return siteList;
    const value = (s: (typeof siteList)[number]): SortValue =>
      sort.key === 'site'
        ? s.site_label
        : sort.key === 'count'
          ? s.count
          : sort.key === 'supply'
            ? s.supply
            : // 없는 금액은 어느 쪽으로 정렬해도 맨 아래
              sort.key === 'unbilled'
              ? s.unbilled || null
              : sort.key === 'unpaid'
                ? s.unpaid || null
                : s.byMonth.get(sort.key)?.supply_amount || null;
    return sortRows(siteList, value, sort.dir);
  }, [siteList, sort]);
  /** 정렬되는 머리글 칸. 이름은 가나다순부터, 숫자는 큰 것부터 */
  const sortHead = (key: string, label: string, align: 'left' | 'right' = 'right') => {
    const dir = sort?.key === key ? sort.dir : null;
    const first: SortDir = key === 'site' ? 'asc' : 'desc';
    const next = nextSortDir(dir, first);
    return (
      <th
        key={key}
        aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}
        className="p-0 whitespace-nowrap"
      >
        <button
          type="button"
          onClick={() => setSort(next ? { key, dir: next } : null)}
          title={next === 'asc' ? '오름차순으로' : next === 'desc' ? '내림차순으로' : '원래 순서로'}
          className={`relative flex min-h-11 w-full cursor-pointer items-center font-medium ${align === 'left' ? 'justify-start' : 'justify-end'} ${
            dir
              ? 'bg-sky-50 pr-[22px] pl-3 font-semibold text-sky-800 shadow-[inset_0_-2px_0_var(--color-sky-500)]'
              : 'px-3 hover:bg-slate-100'
          }`}
        >
          {label}
          {dir && (
            <svg
              aria-hidden="true"
              viewBox="0 0 10 6"
              className={`absolute top-1/2 right-2 h-1.5 w-2.5 -translate-y-1/2 text-sky-600 ${dir === 'desc' ? 'rotate-180' : ''}`}
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
      </th>
    );
  };

  const months = data?.months ?? [];

  // 표가 비었을 때, 기간에 작업이 없는 것인지 체크 칸이 다 걸러 낸 것인지 구분해서 알린다
  const emptyReason = !(data?.cells.length ?? 0)
    ? '이 기간에 작업이 없습니다.'
    : onlyUnbilled && onlyUnpaid
      ? '미발행이면서 미수금인 현장이 없습니다.'
      : onlyUnbilled
        ? '미발행인 현장이 없습니다. 모두 명세표를 냈습니다.'
        : '미수금인 현장이 없습니다. 모두 들어왔습니다.';

  const grand = useMemo(
    () => ({
      count: sites.reduce((s, r) => s + r.count, 0),
      supply: sites.reduce((s, r) => s + r.supply, 0),
      unbilled: sites.reduce((s, r) => s + r.unbilled, 0),
      unbilledCount: sites.reduce((s, r) => s + r.unbilledCount, 0),
      unpaid: sites.reduce((s, r) => s + r.unpaid, 0),
      unpaidCount: sites.reduce((s, r) => s + r.unpaidCount, 0),
      byMonth: Object.fromEntries(
        months.map((mo) => [mo, sites.reduce((s, r) => s + (r.byMonth.get(mo)?.supply_amount ?? 0), 0)])
      ) as Record<string, number>,
    }),
    [sites, months]
  );

  // 월 칸 위·아래 스크롤바를 같이 움직인다
  const topScrollRef = useRef<HTMLDivElement>(null);
  const monthScrollRef = useRef<HTMLDivElement>(null);
  // 맞춰 준 쪽이 내는 scroll 은 되받지 않는다. 화면 배율이 100% 가 아니면 두 칸의 위치가 소수점에서 어긋나,
  // 되받아 쓰면 끌고 있는 스크롤바를 도로 밀어내 덜컥거린다
  const echoRef = useRef<HTMLDivElement | null>(null);
  const syncScroll = (from: RefObject<HTMLDivElement | null>, to: RefObject<HTMLDivElement | null>) => {
    if (!from.current || !to.current) return;
    if (echoRef.current === from.current) {
      echoRef.current = null;
      return;
    }
    const before = to.current.scrollLeft;
    if (Math.abs(before - from.current.scrollLeft) < 1) return;
    to.current.scrollLeft = from.current.scrollLeft;
    // 실제로 움직였을 때만 되울림이 온다
    if (to.current.scrollLeft !== before) echoRef.current = to.current;
  };
  // 처음 열거나 달 목록이 바뀌면 가장 최근 달(오른쪽 끝)이 보이게 민다
  const monthsKey = months.join(',');
  const hasSites = sites.length > 0;
  useLayoutEffect(() => {
    const toEnd = () => {
      for (const ref of [monthScrollRef, topScrollRef]) {
        if (ref.current) ref.current.scrollLeft = ref.current.scrollWidth;
      }
    };
    toEnd();
    // 표 너비가 글꼴이 실린 뒤에 조금 늘어나 끝에서 한 칸 모자라게 멈추는 일이 있어 한 번 더 민다
    const frame = requestAnimationFrame(toEnd);
    const timer = setTimeout(toEnd, 300);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [monthsKey, hasSites]);
  // 한 번에 3달이 보이게 넓이를 잡는다. 화면이 좁아도 한 칸은 8rem 아래로 줄이지 않는다
  const monthTableWidth = `max(${(Math.max(months.length, 3) / 3) * 100}%, ${months.length * 8}rem)`;

  // 세 표로 나뉜 한 줄을 마우스가 올라가면 같이 칠한다
  const [hoveredSite, setHoveredSite] = useState<number | null>(null);
  const rowProps = (siteId: number) => ({
    onMouseEnter: () => setHoveredSite(siteId),
    onMouseLeave: () => setHoveredSite(null),
    className: `h-12 border-b border-slate-100 ${hoveredSite === siteId ? 'bg-slate-50' : ''}`,
  });

  if (error) return <p className="text-rose-600">{error.message}</p>;

  return (
    <>
      <PageTitle>현장별</PageTitle>

      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
        {/* 작업일보의 「작업일보 찾아보기」처럼 무엇을 하는 상자인지 제목을 단다 */}
        <h2 className="mb-3 text-body font-bold">현장별 찾아보기</h2>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <label className="block w-full lg:w-auto">
            <span className="mb-1 block text-caption font-medium text-slate-600">기간</span>
            <div className="flex w-full min-w-0 items-center gap-2">
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className={`${inputClass} min-w-0 flex-1 lg:flex-none`}
              />
              <span className="shrink-0 text-slate-500">~</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className={`${inputClass} min-w-0 flex-1 lg:flex-none`}
              />
            </div>
          </label>

          {/* 고르는 칸이 44px 한 높이라, 체크 칸도 같은 높이를 주어 위아래가 맞는다 */}
          <label className="flex items-center gap-2 text-caption lg:h-11">
            <input
              type="checkbox"
              checked={onlyUnbilled}
              onChange={(e) => setOnlyUnbilled(e.target.checked)}
              className="size-5 accent-slate-900"
            />
            미발행만 보기
          </label>

          <label className="flex items-center gap-2 text-caption lg:h-11">
            <input
              type="checkbox"
              checked={onlyUnpaid}
              onChange={(e) => setOnlyUnpaid(e.target.checked)}
              className="size-5 accent-rose-700"
            />
            미수금만 보기
          </label>

          {/* 누르는 버튼은 한 덩어리로 묶어 PC 에서는 오른쪽 끝에 둔다 — 고르는 칸과 섞이지 않게 */}
          <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
            <Link
              to="/sites/new"
              className="tap inline-flex items-center rounded-xl bg-slate-900 px-4 py-2 text-caption font-medium whitespace-nowrap text-white hover:bg-slate-800"
            >
              거래처·현장 등록
            </Link>

            <button
              type="button"
              onClick={() => data && exportSummary(data.cells, data.months, from, to)}
              disabled={!data?.cells.length}
              className="rounded-xl border border-slate-300 px-4 py-2 text-caption whitespace-nowrap hover:bg-slate-50 disabled:opacity-40"
            >
              엑셀로 내보내기
            </button>
          </div>
        </div>

        {/* 합계 줄은 고르는 칸과 줄 하나로 나눈다 — PC 에서 붙여 두었더니 숫자가 칸 밑에 눌려 보였다 */}
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-200 pt-4 sm:grid-cols-5">
          <Stat label="현장" value={isPending ? <Pending unit="곳" /> : `${sites.length}곳`} />
          <Stat label="작업" value={isPending ? <Pending unit="건" /> : `${grand.count}건`} />
          <Stat label="공급가액" value={isPending ? <Pending unit="원" /> : `${won(grand.supply)}원`} strong />
          <Stat
            label="미발행"
            value={isPending ? <Pending unit="원" /> : grand.unbilledCount ? `${won(grand.unbilled)}원` : '없음'}
            sub={grand.unbilledCount ? `${grand.unbilledCount}건` : undefined}
            tone={grand.unbilledCount ? 'warn' : undefined}
          />
          <Stat
            label="미수금"
            value={isPending ? <Pending unit="원" /> : grand.unpaidCount ? `${won(grand.unpaid)}원` : '없음'}
            sub={grand.unpaidCount ? `${grand.unpaidCount}건` : undefined}
            tone={grand.unpaidCount ? 'due' : undefined}
          />
        </div>
      </div>

      {/* 좁은 화면: 현장마다 카드 하나 — 월이 열로 늘어나는 표는 폰에 안 들어간다 */}
      <div className="space-y-2 lg:hidden">
        {sites.map((site) => (
          <div key={site.site_id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-baseline gap-2">
              <Link to={`/sites/${site.site_id}`} className="text-body font-bold hover:underline">
                {site.site_label}
              </Link>
              <span className="text-caption text-slate-500">{site.count}건</span>
              <span className="ml-auto text-lead font-bold tabular">{won(site.supply)}원</span>
            </div>

            {/* 달마다 제 칸을 둔다 — 일이 없던 달도 「-」로 자리를 지켜, 어느 카드에서나 같은 달이 같은 자리에 온다 */}
            <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-caption tabular sm:grid-cols-3">
              {months.map((mo) => {
                const cell = site.byMonth.get(mo);
                return (
                  <div key={mo} className="flex items-baseline justify-between gap-2">
                    <span className="shrink-0 text-slate-600">{monthLabel(mo, thisYear)}</span>
                    <span className={cell ? 'text-slate-900' : 'text-slate-600'}>
                      {cell ? `${won(cell.supply_amount)}원` : '-'}
                    </span>
                  </div>
                );
              })}
            </div>

            {site.unbilledCount > 0 && (
              <div className="mt-2 flex flex-wrap items-baseline gap-x-2 text-caption">
                <span className="text-amber-700 tabular">
                  미발행 {won(site.unbilled)}원 ({site.unbilledCount}건)
                </span>
                <Deadline issueDay={issueDayBySite.get(site.site_id)} />
              </div>
            )}

            {site.unpaidCount > 0 && (
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-caption">
                <span className="font-medium text-rose-700 tabular">
                  미수금 {won(site.unpaid)}원 ({site.unpaidCount}건)
                </span>
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                to={`/sites/${site.site_id}/edit`}
                className="tap inline-flex items-center rounded-xl border border-slate-300 px-4 py-2 text-caption hover:bg-slate-50"
              >
                수정
              </Link>
              {site.unbilledCount > 0 ? (
                <Link
                  to={`/statements/new?siteId=${site.site_id}`}
                  className="tap inline-flex items-center rounded-xl border border-slate-300 px-4 py-2 text-caption whitespace-nowrap hover:bg-slate-50"
                >
                  명세표 발행하기
                </Link>
              ) : (
                <span className="px-1 py-2 text-caption text-slate-600">발행 완료</span>
              )}
            </div>
          </div>
        ))}

        {isPending && (
          <p className="rounded-2xl border border-slate-200 bg-white py-16 text-center">
            <Loading />
          </p>
        )}
        {!sites.length && !isPending && (
          <p className="rounded-2xl border border-slate-200 bg-white py-16 text-center text-slate-500">
            {emptyReason}
          </p>
        )}
      </div>

      {/* 넓은 화면: 현장 × 월 크로스탭.
          현장 이름(왼쪽)과 합계(오른쪽)는 고정하고, 가운데 월 칸만 3달 너비로 보이며 좌우로 민다.
          세 표의 줄 높이를 똑같이 고정해서 줄이 어긋나지 않게 한다. */}
      <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white lg:block">
        {sites.length > 0 ? (
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start text-caption">
            {/* 윗줄: 월 칸 위에만 가로 스크롤바. 아래 스크롤바와 똑같은 모양으로 두고,
                바탕은 바로 밑 머리줄과 같은 색으로 맞추고(양옆 빈 칸도), 표의 세로 테두리를 위까지 잇는다 */}
            <div className="self-stretch border-r border-slate-200 bg-slate-50" />
            <div
              ref={topScrollRef}
              onScroll={() => syncScroll(topScrollRef, monthScrollRef)}
              className="table-scrollbar overflow-x-auto bg-slate-50"
            >
              <div style={{ width: monthTableWidth }} className="h-px" />
            </div>
            <div className="self-stretch border-l border-slate-200 bg-slate-50" />

            {/* 양옆 표는 아래 스크롤바 높이만큼 짧다 — 남는 자리도 합계줄과 같은 색으로 채우고 테두리를 끝까지 잇는다 */}
            <div className="self-stretch border-r border-slate-200 bg-slate-50">
            <table className="bg-white">
              <thead>
                <tr className={headRow}>
                  {sortHead('site', '현장', 'left')}
                </tr>
              </thead>
              <tbody>
                {sites.map((site) => (
                  <tr key={site.site_id} {...rowProps(site.site_id)}>
                    <td className="px-3 whitespace-nowrap">
                      <Link to={`/sites/${site.site_id}`} className="hover:underline">
                        {site.site_label}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={footRow}>
                  <td className="px-3">합계</td>
                </tr>
              </tfoot>
            </table>
            </div>

            <ScrollBox
              ref={monthScrollRef}
              onScroll={() => syncScroll(monthScrollRef, topScrollRef)}
              viewClassName="table-scrollbar overflow-x-auto overflow-y-hidden"
            >
              <table style={{ width: monthTableWidth }} className="table-fixed">
                <thead>
                  <tr className={headRow}>
                    {months.map((mo) => sortHead(mo, monthLabel(mo, thisYear)))}
                  </tr>
                </thead>
                <tbody>
                  {sites.map((site) => (
                    <tr key={site.site_id} {...rowProps(site.site_id)}>
                      {months.map((mo) => {
                        const cell = site.byMonth.get(mo);
                        return (
                          <td key={mo} className="px-3 text-right whitespace-nowrap tabular">
                            {cell ? (
                              <span title={`${cell.count}건`}>{won(cell.supply_amount)}원</span>
                            ) : (
                              <span className="text-slate-200">·</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className={footRow}>
                    {months.map((mo) => (
                      <td key={mo} className="px-3 text-right whitespace-nowrap tabular">
                        {grand.byMonth[mo] ? `${won(grand.byMonth[mo])}원` : ''}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </ScrollBox>

            <div className="self-stretch border-l border-slate-200 bg-slate-50">
            <table className="bg-white">
              <thead>
                <tr className={headRow}>
                  {sortHead('count', '건수')}
                  {sortHead('supply', '공급가액')}
                  {sortHead('unbilled', '미발행')}
                  {sortHead('unpaid', '미수금')}
                  <th className="px-3"></th>
                </tr>
              </thead>
              <tbody>
                {sites.map((site) => (
                  <tr key={site.site_id} {...rowProps(site.site_id)}>
                    <td className="px-3 text-right text-slate-600 tabular">{site.count}</td>
                    <td className="px-3 text-right font-medium whitespace-nowrap tabular">{won(site.supply)}원</td>
                    <td className="px-3 text-right whitespace-nowrap tabular">
                      {site.unbilledCount ? (
                        <>
                          <span className="text-amber-700">
                            {won(site.unbilled)}원<span className="ml-1">({site.unbilledCount}건)</span>
                          </span>{' '}
                          <Deadline issueDay={issueDayBySite.get(site.site_id)} />
                        </>
                      ) : (
                        <span className="text-slate-500">완료</span>
                      )}
                    </td>
                    <td className="px-3 text-right whitespace-nowrap tabular">
                      {site.unpaidCount ? (
                        <span className="font-medium text-rose-700">
                          {won(site.unpaid)}원
                          <span className="ml-1 font-normal text-slate-500">({site.unpaidCount}건)</span>
                        </span>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                    </td>
                    <td className="px-3 text-right whitespace-nowrap">
                      <Link
                        to={`/sites/${site.site_id}/edit`}
                        className="mr-1 inline-block rounded-md border border-slate-300 px-3 py-1.5 text-caption hover:bg-slate-100"
                      >
                        수정
                      </Link>
                      {site.unbilledCount > 0 && (
                        <Link
                          to={`/statements/new?siteId=${site.site_id}`}
                          className="inline-block rounded-md border border-slate-300 px-3 py-1.5 text-caption hover:bg-slate-100"
                        >
                          명세표 발행하기
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={footRow}>
                  <td className="px-3 text-right text-slate-600 tabular">{grand.count}</td>
                  <td className="px-3 text-right whitespace-nowrap tabular">{won(grand.supply)}원</td>
                  <td className="px-3 text-right whitespace-nowrap tabular">
                    {grand.unbilled ? `${won(grand.unbilled)}원` : ''}
                  </td>
                  <td className="px-3 text-right font-medium whitespace-nowrap text-amber-800 tabular">
                    {grand.unpaid ? `${won(grand.unpaid)}원` : ''}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
            </div>
          </div>
        ) : (
          <p className="py-16 text-center text-slate-500">{isPending ? <Loading /> : emptyReason}</p>
        )}
      </div>

      <p className="mt-3 text-caption text-slate-600">
        금액은 모두 공급가액(부가세 별도)입니다. 현장 이름을 누르면 그 현장의 상세(정보·단가·담당자·월별 작업)로
        이동합니다.
      </p>
    </>
  );
}

// 크로스탭 세 표가 줄을 맞추도록 머리·합계 줄 높이도 고정한다
const headRow = 'h-11 border-b border-slate-200 bg-slate-50 font-medium text-slate-600';
const footRow = 'h-12 border-t-2 border-slate-300 bg-slate-50 font-medium';

// 휴대폰(iOS)은 글자가 16px 보다 작은 입력칸을 누르면 화면을 확대해 버린다
const inputClass =
  'rounded-xl border border-slate-300 px-3 py-2 text-body tabular outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200';

/**
 * 발행 마감까지 남은 날.
 * 현장에 발행일이 적혀 있으면 그 날, 없으면 25일을 기준으로 센다.
 */
function Deadline({ issueDay }: { issueDay: string | null | undefined }) {
  const d = issueDeadline(issueDay);
  const tone =
    d.urgency === 'today'
      ? 'bg-rose-100 text-rose-800'
      : d.urgency === 'soon'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-slate-100 text-slate-600';

  return (
    <span
      className={`inline-block rounded-md px-1.5 py-0.5 text-caption whitespace-nowrap ${tone}`}
      title={`${d.date} 발행 마감${issueDay ? '' : ' (현장에 발행일이 없어 25일 기준)'}`}
    >
      {d.label}
    </span>
  );
}

function Stat({
  label,
  value,
  sub,
  strong,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  /** 이름 옆에 붙는 건수 (「미발행 114건」) — 금액 아래에 두면 그 칸만 세 줄이 되어 아랫변이 들쭉날쭉했다 */
  sub?: string;
  strong?: boolean;
  /** warn = 아직 청구하지 않은 돈(주황), due = 청구했는데 안 들어온 돈(붉은색) */
  tone?: 'warn' | 'due';
}) {
  // 둘 다 주황이면 성격이 다른 두 숫자가 한눈에 구분되지 않아 미수금만 붉은색으로 둔다
  const toneClass = tone === 'due' ? 'text-rose-700' : tone === 'warn' ? 'text-amber-700' : '';

  // 이름 바로 아래에 값이 오게 왼쪽으로 맞춘다 — 오른쪽 맞춤은 칸이 넓어지면 이름과 값이 따로 놀았다
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-1.5 text-caption text-slate-600">
        <span>{label}</span>
        {sub && <span className={`tabular ${toneClass}`}>{sub}</span>}
      </div>
      <div
        className={`tabular break-all ${strong ? 'text-title font-bold' : 'text-lead font-medium'} ${toneClass}`}
      >
        {value}
      </div>
    </div>
  );
}