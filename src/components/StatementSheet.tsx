import { koreanAmount, longDate, parseDateInput, parseTimeRangeInput, shortDate, timeRange, won } from '../lib/format';

/** 엑셀 거래명세표 한 장에 들어가는 줄 수 (시트의 10~30행) */
export const LINES_PER_PAGE = 21;

/**
 * 엑셀 '거래명세표' 시트의 B~J 9개 열 너비를 그대로 비율로 옮긴 것.
 * 머리글과 명세표가 같은 열 격자를 쓰기 때문에 세로선이 한 줄로 이어진다.
 */
const COL_WIDTHS = [8.88, 14.63, 10.0, 8.75, 9.13, 11.88, 7.88, 6.5, 12.5];
const COL_TOTAL = COL_WIDTHS.reduce((a, b) => a + b, 0);

export interface SheetHeader {
  issue_date: string;
  supplier_name: string;
  supplier_biz_no: string | null;
  supplier_ceo: string | null;
  supplier_address: string | null;
  supplier_biz_type: string | null;
  supplier_biz_item: string | null;
  customer_name: string;
  customer_site_name?: string | null;
  note: string | null;
}

export interface SheetLine {
  id?: number;
  work_date: string;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
  ot_hours: number;
  boom_size: number | null;
  supply_amount: number;
  vat_amount: number;
  changed?: boolean;
  missing?: boolean;
  edited?: number;
  /** 칸을 고칠 수 없는 줄 (발행 전 장부에서 그대로 온 줄 — 빼기만 된다) */
  locked?: boolean;
}

export interface SheetTotals {
  supplyAmount: number;
  vatAmount: number;
  totalAmount: number;
}

/** 셀을 눌러 바로 고칠 수 있게 할 때 넘기는 핸들러 모음 */
export interface SheetEditing {
  onHeaderChange: (patch: Partial<SheetHeader>) => void;
  onLineChange?: (lineId: number, patch: Partial<SheetLine>) => void;
  onLineDelete?: (lineId: number) => void;
  onLineAdd?: () => void;
}

/**
 * 상호 칸을 직접 치는 대신 목록에서 고르게 한다.
 * 공급자를 바꾸면 등록번호·성명·소재지·업태·종목이 통째로 따라온다.
 */
export interface SheetSelectors {
  companies: { id: number; name: string }[];
  clients: { id: number; name: string; full_name: string | null }[];
  companyId: number | null;
  clientId: number | null;
  onCompanyChange: (id: number) => void;
  onClientChange: (id: number) => void;
  /** 「직접 입력」: 거래처를 고르지 않고 쳐 넣은 이름을 상호 칸에 그대로 찍는다 */
  customerName?: string;
}

/**
 * 사업장 소재지의 괄호 참고 주소는 아랫줄로 개행하여 가독성을 높인다.
 * 예: "서울시 샘플구 샘플로 1, 101호"
 *   → "서울시 샘플구 샘플로 1, 101호\n(샘플동, 샘플타워)"
 */
export function splitAddressParen(addr: string | null | undefined): string {
  if (!addr) return '';
  if (addr.includes('\n')) return addr;
  const parenIdx = addr.indexOf('(');
  if (parenIdx > 0) {
    const main = addr.slice(0, parenIdx).trimEnd();
    const sub = addr.slice(parenIdx).trimStart();
    return `${main}\n${sub}`;
  }
  return addr;
}

