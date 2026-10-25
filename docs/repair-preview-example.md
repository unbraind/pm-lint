# Revision-bound repair context

```ts
import { previewAuthoringRepairs, RepairRefusal } from 'pm-lint';

try {
  const first = await previewAuthoringRepairs('.agents/pm', { id: 'pm-example-abcd' });
  console.log(first.patch, first.questions);
  // Refresh validation against exactly the observed native revision, with zero source writes.
  const checked = await previewAuthoringRepairs('.agents/pm', {
    id: first.id,
    revision: first.revision,
  });
  console.log(checked.plan_key, checked.validation, checked.writes);
} catch (error) {
  if (error instanceof RepairRefusal) console.error(error.code, error.remedy);
  else throw error;
}
```

For a title with surrounding spaces and repeated tags, the patch contains the
trimmed title and core-normalized tag list. If an Issue has no `expected_result`,
questions include `missing_expected_behavior`: “What should happen for the
reported reproduction steps?” No expected behavior or acceptance criterion is
supplied by the package.

```sh
pm lint repair --id pm-example-abcd
pm lint repair --id pm-example-abcd --json
pm lint repair --id pm-example-abcd --revision <observed-sha256> --json
```

| Refusal | Recovery |
| --- | --- |
| `invalid_request` | Supply one canonical id and an optional observed revision. |
| `unknown_item` | Select a current id from the certified tracker. |
| `stale_revision` | Discard saved context and request a fresh preview. |
| `limit_exceeded` | Inspect the oversized field directly and author an explicit repair. |
| `unsafe_repair` | Resolve unsafe storage or core validation constraints, then refresh. |

A preview is an observation of a source snapshot. Concurrent writers may edit
after it returns. Apply-time mutation preconditions remain the caller's
responsibility; a plan key is not a lock or an executable transaction id.
