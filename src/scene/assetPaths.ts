export function resolveAssetUrl(url: string, base: string, origin: string): string {
  if (!url.startsWith('/')) return url;

  const normalizedBase = base === '/' ? '/' : `/${base.replace(/^\/+|\/+$/g, '')}/`;
  const normalizedOrigin = origin.replace(/\/$/, '');

  if (normalizedBase === '/') {
    return `${normalizedOrigin}${url}`;
  }

  return `${normalizedOrigin}${normalizedBase}${url.replace(/^\//, '')}`;
}
