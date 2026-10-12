import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TestContext } from 'node:test';

import type { ItemMetadata, PmClient } from '@unbrained/pm-cli/sdk';
import { analyzeDuplicateItems } from '@unbrained/pm-cli/sdk/query';

import { RULES } from '../src/rules.ts';
import type { Rule, RuleContext } from '../src/rules.ts';
import { tracker } from './helpers.ts';

/** Milliseconds in one day, used for staleness arithmetic. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Look up one rule in the exported table by its stable code. */
function ruleFor(code: string): Rule {
  const found = RULES.find(entry => entry.code === code);
  assert.ok(found !== undefined, `${code} exists in RULES`);
  return found;
}

/** Build a lint context over the given corpus with optional overrides. */
function lintContext(items: readonly ItemMetadata[], overrides: Partial<RuleContext> = {}): RuleContext {
  return { items, now: Date.now(), parameters: {}, duplicateIds: new Set<string>(), ...overrides };
}

/** Read the complete certified tracker corpus through the SDK whole-corpus list. */
async function corpus(client: PmClient): Promise<ItemMetadata[]> {
  return (await client.listAllComplete()).items;
}

/** Return a fresh full read of one item from the tracker corpus. */
async function oneItem(client: PmClient, id: string): Promise<ItemMetadata> {
  const found = (await corpus(client)).find(item => item.id === id);
  assert.ok(found !== undefined, `item ${id} present in corpus`);
  return found;
}

/** Find one certified corpus record by its stable id. */
function findById(items: readonly ItemMetadata[], id: string): ItemMetadata {
  const found = items.find(item => item.id === id);
  assert.ok(found !== undefined, `item ${id} present in corpus`);
  return found;
}

/** Pure metadata adjustment: copy one tracker-returned record with overridden fields. */
function adjust(item: ItemMetadata, overrides: Partial<ItemMetadata>): ItemMetadata {
  return { ...item, ...overrides };
}

/** Render epoch milliseconds as the ISO 8601 shape the SDK timestamps use. */
function iso(ms: number): string {
  return new Date(ms).toISOString();
}

describe('rule table', () => {
  it('exports ten ordered rules with the requested severities, fields and one-line hints', () => {
    assert.equal(RULES.length, 10);
    assert.deepEqual(
      RULES.map(entry => entry.code),
      ['PML001', 'PML002', 'PML003', 'PML004', 'PML005', 'PML006', 'PML007', 'PML008', 'PML009', 'PML010'],
    );
    assert.deepEqual(
      RULES.map(entry => entry.severity),
      ['warn', 'error', 'warn', 'error', 'warn', 'info', 'warn', 'info', 'error', 'warn'],
    );
    assert.deepEqual(
      RULES.map(entry => entry.field),
      [
        'title',
        'acceptance_criteria',
        'acceptance_criteria',
        'resolution',
        'updated_at',
        'files',
        'parent',
        'description',
        'blocked_reason',
        'title',
      ],
    );
    for (const entry of RULES) {
      assert.ok(entry.field.length > 0, `${entry.code} names a field`);
      assert.ok(entry.hint.length > 0, `${entry.code} carries a hint`);
      assert.ok(!entry.hint.includes('\n'), `${entry.code} hint stays on one line`);
      assert.equal(typeof entry.check, 'function', `${entry.code} provides a predicate`);
    }
  });
});

describe('PML001 vague placeholder titles', () => {
  it('flags todo, wip, untitled, fix stuff, short and ticket-only titles', async (t: TestContext) => {
    const { client } = await tracker(t);
    const todo = await client.create({ title: 'TODO', type: 'Task' });
    const wip = await client.create({ title: 'wip work', type: 'Task' });
    const untitled = await client.create({ title: 'Untitled item', type: 'Task' });
    const fixStuff = await client.create({ title: 'fix stuff', type: 'Task' });
    const short = await client.create({ title: 'Two words', type: 'Task' });
    const ticketOnly = await client.create({ title: '#1234', type: 'Task' });
    const repoTicket = await client.create({ title: 'repo/owner#123', type: 'Task' });
    const concrete = await client.create({ title: 'Do the thing', type: 'Task' });
    const scoped = await client.create({ title: 'Ship the login retry flow', type: 'Task' });
    const items = await corpus(client);
    const check = ruleFor('PML001').check;
    const context = lintContext(items);
    assert.equal(check(findById(items, todo.item.id), context), true);
    assert.equal(check(findById(items, wip.item.id), context), true);
    assert.equal(check(findById(items, untitled.item.id), context), true);
    assert.equal(check(findById(items, fixStuff.item.id), context), true);
    assert.equal(check(findById(items, short.item.id), context), true);
    assert.equal(check(findById(items, ticketOnly.item.id), context), true);
    assert.equal(check(findById(items, repoTicket.item.id), context), true);
    assert.equal(check(findById(items, concrete.item.id), context), false);
    assert.equal(check(findById(items, scoped.item.id), context), false);
  });
});

