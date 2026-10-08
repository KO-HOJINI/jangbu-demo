/**
 * 화면의 A4 명세표를 PDF 로 만든다 (메일 첨부·PDF 저장).
 *
 * 양식 한 장(.statement-sheet)을 그림으로 떠서 A4 한 쪽에 붙인다. 인쇄와 같은 모양이 되도록,
 * 뜨기 전에 복사본에서 화면 전용 요소(✕ 단추·목록 화살표)를 빼고 입력칸은 글자로 바꾼다.
 * 라이브러리(jsPDF·html2canvas-pro)가 커서 이 기능을 쓸 때만 불러온다.
 */

/** 복사본을 인쇄 모양으로: print:hidden 은 빼고, print:inline 은 보이게, 입력칸은 글자로 */
function printify(root: HTMLElement) {
  const doc = root.ownerDocument;
  const view = doc.defaultView!;

  root.querySelectorAll<HTMLElement>('[class*="print:hidden"]').forEach((el) => el.remove());
  root.querySelectorAll<HTMLElement>('[class*="print:inline"]').forEach((el) => (el.style.display = 'inline'));

  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach((field) => {
    const style = view.getComputedStyle(field);
    const text = doc.createElement('div');
    text.textContent = field.value;
    text.style.textAlign = style.textAlign;
    text.style.font = style.font;
    text.style.letterSpacing = style.letterSpacing;
    text.style.whiteSpace = field.tagName === 'TEXTAREA' ? 'pre-wrap' : 'nowrap';
    text.style.lineHeight = style.lineHeight;
    // 글자만큼만 폭을 쓰는 칸(성명)은 그대로 좁게
    text.style.display = style.display === 'inline-block' || field.className.includes('field-sizing') ? 'inline-block' : 'block';
    field.replaceWith(text);
  });
}

export async function sheetsToPdf(sheets: HTMLElement[]): Promise<Blob> {
  if (!sheets.length) throw new Error('명세표 양식이 화면에 없습니다.');
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas-pro'), import('jspdf')]);

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });

  // 휴대폰에서는 양식을 zoom 으로 줄여 보여준다. 줄인 채로 뜨면 글자가 겹쳐서,
  // 뜨는 동안만 원래 크기로 돌린다 (index.css .pdf-capture)
  document.documentElement.classList.add('pdf-capture');
  try {
    for (const [i, sheet] of sheets.entries()) {
      const canvas = await html2canvas(sheet, {
        scale: 2,
        backgroundColor: '#ffffff',
        logging: false,
        // 휴대폰에서는 양식(210mm)이 화면보다 넓다 — 양식 전체 폭으로 그린다
        windowWidth: Math.max(document.documentElement.clientWidth, sheet.scrollWidth + 64),
        onclone: (_doc, clone) => printify(clone),
      });

      // A4(210×297mm) 안에 비율 그대로. 양식이 A4 보다 길면 높이에 맞춘다.
      const ratio = canvas.height / canvas.width;
      const width = ratio > 297 / 210 ? 297 / ratio : 210;
      const height = width * ratio;
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', (210 - width) / 2, 0, width, height);
    }
  } finally {
    document.documentElement.classList.remove('pdf-capture');
  }
  return pdf.output('blob');
}

/** 이 화면의 명세표 양식들 */
export const statementSheets = () =>
  [...document.querySelectorAll<HTMLElement>('.statement-print-area .statement-sheet')];

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * PDF 저장. 휴대폰은 공유 창(카카오톡·메일 등으로 바로 보내기)을, 안 되면 내려받기를 쓴다.
 * 아이폰 홈 화면 앱에서 인쇄가 안 될 때도 이 길로 PDF 를 만든다.
 */
export async function savePdf(blob: Blob, fileName: string) {
  const file = new File([blob], `${fileName}.pdf`, { type: 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
  if (/Android|iPhone|iPad/.test(navigator.userAgent) && nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return; // 공유 창을 닫았다
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
