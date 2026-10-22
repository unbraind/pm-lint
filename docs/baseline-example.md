# Acknowledge one finding through the SDK

```ts
import { PmClient } from '@unbrained/pm-cli/sdk';
import { acknowledgeFinding, lintItems, parseBaseline } from 'pm-lint';
import type { Acknowledgment } from 'pm-lint';

const pmRoot = '.agents/pm';
const client = new PmClient({ pmRoot, noExtensions: true });
const baseline = parseBaseline({ version: 1, acknowledgments: [] });
const observed = await lintItems(client, pmRoot, { baseline });
const finding = observed.findings.find(row => row.rule === 'PML002');
if (finding) {
  // Review the item before making this decision. Copy only evidence fields.
  const acknowledgment: Acknowledgment = {
    item_id: finding.item_id,
    rule: finding.rule,
    rule_version: finding.rule_version,
    source_digest: finding.source_digest,
    reason: 'Legacy criteria debt; repair scheduled',
  };
  const updated = acknowledgeFinding(observed.findings, baseline, acknowledgment);
  const checked = await lintItems(client, pmRoot, { baseline: updated });
  console.log({ debt: checked.debt_count, new: checked.new_count, exit: checked.exit_code });
}
```

Persist the returned versioned document in your application's storage. The SDK operation is pure: it validates the supplied observed findings and document but does not reread the tracker or persist anything. The next `lintItems` check revalidates evidence against current source. The CLI acknowledgment command performs a fresh scan before publishing its file. Neither API edits tracker items.

An acknowledgment has exactly five fields. Unknown fields, malformed digests, blank reasons, wildcard identities, duplicate item/rule entries and unsupported schema versions are refused. Use `error instanceof BaselineRefusal` to inspect its typed `code` and `remedy`.