describe('PML002 missing acceptance criteria', () => {
  it('flags open and in-progress work types without criteria and ignores other statuses and types', async (t: TestContext) => {
    const { client } = await tracker(t);
    const specified = await client.create({ title: 'Specified feature work', type: 'Feature', acceptanceCriteria: 'returns the parsed value' });
    const bareFeature = await client.create({ title: 'Bare feature work', type: 'Feature' });
    const bareIssue = await client.create({ title: 'Bare issue work', type: 'Issue' });
    const bareTask = await client.create({ title: 'Bare task work', type: 'Task' });
    const startedFeature = await client.create({ title: 'Started bare feature work', type: 'Feature', status: 'in_progress' });
    const startedTask = await client.create({ title: 'Started bare task work', type: 'Task', status: 'in_progress' });
    const blockedTask = await client.create({ title: 'Blocked bare task work', type: 'Task', status: 'blocked', blockedReason: 'waiting on approval' });
    const draftTask = await client.create({ title: 'Draft bare task work', type: 'Task', status: 'draft' });
    const closedTask = await client.create({ title: 'Closed bare task work', type: 'Task' });
    await client.close(closedTask.item.id, 'shipped with recorded evidence');
    const canceledTask = await client.create({ title: 'Canceled bare task work', type: 'Task' });
    await client.update(canceledTask.item.id, { status: 'canceled' });
    const bareEpic = await client.create({ title: 'Bare epic workstream', type: 'Epic' });
    const blankCriteria = await client.create({ title: 'Whitespace criteria work', type: 'Task', acceptanceCriteria: '   ' });
    const items = await corpus(client);
    const check = ruleFor('PML002').check;
    const context = lintContext(items);
    assert.equal(check(findById(items, specified.item.id), context), false);
    assert.equal(check(findById(items, bareFeature.item.id), context), true);
    assert.equal(check(findById(items, bareIssue.item.id), context), true);
    assert.equal(check(findById(items, bareTask.item.id), context), true);
    assert.equal(check(findById(items, startedFeature.item.id), context), true);
    assert.equal(check(findById(items, startedTask.item.id), context), true);
    assert.equal(check(findById(items, blockedTask.item.id), context), false);
    assert.equal(check(findById(items, draftTask.item.id), context), false);
    assert.equal(check(findById(items, closedTask.item.id), context), false);
    assert.equal(check(findById(items, canceledTask.item.id), context), false);
    assert.equal(check(findById(items, bareEpic.item.id), context), false);
    assert.equal(check(findById(items, blankCriteria.item.id), context), true);
    assert.equal(
      check(adjust(findById(items, blankCriteria.item.id), { acceptance_criteria: '' }), context),
      true,
    );
  });
});

