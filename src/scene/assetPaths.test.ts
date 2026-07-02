import { describe, it, expect } from 'vitest';
import { resolveAssetUrl } from './assetPaths';

describe('resolveAssetUrl', () => {
  it('prefixes public assets with the configured base path', () => {
    expect(resolveAssetUrl('/models/inner-ear/inner-ear.obj', '/bppv-simulator/', 'https://example.com')).toBe(
      'https://example.com/bppv-simulator/models/inner-ear/inner-ear.obj'
    );
  });

  it('keeps root-relative paths correct when the base is the site root', () => {
    expect(resolveAssetUrl('/models/head/head.obj', '/', 'https://example.com')).toBe(
      'https://example.com/models/head/head.obj'
    );
  });
});
