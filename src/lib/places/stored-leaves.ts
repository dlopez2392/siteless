import 'server-only';
import { sql } from 'drizzle-orm';
import { tileKeyOf, type TileSpec } from '@/lib/places/tiling';
import { rowsOf, type Tx } from '@/server/queries/budget';

/**
 * D-16, change checks: each root is replaced by the leaves already stored under it (the tree the
 * last sweep drew), as `ids_only` specs carrying the root's shape — the shallowest leaf on each
 * path only (B-WR-04). A root with no stored leaf stays itself.
 *
 * Its own module (not steps.ts) so ADMISSION can size a change check's request ceiling from the
 * same list the workflow will execute (B-WR-05, a follow-up in src/server/actions/queue-run.ts):
 * a step module cannot be imported by a server action. Reads `place_tiles` under the caller's
 * transaction and org (RLS); writes nothing.
 */
export async function storedLeaves(tx: Tx, roots: TileSpec[]): Promise<TileSpec[]> {
  const out: TileSpec[] = [];
  for (const root of roots) {
    const rows = rowsOf<{
      quad_path: string;
      depth: number;
      south: number;
      west: number;
      north: number;
      east: number;
    }>(
      await tx.execute(sql`
        select quad_path, depth, south, west, north, east
          from place_tiles
         where org_id = (select app.current_org_id())
           and starts_with(tile_key, ${root.tileKey})
           and is_leaf
         order by quad_path`),
    );
    const shaped = rows.filter((r) => /^r[0-3]*$/.test(r.quad_path));
    // B-WR-04: only the SHALLOWEST leaf on each path. `mark_run_search` sets `is_leaf` on the one
    // tile it closes, so a root that stopped saturating becomes a leaf while its old descendants
    // keep `is_leaf` from the sweep that split it (0030 retires them only when that root next
    // closes). Listing both would search overlapping rectangles and diff stale memberships.
    const paths = new Set(shaped.map((r) => r.quad_path));
    const leaves = shaped.filter((r) => {
      for (let n = 1; n < r.quad_path.length; n += 1) {
        if (paths.has(r.quad_path.slice(0, n))) return false;
      }
      return true;
    });
    if (leaves.length === 0) {
      out.push(root);
      continue;
    }
    for (const leaf of leaves) {
      out.push({
        ...root,
        tileKey: tileKeyOf(root.unitKind, root.unitId, root.placesType, leaf.quad_path),
        quadPath: leaf.quad_path,
        depth: leaf.quad_path.length - 1,
        rect: {
          south: Number(leaf.south),
          west: Number(leaf.west),
          north: Number(leaf.north),
          east: Number(leaf.east),
        },
        parentTileKey:
          leaf.quad_path.length > 1
            ? tileKeyOf(root.unitKind, root.unitId, root.placesType, leaf.quad_path.slice(0, -1))
            : null,
        kind: 'ids_only',
      });
    }
  }
  return out;
}