describe('PML003 unverifiable acceptance criteria', () => {
  it('validates every semicolon and newline criterion independently', async (t: TestContext) => {
    const { client } = await tracker(t);
    const withoutCriteria = await client.create({ title: 'Criteria-less work item', type: 'Task' });
    const delimiterOnly = await client.create({ title: 'Delimiter-only criteria work', type: 'Task', acceptanceCriteria: ';;;' });
    const observable = await client.create({ title: 'Observable criteria work', type: 'Task', acceptanceCriteria: 'returns the parsed value; outputs the sorted list' });
    const mixedBad = await client.create({ title: 'Mixed criteria work', type: 'Task', acceptanceCriteria: 'returns the value; done' });
    const newlineBad = await client.create({ title: 'Newline criteria work', type: 'Task', acceptanceCriteria: 'returns the value\nit works' });
    const noVerb = await client.create({ title: 'Verbless criteria work', type: 'Task', acceptanceCriteria: 'make it nicer' });
    const identical = await client.create({ title: 'Fix the login flow', type: 'Task', acceptanceCriteria: 'fix the LOGIN flow!' });
    const condition = await client.create({ title: 'Conditional criteria work', type: 'Task', acceptanceCriteria: 'fails when the input is empty' });
    const unlessClause = await client.create({ title: 'Unless criteria work', type: 'Task', acceptanceCriteria: 'rejects bad input unless the fix lands' });
    const numeric = await client.create({ title: 'Numeric criteria work', type: 'Task', acceptanceCriteria: 'completes 12 tests' });
    const comparison = await client.create({ title: 'Comparison criteria work', type: 'Task', acceptanceCriteria: 'runtime count < limit' });
    const explicitWords = await client.create({ title: 'Explicit criteria work', type: 'Task', acceptanceCriteria: 'zero failures remain; given a valid token it accepts the request; no errors are emitted' });
    const passExit = await client.create({ title: 'Lifecycle criteria work', type: 'Task', acceptanceCriteria: 'the suite passes; the process exits with code zero' });
    const items = await corpus(client);
    const check = ruleFor('PML003').check;
    const context = lintContext(items);
    assert.equal(check(findById(items, withoutCriteria.item.id), context), false);
    assert.equal(check(findById(items, delimiterOnly.item.id), context), true);
    assert.equal(check(findById(items, observable.item.id), context), false);
    assert.equal(check(findById(items, mixedBad.item.id), context), true);
    assert.equal(check(findById(items, newlineBad.item.id), context), true);
    assert.equal(check(findById(items, noVerb.item.id), context), true);
    assert.equal(check(findById(items, identical.item.id), context), true);
    assert.equal(check(findById(items, condition.item.id), context), false);
    assert.equal(check(findById(items, unlessClause.item.id), context), false);
    assert.equal(check(findById(items, numeric.item.id), context), false);
    assert.equal(check(findById(items, comparison.item.id), context), false);
    assert.equal(check(findById(items, explicitWords.item.id), context), false);
    assert.equal(check(findById(items, passExit.item.id), context), false);
  });
});

describe('PML004 closed without evidence', () => {
  it('ignores open items and accepts each evidence field beyond the title', async (t: TestContext) => {
    const { client } = await tracker(t);
    const openItem = await client.create({ title: 'Still open closure work', type: 'Task' });
    const resolved = await client.create({ title: 'Resolved closure work', type: 'Task' });
    await client.close(resolved.item.id, 'done', { resolution: 'fix shipped in commit abc' });
    const actual = await client.create({ title: 'Actual result closure work', type: 'Task' });
    await client.close(actual.item.id, 'done', { actualResult: 'all 12 tests green' });
    const reasoned = await client.create({ title: 'Close reason closure work', type: 'Task' });
    await client.close(reasoned.item.id, 'done and recorded with detail');
    const titleEcho = await client.create({ title: 'Repeat the release exactly', type: 'Task' });
    await client.close(titleEcho.item.id, 'Repeat the release exactly');
    const openMeta = await oneItem(client, openItem.item.id);
    const resolvedMeta = await oneItem(client, resolved.item.id);
    const actualMeta = await oneItem(client, actual.item.id);
    const reasonedMeta = await oneItem(client, reasoned.item.id);
    const titleEchoMeta = await oneItem(client, titleEcho.item.id);
    const check = ruleFor('PML004').check;
    assert.equal(check(openMeta, lintContext([openMeta])), false);
    assert.equal(check(resolvedMeta, lintContext([resolvedMeta])), false);
    assert.equal(check(actualMeta, lintContext([actualMeta])), false);
    assert.equal(check(reasonedMeta, lintContext([reasonedMeta])), false);
    assert.equal(check(titleEchoMeta, lintContext([titleEchoMeta])), true);
    assert.equal(
      check(adjust(titleEchoMeta, { resolution: '', close_reason: '' }), lintContext([titleEchoMeta])),
      true,
    );
  });

  it('rejects planning comments, accepts close-time and labeled comments and guards missing closed_at', async (t: TestContext) => {
    const { client } = await tracker(t);
    const planned = await client.create({ title: 'Planning closure evidence work', type: 'Task' });
    await client.comments(planned.item.id, { add: 'plan recorded early' });
    await client.close(planned.item.id, 'Planning closure evidence work');
    const labeled = await client.create({ title: 'Labeled closure evidence work', type: 'Task' });
    await client.comments(labeled.item.id, { add: 'Resolution: fix verified with a green suite' });
    await client.close(labeled.item.id, 'Labeled closure evidence work');
    const labeledClose = await client.create({ title: 'Close labeled evidence work', type: 'Task' });
    await client.comments(labeledClose.item.id, { add: 'Close: shipped with the evidence log' });
    await client.close(labeledClose.item.id, 'Close labeled evidence work');
    const check = ruleFor('PML004').check;
    const plannedMeta = await oneItem(client, planned.item.id);
    const labeledMeta = await oneItem(client, labeled.item.id);
    const labeledCloseMeta = await oneItem(client, labeledClose.item.id);
    assert.equal(check(adjust(plannedMeta, { close_reason: '' }), lintContext([plannedMeta])), true);
    assert.equal(check(adjust(labeledMeta, { close_reason: '' }), lintContext([labeledMeta])), false);
    assert.equal(check(adjust(labeledCloseMeta, { close_reason: '' }), lintContext([labeledCloseMeta])), false);
    await client.comments(planned.item.id, { add: 'closure evidence recorded after close' });
    const withPostClose = await oneItem(client, planned.item.id);
    assert.equal(check(adjust(withPostClose, { close_reason: '' }), lintContext([withPostClose])), false);
    const strippedClosedAt = adjust(withPostClose, { close_reason: '', closed_at: undefined });
    assert.equal(check(strippedClosedAt, lintContext([strippedClosedAt])), true);
    const brokenTimestamps = adjust(withPostClose, {
      close_reason: '',
      comments: (withPostClose.comments ?? []).map(comment => ({ ...comment, created_at: 'not-a-timestamp' })),
    });
    assert.equal(check(brokenTimestamps, lintContext([brokenTimestamps])), true);
  });
});

