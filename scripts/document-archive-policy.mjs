import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_PDF_BYTES = 35 * 1024 * 1024;
const MAX_CATALOG_BYTES = 256 * 1024;
const MAX_VIEWER_HTML_BYTES = 128 * 1024;
const APPROVED_IDS = new Set(['mortgage-product', 'sale-notice', 'supply-guide', 'contract-procedure', 'stamp-tax-notice', 'funding-plan-notice']);
const ROOT_KEYS = new Set(['schemaVersion', 'updatedAt', 'documents']);
const DOCUMENT_KEYS = new Set(['id', 'title', 'description', 'category', 'file', 'sourceUrl', 'sourceLabel', 'retrievedAt', 'pageCount', 'bytes', 'sha256', 'summaryGuideId', 'notice']);
const PDF_PATH = /^documents\/[a-z0-9]+(?:[-.][a-z0-9]+)*\.pdf$/u;
const SENSITIVE_NAME = /(?:^|[-_.])(?:personal|private|signed|contract|contracts|agreement|account|accounts|sheet|sheets|spreadsheet|members|member|auth|verification|household|nickname|request|raw|dump)(?:[-_.]|$)/iu;
const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);
const hasOnlyKeys = (value, allowed) => Object.keys(value).every(key => allowed.has(key));
const isText = (value, limit) => typeof value === 'string' && !!value.trim() && value.length <= limit;
const isDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
};
const inside = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return !!relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

/**
 * Separate reviewed public PDFs from the game's existing 50 MiB budget.
 * Merely putting a PDF in this folder does not approve it: membership, source,
 * metadata, physical bytes and SHA-256 must all agree, with no extra files.
 * This is a static integrity policy, not automated personal-data detection.
 */
