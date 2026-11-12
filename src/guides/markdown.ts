import { escapeHtml } from '../game/base';

export interface GuideDocument {
  id: string;
  title: string;
  shortTitle: string;
  category: string;
  summary: string;
  updatedAt: string;
  order: number;
  operatorOnly: boolean;
  body: string;
  sourcePath: string;
  raw: string;
}

function safeLink(href: string): string | null {
  return /^(?:https?:\/\/|\/|\.\.?\/|#|\?)/i.test(href) ? href : null;
}

function renderInline(source: string): string {
  return escapeHtml(source)
    .replace(/\[([^\]]+)]\(([^)\s]+)\)/g, (_match, label: string, href: string) => {
      const safe = safeLink(href);
      if (!safe) return `${label} (${href})`;
      const external = /^https?:\/\//i.test(safe) ? ' target="_blank" rel="noreferrer"' : '';
      return `<a href="${safe}"${external}>${label}</a>`;
    })
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function tableCells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function isTableDivider(line: string): boolean {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

export function renderGuideMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];
  let paragraph: string[] = [];
  let listKind: 'ul' | 'ol' | null = null;
  let listItems: string[] = [];

  const flushParagraph = (): void => {
    if (!paragraph.length) return;
    output.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = (): void => {
    if (!listKind || !listItems.length) return;
    output.push(`<${listKind}>${listItems.map((item) => `<li>${renderInline(item)}</li>`).join('')}</${listKind}>`);
    listKind = null;
    listItems = [];
  };
  const flush = (): void => {
    flushParagraph();
    flushList();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('```')) {
      flush();
      const language = line.slice(3).trim().replace(/[^a-z0-9_-]/gi, '');
      const code: string[] = [];
      while (++index < lines.length && !lines[index].startsWith('```')) code.push(lines[index]);
      output.push(`<pre><code${language ? ` class="language-${language}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    if (line.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      flush();
      const headers = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      index -= 1;
      output.push(`<div class="table-scroll"><table><thead><tr>${headers.map((cell) => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((_header, cellIndex) => `<td>${renderInline(row[cellIndex] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length + 1;
      output.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }
    const unordered = /^[-*]\s+(.+)$/.exec(line);
    const ordered = /^\d+\.\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      const nextKind = unordered ? 'ul' : 'ol';
      if (listKind && listKind !== nextKind) flushList();
      listKind = nextKind;
      listItems.push((unordered || ordered)![1]);
      continue;
    }
    if (line.startsWith('> ')) {
      flush();
      output.push(`<blockquote>${renderInline(line.slice(2))}</blockquote>`);
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      flush();
      output.push('<hr>');
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return output.join('\n');
}

export function parseGuideDocument(raw: string, sourcePath: string): GuideDocument {
  const normalized = raw.replace(/\r\n?/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  if (!match) throw new Error(`${sourcePath}: Markdown front matter가 없습니다.`);
  const meta = Object.fromEntries(match[1].split('\n').flatMap((line) => {
    const separator = line.indexOf(':');
    if (separator < 1) return [];
    return [[line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')]];
  }));
  const id = String(meta.id || '');
  const title = String(meta.title || '');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || !title) throw new Error(`${sourcePath}: id 또는 title이 올바르지 않습니다.`);
  return {
    id,
    title,
    shortTitle: String(meta.shortTitle || title),
    category: String(meta.category || '일반'),
    summary: String(meta.summary || ''),
    updatedAt: String(meta.updatedAt || ''),
    order: Number.isFinite(Number(meta.order)) ? Number(meta.order) : 999,
    operatorOnly: String(meta.operatorOnly || '').toLowerCase() === 'true',
    body: normalized.slice(match[0].length).trim(),
    sourcePath,
    raw: normalized,
  };
}