export default function StatementSheet({
  header,
  lines,
  totals,
  watermark,
  editing,
  selectors,
  footerNote,
  stampUrl,
}: {
  header: SheetHeader;
  lines: SheetLine[];
  totals: SheetTotals;
  /** '취소됨' 같은 상태 표시 (인쇄물에도 남는다) */
  watermark?: string | null;
  /** 넘기면 셀을 눌러 고칠 수 있는 상태가 된다 */
  editing?: SheetEditing;
  /** 넘기면 상호 칸이 목록 선택으로 바뀐다 */
  selectors?: SheetSelectors;
  /** 표 아래 화면용 안내 (인쇄에는 안 나온다) */
  footerNote?: React.ReactNode;
  /** 성명 칸 (인) 위에 찍을 도장 */
  stampUrl?: string | null;
}) {
  const pages: SheetLine[][] = [];
  for (let i = 0; i < Math.max(lines.length, 1); i += LINES_PER_PAGE) {
    pages.push(lines.slice(i, i + LINES_PER_PAGE));
  }

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
      {pages.map((pageLines, pageIndex) => (
        <Page
          key={pageIndex}
          header={header}
          lines={pageLines}
          totals={totals}
          watermark={watermark}
          editing={editing}
          selectors={selectors}
          stampUrl={stampUrl}
          isLast={pageIndex === pages.length - 1}
          pageNo={pageIndex + 1}
          pageCount={pages.length}
        />
      ))}
      {/* 화면 전용 안내 — 명세표 밖에 두어야 휴대폰에서 명세표가 작게 줄어도 글씨는 그대로다 */}
      {/* 줄 추가 단추는 위에만 둔다. 아래에도 있을 때는 휴대폰에서 양식 끝과 겹쳐 보였다 */}
      {(editing?.onLineAdd || footerNote) && (
        <p className="mx-auto mb-6 max-w-[210mm] px-1 text-caption leading-snug text-slate-600 print:hidden">
          {footerNote ?? '고친 내용은 이 명세표에만 적용되고 장부는 그대로입니다.'}
        </p>
      )}
    </>
  );
}

// ── 셀 ──────────────────────────────────────────────────────────────────
const CELL = 'border border-black px-1 py-0.5';

/**
 * 글씨 크기는 세 가지만 쓴다 (사용자 요청 2026-10-04: 읽기 좋게, 통일할 것은 통일):
 *   제목 20pt · 먼저 찾는 것(거래처 이름·등록번호·합계) 14pt · 나머지 전부 11pt(표의 기본)
 * 칸마다 조금씩 다른 크기(9pt, 12pt, 13pt)를 두지 않는다.
 */
const KEY = 'text-[14pt] font-bold';
/** 돈 칸은 오른쪽 끝을 한 줄로 맞춘다 (명세 줄·소계·합계가 같은 여백) */
const MONEY = 'px-2 text-right tabular';

/** 라벨 칸 (엷은 음영 + 자간 넓힌 두 글자 라벨) */
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

/**
 * 값 칸. editing 이 있으면 눌러서 바로 고칠 수 있는 입력칸이 된다.
 * 보이는 글자와 고칠 때의 글자가 같도록, value 에는 이미 다듬은 문자열을 넘긴다
 * (날짜는 6/22, 금액은 1,200,000). 되돌려 읽는 일은 onChange 쪽에서 한다.
 * 인쇄할 때는 입력칸 티가 나지 않도록 배경·테두리를 없앤다.
 */
