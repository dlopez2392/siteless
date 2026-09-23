import { RunReportUnavailable } from '@/components/runs/run-report-view';
import { RUN_REPORT_NOT_FOUND } from '@/lib/ui/copy';

/**
 * What `notFound()` on `/runs/[id]` renders (04-UI-SPEC § States → Error → "Run not found").
 *
 * 🔴 ONE ANSWER FOR AN UNKNOWN RUN AND ANOTHER ORG'S RUN (T-4-06): the read is RLS-scoped, so
 * both arrive here with the same words and the page never confirms a row exists elsewhere. The
 * sentence says where every run IS listed, and "Open spend view" is the way out.
 */
export default function RunReportNotFound() {
  return <RunReportUnavailable message={RUN_REPORT_NOT_FOUND} testId="run-report-not-found" />;
}
