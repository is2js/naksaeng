export interface ArchivedDocumentV1 {
  id: string;
  title: string;
  description: string;
  category: 'official' | 'mortgage';
  /** Project-relative archived copy, never the temporary source sharing link. */
  file: string;
  sourceUrl: string;
  sourceLabel: string;
  retrievedAt: string;
  pageCount?: number;
  bytes?: number;
  sha256?: string;
  summaryGuideId?: string;
  notice?: string;
}

export interface DocumentCatalogV1 {
  schemaVersion: 1;
  updatedAt: string;
  documents: readonly ArchivedDocumentV1[];
}

const invalid = (): never => { throw new Error('공식 문서 목록 형식이 올바르지 않습니다. 잠시 후 다시 시도해 주세요.'); };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, limit: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= limit;
const date = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
};

export function parseDocumentCatalog(value: unknown): DocumentCatalogV1 {
  if (!record(value) || value.schemaVersion !== 1 || !date(value.updatedAt)
    || !Array.isArray(value.documents) || value.documents.length > 32) return invalid();
  const ids = new Set<string>();
  const files = new Set<string>();
  const documents = value.documents.map((entry): ArchivedDocumentV1 => {
    if (!record(entry) || !text(entry.id, 80) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry.id)
      || ids.has(entry.id) || !text(entry.title, 180) || !text(entry.description, 1600)
      || !['official', 'mortgage'].includes(String(entry.category))
      || !text(entry.file, 180) || !/^documents\/[a-z0-9]+(?:[-.][a-z0-9]+)*\.pdf$/u.test(entry.file)
      || files.has(entry.file) || !text(entry.sourceUrl, 2000) || !text(entry.sourceLabel, 180)
      || !date(entry.retrievedAt)) return invalid();
    let source: URL;
    try { source = new URL(entry.sourceUrl); } catch { return invalid(); }
    if (source.protocol !== 'https:' || source.username || source.password) return invalid();
    if (entry.pageCount !== undefined && (!Number.isInteger(entry.pageCount) || Number(entry.pageCount) < 1 || Number(entry.pageCount) > 2000)) return invalid();
    if (entry.bytes !== undefined && (!Number.isSafeInteger(entry.bytes) || Number(entry.bytes) < 1)) return invalid();
    if (entry.sha256 !== undefined && (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(entry.sha256))) return invalid();
    if (entry.summaryGuideId !== undefined && (typeof entry.summaryGuideId !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry.summaryGuideId))) return invalid();
    if (entry.notice !== undefined && !text(entry.notice, 2400)) return invalid();
    ids.add(entry.id);
    files.add(entry.file);
    return {
      id: entry.id, title: entry.title, description: entry.description,
      category: entry.category as ArchivedDocumentV1['category'], file: entry.file,
      sourceUrl: entry.sourceUrl, sourceLabel: entry.sourceLabel, retrievedAt: entry.retrievedAt,
      ...(entry.pageCount !== undefined ? { pageCount: Number(entry.pageCount) } : {}),
      ...(entry.bytes !== undefined ? { bytes: Number(entry.bytes) } : {}),
      ...(entry.sha256 !== undefined ? { sha256: entry.sha256 as string } : {}),
      ...(entry.summaryGuideId !== undefined ? { summaryGuideId: entry.summaryGuideId as string } : {}),
      ...(entry.notice !== undefined ? { notice: entry.notice as string } : {}),
    };
  });
  return { schemaVersion: 1, updatedAt: value.updatedAt, documents };
}
