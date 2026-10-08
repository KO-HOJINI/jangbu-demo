import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Company } from '../../../shared/types';
import { api } from '../../lib/api';
import { archiveBlock } from '../../../shared/companyArchive';
import StampEditor from './StampEditor';
import { inputClass } from './inputClass';

// ── 내 회사 ─────────────────────────────────────────────────────────────
/** span 은 넓은 화면(1280px~)의 12칸 중 차지하는 폭 — 상호·등록번호·성명 / 주소 / 업태·종목·연락처·FAX 세 줄이 된다 */
const COMPANY_FIELDS: { key: keyof Company; label: string; wide?: boolean; span: string }[] = [
  { key: 'name', label: '상호', span: 'xl:col-span-4' },
  { key: 'biz_no', label: '등록번호', span: 'xl:col-span-4' },
  { key: 'ceo_name', label: '성명', span: 'xl:col-span-4' },
  { key: 'address', label: '사업장 소재지', wide: true, span: 'xl:col-span-12' },
  { key: 'biz_type', label: '업태', span: 'xl:col-span-2' },
  { key: 'biz_item', label: '종목', span: 'xl:col-span-3' },
  { key: 'tel', label: '연락처', span: 'xl:col-span-3' },
  { key: 'fax', label: 'FAX', span: 'xl:col-span-4' },
];

