import './styles/guides.css';
import './styles/documents.css';
import { escapeHtml, formatBytes } from './game/base';
import { assetUrl } from './shared/base';
import { parseDocumentCatalog, type ArchivedDocumentV1, type DocumentCatalogV1 } from './documents/catalog';

const get = <T extends HTMLElement>(selector: string): T => {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error('자료실 화면을 준비할 수 없습니다.');
  return node;
};
const categoryLabel = (item: ArchivedDocumentV1) => item.category === 'mortgage' ? '전용 모기지' : '공식 공고·안내';
const dateLabel = (value: string) => value.replaceAll('-', '.');
let catalog: DocumentCatalogV1 | undefined;
let activeId = '';
let pending = false;

function metadata(item: ArchivedDocumentV1): string {
  return [`보관 ${dateLabel(item.retrievedAt)}`, item.pageCount ? `${item.pageCount}쪽` : '', item.bytes ? formatBytes(item.bytes) : ''].filter(Boolean).join(' · ');
}

function renderSelection(id: string, navigate = false): void {
  const item = catalog?.documents.find(candidate => candidate.id === id);
  if (!item) return;
  activeId = item.id;
  document.title = `${item.title} · 공식 문서 · 분당퍼스트빌리지`;
  get('#documentsList').innerHTML = catalog!.documents.map(doc => `<button type="button" class="document-item ${doc.id === activeId ? 'is-active' : ''}" data-document-id="${doc.id}" aria-pressed="${doc.id === activeId}" aria-labelledby="document-card-${doc.id}"><span>${categoryLabel(doc)}</span><b id="document-card-${doc.id}">${escapeHtml(doc.title)}</b><small>${escapeHtml(metadata(doc))}</small></button>`).join('');
  const download = escapeHtml(assetUrl(item.file));
  get('#documentReader').innerHTML = `<header><span class="document-category">${categoryLabel(item)}</span><h2 id="documentTitle" tabindex="-1">${escapeHtml(item.title)}</h2><p>${escapeHtml(item.description)}</p><small class="document-metadata">${escapeHtml(metadata(item))}</small></header>
    ${item.notice ? `<p class="document-notice">${escapeHtml(item.notice)}</p>` : ''}
    <div class="document-actions"><a class="document-download" href="${download}" download="${escapeHtml(item.title)}.pdf"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/></svg>PDF 다운로드</a><a href="${download}" target="_blank" rel="noopener noreferrer">PDF 새 탭에서 열기 ↗</a>${item.summaryGuideId ? `<a href="../guides/?guide=${encodeURIComponent(item.summaryGuideId)}">핵심·계산 안내 읽기 →</a>` : ''}</div>
    <section class="document-preview" aria-labelledby="document-preview-title"><h3 id="document-preview-title">보관 PDF 미리보기</h3><p>미리보기는 아래 버튼을 누를 때만 불러옵니다. 모바일에서 문서가 보이지 않으면 ‘새 탭에서 열기’ 또는 ‘PDF 다운로드’를 이용하세요.</p><button class="document-preview-button" type="button" data-preview-document="${item.id}" aria-controls="documentPdfViewer" aria-expanded="false">이 화면에서 PDF 보기</button><div id="documentPdfViewer" hidden></div></section>
    <footer class="document-source"><span>원문 출처</span><a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.sourceLabel)} ↗</a><p>위 다운로드는 이 사이트에 보관한 사본입니다. 원문 링크의 변경·만료와 무관하게 보관본을 확인할 수 있습니다.</p></footer>`;
  if (navigate) {
    const url = new URL(window.location.href);
    url.search = new URLSearchParams({ document: item.id }).toString();
    window.history.replaceState(null, '', url);
    get('#documentTitle').focus({ preventScroll: true });
    if (window.matchMedia('(max-width: 820px)').matches) {
      get('#documentReader').scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }
  }
}

async function load(): Promise<void> {
  if (pending) return;
  pending = true;
  get('#documentsError').hidden = true;
  get('#documentsLayout').hidden = true;
  get('#documentsList').replaceChildren();
  get('#documentReader').replaceChildren();
  get('#documentsStatus').textContent = '보관 문서를 불러오는 중입니다.';
  get<HTMLButtonElement>('#documentsRetry').disabled = true;
  try {
    const response = await fetch(assetUrl('documents/document-catalog.v1.json'), { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) throw new Error('문서 목록을 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.');
    catalog = parseDocumentCatalog(await response.json());
    if (!catalog.documents.length) throw new Error('공개 보관 문서를 준비하고 있습니다. 잠시 후 다시 확인해 주세요.');
    get('#documentsStatus').textContent = `${catalog.documents.length}개 보관 문서 · 자료실 업데이트 ${dateLabel(catalog.updatedAt)}`;
    const requested = new URLSearchParams(window.location.search).get('document');
    const selected = catalog.documents.find(item => item.id === requested)?.id ?? catalog.documents[0].id;
    renderSelection(selected);
    get('#documentsLayout').hidden = false;
  } catch (error) {
    catalog = undefined;
    get('#documentsStatus').textContent = '문서 목록을 표시하지 못했습니다.';
    get('#documentsError p').textContent = error instanceof Error ? error.message : '문서 목록을 확인할 수 없습니다.';
    get('#documentsError').hidden = false;
  } finally {
    pending = false;
    get<HTMLButtonElement>('#documentsRetry').disabled = false;
  }
}

get('#documentsRetry').addEventListener('click', () => void load());
get('#documentsList').addEventListener('click', event => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-document-id]');
  if (button) renderSelection(button.dataset.documentId!, true);
});
get('#documentReader').addEventListener('click', event => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-preview-document]');
  const item = catalog?.documents.find(doc => doc.id === button?.dataset.previewDocument);
  if (!button || !item) return;
  const region = get('#documentPdfViewer');
  if (!region.hidden) {
    region.replaceChildren();
    region.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    button.textContent = '이 화면에서 PDF 보기';
    return;
  }
  region.innerHTML = `<iframe title="${escapeHtml(item.title)} PDF 보관본" src="${escapeHtml(assetUrl(item.file))}#view=FitH" loading="lazy"></iframe>`;
  region.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  button.textContent = 'PDF 미리보기 닫기';
});
void load();