function Value({
  value,
  onChange,
  colSpan,
  rowSpan,
  align = 'left',
  className = '',
  multiline,
}: {
  value: string;
  onChange?: (next: string) => void;
  colSpan?: number;
  rowSpan?: number;
  align?: 'left' | 'center' | 'right';
  className?: string;
  /** 긴 주소처럼 줄바꿈이 필요한 칸 */
  multiline?: boolean;
}) {
  const alignClass = align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left';
  const inputClass = `sheet-cell w-full min-w-0 resize-none bg-transparent outline-none ${alignClass}`;

  return (
    <td colSpan={colSpan} rowSpan={rowSpan} className={`${CELL} ${alignClass} ${className}`}>
      {!onChange ? (
        <span className={multiline ? 'block whitespace-pre-wrap' : undefined}>{value}</span>
      ) : multiline ? (
        // 두 줄 높이로 고정해 두면 짧은 주소가 윗줄에 붙어 보였다.
        // 글자만큼만 높이를 주어 칸 안에서 위아래 가운데에 오게 한다 (사용자 요청).
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

/**
 * 목록에서 고르는 칸. 화면에서는 드롭다운, 인쇄물에서는 그냥 글자로 보이게 한다.
 */
function SelectValue({
  value,
  options,
  onChange,
  colSpan,
  rowSpan,
  className = '',
  subText,
}: {
  value: number | null;
  options: { id: number; label: string }[];
  onChange: (id: number) => void;
  colSpan?: number;
  rowSpan?: number;
  className?: string;
  subText?: React.ReactNode;
}) {
  const current = options.find((o) => o.id === value);

  return (
    <td colSpan={colSpan} rowSpan={rowSpan} className={`${CELL} relative text-center ${className}`}>
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
      {subText && <div className="mt-0.5">{subText}</div>}
    </td>
  );
}

// ── 한 장 ───────────────────────────────────────────────────────────────
function Page({
  header,
  lines,
  totals,
  watermark,
  editing,
  selectors,
  stampUrl,
  isLast,
  pageNo,
  pageCount,
}: {
  header: SheetHeader;
  lines: SheetLine[];
  totals: SheetTotals;
  watermark?: string | null;
  editing?: SheetEditing;
  selectors?: SheetSelectors;
  stampUrl?: string | null;
  isLast: boolean;
  pageNo: number;
  pageCount: number;
}) {
  // 마지막 장에는 '=====' 와 '이하여백' 두 줄이 더 들어간다 (원본 시트와 동일)
  const markerRows = isLast && lines.length > 0 ? 2 : 0;
  const blanks = Math.max(0, LINES_PER_PAGE - lines.length - markerRows);

  const H = (patch: Partial<SheetHeader>) => editing?.onHeaderChange(patch);
  const edit = (fn: (next: string) => void) => (editing ? fn : undefined);

  return (
    <div className="statement-sheet relative mx-auto mb-6 bg-white px-[12mm] py-[12mm] text-black shadow-[0_4px_20px_-2px_rgba(0,0,0,0.08),0_2px_6px_-1px_rgba(0,0,0,0.04)] ring-1 ring-slate-900/5 print:mb-0 print:shadow-none print:ring-0">
      {watermark && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="rotate-[-20deg] text-[64pt] font-bold text-rose-500/15">{watermark}</span>
        </div>
      )}

      <table className="w-full table-fixed border-collapse text-[11pt]">
        <colgroup>
          {COL_WIDTHS.map((w, i) => (
            <col key={i} style={{ width: `${((w / COL_TOTAL) * 100).toFixed(3)}%` }} />
          ))}
        </colgroup>

        <tbody>
          {/* 줄 높이는 세 가지로 맞춘다 (사용자 요청 2026-10-03): 제목, 머리 부분·비고 10mm, 명세 줄·소계 7.2mm */}
          {/* 제목 (원본 B2:J3) */}
          <tr>
            <td colSpan={9} className={`${CELL} py-3 text-center text-[20pt] font-bold tracking-[0.45em]`}>
              거래명세표
            </td>
          </tr>

          {/* 발행일 / 등록번호 (원본 4행) */}
          <tr>
            <Value
              colSpan={3}
              align="center"
              className="h-[10mm] font-bold tabular"
              value={longDate(header.issue_date)}
              onChange={edit((v) => {
                const parsed = parseDateInput(v, header.issue_date);
                if (parsed) H({ issue_date: parsed });
              })}
            />
            <Label>{'등 록\n번 호'}</Label>
            {/* 거래처가 가장 먼저 찾는 숫자라 크게 (사용자 요청 2026-09-29). 거래처 이름·합계와 같은 크기 */}
            <Value
              colSpan={5}
              align="center"
              className={`${KEY} tracking-wider tabular`}
              value={header.supplier_biz_no ?? ''}
              onChange={edit((v) => H({ supplier_biz_no: v }))}
            />
          </tr>

          {/* 공급받는자 상호 / 공급자 상호·성명 (원본 5행, 좌측은 5~6행 병합) */}
          <tr>
            {selectors && selectors.customerName == null ? (
              <SelectValue
                colSpan={3}
                rowSpan={2}
                className={`h-[20mm] ${KEY}`}
                value={selectors.clientId}
                onChange={selectors.onClientChange}
                options={selectors.clients.map((c) => ({ id: c.id, label: c.full_name ?? c.name }))}
              />
            ) : (
              <td colSpan={3} rowSpan={2} className={`${CELL} h-[20mm] text-center`}>
                <div className={`${KEY} leading-tight`}>{selectors?.customerName ?? header.customer_name}</div>
              </td>
            )}
            <Label className="h-[10mm]">상 호</Label>
            {selectors ? (
              <SelectValue
                colSpan={2}
                value={selectors.companyId}
                onChange={selectors.onCompanyChange}
                options={selectors.companies.map((c) => ({ id: c.id, label: c.name }))}
              />
            ) : (
              <Value
                colSpan={2}
                align="center"
                value={header.supplier_name}
                onChange={edit((v) => H({ supplier_name: v }))}
              />
            )}
            <Label>성 명</Label>
            <CeoCell
              colSpan={2}
              value={header.supplier_ceo ?? ''}
              onChange={edit((v) => H({ supplier_ceo: v }))}
              stampUrl={stampUrl}
            />
          </tr>

          {/* 사업장 소재지 (원본 6행) */}
          <tr>
            <Label className="h-[10mm]">{'사 업 장\n소 재 지'}</Label>
            <Value
              colSpan={5}
              align="center"
              multiline
              className="leading-[1.1]"
              value={splitAddressParen(header.supplier_address)}
              onChange={edit((v) => H({ supplier_address: v.replace(/\s*\n\s*/g, ' ').trim() }))}
            />
          </tr>

          {/* 계산 문구 / 업태 · 종목 (원본 7행) */}
          <tr>
            <td colSpan={3} className={`${CELL} h-[10mm] text-center`}>
              아래와 같이 계산합니다
            </td>
            <Label>업 태</Label>
            <Value
              colSpan={2}
              align="center"
              value={header.supplier_biz_type ?? ''}
              onChange={edit((v) => H({ supplier_biz_type: v }))}
            />
            <Label>종 목</Label>
            <Value
              colSpan={2}
              align="center"
              value={header.supplier_biz_item ?? ''}
              onChange={edit((v) => H({ supplier_biz_item: v }))}
            />
          </tr>

          {/* 금액 (원본 8행) */}
          <tr>
            <Label>금 액</Label>
            <td colSpan={8} className={`${CELL} h-[10mm] px-2 font-bold text-[#c0504d]`}>
              {koreanAmount(totals.totalAmount)}
            </td>
          </tr>

          {/* 명세 머리글 (원본 9행) */}
          <tr className="bg-neutral-50">
            <Label className="h-[7.2mm]">월 일</Label>
            <Label>작 업 내 용</Label>
            <Label colSpan={2}>작 업 시 간</Label>
            <Label>OT</Label>
            <Label>규 격 M</Label>
            <Label colSpan={2}>공 급 가 액</Label>
            <Label>세 액</Label>
          </tr>

          {/* 명세 (원본 10~30행) */}
          {lines.map((line, i) => (
            <LineRow key={line.id ?? i} line={line} editing={editing} />
          ))}

          {/* 왼쪽 빈 칸도 위아래 명세 줄처럼 월일·작업내용·작업시간·OT·규격으로 나눈다 (사용자 요청) */}
          {markerRows > 0 && (
            <>
              <tr>
                <EmptyLineCells />
                <td className={`${CELL} text-center text-neutral-500`} colSpan={2}>
                  =========
                </td>
                <td className={`${CELL} text-center text-neutral-500`}>=======</td>
              </tr>
              <tr>
                <EmptyLineCells />
                <td className={`${CELL} text-center text-neutral-500`} colSpan={2}>
                  이하여백
                </td>
                <td className={CELL} />
              </tr>
            </>
          )}

          {Array.from({ length: blanks }, (_, i) => {
            const isFirstBlank = i === 0 && lines.length === 0;
            const canAdd = Boolean(editing?.onLineAdd);
            return (
              <tr
                key={`blank-${i}`}
                onClick={canAdd ? editing?.onLineAdd : undefined}
                className={canAdd ? 'cursor-pointer hover:bg-sky-50/50 print:hover:bg-transparent transition-colors' : ''}
                title={canAdd ? '클릭하여 작업 줄 추가' : undefined}
              >
                <td className={`${CELL} relative h-[7.2mm] text-center text-[8.5pt]`}>
                  {/* 줄 빼기 ✕ 와 짝을 이루는 줄 추가 단추 — 첫 빈 줄의 표 왼쪽 바깥 */}
                  {i === 0 && canAdd && (
                    <button
                      type="button"
                      title="작업 줄 추가"
                      aria-label="작업 줄 추가"
                      className="absolute top-1/2 -left-9 grid size-7 -translate-y-1/2 place-items-center rounded-full text-[14pt] text-slate-500 hover:bg-sky-50 hover:text-sky-700 print:hidden"
                    >
                      +
                    </button>
                  )}
                  {isFirstBlank && canAdd ? (
                    <span className="text-slate-500 print:hidden">+ 추가</span>
                  ) : null}
                </td>
                <td className={`${CELL} text-center text-[8.5pt]`}>
                  {isFirstBlank && canAdd ? (
                    <span className="font-medium text-slate-500 print:hidden">클릭하여 작업 줄을 추가하세요</span>
                  ) : null}
                </td>
                <td className={CELL} colSpan={2} />
                <td className={CELL} />
                <td className={CELL} />
                <td className={CELL} colSpan={2} />
                <td className={CELL} />
              </tr>
            );
          })}

          {/* 소계 (원본 31행) — 원본에는 라벨이 없고 숫자만 들어간다 */}
          <tr className="font-medium">
            <td className={`${CELL} h-[7.2mm]`} />
            <td className={CELL} />
            <td className={CELL} colSpan={2} />
            <td className={CELL} />
            <td className={`${CELL} text-center text-neutral-500`}>
              {isLast ? '' : `${pageNo}/${pageCount}`}
            </td>
            <td className={`${CELL} ${MONEY}`} colSpan={2}>
              {isLast ? won(totals.supplyAmount) : ''}
            </td>
            <td className={`${CELL} ${MONEY}`}>{isLast ? won(totals.vatAmount) : ''}</td>
          </tr>

          {/* 비고 · 합계 (원본 32행) */}
          <tr>
            <Label>비 고</Label>
            <Value
              colSpan={4}
              className="h-[10mm] px-2"
              value={header.note ?? ''}
              onChange={edit((v) => H({ note: v }))}
            />
            <Label>합 계</Label>
            <td colSpan={3} className={`${CELL} ${MONEY} ${KEY}`}>
              ₩{won(totals.totalAmount)}
            </td>
          </tr>
        </tbody>
      </table>

    </div>
  );
}

/** 명세 줄의 왼쪽 다섯 칸(월일·작업내용·작업시간·OT·규격)을 빈 채로 */
function EmptyLineCells() {
  return (
    <>
      <td className={`${CELL} h-[7.2mm]`} />
      <td className={CELL} />
      <td className={CELL} colSpan={2} />
      <td className={CELL} />
      <td className={CELL} />
    </>
  );
}

// ── 명세 한 줄 ──────────────────────────────────────────────────────────
function LineRow({ line, editing }: { line: SheetLine; editing?: SheetEditing }) {
  const id = line.id;
  const change = (patch: Partial<SheetLine>) => id != null && editing?.onLineChange?.(id, patch);
  const canEdit = Boolean(editing?.onLineChange && id != null && !line.locked);
  const canDelete = Boolean(editing?.onLineDelete && id != null);
  const edit = (fn: (next: string) => void) => (canEdit ? fn : undefined);

  const toNumber = (v: string) => Number(v.replace(/[^\d.-]/g, '')) || 0;

  /** "08:00~16:00" 한 칸으로 받아 시작/종료로 나눈다 (장부 표와 같은 해석) */
  const setTimeRange = (v: string) => {
    const parsed = parseTimeRangeInput(v);
    if (!parsed) {
      change({ start_time: v.trim() || null, end_time: null });
      return;
    }
    change({ start_time: parsed.start, end_time: parsed.end });
  };

  return (
    <tr className={line.missing ? 'bg-amber-50 print:bg-transparent' : ''}>
      <Value
        className="h-[7.2mm] tabular"
        align="center"
        value={shortDate(line.work_date)}
        onChange={edit((v) => {
          const parsed = parseDateInput(v, line.work_date);
          if (parsed) change({ work_date: parsed });
        })}
      />
      <Value
        align="center"
        value={line.description ?? ''}
        onChange={edit((v) => change({ description: v.trim() || null }))}
      />
      <Value
        colSpan={2}
        align="center"
        className="tabular"
        value={timeRange(line.start_time, line.end_time)}
        onChange={edit(setTimeRange)}
      />
      <Value
        align="center"
        className="tabular"
        value={line.ot_hours ? String(line.ot_hours) : ''}
        onChange={edit((v) => change({ ot_hours: toNumber(v) }))}
      />
      <Value
        align="center"
        className="tabular"
        value={line.boom_size != null ? String(line.boom_size) : ''}
        onChange={edit((v) => change({ boom_size: v.trim() ? toNumber(v) : null }))}
      />
      <Value
        colSpan={2}
        align="right"
        className={MONEY}
        value={won(line.supply_amount)}
        onChange={edit((v) => change({ supply_amount: toNumber(v) }))}
      />
      <td className={`${CELL} relative ${MONEY}`}>
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
