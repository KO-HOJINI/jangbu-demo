import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { Client } from '../../../shared/types';
import { api } from '../../lib/api';
import { Pending } from '../Loading';
import ScrollBox from '../ScrollBox';
import InfoGrid from './InfoGrid';
import { inputClass } from './inputClass';

// ── 거래처 ──────────────────────────────────────────────────────────────
/** 휴대폰 거래처 상자의 칸 — wide 는 한 줄을 다 쓴다 */
const CLIENT_FIELDS: { key: keyof Client; label: string; wide?: boolean }[] = [
  { key: 'name', label: '약칭' },
  { key: 'ceo_name', label: '대표자' },
  { key: 'full_name', label: '정식 상호', wide: true },
  { key: 'biz_no', label: '사업자번호' },
  { key: 'tel', label: '연락처' },
  { key: 'address', label: '주소', wide: true },
];

export default function ClientsTab({ clients, usage }: { clients: Client[]; usage?: Record<string, number> }) {
  // usage 가 없으면 아직 불러오는 중 — 「0건」 대신 「–건」
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  // 휴대폰: 「수정」을 누른 거래처만 입력칸을 편다 (모두 펴 두면 한 곳이 화면 하나를 다 차지한다)
  const [editingId, setEditingId] = useState<number | null>(null);

  const update = useMutation({
    mutationFn: (v: { id: number; patch: Partial<Client> }) => api.updateClient(v.id, v.patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['masters'] }),
    onError: (e: Error) => setError(e.message),
  });
  // 보관은 소속 현장까지 바꾸므로 현장 목록·합계도 다시 불러온다
  const archive = useMutation({
    mutationFn: (v: { id: number; archived: boolean }) => api.updateClient(v.id, { archived: v.archived ? 1 : 0 }),
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (e: Error) => setError(e.message),
  });
  const toggleArchive = (client: Client) => {
    if (
      !client.archived &&
      !confirm(`'${client.name}' 거래처를 보관할까요? 소속 현장도 함께 보관되어 선택 목록에서 빠집니다.`)
    )
      return;
    archive.mutate({ id: client.id, archived: !client.archived });
  };

  const rows = clients.filter((c) => showArchived || !c.archived);
  const archivedCount = clients.filter((c) => c.archived).length;
  const archiveButton = (client: Client) => (
    <button
      type="button"
      onClick={() => toggleArchive(client)}
      className="tap inline-flex shrink-0 items-center rounded-xl border border-slate-300 px-3.5 py-1.5 text-caption font-medium whitespace-nowrap text-slate-700 hover:bg-slate-50 active:bg-slate-100"
    >
      {client.archived ? '되살리기' : '보관'}
    </button>
  );

  const cell = (client: Client, key: keyof Client, placeholder?: string) => (
    <td className="border-b border-slate-100 px-1 py-1">
      <div className="flex items-center gap-1">
        <input
          key={String(client[key])}
          type={key === 'tel' ? 'tel' : 'text'}
          defaultValue={(client[key] as string | null) ?? ''}
          placeholder={placeholder}
          onBlur={(e) => {
            const next = e.target.value.trim();
            if (next !== ((client[key] as string | null) ?? ''))
              update.mutate({ id: client.id, patch: { [key]: next || null } });
          }}
          className="w-full rounded-md px-2 py-1 text-caption outline-none focus:bg-sky-50 focus:ring-2 focus:ring-sky-400"
        />
        {key === 'tel' && client.tel && (
          <a
            href={`tel:${client.tel.replace(/[^0-9+*#]/g, '')}`}
            className="tap inline-flex shrink-0 items-center rounded-md px-2 py-1 text-sky-700 whitespace-nowrap hover:bg-sky-50"
            title={`${client.name}에 전화 걸기`}
          >
            전화
          </a>
        )}
      </div>
    </td>
  );

  return (
    <>
      <p className="mb-4 text-caption text-slate-600">
        「정식 상호」가 거래명세표의 공급받는자 칸에 찍힙니다. 「약칭」은 장부 현장 표기(<code>아라(광장)</code>)에
        쓰이며, 바꾸면 소속 현장 표기도 함께 바뀝니다. 거래가 끝난 곳은 「보관」으로 두면 소속 현장과 함께 선택
        목록에서 빠지고, 지난 기록은 그대로 남습니다.
      </p>
      {error && <p className="mb-4 anim-reveal rounded-xl bg-rose-50 px-4 py-3 text-caption text-rose-700">{error}</p>}

      {/* 새 거래처는 현장과 함께 등록한다 — 「현장」 탭과 같은 자리에 같은 버튼을 둔다 */}
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
            보관한 거래처도 보기 ({archivedCount}곳)
          </label>
        )}

        <span className="text-caption text-slate-600">{rows.length}곳</span>
      </div>

      {/* 휴대폰: 현장 탭과 같은 모양 — 적힌 칸만 보이고, 「수정」을 누르면 그 상자에 입력칸이 펴진다 */}
      <div className="space-y-2 lg:hidden">
        {rows.map((client) => {
          const editing = editingId === client.id;
          return (
            <section
              key={client.id}
              className={`rounded-2xl border border-slate-200 bg-white p-4 ${client.archived ? 'bg-slate-50/80 opacity-60' : ''}`}
            >
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <h2 className="text-body font-bold text-slate-900">{client.name}</h2>
                {client.archived ? (
                  <span className="rounded-md bg-slate-200 px-1.5 py-0.5 text-caption font-medium text-slate-600">
                    보관
                  </span>
                ) : null}
                <span className="ml-auto shrink-0 text-caption text-slate-600 tabular">
                  작업 {usage ? `${usage[client.id] ?? 0}건` : <Pending unit="건" />}
                </span>
              </div>

              {editing ? (
                <div className="mt-3 grid anim-reveal grid-cols-2 gap-3 border-t border-slate-100 pt-3">
                  {CLIENT_FIELDS.map((f) => (
                    <label key={f.key} className={`block min-w-0 ${f.wide ? 'col-span-2' : ''}`}>
                      <span className="mb-1 block text-caption font-medium text-slate-600">{f.label}</span>
                      <input
                        key={String(client[f.key])}
                        type={f.key === 'tel' ? 'tel' : 'text'}
                        inputMode={f.key === 'biz_no' ? 'numeric' : undefined}
                        defaultValue={(client[f.key] as string | null) ?? ''}
                        onBlur={(e) => {
                          const next = e.target.value.trim();
                          if (next !== ((client[f.key] as string | null) ?? ''))
                            update.mutate({ id: client.id, patch: { [f.key]: next || null } });
                        }}
                        className={inputClass}
                      />
                    </label>
                  ))}
                </div>
              ) : (
                <InfoGrid
                  items={[
                    // 정식 상호는 명세표에 찍히므로 없으면 채우라고 알린다
                    { label: '정식 상호', value: client.full_name || '없음', warn: !client.full_name, wide: true },
                    { label: '대표자', value: client.ceo_name },
                    { label: '사업자번호', value: client.biz_no },
                    { label: '연락처', value: client.tel },
                    { label: '주소', value: client.address, wide: true },
                  ]}
                />
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingId(editing ? null : client.id)}
                  aria-expanded={editing}
                  className="tap inline-flex shrink-0 items-center rounded-xl border border-slate-300 px-3.5 py-1.5 text-caption font-medium whitespace-nowrap text-slate-700 hover:bg-slate-50 active:bg-slate-100"
                >
                  {editing ? '닫기' : '수정'}
                </button>
                {archiveButton(client)}
                {client.tel && (
                  <a href={`tel:${client.tel.replace(/[^0-9+*#]/g, '')}`} className="tap inline-flex shrink-0 items-center rounded-xl border border-slate-300 px-3.5 py-1.5 text-caption font-medium whitespace-nowrap text-slate-700 hover:bg-slate-50 active:bg-slate-100">
                    전화 걸기
                  </a>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <ScrollBox className="hidden rounded-2xl border border-slate-200 bg-white lg:block">
        <table className="w-full min-w-[900px] text-caption">
          <thead>
            <tr className="bg-slate-50 text-caption font-medium text-slate-600">
              {['약칭', '정식 상호', '사업자번호', '대표자', '주소', '연락처', '작업', ''].map((h) => (
                <th key={h} className="border-b border-slate-200 px-2 py-2 text-left whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((client) => (
              <tr key={client.id} className={`hover:bg-slate-50 ${client.archived ? 'opacity-60' : ''}`}>
                {cell(client, 'name')}
                {cell(client, 'full_name', '정식 상호')}
                {cell(client, 'biz_no', '000-00-00000')}
                {cell(client, 'ceo_name')}
                {cell(client, 'address')}
                {cell(client, 'tel')}
                <td className="border-b border-slate-100 px-2 py-1 text-right whitespace-nowrap text-slate-500 tabular">
                  {usage ? `${usage[client.id] ?? 0}건` : <Pending unit="건" />}
                </td>
                <td className="border-b border-slate-100 px-2 py-1 text-right">{archiveButton(client)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollBox>
    </>
  );
}
