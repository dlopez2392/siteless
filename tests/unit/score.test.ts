/**
 * D-09 / DEDUP-01: the pair scorer, pinned.
 *
 * 🔴 EXACT, NEVER A RANGE. Every score is `toBe(n)` / `toEqual`. "Re-tuning is a constant edit
 * that a red test confronts" only holds if the assertion is exact; a range absorbs a ±4
 * weight change in silence. No score here is asserted with a greater-than or less-than.
 *
 * 🔴 EACH STRUCTURAL RULE HAS ITS OWN NAMED TEST, and each test reaches a pair where that rule
 * BINDS: without it, the pair's raw sum really would reach 95. A test over a pair already
 * below the cap (P04 at 84, P08 at 75) proves nothing about the cap, because deleting it
 * changes no outcome. That is why tests 2, 3 and 6 assert the raw sum as well as the result.
 *
 *   M13 delete R1 -> `never merges across 25 km` + the P06 fixture row
 *   M14 delete R5 -> `one signal cannot reach 95` only (R5 binds only under a re-tuned table)
 *   M15 delete R6 -> `no geo gate caps at 94` + the P09 fixture row
 *
 * The fixture, its provenance and its known misses: tests/unit/fixtures/merge-pairs.README.md.
 */
import { describe, expect, it } from 'vitest';

import {
  AUTO_MERGE_SCORE,
  DEFAULT_WEIGHTS,
  PHONE_LIFT_MIN_NAME_SIM,
  REVIEW_CEILING,
  REVIEW_SCORE,
  distanceMeters,
  geoGate,
  score,
  type Band,
  type CandidatePair,
  type Features,
  type ScoreResult,
  type Side,
  type SignalName,
} from '@/lib/resolve/score';

import pairsJson from './fixtures/merge-pairs.json';
import tripleJson from './fixtures/merge-triple.json';

type FixtureSide = Side & { sourceName: string };
type FixturePair = {
  id: string;
  label: string;
  synthetic: boolean;
  known_miss?: boolean;
  intended_band?: Band;
  why?: string;
  provenance: string;
  assumptions?: string[];
  nameSim: number;
  a: FixtureSide;
  b: FixtureSide;
  expect: {
    score: number;
    band: Band;
    signals: SignalName[];
    geoGate?: boolean;
    rule?: Features['rule'];
  };
};
type FixtureTriple = {
  id: string;
  synthetic: boolean;
  records: FixtureSide[];
  edges: { a: string; b: string; nameSim: number; expect: FixturePair['expect'] }[];
};

const PAIRS = pairsJson as unknown as FixturePair[];
const TRIPLE = tripleJson as unknown as FixtureTriple;

function fixture(id: string): FixturePair {
  const p = PAIRS.find((x) => x.id === id);
  if (!p) throw new Error(`merge-pairs.json has no pair ${id}`);
  return p;
}

function pairOf(p: FixturePair): CandidatePair {
  return { a: p.a, b: p.b, nameSim: p.nameSim };
}

/** The unclamped, pre-rule sum. A cap test asserts it to prove the cap actually binds. */
function rawSum(r: ScoreResult): number {
  const f = r.features;
  return f.name + f.phone + f.address + f.distance + f.cluster;
}

/** A synthetic Overture side; every test-local record is fictional. */
function side(overrides: Partial<Side>): Side {
  return {
    id: 'synthetic',
    source: 'overture',
    nameNorm: 'synthetic',
    phoneE164: null,
    phoneBlockable: false,
    streetNum: '500',
    streetNorm: 'synthetic st',
    postal: '78501',
    lat: 26.2,
    lng: -98.23,
    locationMatchType: 'overture',
    clusterKey: 'auto_retail',
    chainKey: null,
    ...overrides,
  };
}

const SOURCES = new Set(['tx_comptroller', 'overture']);
const MATCH_TYPES = new Set(['overture', 'census_exact', 'census_non_exact', null]);

