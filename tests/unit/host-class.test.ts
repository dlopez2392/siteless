/**
 * D-09. A Places `websiteUri` is classified into one of six host classes and then
 * discarded by the caller — the enum is the only thing that survives (T-4-05).
 *
 * Mutations, one named test each:
 *   - M35: `business.site` removed from the dead list
 *       → 'host class: business.site is a dead Google site'
 *   - the dot-boundary suffix match loosened to a bare `endsWith(d)`
 *       → 'host class: a lookalike host is not the platform it ends with'
 *   - the `catch` returning 'none' instead of 'other'
 *       → 'host class: a present but unparseable value is never none'
 */
import { describe, expect, it } from 'vitest';
import { HOST_CLASSES, hostClass } from '@/lib/places/host-class';

describe('host class', () => {
  it('host class: the six classes, in their fixed order', () => {
    expect(HOST_CLASSES).toEqual([
      'none',
      'business_site_dead',
      'social',
      'directory',
      'platform_subdomain',
      'other',
    ]);
  });

  it('host class: an absent or empty websiteUri is none', () => {
    expect(hostClass(undefined)).toBe('none');
    expect(hostClass('')).toBe('none');
  });

  it('host class: business.site is a dead Google site', () => {
    // *.business.site sites 404 since 2024-06-10 (PITFALLS 4) — a listing pointing at one
    // has no working website.
    expect(hostClass('https://acme.business.site')).toBe('business_site_dead');
    expect(hostClass('https://acme.business.site/')).toBe('business_site_dead');
  });

  it('host class: g.page is a dead Google site', () => {
    expect(hostClass('http://g.page/r/xyz')).toBe('business_site_dead');
  });

  it.each([
    'https://www.facebook.com/acme',
    'https://m.facebook.com/acme',
    'https://instagram.com/acme',
    'https://linktr.ee/acme',
    'https://beacons.ai/acme',
  ])('host class: %s is social', (uri) => {
    expect(hostClass(uri)).toBe('social');
  });

  it.each([
    'https://www.yelp.com/biz/acme',
    'https://yellowpages.com/x',
    'https://www.bbb.org/x',
    'https://nextdoor.com/x',
    'https://www.mapquest.com/x',
    'https://www.manta.com/x',
  ])('host class: %s is a directory', (uri) => {
    expect(hostClass(uri)).toBe('directory');
  });

  it.each([
    'https://acme.wixsite.com/site',
    'https://acme.square.site',
    'https://acme.myshopify.com',
    'https://acme.godaddysites.com',
  ])('host class: %s is a platform subdomain', (uri) => {
    expect(hostClass(uri)).toBe('platform_subdomain');
  });

  it('host class: an own domain is other', () => {
    expect(hostClass('https://acmeplumbing.com')).toBe('other');
  });

  it('host class: a lookalike host is not the platform it ends with', () => {
    // Suffix match on a dot boundary: `notfacebook.com` merely ends with the letters.
    expect(hostClass('https://notfacebook.com')).toBe('other');
    // And the dead-site name as a LEFT label of someone else's domain is not dead.
    expect(hostClass('https://business.site.evil.com')).toBe('other');
  });

  it('host class: a present but unparseable value is never none', () => {
    expect(hostClass('not a url')).toBe('other');
  });

  it('host class: the result is only ever one of the six enum values', () => {
    // T-4-05: no return path echoes the URL or the host.
    const inputs = [
      undefined,
      '',
      'not a url',
      'https://acme.business.site',
      'https://www.facebook.com/acme',
      'https://www.yelp.com/biz/acme',
      'https://acme.wixsite.com/site',
      'https://acmeplumbing.com',
    ];
    for (const input of inputs) {
      expect(HOST_CLASSES).toContain(hostClass(input));
    }
  });
});