describe('PML005 stale in-progress work and claims', () => {
  it('flags stale in-progress items at the exact day boundary and honors the staleDays parameter', async (t: TestContext) => {
    const { client } = await tracker(t);
    const freshOpen = await client.create({ title: 'Fresh unowned work item', type: 'Task' });
    const started = await client.create({ title: 'Started unowned work item', type: 'Task', status: 'in_progress' });
    const check = ruleFor('PML005').check;
    const freshMeta = await oneItem(client, freshOpen.item.id);
    const startedMeta = await oneItem(client, started.item.id);
    const base = Date.now();
    assert.equal(check(freshMeta, lintContext([freshMeta], { now: base })), false);
    assert.equal(
      check(adjust(startedMeta, { updated_at: iso(base - 14 * MS_PER_DAY) }), lintContext([startedMeta], { now: base })),
      false,
    );
    assert.equal(
      check(adjust(startedMeta, { updated_at: iso(base - 14 * MS_PER_DAY - 1) }), lintContext([startedMeta], { now: base })),
      true,
    );
    const stale = adjust(startedMeta, { updated_at: iso(base - 20 * MS_PER_DAY) });
    assert.equal(check(stale, lintContext([stale], { now: base, parameters: {} })), true);
    assert.equal(check(stale, lintContext([stale], { now: base, parameters: { staleDays: 30 } })), false);
    assert.equal(check(stale, lintContext([stale], { now: base, parameters: { staleDays: 7 } })), true);
  });

  it('flags stale claims regardless of status and ignores terminal ownership', async (t: TestContext) => {
    const { client } = await tracker(t);
    const claimed = await client.create({ title: 'Claimed work item', type: 'Task' });
    await client.claim(claimed.item.id);
    const terminal = await client.create({ title: 'Terminal claimed work item', type: 'Task' });
    await client.claim(terminal.item.id, { start: true });
    await client.close(terminal.item.id, 'shipped with recorded evidence');
    const canceled = await client.create({ title: 'Canceled claimed work item', type: 'Task' });
    await client.update(canceled.item.id, { status: 'canceled' });
    const freshOpen = await client.create({ title: 'Fresh unclaimed work item', type: 'Task' });
    const check = ruleFor('PML005').check;
    const claimedMeta = await oneItem(client, claimed.item.id);
    const terminalMeta = await oneItem(client, terminal.item.id);
    const canceledMeta = await oneItem(client, canceled.item.id);
    const freshMeta = await oneItem(client, freshOpen.item.id);
    const base = Date.now();
    assert.equal(check(claimedMeta, lintContext([claimedMeta], { now: base })), false);
    assert.equal(
      check(adjust(claimedMeta, { updated_at: iso(base - 20 * MS_PER_DAY) }), lintContext([claimedMeta], { now: base })),
      true,
    );
    assert.equal(
      check(adjust(terminalMeta, { updated_at: iso(base - 20 * MS_PER_DAY) }), lintContext([terminalMeta], { now: base })),
      false,
    );
    assert.equal(
      check(adjust(canceledMeta, { updated_at: iso(base - 20 * MS_PER_DAY) }), lintContext([canceledMeta], { now: base })),
      false,
    );
    assert.equal(
      check(adjust(freshMeta, { claim_principal: 'lint-test' }), lintContext([freshMeta], { now: base })),
      false,
    );
    assert.equal(
      check(adjust(adjust(freshMeta, { claim_principal: 'lint-test' }), { updated_at: iso(base - 20 * MS_PER_DAY) }), lintContext([freshMeta], { now: base })),
      true,
    );
  });

  it('counts recent comments, notes and test runs as activity and skips broken timestamps', async (t: TestContext) => {
    const { client } = await tracker(t);
    const commented = await client.create({ title: 'Commented activity work item', type: 'Task' });
    await client.claim(commented.item.id, { start: true });
    await client.comments(commented.item.id, { add: 'progress recorded today' });
    const noted = await client.create({ title: 'Noted activity work item', type: 'Task' });
    await client.claim(noted.item.id, { start: true });
    await client.notes(noted.item.id, { add: 'note recorded today' });
    const ran = await client.create({ title: 'Tested activity work item', type: 'Task' });
    await client.claim(ran.item.id, { start: true });
    const check = ruleFor('PML005').check;
    const commentedMeta = await oneItem(client, commented.item.id);
    const notedMeta = await oneItem(client, noted.item.id);
    const ranMeta = await oneItem(client, ran.item.id);
    const base = Date.now();
    const withRun = adjust(ranMeta, {
      test_runs: [
        {
          run_id: 'run-1',
          kind: 'test',
          status: 'passed',
          started_at: iso(base - 2000),
          finished_at: iso(base - 1000),
          recorded_at: iso(base - 1000),
          passed: 12,
          failed: 0,
          skipped: 0,
        },
      ],
    });
    assert.equal(
      check(adjust(commentedMeta, { updated_at: iso(base - 30 * MS_PER_DAY) }), lintContext([commentedMeta], { now: base })),
      false,
    );
    assert.equal(
      check(adjust(notedMeta, { updated_at: iso(base - 30 * MS_PER_DAY) }), lintContext([notedMeta], { now: base })),
      false,
    );
    assert.equal(
      check(adjust(withRun, { updated_at: iso(base - 30 * MS_PER_DAY) }), lintContext([withRun], { now: base })),
      false,
    );
    const emptyArrays = adjust(commentedMeta, {
      updated_at: iso(base - 20 * MS_PER_DAY),
      comments: [],
      notes: [],
      test_runs: [],
    });
    assert.equal(check(emptyArrays, lintContext([emptyArrays], { now: base })), true);
    const noValidTime = adjust(emptyArrays, { updated_at: 'not-a-timestamp' });
    assert.equal(check(noValidTime, lintContext([noValidTime], { now: base })), false);
    const staleCommentOnly = adjust(adjust(commentedMeta, {
      updated_at: 'not-a-timestamp',
      comments: (commentedMeta.comments ?? []).map(comment => ({ ...comment, created_at: iso(base - 20 * MS_PER_DAY) })),
    }), { notes: [] });
    assert.equal(check(staleCommentOnly, lintContext([staleCommentOnly], { now: base })), true);
    const brokenCommentTime = adjust(adjust(commentedMeta, {
      updated_at: 'not-a-timestamp',
      comments: (commentedMeta.comments ?? []).map(comment => ({ ...comment, created_at: 'not-a-timestamp' })),
    }), { notes: [] });
    assert.equal(check(brokenCommentTime, lintContext([brokenCommentTime], { now: base })), false);
  });
});