describe('merge-pairs fixture', () => {
  it('merge-pairs fixture is well-formed', () => {
    expect(PAIRS.map((p) => p.id)).toEqual([
      'P01',
      'P02',
      'P03',
      'P04',
      'P05',
      'P06',
      'P07',
      'P08',
      'P09',
      'P10',
    ]);
    for (const p of PAIRS) {
      for (const s of [p.a, p.b]) {
        expect(SOURCES.has(s.source), `${p.id} ${s.id} source`).toBe(true);
        expect(MATCH_TYPES.has(s.locationMatchType), `${p.id} ${s.id} match type`).toBe(true);
        if (p.synthetic) {
          expect(s.sourceName, `${p.id} synthetic name`).toMatch(/^synthetic /i);
          if (s.phoneE164 !== null) {
            expect(s.phoneE164, `${p.id} fictional phone`).toMatch(/^\+1\d{3}55501\d{2}$/);
          }
        } else {
          // A real pair must never carry an invented phone.
          expect(s.phoneE164, `${p.id} real pair phone`).toBeNull();
        }
      }
      if (p.known_miss) {
        expect(p.intended_band, `${p.id} intended_band`).toBeDefined();
        expect(p.intended_band, `${p.id} miss differs`).not.toBe(p.expect.band);
        expect(p.why, `${p.id} why`).toBeTruthy();
      }
    }
    expect(PAIRS.filter((p) => p.known_miss).map((p) => p.id)).toEqual(['P02', 'P03', 'P10']);
  });

  it.each(PAIRS.map((p) => [p.id, p] as const))('merge-pairs fixture %s', (_id, p) => {
    const r = score(pairOf(p));
    expect({ score: r.score, band: r.band, signals: r.signals }).toEqual({
      score: p.expect.score,
      band: p.expect.band,
      signals: p.expect.signals,
    });
    if (p.expect.rule !== undefined) expect(r.features.rule).toBe(p.expect.rule);
    if (p.expect.geoGate !== undefined) {
      expect(geoGate(p.a, p.b, r.features.distanceM)).toBe(p.expect.geoGate);
    }
    // T-3-11: the stored feature vector never carries a normalized name.
    expect(JSON.stringify(r.features)).not.toContain(p.a.nameNorm ?? '\u0000');
  });
});

