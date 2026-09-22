import 'server-only';
import { sql } from 'drizzle-orm';
import { withOrg, type OrgClaims } from '@/db/with-org';
import type { EstimateRange } from '@/lib/estimate/estimate';
import { localDate } from '@/lib/time';
import { periodWindow, rowsOf, type Tx } from './budget';
import {
  fromStoredEstimate,
  readReferenceIndex,
  type GeoPayload,
  type ReferenceIndex,
} from './presets';

/**
 * The five lines UI-SPEC § Screen Inventory 1 puts on a preset card, and the count line
 * above the grid — in ONE statement.
 *
 * ── WHY THIS FILE EXISTS AT ALL ────────────────────────────────────────────────────────
 *
 * Plan 02-09's `listPresets` returns a preset's id, name, status, current version number,
 * version count and `updated_at`. The card needs three things it does not carry: the
 * CLUSTER NAMES, the GEOGRAPHY, and the LAST RUN. `getPreset(claims, id)` carries the first
 * two but not the third, is one round trip PER PRESET, and opens its own `withOrg` — and
 * `src/db/client.ts` pools with `max: 1`, so a `Promise.all` over it does not merely
 * serialize, it waits on a connection an outer transaction is holding (02-09's deviation 7).
 *
 * So the read is a new module rather than an edit to `./presets.ts`: plans 02-12 and 02-13
 * are executing against that same file in sibling worktrees while this one runs, and a new
 * file cannot conflict with them.
 *
 * 🔴 `last_run_at` AND `runs_this_month` COME FROM `runs`, WHICH PHASE 4 FILLS. Today every
 * preset reads "Never run" and the count line reads "none run this month" — because there
 * are genuinely no runs, not because the field is stubbed. The join is live; when Phase 4
 * queues its first run the card moves without a line changing here.
 */

export type PresetCard = {
  id: string;
  displayName: string;
  /** Cluster display names, in the version's own order — "Home services & trades", never
   *  `home_services`. CONVENTIONS § Naming: a key is never shown to a person. */
  clusterNames: string[];
  /** The geography as one readable phrase: "County · Hidalgo", "Cities · McAllen, Edinburg",
   *  "Radius · 10 miles around 4900 N 10th St, McAllen". */
  geographyLabel: string;
  version: number | null;
  lastRunAt: Date | null;
  /** The high end of the saved estimate, in micro-USD. `null` when the version was saved
   *  without one — never a zero, because `$0.00` is a real and very different answer. */
  estimateMicroUsdHi: number | null;
};

export type PresetCards = {
  cards: PresetCard[];
  /** How many presets have a run inside the CURRENT budget period (America/Chicago). */
  runThisMonth: number;
};

type CardRow = {
  id: string;
  display_name: string;
  version: number | null;
  cluster_ids: string[] | null;
  geo_kind: string | null;
  geo_payload: GeoPayload | null;
  estimate_snapshot: unknown;
  last_run_at: Date | null;
  runs_this_month: number;
};

/**
 * The geography phrase. Reads the reference index rather than the payload's own strings, so
 * a county renders the name the seed holds and not whatever a client once sent.
 *
 * A radius is the one exception: `matchedAddress` is what the CENSUS GEOCODER returned and
 * is the only honest thing to show — a bad ZIP is silently corrected upstream ('99999' comes
 * back as '78501'), so echoing the typed string would hide the correction.
 */
function geographyLabelOf(
  kind: string | null,
  payload: GeoPayload | null,
  index: ReferenceIndex,
): string {
  if (kind === null || payload === null) return 'No geography saved';

  if (kind === 'cities' && 'cityIds' in payload) {
    const names = payload.cityIds.map((id) => index.cityById.get(id)?.name).filter(Boolean);
    return names.length > 0 ? `Cities · ${names.join(', ')}` : 'Cities · none still available';
  }
  if (kind === 'counties' && 'countyIds' in payload) {
    const names = payload.countyIds.map((id) => index.countyById.get(id)?.name).filter(Boolean);
    // 254 county names is not a card line. The built-in Texas geography says so by name.
    if (names.length === index.countyById.size && names.length > 0) {
      return `County · Texas (${names.length} counties)`;
    }
    return names.length > 0 ? `County · ${names.join(', ')}` : 'County · none still available';
  }
  if (kind === 'radius' && 'radiusMiles' in payload) {
    return `Radius · ${payload.radiusMiles} miles around ${payload.matchedAddress}`;
  }
  return 'No geography saved';
}

export async function readPresetCards(tx: Tx, index: ReferenceIndex): Promise<PresetCards> {
  // The current budget period's window, in America/Chicago — the same month boundary the
  // meter resets on, so "run this month" on this screen and "$12.40 this month" on /spend
  // cannot mean two different windows. `localDate` is the only zone-aware formatter in src/.
  const today = localDate(new Date());
  const { from, to } = periodWindow(`${today.slice(0, 7)}-01`);

  const rows = rowsOf<CardRow>(
    await tx.execute(sql`
      select s.id,
             s.display_name,
             cv.version,
             cv.cluster_ids,
             cv.geo_kind,
             cv.geo_payload,
             cv.estimate_snapshot,
             lr.last_run_at,
             lr.runs_this_month
        from searches s
        left join search_versions cv on cv.id = s.current_version_id
        left join lateral (
          select max(coalesce(r.started_at, r.created_at))            as last_run_at,
                 count(*) filter (
                   where coalesce(r.started_at, r.created_at) >= ${from}
                     and coalesce(r.started_at, r.created_at) <  ${to}
                 )::int                                              as runs_this_month
            from runs r
            join search_versions v on v.id = r.search_version_id
           where v.search_id = s.id
        ) lr on true
       where s.status = 'active'
       order by s.updated_at desc`),
  );

  const cards: PresetCard[] = rows.map((r) => {
    const snapshot: EstimateRange | null = fromStoredEstimate(r.estimate_snapshot);
    return {
      id: r.id,
      displayName: r.display_name,
      clusterNames: (r.cluster_ids ?? [])
        .map((id) => index.clusterById.get(id)?.displayName)
        .filter((name): name is string => typeof name === 'string'),
      geographyLabel: geographyLabelOf(r.geo_kind, r.geo_payload, index),
      version: r.version,
      lastRunAt: r.last_run_at,
      estimateMicroUsdHi: snapshot === null ? null : snapshot.costMicroUsdHi,
    };
  });

  return {
    cards,
    runThisMonth: rows.filter((r) => (r.runs_this_month ?? 0) > 0).length,
  };
}

export async function listPresetCards(claims: OrgClaims): Promise<PresetCards> {
  return withOrg(claims, async (tx) => {
    const index = await readReferenceIndex(tx);
    return readPresetCards(tx, index);
  });
}
