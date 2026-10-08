import { Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { shortDate, timeRange, won } from '../lib/format';
import { useViewing } from '../lib/presence';
import { PageLoading } from '../components/Loading';
import ScrollBox from '../components/ScrollBox';
import { PresenceBadge } from '../components/Presence';

const monthLabel = (month: string) => `${Number(month.split('-')[1])}월`;

export default function SiteDetailPage() {
  useViewing('site-detail', '현장 자세히');
  const id = Number(useParams().id);
  const { data, isPending, error } = useQuery({ queryKey: ['site', id], queryFn: () => api.site(id) });

  if (isPending) return <PageLoading />;
  if (error) return <p className="text-rose-600">{error.message}</p>;

  const { site, client, company, rates, contacts, months } = data;
  const grand = months.reduce(
    (acc, m) => ({
      supply: acc.supply + m.supplyAmount,
      vat: acc.vat + m.vatAmount,
      total: acc.total + m.totalAmount,
      count: acc.count + m.rows.length,
    }),
    { supply: 0, vat: 0, total: 0, count: 0 }
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-title font-bold">{site.label}</h1>
        <span className="text-caption text-slate-600">
          {grand.count}건 · 공급가액 {won(grand.supply)}원
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <PresenceBadge className="flex lg:hidden" />
          <Link to="/sites" className="tap inline-flex items-center rounded-xl border border-slate-300 px-3 py-2 text-caption whitespace-nowrap hover:bg-slate-50">
            현장별 보기
          </Link>
          <Link
            to={`/ledger?siteId=${site.id}`}
            className="tap inline-flex items-center rounded-xl border border-slate-300 px-3 py-2 text-caption whitespace-nowrap hover:bg-slate-50"
          >
            작업일보에서 보기
          </Link>
          <Link
            to={`/sites/${site.id}/edit`}
            className="tap inline-flex items-center rounded-xl border border-slate-300 px-3 py-2 text-caption whitespace-nowrap hover:bg-slate-50"
          >
            수정
          </Link>
          <Link
            to={`/statements/new?siteId=${site.id}`}
            className="tap inline-flex items-center rounded-xl bg-slate-900 px-4 py-2 text-caption font-medium whitespace-nowrap text-white hover:bg-slate-800"
          >
            명세표 발행하기
          </Link>
        </div>
      </div>

      {/* 현장 정보 카드 — 엑셀 현장 시트 윗부분 */}
      <div className="mb-4 grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 lg:grid-cols-[1fr_1fr_280px]">
        <div>
          <div className="text-title font-bold">{client.full_name ?? client.name}</div>
          {client.tel && (
            <div className="mt-1.5">
              <a
                href={`tel:${client.tel.replace(/[^0-9+*#]/g, '')}`}
                className="tap inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-caption font-medium text-slate-800 hover:bg-slate-200"
                title="거래처 대표번호로 전화 걸기"
              >
                <span aria-hidden="true">📞</span>
                <span>대표: {client.tel}</span>
              </a>
            </div>
          )}
          {site.prime_contractor && (
            <div className="mt-1 text-caption text-slate-600">원청: {site.prime_contractor}</div>
          )}
          {site.address && <div className="mt-2 text-caption">{site.address}</div>}
          <div className="mt-2 flex gap-4 text-caption text-slate-600">
            {site.closing_day && <span>마감일: {site.closing_day}</span>}
            {site.issue_day && <span>발행일: {site.issue_day}</span>}
          </div>
          {company && <div className="mt-2 text-caption text-slate-600">사업자 구분: {company.name}</div>}
          {site.memo && <div className="mt-2 text-caption text-slate-600">비고: {site.memo}</div>}
        </div>

        <div>
          <div className="mb-2 text-caption font-medium text-slate-600">담당자</div>
          {contacts.length ? (
            <ul className="space-y-2 text-caption">
              {contacts.map((c, i) => (
                <li key={i} className="rounded-xl border border-slate-100 bg-slate-50/70 p-2.5 sm:border-0 sm:bg-transparent sm:p-0">
                  <div className="font-semibold text-slate-900">{c.name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-slate-600 tabular">
                    {c.phone && (
                      <a
                        href={`tel:${c.phone.replace(/[^0-9+*#]/g, '')}`}
                        className="tap inline-flex items-center gap-1.5 rounded-lg bg-sky-50 px-2.5 py-1 text-caption font-semibold text-sky-800 hover:bg-sky-100 active:bg-sky-200"
                        title={`${c.name}님에게 전화 걸기`}
                      >
                        <span aria-hidden="true">📞</span>
                        <span>{c.phone}</span>
                      </a>
                    )}
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="text-caption text-slate-500 hover:underline">
                        {c.email}
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-caption text-slate-500">등록된 담당자가 없습니다.</p>
          )}
        </div>

        <div>
          <div className="mb-2 text-caption font-medium text-slate-600">M별 금액</div>
          {rates.length ? (
            <table className="w-full text-caption">
              <thead>
                <tr className="text-caption text-slate-600">
                  <th className="pb-1 text-left font-medium">M</th>
                  <th className="pb-1 text-right font-medium">반나절</th>
                  <th className="pb-1 text-right font-medium">하루</th>
                </tr>
              </thead>
              <tbody>
                {rates.map((r) => (
                  <tr key={r.boom_size}>
                    <td className="py-0.5 font-medium tabular">{r.boom_size}M</td>
                    {/* 반나절·하루 중 한쪽만 적어 둔 현장이 있다. 빈 칸에 「원」만 남지 않게 한다. */}
                    <td className="py-0.5 text-right tabular">
                      {r.half_day_amount == null ? '–' : `${won(r.half_day_amount)}원`}
                    </td>
                    <td className="py-0.5 text-right font-medium tabular">
                      {r.full_day_amount == null ? '–' : `${won(r.full_day_amount)}원`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-caption text-slate-500">
              단가가 없습니다.{' '}
              <Link to={`/sites/${site.id}/edit`} className="-m-3 inline-block p-3 text-sky-700 hover:underline">
                등록하기
              </Link>
            </p>
          )}
        </div>
      </div>

      {/* 휴대폰: 8열 표는 옆으로 밀어야 해서, 한 작업을 두 줄로 적고 달마다 합계 상자를 둔다 */}
      <div className="space-y-4 lg:hidden">
        {months.map((m) => (
          <section key={m.month} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <h2 className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-body font-bold">{monthLabel(m.month)}</h2>
            <ul className="divide-y divide-slate-100">
              {m.rows.map((row) => (
                <li key={row.id} className="px-4 py-2.5">
                  <div className="flex items-baseline gap-3">
                    <span className="shrink-0 font-bold tabular">{shortDate(row.work_date)}</span>
                    <span className="min-w-0 flex-1 break-keep">{row.description}</span>
                    <span className="shrink-0 font-medium tabular">{won(row.supply_amount)}원</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-caption text-slate-600 tabular">
                    {(row.start_time || row.end_time) && <span>{timeRange(row.start_time, row.end_time)}</span>}
                    {row.boom_size != null && <span>{row.boom_size}M</span>}
                    {row.pour_volume != null && <span>타설 {row.pour_volume}</span>}
                    {row.ot_hours > 0 && <span>OT {row.ot_hours}시간</span>}
                    {row.operator_name && <span>{row.operator_name}</span>}
                  </div>
                </li>
              ))}
            </ul>
            <dl className="space-y-1 border-t-2 border-slate-300 bg-slate-50 px-4 py-3 text-caption tabular">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-600">총금액</dt>
                <dd>{won(m.supplyAmount)}원</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-600">VAT</dt>
                <dd>{won(m.vatAmount)}원</dd>
              </div>
              <div className="flex justify-between gap-3 text-body font-bold">
                <dt>{monthLabel(m.month)} 명세표</dt>
                <dd>{won(m.totalAmount)}원</dd>
              </div>
            </dl>
          </section>
        ))}

        {!months.length && (
          <p className="rounded-2xl border border-slate-200 bg-white py-16 text-center text-slate-500">
            아직 이 현장의 작업이 없습니다.
          </p>
        )}

        {months.length > 1 && (
          <dl className="space-y-1 rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-caption tabular">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-600">총금액</dt>
              <dd>{won(grand.supply)}원</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-600">VAT</dt>
              <dd>{won(grand.vat)}원</dd>
            </div>
            <div className="flex justify-between gap-3 text-body font-bold">
              <dt>전체 합계</dt>
              <dd>{won(grand.total)}원</dd>
            </div>
          </dl>
        )}
      </div>

      {/* PC: 작업 목록 — 달마다 끊고 달 끝에 명세표 합계 */}
      <ScrollBox className="hidden rounded-2xl border border-slate-200 bg-white lg:block">
        <table className="w-full min-w-[840px] text-caption">
          <thead>
            <tr className="bg-slate-50 text-caption font-medium text-slate-600">
              {['월 일', '작 업 내 용', '작 업 시 간', '타 설', 'M', 'OT', '금 액', '기 사 님'].map((h) => (
                <th key={h} className="border-b border-slate-200 px-3 py-2 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <Fragment key={m.month}>
                {m.rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-1.5 text-center tabular">{shortDate(row.work_date)}</td>
                    <td className="px-3 py-1.5">{row.description}</td>
                    <td className="px-3 py-1.5 text-center tabular">
                      {timeRange(row.start_time, row.end_time)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular">{row.pour_volume ?? ''}</td>
                    <td className="px-3 py-1.5 text-center tabular">{row.boom_size ?? ''}</td>
                    <td className="px-3 py-1.5 text-center tabular">{row.ot_hours || ''}</td>
                    <td className="px-3 py-1.5 text-right tabular">{won(row.supply_amount)}원</td>
                    <td className="px-3 py-1.5 text-center">{row.operator_name}</td>
                  </tr>
                ))}
                <tr className="border-b-2 border-slate-300 bg-slate-50 font-medium">
                  <td className="px-3 py-2 whitespace-nowrap">{monthLabel(m.month)} 명세표</td>
                  <td />
                  <td />
                  <td className="px-3 py-2 text-right text-slate-600">총금액</td>
                  <td className="px-3 py-2 text-right tabular" colSpan={2}>
                    {won(m.supplyAmount)}원
                  </td>
                  <td className="px-3 py-2 text-right text-slate-600">
                    VAT <span className="tabular">{won(m.vatAmount)}원</span>
                  </td>
                  <td className="px-3 py-2 text-right font-bold tabular">{won(m.totalAmount)}원</td>
                </tr>
              </Fragment>
            ))}

            {!months.length && (
              <tr>
                <td colSpan={8} className="py-16 text-center text-slate-500">
                  아직 이 현장의 작업이 없습니다.
                </td>
              </tr>
            )}
          </tbody>

          {months.length > 1 && (
            <tfoot>
              <tr className="bg-slate-100 font-bold">
                <td className="px-3 py-2">전체 합계</td>
                <td colSpan={3} />
                <td className="px-3 py-2 text-right tabular" colSpan={2}>
                  {won(grand.supply)}
                </td>
                <td className="px-3 py-2 text-right text-slate-600">
                  VAT <span className="tabular">{won(grand.vat)}</span>
                </td>
                <td className="px-3 py-2 text-right tabular">{won(grand.total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </ScrollBox>
    </>
  );
}
