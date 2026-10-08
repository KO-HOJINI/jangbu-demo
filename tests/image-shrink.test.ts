import { describe, expect, it } from 'vitest';
import { isHeicHeader } from '../src/lib/imageShrink';

/** 파일 이름·종류는 믿을 수 없어(윈도우는 HEIC 의 종류를 비워 보낸다) 앞머리 글자로 가린다 */
const head = (text: string) => Uint8Array.from([0, 0, 0, 0x28, ...[...text].map((ch) => ch.charCodeAt(0))]);

describe('HEIC 사진 알아보기', () => {
  it('아이폰 사진(heic·mif1 등)은 HEIC 로 본다', () => {
    expect(isHeicHeader(head('ftypheic'))).toBe(true);
    expect(isHeicHeader(head('ftypmif1'))).toBe(true);
    expect(isHeicHeader(head('ftypheix'))).toBe(true);
  });

  it('JPG·PNG·동영상(mp4)과 너무 짧은 파일은 아니다', () => {
    expect(isHeicHeader(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]))).toBe(false);
    expect(isHeicHeader(head('ftypisom'))).toBe(false);
    expect(isHeicHeader(head('ftyp'))).toBe(false);
  });
});