describe('PML006 feature without linked files or tests', () => {
  it('flags Features in any status without links and ignores other types', async (t: TestContext) => {
    const { client } = await tracker(t);
    const bareFeature = await client.create({ title: 'Bare feature work item', type: 'Feature' });
    const fileFeature = await client.create({ title: 'File linked feature work', type: 'Feature', file: ['src/login.ts'] });
    const testFeature = await client.create({ title: 'Test linked feature work', type: 'Feature', test: ['command=node --test test/login.test.ts'] });
    const closedFeature = await client.create({ title: 'Closed bare feature work', type: 'Feature' });
    await client.close(closedFeature.item.id, 'shipped with recorded evidence');
    const blockedFeature = await client.create({ title: 'Blocked bare feature work', type: 'Feature', status: 'blocked', blockedReason: 'waiting on approval' });
    const bareTask = await client.create({ title: 'Bare task work item', type: 'Task' });
    const items = await corpus(client);
    const check = ruleFor('PML006').check;
    const context = lintContext(items);
    const bareMeta = findById(items, bareFeature.item.id);
    assert.equal(check(bareMeta, context), true);
    assert.equal(check(findById(items, fileFeature.item.id), context), false);
    assert.equal(check(findById(items, testFeature.item.id), context), false);
    assert.equal(check(findById(items, closedFeature.item.id), context), true);
    assert.equal(check(findById(items, blockedFeature.item.id), context), true);
    assert.equal(check(findById(items, bareTask.item.id), context), false);
    assert.equal(check(adjust(bareMeta, { files: [], tests: [] }), context), true);
    assert.equal(check(adjust(bareMeta, { files: undefined, tests: undefined }), context), true);
  });
});

