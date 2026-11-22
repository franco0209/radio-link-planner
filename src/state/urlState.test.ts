import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../core/analysis';
import { decodeState, encodeState } from './urlState';

const A = { lat: -16.3989, lng: -71.535 };
const B = { lat: -16.402, lng: -71.401 };

describe('url state', () => {
  it('round-trips sites, repeaters and changed parameters', () => {
    const state = {
      a: A,
      b: B,
      repeaters: [
        { lat: -16.4, lng: -71.5, heightM: 15 },
        { lat: -16.401, lng: -71.45, heightM: 20 },
      ],
      params: { ...DEFAULT_PARAMS, freqMHz: 2437, heightAM: 25 },
    };
    const back = decodeState('#' + encodeState(state));
    expect(back.a).toEqual(A);
    expect(back.b).toEqual(B);
    expect(back.repeaters).toEqual(state.repeaters);
    expect(back.params.freqMHz).toBe(2437);
    expect(back.params.heightAM).toBe(25);
  });

  it('omits default parameters', () => {
    expect(decodeURIComponent(encodeState({ a: A, b: B, repeaters: [], params: DEFAULT_PARAMS }))).toBe('a=-16.39890,-71.53500&b=-16.40200,-71.40100');
  });

  it('caps repeaters at two and drops invalid ones', () => {
    const hash = 'a=-16.3989,-71.535&b=-16.402,-71.401&r1=-16.4,-71.5,15&r2=999,0,10';
    expect(decodeState(hash).repeaters).toHaveLength(1);
    const many = { a: A, b: B, repeaters: Array.from({ length: 5 }, () => ({ lat: -16.4, lng: -71.5, heightM: 10 })), params: DEFAULT_PARAMS };
    expect(decodeState(encodeState(many)).repeaters).toHaveLength(2);
  });

  it('ignores repeaters when a site is missing', () => {
    expect(decodeState('a=-16.3989,-71.535&r1=-16.4,-71.5,15').repeaters).toEqual([]);
  });

  it('rejects absurd heights', () => {
    expect(decodeState('a=-16.3989,-71.535&b=-16.402,-71.401&r1=-16.4,-71.5,9000').repeaters).toEqual([]);
  });
});
