import './styles/guides.css';
import './styles/guide-markdown.css';
import { escapeHtml } from './game/base';
import { guideDocuments } from './guides/catalog';
import { renderGuideMarkdown } from './guides/markdown';
import { householdVerificationIsOperator } from './game/household-verification';
import { guidePageUrl, guideReturnUrl } from './guides/navigation';

const operator = householdVerificationIsOperator();
const guides = guideDocuments().filter((guide) => !guide.operatorOnly || operator);
const query = new URLSearchParams(window.location.search);
const requestedId = query.get('guide') || 'playground';
const active = guides.find((guide) => guide.id === requestedId) || guides[0];
const returnUrl = guideReturnUrl(window.location.href, document.referrer);
const openedInNewTab = new URLSearchParams(window.location.hash.slice(1)).get('fromPlaygroundTab') === '1';

document.querySelectorAll<HTMLAnchorElement>('[data-playground-return]').forEach((link) => {
  link.href = returnUrl;
  if (openedInNewTab) link.addEventListener('click', (event) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    window.close();
    window.setTimeout(() => window.location.assign(returnUrl), 100);
  });
});
const returnNotice = document.querySelector<HTMLElement>('#guideReturnNotice');
if (returnNotice) returnNotice.hidden = !openedInNewTab;
const guideHome = document.querySelector<HTMLAnchorElement>('[data-guide-home]');
if (guideHome) guideHome.href = guidePageUrl('playground', returnUrl, openedInNewTab);

document.querySelectorAll<HTMLElement>('[data-operator-only]').forEach((element) => { element.hidden = !operator; });

function get<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing guide element: ${selector}`);
  return element;
}

try {
  if (!active) throw new Error('등록된 Markdown 가이드가 없습니다.');
  document.title = `${active.title} · bunfirvil`;
  document.body.dataset.guideId = active.id;
  get<HTMLElement>('#guideCount').textContent = `${guides.length} DOCUMENT${guides.length === 1 ? '' : 'S'}`;
  get<HTMLElement>('#guideList').innerHTML = guides.map((guide) => `
    <a class="guide-item ${guide.id === active.id ? 'is-active' : ''}" href="${escapeHtml(guidePageUrl(guide.id, returnUrl, openedInNewTab))}" ${guide.id === active.id ? 'aria-current="page"' : ''}>
      <span>${escapeHtml(guide.category)}</span>
      <b>${escapeHtml(guide.shortTitle)}</b>
      <small>${escapeHtml(guide.summary)}</small>
    </a>
  `).join('');
  get<HTMLElement>('#guideCategory').textContent = active.category;
  get<HTMLTimeElement>('#guideUpdatedAt').textContent = active.updatedAt ? `업데이트 ${active.updatedAt}` : '';
  get<HTMLTimeElement>('#guideUpdatedAt').dateTime = active.updatedAt;
  get<HTMLElement>('#guideTitle').textContent = active.title;
  get<HTMLElement>('#guideSummary').textContent = active.summary;
  get<HTMLElement>('#markdownBody').innerHTML = renderGuideMarkdown(active.body);
  get<HTMLElement>('#markdownBody').querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
    const url = new URL(link.getAttribute('href')!, window.location.href);
    if (url.origin === window.location.origin && url.pathname === window.location.pathname && url.searchParams.has('guide')) {
      link.href = guidePageUrl(url.searchParams.get('guide')!, returnUrl, openedInNewTab);
    }
  });
  get<HTMLElement>('#markdownSource').textContent = active.raw;
  if (operator) {
    const fileName = active.sourcePath.split('/').pop() || `${active.id}.md`;
    get<HTMLAnchorElement>('#guideEditLink').href = `https://github.com/is2js/naksaeng/edit/main/src/guides/content/${encodeURIComponent(fileName)}`;
  }
} catch (error) {
  const region = get<HTMLElement>('#guideError');
  region.hidden = false;
  region.textContent = error instanceof Error ? error.message : '가이드 문서를 표시할 수 없습니다.';
  get<HTMLElement>('.guide-layout').hidden = true;
}
