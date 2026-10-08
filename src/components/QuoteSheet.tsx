import { longDate, parseDateInput, won } from '../lib/format';
import { splitAddressParen } from './StatementSheet';

/**
 * 한 장에 들어가는 견적 줄 수.
 * 머리 부분 88mm(제목 + 10mm 여섯 줄 + 머리글) + 21줄 × 8.5mm = 266mm 이고, 표 높이를 A4 안쪽(297 − 위아래 여백 24 = 273mm)에 맞춰
 * 남는 7mm 는 높이를 정하지 않은 제목 줄이 가져간다. 주소가 세 줄로 늘어도 한 장을 넘지 않게 여유를 둔 값이다.
 */
const LINES_PER_PAGE = 21;

/**
 * 엑셀 '견적서' 시트(아래쪽 판, 23~33행)의 B~K 10개 열 너비.
 * 명세 표는 품명·규격·기준·공급가액·세액이 각각 2열씩 차지한다.
 * 원본 그대로(H 7.5 · I 17.13 · J 10.38 · K 11.38)는 K열(성명·종목·FAX 칸)이 좁아 FAX 「0504-000-0000」 끝이 잘렸다.
 * 칸 이름만 들어가 여유가 있던 H·J열에서 덜어 K열과 I열(상호·업태·연락처)에 보탰다.
 * 아래 명세 표의 공급가액(H+I)은 그대로, 세액(J+K)은 넓어진다. 전체 폭은 그대로다.
 * 글씨를 11pt 로 통일하면서(2026-10-04) FAX 가 다시 넘쳐, 두 글자 이름만 드는 J열(성명·종목·FAX)을 더 줄여 K열에 보탰다.
 * I·K열이 거의 같은 폭이라 전화와 FAX 가 같은 크기로 들어간다.
 */
const COL_WIDTHS = [9.38, 9.75, 8.38, 11.38, 3.5, 10.0, 4.0, 17.7, 7.0, 17.69];
const COL_TOTAL = COL_WIDTHS.reduce((a, b) => a + b, 0);

export interface QuoteSheetHeader {
  issue_date: string;
  supplier_name: string;
  supplier_biz_no: string | null;
  supplier_ceo: string | null;
  supplier_address: string | null;
  supplier_biz_type: string | null;
  supplier_biz_item: string | null;
  supplier_tel: string | null;
  supplier_fax: string | null;
  customer_name: string;
  customer_site_name: string | null;
  customer_site_address: string | null;
  note: string | null;
}

export interface QuoteSheetLine {
  id?: number;
  item_name: string | null;
  spec: string | null;
  basis: string | null;
  supply_amount: number;
  vat_amount: number;
}

export interface QuoteEditing {
  onHeaderChange: (patch: Partial<QuoteSheetHeader>) => void;
  onLineChange?: (lineId: number, patch: Partial<QuoteSheetLine>) => void;
  onLineDelete?: (lineId: number) => void;
  onLineAdd?: () => void;
}

export interface QuoteSelectors {
  companies: { id: number; name: string }[];
  clients: { id: number; name: string; full_name: string | null }[];
  companyId: number | null;
  clientId: number | null;
  onCompanyChange: (id: number) => void;
  onClientChange: (id: number) => void;
}

const CELL = 'border border-black px-1 py-0.5';

/**
 * 글씨 크기는 거래명세표와 같은 세 가지만 쓴다 (사용자 요청 2026-10-04):
 *   제목 20pt · 먼저 찾는 것(등록번호) 14pt · 나머지 전부 11pt(표의 기본)
 * 거래처 이름 칸은 37mm 로 좁아 14pt 면 「나래건설(주)」가 잘린다. 11pt 굵게 두고, 길면 두 줄로 꺾이게 한다.
 */
const KEY = 'text-[14pt] font-bold';
/** 돈 칸은 오른쪽 여백을 같게 둔다 */
const MONEY = 'px-2 text-right tabular';

