/** 파일 앞머리가 HEIC(아이폰 사진) 인지 — 5~8번째 글자가 「ftyp」이고 그 뒤 상표가 heic 계열이다 */
export function isHeicHeader(head: Uint8Array): boolean {
  const word = (from: number) => String.fromCharCode(...head.subarray(from, from + 4));
  return head.length >= 12 && word(4) === 'ftyp' && ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(word(8));
}

/**
 * 사진을 그림으로 연다. 아이폰의 HEIC 는 사파리만 열 수 있어, PC·안드로이드에서는 푸는 도구(heic-to)를 그때만 받아 와 연다.
 * 도구가 3MB 쯤이라 HEIC 를 올릴 때만 받는다. CSP 를 지키는 빌드(csp)를 쓰고, 워커를 blob 으로 띄워 _headers 의 worker-src 에 blob: 이 있다.
 */
async function openImage(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    if (isHeicHeader(new Uint8Array(await file.slice(0, 12).arrayBuffer()))) {
      try {
        const { heicTo } = await import('heic-to/csp');
        return await heicTo({ blob: file, type: 'bitmap' });
      } catch (e) {
        console.error('HEIC 사진 열기 실패', e);
      }
    }
    throw new Error('이 사진은 열 수 없습니다. JPG 나 PNG 사진으로 올려 주세요.');
  }
}

/**
 * 사진을 긴 변 2200px JPEG로 압축하여 base64 문자열로 변환합니다. 줄인 사진(blob)은 미리보기로 쓴다 — HEIC 원본은 화면에 못 띄운다.
 * 확인서의 손글씨는 사진의 작은 부분이라, 1600px 로 줄이면 현장명·타설량을 더 틀린다
 * (2026-10-04 확인서 네 장: 1600px 23~24/30칸, 2200px 25/30칸, 2800px 도 25/30칸. 시간은 차이 없음).
 */
export async function shrinkImage(file: Blob, maxDim = 2200, quality = 0.82): Promise<{ base64: string; blob: Blob }> {
  const bitmap = await openImage(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('캔버스를 초기화하지 못했습니다.');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('사진을 압축하지 못했습니다.'))), 'image/jpeg', quality)
  );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { base64: btoa(s), blob };
}
