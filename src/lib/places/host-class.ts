/**
 * D-09. The URL is classified and then discarded by the caller — nothing here stores it.
 * Suffix match on a dot boundary: `m.facebook.com` is social, `notfacebook.com` is not.
 *
 * 🔴 NO CLIENT DIRECTIVE, NO SERVER-ONLY IMPORT, NO I/O. A pure function over one string.
 *
 * 🔴 T-4-05: `websiteUri` is Google content. The only thing that leaves this function is one
 * of the six enum values below — never the URL, never the host. A present-but-unparseable
 * value returns `other` without echoing it; it is never `none` (something WAS listed).
 *
 * 🔴 T-4-10: the host must equal a table domain or end with `.` + that domain. A bare
 * `endsWith` would make `notfacebook.com` social, and a prefix check would make
 * `business.site.evil.com` a dead Google site.
 *
 * `*.business.site` and `g.page` sites 404 since 2024-06-10 (PITFALLS 4): a listing that
 * points at one has no working website.
 */

export const HOST_CLASSES = [
  'none',
  'business_site_dead',
  'social',
  'directory',
  'platform_subdomain',
  'other',
] as const;

export type HostClass = (typeof HOST_CLASSES)[number];

const TABLE: ReadonlyArray<readonly [HostClass, readonly string[]]> = [
  ['business_site_dead', ['business.site', 'g.page']],
  ['social', ['facebook.com', 'instagram.com', 'linktr.ee', 'beacons.ai']],
  [
    'directory',
    ['yelp.com', 'yellowpages.com', 'bbb.org', 'nextdoor.com', 'mapquest.com', 'manta.com'],
  ],
  ['platform_subdomain', ['wixsite.com', 'square.site', 'myshopify.com', 'godaddysites.com']],
];

export function hostClass(websiteUri: string | undefined): HostClass {
  if (!websiteUri) return 'none';
  let host: string;
  try {
    host = new URL(websiteUri).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'other'; // present but unparseable: never 'none'
  }
  for (const [cls, domains] of TABLE) {
    if (domains.some((d) => host === d || host.endsWith('.' + d))) return cls;
  }
  return 'other';
}