function Label({
  children,
  colSpan,
  rowSpan,
  className = '',
}: {
  children: React.ReactNode;
  colSpan?: number;
  rowSpan?: number;
  className?: string;
}) {
  return (
    <td
      colSpan={colSpan}
      rowSpan={rowSpan}
      className={`${CELL} bg-neutral-50 text-center leading-[1.1] font-medium whitespace-pre-line ${className}`}
    >
      {children}
    </td>
  );
}

/** 여러 줄 입력칸의 높이를 글자에 맞춘다 */
function fitHeight(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

function Value({
  value,
  onChange,
  colSpan,
  rowSpan,
  align = 'center',
  className = '',
  multiline,
}: {
  value: string;
  onChange?: (next: string) => void;
  colSpan?: number;
  rowSpan?: number;
  align?: 'left' | 'center' | 'right';
  className?: string;
  multiline?: boolean;
}) {
  const alignClass = align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left';
  const inputClass = `sheet-cell w-full min-w-0 resize-none bg-transparent outline-none ${alignClass}`;

  return (
    <td colSpan={colSpan} rowSpan={rowSpan} className={`${CELL} ${alignClass} ${className}`}>
      {!onChange ? (
        <span className={multiline ? 'block whitespace-pre-wrap' : undefined}>{value}</span>
      ) : multiline ? (
        // 글자만큼만 높이를 주어 칸 안에서 위아래 가운데에 오게 한다 (명세표와 같다)
        <textarea
          key={value}
          rows={1}
          ref={fitHeight}
          defaultValue={value}
          onInput={(e) => fitHeight(e.currentTarget)}
          onBlur={(e) => e.target.value !== value && onChange(e.target.value)}
          className={`${inputClass} block overflow-hidden`}
        />
      ) : (
        <input
          key={value}
          defaultValue={value}
          onBlur={(e) => e.target.value !== value && onChange(e.target.value)}
          className={inputClass}
        />
      )}
    </td>
  );
}

/**
 * 성명 칸. 원본 명세표처럼 「김대표 (인)」으로 쓰고, 도장이 있으면 (인) 위에 겹쳐 찍는다.
 * 곱하기(multiply)로 겹쳐서 실제 인주처럼 (인) 글자가 도장 밑으로 비친다.
 * 원본 PDF 의 도장 지름은 성명 줄 높이와 거의 같다(9.1mm / 9.5mm). 이 양식은 줄이 6.3mm(견적서 8mm)라
 * 8mm 로 두어 위아래로 1mm 남짓만 걸치고 옆 줄 글자는 덮지 않게 했다.
 */
function CeoCell({
  value,
  onChange,
  stampUrl,
  colSpan,
}: {
  value: string;
  onChange?: (next: string) => void;
  stampUrl?: string | null;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={`${CELL} text-center`}>
      <span className="inline-flex items-center justify-center gap-[1.2mm] whitespace-nowrap">
        {onChange ? (
          <input
            key={value}
            defaultValue={value}
            onBlur={(e) => e.target.value !== value && onChange(e.target.value)}
            className="sheet-cell min-w-[1em] bg-transparent text-center outline-none [field-sizing:content]"
          />
        ) : (
          <span>{value}</span>
        )}
        <span className="relative">
          (인)
          {stampUrl && (
            <img
              src={stampUrl}
              alt=""
              draggable={false}
              className="pointer-events-none absolute top-1/2 left-1/2 size-[8mm] max-w-none -translate-x-1/2 -translate-y-1/2 mix-blend-multiply select-none"
            />
          )}
        </span>
      </span>
    </td>
  );
}

function SelectValue({
  value,
  options,
  onChange,
  colSpan,
  rowSpan,
  className = '',
}: {
  value: number | null;
  options: { id: number; label: string }[];
  onChange: (id: number) => void;
  colSpan?: number;
  rowSpan?: number;
  className?: string;
}) {
  const current = options.find((o) => o.id === value);
  return (
    <td colSpan={colSpan} rowSpan={rowSpan} className={`${CELL} text-center ${className}`}>
      <span className="hidden print:inline">{current?.label ?? ''}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(Number(e.target.value))}
        className="sheet-cell sheet-select w-full min-w-0 cursor-pointer appearance-none bg-transparent text-center outline-none print:hidden"
      >
        {value == null && <option value="">선택</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </td>
  );
}

export default function QuoteSheet({
  header,
  lines,
  editing,
  selectors,
  watermark,
  footerNote,
  stampUrl,
}: {
  header: QuoteSheetHeader;
  lines: QuoteSheetLine[];
  editing?: QuoteEditing;
  selectors?: QuoteSelectors;
  watermark?: string | null;
  footerNote?: React.ReactNode;
  /** 성명 칸 (인) 위에 찍을 도장 */
  stampUrl?: string | null;
}) {
  const blanks = Math.max(0, LINES_PER_PAGE - lines.length);
  const H = (patch: Partial<QuoteSheetHeader>) => editing?.onHeaderChange(patch);
  const edit = (fn: (next: string) => void) => (editing ? fn : undefined);

  return (
    <>
      {/* 화면 전용 안내 (인쇄에는 안 나온다) */}
      {editing && (
        <div className="mx-auto mb-3 flex max-w-[210mm] items-center gap-3 px-1 xl:h-11 print:hidden">
          {editing.onLineAdd && (
            <button
              type="button"
              onClick={editing.onLineAdd}
              className="tap inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-300 bg-white px-3.5 py-1.5 text-caption font-medium text-slate-800 shadow-xs hover:bg-slate-50"
            >
              + 줄 추가
            </button>
          )}
          <span className="min-w-0 flex-1 text-caption leading-snug text-slate-600 lg:text-right">
            {editing.onLineAdd
              ? '칸을 누르면 고칠 수 있고, 빈 줄이나 + 를 누르면 줄이 늘어납니다.'
              : '칸을 누르면 고칠 수 있습니다.'}
          </span>
        </div>
      )}
    <div className="statement-sheet relative mx-auto mb-6 bg-white px-[12mm] py-[12mm] text-black shadow-[0_4px_20px_-2px_rgba(0,0,0,0.08),0_2px_6px_-1px_rgba(0,0,0,0.04)] ring-1 ring-slate-900/5 print:mb-0 print:shadow-none print:ring-0">
      {watermark && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="rotate-[-20deg] text-[64pt] font-bold text-rose-500/15">{watermark}</span>
        </div>
      )}

      <table className="h-[273mm] w-full table-fixed border-collapse text-[11pt]">
        <colgroup>
          {COL_WIDTHS.map((w, i) => (
            <col key={i} style={{ width: `${((w / COL_TOTAL) * 100).toFixed(3)}%` }} />
          ))}
        </colgroup>

        <tbody>
          {/* 줄 높이는 세 가지로 맞춘다 (사용자 요청 2026-10-03): 제목, 머리 부분 10mm, 견적 줄 8.5mm */}
          {/* 제목 (원본 B23:K25) */}
          <tr>
            <td colSpan={10} className={`${CELL} py-3 text-center text-[20pt] font-bold tracking-[0.45em]`}>
              견적서
            </td>
          </tr>

          {/* 상호 / 등록번호 (원본 26행) */}
          <tr>
            <Label colSpan={2}>상 호</Label>
            {selectors ? (
              <SelectValue
                colSpan={2}
                className="h-[10mm] font-bold"
                value={selectors.clientId}
                onChange={selectors.onClientChange}
                options={selectors.clients.map((c) => ({ id: c.id, label: c.full_name ?? c.name }))}
              />
            ) : (
              <Value
                colSpan={2}
                className="h-[10mm] leading-[1.1] font-bold"
                multiline
                value={header.customer_name}
                onChange={edit((v) => H({ customer_name: v.replace(/\s*\n\s*/g, ' ').trim() }))}
              />
            )}
            {/* 세로로 쓴 '공급자' — 원본 F26:F30 */}
            <td rowSpan={5} className={`${CELL} bg-neutral-50 text-center align-middle`}>
              <span className="[writing-mode:vertical-rl] leading-tight">공급자</span>
            </td>
            <Label colSpan={2}>등 록 번 호</Label>
            <Value
              colSpan={3}
              className={`${KEY} tabular`}
              value={header.supplier_biz_no ?? ''}
              onChange={edit((v) => H({ supplier_biz_no: v }))}
            />
          </tr>

          {/* 현장명 / 공급자 상호·성명 (원본 27행) */}
          <tr>
            <Label colSpan={2}>현 장 명</Label>
            <Value
              colSpan={2}
              className="h-[10mm]"
              value={header.customer_site_name ?? ''}
              onChange={edit((v) => H({ customer_site_name: v }))}
            />
            <Label colSpan={2}>상 호</Label>
            {selectors ? (
              <SelectValue
                value={selectors.companyId}
                onChange={selectors.onCompanyChange}
                options={selectors.companies.map((c) => ({ id: c.id, label: c.name }))}
              />
            ) : (
              <Value
                value={header.supplier_name}
                onChange={edit((v) => H({ supplier_name: v }))}
              />
            )}
            <Label>성 명</Label>
            <CeoCell
              value={header.supplier_ceo ?? ''}
              onChange={edit((v) => H({ supplier_ceo: v }))}
              stampUrl={stampUrl}
            />
          </tr>

          {/* 소재지 (원본 28행) */}
          <tr>
            <Label colSpan={2}>소 재 지</Label>
            <Value
              colSpan={2}
              className="h-[10mm] leading-[1.1]"
              multiline
              value={header.customer_site_address ?? ''}
              onChange={edit((v) => H({ customer_site_address: v.replace(/\s*\n\s*/g, ' ').trim() }))}
            />
            <Label colSpan={2}>소 재 지</Label>
            <Value
              colSpan={3}
              className="leading-[1.1]"
              multiline
              value={splitAddressParen(header.supplier_address)}
              onChange={edit((v) => H({ supplier_address: v.replace(/\s*\n\s*/g, ' ').trim() }))}
            />
          </tr>

          {/* 발행일 + 문구 / 업태 · 종목 (원본 29행, 좌측은 29~30행 병합) */}
          <tr>
            <td colSpan={4} rowSpan={2} className={`${CELL} h-[20mm] text-center leading-relaxed`}>
              <span className="font-bold">
                {editing ? (
                  <input
                    key={header.issue_date}
                    defaultValue={longDate(header.issue_date)}
                    onBlur={(e) => {
                      const parsed = parseDateInput(e.target.value, header.issue_date);
                      if (parsed && parsed !== header.issue_date) H({ issue_date: parsed });
                    }}
                    className="sheet-cell w-full bg-transparent text-center outline-none"
                  />
                ) : (
                  longDate(header.issue_date)
                )}
              </span>
              <div>아래와 같이 견적합니다.</div>
            </td>
            <Label colSpan={2}>업 태</Label>
            <Value className="h-[10mm]" value={header.supplier_biz_type ?? ''} onChange={edit((v) => H({ supplier_biz_type: v }))} />
            <Label>종 목</Label>
            <Value value={header.supplier_biz_item ?? ''} onChange={edit((v) => H({ supplier_biz_item: v }))} />
          </tr>

          {/* 연락처 · FAX (원본 30행) */}
          <tr>
            <Label colSpan={2}>연 락 처</Label>
            <Value className="h-[10mm] tabular" value={header.supplier_tel ?? ''} onChange={edit((v) => H({ supplier_tel: v }))} />
            <Label>F A X</Label>
            <Value className="tabular" value={header.supplier_fax ?? ''} onChange={edit((v) => H({ supplier_fax: v }))} />
          </tr>

          {/* 조건 한 줄 (원본 B31:K31) */}
          <tr>
            <Value
              colSpan={10}
              align="left"
              className="h-[10mm] px-2"
              value={header.note ?? ''}
              onChange={edit((v) => H({ note: v }))}
            />
          </tr>

          {/* 명세 머리글 (원본 32행) */}
          <tr className="bg-neutral-50">
            <Label colSpan={2} className="h-[8.5mm]">품 명</Label>
            <Label colSpan={2}>규 격</Label>
            <Label colSpan={2}>기 준</Label>
            <Label colSpan={2}>공 급 가 액</Label>
            <Label colSpan={2}>세 액</Label>
          </tr>

          {lines.map((line, i) => (
            <LineRow key={line.id ?? i} line={line} editing={editing} />
          ))}

          {/* 빈 줄을 누르면 견적 줄이 늘어난다 (명세표와 같다). 첫 빈 줄 왼쪽 바깥에 줄 빼기 ✕ 와 짝인 + 단추 */}
          {Array.from({ length: blanks }, (_, i) => (
            <tr
              key={`blank-${i}`}
              onClick={editing?.onLineAdd}
              className={editing?.onLineAdd ? 'cursor-pointer hover:bg-sky-50/50 print:hover:bg-transparent' : ''}
              title={editing?.onLineAdd ? '클릭하여 줄 추가' : undefined}
            >
              <td className={`${CELL} relative h-[8.5mm]`} colSpan={2}>
                {i === 0 && editing?.onLineAdd && (
                  <button
                    type="button"
                    title="줄 추가"
                    aria-label="줄 추가"
                    className="absolute top-1/2 -left-9 grid size-7 -translate-y-1/2 place-items-center rounded-full text-[14pt] text-slate-500 hover:bg-sky-50 hover:text-sky-700 print:hidden"
                  >
                    +
                  </button>
                )}
              </td>
              <td className={CELL} colSpan={2} />
              <td className={CELL} colSpan={2} />
              <td className={CELL} colSpan={2} />
              <td className={CELL} colSpan={2} />
            </tr>
          ))}
        </tbody>
      </table>

    </div>
      {/* 화면 전용 안내 — 명세표 밖에 두어야 휴대폰에서 명세표가 작게 줄어도 글씨는 그대로다 */}
      {footerNote && (
        <p className="mx-auto mb-6 max-w-[210mm] px-1 text-caption leading-snug text-slate-600 print:hidden">{footerNote}</p>
      )}
    </>
  );
}

