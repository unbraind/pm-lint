# Complete incremental lint through the SDK

```ts
import {
  filesystemLintSource, lintIncrementalFile,
  lintIncremental, parseIncrementalCheckpoint,
} from '@unbrained/pm-lint';
import type { IncrementalLintSource } from '@unbrained/pm-lint';

const source = filesystemLintSource('.agents/pm');
const first = await lintIncrementalFile(source, 'lint.local.json', true);
const next = await lintIncrementalFile(source, 'lint.local.json');
console.log(next.result.count, next.incremental.evaluated, next.incremental.reused);

// A service supplies native SDK capabilities and a stable workspace identity.
const serviceSource: IncrementalLintSource = source;
const scan = await lintIncremental(serviceSource, {
  checkpoint: parseIncrementalCheckpoint(first.checkpoint),
});
// Persist scan.checkpoint with the service's revision-based compare-and-set.
// On conflict, read the winner and rerun against CURRENT SDK state.
console.log(scan.result.findings);
```

`lintIncremental` performs no native item writes or checkpoint I/O. The caller
owns checkpoint persistence. Read its previous checkpoint inside a lease or
compare-and-set loop, revalidate source revisions before publication and release
ownership last. Never replay an old saved result as an item mutation plan.
`lintIncrementalFile` provides these checks for local storage and uses core's
owned lease and atomic writer. State must be a regular file in an existing
writable directory; peers using directory aliases share the same lock.

The CLI returns the normal complete lint verdict plus an `incremental` receipt:

```json
{"mode":"update","changed_items":1,"evaluated":30003,"reused":49997}
```

This excerpt omits the full receipt's SDK event/page counts and ten `by_rule`
rows. The 10,000-item fixture uses all default rules: three applicable global
checks run for every active item, three title-sensitive local pairs rerun, and
49,997 local pairs are reused. PML004 and PML009 are out of scope in that fixture.

Expected refusals throw `IncrementalRefusal` in the SDK; the CLI renders
`{ok:false, refusal:{code,message,remedy}}` with exit 2. Ordinary findings retain
lint's severity policy and exit 0/1. Resource exhaustion, policy drift and cursor
loss never become a passing partial scan. Whole-corpus SDK certification errors
retain the host diagnostic.

Dependency declarations are public via `RULE_DEPENDENCIES`. Whenever predicate
semantics change, increment `RULE_VERSION`; its digest and the dependency table
bind each checkpoint. Source identity, complete native metadata and status-role
policy are also bound. Saved excerpts are limited to the existing 160-character
finding ceiling and are reused only with identical declared predicate inputs.

The feature works without git. It neither launches git nor writes native item
fields, scope, relationships, claims or journals. `--since`, item filters and
baseline acknowledgments remain available on the ordinary lint command.
