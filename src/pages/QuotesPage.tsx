import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Quote, QuoteDraft, QuoteLine } from '../../shared/types';
import { api } from '../lib/api';
import PageTitle from '../components/PageTitle';
import DocSwitch from '../components/DocSwitch';
import { today, won } from '../lib/format';
import QuoteSheet, {
  type QuoteEditing,
  type QuoteSelectors,
  type QuoteSheetHeader,
  type QuoteSheetLine,
} from '../components/QuoteSheet';
import { printWithFileName } from '../lib/print';
import { stampUrl } from '../lib/stamp';
import { siteForClient } from '../lib/siteSelect';
import { addDraftLine, changeDraftLine, linesToSend, removeDraftLine, withIds, type DraftLine } from '../lib/quoteDraft';
import { useViewing } from '../lib/presence';
import { Loading, PageLoading } from '../components/Loading';
import { SAVED, toast } from '../lib/toast';
import { useDraft } from '../lib/useDraft';
import DraftBar from '../components/DraftBar';
import { ClashBanner } from '../components/Presence';
import QuoteSummary from '../components/QuoteSummary';
import EmailDialog from '../components/EmailDialog';
import SentMails from '../components/SentMails';
import { sheetsToPdf, statementSheets } from '../lib/pdf';

/** 26년 9월 아라 광장 견적서 */
function quoteFileName(q: { issue_date: string; customer_name: string; customer_site_name?: string | null }) {
  const [year, month] = q.issue_date.split('-');
  const client = q.customer_name
    .replace(/\((주|유|합)\)|주식회사|㈜/g, '')
    .replace(/(개발|건설|산업|중기|기업)\s*$/, '')
    .trim();
  return [`${year.slice(2)}년`, `${Number(month)}월`, client, q.customer_site_name, '견적서']
    .filter(Boolean)
    .join(' ');
}