describe('PML007 epic without children', () => {
  it('counts scalar children, both hierarchy alias directions and closed children across the corpus', async (t: TestContext) => {
    const { client } = await tracker(t);
    const bareEpic = await client.create({ title: 'Bare epic workstream', type: 'Epic' });
    const populatedEpic = await client.create({ title: 'Populated epic workstream', type: 'Epic' });
    await client.create({ title: 'Scalar child work item', type: 'Task', parent: populatedEpic.item.id });
    const closedChildEpic = await client.create({ title: 'Closed child epic workstream', type: 'Epic' });
    const closedChild = await client.create({ title: 'Closed child work item', type: 'Task', parent: closedChildEpic.item.id });
    await client.close(closedChild.item.id, 'shipped with recorded evidence');
    const depParentEpic = await client.create({ title: 'Dep parent epic workstream', type: 'Epic' });
    await client.create({ title: 'Parent dep child work item', type: 'Task', dep: [`id=${depParentEpic.item.id},kind=parent`] });
    const aliasEpic = await client.create({ title: 'Epic alias epic workstream', type: 'Epic' });
    await client.create({ title: 'Epic alias child work item', type: 'Task', dep: [`id=${aliasEpic.item.id},kind=epic`] });
    const declaredEpic = await client.create({ title: 'Declared child epic workstream', type: 'Epic' });
    const declaredChild = await client.create({ title: 'Declared child work item', type: 'Task' });
    await client.update(declaredEpic.item.id, { dep: [`id=${declaredChild.item.id},kind=child`] });
    const taskAliasEpic = await client.create({ title: 'Task alias epic workstream', type: 'Epic' });
    const taskAliasChild = await client.create({ title: 'Task alias child work item', type: 'Task' });
    await client.update(taskAliasEpic.item.id, { dep: [`id=${taskAliasChild.item.id},kind=task`] });
    const danglingEpic = await client.create({
      title: 'Dangling child epic workstream',
      type: 'Epic',
      dep: ['id=missing-9999,kind=child'],
      allowUnresolvedDeps: true,
    });
    const relatedEpic = await client.create({ title: 'Related link epic workstream', type: 'Epic', dep: [`id=${declaredChild.item.id},kind=related`] });
    const parentTaskEpic = await client.create({ title: 'Parent task epic workstream', type: 'Epic' });
    await client.create({ title: 'Parent task work item', type: 'Task', dep: [`id=${parentTaskEpic.item.id},kind=child`] });
    const parentDepEpic = await client.create({ title: 'Parent dep epic workstream', type: 'Epic' });
    await client.create({ title: 'Holding epic workstream', type: 'Epic', dep: [`id=${parentDepEpic.item.id},kind=parent`] });
    const childEpicHolder = await client.create({ title: 'Child epic holder workstream', type: 'Epic' });
    await client.create({ title: 'Nested epic child workstream', type: 'Epic', parent: childEpicHolder.item.id });
    const plainTask = await client.create({ title: 'Plain task work item', type: 'Task' });
    await client.create({ title: 'Task of a task work item', type: 'Task', parent: plainTask.item.id });
    const items = await corpus(client);
    const check = ruleFor('PML007').check;
    const context = lintContext(items);
    assert.equal(check(findById(items, bareEpic.item.id), context), true);
    assert.equal(check(findById(items, populatedEpic.item.id), context), false);
    assert.equal(check(findById(items, closedChildEpic.item.id), context), false);
    assert.equal(check(findById(items, depParentEpic.item.id), context), false);
    assert.equal(check(findById(items, aliasEpic.item.id), context), false);
    assert.equal(check(findById(items, declaredEpic.item.id), context), false);
    assert.equal(check(findById(items, taskAliasEpic.item.id), context), false);
    assert.equal(check(findById(items, danglingEpic.item.id), context), true);
    assert.equal(check(findById(items, relatedEpic.item.id), context), true);
    assert.equal(check(findById(items, parentTaskEpic.item.id), context), true);
    assert.equal(check(findById(items, parentDepEpic.item.id), context), false);
    assert.equal(check(findById(items, childEpicHolder.item.id), context), false);
    assert.equal(check(findById(items, plainTask.item.id), context), false);
    const danglingMeta = findById(items, danglingEpic.item.id);
    const realDep = (danglingMeta.dependencies ?? [])[0];
    assert.ok(realDep !== undefined, 'dangling epic retains its dependency entry');
    const selfChild = adjust(danglingMeta, { dependencies: [{ ...realDep, id: danglingEpic.item.id }] });
    assert.equal(check(selfChild, context), true);
  });
});

