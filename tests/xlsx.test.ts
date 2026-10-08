import { describe, expect, it } from 'vitest';
import { downloadXlsx, type SheetSpec } from '../src/lib/xlsx';

/** downloadXlsx 는 a.click() 으로 내려받는다. 여기서는 그 Blob 만 가로챈다. */
async function buildXlsx(sheets: SheetSpec[]): Promise<Uint8Array> {
  let captured: Blob | null = null;

  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const originalClick = HTMLAnchorElement.prototype.click;

  URL.createObjectURL = (blob: Blob) => {
    captured = blob;
    return 'blob:test';
  };
  URL.revokeObjectURL = () => {};
  HTMLAnchorElement.prototype.click = () => {};

  try {
    downloadXlsx('시험', sheets);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    HTMLAnchorElement.prototype.click = originalClick;
  }

  if (!captured) throw new Error('파일이 만들어지지 않았습니다');
  return new Uint8Array(await (captured as Blob).arrayBuffer());
}

/** 만들어진 zip 을 다시 풀어 본다 (압축 없이 담으므로 그대로 읽힌다) */
function readZip(buf: Uint8Array): Map<string, string> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip 끝을 찾지 못했습니다');

  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  const crc32 = (b: Uint8Array) => {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = table[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  const dec = new TextDecoder();
  const out = new Map<string, string>();
  let p = dv.getUint32(eocd + 16, true);

  for (let i = 0, n = dv.getUint16(eocd + 10, true); i < n; i++) {
    expect(dv.getUint32(p, true)).toBe(0x02014b50);
    const nameLen = dv.getUint16(p + 28, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    const storedCrc = dv.getUint32(p + 16, true);
    const size = dv.getUint32(p + 24, true);
    const localOff = dv.getUint32(p + 42, true);
    const dataOff =
      localOff + 30 + dv.getUint16(localOff + 26, true) + dv.getUint16(localOff + 28, true);
    const data = buf.subarray(dataOff, dataOff + size);

    // CRC 가 틀리면 엑셀이 '파일이 손상되었습니다' 라고 한다
    expect(crc32(data), `${name} 의 CRC`).toBe(storedCrc);
    out.set(name, dec.decode(data));
    p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  return out;
}

const SAMPLE: SheetSpec[] = [
  {
    name: '장부',
    header: ['날짜', '현장', '금액'],
    widths: [12, 14, 12],
    rows: [
      ['2026-08-25', '나래(한강)', 1_400_000],
      ['2026-08-26', '아라 & "따옴표" <꺾쇠>', 0],
      ['2026-08-27', null, 2_610_000],
    ],
  },
  { name: '현장×월', header: ['현장', '월', '금액'], rows: [['다솜', '2026-07', 25_000_000]] },
];

describe('xlsx 만들기', () => {
  it('엑셀이 요구하는 파일이 모두 들어 있다', async () => {
    const files = readZip(await buildXlsx(SAMPLE));
    for (const name of [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]) {
      expect(files.has(name), name).toBe(true);
    }
  });

  it('PK 로 시작하는 zip 이다', async () => {
    const buf = await buildXlsx(SAMPLE);
    expect([buf[0], buf[1], buf[2], buf[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('시트 이름과 연결(rId)이 맞물린다', async () => {
    const files = readZip(await buildXlsx(SAMPLE));
    const workbook = files.get('xl/workbook.xml')!;
    expect(workbook).toContain('name="장부"');
    expect(workbook).toContain('name="현장×월"');

    const rels = files.get('xl/_rels/workbook.xml.rels')!;
    expect(rels).toContain('Target="worksheets/sheet1.xml"');
    expect(rels).toContain('Target="worksheets/sheet2.xml"');
    expect(rels).toContain('Target="styles.xml"');
  });

  it('숫자는 숫자 칸으로 들어가 엑셀에서 합계가 잡힌다', async () => {
    const sheet = readZip(await buildXlsx(SAMPLE)).get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('<c r="C2" s="2"><v>1400000</v></c>');
    expect(sheet).toContain('<v>2610000</v>');
  });

  it('글자는 inlineStr 로 들어가고 특수문자는 escape 된다', async () => {
    const sheet = readZip(await buildXlsx(SAMPLE)).get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('나래(한강)');
    expect(sheet).toContain('&amp;');
    expect(sheet).toContain('&quot;');
    expect(sheet).toContain('&lt;꺾쇠&gt;');
    expect(sheet).not.toMatch(/<t[^>]*>[^<]*<꺾쇠>/);
  });

  it('빈 칸은 아예 넣지 않는다', async () => {
    const sheet = readZip(await buildXlsx(SAMPLE)).get('xl/worksheets/sheet1.xml')!;
    expect(sheet).not.toContain('r="B4"'); // 3번째 줄의 현장이 null
  });

  it('0 은 빈 칸이 아니라 숫자 0 으로 들어간다', async () => {
    const sheet = readZip(await buildXlsx(SAMPLE)).get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('<c r="C3" s="2"><v>0</v></c>');
  });

  it('스타일 개수 선언이 실제 개수와 맞는다 (엑셀이 여기서 자주 거부한다)', async () => {
    const styles = readZip(await buildXlsx(SAMPLE)).get('xl/styles.xml')!;
    const declared = (tag: string) => Number(new RegExp(`<${tag} count="(\\d+)"`).exec(styles)![1]);
    const actual = (tag: string) => (styles.match(new RegExp(`<${tag}[ >]`, 'g')) ?? []).length;

    expect(actual('font')).toBe(declared('fonts'));
    expect(actual('fill')).toBe(declared('fills'));
    expect(actual('border')).toBe(declared('borders'));
    expect(actual('xf')).toBe(declared('cellXfs') + declared('cellStyleXfs'));
  });

  it('열이 26 개를 넘어도 이름이 A..Z, AA.. 로 이어진다', async () => {
    const wide: SheetSpec = {
      name: '넓은표',
      header: Array.from({ length: 30 }, (_, i) => `열${i + 1}`),
      rows: [Array.from({ length: 30 }, (_, i) => i + 1)],
    };
    const sheet = readZip(await buildXlsx([wide])).get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('r="Z1"');
    expect(sheet).toContain('r="AA1"');
    expect(sheet).toContain('r="AD1"');
  });
});
