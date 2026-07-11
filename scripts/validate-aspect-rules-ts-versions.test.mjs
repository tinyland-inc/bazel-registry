import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateAspectRulesTsVersions } from './validate-aspect-rules-ts-versions.mjs';

function writeModule(root, moduleName, versions, yankedVersions = {}) {
	const moduleDir = path.join(root, 'modules', moduleName);
	fs.mkdirSync(moduleDir, { recursive: true });
	fs.writeFileSync(
		path.join(moduleDir, 'metadata.json'),
		`${JSON.stringify({ versions: versions.map(({ version }) => version), yanked_versions: yankedVersions }, null, 2)}\n`,
	);

	for (const { version, tsVersion } of versions) {
		const versionDir = path.join(moduleDir, version);
		fs.mkdirSync(versionDir, { recursive: true });
		fs.writeFileSync(
			path.join(versionDir, 'MODULE.bazel'),
			`module(name = "${moduleName}", version = "${version}")

rules_ts = use_extension("@aspect_rules_ts//ts:extensions.bzl", "ext")
rules_ts.deps(ts_version = "${tsVersion}")
`,
		);
	}
}

function fixture(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aspect-rules-ts-guard-'));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	return root;
}

test('equal ts_version requests pass', (t) => {
	const root = fixture(t);
	writeModule(root, 'module_a', [{ version: '1.0.0', tsVersion: '5.9.3' }]);
	writeModule(root, 'module_b', [{ version: '2.0.0', tsVersion: '5.9.3' }]);

	const result = validateAspectRulesTsVersions({ modulesDir: path.join(root, 'modules') });

	assert.equal(result.tsVersion, '5.9.3');
	assert.deepEqual(
		result.requests.map(({ moduleName, version }) => `${moduleName}@${version}`),
		['module_a@1.0.0', 'module_b@2.0.0'],
	);
});

test('divergent ts_version requests fail with module and version diagnostics', (t) => {
	const root = fixture(t);
	writeModule(root, 'module_a', [{ version: '1.0.0', tsVersion: '5.9.3' }]);
	writeModule(root, 'module_b', [{ version: '2.0.0', tsVersion: '6.0.3' }]);

	assert.throws(
		() => validateAspectRulesTsVersions({ modulesDir: path.join(root, 'modules') }),
		(error) => {
			assert.match(error.message, /aspect_rules_ts extension ts_version mismatch/);
			assert.match(error.message, /ts_version 5\.9\.3:[\s\S]*module_a@1\.0\.0/);
			assert.match(error.message, /ts_version 6\.0\.3:[\s\S]*module_b@2\.0\.0/);
			return true;
		},
	);
});

test('yanked divergent versions are ignored in favor of the latest non-yanked version', (t) => {
	const root = fixture(t);
	writeModule(
		root,
		'module_a',
		[
			{ version: '1.0.0', tsVersion: '5.9.3' },
			{ version: '1.1.0', tsVersion: '6.0.3' },
		],
		{ '1.1.0': 'conflicting release was withdrawn' },
	);
	writeModule(root, 'module_b', [{ version: '2.0.0', tsVersion: '5.9.3' }]);

	const result = validateAspectRulesTsVersions({ modulesDir: path.join(root, 'modules') });

	assert.equal(result.tsVersion, '5.9.3');
	assert.deepEqual(
		result.requests.map(({ moduleName, version }) => `${moduleName}@${version}`),
		['module_a@1.0.0', 'module_b@2.0.0'],
	);
});