function LineRow({ line, editing }: { line: QuoteSheetLine; editing?: QuoteEditing }) {
  const id = line.id;
  const change = (patch: Partial<QuoteSheetLine>) => id != null && editing?.onLineChange?.(id, patch);
  const canEdit = Boolean(editing?.onLineChange && id != null);
  const canDelete = Boolean(editing?.onLineDelete && id != null);
  const edit = (fn: (next: string) => void) => (canEdit ? fn : undefined);
  const toNumber = (v: string) => Number(v.replace(/[^\d.-]/g, '')) || 0;

  return (
    <tr>
      <Value
        colSpan={2}
        className="h-[8.5mm]"
        value={line.item_name ?? ''}
        onChange={edit((v) => change({ item_name: v.trim() || null }))}
      />
      <Value colSpan={2} value={line.spec ?? ''} onChange={edit((v) => change({ spec: v.trim() || null }))} />
      <Value colSpan={2} value={line.basis ?? ''} onChange={edit((v) => change({ basis: v.trim() || null }))} />
      <Value
        colSpan={2}
        align="right"
        className={MONEY}
        value={won(line.supply_amount)}
        onChange={edit((v) => change({ supply_amount: toNumber(v) }))}
      />
      <td className={`${CELL} relative ${MONEY}`} colSpan={2}>
        {won(line.vat_amount)}
        {canDelete && (
          <button
            type="button"
            title="이 줄 빼기"
            aria-label="이 줄 빼기"
            onClick={() => editing!.onLineDelete!(id!)}
            className="absolute top-1/2 -right-9 grid size-7 -translate-y-1/2 place-items-center rounded-full text-[12pt] text-slate-500 hover:bg-rose-50 hover:text-rose-600 print:hidden"
          >
            ✕
          </button>
        )}
      </td>
    </tr>
  );
}
