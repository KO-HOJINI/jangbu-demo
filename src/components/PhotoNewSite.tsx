import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Masters } from '../../shared/types';
import { api } from '../lib/api';
import { newSiteDraft, type PhotoRow } from '../lib/photoLog';
import { duplicateSite, knownClient, siteLabel } from '../lib/siteDuplicate';

/**
 * 사진 확인 창에서 바로 새 현장(과 거래처) 추가.
 * 확인서에 처음 보는 거래처·현장이 적혀 있으면, 장부 화면을 떠나지 않고 이름만 확인해 만든다.
 * 사진에서 읽은 글자를 채워 두지만 손글씨라 틀릴 수 있어, 저장은 반드시 눈으로 보고 누르게 한다.
 * 확인서의 세 칸(건설업자·현장명·현장소재지)을 그대로 거래처·현장 이름·주소로 받는다. 원청·단가·담당자·마감일은 나중에 현장 화면에서 채운다.
 */
export default function PhotoNewSite({
  row,
  masters,
  onPicked,
  onCancel,
}: {
  row: PhotoRow;
  masters: Masters;
  /** 만든(또는 이미 있던) 현장을 이 줄에 고른다 */
  onPicked: (siteId: number) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => newSiteDraft(row, masters));
  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const label = siteLabel(form.client_name, form.name, '');
  const duplicate = duplicateSite(label, masters.sites, null);
  const client = knownClient(form.client_name, masters.clients);

  const save = useMutation({
    mutationFn: () =>
      api.createSite({
        client_name: form.client_name.trim(),
        name: form.name.trim(),
        address: form.address.trim() || null,
      }),
    onSuccess: async (site) => {
      // 현장 목록이 새로 온 뒤에 골라야 고르는 칸에 이름이 보인다
      await queryClient.invalidateQueries({ queryKey: ['masters'] });
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      onPicked(site.id);
    },
  });

  return (
    <div
      className="anim-reveal rounded-xl border border-slate-300 bg-white p-3 text-left"
      onKeyDown={(e) => {
        // 바깥 「새 작업 추가」 상자의 Enter(추가하기)로 넘어가지 않게
        if (e.key === 'Enter') e.stopPropagation();
      }}
    >
      <p className="mb-2 text-caption font-bold text-slate-900">새 현장으로 추가</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="block min-w-0">
          <span className="mb-0.5 block text-caption text-slate-600">건설회사 (거래처)</span>
          <input
            value={form.client_name}
            list="photo-new-site-clients"
            onChange={(e) => set('client_name', e.target.value)}
            placeholder="아라"
            className={input}
          />
          <datalist id="photo-new-site-clients">
            {masters.clients
              .filter((c) => !c.archived)
              .map((c) => (
                <option key={c.id} value={c.name} />
              ))}
          </datalist>
        </label>
        <label className="block min-w-0">
          <span className="mb-0.5 block text-caption text-slate-600">현장 이름</span>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="광장" className={input} />
        </label>
        <label className="block min-w-0">
          <span className="mb-0.5 block text-caption text-slate-600">현장 주소</span>
          <input value={form.address} onChange={(e) => set('address', e.target.value)} className={input} />
        </label>
      </div>

      {duplicate ? (
        <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-caption text-rose-700">
          「{duplicate.label}」 현장이 이미 있습니다{duplicate.archived ? ' (보관 중 — 설정 > 현장에서 꺼내 주세요)' : ''}.
        </p>
      ) : (
        label && (
          <p className="mt-2 text-caption text-slate-700">
            장부에는 「{label}」 로 적힙니다.
            {!client && ` 「${form.client_name.trim()}」 은 새 거래처로 등록됩니다.`}
          </p>
        )
      )}
      {save.error && (
        <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-caption text-rose-700">
          {save.error instanceof Error ? save.error.message : String(save.error)}
        </p>
      )}

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-caption font-medium text-slate-800 hover:bg-slate-50"
        >
          취소
        </button>
        {duplicate && !duplicate.archived ? (
          <button
            type="button"
            onClick={() => onPicked(duplicate.id)}
            className="min-h-11 rounded-xl bg-slate-900 px-4 text-caption font-medium text-white hover:bg-slate-800"
          >
            이 현장으로 고르기
          </button>
        ) : (
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={!label || !!duplicate || save.isPending}
            className="min-h-11 rounded-xl bg-slate-900 px-4 text-caption font-medium text-white hover:bg-slate-800 disabled:opacity-40"
          >
            {save.isPending ? '추가하는 중…' : '현장 추가'}
          </button>
        )}
      </div>
    </div>
  );
}

// 휴대폰(iOS)은 16px 보다 작은 입력칸을 누르면 화면을 확하늘다
const input = 'h-11 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-body outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200';
