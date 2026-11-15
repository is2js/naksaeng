import { parseGuideDocument, type GuideDocument } from './markdown';
import { guideIsOperator, guideMarkdownForAccess, type GuideAccess } from './audience';

const markdownSources = import.meta.glob('./content/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export function guideDocuments(): GuideDocument[] {
  return Object.entries(markdownSources)
    .map(([path, raw]) => parseGuideDocument(raw, path))
    .sort((left, right) => left.order - right.order || left.title.localeCompare(right.title, 'ko'));
}

export function guideDocumentsForAccess(access: GuideAccess): GuideDocument[] {
  return guideDocuments()
    .filter(guide => !guide.operatorOnly || guideIsOperator(access))
    .map(guide => ({ ...guide, body: guideMarkdownForAccess(guide.body, access) }));
}
