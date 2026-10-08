import { useQuery } from '@tanstack/react-query';
import { api, type MailDoc } from '../lib/api';
import { clockDate } from '../lib/format';

/** 이 문서를 메일로 보낸 기록 (최근 세 번) — 보냈는지 헷갈리지 않게 */
export default function SentMails({ doc, id }: { doc: MailDoc; id: number }) {
  const emails = useQuery({ queryKey: ['doc-emails', doc, id], queryFn: () => api.docEmails(doc, id) });
  if (!emails.data?.length) return null;

  return (
    <ul className="mb-4 space-y-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-caption print:hidden">
      {emails.data.slice(0, 3).map((e, i) => (
        <li key={i} className={e.status === 'sent' ? 'text-slate-700' : 'text-rose-700'}>
          {clockDate(e.sent_at)} {e.from_addr ? `${e.from_addr} → ` : ''}
          {e.to_addrs} {e.status === 'sent' ? '— 메일 보냄' : `— 못 보냄: ${e.error ?? ''}`}
        </li>
      ))}
    </ul>
  );
}
