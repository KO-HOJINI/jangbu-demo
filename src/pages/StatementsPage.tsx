import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { flushSync } from 'react-dom';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Statement, StatementDraft, StatementLine, StatementManualLine } from '../../shared/types';
import { api } from '../lib/api';
import PageTitle from '../components/PageTitle';
import DocSwitch from '../components/DocSwitch';
import { today, won } from '../lib/format';
import { currentBillingPeriod, shiftBillingPeriod } from '../../shared/issueDue';
import StatementSheet, {
  type SheetEditing,
  type SheetHeader,
  type SheetLine,
  type SheetSelectors,
} from '../components/StatementSheet';
import { printWithFileName, statementFileName } from '../lib/print';
import { stampUrl } from '../lib/stamp';
import { allSitesValue, clientIdFromValue, MANUAL_SITE, siteForClient } from '../lib/siteSelect';
import { useViewing } from '../lib/presence';
import { Loading, PageLoading } from '../components/Loading';
import { SAVED, toast } from '../lib/toast';
import { useDraft } from '../lib/useDraft';
import DraftBar from '../components/DraftBar';
import EmailDialog from '../components/EmailDialog';
import SentMails from '../components/SentMails';
import { savePdf, sheetsToPdf, statementSheets } from '../lib/pdf';
import StatementSummary from '../components/StatementSummary';
import { ClashBanner } from '../components/Presence';

/**
 * 거래명세표 작업대.
 *   - 화면을 열면 곧바로 명세표가 보인다.
 *   - 공급자·공급받는자는 명세표 안에서 목록으로 고른다.
 *   - 기간과 현장은 명세표 밖에서 고르고, 고른 조건의 장부가 명세 줄로 들어온다.
 *
 * 경로가 /statements/:id 면 그 명세표(발행본)를, 아니면 새로 작성하는 상태를 보여준다.
 */