describe('PML008 context restating the title', () => {
  it('flags descriptions and notes that only repeat the title after normalization', async (t: TestContext) => {
    const { client } = await tracker(t);
    const echo = await client.create({ title: 'Fix login', type: 'Task', description: 'fix   LOGIN!' });
    const punctuated = await client.create({ title: 'Clean-up the, reports!', type: 'Task', description: 'clean up the reports' });
    const distinct = await client.create({ title: 'Ship chart', type: 'Task', description: 'Adds the chart with a test' });
    const bare = await client.create({ title: 'Bare restating work item', type: 'Task' });
    const noteEcho = await client.create({ title: 'Fix logout', type: 'Task' });
    await client.notes(noteEcho.item.id, { add: 'fix   LOGOUT!' });
    const noteDifferent = await client.create({ title: 'Fix search', type: 'Task' });
    await client.notes(noteDifferent.item.id, { add: 'search behaves differently now' });
    const items = await corpus(client);
    const check = ruleFor('PML008').check;
    const context = lintContext(items);
    const echoMeta = findById(items, echo.item.id);
    assert.equal(check(echoMeta, context), true);
    assert.equal(check(findById(items, punctuated.item.id), context), true);
    assert.equal(check(findById(items, distinct.item.id), context), false);
    assert.equal(check(findById(items, bare.item.id), context), false);
    assert.equal(check(findById(items, noteEcho.item.id), context), true);
    assert.equal(check(findById(items, noteDifferent.item.id), context), false);
    const emptyNote = adjust(echoMeta, {
      description: '',
      notes: [{ created_at: iso(Date.now()), author: 'lint-test', text: '' }],
    });
    assert.equal(check(emptyNote, context), false);
    const noNotes = adjust(echoMeta, { notes: undefined });
    assert.equal(check(noNotes, context), true);
  });
});