describe('score() structural rules', () => {
  it('one signal cannot reach 95', () => {
    const p08 = pairOf(fixture('P08'));
    const r = score(p08);
    expect(r.score).toBe(75);
    expect(r.signals).toEqual(['name']);

    // Under the committed weights R5 never binds: no single-signal pair sums past 94. So the
    // rule is pinned where it WOULD bind, a re-tune that lifts the name weight to 70.
    const retuned = score(p08, { ...DEFAULT_WEIGHTS, nameMax: 70 });
    expect(rawSum(retuned)).toBe(100);
    expect(retuned.signals).toEqual(['name']);
    expect(retuned.score).toBe(94);
    expect(retuned.band).toBe('review');
  });

  it('no geo gate caps at 94', () => {
    const p = fixture('P09');
    const r = score(pairOf(p));
    expect(rawSum(r)).toBe(95); // the cap binds: without R6 this pair would merge
    expect(r.features.distanceM).toBeNull();
    expect(geoGate(p.a, p.b, r.features.distanceM)).toBe(false);
    expect(r.score).toBe(94);
    expect(r.band).toBe('review');
  });

  it('never merges across 25 km', () => {
    const p = fixture('P06');
    const r = score(pairOf(p));
    expect(r.band).toBe('distinct');
    expect(r.score).toBe(0);
    expect(r.features.rule).toBe('over_25km');

    // The same two towns with every other feature at its maximum: same phone, same full
    // address, same cluster, identical name. Still distinct.
    const maxed: CandidatePair = {
      a: {
        ...p.a,
        phoneE164: '+19565550199',
        phoneBlockable: true,
        streetNum: '1',
        streetNorm: 'synthetic st',
        postal: '78520',
      },
      b: {
        ...p.b,
        phoneE164: '+19565550199',
        phoneBlockable: true,
        streetNum: '1',
        streetNorm: 'synthetic st',
        postal: '78520',
      },
      nameSim: 1,
    };
    const rm = score(maxed);
    expect(rm.band).toBe('distinct');
    expect(rm.score).toBe(0);
  });

  it('phone locality — sim >= 0.60 reaches 95', () => {
    const phone = '+19565550123';
    const r = score({
      a: side({ phoneE164: phone, phoneBlockable: true, streetNorm: 'synthetic n st' }),
      b: side({
        phoneE164: phone,
        phoneBlockable: true,
        streetNorm: 'synthetic s st',
        lat: 26.2018,
      }),
      nameSim: 0.65,
    });
    // name 19 + phone 30 + address 15 + distance 10 + cluster 5 = 79; R3 lifts it to 95.
    expect(rawSum(r)).toBe(79);
    expect(r.signals).toEqual(['phone']);
    expect(r.features.rule).toBe('phone_locality_name');
    expect(r.score).toBe(95);
    expect(r.band).toBe('merge');
  });

  it('phone lift needs name sim 0.30', () => {
    // 03-20 desk run (danlo, 2026-09-23): 7,099 phone pairs were lifted to exactly 80, and
    // 6,247 of them had name sim < 0.3 — two listings sharing one number. Below the floor a
    // shared phone + ZIP is NOT lifted: the pair keeps its raw score. P07's records, raw 29.
    expect(PHONE_LIFT_MIN_NAME_SIM).toBe(0.3);
    const below = score({ ...pairOf(fixture('P07')), nameSim: 0.29 });
    expect(rawSum(below)).toBe(29);
    expect(below.signals).toEqual(['phone']);
    expect(below.features.rule).toBeUndefined();
    expect(below.score).toBe(29);
    expect(below.band).toBe('ignore');

    const at = score({ ...pairOf(fixture('P07')), nameSim: 0.3 });
    expect(rawSum(at)).toBe(29);
    expect(at.features.rule).toBe('phone_locality_review');
    expect(at.score).toBe(80);
    expect(at.band).toBe('review');
  });

  it('phone locality — sim < 0.60 is clamped to the review band', () => {
    // Lower edge: P07's records at the lift floor (sim 0.30), raw 29, lifted to 80.
    const r7 = score({ ...pairOf(fixture('P07')), nameSim: 0.3 });
    expect(rawSum(r7)).toBe(29);
    expect(r7.features.rule).toBe('phone_locality_review');
    expect(r7.score).toBe(80);
    expect(r7.band).toBe('review');

    // Upper edge: every other feature maxed, raw 95, held at 94. Three signals and the geo
    // gate are satisfied, so R4 alone holds it.
    const phone = '+19565550124';
    const rUp = score({
      a: side({ phoneE164: phone, phoneBlockable: true }),
      b: side({ phoneE164: phone, phoneBlockable: true, lat: 26.2002 }),
      nameSim: 0.599,
    });
    expect(rawSum(rUp)).toBe(95);
    expect(rUp.signals).toEqual(['phone', 'address', 'distance']);
    expect(rUp.features.rule).toBe('phone_locality_review');
    expect(rUp.score).toBe(94);
    expect(rUp.band).toBe('review');
  });

  it('chain flag never merges', () => {
    const p04 = fixture('P04');
    expect(score(pairOf(p04)).score).toBe(84);

    // P04 at 84 cannot prove the cap. The same records with an identical name sum to 95,
    // two signals and the geo gate are satisfied, and the chain flag alone holds it at 94.
    const r = score({ ...pairOf(p04), nameSim: 1 });
    expect(rawSum(r)).toBe(95);
    expect(r.signals).toEqual(['name', 'address', 'distance']);
    expect(r.score).toBe(94);
    expect(r.band).toBe('review');
  });

  it('chain cap survives the phone-locality lift', () => {
    // R2 runs AFTER R3. In the plan's numeric order R3's max(s, 95) would undo the chain cap
    // and auto-merge a chain (D-11). This pair reaches R3, and must still land at 94.
    const phone = '+19565550177';
    const chain = 'synthetic valley tire';
    const r = score({
      a: side({
        phoneE164: phone,
        phoneBlockable: true,
        chainKey: chain,
        streetNorm: 'synthetic n st',
      }),
      b: side({
        phoneE164: phone,
        phoneBlockable: true,
        chainKey: chain,
        streetNorm: 'synthetic s st',
        lat: 26.2018,
      }),
      nameSim: 0.72,
    });
    expect(r.features.rule).toBe('phone_locality_name');
    expect(r.score).toBe(94);
    expect(r.band).toBe('review');
  });

  it('toll-free is not an identifier', () => {
    const tollFree = '+18004879643';
    const pair: CandidatePair = {
      a: side({ phoneE164: tollFree, phoneBlockable: false }),
      b: side({ phoneE164: tollFree, phoneBlockable: false, lat: 26.2002 }),
      nameSim: 0.88,
    };
    const r = score(pair);
    expect(r.features.phone).toBe(0);
    expect(r.signals).toEqual(['name', 'address', 'distance']);
    expect(r.features.rule).toBeUndefined();
    expect(r.score).toBe(86);
    expect(r.band).toBe('review');

    // Two-sided: the same equal numbers, marked blockable, are an identifier.
    const blockable = score({
      a: { ...pair.a, phoneBlockable: true },
      b: { ...pair.b, phoneBlockable: true },
      nameSim: pair.nameSim,
    });
    expect(blockable.features.phone).toBe(30);
    expect(blockable.score).toBe(100);
    expect(blockable.band).toBe('merge');
  });

  it('a Census Non_Exact location never satisfies the geo gate', () => {
    const a = side({
      source: 'tx_comptroller',
      locationMatchType: 'census_non_exact',
      lat: 26.2,
      lng: -98.23,
    });
    const b = side({ lat: 26.2001, lng: -98.23 });
    const d = distanceMeters(26.2, -98.23, 26.2001, -98.23);
    expect(Math.round(d)).toBe(11); // well inside the 100 m tier, so only Non_Exact can refuse it
    expect(geoGate(a, b, d)).toBe(false);
    expect(geoGate({ ...a, locationMatchType: 'census_exact' }, b, d)).toBe(true);

    const r = score({ a, b, nameSim: 1 });
    expect(r.features.distance).toBe(0);
    expect(r.signals).not.toContain('distance');
  });

  it('distanceMeters agrees with app.distance_m', () => {
    // 03-01's app.distance_m test coordinates and tolerance; same 6371000.0 m radius.
    // Exact to the metre for this module; 03-01 pins the SQL side at ±100 m of the same values.
    expect(Math.round(distanceMeters(25.9017, -97.4975, 26.3795, -98.8203))).toBe(142330);
    expect(Math.round(distanceMeters(26.2034, -98.23, 26.3017, -98.1633))).toBe(12795);
    expect(distanceMeters(26.2034, -98.23, 26.2034, -98.23)).toBe(0);
  });

  it('the review ceiling is one below the merge threshold', () => {
    expect(AUTO_MERGE_SCORE).toBe(95);
    expect(REVIEW_SCORE).toBe(80);
    expect(REVIEW_CEILING).toBe(94);
  });
});

describe('merge-triple fixture', () => {
  it('synthetic three-way triple merges on every edge', () => {
    expect(TRIPLE.synthetic).toBe(true);
    const byId = new Map(TRIPLE.records.map((r) => [r.id, r]));
    expect(TRIPLE.edges).toHaveLength(3);
    for (const e of TRIPLE.edges) {
      const a = byId.get(e.a);
      const b = byId.get(e.b);
      if (!a || !b) throw new Error(`merge-triple.json edge ${e.a}-${e.b} names a missing record`);
      const r = score({ a, b, nameSim: e.nameSim });
      expect({ edge: `${e.a}-${e.b}`, score: r.score, band: r.band, signals: r.signals }).toEqual({
        edge: `${e.a}-${e.b}`,
        score: e.expect.score,
        band: e.expect.band,
        signals: e.expect.signals,
      });
    }
  });
});