export default function StatementsPage() {
  const params = useParams();
  const statementId = params.id ? Number(params.id) : null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const masters = useQuery({ queryKey: ['masters'], queryFn: api.masters });
  const list = useQuery({ queryKey: ['statements', {}], queryFn: () => api.statements() });
  const issued = useQuery({
    queryKey: ['statement', statementId],
    queryFn: () => api.statement(statementId!),
    enabled: statementId != null,
  });

  // ── 작성 중일 때의 선택값 ──────────────────────────────────────────────
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [clientId, setClientId] = useState<number | null>(null);
  const [siteId, setSiteId] = useState('');
  // 기간은 달력의 한 달이 아니라 발행일에 맞춘 한 달이다 (25일 발행이면 지난달 26일 ~ 이번 달 25일).
  // 현장이 정해지기 전에는 25일 기준으로 두고, 현장을 고르면 그 현장의 발행일·마감일을 따른다.
  const [from, setFrom] = useState(() => currentBillingPeriod(null, today())[0]);
  const [to, setTo] = useState(() => currentBillingPeriod(null, today())[1]);
  const setPeriod = ([start, end]: [string, string]) => {
    setFrom(start);
    setTo(end);
  };
  const [issueDate, setIssueDate] = useState(today);
  const [note, setNote] = useState('');
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  // 「직접 입력」: 장부에 없는 곳의 단기 작업. 등록하지 않고 상호 칸에 찍힐 이름만 쳐 넣고,
  // 명세 줄은 손으로 적는다.
  const [manualSite, setManualSite] = useState(false);
  const [manualName, setManualName] = useState('');
  // 손으로 적은 명세 줄. 장부 줄(work_log_id, 양수)과 섞이지 않게 번호를 음수로 매긴다.
  const [manualLines, setManualLines] = useState<ManualLine[]>([]);
  const nextManualId = useRef(-1);
  const [error, setError] = useState<string | null>(null);
  // 휴대폰에서는 양식과 요약을 바꿔 볼 수 있다. 처음에는 양식 — 2026-10-03 사용자 지시 (sm 이상 화면에서는 쓰지 않는다)
  const [mobileView, setMobileView] = useState<'summary' | 'sheet'>('sheet');
  const [emailOpen, setEmailOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  /**
   * 화면의 A4 양식을 PDF 로. 휴대폰에서 요약을 보고 있으면 양식이 숨어 있어 그릴 수 없으므로
   * 잠깐 양식으로 바꿔 그린 뒤 되돌린다.
   */
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

  /** 현장 화면에서 「명세표 만들기」로 넘어왔다면 그 현장이 임시저장보다 우선한다 */
  const linkedSite = searchParams.get('siteId');
  const linkedSiteRef = useRef(linkedSite);
  linkedSiteRef.current = linkedSite;

  /** 담아 둔 것을 화면에 도로 넣는다 (불러왔을 때 · 되돌렸을 때) */
  const applyDraft = useCallback((d: StatementDraft) => {
    if (linkedSiteRef.current) return;
    setCompanyId(d.companyId);
    setClientId(d.clientId);
    setSiteId(d.siteId);
    setFrom(d.from);
    setTo(d.to);
    setIssueDate(d.issueDate);
    setNote(d.note);
    setExcluded(new Set(d.excluded));
    // 예전 임시저장에는 아래 두 값이 없다
    setManualSite(d.siteName != null);
    setManualName(d.siteName ?? '');
    const restored = (d.manualLines ?? []).map((l, i) => ({ ...l, id: -(i + 1) }));
    setManualLines(restored);
    nextManualId.current = -(restored.length + 1);
  }, []);

  /**
   * 발행 전 작성 중인 내용을 서버에 담아 둔다.
   * 브라우저가 아니라 서버라서 다른 컴퓨터에서 로그인해도 그대로 이어진다.
   */
  const draft = useDraft<StatementDraft>({
    kind: 'statement',
    enabled: statementId == null,
    ready: clientId != null,
    value: {
      companyId,
      clientId,
      siteId,
      from,
      to,
      issueDate,
      note,
      excluded: [...excluded],
      siteName: manualSite ? manualName : null,
      manualLines: manualLines.map(({ id: _id, ...line }) => line),
    },
    onLoad: applyDraft,
  });

  /**
   * 담아 둔 것이 없을 때만, 마지막에 작업한 명세표의 거래처·현장·공급자를
   * 그대로 이어받는다 (기간만 이번 달로).
   * 임시저장을 다 불러온 뒤라야 화면이 깜박이지 않는다.
   */
  useEffect(() => {
    if (!m || statementId != null || clientId != null || !draft.loaded) return;

    const querySite = searchParams.get('siteId');
    if (querySite) {
      const site = m.sites.find((s) => s.id === Number(querySite));
      if (site) {
        setSiteId(querySite);
        setPeriod(currentBillingPeriod(site, today()));
        setClientId(site.client_id);
        setCompanyId(site.company_id ?? m.companies.find((c) => c.is_default)?.id ?? m.companies.find((c) => !c.archived)?.id ?? null);
        return;
      }
    }

    if (recent) {
      setClientId(recent.client_id);
      setSiteId(recent.site_id ? String(recent.site_id) : '');
      setPeriod(currentBillingPeriod(m.sites.find((s) => s.id === recent.site_id), today()));
      setCompanyId(recent.company_id);
      return;
    }
    setCompanyId(m.companies.find((c) => c.is_default)?.id ?? m.companies.find((c) => !c.archived)?.id ?? null);
    setClientId(m.clients[0]?.id ?? null);
  }, [m, recent, statementId, clientId, searchParams, draft.loaded]);

  /** 지금 고른 현장. 「거래처 전체」·「직접 입력」이면 없다 (기간은 25일 기준) */
  const periodSite = manualSite ? undefined : m?.sites.find((s) => String(s.id) === siteId);

  // 현장을 고르면 거래처와 청구 회사, 기간이 따라온다.
  // 「○○ 전체」줄은 현장 없이 거래처만 바꾼다 (목록 값이 'client:3' 꼴로 온다).
  const chooseSite = (value: string) => {
    setExcluded(new Set());
    // 보던 달은 그대로 두고, 새로 고른 현장의 발행일에 맞춰 기간을 다시 잡는다
    const picked = m?.sites.find((s) => String(s.id) === value);
    setPeriod(shiftBillingPeriod(picked, to, 0, periodSite));
    // 「직접 입력」: 거래처도 현장도 고르지 않고 받는 곳 이름을 쳐 넣는다
    if (value === MANUAL_SITE) {
      setSiteId('');
      setManualSite(true);
      return;
    }
    setManualSite(false);
    const allOf = clientIdFromValue(value);
    if (allOf != null) {
      setSiteId('');
      setClientId(allOf);
      return;
    }
    setSiteId(value);
    const site = m?.sites.find((s) => s.id === Number(value));
    if (site) {
      setClientId(site.client_id);
      if (site.company_id) setCompanyId(site.company_id);
    }
  };

  const preview = useQuery({
    queryKey: ['statement-preview', clientId, siteId, from, to],
    queryFn: () =>
      api.statementPreview({ clientId: clientId!, siteId: siteId ? Number(siteId) : undefined, from, to }),
    // 「직접 입력」은 장부에 없는 단기 현장이라 작업일보를 찾지 않는다 — 줄은 손으로 적는다
    enabled: statementId == null && clientId != null && !manualSite,
  });

  const draftLines = useMemo(() => {
    // 발행 전 장부 줄은 빼기만 되고(locked), 손으로 적은 줄은 칸을 눌러 바로 고친다
    const ledger = manualSite
      ? []
      : (preview.data?.lines ?? [])
      .filter((l) => l.issued_statement_id == null && !excluded.has(l.work_log_id))
      .map<SheetLine>((l) => ({ ...l, id: l.work_log_id, locked: true }));
    const manual = manualLines.map<SheetLine>((l) => ({ ...l, vat_amount: Math.round(l.supply_amount * 0.1) }));
    return [...ledger, ...manual].sort((a, b) => a.work_date.localeCompare(b.work_date));
  }, [preview.data, excluded, manualSite, manualLines]);

  const draftTotals = useMemo(() => {
    const supplyAmount = draftLines.reduce((s, l) => s + l.supply_amount, 0);
    const vatAmount = Math.round(supplyAmount * 0.1);
    return { supplyAmount, vatAmount, totalAmount: supplyAmount + vatAmount };
  }, [draftLines]);

  // ── 서버 호출 ──────────────────────────────────────────────────────────
  const create = useMutation({
    mutationFn: () =>
      api.createStatement({
        company_id: companyId!,
        client_id: manualSite ? null : clientId!,
        site_id: manualSite || !siteId ? null : Number(siteId),
        issue_date: issueDate,
        period_start: from,
        period_end: to,
        // 장부 줄(양수)만 장부 번호로, 손으로 적은 줄(음수)은 내용을 그대로 보낸다
        work_log_ids: draftLines.filter((l) => l.id! > 0).map((l) => l.id!),
        manual_lines: manualLines.map(({ id: _id, ...line }) => line),
        customer_name: manualSite ? manualName.trim() || null : null,
        note: note.trim() || null,
      }),
    onSuccess: ({ id }) => {
      draft.clear();
      queryClient.invalidateQueries();
      navigate(`/statements/${id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['statement', statementId] });
  // 칸을 고치면 바로 저장된다. 저장됐다는 걸 알 수 있게 알림을 띄운다.
  const saved = () => {
    refresh();
    toast(SAVED);
  };
  const patchHeader = useMutation({
    mutationFn: (patch: Partial<Statement>) => api.updateStatement(statementId!, patch),
    onSuccess: saved,
    onError: (e: Error) => setError(e.message),
  });
  const patchLine = useMutation({
    mutationFn: (v: { lineId: number; patch: Partial<StatementLine> }) =>
      api.updateStatementLine(statementId!, v.lineId, v.patch),
    onSuccess: saved,
    onError: (e: Error) => setError(e.message),
  });
  const addLine = useMutation({
    mutationFn: () => api.addStatementLine(statementId!),
    onSuccess: saved,
    onError: (e: Error) => setError(e.message),
  });
  const deleteLine = useMutation({
    mutationFn: (lineId: number) => api.deleteStatementLine(statementId!, lineId),
    onSuccess: saved,
    onError: (e: Error) => setError(e.message),
  });
  const voidIt = useMutation({
    mutationFn: () => api.voidStatement(statementId!),
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (e: Error) => setError(e.message),
  });
  // 발행한 명세표는 바로 지우지 못한다 — 발행 취소를 한 뒤에만 지울 수 있다 (서버도 취소된 것만 지운다)
  const remove = useMutation({
    mutationFn: () => api.deleteStatement(statementId!),
    onSuccess: () => {
      navigate('/statements');
      queryClient.removeQueries({ queryKey: ['statement', statementId] });
      queryClient.invalidateQueries();
      toast('명세표를 지웠습니다');
    },
    onError: (e: Error) => setError(e.message),
  });
  const reissue = useMutation({
    mutationFn: () => api.reissueStatement(statementId!),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast('다시 발행했습니다. 칸을 눌러 고칠 수 있습니다');
    },
    onError: (e: Error) => setError(e.message),
  });
  const pay = useMutation({
    mutationFn: (input?: { paid_at?: string; paid_amount?: number | null; paid_memo?: string | null }) =>
      api.payStatement(statementId!, input),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast('✓ 입금 완료 처리되었습니다');
    },
    onError: (e: Error) => setError(e.message),
  });
  const unpay = useMutation({
    mutationFn: () => api.unpayStatement(statementId!),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast('✓ 미수금(입금 대기)으로 변경되었습니다');
    },
    onError: (e: Error) => setError(e.message),
  });

  // 다른 기기가 같은 문서를 열었는지 맞춰볼 열쇠와, 상대 화면에 보일 이름
  const viewKey = `statement:${statementId ?? 'new'}`;
  useViewing(
    viewKey,
    issued.data
      ? statementFileName(issued.data.statement)
      : ['거래명세표 작성 중', manualSite ? manualName.trim() : m?.sites.find((s) => s.id === Number(siteId))?.label]
          .filter(Boolean)
          .join(' · ')
  );

  if (!m) return <PageLoading />;
  // 지난 명세표를 여는 동안 빈 「새로 작성」 양식이 먼저 떠서 고칠 수 있어 보이던 것
  if (statementId != null && issued.isPending) return <PageLoading />;

  // ── 화면에 그릴 값 정리 ────────────────────────────────────────────────
  const company = m.companies.find((c) => c.id === companyId);
  const client = m.clients.find((c) => c.id === clientId);
  // 현장 목록은 거래처와 상관없이 전부 보여준다 (보관한 현장만 뺀다). 고르면 거래처가 따라온다.
  // 예전에는 처음 잡힌 거래처(가온, 또는 지난번 거래처)의 현장만 나와 다른 현장을 고를 수 없는 줄 알았다.
  const siteOptions = m.sites.filter((s) => !s.archived || s.id === Number(siteId));
  // 현장을 안 골랐으면 그 거래처의 「○○ 전체」 줄이 골라져 있는 것이다
  const siteSelectValue = manualSite ? MANUAL_SITE : siteId || (clientId != null ? allSitesValue(clientId) : '');
  // 파일 이름·목록에 쓰는 현장명: 고른 현장 (직접 입력은 받는 곳 이름 하나뿐이다)
  const draftSiteName = manualSite ? null : (m.sites.find((s) => s.id === Number(siteId))?.name ?? null);

  const draftHeader: SheetHeader = {
    issue_date: issueDate,
    supplier_name: company?.name ?? '',
    supplier_biz_no: company?.biz_no ?? null,
    supplier_ceo: company?.ceo_name ?? null,
    supplier_address: company?.address ?? null,
    supplier_biz_type: company?.biz_type ?? null,
    supplier_biz_item: company?.biz_item ?? null,
    customer_name: manualSite ? manualName.trim() : (client?.full_name ?? client?.name ?? ''),
    customer_site_name: draftSiteName,
    note: note.trim() || null,
  };

  const isIssued = statementId != null && issued.data != null;
  const statement = issued.data?.statement;
  const header = isIssued ? issued.data!.statement : draftHeader;
  const lines = isIssued ? (issued.data!.lines as SheetLine[]) : draftLines;
  const totals = isIssued ? issued.data!.totals : draftTotals;
  const canEdit = !isIssued || statement!.status !== 'void';
  // 도장은 발행본이면 그 명세표를 낸 회사, 작성 중이면 지금 고른 회사의 것을 찍는다
  const stamp = stampUrl(m.companies.find((c) => c.id === (isIssued ? statement!.company_id : companyId)));

  const fileName = statementFileName(
    isIssued
      ? statement!
      : {
          issue_date: issueDate,
          period_end: to,
          customer_name: draftHeader.customer_name,
          customer_site_name: draftSiteName,
        }
  );

  // 발행 전에는 명세 줄이 장부에서 그대로 오므로 빼기만 되고, 발행 후에 칸을 고칠 수 있다
  const editing: SheetEditing | undefined = !canEdit
    ? undefined
    : isIssued
      ? {
          onHeaderChange: (patch) => patchHeader.mutate(patch as Partial<Statement>),
          onLineChange: (lineId, patch) => patchLine.mutate({ lineId, patch: patch as Partial<StatementLine> }),
          onLineDelete: (lineId) => {
            if (confirm('이 줄을 명세표에서 뺄까요?\n빼면 이 작업은 장부에서 다시 「미발행」으로 돌아갑니다.')) deleteLine.mutate(lineId);
          },
          onLineAdd: () => addLine.mutate(),
        }
      : {
          onHeaderChange: (patch) => {
            if (patch.issue_date) setIssueDate(patch.issue_date);
            if ('note' in patch) setNote(patch.note ?? '');
          },
          // 장부 줄은 locked 라 여기로 오지 않는다 — 손으로 적은 줄(음수 번호)만 고친다
          onLineChange: (id, patch) =>
            setManualLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...pickManual(patch) } : l))),
          onLineDelete: (id) =>
            id < 0
              ? setManualLines((prev) => prev.filter((l) => l.id !== id))
              : setExcluded((prev) => new Set(prev).add(id)),
          // 장부에 없는 줄(임시 현장, 추가 요금 등)을 손으로 적는다. 날짜는 기간 끝날로 시작한다.
          onLineAdd: () =>
            setManualLines((prev) => [
              ...prev,
              {
                id: nextManualId.current--,
                work_date: to,
                description: null,
                start_time: null,
                end_time: null,
                ot_hours: 0,
                boom_size: null,
                supply_amount: 0,
              },
            ]),
        };

  const selectors: SheetSelectors | undefined =
    isIssued || !canEdit
      ? undefined
      : {
          // 보관한 회사는 고를 수 없다 (이미 골라 둔 것은 남긴다)
          companies: m.companies.filter((c) => !c.archived || c.id === companyId),
          clients: m.clients,
          companyId,
          clientId,
          onCompanyChange: setCompanyId,
          customerName: manualSite ? manualName.trim() || '받는 곳 이름을 적으세요' : undefined,
          // 양식에서 거래처를 바꾸면 위 현장 칸도 따라간다.
          // 그 거래처 현장이 하나뿐이면 바로 고르고, 여럿이면 어느 곳인지 알 수 없으니 「○○ 전체」로 둔다.
          onClientChange: (id) => {
            setClientId(id);
            setExcluded(new Set());
            setSiteId(siteForClient(m.sites, id));
          },
        };

  const saving =
    patchHeader.isPending || patchLine.isPending || addLine.isPending || deleteLine.isPending;

  return (
    <>
      {/* 명세표 밖 조작 막대 */}
      <PageTitle>거래명세표</PageTitle>
      <DocSwitch />

      {/* PC 넓은 화면(1280px~): 만드는 상자는 왼쪽에 붙어 따라오고 A4 양식은 오른쪽 — 양식을 보려고 아래로 내리지 않아도 된다.
          왼쪽 상자 안의 칸들은 화면 폭이 아니라 상자 폭(@container)을 보고 가로·세로 배치를 정한다.
          왼쪽이 따라오는 것은 화면 높이가 넉넉할 때(800px~)만 — 낮은 화면에서는 아래쪽이 잘려 닿지 않는다 */}
      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_calc(210mm+5rem)] xl:items-start xl:gap-4 print:block">
      <div className="xl:[@media(min-height:800px)]:sticky xl:[@media(min-height:800px)]:top-[73px]">
      <div className="@container mb-4 flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 print:hidden">
        {!isIssued && <h2 className="w-full text-body font-bold">명세표 만들기</h2>}
        {isIssued ? (
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <div className="text-caption font-medium text-slate-600">발행된 명세표</div>
              <div className="flex flex-wrap items-center gap-2 text-body font-bold">
                <span>{fileName}</span>
                {statement!.status === 'void' ? (
                  <span className="rounded-md bg-slate-200 px-2 py-0.5 text-caption font-medium text-slate-700">
                    취소됨
                  </span>
                ) : statement!.paid_at ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-caption font-bold text-emerald-800">
                    ✓ 입금 완료 ({statement!.paid_at.slice(5)})
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-caption font-bold text-rose-700">
                    미수금
                  </span>
                )}
              </div>
            </div>

            {canEdit && statement!.status !== 'void' && (
              statement!.paid_at ? (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm('입금 완료를 취소하고 미수금으로 되돌릴까요?')) unpay.mutate();
                  }}
                  disabled={unpay.isPending}
                  className="rounded-xl border border-slate-300 px-3 py-1.5 text-caption text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  {unpay.isPending ? '처리 중…' : '입금 취소'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => pay.mutate({ paid_at: today() })}
                  disabled={pay.isPending}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3.5 py-1.5 text-caption font-bold text-white hover:bg-emerald-800 disabled:opacity-40 shadow-sm"
                >
                  {pay.isPending ? '처리 중…' : '✓ 입금 완료'}
                </button>
              )
            )}
          </div>
        ) : (
          <>
            {/* 장부와 같이: 좁은 화면에서는 날짜 두 칸이 한 줄을 다 쓰고, 달 이동 버튼이 아랫줄로 내려간다 */}
            <Field label="기간" className="w-full @4xl:w-auto">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                <div className="flex w-full min-w-0 items-center gap-2 @4xl:w-auto">
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className={`${controlClass} min-w-0 flex-1 tabular @4xl:flex-none`}
                  />
                  <span className="shrink-0 text-slate-500">~</span>
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className={`${controlClass} min-w-0 flex-1 tabular @4xl:flex-none`}
                  />
                </div>
                {/* 휴대폰: 지난 달은 왼쪽 끝, 이번 달은 가운데, 다음 달은 오른쪽 끝 (작업일보와 같이) */}
                <div className="flex w-full shrink-0 justify-between gap-2 @4xl:w-auto @4xl:justify-start">
                  <button type="button" onClick={() => setPeriod(shiftBillingPeriod(periodSite, to, -1))} className={stepButtonClass}>
                    ‹ 지난 달
                  </button>
                  <button type="button" onClick={() => setPeriod(currentBillingPeriod(periodSite, today()))} className={stepButtonClass}>
                    이번 달
                  </button>
                  <button type="button" onClick={() => setPeriod(shiftBillingPeriod(periodSite, to, 1))} className={stepButtonClass}>
                    다음 달 ›
                  </button>
                </div>
              </div>
            </Field>

            {/* 휴대폰에서는 칸·단추가 제각각 폭이라 들쭉날쭉했다 — 모두 상자 폭에 맞춘다 */}
            <Field label="현장" className="w-full @4xl:w-auto">
              {/*
                거래처마다 「○○ 전체」를 그 거래처 현장들 위에 둔다.
                예전에는 「전체」가 맨 위 한 줄뿐이라 지금 고른 거래처의 전체밖에 못 골랐다
                — 다른 거래처 전체를 보려면 그 거래처 현장을 한 번 고르고 목록을 다시 열어야 했다.
                닫힌 칸에는 고른 줄의 글자만 보이므로 「전체」가 아니라 「다솜 전체」로 적는다.
              */}
              <select value={siteSelectValue} onChange={(e) => chooseSite(e.target.value)} className={`${controlClass} w-full @4xl:w-auto`}>
                {/* 장부에 없는 곳 — 받는 곳 이름을 쳐 넣고 명세 줄은 손으로 적는다 */}
                <option value={MANUAL_SITE}>직접 입력 (장부에 없는 곳)</option>
                {m.clients.map((c) => {
                  // 현장이 하나도 없는 거래처는 묶음을 만들지 않는다 (장부·견적서와 같은 규칙).
                  // 「○○ 전체」만 있는 빈 묶음을 고르면 담을 작업이 없어 0건짜리가 된다.
                  const own = siteOptions.filter((s) => s.client_id === c.id);
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

            {manualSite && (
              <Field label="받는 곳 이름" className="w-full @4xl:w-auto">
                <input
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  placeholder="명세표 상호 칸에 찍힐 이름"
                  autoFocus
                  className={`${controlClass} w-full @4xl:w-56`}
                />
              </Field>
            )}

            <div className="flex w-full items-center pb-1 text-caption text-slate-600 tabular @4xl:w-auto">
              {!manualSite && preview.isPending ? <Loading /> : `${draftLines.length}건 · ${won(draftTotals.totalAmount)}원`}
            </div>
          </>
        )}

        <div className="flex w-full flex-wrap items-end gap-2 @4xl:ml-auto @4xl:w-auto">
          <Field label="지난 명세표" className="w-full @4xl:w-auto">
            <select
              value={statementId ?? ''}
              onChange={(e) => navigate(e.target.value ? `/statements/${e.target.value}` : '/statements')}
              className={`${controlClass} w-full @4xl:w-auto`}
            >
              <option value="">새로 작성</option>
              {(list.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {statementFileName(s)}
                  {s.status === 'void' ? ' (취소)' : s.paid_at ? ' (입금완료)' : ' (미수)'}
                </option>
              ))}
            </select>
          </Field>

          {isIssued ? (
            <>
              {/* 취소한 명세표는 되살려서 고친다 — 되살리면 발행된 명세표처럼 칸을 눌러 고칠 수 있다 */}
              {!canEdit && (
                <button
                  type="button"
                  disabled={reissue.isPending}
                  onClick={() => {
                    if (confirm('취소한 이 명세표를 다시 발행할까요? 다시 발행한 뒤 칸을 눌러 고칠 수 있습니다.')) reissue.mutate();
                  }}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-caption font-medium hover:bg-slate-50 disabled:opacity-40"
                >
                  {reissue.isPending ? '다시 발행 중…' : '다시 발행'}
                </button>
              )}
              {!canEdit && (
                <button
                  type="button"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (confirm('취소한 이 명세표를 지울까요? 지우면 되돌릴 수 없습니다.')) remove.mutate();
                  }}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-caption text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                >
                  {remove.isPending ? '지우는 중…' : '삭제'}
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm('이 명세표를 취소할까요? 담겨 있던 작업은 다시 발행할 수 있게 됩니다.'))
                      voidIt.mutate();
                  }}
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
              {/* 휴대폰은 공유 창으로 (카카오톡·메일에 바로), PC 는 내려받기 */}
              <button
                type="button"
                disabled={pdfBusy}
                onClick={async () => {
                  setPdfBusy(true);
                  try {
                    await savePdf(await makePdf(), fileName);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setPdfBusy(false);
                  }
                }}
                className="rounded-xl border border-slate-300 px-4 py-2 text-caption font-medium hover:bg-slate-50 disabled:opacity-40"
              >
                {pdfBusy ? 'PDF 만드는 중…' : 'PDF 저장'}
              </button>
              <button
                type="button"
                onClick={() => printWithFileName(fileName)}
                className="rounded-xl bg-slate-900 px-4 py-2 text-caption font-medium text-white hover:bg-slate-800"
              >
                인쇄
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => create.mutate()}
              disabled={!draftLines.length || !companyId || (manualSite ? !manualName.trim() : !clientId) || create.isPending}
              className="w-full rounded-xl bg-slate-900 px-4 py-2 text-caption font-medium whitespace-nowrap text-white hover:bg-slate-800 disabled:opacity-40 @4xl:w-auto"
            >
              {create.isPending ? '발행 중…' : `명세표 발행하기 (${draftLines.length}건)`}
            </button>
          )}
        </div>
      </div>

      {emailOpen && isIssued && (
        <EmailDialog
          doc="statements"
          id={statementId!}
          fileName={fileName}
          supplierName={statement!.supplier_name}
          makePdf={makePdf}
          onClose={() => setEmailOpen(false)}
        />
      )}

      {isIssued && <SentMails doc="statements" id={statementId!} />}

      <ClashBanner viewKey={viewKey} what="명세표" />

      {!isIssued && <DraftBar draft={draft} what="명세표" />}

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

      {isIssued && issued.data!.lines.some((l) => l.changed || l.missing) && (
        <p className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-caption text-amber-900 print:hidden">
          발행 후 장부가 바뀐 줄이 있습니다. 명세표 금액은 발행 당시 그대로이며, 여기서 직접 고치거나 취소 후 다시
          발행하면 됩니다.
        </p>
      )}

      {/* 휴대폰: 처음에는 A4 양식(옆으로 밀어 본다), 글씨가 작으면 큰 글씨 목록으로 바꿔 본다.
          줄이 많으면 「요약」이 아니라서 이름은 「큰 글씨로 보기」 */}
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
          <StatementSummary
            title={fileName}
            customer={header.customer_name}
            siteName={header.customer_site_name}
            supplier={header.supplier_name}
            issueDate={header.issue_date}
            lines={lines}
            totals={totals}
            note={header.note}
            paidAt={isIssued ? statement!.paid_at : undefined}
            isVoid={isIssued && statement!.status === 'void'}
            onPay={
              isIssued && canEdit && statement!.status !== 'void'
                ? () => pay.mutate({ paid_at: today() })
                : undefined
            }
            onUnpay={
              isIssued && canEdit && statement!.status !== 'void'
                ? () => {
                    if (confirm('입금 완료를 취소하고 미수금으로 되돌릴까요?')) unpay.mutate();
                  }
                : undefined
            }
            isPending={pay.isPending || unpay.isPending}
          />
        </div>
      )}

      </div>

      {/* 인쇄는 휴대폰에서 요약을 보고 있어도 언제나 A4 양식으로 나간다 */}
      <div
        // 넓은 화면: 양식 위 안내 줄(44px + 12px)만큼 끌어올려, 양식 윗변이 왼쪽 상자 윗변과 한 줄에 온다 (안내 줄은 제목 줄 높이로 올라간다)
        className={`statement-print-area overflow-x-auto pb-4 ${editing ? 'xl:-mt-14 print:mt-0' : ''} ${mobileView === 'summary' ? 'max-sm:hidden print:block!' : ''}`}
      >
        <StatementSheet
          header={header}
          lines={lines}
          totals={totals}
          editing={editing}
          selectors={selectors}
          watermark={isIssued && statement!.status === 'void' ? '취소됨' : null}
          stampUrl={stamp}
          footerNote={
            isIssued
              ? undefined
              : manualSite
                ? '장부에 없는 현장이라 작업일보에서 불러오지 않습니다. 「+ 줄 추가」 로 날짜·작업·금액을 적으세요.'
                : '위쪽에서 기간·현장을 고르면 작업일보가 그대로 들어옵니다. 뺄 줄은 오른쪽 ✕ 를 누르세요. 작업일보에 없는 줄은 「+ 줄 추가」 로 적습니다.'
          }
        />
      </div>
      </div>
    </>
  );
}

/** 손으로 적은 명세 줄 (id 는 화면 안에서만 쓰는 음수 번호) */
type ManualLine = StatementManualLine & { id: number };

/** 양식 칸에서 고친 값 중 손으로 적은 줄에 담을 것만 */
function pickManual(patch: Partial<SheetLine>): Partial<StatementManualLine> {
  const keys = ['work_date', 'description', 'start_time', 'end_time', 'ot_hours', 'boom_size', 'supply_amount'] as const;
  return Object.fromEntries(keys.filter((k) => k in patch).map((k) => [k, patch[k]]));
}

// 휴대폰(iOS)은 글자가 16px 보다 작은 입력칸을 누르면 화면을 확대해 버린다
const controlClass = 'rounded-xl border border-slate-300 px-3 py-2 text-body';
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