export async function verifyDocumentArchive(appRoot) {
  const result = { bytes: 0, files: new Set(), failures: [] };
  const fail = message => result.failures.push(`document archive: ${message}`);
  if (typeof appRoot !== 'string' || !appRoot) { fail('invalid application root'); return result; }
  const root = path.resolve(appRoot);
  const archiveRoot = path.join(root, 'documents');
  const catalogPath = path.join(archiveRoot, 'document-catalog.v1.json');
  try {
    const rootInfo = await lstat(root);
    const archiveInfo = await lstat(archiveRoot);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || !inside(root, archiveRoot)
      || !archiveInfo.isDirectory() || archiveInfo.isSymbolicLink()) {
      fail('application/document directory must be a real directory, not a symlink');
      return result;
    }
  } catch { fail('document directory is missing or unreadable'); return result; }

  const physicalFiles = new Map();
  try {
    for (const entry of await readdir(archiveRoot, { withFileTypes: true })) {
      const absolute = path.resolve(archiveRoot, entry.name);
      if (!inside(archiveRoot, absolute)) { fail('file escaped the document directory'); continue; }
      const info = await lstat(absolute);
      if (info.isSymbolicLink() || !info.isFile()) { fail('symlinks and nested/non-file entries are forbidden'); continue; }
      if (entry.name === 'index.html') {
        // Vite emits the public viewer beside the PDF directory. Its HTML is
        // application code, not an archived document, so never deduct it from
        // the application's existing budget or add it to the archive allowance.
        if (info.size < 1 || info.size > MAX_VIEWER_HTML_BYTES) {
          fail('document viewer index.html must be nonempty HTML within 128 KiB');
          continue;
        }
        const html = await readFile(absolute, 'utf8');
        if (!/^\uFEFF?\s*<!doctype\s+html\s*>/iu.test(html)
          || !/<html(?:\s|>)/iu.test(html) || !/<\/html\s*>/iu.test(html)) {
          fail('document viewer index.html must be an HTML document, not a disguised PDF');
        }
        continue;
      }
      result.bytes += info.size;
      result.files.add(absolute);
      physicalFiles.set(entry.name, { absolute, size: info.size });
    }
  } catch { fail('document files could not be enumerated'); return result; }
  if (result.bytes > MAX_ARCHIVE_BYTES) fail('total archive including catalog exceeds 50 MiB');
  const catalogFile = physicalFiles.get('document-catalog.v1.json');
  if (!catalogFile || catalogFile.size < 1 || catalogFile.size > MAX_CATALOG_BYTES) {
    fail('catalog is missing, empty or exceeds 256 KiB');
    return result;
  }
  let catalog;
  try { catalog = JSON.parse(await readFile(catalogPath, 'utf8')); }
  catch { fail('catalog is not valid JSON'); return result; }
  if (!isRecord(catalog) || !hasOnlyKeys(catalog, ROOT_KEYS) || catalog.schemaVersion !== 1 || !isDate(catalog.updatedAt)
    || !Array.isArray(catalog.documents) || catalog.documents.length < 1 || catalog.documents.length > APPROVED_IDS.size) {
    fail('unsupported catalog schema, fields, date or document count');
    return result;
  }

  const declaredFiles = new Set(['document-catalog.v1.json']);
  const ids = new Set();
  for (const [index, item] of catalog.documents.entries()) {
    const label = `documents[${index}]`;
    if (!isRecord(item) || !hasOnlyKeys(item, DOCUMENT_KEYS) || !APPROVED_IDS.has(item.id) || ids.has(item.id)) {
      fail(`${label}: unapproved/duplicate ID or unknown metadata fields`);
      continue;
    }
    ids.add(item.id);
    if (!isText(item.title, 180) || !isText(item.description, 1600) || !isText(item.sourceLabel, 180)
      || !isDate(item.retrievedAt) || item.category !== (item.id === 'mortgage-product' ? 'mortgage' : 'official')
      || !Number.isInteger(item.pageCount) || item.pageCount < 1 || item.pageCount > 2000
      || !Number.isSafeInteger(item.bytes) || item.bytes < 1
      || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(item.sha256)
      || (item.summaryGuideId !== undefined && (typeof item.summaryGuideId !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(item.summaryGuideId)))
      || (item.notice !== undefined && !isText(item.notice, 2400))) {
      fail(`${label}: invalid required metadata or optional summary/notice`);
      continue;
    }
    let source;
    try { source = new URL(item.sourceUrl); }
    catch { fail(`${label}: invalid original source URL`); continue; }
    const sourceHosts = item.id === 'mortgage-product' ? ['obank.kbstar.com'] : ['elife.co.kr', 'www.elife.co.kr'];
    if (!isText(item.sourceUrl, 2000) || source.protocol !== 'https:' || source.username || source.password
      || source.port || !sourceHosts.includes(source.hostname)) {
      fail(`${label}: source must be the approved permanent official HTTPS host`);
      continue;
    }
    if (typeof item.file !== 'string' || !PDF_PATH.test(item.file)) {
      fail(`${label}: PDF must have an unambiguous local documents/*.pdf path`);
      continue;
    }
    const filename = item.file.slice('documents/'.length);
    const procedureNotice = item.id === 'contract-procedure' && /^contract-procedure(?:-\d{8})?\.pdf$/u.test(filename);
    if (SENSITIVE_NAME.test(filename) && !procedureNotice) {
      fail(`${label}: personal contract/account/sheet/raw-dump filename is forbidden`);
      continue;
    }
    if (declaredFiles.has(filename)) { fail(`${label}: duplicate archived PDF path`); continue; }
    declaredFiles.add(filename);
    const file = physicalFiles.get(filename);
    const absolute = path.resolve(root, item.file);
    if (!file || absolute !== file.absolute || !inside(archiveRoot, absolute)) {
      fail(`${label}: declared PDF is missing or outside the archive`);
      continue;
    }
    if (file.size > MAX_PDF_BYTES || item.bytes > MAX_PDF_BYTES) {
      fail(`${label}: single PDF exceeds 35 MiB`);
      continue;
    }
    if (file.size !== item.bytes) { fail(`${label}: declared byte size does not match PDF`); continue; }
    try {
      // Recheck immediately before reading; never intentionally follow a link.
      const info = await lstat(absolute);
      if (!info.isFile() || info.isSymbolicLink()) { fail(`${label}: PDF is not a regular file`); continue; }
      const pdf = await readFile(absolute);
      if (pdf.length !== file.size || pdf.subarray(0, 5).toString('ascii') !== '%PDF-') {
        fail(`${label}: PDF signature or measured file size is invalid`);
        continue;
      }
      const digest = createHash('sha256').update(pdf).digest('hex');
      if (digest !== item.sha256) fail(`${label}: SHA-256 does not match reviewed PDF`);
    } catch { fail(`${label}: PDF could not be read`); }
  }
  for (const filename of physicalFiles.keys()) {
    if (!declaredFiles.has(filename)) fail('undeclared/extra file is forbidden in document directory');
  }
  return result;
}
