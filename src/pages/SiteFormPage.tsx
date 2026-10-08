import { Fragment, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { SiteContact, SiteInput, SiteRate } from '../../shared/types';
import { api } from '../lib/api';
import { useViewing } from '../lib/presence';
import { duplicateSite, fullNameChange, knownClient, siteLabel } from '../lib/siteDuplicate';
import { PageLoading } from '../components/Loading';
import { PresenceBadge } from '../components/Presence';

/** 새 현장을 등록할 때 미리 깔아두는 규격 — 전부 고쳐 쓸 수 있는 그냥 초깃값이다 */
const DEFAULT_BOOMS = ['26', '32', '37', '42'];

type RateDraft = { boom: string; half: string; full: string };
type ContactDraft = { name: string; phone: string; email: string };

const emptyContact = (): ContactDraft => ({ name: '', phone: '', email: '' });

export default function SiteFormPage() {
  useViewing('site-form', '현장 등록·수정');
  const params = useParams();
  const siteId = params.id ? Number(params.id) : null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const masters = useQuery({ queryKey: ['masters'], queryFn: api.masters });
  // 같은 이름의 현장이 이미 있는지 저장 전에 알리려고 현장 목록도 받는다 (설정 > 현장과 같은 열쇠)
  const siteList = useQuery({ queryKey: ['sites'], queryFn: api.sites });
  const existing = useQuery({
    queryKey: ['site', siteId],
    queryFn: () => api.site(siteId!),
    enabled: siteId != null,
  });

  const [form, setForm] = useState({
    prime_contractor: '',
    client_name: '',
    client_full_name: '',
    name: '',
    label: '',
    address: '',
    closing_day: '',
    issue_day: '',
    company_id: '',
    memo: '',
  });
  const [rates, setRates] = useState<RateDraft[]>(
    DEFAULT_BOOMS.map((boom) => ({ boom, half: '', full: '' }))
  );
  const [contacts, setContacts] = useState<ContactDraft[]>([emptyContact()]);

  // 수정 화면이면 기존 값을 채워 넣는다
  useEffect(() => {
    const d = existing.data;
    if (!d) return;
    setForm({
      prime_contractor: d.site.prime_contractor ?? '',
      client_name: d.client.name,
      client_full_name: d.client.full_name ?? '',
      name: d.site.name,
      label: d.site.label,
      address: d.site.address ?? '',
      closing_day: d.site.closing_day ?? '',
      issue_day: d.site.issue_day ?? '',
      company_id: d.site.company_id ? String(d.site.company_id) : '',
      memo: d.site.memo ?? '',
    });

    // 이미 등록된 단가만 그대로 보여준다. 없으면 흔히 쓰는 규격을 초깃값으로 깔아준다.
    setRates(
      d.rates.length
        ? d.rates
            .slice()
            .sort((a, b) => a.boom_size - b.boom_size)
            .map((r) => ({
              boom: String(r.boom_size),
              half: r.half_day_amount != null ? String(r.half_day_amount) : '',
              full: r.full_day_amount != null ? String(r.full_day_amount) : '',
            }))
        : DEFAULT_BOOMS.map((boom) => ({ boom, half: '', full: '' }))
    );
    setContacts(
      d.contacts.length
        ? d.contacts.map((c) => ({ name: c.name, phone: c.phone ?? '', email: c.email ?? '' }))
        : [emptyContact()]
    );
  }, [existing.data]);

  const set = (field: keyof typeof form, value: string) => setForm((f) => ({ ...f, [field]: value }));

  const toInput = (): SiteInput => ({
    client_name: form.client_name.trim(),
    client_full_name: form.client_full_name.trim() || null,
    name: form.name.trim(),
    label: form.label.trim() || null,
    prime_contractor: form.prime_contractor.trim() || null,
    address: form.address.trim() || null,
    company_id: form.company_id ? Number(form.company_id) : null,
    closing_day: form.closing_day.trim() || null,
    issue_day: form.issue_day.trim() || null,
    memo: form.memo.trim() || null,
    // 규격을 적었고 금액이 하나라도 있는 줄만 저장한다. 같은 규격을 두 번 적으면 뒤엣것이 이긴다.
    rates: [
      ...new Map(
        rates
          .map<SiteRate>((r) => ({
            boom_size: Number(r.boom.replace(/[^\d.]/g, '')),
            half_day_amount: r.half.trim() ? Number(r.half.replace(/,/g, '')) : null,
            full_day_amount: r.full.trim() ? Number(r.full.replace(/,/g, '')) : null,
          }))
          .filter((r) => r.boom_size > 0 && (r.half_day_amount != null || r.full_day_amount != null))
          .map((r) => [r.boom_size, r])
      ).values(),
    ].sort((a, b) => a.boom_size - b.boom_size),
    contacts: contacts
      .filter((c) => c.name.trim())
      .map<SiteContact>((c) => ({
        name: c.name.trim(),
        phone: c.phone.trim() || null,
        email: c.email.trim() || null,
      })),
  });

  const save = useMutation({
    mutationFn: () => (siteId ? api.updateSite(siteId, toInput()) : api.createSite(toInput())),
    onSuccess: (site) => {
      queryClient.invalidateQueries();
      navigate(`/sites/${site.id}`);
    },
  });

  const m = masters.data;
  // 장부 표기는 비워두면 자동으로 만들어진다 — 미리 보여준다
  const previewLabel = siteLabel(form.client_name, form.name, form.label);

  // 저장 전에 미리 알리는 것 — 같은 표기의 현장, 이미 있는 거래처, 바뀌는 정식 상호 (src/lib/siteDuplicate.ts)
  const duplicate = duplicateSite(previewLabel, siteList.data ?? [], siteId);
  const sameClient = knownClient(form.client_name, m?.clients ?? []);
  const renamed = fullNameChange(sameClient, form.client_full_name);

  // 고칠 현장 정보가 오기 전에는 빈 칸이 떠서 새로 쓰는 것처럼 보였다
  if (siteId != null && existing.isPending) return <PageLoading />;

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-title font-bold">{siteId ? '거래처·현장 수정' : '거래처·현장 등록'}</h1>
        <Link to="/sites" className="text-caption text-slate-600 hover:text-slate-900">
          현장별 보기
        </Link>
        <PresenceBadge className="ml-auto flex lg:hidden" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-4 text-body font-bold text-slate-600">현장 정보</h2>

          {/* PC 는 세 칸씩 놓아 화면을 내리지 않고 한눈에 적는다 */}
          {/* 휴대폰은 한 줄에 한 칸, 짧은 마감일·발행일만 둘이 나란히 (half) */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:gap-4 lg:grid-cols-3">
            <Field label="원청" hint="샘플건설, 예시건설 …">
              <input
                value={form.prime_contractor}
                onChange={(e) => set('prime_contractor', e.target.value)}
                className={inputClass}
              />
            </Field>

            <Field label="건설회사" hint="정식 상호 — 명세표에 찍힙니다" required>
              <input
                value={form.client_full_name}
                onChange={(e) => set('client_full_name', e.target.value)}
                placeholder="아라개발(주)"
                className={inputClass}
              />
            </Field>

            <Field label="거래처 약칭" hint="장부에 쓰는 짧은 이름" required>
              <input
                value={form.client_name}
                onChange={(e) => set('client_name', e.target.value)}
                list="client-names"
                // 이미 있는 거래처를 골랐으면 정식 상호를 채워 준다 (다르게 적어 말없이 바뀌는 일을 줄인다)
                onBlur={() => {
                  if (sameClient?.full_name && !form.client_full_name.trim())
                    set('client_full_name', sameClient.full_name);
                }}
                placeholder="아라"
                className={inputClass}
              />
              <datalist id="client-names">
                {m?.clients.filter((c) => !c.archived).map((c) => (
                  <option key={c.id} value={c.name} />
                ))}
              </datalist>
            </Field>

            <Field label="현장 이름" required>
              <input
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="부천"
                className={inputClass}
              />
            </Field>

            <Field label="현장 주소" className="sm:col-span-2">
              <input
                value={form.address}
                onChange={(e) => set('address', e.target.value)}
                placeholder="샘플 고속도로 2공구"
                className={inputClass}
              />
            </Field>

            <Field label="마감일" half>
              <input
                value={form.closing_day}
                onChange={(e) => set('closing_day', e.target.value)}
                placeholder="25일"
                className={inputClass}
              />
            </Field>

            <Field label="발행일" half>
              <input
                value={form.issue_day}
                onChange={(e) => set('issue_day', e.target.value)}
                placeholder="25일"
                className={inputClass}
              />
            </Field>

            <Field label="사업자 구분" hint="이 현장을 어느 회사로 청구하는지">
              <select
                value={form.company_id}
                onChange={(e) => set('company_id', e.target.value)}
                className={inputClass}
              >
                <option value="">선택 안 함</option>
                {m?.companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="장부 표기" hint="비워두면 자동으로 만들어집니다">
              <input
                value={form.label}
                onChange={(e) => set('label', e.target.value)}
                placeholder={previewLabel || '아라(부천)'}
                className={inputClass}
              />
            </Field>

            <Field label="비고" className="sm:col-span-2">
              <input value={form.memo} onChange={(e) => set('memo', e.target.value)} className={inputClass} />
            </Field>
          </div>

          {duplicate ? (
            <div className="mt-4 anim-reveal rounded-xl bg-rose-50 px-4 py-3 text-caption text-rose-700">
              <p className="font-medium">「{duplicate.label}」 현장이 이미 있습니다.</p>
              <p className="mt-1 text-slate-700">
                {[
                  duplicate.client_full_name ?? duplicate.client_name,
                  duplicate.prime_contractor && `원청 ${duplicate.prime_contractor}`,
                  duplicate.address,
                  `작업 ${duplicate.work_count}건`,
                  duplicate.archived ? '보관 중' : null,
                ]
                  .filter(Boolean)
                  .join(' / ')}
              </p>
              <p className="mt-1 text-slate-700">
                다른 곳이면 현장 이름을 다르게 적어 주세요. 같은 곳이면 아래 단추로 그 현장을 고칩니다.
              </p>
              <Link
                to={`/sites/${duplicate.id}/edit`}
                className="tap mt-2 inline-flex items-center rounded-xl border border-slate-300 bg-white px-3.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
              >
                이 현장 고치러 가기
              </Link>
            </div>
          ) : (
            !siteId &&
            sameClient && (
              <p className="mt-4 text-caption text-slate-600">
                이미 있는 거래처 「{sameClient.full_name ?? sameClient.name}」에 현장을 추가합니다.
              </p>
            )
          )}
          {renamed && (
            <p className="mt-4 anim-reveal rounded-xl bg-amber-50 px-4 py-3 text-caption text-amber-800">
              저장하면 거래처 정식 상호가 「{renamed.from}」에서 「{renamed.to}」(으)로 바뀝니다. 이 거래처의 다른 현장
              명세표에도 바뀐 이름이 찍힙니다.
            </p>
          )}

          <h2 className="mt-6 mb-3 text-body font-bold text-slate-600 lg:mt-4">담당자</h2>
          <div className="space-y-2">
            {contacts.map((c, i) => (
              // 휴대폰: 이름·전화를 한 줄에, 메일과 지우기를 그 밑 한 줄에 (한 줄에 넷을 넣으면 이름·메일 칸이 글자 하나 폭이 된다)
              <div
                key={i}
                className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] gap-2 max-sm:border-b max-sm:border-slate-200 max-sm:pb-3 sm:grid-cols-[minmax(0,1fr)_170px_minmax(0,1fr)_auto]"
              >
                <input
                  value={c.name}
                  onChange={(e) =>
                    setContacts((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                  }
                  placeholder="관리부장 김철수"
                  className={inputClass}
                />
                <input
                  type="tel"
                  value={c.phone}
                  onChange={(e) =>
                    setContacts((prev) => prev.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))
                  }
                  placeholder="010-0000-0000"
                  className={`${inputClass} tabular max-sm:col-span-2 max-sm:px-2`}
                />
                <input
                  value={c.email}
                  onChange={(e) =>
                    setContacts((prev) => prev.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))
                  }
                  placeholder="name@example.com"
                  inputMode="email"
                  autoCapitalize="none"
                  className={`${inputClass} max-sm:col-span-2`}
                />
                <button
                  type="button"
                  onClick={() => setContacts((prev) => prev.filter((_, j) => j !== i))}
                  className="rounded-md px-2 text-slate-500 hover:bg-rose-50 hover:text-rose-600 max-lg:min-w-11"
                  title="삭제"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setContacts((prev) => [...prev, emptyContact()])}
              className="rounded-xl border border-slate-300 px-4 py-2.5 text-caption hover:bg-slate-50"
            >
              + 담당자 추가
            </button>
          </div>
        </section>

        {/* M별 금액 */}
        <section className="h-fit rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-1 text-body font-bold text-slate-600">M별 금액</h2>
          <p className="mb-3 text-caption text-slate-600">
            장부에 규격을 넣으면 이 금액이 채워집니다.
          </p>

          <div className="grid grid-cols-[72px_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
            <span className="text-caption font-medium text-slate-600">M</span>
            <span className="text-right text-caption font-medium text-slate-600">반나절</span>
            <span className="text-right text-caption font-medium text-slate-600">하루</span>
            <span />

            {rates.map((r, i) => {
              const set = (patch: Partial<RateDraft>) =>
                setRates((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              const duplicate =
                r.boom.trim() !== '' && rates.some((x, j) => j !== i && x.boom.trim() === r.boom.trim());

              return (
                <Fragment key={i}>
                  <input
                    value={r.boom}
                    inputMode="numeric"
                    placeholder="42"
                    onChange={(e) => set({ boom: e.target.value })}
                    className={`${inputClass} text-center tabular ${duplicate ? 'border-amber-500' : ''}`}
                    title={duplicate ? '같은 규격이 두 번 적혀 있습니다' : undefined}
                  />
                  <input
                    value={r.half}
                    inputMode="numeric"
                    onChange={(e) => set({ half: e.target.value })}
                    className={`${inputClass} text-right tabular`}
                  />
                  <input
                    value={r.full}
                    inputMode="numeric"
                    onChange={(e) => set({ full: e.target.value })}
                    className={`${inputClass} text-right tabular`}
                  />
                  <button
                    type="button"
                    onClick={() => setRates((prev) => prev.filter((_, j) => j !== i))}
                    className="rounded-md px-2 py-1 text-slate-500 hover:bg-rose-50 hover:text-rose-600 max-lg:min-w-11"
                    title="이 줄 지우기"
                  >
                    ✕
                  </button>
                </Fragment>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setRates((prev) => [...prev, { boom: '', half: '', full: '' }])}
            className="mt-3 rounded-xl border border-slate-300 px-3 py-2 text-caption hover:bg-slate-50"
          >
            + 규격 추가
          </button>

          <p className="mt-2 text-caption text-slate-500">
            금액을 안 적은 줄은 저장하지 않습니다.
          </p>
        </section>
      </div>

      {save.error && (
        <p className="mt-4 anim-reveal rounded-xl bg-rose-50 px-4 py-3 text-caption text-rose-700">{save.error.message}</p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={!form.client_name.trim() || !form.name.trim() || !!duplicate || save.isPending}
          className="rounded-xl bg-slate-900 px-8 py-2 text-body font-medium text-white hover:bg-slate-800 disabled:opacity-40"
        >
          {save.isPending ? '저장 중…' : '저장'}
        </button>
        {previewLabel && (
          <span className="text-caption text-slate-600">
            장부에는 <strong className="text-slate-900">{previewLabel}</strong> 로 표시됩니다
          </span>
        )}
      </div>
    </>
  );
}

// 휴대폰(iOS)은 글자가 16px 보다 작은 입력칸을 누르면 화면을 확대해 버린다
const inputClass =
  'w-full rounded-xl border border-slate-300 px-3 py-2 text-body outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200';

function Field({
  label,
  hint,
  required,
  half,
  className = '',
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  /** 휴대폰에서 옆 칸과 한 줄을 나눠 쓴다 */
  half?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block min-w-0 ${half ? '' : 'max-sm:col-span-2'} ${className}`}>
      <span className="mb-1 block text-caption font-medium text-slate-600">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
        {hint && <span className="ml-2 font-normal text-slate-500">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
