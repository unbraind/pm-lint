import assert from 'node:assert/strict';
import type { RepairPreview } from '../index.ts';

/** Compare every receipt field while allowing only SDK-declared commit clocks to be fresh. */
export function assertRepairReplay(actual: RepairPreview, expected: RepairPreview): void {
  /** Validate native clock evidence before removing its changing value from replay identity. */
  function comparable(receipt: RepairPreview): RepairPreview {
    const copy = structuredClone(receipt);
    for (const record of copy.validation?.records ?? []) for (const pointer of record.commit_time_fields) {
      assert.ok(pointer.startsWith('/'));
      const keys = pointer.slice(1).split('/').map(key => key.replaceAll('~1', '/').replaceAll('~0', '~'));
      let target = record.item as unknown as Record<string, unknown>;
      for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
      const key = keys.at(-1)!;
      assert.equal(typeof target[key], 'string', pointer);
      assert.ok(Number.isFinite(Date.parse(target[key] as string)), pointer);
      target[key] = '<fresh commit time>';
    }
    return copy;
  }
  assert.deepEqual(comparable(actual), comparable(expected));
}
