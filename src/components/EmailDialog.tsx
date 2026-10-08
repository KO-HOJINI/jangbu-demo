import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MailAccount } from '../../shared/types';
import { api, type MailDoc } from '../lib/api';
import { blobToBase64, savePdf } from '../lib/pdf';
import ScrollBox from './ScrollBox';

const DOC_NAME: Record<MailDoc, string> = { statements: '거래명세표', quotes: '견적서' };

/** 「한강중기 (sample@naver.com)」 */
export const accountName = (a: MailAccount) => (a.label ? `${a.label} (${a.address})` : a.address);

// 공급자(내 회사)마다 마지막에 쓴 계정을 이 기기에 기억해 둔다 — 회사마다 메일 계정이 다르다
const lastUsedKey = (supplier: string) => `jangbu:mail-from:${supplier}`;
function lastUsed(supplier: string): number | null {
  try {
    const saved = window.localStorage.getItem(lastUsedKey(supplier));
    return saved == null ? null : Number(saved);
  } catch {
    return null;
  }
}
function rememberUsed(supplier: string, id: number) {
  try {
    window.localStorage.setItem(lastUsedKey(supplier), String(id));
  } catch {
    // 저장이 막힌 브라우저 — 다음에 다시 고르면 된다
  }
}

/** 처음 골라 둘 계정: 이 회사로 마지막에 쓴 것 → 이름이 회사 이름과 같은 것 → 첫 번째 */
export function defaultAccount(accounts: MailAccount[], supplier: string, remembered: number | null): MailAccount | undefined {
  return (
    accounts.find((a) => a.id === remembered) ??
    accounts.find((a) => a.label != null && a.label.trim() === supplier.trim()) ??
    accounts[0]
  );
}

/**
 * 「메일로 보내기」 창.
 *
 * 1. 보내기 — 고른 네이버 계정으로 서버가 바로 보낸다. 적은 내용과 PDF 가 그대로 간다.
 *    계정은 설정 > 계정에서 여러 개 등록해 두고 여기서 고른다.
 * 2. 네이버 메일 창으로 보내기 — PDF 를 저장하고 네이버 메일 쓰기 창을 연다.
 *    그 창은 밖에서 적은 내용을 받아 주지 않아, 받는 사람·제목·내용을 하나씩 복사해 붙여야 한다.
 * 3. 기본 메일 앱으로 열기 — 휴대폰의 메일 앱 등. 받는 사람·제목·내용은 넘어가고 PDF 는 손으로 붙인다.
 */
/**
 * 메일 제목 — 「한강중기 8월 거래명세표입니다.」 (사용자 요청 2026-10-04).
 * 회사 이름 뒤 괄호(「한강중기(샘플중기)」)는 빼고, 달은 파일 이름(「26년 8월 아라 광장」)에서 읽는다.
 */
export function mailSubject(kind: string, supplierName: string, fileName: string): string {
  const name = supplierName.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const month = /(\d+)월/.exec(fileName)?.[1];
  return [name, month && `${month}월`, `${kind}입니다.`].filter(Boolean).join(' ');
}

