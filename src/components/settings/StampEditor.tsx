import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Company } from '../../../shared/types';
import { api } from '../../lib/api';
import { stampUrl } from '../../lib/stamp';

/** 도장 — 명세표·견적서 성명 칸의 (인) 위에 찍힌다 */
export default function StampEditor({ company }: { company: Company }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['masters'] });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.type !== 'image/png') {
        throw new Error('PNG 그림만 올릴 수 있습니다. 배경이 투명한 도장 그림을 골라 주세요.');
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
        reader.readAsDataURL(file);
      });
      return api.uploadStamp(company.id, dataUrl.slice(dataUrl.indexOf(',') + 1));
    },
    onSuccess: () => {
      setError(null);
      void refresh();
    },
    onError: (e: Error) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: () => api.removeStamp(company.id),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  });

  const url = stampUrl(company);

  return (
    <div className="mt-4 border-t border-slate-200 pt-4">
      <span className="mb-2 block text-caption font-medium text-slate-600">도장</span>
      {/* 휴대폰에서도 한 줄에 들어가게 미리보기 상자를 좁히고 단추 이름은 「바꾸기」「빼기」 (제목이 「도장」이라 뜻이 통한다) */}
      <div className="flex items-center gap-2 sm:flex-wrap sm:gap-3">
        {/* 명세표에 찍히는 모습 그대로 보여준다 */}
        <div className="grid h-16 shrink-0 place-items-center rounded-xl border border-slate-300 bg-white px-3 text-lead sm:min-w-40 sm:px-5">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            {company.ceo_name}
            <span className="relative">
              (인)
              {url && (
                <img
                  src={url}
                  alt={`${company.name} 도장`}
                  className="pointer-events-none absolute top-1/2 left-1/2 size-14 max-w-none -translate-x-1/2 -translate-y-1/2 mix-blend-multiply"
                />
              )}
            </span>
          </span>
        </div>

        <label className="tap inline-flex cursor-pointer items-center rounded-xl border border-slate-300 px-3 py-2 text-caption whitespace-nowrap hover:bg-slate-50 sm:px-4">
          {upload.isPending ? '올리는 중…' : url ? '바꾸기' : '올리기'}
          <input
            type="file"
            accept="image/png"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) upload.mutate(file);
            }}
          />
        </label>

        {url && (
          <button
            type="button"
            onClick={() => confirm(`${company.name} 도장을 뺄까요? 명세표에는 (인)만 남습니다.`) && remove.mutate()}
            className="ml-auto rounded-xl border border-rose-200 px-3 py-2 text-caption whitespace-nowrap text-rose-700 hover:bg-rose-50 sm:px-4"
          >
            빼기
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-caption text-rose-700">{error}</p>}
    </div>
  );
}
