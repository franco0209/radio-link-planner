import { describe, expect, it } from 'vitest';
import { en } from './en';
import { es } from './es';
import { pt } from './pt';

const dicts = { en, es, pt };

/** Flatten a dictionary into "path" -> value so shapes can be compared. */
function flatten(obj: object, prefix = ''): Record<string, unknown> {
  return Object.entries(obj).reduce<Record<string, unknown>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') Object.assign(acc, flatten(v, key));
    else acc[key] = v;
    return acc;
  }, {});
}

describe('translations', () => {
  const base = flatten(en);

  it.each(['es', 'pt'] as const)('%s has exactly the same keys as English', (lang) => {
    expect(Object.keys(flatten(dicts[lang])).sort()).toEqual(Object.keys(base).sort());
  });

  it.each(['es', 'pt'] as const)('%s has no empty strings', (lang) => {
    for (const [key, value] of Object.entries(flatten(dicts[lang]))) {
      if (typeof value === 'string') expect(value.trim(), key).not.toBe('');
    }
  });

  it.each(['en', 'es', 'pt'] as const)('%s interpolating functions use their arguments', (lang) => {
    const d = dicts[lang];
    expect(d.result.raise(42)).toContain('42');
    expect(d.reason.blocked('9.5', 'FIX')).toContain('9.5');
    expect(d.reason.blocked('9.5', 'FIX')).toContain('FIX');
    expect(d.reason.lowMargin('7', 15)).toContain('7');
    expect(d.reason.lowMargin('7', 15)).toContain('15');
    expect(d.errors.elevationHttp(503)).toContain('503');
    expect(d.sites.site('B')).toContain('B');
    expect(d.chart.summary('14.3', '40', '9.5')).toContain('14.3');
  });
});