export default function EmailDialog({
  doc,
  id,
  fileName,
  supplierName,
  makePdf,
  onClose,
}: {
  /** 어느 문서인지 — 보낸 기록이 문서마다 따로 남는다 */
  doc: MailDoc;
  id: number;
  fileName: string;
  supplierName: string;
  makePdf: () => Promise<Blob>;
  onClose: () => void;
}) {
  const kind = DOC_NAME[doc];
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ['mail-accounts'], queryFn: api.mailAccounts });
  const suggestions = useQuery({
    queryKey: ['doc-recipients', doc, id],
    queryFn: () => api.docRecipients(doc, id),
  });

  const [accountId, setAccountId] = useState<number | null>(null);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState(() => mailSubject(kind, supplierName, fileName));
  // 내용은 비워 둔다 — 제목과 첨부만 보낸다 (사용자 요청 2026-10-04)
  const [text, setText] = useState('');
  const [step, setStep] = useState<'idle' | 'pdf' | 'sending' | 'done_naver' | 'done_default' | 'done_server'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const senders = accounts.data?.accounts ?? [];
  const account = senders.find((a) => a.id === accountId) ?? defaultAccount(senders, supplierName, lastUsed(supplierName));

  // 전에 이 거래처에 보낸 주소가 있으면 미리 넣어 둔다
  useEffect(() => {
    const previous = suggestions.data?.find((s) => s.label === '전에 보낸 주소');
    if (previous) setTo((current) => current || previous.email);
  }, [suggestions.data]);

  const list = to
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const add = (email: string) => !list.includes(email) && setTo([...list, email].join(', '));

  const copyText = async (field: string, textToCopy: string) => {
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField(null), 1500);
    } catch (e) {
      console.error('클립보드 복사 실패', e);
    }
  };

  const refreshLogs = () => {
    queryClient.invalidateQueries({ queryKey: ['doc-emails', doc, id] });
    queryClient.invalidateQueries({ queryKey: ['doc-recipients', doc, id] });
  };

  /** 고른 계정으로 서버가 바로 보낸다 */
  const send = async () => {
    if (!account) return;
    setError(null);
    try {
      setStep('pdf');
      const pdf = await makePdf();
      setStep('sending');
      await api.emailDoc(doc, id, {
        account_id: account.id,
        to: list,
        subject,
        text,
        pdf: await blobToBase64(pdf),
        filename: fileName,
      });
      rememberUsed(supplierName, account.id);
      setStep('done_server');
    } catch (e) {
      setStep('idle');
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      refreshLogs();
    }
  };

  /** PDF 를 저장하고 다른 메일 창을 연다 (네이버 메일 쓰기 창 또는 기기의 기본 메일 앱) */
  const openOutside = async (where: 'naver' | 'default') => {
    setError(null);
    try {
      setStep('pdf');
      const pdf = await makePdf();
      await savePdf(pdf, fileName);

      if (where === 'naver') {
        if (list.length) await navigator.clipboard.writeText(list.join(', ')).catch(() => {});
        window.open('https://mail.naver.com/v2/new', '_blank');
      } else {
        window.location.href = `mailto:${encodeURIComponent(list.join(','))}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
      }

      if (list.length) await api.logDocEmail(doc, id, { to: list, subject }).catch(() => {});
      setStep(where === 'naver' ? 'done_naver' : 'done_default');
    } catch (e) {
      setStep('idle');
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      refreshLogs();
    }
  };

  const busy = step === 'pdf' || step === 'sending';
  const done = step === 'done_naver' || step === 'done_default' || step === 'done_server';

  // 닫을 때는 온 길로 나간다 (index.css 의 is-leaving, 200ms) — 그 움직임이 끝난 뒤에 창을 없앤다
  const [leaving, setLeaving] = useState(false);
  const close = () => {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(onClose, 200);
  };

  const closeButton = (
    <button
      type="button"
      onClick={close}
      className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-body font-medium text-white hover:bg-slate-800"
    >
      닫기
    </button>
  );

  // 화면 맨 바깥(body)에 그린다. 부른 자리(명세표 만들기 상자) 안에 그리면 그 상자의 겹침 순서에 묶여
  // 옆의 A4 양식이 창을 덮었다
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="메일로 보내기"
      className={`anim-overlay fixed inset-0 z-50 grid place-items-end bg-slate-900/40 sm:place-items-center sm:p-4 print:hidden ${leaving ? 'is-leaving' : ''}`}
      onClick={(e) => e.target === e.currentTarget && !busy && close()}
    >
      <ScrollBox
        className="anim-drawer w-full rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-2xl"
        viewClassName="max-h-[90dvh] overflow-y-auto overscroll-contain p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-5"
      >
        <h2 className="mb-4 text-lead font-bold text-slate-900">메일로 보내기</h2>

        {step === 'done_server' && (
          <div className="space-y-4">
            <p className="rounded-xl bg-emerald-50 px-3 py-3 text-body text-emerald-800">
              {account?.address} 에서 {list.join(', ')} 에 보냈습니다.
            </p>
            {/* 네이버 메일의 「보낸메일함」 — 서버가 보낸 메일도 그 계정의 보낸메일함에 남는다 */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => window.open('https://mail.naver.com/v2/folders/1', '_blank')}
                className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-body font-medium text-slate-800 hover:bg-slate-50"
              >
                보낸 메일 확인하기
              </button>
              <div className="flex-1">{closeButton}</div>
            </div>
          </div>
        )}

        {step === 'done_naver' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="font-bold text-body text-emerald-900">
                네이버 메일 창을 열고 {kind} PDF 를 저장했습니다.
              </p>
              <div className="mt-2.5 space-y-1.5 text-caption text-emerald-800">
                <p>1. 아래에서 하나씩 <b>복사</b>해 네이버 메일 창의 같은 칸에 <b>붙여 넣으세요</b>.</p>
                <p>2. 네이버 메일 창에서 <b>[내 PC]</b> 또는 <b>[파일 첨부]</b>를 눌러 방금 저장된 <b>{fileName}.pdf</b>를 첨부하세요.</p>
                <p>3. <b>[보내기]</b>를 누르면 거래처로 갑니다.</p>
              </div>
            </div>
            {/* 네이버 메일 창은 밖에서 적은 내용을 받아 주지 않는다. 적은 것을 그대로 남겨 두고 칸마다 복사하게 한다 */}
            <dl className="space-y-2">
              {[
                { field: 'to', label: '받는 사람', value: list.join(', ') },
                { field: 'subject', label: '제목', value: subject },
                { field: 'text', label: '내용', value: text },
              ].map(({ field, label, value }) => (
                <div key={field} className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
                  <div className="min-w-0 flex-1">
                    <dt className="text-caption font-medium text-slate-600">{label}</dt>
                    <dd className="text-body break-words whitespace-pre-wrap text-slate-900">{value || '-'}</dd>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyText(field, value)}
                    disabled={!value}
                    aria-label={`${label} 복사`}
                    className="min-h-11 shrink-0 rounded-xl border border-slate-300 bg-white px-4 text-caption font-medium whitespace-nowrap text-slate-800 hover:bg-slate-50 disabled:opacity-40"
                  >
                    {copiedField === field ? '복사됨' : '복사'}
                  </button>
                </div>
              ))}
            </dl>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => window.open('https://mail.naver.com/v2/new', '_blank')}
                className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-body font-medium text-slate-800 hover:bg-slate-50"
              >
                네이버 메일 창 다시 열기
              </button>
              <div className="flex-1">{closeButton}</div>
            </div>
          </div>
        )}

        {step === 'done_default' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="font-bold text-body text-emerald-900">메일 앱을 열고 {kind} PDF 를 저장했습니다.</p>
              <p className="mt-2 text-caption text-emerald-800">
                메일 앱에서 방금 저장된 <b>{fileName}.pdf</b> 를 첨부해 보내 주세요.
              </p>
            </div>
            {closeButton}
          </div>
        )}

        {!done && (
          <div className="space-y-3">
            {/* 어느 계정으로 보낼지 먼저 고른다 */}
            {senders.length > 0 ? (
              <label className="block">
                <span className="mb-1 block text-caption font-medium text-slate-600">보내는 계정</span>
                <select
                  value={account?.id ?? ''}
                  onChange={(e) => setAccountId(Number(e.target.value))}
                  disabled={busy}
                  className={inputClass}
                >
                  {senders.map((a) => (
                    <option key={a.id} value={a.id}>
                      {accountName(a)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              !accounts.isPending && (
                <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-caption text-amber-900">
                  보내는 네이버 계정이 아직 없습니다.{' '}
                  <Link to="/settings?tab=account" className="font-bold underline">
                    설정 &gt; 계정
                  </Link>
                  에서 등록하면 여기서 바로 보낼 수 있습니다.
                </p>
              )
            )}

            <label className="block">
              <span className="mb-1 block text-caption font-medium text-slate-600">받는 사람 (여럿이면 쉼표로)</span>
              <input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                inputMode="email"
                placeholder="name@example.com"
                className={inputClass}
              />
            </label>

            {(suggestions.data?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-2">
                {suggestions.data!.map((s) => (
                  <button
                    key={s.email}
                    type="button"
                    onClick={() => add(s.email)}
                    disabled={list.includes(s.email)}
                    title={s.label}
                    className="rounded-full border border-slate-300 px-3 py-1 text-caption hover:bg-slate-50 disabled:opacity-40"
                  >
                    + {s.email} <span className="text-slate-600">({s.label})</span>
                  </button>
                ))}
              </div>
            )}

            <label className="block">
              <span className="mb-1 block text-caption font-medium text-slate-600">제목</span>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} className={inputClass} />
            </label>

            <label className="block">
              <span className="mb-1 block text-caption font-medium text-slate-600">내용</span>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className={inputClass} />
            </label>

            <p className="text-caption text-slate-600">첨부: {fileName}.pdf</p>

            {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-caption text-rose-700">{error}</p>}

            <div className="space-y-2 pt-1">
              {senders.length > 0 && (
                <button
                  type="button"
                  onClick={send}
                  disabled={busy || !list.length}
                  className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-body font-medium text-white hover:bg-slate-800 disabled:opacity-40"
                >
                  {step === 'pdf' ? 'PDF 만드는 중…' : step === 'sending' ? '보내는 중…' : '보내기'}
                </button>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => openOutside('naver')}
                  disabled={busy}
                  className={
                    senders.length > 0
                      ? outsideButton
                      : 'w-full rounded-xl bg-slate-900 px-4 py-2.5 text-body font-medium text-white hover:bg-slate-800 disabled:opacity-40'
                  }
                >
                  {senders.length === 0 && step === 'pdf' ? 'PDF 만드는 중…' : '네이버 메일 창으로 보내기'}
                </button>
                <button type="button" onClick={() => openOutside('default')} disabled={busy} className={outsideButton}>
                  기본 메일 앱으로 열기
                </button>
                <button
                  type="button"
                  onClick={close}
                  disabled={busy}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-caption text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        )}
      </ScrollBox>
    </div>,
    document.body
  );
}

// 휴대폰(iOS)은 16px 보다 작은 입력칸을 누르면 화면을 확하늘다
const inputClass =
  'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-body outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200';

const outsideButton =
  'flex-1 rounded-xl border border-slate-300 px-4 py-2 text-caption font-medium whitespace-nowrap text-slate-700 hover:bg-slate-50 disabled:opacity-40';
