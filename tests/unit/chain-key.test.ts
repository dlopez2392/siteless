/**
 * The chain identity key (src/lib/resolve/chain.ts, B-WR-05 review 03): `name_norm` with the
 * trade words a name was REDUCED BY put back, so three unrelated "<trade> Garcia" businesses are
 * three names, not one chain "garcia".
 *
 * 🔴 THE PARITY HALF. `CHAIN_TRADE_WORDS` restates the normalizer's private `TRADE` set
 * (src/lib/normalize/name.ts does not export it). If the normalizer ever stops stripping one of
 * these words, the chain key would put back a word that was never removed — so each word is
 * pinned here as one `nameNorm` really strips.
 */
import { describe, expect, it } from 'vitest';
import { nameNorm } from '@/lib/normalize';
import { CHAIN_TRADE_WORDS, chainKeyOf } from '@/lib/resolve/chain';

describe('the chain key keeps the trade words (B-WR-05)', () => {
  it('every chain trade word is one the normalizer strips', () => {
    expect(CHAIN_TRADE_WORDS.size).toBeGreaterThan(0);
    for (const w of CHAIN_TRADE_WORDS) {
      // A multi-word remainder: since B-WR-05's name half, nameNorm KEEPS a trade word that
      // would leave a lone surname, so the strip is probed where it still happens.
      expect(nameNorm(`${w} rio grande`), w).toBe('rio grande');
    }
  });

  it('a surname reduced by different trades gives different keys; the same trade, the same key', () => {
    const key = (raw: string) => chainKeyOf(nameNorm(raw)!, raw);
    expect(key('Taqueria Garcia')).toBe('taqueria garcia');
    expect(key('Panadería Garcia')).toBe('panaderia garcia');
    expect(key('CARNICERIA GARCIA')).toBe('carniceria garcia');
    expect(key('Taquería El Rey')).toBe(key('TAQUERIA EL REY'));
    // A name with no trade word keeps its name_norm, and an unknown raw name does too.
    expect(key('Firestone Complete Auto Care')).toBe(nameNorm('Firestone Complete Auto Care'));
    expect(chainKeyOf('garcia', null)).toBe('garcia');
    // A multi-word remainder is where the chain key does the work nameNorm no longer does.
    expect(key('Taqueria Rio Grande')).toBe('taqueria rio grande');
    expect(key('Panadería Rio Grande')).toBe('panaderia rio grande');
  });
});
