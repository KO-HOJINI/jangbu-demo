import { describe, expect, it } from 'vitest';
import { sheetZoom } from '../src/lib/sheetZoom';

// 좁은 화면에서 A4 양식을 화면 폭에 맞추는 배율
describe('A4 양식 배율', () => {
  const sheetPx = (210 / 25.4) * 96; // 210mm ≈ 793.7px

  it('양옆 여백 16px 을 뺀 폭에 양식이 딱 들어간다', () => {
    for (const width of [320, 360, 375, 390, 412, 768]) {
      const shown = sheetPx * sheetZoom(width);
      expect(shown).toBeLessThanOrEqual(width - 32);
      expect(shown).toBeGreaterThan(width - 32 - 2);
    }
  });

  it('넓은 화면에서는 키우지 않는다', () => {
    expect(sheetZoom(1366)).toBe(1);
  });
});
