import '../styles/guide-markdown.css';
import { escapeHtml } from '../game/base';
import { guideDocuments } from './catalog';
import { renderGuideMarkdown } from './markdown';
import { guidePageUrl } from './navigation';

export function renderPlaygroundGuide(dialog: HTMLDialogElement, operator: boolean, returnUrl: string, id = 'playground'): void {
  const guides = guideDocuments().filter((guide) => !guide.operatorOnly || operator);
  dialog.innerHTML = `<header class="playground-guide-header"><h2 id="playground-guide-title">놀이터 조작법</h2><button type="button" class="dialog-close" aria-label="가이드 닫기" autofocus>×</button></header>
    <div class="playground-guide-tools"><label>가이드 <select aria-label="가이드 문서">${guides.map((guide) => `<option value="${escapeHtml(guide.id)}">${escapeHtml(guide.shortTitle)}</option>`).join('')}</select></label><a target="_blank" rel="noopener noreferrer">새 탭에서 보기 ↗</a></div>
    <article class="markdown-body" tabindex="0" aria-label="가이드 본문"></article>`;
  const select = dialog.querySelector<HTMLSelectElement>('select')!;
  const article = dialog.querySelector<HTMLElement>('article')!;
  const separateLink = dialog.querySelector<HTMLAnchorElement>('.playground-guide-tools a')!;
  const paint = (requestedId: string): void => {
    const guide = guides.find((candidate) => candidate.id === requestedId) || guides[0];
    if (!guide) return;
    select.value = guide.id;
    separateLink.href = guidePageUrl(guide.id, returnUrl, true);
    article.innerHTML = renderGuideMarkdown(guide.body);
    article.scrollTop = 0;
    article.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
      const url = new URL(link.getAttribute('href')!, separateLink.href);
      if (url.origin === window.location.origin && url.pathname === new URL(separateLink.href).pathname && url.searchParams.has('guide')) {
        link.href = guidePageUrl(url.searchParams.get('guide')!, returnUrl);
        link.addEventListener('click', (event) => { event.preventDefault(); paint(url.searchParams.get('guide')!); });
      } else {
        link.href = url.toString();
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
    });
  };
  select.addEventListener('change', () => paint(select.value));
  dialog.querySelector<HTMLButtonElement>('.dialog-close')!.addEventListener('click', () => dialog.close());
  paint(id);
  dialog.querySelector<HTMLButtonElement>('.dialog-close')!.focus({ preventScroll: true });
}
