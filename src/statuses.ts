import { PmClient, resolveRuntimeStatusRegistry } from '@unbrained/pm-cli/sdk';

/** SDK-resolved lifecycle semantics, including custom status roles. */
export type LintStatusRegistry = ReturnType<typeof resolveRuntimeStatusRegistry>;

/** Built-in semantics for callers evaluating an already certified snapshot. */
export const DEFAULT_STATUSES = resolveRuntimeStatusRegistry({ version: 1, files: {}, statuses: [], fields: [], workflow: {}, unknown_field_policy: 'allow' });

/** Load configured lifecycle roles through core's native schema inspection API. */
export async function readLintStatuses(pmRoot: string): Promise<LintStatusRegistry> {
  const schema = await PmClient.forActiveExtensionHost({ pmRoot }).schemaList();
  const statuses = [...schema.statuses.builtin, ...schema.statuses.custom] as Parameters<typeof resolveRuntimeStatusRegistry>[0]['statuses'];
  return resolveRuntimeStatusRegistry({ version: 1, files: {}, statuses, fields: [], workflow: {}, unknown_field_policy: 'allow' });
}
