import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

/** Published npm identity and the independent pm catalog identity. */
interface PackageMetadata {
  name: string;
  homepage: string;
  publishConfig: { access: string };
  pm: { aliases: string[]; catalog: { display_name: string; links: { npm: string } } };
}

const root = resolve(import.meta.dirname, '..');

test('scoped npm metadata preserves the public homepage and pm extension identity', () => {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as PackageMetadata;
  const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8')) as { name: string; packages: Record<string, { name: string }> };
  const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8')) as { name: string };
  assert.equal(pkg.name, '@unbrained/pm-lint');
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.packages[''].name, pkg.name);
  assert.equal(pkg.homepage, 'https://pm-cli.unbrained.dev/packages/pm-lint');
  assert.equal(pkg.publishConfig.access, 'public');
  assert.equal(pkg.pm.catalog.links.npm, 'https://www.npmjs.com/package/@unbrained/pm-lint');
  assert.equal(pkg.pm.catalog.display_name, 'pm-lint');
  assert.deepEqual(pkg.pm.aliases, ['lint']);
  assert.equal(manifest.name, 'pm-lint');
});

test('registry Bun verification resolves the scoped npm package', () => {
  const workflow = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8');
  assert.match(workflow, /pkg_name="@unbrained\/pm-lint"/);
  assert.doesNotMatch(workflow, /pkg_name="pm-lint"/);
  assert.match(workflow, /bun add "\$\{pkg_name\}@\$\{pkg_version\}"/);
});
