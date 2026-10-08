import { describe, expect, it } from 'vitest';

describe('코드 분할 및 동적 모듈 로드 검증', () => {
  it('주요 페이지 모듈들이 dynamic import를 통해 정상적으로 로드된다', async () => {
    const [
      loginPage,
      ledgerPage,
      sitesPage,
      siteDetailPage,
      siteFormPage,
      statementsPage,
      quotesPage,
      dashboardPage,
      settingsPage,
    ] = await Promise.all([
      import('../src/pages/LoginPage'),
      import('../src/pages/LedgerPage'),
      import('../src/pages/SitesPage'),
      import('../src/pages/SiteDetailPage'),
      import('../src/pages/SiteFormPage'),
      import('../src/pages/StatementsPage'),
      import('../src/pages/QuotesPage'),
      import('../src/pages/DashboardPage'),
      import('../src/pages/SettingsPage'),
    ]);

    expect(typeof loginPage.default).toBe('function');
    expect(typeof ledgerPage.default).toBe('function');
    expect(typeof sitesPage.default).toBe('function');
    expect(typeof siteDetailPage.default).toBe('function');
    expect(typeof siteFormPage.default).toBe('function');
    expect(typeof statementsPage.default).toBe('function');
    expect(typeof quotesPage.default).toBe('function');
    expect(typeof dashboardPage.default).toBe('function');
    expect(typeof settingsPage.default).toBe('function');
  });
});
