import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './index.css';
import { keepFocusedFieldVisible } from './lib/keyboardScroll';
import { sheetZoom } from './lib/sheetZoom';
import { watchScrollHints } from './lib/scrollHints';

keepFocusedFieldVisible();
watchScrollHints();

// 화면 폭에서 정해지는 값을 CSS 에 넘긴다 (index.css)
//   --scrollbar-width  이 기기의 스크롤 막대 폭 (휴대폰은 0)
//   --scrollbar-now    지금 스크롤 막대가 차지하고 있는 폭 (스크롤이 없으면 0)
//                      → .gutter-balance 가 이 둘로 내용을 늘 창 한가운데 같은 자리에 둔다
//   --sheet-zoom       좁은 화면에서 A4 양식(210mm)을 화면 폭에 맞추는 배율
const scrollbarWidth = () => {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;top:-999px;width:100px;height:100px;overflow:scroll';
  document.body.appendChild(probe);
  const width = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return width;
};
const measureGutter = () => {
  const root = document.documentElement;
  const now = window.innerWidth - root.clientWidth;
  // 화면 확대 배율에 따라 폭이 조금씩 달라져, 지금 보이는 막대가 있으면 그 폭을 따른다
  root.style.setProperty('--scrollbar-width', `${now > 0 ? now : scrollbarWidth()}px`);
  root.style.setProperty('--scrollbar-now', `${now}px`);
  root.style.setProperty('--sheet-zoom', sheetZoom(root.clientWidth).toFixed(3));
};
// 화면이 그려지기 전에는 0 으로 잡힐 수 있어, 다 불러온 뒤와 창 크기가 바뀔 때마다 다시 잰다
measureGutter();
window.addEventListener('load', measureGutter);
window.addEventListener('resize', measureGutter);
new ResizeObserver(measureGutter).observe(document.documentElement);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