export default function QuotesPage() {
  const params = useParams();
  const quoteId = params.id ? Number(params.id) : null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const masters = useQuery({ queryKey: ['masters'], queryFn: api.masters });
  const list = useQuery({ queryKey: ['quotes'], queryFn: api.quotes });
  const issued = useQuery({
    queryKey: ['quote', quoteId],
    queryFn: () => api.quote(quoteId!),
    enabled: quoteId != null,
  });

  const [companyId, setCompanyId] = useState<number | null>(null);
  const [clientId, setClientId] = useState<number | null>(null);
  const [siteId, setSiteId] = useState('');
  const [issueDate, setIssueDate] = useState(today);
  const [note, setNote] = useState('상기 금액은 부가세 별도입니다.');
  // 발행 전에 양식에서 고친 것. 줄은 한 번이라도 고치면 단가표 대신 이것을 쓴다
  const [lineEdits, setLineEdits] = useState<DraftLine[] | null>(null);
  const [headerEdits, setHeaderEdits] = useState<Record<string, string | null>>({});
  /** 현장·거래처·공급자를 바꾸면 그 전 것을 고친 내용은 버린다 */
  const dropEdits = () => {
    setLineEdits(null);
    setHeaderEdits({});
  };
  const [error, setError] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'sheet' | 'summary'>('sheet');
  const [emailOpen, setEmailOpen] = useState(false);
  /** 메일에 붙일 PDF. 휴대폰에서 큰 글씨로 보고 있으면 양식이 숨어 있어, 뜨는 동안만 양식으로 바꾼다 (명세표와 같다) */
  const makePdf = async () => {
    const wasSummary = mobileView === 'summary';
    if (wasSummary) flushSync(() => setMobileView('sheet'));
    try {
      return await sheetsToPdf(statementSheets());
    } finally {
      if (wasSummary) setMobileView('summary');
    }
  };

  const m = masters.data;
  const recent = list.data?.[0];

  /** 현장 화면에서 넘어왔다면 그 현장이 임시저장보다 우선한다 */
  const linkedSite = searchParams.get('siteId');
  const linkedSiteRef = useRef(linkedSite);
  linkedSiteRef.current = linkedSite;

  const applyDraft = useCallback((d: QuoteDraft) => {
    if (linkedSiteRef.current) return;
    setCompanyId(d.companyId);
    setClientId(d.clientId);
    setSiteId(d.siteId);
    setIssueDate(d.issueDate);
    setNote(d.note);
    setLineEdits(d.lines ? withIds(d.lines) : null);
    setHeaderEdits(d.headerEdits ?? {});
  }, []);

  /** 발행 전 작성 중인 내용을 서버에 담아 둔다 (다른 컴퓨터에서도 이어진다) */
  const draft = useDraft<QuoteDraft>({
    kind: 'quote',
    enabled: quoteId == null,
    ready: clientId != null,
    value: { companyId, clientId, siteId, issueDate, note, lines: lineEdits, headerEdits },
    onLoad: applyDraft,
  });

  // 담아 둔 것이 없을 때만, 마지막 작업이나 URL 의 현장을 이어받는다
  useEffect(() => {
    if (!m || quoteId != null || clientId != null || !draft.loaded) return;

    const querySite = searchParams.get('siteId');
    const site = querySite ? m.sites.find((s) => s.id === Number(querySite)) : null;
    if (site) {
      setSiteId(String(site.id));
      setClientId(site.client_id);
      setCompanyId(site.company_id ?? m.companies.find((c) => c.is_default)?.id ?? m.companies.find((c) => !c.archived)?.id ?? null);
      return;
    }
    if (recent) {
      setClientId(recent.client_id);
      setSiteId(recent.site_id ? String(recent.site_id) : '');
      setCompanyId(recent.company_id);
      return;
    }
    setCompanyId(m.companies.find((c) => c.is_default)?.id ?? m.companies.find((c) => !c.archived)?.id ?? null);
    setClientId(m.clients[0]?.id ?? null);
  }, [m, recent, quoteId, clientId, searchParams, draft.loaded]);

  const chooseSite = (value: string) => {
    setSiteId(value);
    dropEdits();
    const site = m?.sites.find((s) => s.id === Number(value));
    if (site) {
      setClientId(site.client_id);
      if (site.company_id) setCompanyId(site.company_id);
    }
  };

  // 현장을 고르면 그 현장의 단가표가 견적 줄로 들어온다
  const preview = useQuery({
    queryKey: ['quote-preview', siteId],
    queryFn: () => api.quotePreview(Number(siteId)),
    enabled: quoteId == null && Boolean(siteId),
  });

  const create = useMutation({
    mutationFn: async () => {
      const made = await api.createQuote({
        company_id: companyId!,
        client_id: clientId!,
        site_id: siteId ? Number(siteId) : null,
        issue_date: issueDate,
        note: note.trim() || null,
        lines: lineEdits ? linesToSend(lineEdits) : undefined,
      });
      // 양식에서 고친 머리 칸(현장명·소재지 등)을 발행한 견적서에 덮어쓴다
      if (Object.keys(headerEdits).length) await api.updateQuote(made.id, headerEdits as Partial<Quote>);
      return made;
    },
    onSuccess: ({ id }) => {
      draft.clear();
      queryClient.invalidateQueries();
      navigate(`/quotes/${id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['quote', quoteId] });
  // 칸을 고치면 바로 저장된다. 저장됐다는 걸 알 수 있게 알림을 띄운다.
  const saved = () => {
    refresh();
    toast(SAVED);
  };
  const onError = (e: Error) => setError(e.message);

  const patchHeader = useMutation({
    mutationFn: (patch: Partial<Quote>) => api.updateQuote(quoteId!, patch),
    onSuccess: saved,
    onError,
  });
  const patchLine = useMutation({
    mutationFn: (v: { lineId: number; patch: Partial<QuoteLine> }) =>
      api.updateQuoteLine(quoteId!, v.lineId, v.patch),
    onSuccess: saved,
    onError,
  });
  const addLine = useMutation({ mutationFn: () => api.addQuoteLine(quoteId!), onSuccess: saved, onError });
  const deleteLine = useMutation({
    mutationFn: (lineId: number) => api.deleteQuoteLine(quoteId!, lineId),
    onSuccess: saved,
    onError,
  });
  const voidIt = useMutation({
    mutationFn: () => api.voidQuote(quoteId!),
    onSuccess: () => queryClient.invalidateQueries(),
    onError,
  });
  // 발행한 견적서는 바로 지우지 못한다 — 발행 취소를 한 뒤에만 지울 수 있다 (서버도 취소된 것만 지운다)
  const remove = useMutation({
    mutationFn: () => api.deleteQuote(quoteId!),
    onSuccess: () => {
      navigate('/quotes');
      queryClient.removeQueries({ queryKey: ['quote', quoteId] });
      queryClient.invalidateQueries();
      toast('견적서를 지웠습니다');
    },
    onError,
  });

  const viewKey = `quote:${quoteId ?? 'new'}`;
  useViewing(
    viewKey,
    issued.data
      ? quoteFileName(issued.data.quote)
      : ['견적서 작성 중', m?.sites.find((s) => s.id === Number(siteId))?.label].filter(Boolean).join(' · ')
  );

  if (!m) return <PageLoading />;
  // 지난 견적서를 여는 동안 빈 「새로 작성」 양식이 먼저 떠서 고칠 수 있어 보이던 것
  if (quoteId != null && issued.isPending) return <PageLoading />;

  const company = m.companies.find((c) => c.id === companyId);
  const client = m.clients.find((c) => c.id === clientId);
  const site = m.sites.find((s) => s.id === Number(siteId));
  // 현장 목록은 거래처와 상관없이 전부 보여준다 (보관한 현장만 뺀다). 고르면 거래처가 따라온다.
  // 예전에는 처음 잡힌 거래처(가온, 또는 지난번 거래처)의 현장만 나와 다른 현장을 고를 수 없는 줄 알았다.
  const siteOptions = m.sites.filter((s) => !s.archived || s.id === Number(siteId));

  const draftHeader: QuoteSheetHeader = {
    issue_date: issueDate,
    supplier_name: company?.name ?? '',
    supplier_biz_no: company?.biz_no ?? null,
    supplier_ceo: company?.ceo_name ?? null,
    supplier_address: company?.address ?? null,
    supplier_biz_type: company?.biz_type ?? null,
    supplier_biz_item: company?.biz_item ?? null,
    supplier_tel: company?.tel ?? null,
    supplier_fax: company?.fax ?? null,
    customer_name: client?.full_name ?? client?.name ?? '',
    customer_site_name: site?.name ?? null,
    customer_site_address: site?.address ?? null,
    note: note.trim() || null,
    ...headerEdits,
  };

  const draftLines: DraftLine[] = lineEdits ?? withIds(preview.data?.lines ?? []);

  const isIssued = quoteId != null && issued.data != null;
  const quote = issued.data?.quote;
  const header = isIssued ? issued.data!.quote : draftHeader;
  const lines: QuoteSheetLine[] = isIssued ? issued.data!.lines : draftLines;
  const canEdit = !isIssued || quote!.status !== 'void';
  const stamp = stampUrl(m.companies.find((c) => c.id === (isIssued ? quote!.company_id : companyId)));
  const fileName = quoteFileName(header);

  const editing: QuoteEditing | undefined = !canEdit
    ? undefined
    : isIssued
      ? {
          onHeaderChange: (patch) => patchHeader.mutate(patch as Partial<Quote>),
          onLineChange: (lineId, patch) => patchLine.mutate({ lineId, patch: patch as Partial<QuoteLine> }),
          onLineDelete: (lineId) => {
            if (confirm('이 줄을 견적서에서 뺄까요?')) deleteLine.mutate(lineId);
          },
          onLineAdd: () => addLine.mutate(),
        }
      : {
          // 발행 전에도 발행한 뒤처럼 칸을 눌러 고친다. 고친 것은 임시저장에 담기고 발행할 때 들어간다
          onHeaderChange: (patch) => {
            const { issue_date, note: nextNote, ...rest } = patch;
            if (issue_date) setIssueDate(issue_date);
            if ('note' in patch) setNote(nextNote ?? '');
            if (Object.keys(rest).length) setHeaderEdits((prev) => ({ ...prev, ...rest }));
          },
          onLineChange: (lineId, patch) => setLineEdits(changeDraftLine(draftLines, lineId, patch)),
          onLineDelete: (lineId) => setLineEdits(removeDraftLine(draftLines, lineId)),
          onLineAdd: () => setLineEdits(addDraftLine(draftLines)),
        };

  const selectors: QuoteSelectors | undefined =
    isIssued || !canEdit
      ? undefined
      : {
          // 보관한 회사는 고를 수 없다 (이미 골라 둔 것은 남긴다)
          companies: m.companies.filter((c) => !c.archived || c.id === companyId),
          clients: m.clients,
          companyId,
          clientId,
          onCompanyChange: (id) => {
            setCompanyId(id);
            setHeaderEdits({});
          },
          // 양식에서 거래처를 바꾸면 위 현장 칸도 따라간다 (명세표와 같다).
          // 그 거래처 현장이 하나뿐이면 바로 고르고, 여럿이면 어느 곳인지 알 수 없으니 비워 둔다.
          onClientChange: (id) => {
            setClientId(id);
            setSiteId(siteForClient(m.sites, id));
            dropEdits();
          },
        };

  const saving = patchHeader.isPending || patchLine.isPending || addLine.isPending || deleteLine.isPending;
  const total = lines.reduce((s, l) => s + l.supply_amount, 0);

  return (
    <>
      <PageTitle>견적서</PageTitle>
      <DocSwitch />

      {/* PC 넓은 화면(1280px~): 만드는 상자는 왼쪽에 붙어 따라오고 A4 양식은 오른쪽 — 양식을 보려고 아래로 내리지 않아도 된다.
          왼쪽 상자 안의 칸들은 화면 폭이 아니라 상자 폭(@container)을 보고 가로·세로 배치를 정한다.
          왼쪽이 따라오는 것은 화면 높이가 넉넉할 때(800px~)만 — 낮은 화면에서는 아래쪽이 잘려 닿지 않는다 */}
      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_calc(210mm+5rem)] xl:items-start xl:gap-4 print:block">
      <div className="xl:[@media(min-height:800px)]:sticky xl:[@media(min-height:800px)]:top-[73px]">
      <div className="@container mb-4 flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 print:hidden">
        {!isIssued && <h2 className="w-full text-body font-bold">견적서 만들기</h2>}
        {isIssued ? (
          <div>
            <div className="text-caption font-medium text-slate-600">발행된 견적서</div>
            <div className="text-body font-bold">
              {fileName}
              {quote!.status === 'void' && (
                <span className="ml-2 rounded-md bg-slate-200 px-2 py-0.5 text-caption font-medium text-slate-700">
                  취소됨
                </span>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* 휴대폰: 현장·발행일은 반씩, 나머지 칸·단추는 상자 폭에 맞춘다 (명세표와 같이) */}
            <Field label="현장" className="min-w-0 flex-1 @4xl:flex-none">
              {/* 명세표와 같이 거래처끼리 묶어 보여준다. 견적서는 단가표가 현장마다 달라 「전체」가 없다. */}
              <select value={siteId} onChange={(e) => chooseSite(e.target.value)} className={`${controlClass} w-full @4xl:w-auto`}>
                <option value="">{client ? `${client.name} 현장 선택` : '현장 선택'}</option>
                {m.clients.map((c) => {
                  const own = siteOptions.filter((s) => s.client_id === c.id);
                  if (!own.length) return null;
                  return (
                    <optgroup key={c.id} label={c.name}>
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

            <Field label="발행일" className="min-w-0 flex-1 @4xl:flex-none">
              <input
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className={`${controlClass} w-full tabular @4xl:w-auto`}
              />
            </Field>

            {/* 줄 수는 양식에 그대로 보이니 적지 않는다. 단가가 없다는 말은 아래 노란 안내가 한다 */}
            {(!siteId || preview.isPending) && (
              <div className="w-full pb-1 text-caption text-slate-600 @4xl:w-auto">
                {!siteId ? '현장을 고르면 그 현장 단가표가 들어옵니다' : <Loading />}
              </div>
            )}
          </>
        )}

        <div className="flex w-full flex-wrap items-end gap-2 @4xl:ml-auto @4xl:w-auto">
          <Field label="지난 견적서" className="w-full @4xl:w-auto">
            <select
              value={quoteId ?? ''}
              onChange={(e) => navigate(e.target.value ? `/quotes/${e.target.value}` : '/quotes')}
              className={`${controlClass} w-full @4xl:w-auto`}
            >
              <option value="">새로 작성</option>
              {(list.data ?? []).map((q) => (
                <option key={q.id} value={q.id}>
                  {quoteFileName(q)}
                  {q.status === 'void' ? ' (취소)' : ''}
                </option>
              ))}
            </select>
          </Field>

          {isIssued ? (
            <>
              {!canEdit && (
                <button
                  type="button"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (confirm('취소한 이 견적서를 지울까요? 지우면 되돌릴 수 없습니다.')) remove.mutate();
                  }}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-caption text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                >
                  {remove.isPending ? '지우는 중…' : '삭제'}
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => confirm('이 견적서를 취소할까요? 취소한 뒤에는 지울 수 있습니다.') && voidIt.mutate()}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-caption hover:bg-rose-50 hover:text-rose-700"
                >
                  발행 취소
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setEmailOpen(true)}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-caption font-medium hover:bg-slate-50"
                >
                  메일로 보내기
                </button>
              )}
              <button
                type="button"
                onClick={() => printWithFileName(fileName)}
                className="rounded-xl bg-slate-900 px-4 py-2 text-caption font-medium text-white hover:bg-slate-800"
              >
                인쇄 · PDF 저장
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => create.mutate()}
              disabled={!lines.length || !companyId || !clientId || create.isPending}
              className="w-full rounded-xl bg-slate-900 px-4 py-2 text-caption font-medium whitespace-nowrap text-white hover:bg-slate-800 disabled:opacity-40 @4xl:w-auto"
            >
              {create.isPending ? '발행 중…' : '견적서 발행하기'}
            </button>
          )}
        </div>
      </div>

      <ClashBanner viewKey={viewKey} what="견적서" />

      {isIssued && <SentMails doc="quotes" id={quoteId!} />}

      {emailOpen && isIssued && (
        <EmailDialog
          doc="quotes"
          id={quoteId!}
          fileName={fileName}
          supplierName={header.supplier_name}
          makePdf={makePdf}
          onClose={() => setEmailOpen(false)}
        />
      )}

      {!isIssued && <DraftBar draft={draft} what="견적서" />}

      {(error || saving) && (
        <p
          className={`mb-4 rounded-xl px-4 py-3 text-caption print:hidden ${
            error ? 'bg-rose-50 text-rose-700' : 'bg-sky-50 text-sky-700'
          }`}
        >
          {error ?? '저장 중…'}
          {error && (
            <button type="button" onClick={() => setError(null)} className="ml-3 text-rose-600">
              닫기
            </button>
          )}
        </p>
      )}

      {!isIssued && siteId && !lines.length && !preview.isPending && (
        <p className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-caption text-amber-900 print:hidden">
          이 현장에 M별 단가가 등록되어 있지 않습니다. 현장별 → 해당 현장 → 수정에서 단가표를 먼저 채워주세요.
        </p>
      )}

      {/* 휴대폰: 처음에는 A4 양식(옆으로 밀어 본다), 글씨가 작으면 큰 글씨 목록으로 바꿔 본다 */}
      <div role="group" aria-label="보기 방식" className="mb-4 flex gap-2 sm:hidden print:hidden">
        {(['sheet', 'summary'] as const).map((view) => (
          <button
            key={view}
            type="button"
            aria-pressed={mobileView === view}
            onClick={() => setMobileView(view)}
            className={`flex-1 rounded-xl border px-3 py-2 text-body font-medium ${
              mobileView === view ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700'
            }`}
          >
            {view === 'summary' ? '큰 글씨로 보기' : '양식 보기 · 고치기'}
          </button>
        ))}
      </div>

      {mobileView === 'summary' && (
        <div className="anim-reveal mb-4 sm:hidden print:hidden">
          <QuoteSummary
            title={fileName}
            customer={header.customer_name}
            siteName={header.customer_site_name}
            supplier={header.supplier_name}
            issueDate={header.issue_date}
            lines={lines}
            total={total}
            note={header.note}
            isVoid={isIssued && quote!.status === 'void'}
          />
        </div>
      )}

      </div>

      <div
        // 넓은 화면: 양식 위 안내 줄(44px + 12px)만큼 끌어올려, 양식 윗변이 왼쪽 상자 윗변과 한 줄에 온다 (안내 줄은 제목 줄 높이로 올라간다)
        className={`statement-print-area overflow-x-auto pb-4 ${editing ? 'xl:-mt-14 print:mt-0' : ''} ${mobileView === 'summary' ? 'max-sm:hidden print:block!' : ''}`}
      >
        <QuoteSheet
          header={header}
          lines={lines}
          editing={editing}
          selectors={selectors}
          watermark={isIssued && quote!.status === 'void' ? '취소됨' : null}
          stampUrl={stamp}
          footerNote={
            isIssued || !lines.length
              ? undefined
              : lineEdits
                ? `${lines.length}줄 (합계 ${won(total)}). 고친 내용은 이 견적서에만 들어가고 현장 단가표는 그대로입니다.`
                : `현장 단가표에서 자동으로 들어온 ${lines.length}줄입니다 (합계 ${won(total)}).`
          }
        />
      </div>
      </div>
    </>
  );
}

// 휴대폰(iOS)은 글자가 16px 보다 작은 입력칸을 누르면 화면을 확대해 버린다
const controlClass = 'rounded-xl border border-slate-300 px-3 py-2 text-body';

function Field({ label, className = '', children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-caption font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}