describe('PML009 blocked without justification', () => {
  it('requires a reason and rejects missing, self and unrecognized local blocker references', async (t: TestContext) => {
    const { client } = await tracker(t);
    const blocker = await client.create({ title: 'Upstream blocker work item', type: 'Task' });
    const openItem = await client.create({ title: 'Open unblocked work item', type: 'Task' });
    const noReason = await client.create({ title: 'Unreasoned blocked work item', type: 'Task', status: 'blocked', blockedBy: blocker.item.id });
    const reasonOnly = await client.create({ title: 'Reason only blocked work item', type: 'Task', status: 'blocked', blockedReason: 'waiting for approval' });
    const localRef = await client.create({
      title: 'Locally blocked work item',
      type: 'Task',
      status: 'blocked',
      blockedReason: 'waiting on the upstream blocker',
      blockedBy: blocker.item.id,
    });
    const depValid = await client.create({
      title: 'Dependency blocked work item',
      type: 'Task',
      status: 'blocked',
      blockedReason: 'waiting on the upstream blocker',
      dep: [`id=${blocker.item.id},kind=blocked_by`],
    });
    const depGhost = await client.create({
      title: 'Ghost dependency blocked work item',
      type: 'Task',
      status: 'blocked',
      blockedReason: 'waiting on a missing item',
      dep: ['id=missing-9999,kind=blocked_by'],
      allowUnresolvedDeps: true,
    });
    const depRelated = await client.create({
      title: 'Related dependency blocked work item',
      type: 'Task',
      status: 'blocked',
      blockedReason: 'waiting on the upstream blocker',
      dep: [`id=${blocker.item.id},kind=related`],
    });
    const prose = await client.create({ title: 'Prose blocked work item', type: 'Task', status: 'blocked', blockedReason: 'waiting on the vendor' });
    await client.update(prose.item.id, { blockedBy: 'the vendor team' });
    const external = await client.create({ title: 'External blocked work item', type: 'Task', status: 'blocked', blockedReason: 'waiting on the vendor tracker' });
    await client.update(external.item.id, { blockedBy: 'https://example.com/upstream' });
    const singleWord = await client.create({ title: 'Single word blocked work item', type: 'Task', status: 'blocked', blockedReason: 'waiting on approval' });
    await client.update(singleWord.item.id, { blockedBy: 'approval' });
    const pmGhost = await client.create({ title: 'Pm shaped blocked work item', type: 'Task', status: 'blocked', blockedReason: 'waiting on a missing item' });
    await client.update(pmGhost.item.id, { blockedBy: 'pm-ghost-missing' });
    const prefixGhost = await client.create({ title: 'Prefix shaped blocked work item', type: 'Task', status: 'blocked', blockedReason: 'waiting on a missing item' });
    await client.update(prefixGhost.item.id, { blockedBy: 'lint-test-missing-9999' });
    const items = await corpus(client);
    const check = ruleFor('PML009').check;
    const context = lintContext(items);
    const localMeta = findById(items, localRef.item.id);
    const depMeta = findById(items, depValid.item.id);
    assert.equal(check(findById(items, openItem.item.id), context), false);
    assert.equal(check(findById(items, noReason.item.id), context), true);
    assert.equal(check(findById(items, reasonOnly.item.id), context), false);
    assert.equal(check(localMeta, context), false);
    assert.equal(check(depMeta, context), false);
    assert.equal(check(findById(items, depGhost.item.id), context), true);
    assert.equal(check(findById(items, depRelated.item.id), context), false);
    assert.equal(check(findById(items, prose.item.id), context), false);
    assert.equal(check(findById(items, external.item.id), context), false);
    assert.equal(check(findById(items, singleWord.item.id), context), false);
    assert.equal(check(findById(items, pmGhost.item.id), context), true);
    assert.equal(check(findById(items, prefixGhost.item.id), context), true);
    assert.equal(check(adjust(localMeta, { blocked_by: localRef.item.id }), context), true);
    const realDep = (depMeta.dependencies ?? [])[0];
    assert.ok(realDep !== undefined, 'dependency blocked item retains its edge');
    const selfDep = adjust(depMeta, { blocked_by: undefined, dependencies: [{ ...realDep, id: depValid.item.id }] });
    assert.equal(check(selfDep, context), true);
  });
});

describe('PML010 duplicate-looking active titles', () => {
  it('flags exactly the ids the SDK duplicate analysis reports', async (t: TestContext) => {
    const { client } = await tracker(t);
    const first = await client.create({ title: 'Duplicate looking active work', type: 'Task' });
    const second = await client.create({ title: 'Duplicate looking active work', type: 'Task', allowDuplicate: true });
    const closedDuplicate = await client.create({ title: 'Duplicate looking active work', type: 'Task', allowDuplicate: true });
    await client.close(closedDuplicate.item.id, 'superseded by the first item');
    const distinct = await client.create({ title: 'Distinct active work item', type: 'Task' });
    const items = await corpus(client);
    const active = items.filter(item => ['open', 'in_progress', 'blocked'].includes(item.status));
    const analysis = analyzeDuplicateItems(active, { threshold: 0.92, limit: 1000 });
    const duplicateIds = new Set<string>();
    for (const cluster of analysis.clusters) {
      for (const item of cluster.items) duplicateIds.add(item.id);
    }
    assert.ok(duplicateIds.has(first.item.id), 'SDK analysis includes the first duplicate');
    assert.ok(duplicateIds.has(second.item.id), 'SDK analysis includes the second duplicate');
    assert.ok(!duplicateIds.has(closedDuplicate.item.id), 'SDK analysis ignores the closed duplicate');
    const check = ruleFor('PML010').check;
    const context = lintContext(items, { duplicateIds });
    assert.equal(check(findById(items, first.item.id), context), true);
    assert.equal(check(findById(items, second.item.id), context), true);
    assert.equal(check(findById(items, closedDuplicate.item.id), context), false);
    assert.equal(check(findById(items, distinct.item.id), context), false);
    assert.equal(check(findById(items, first.item.id), lintContext(items)), false);
  });
});