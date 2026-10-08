import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Loading } from './Loading';
import InfoGrid from './settings/InfoGrid';

/**
 * 거래처·현장 관리.
 * 등록만 되고 고치거나 정리할 방법이 없어서 만들었다.
 * 끝난 현장은 '보관' 으로 목록에서 빼고, 한 번도 안 쓴 현장만 지울 수 있다.
 */
export default function SitesManageTab() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const sites = useQuery({ queryKey: ['sites'], queryFn: api.sites });

  const invalidate = () => queryClient.invalidateQueries();
  const onError = (e: Error) => setError(e.message);

  const archive = useMutation({
    mutationFn: (v: { id: number; archived: boolean }) => api.archiveSite(v.id, v.archived),
    onSuccess: invalidate,
    onError,
  });
  const remove = useMutation({ mutationFn: (id: number) => api.deleteSite(id), onSuccess: invalidate, onError });

  const rows = (sites.data ?? []).filter((s) => showArchived || !s.archived);
  const archivedCount = (sites.data ?? []).filter((s) => s.archived).length;

  return (
    <>
      <p className="mb-4 text-caption text-slate-600">
        현장을 누르면 정보·단가·담당자를 고칠 수 있습니다. 끝난 현장은 「보관」으로 두면 장부와 명세표의 선택
        목록에서 빠지고, 지난 기록은 그대로 남습니다.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link
          to="/sites/new"
          className="tap inline-flex items-center rounded-xl bg-slate-900 px-4 py-2 text-caption font-medium whitespace-nowrap text-white hover:bg-slate-800"
        >
          거래처·현장 등록
        </Link>

        {archivedCount > 0 && (
          <label className="flex items-center gap-2 text-caption">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="size-5 accent-slate-900"
            />
            보관한 현장도 보기 ({archivedCount}곳)
          </label>
        )}

        <span className="text-caption text-slate-600">{rows.length}곳</span>
      </div>

      {error && (
        <p className="mb-4 anim-reveal rounded-xl bg-rose-50 px-4 py-3 text-caption text-rose-700">
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-3 text-rose-600">
            닫기
          </button>
        </p>
      )}

      <div className="space-y-2">
        {rows.map((site) => (
          <div
            key={site.id}
            className={`rounded-2xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300 md:flex md:items-center md:justify-between md:gap-6 ${
              site.archived ? 'bg-slate-50/80 opacity-60' : ''
            }`}
          >
            {/* 좌측: 현장 기본 정보, 소속, 주소 */}
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <Link
                  to={`/sites/${site.id}`}
                  className="text-body font-bold text-slate-900 hover:text-sky-700 hover:underline"
                >
                  {site.label}
                </Link>
                {site.archived ? (
                  <span className="rounded-md bg-slate-200 px-1.5 py-0.5 text-caption font-medium text-slate-600">
                    보관
                  </span>
                ) : null}
                <span className="text-caption text-slate-600">
                  {site.client_full_name ?? site.client_name}
                </span>
                <span className="ml-auto shrink-0 text-caption text-slate-600 tabular md:hidden">
                  작업 {site.work_count}건
                </span>
              </div>

              {(site.prime_contractor || site.company_name) && (
                <div className="hidden flex-wrap items-center gap-x-2 text-caption text-slate-600 md:flex">
                  {site.prime_contractor && <span>원청 {site.prime_contractor}</span>}
                  {site.prime_contractor && site.company_name && (
                    <span className="text-slate-300">|</span>
                  )}
                  {site.company_name && <span>사업자 {site.company_name}</span>}
                </div>
              )}

              {site.address && (
                <div className="hidden max-w-2xl truncate text-caption text-slate-500 md:block">
                  {site.address}
                </div>
              )}
            </div>

            {/* 휴대폰: 거래처 탭과 같은 모양 — 적힌 칸만 보인다 (단가는 없으면 채우라고 알린다) */}
            <InfoGrid
              className="md:hidden"
              items={[
                { label: '원청', value: site.prime_contractor },
                { label: '사업자', value: site.company_name },
                { label: '주소', value: site.address, wide: true },
                { label: '마감', value: site.closing_day },
                { label: '발행', value: site.issue_day },
                { label: '단가', value: site.rate_count ? `${site.rate_count}건` : '없음', warn: !site.rate_count },
                { label: '담당자', value: site.contact_count ? `${site.contact_count}명` : null },
              ]}
            />

            {/* 중간(PC): 업무 일정 및 관리 현황 */}
            <div className="hidden shrink-0 text-caption text-slate-600 md:flex md:flex-col md:items-end md:gap-1 md:text-right">
              <div className="flex items-center gap-2 tabular">
                {site.closing_day && <span>마감 {site.closing_day}</span>}
                {site.closing_day && site.issue_day && <span className="text-slate-300">·</span>}
                {site.issue_day && <span>발행 {site.issue_day}</span>}
              </div>
              <div className="flex items-center gap-2 tabular text-caption text-slate-500">
                <span className={site.rate_count ? '' : 'text-amber-700 font-medium'}>
                  단가 {site.rate_count ? `${site.rate_count}건` : '없음'}
                </span>
                <span className="text-slate-300">·</span>
                <span>담당자 {site.contact_count}명</span>
                <span className="text-slate-300">·</span>
                <span className="font-medium text-slate-700">장부 {site.work_count}건</span>
              </div>
            </div>

            {/* 우측: 액션 버튼 */}
            <div className="mt-3 flex shrink-0 items-center gap-2 md:mt-0 md:border-l md:border-slate-100 md:pl-5">
              <Link
                to={`/sites/${site.id}/edit`}
                className="tap inline-flex items-center rounded-xl border border-slate-300 px-3.5 py-1.5 text-caption font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100"
              >
                수정
              </Link>
              <button
                type="button"
                onClick={() => archive.mutate({ id: site.id, archived: !site.archived })}
                className="tap inline-flex items-center rounded-xl border border-slate-300 px-3.5 py-1.5 text-caption font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100"
              >
                {site.archived ? '되살리기' : '보관'}
              </button>
              {site.work_count === 0 && (
                <button
                  type="button"
                  onClick={() =>
                    confirm(`'${site.label}' 현장을 지울까요? 단가와 담당자도 함께 사라집니다.`) &&
                    remove.mutate(site.id)
                  }
                  className="tap rounded-xl border border-rose-200 px-3.5 py-1.5 text-caption text-rose-700 hover:bg-rose-50 max-md:ml-auto"
                >
                  삭제
                </button>
              )}
            </div>
          </div>
        ))}

        {sites.isPending && (
          <p className="rounded-2xl border border-slate-200 bg-white py-16 text-center">
            <Loading />
          </p>
        )}
        {!rows.length && !sites.isPending && (
          <p className="rounded-2xl border border-slate-200 bg-white py-16 text-center text-slate-500">
            등록된 현장이 없습니다.
          </p>
        )}
      </div>
    </>
  );
}
