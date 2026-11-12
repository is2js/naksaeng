import { projectBaseUrl } from '../game/base';

/** Only the playground's public rendering context may travel with a guide link. */
export function safePlaygroundReturnUrl(value: unknown, base = projectBaseUrl()): string | null {
  if (typeof value !== 'string' || value.length > 48000) return null;
  try {
    const url = new URL(value, base);
    if (url.origin !== base.origin || url.pathname !== base.pathname || url.username || url.password) return null;
    const map = url.searchParams.get('map');
    if (!map || !/^bundang-first-village-(51a|55a|55b|59a)-prototype$/.test(map)) return null;
    const query = new URLSearchParams({ map });
    const actor = url.searchParams.get('actor');
    const variant = url.searchParams.get('variant');
    if (actor === '100' || actor === '200') query.set('actor', actor);
    if (variant === 'A' || variant === 'B' || (variant === 'C' || variant === 'D') && /-(51a|55a)-/.test(map)) query.set('variant', variant);
    const hash = /^#share=v1\.[A-Za-z0-9_-]{1,32768}$/.test(url.hash) ? url.hash : '';
    return `${base.pathname}?${query}${hash}`;
  } catch { return null; }
}

export function guideReturnUrl(locationHref: string, referrer = '', base = projectBaseUrl(locationHref)): string {
  const value = new URLSearchParams(new URL(locationHref).hash.slice(1)).get('playground');
  return safePlaygroundReturnUrl(value, base) || safePlaygroundReturnUrl(referrer, base) || base.pathname;
}

export function guidePageUrl(id: string, returnUrl: string, openedInNewTab = false, base = projectBaseUrl()): string {
  const url = new URL('guides/', base);
  url.searchParams.set('guide', id);
  const safeReturn = safePlaygroundReturnUrl(returnUrl, base);
  // The optional shared layout remains in the fragment, never the HTTP query.
  if (safeReturn) url.hash = new URLSearchParams({ playground: safeReturn, ...(openedInNewTab ? { fromPlaygroundTab: '1' } : {}) }).toString();
  return url.toString();
}
