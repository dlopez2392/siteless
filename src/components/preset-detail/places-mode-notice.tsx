import { CircleDashed, PowerOff } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  PLACES_MODE_NOTICE_IDS_ONLY_BODY,
  PLACES_MODE_NOTICE_IDS_ONLY_TITLE,
  PLACES_MODE_NOTICE_OFF_BODY,
  PLACES_MODE_NOTICE_OFF_TITLE,
  type PlacesModeName,
} from '@/lib/ui/copy';

/**
 * The Places-mode notice (04-UI-SPEC § Screen 2, D-02): why nothing — or only the free check —
 * on the preset page can run. In `off` mode it is the screen's focal point.
 *
 * 🔴 A SERVER-SAFE MODULE: NO CLIENT-BOUNDARY DIRECTIVE. The page renders it directly, and the
 * mode arrives as a prop the page read from `env.PLACES_MODE` on the server (Rule 33). This
 * file never reads the environment.
 *
 * 🔴 MUTED, NEVER WARNING OR DESTRUCTIVE. The mode is a deliberate configuration, not a
 * threshold and not a failure (§ Color → New Phase 4 elements). And it is `role="note"`, not the
 * primitive's default `role="alert"`: it is on the page from first paint and interrupts nothing.
 *
 * 🔴 THE `id` IS LOAD-BEARING. Every disabled run action points `aria-describedby` at it, so a
 * keyboard or screen-reader user hears WHY the control does nothing (Rule 33).
 */
const MUTED_ALERT = 'border-border bg-muted text-foreground';

export function PlacesModeNotice({ mode, id }: { mode: PlacesModeName; id: string }) {
  if (mode === 'enterprise') return null;
  const off = mode === 'off';
  const Icon = off ? PowerOff : CircleDashed;
  return (
    <Alert
      id={id}
      role="note"
      data-testid="places-mode-notice"
      data-mode={mode}
      className={`${MUTED_ALERT} gap-1 px-4 py-4`}
    >
      <Icon data-icon={off ? 'power-off' : 'circle-dashed'} aria-hidden="true" className="size-5" />
      <AlertTitle className="text-base font-semibold">
        {off ? PLACES_MODE_NOTICE_OFF_TITLE : PLACES_MODE_NOTICE_IDS_ONLY_TITLE}
      </AlertTitle>
      <AlertDescription className="max-w-[72ch] text-base font-normal text-foreground">
        {off ? PLACES_MODE_NOTICE_OFF_BODY : PLACES_MODE_NOTICE_IDS_ONLY_BODY}
      </AlertDescription>
    </Alert>
  );
}