export default function CompaniesTab({ companies }: { companies: Company[] }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const update = useMutation({
    mutationFn: (v: { id: number; patch: Partial<Company> }) => api.updateCompany(v.id, v.patch),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['masters'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const [name, setName] = useState('');
  const [bizNo, setBizNo] = useState('');
  const [adding, setAdding] = useState(false);
  const closeAdding = () => {
    setAdding(false);
    setName('');
    setBizNo('');
  };
  const create = useMutation({
    mutationFn: () => api.createCompany({ name, biz_no: bizNo }),
    onSuccess: () => {
      closeAdding();
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['masters'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  /** 잘 쓰지 않는 단추라 실수로 눌러도 한 번 더 묻는다 */
  const archive = (company: Company) => {
    const blocked = archiveBlock(company, companies);
    if (blocked) return setError(blocked);
    if (
      confirm(
        `「${company.name}」을(를) 정말 보관할까요?\n보관하면 새 명세표·견적서에서 고를 수 없습니다. 이미 발행한 것은 그대로이고, 아래 「다시 쓰기」로 되살릴 수 있습니다.`
      )
    )
      update.mutate({ id: company.id, patch: { archived: 1 } });
  };

  const active = companies.filter((c) => !c.archived);
  const archived = companies.filter((c) => c.archived);

  return (
    <>
      {/* 회사 추가는 거의 안 쓰는 일이라 설명 글 오른쪽 끝에 단추 하나만 둔다. 누르면 아래에 상호·등록번호 칸이 나온다 */}
      <div className="mb-4 flex items-center gap-3">
        <p className="min-w-0 flex-1 text-caption text-slate-600">
          여기 값이 거래명세표의 공급자 칸에 그대로 찍힙니다. 「기본」으로 둔 회사가 새 명세표에서 먼저 선택됩니다.
        </p>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="shrink-0 rounded-xl bg-slate-900 px-4 py-2 text-caption font-medium whitespace-nowrap text-white hover:bg-slate-800"
          >
            회사 추가
          </button>
        )}
      </div>
      {error && <p className="mb-4 anim-reveal rounded-xl bg-rose-50 px-4 py-3 text-caption text-rose-700">{error}</p>}

      {/* 상호와 등록번호만 받고, 나머지 칸은 추가한 뒤 생긴 상자에서 채운다 */}
      {adding && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && bizNo.trim()) create.mutate();
          }}
          className="anim-reveal mb-4 flex flex-wrap gap-2"
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="새 회사 상호"
            autoFocus
            className={`${inputClass} min-w-0 flex-1 basis-full sm:max-w-56 sm:basis-auto`}
          />
          <input
            value={bizNo}
            onChange={(e) => setBizNo(e.target.value)}
            placeholder="등록번호"
            className={`${inputClass} min-w-0 flex-1 basis-full tabular sm:max-w-48 sm:basis-auto`}
          />
          <button
            type="submit"
            disabled={!name.trim() || !bizNo.trim() || create.isPending}
            className="shrink-0 rounded-xl bg-slate-900 px-4 py-2 text-caption font-medium whitespace-nowrap text-white hover:bg-slate-800 disabled:opacity-40"
          >
            추가
          </button>
          <button
            type="button"
            onClick={closeAdding}
            className="shrink-0 rounded-xl border border-slate-300 bg-white px-4 py-2 text-caption whitespace-nowrap hover:bg-slate-50"
          >
            그만두기
          </button>
        </form>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {active.map((company) => (
          <section key={company.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-4 flex items-center gap-3">
              <h2 className="font-bold">{company.name}</h2>
              <label className="ml-auto flex items-center gap-1.5 text-caption text-slate-600">
                <input
                  type="checkbox"
                  checked={Boolean(company.is_default)}
                  onChange={(e) =>
                    update.mutate({ id: company.id, patch: { is_default: e.target.checked ? 1 : 0 } })
                  }
                  className="size-4 accent-slate-900"
                />
                기본
              </label>
              <button
                type="button"
                onClick={() => archive(company)}
                className="-my-1 rounded-xl border border-slate-300 px-3 py-1.5 text-caption whitespace-nowrap text-slate-700 hover:bg-slate-50"
              >
                보관
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-12">
              {COMPANY_FIELDS.map((f) => (
                <label key={f.key} className={`block min-w-0 ${f.wide ? 'sm:col-span-2' : ''} ${f.span}`}>
                  <span className="mb-1 block text-caption font-medium text-slate-600">{f.label}</span>
                  {f.wide ? (
                    // 주소는 한 줄 칸에 다 안 들어가 휴대폰에서 뒷부분이 안 보였다. 줄이 넘어가는 칸으로 둔다.
                    // 명세표에는 한 줄로 찍히므로 저장할 때 줄바꿈은 띄어쓰기로 바꾼다.
                    <textarea
                      key={String(company[f.key])}
                      rows={1}
                      defaultValue={(company[f.key] as string | null) ?? ''}
                      onBlur={(e) => {
                        const next = e.target.value.replace(/\s*\n\s*/g, ' ').trim();
                        if (next !== ((company[f.key] as string | null) ?? ''))
                          update.mutate({ id: company.id, patch: { [f.key]: next || null } });
                      }}
                      className={`${inputClass} block min-h-[4.5rem] resize-none [field-sizing:content] xl:min-h-0`}
                    />
                  ) : (
                    <input
                      key={String(company[f.key])}
                      defaultValue={(company[f.key] as string | null) ?? ''}
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        if (next !== ((company[f.key] as string | null) ?? ''))
                          update.mutate({ id: company.id, patch: { [f.key]: next || null } });
                      }}
                      className={inputClass}
                    />
                  )}
                </label>
              ))}
            </div>

            <StampEditor company={company} />
          </section>
        ))}
      </div>

      {archived.length > 0 && (
        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 font-bold">보관한 회사</h2>
          <ul className="divide-y divide-slate-100">
            {archived.map((company) => (
              <li key={company.id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate text-body">{company.name}</span>
                <span className="shrink-0 text-caption text-slate-600 tabular max-sm:hidden">{company.biz_no}</span>
                <button
                  type="button"
                  onClick={() => update.mutate({ id: company.id, patch: { archived: 0 } })}
                  className="shrink-0 rounded-xl border border-slate-300 px-3 py-2 text-caption whitespace-nowrap hover:bg-slate-50"
                >
                  다시 쓰기
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

    </>
  );
}
