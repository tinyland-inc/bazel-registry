import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	compareBazelVersions,
	validateAspectRulesTsVersions,
} from './validate-aspect-rules-ts-versions.mjs';

const ASPECT_BAZEL_DEP =
	'bazel_dep(name = "aspect_rules_ts", version = "3.8.4")';

function defaultModuleSource(moduleName, version, tsVersion) {
	return `module(name = "${moduleName}", version = "${version}")

${ASPECT_BAZEL_DEP}

rules_ts = use_extension("@aspect_rules_ts//ts:extensions.bzl", "ext")
rules_ts.deps(ts_version = "${tsVersion}")
`;
}

function writeModule(root, moduleName, versions, yankedVersions = {}) {
	const moduleDir = path.join(root, 'modules', moduleName);
	fs.mkdirSync(moduleDir, { recursive: true });
	fs.writeFileSync(
		path.join(moduleDir, 'metadata.json'),
		`${JSON.stringify({ versions: versions.map(({ version }) => version), yanked_versions: yankedVersions }, null, 2)}\n`,
	);

	for (const { source, tsVersion, version } of versions) {
		const versionDir = path.join(moduleDir, version);
		fs.mkdirSync(versionDir, { recursive: true });
		fs.writeFileSync(
			path.join(versionDir, 'MODULE.bazel'),
			source ?? defaultModuleSource(moduleName, version, tsVersion),
		);
	}
}

function fixture(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aspect-rules-ts-guard-'));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	return root;
}

function validate(root) {
	return validateAspectRulesTsVersions({ modulesDir: path.join(root, 'modules') });
}

function summarizedRequests(result) {
	return result.requests.map(({ moduleName, tsVersion, version }) => ({
		moduleName,
		tsVersion,
		version,
	}));
}

test('Bazel relaxed versions use Bazel ordering rather than metadata or lexical order', () => {
	assert.ok(compareBazelVersions('', '999.0.0') > 0);
	assert.ok(compareBazelVersions('1.10.0', '1.9.0') > 0);
	assert.ok(compareBazelVersions('1.beta', '1.99') > 0);
	assert.ok(compareBazelVersions('1.0.patch.3', '1.0.patch.10') < 0);
	assert.ok(compareBazelVersions('1.0.patch3', '1.0.patch10') > 0);
	assert.ok(compareBazelVersions('1.01', '1.1') < 0);
	assert.ok(compareBazelVersions('2.0.0', '2.0.0-rc.9') > 0);
	assert.ok(compareBazelVersions('2.0.0-rc.10', '2.0.0-rc.9') > 0);
	assert.ok(compareBazelVersions('2.0.0-rc.99', '2.0.0-rc.2a') < 0);
	assert.ok(compareBazelVersions('2.0.0--', '2.0.0----') < 0);
	assert.ok(compareBazelVersions('18446744073709551615', '999.0.0') > 0);
	assert.equal(compareBazelVersions('2.0.0+build.2', '2.0.0+build.1'), 0);
	assert.throws(() => compareBazelVersions('1..0', '1.0.0'), /identifier is empty/);
	assert.throws(
		() => compareBazelVersions('1.0-18446744073709551616', '1.0.0'),
		/numeric segment is too large/,
	);
});

test('equal ts_version requests pass', (t) => {
	const root = fixture(t);
	writeModule(root, 'module_a', [{ version: '1.0.0', tsVersion: '5.9.3' }]);
	writeModule(root, 'module_b', [{ version: '2.0.0', tsVersion: '5.9.3' }]);

	const result = validate(root);

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
		() => validate(root),
		(error) => {
			assert.match(error.message, /aspect_rules_ts deps tag mismatch/);
			assert.match(error.message, /ts_version="5\.9\.3"[\s\S]*module_a@1\.0\.0\/MODULE\.bazel:\d+:\d+/);
			assert.match(error.message, /ts_version="6\.0\.3"[\s\S]*module_b@2\.0\.0\/MODULE\.bazel:\d+:\d+/);
			return true;
		},
	);
});

test('greatest non-yanked version is independent of metadata array order', (t) => {
	const root = fixture(t);
	writeModule(root, 'module_a', [
		{ version: '2.0.0', tsVersion: '6.0.3' },
		{ version: '1.5.0', tsVersion: '5.9.3' },
	]);
	writeModule(root, 'module_b', [{ version: '1.0.0', tsVersion: '6.0.3' }]);

	const result = validate(root);

	assert.equal(result.tsVersion, '6.0.3');
	assert.deepEqual(
		result.requests.map(({ moduleName, version }) => `${moduleName}@${version}`),
		['module_a@2.0.0', 'module_b@1.0.0'],
	);
});

test('greatest yanked version falls back to the greatest remaining version', (t) => {
	const root = fixture(t);
	writeModule(
		root,
		'module_a',
		[
			{ version: '1.5.0', tsVersion: '5.9.3' },
			{ version: '2.0.0', tsVersion: '6.0.3' },
			{ version: '1.0.0', tsVersion: '4.9.5' },
		],
		{ '2.0.0': 'conflicting release was withdrawn' },
	);
	writeModule(root, 'module_b', [{ version: '3.0.0', tsVersion: '5.9.3' }]);

	const result = validate(root);

	assert.equal(result.tsVersion, '5.9.3');
	assert.deepEqual(
		result.requests.map(({ moduleName, version }) => `${moduleName}@${version}`),
		['module_a@1.5.0', 'module_b@3.0.0'],
	);
});

test('module with every version yanked contributes no request', (t) => {
	const root = fixture(t);
	writeModule(
		root,
		'all_yanked',
		[
			{ version: '2.0.0', tsVersion: '6.0.3' },
			{ version: '1.0.0', tsVersion: '5.9.3' },
		],
		{ '1.0.0': 'withdrawn', '2.0.0': 'withdrawn' },
	);
	writeModule(root, 'active', [{ version: '1.0.0', tsVersion: '5.9.3' }]);

	const result = validate(root);

	assert.deepEqual(summarizedRequests(result), [
		{ moduleName: 'active', tsVersion: '5.9.3', version: '1.0.0' },
	]);
});

test('malformed metadata fails with module context', (t) => {
	const root = fixture(t);
	writeModule(root, 'bad_metadata', [{ version: '1.0.0', tsVersion: '5.9.3' }]);
	fs.writeFileSync(
		path.join(root, 'modules', 'bad_metadata', 'metadata.json'),
		JSON.stringify({ versions: '1.0.0', yanked_versions: [] }),
	);

	assert.throws(
		() => validate(root),
		/bad_metadata\/metadata\.json: versions must be an array of strings/,
	);
});

test('Starlark strings containing example calls do not create requests', (t) => {
	const root = fixture(t);
	writeModule(root, 'examples_only', [
		{
			source: `module(name = "examples_only", version = "1.0.0")
description = """rules_ts = use_extension("@aspect_rules_ts//ts:extensions.bzl", "ext")"""
example = r'rules_ts.deps(ts_version = "6.0.3")'
`,
			version: '1.0.0',
		},
	]);
	writeModule(root, 'real', [{ version: '1.0.0', tsVersion: '5.9.3' }]);

	const result = validate(root);

	assert.deepEqual(summarizedRequests(result), [
		{ moduleName: 'real', tsVersion: '5.9.3', version: '1.0.0' },
	]);
});

test('simple label and ts_version variables are resolved', (t) => {
	const root = fixture(t);
	writeModule(root, 'variable_module', [
		{
			source: `module(name = "variable_module", version = "1.0.0")
${ASPECT_BAZEL_DEP}
aspect_extension = "@aspect_rules_ts//ts:extensions.bzl"
typescript_version = "6.0.3"
rules_ts = use_extension(aspect_extension, "ext")
rules_ts.deps(ts_version = typescript_version)
`,
			version: '1.0.0',
		},
	]);
	writeModule(root, 'literal_module', [{ version: '1.0.0', tsVersion: '6.0.3' }]);

	const result = validate(root);

	assert.equal(result.tsVersion, '6.0.3');
	assert.equal(result.requests.length, 2);
});

test('repo_name aliases and canonical repository labels resolve semantic module identity', (t) => {
	const root = fixture(t);
	writeModule(root, 'aliased', [
		{
			source: `module(name = "aliased", version = "1.0.0")
bazel_dep(name = "aspect_rules_ts", version = "3.8.4", repo_name = "ts_rules")
rules_ts = use_extension("@ts_rules//ts:extensions.bzl", "ext")
rules_ts.deps(ts_version = "6.0.3")
`,
			version: '1.0.0',
		},
	]);
	writeModule(root, 'canonical', [
		{
			source: `module(name = "canonical", version = "1.0.0")
bazel_dep(name = "aspect_rules_ts", version = "3.8.4", repo_name = None)
rules_ts = use_extension("@@aspect_rules_ts+//ts:extensions.bzl", "ext")
rules_ts.deps(ts_version = "6.0.3")
`,
			version: '1.0.0',
		},
	]);
	writeModule(root, 'legacy_canonical', [
		{
			source: `module(name = "legacy_canonical", version = "1.0.0")
bazel_dep(name = "aspect_rules_ts", version = "3.8.4", repo_name = None)
rules_ts = use_extension("@@aspect_rules_ts~3.8.4//ts:extensions.bzl", "ext")
rules_ts.deps(ts_version = "6.0.3")
`,
			version: '1.0.0',
		},
	]);

	const result = validate(root);

	assert.equal(result.tsVersion, '6.0.3');
	assert.equal(result.requests.length, 3);
});

test('unknown aspect_rules_ts canonical repository schemes fail closed', (t) => {
	for (const [moduleName, repository] of [
		['future_canonical', 'aspect_rules_ts++future'],
		['alternate_canonical', 'aspect_rules_ts.3.8.4'],
		['versionless_legacy_canonical', 'aspect_rules_ts~'],
	]) {
		const root = fixture(t);
		writeModule(root, moduleName, [
			{
				source: `module(name = "${moduleName}", version = "1.0.0")
bazel_dep(name = "aspect_rules_ts", version = "3.8.4", repo_name = None)
rules_ts = use_extension("@@${repository}//ts:extensions.bzl", "ext")
rules_ts.deps(ts_version = "6.0.3")
`,
				version: '1.0.0',
			},
		]);

		assert.throws(
			() => validate(root),
			new RegExp(`${moduleName}@1\\.0\\.0/MODULE\\.bazel:\\d+:\\d+: unsupported aspect_rules_ts canonical repository`),
		);
	}
});

test('apparent repository collisions do not impersonate aspect_rules_ts', (t) => {
	const root = fixture(t);
	writeModule(root, 'collision', [
		{
			source: `module(name = "collision", version = "1.0.0")
bazel_dep(name = "unrelated_rules", version = "1.0.0", repo_name = "aspect_rules_ts")
bazel_dep(name = "aspect_rules_ts", version = "3.8.4", repo_name = "ts_rules")
unrelated = use_extension("@aspect_rules_ts//ts:extensions.bzl", "ext")
unrelated.deps(ts_version = "7.0.0")
rules_ts = use_extension("@ts_rules//ts:extensions.bzl", "ext")
rules_ts.deps(ts_version = "5.9.3")
`,
			version: '1.0.0',
		},
	]);
	writeModule(root, 'literal', [{ version: '1.0.0', tsVersion: '5.9.3' }]);

	const result = validate(root);

	assert.equal(result.tsVersion, '5.9.3');
	assert.equal(result.requests.length, 2);
});

test('raw static labels and versions remain statically resolvable', (t) => {
	const root = fixture(t);
	writeModule(root, 'raw_static', [
		{
			source: `module(name = "raw_static", version = "1.0.0")
${ASPECT_BAZEL_DEP}
rules_ts = use_extension(r"@aspect_rules_ts//ts:extensions.bzl", "ext")
rules_ts.deps(ts_version = r"5.9.3")
`,
			version: '1.0.0',
		},
	]);
	writeModule(root, 'literal', [{ version: '1.0.0', tsVersion: '5.9.3' }]);

	const result = validate(root);

	assert.equal(result.tsVersion, '5.9.3');
	assert.equal(result.requests.length, 2);
});

test('assigned or method-aliased deps calls fail closed', (t) => {
	const root = fixture(t);
	writeModule(root, 'assigned_tag', [
		{
			source: `module(name = "assigned_tag", version = "1.0.0")
${ASPECT_BAZEL_DEP}
rules_ts = use_extension("@aspect_rules_ts//ts:extensions.bzl", "ext")
rules_ts.deps(ts_version = "5.9.3")
ignored = rules_ts.deps(ts_version = "6.0.3")
`,
			version: '1.0.0',
		},
	]);

	assert.throws(
		() => validate(root),
		/assigned_tag@1\.0\.0\/MODULE\.bazel:5:\d+: unsupported aspect_rules_ts extension proxy use/,
	);

	const aliasRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aspect-rules-ts-method-alias-'));
	t.after(() => fs.rmSync(aliasRoot, { recursive: true, force: true }));
	writeModule(aliasRoot, 'method_alias', [
		{
			source: `module(name = "method_alias", version = "1.0.0")
${ASPECT_BAZEL_DEP}
rules_ts = use_extension("@aspect_rules_ts//ts:extensions.bzl", "ext")
tag = rules_ts.deps
tag(ts_version = "6.0.3")
`,
			version: '1.0.0',
		},
	]);
	assert.throws(
		() => validate(aliasRoot),
		/method_alias@1\.0\.0\/MODULE\.bazel:4:\d+: unsupported aspect_rules_ts extension proxy use/,
	);
});

test('dynamic and container-carried extension proxies fail closed', (t) => {
	const root = fixture(t);
	writeModule(root, 'getattr_hidden_tag', [
		{
			source: `module(name = "getattr_hidden_tag", version = "1.0.0")
${ASPECT_BAZEL_DEP}
rules_ts = use_extension("@aspect_rules_ts//ts:extensions.bzl", "ext")
rules_ts.deps(ts_version = "5.9.3")
getattr(rules_ts, "deps")(ts_version = "6.0.3")
`,
			version: '1.0.0',
		},
	]);

	assert.throws(
		() => validate(root),
		/getattr_hidden_tag@1\.0\.0\/MODULE\.bazel:5:\d+: unsupported aspect_rules_ts extension proxy use; use a direct proxy\.deps\(\.\.\.\) call/,
	);

	const listRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aspect-rules-ts-list-proxy-'));
	t.after(() => fs.rmSync(listRoot, { recursive: true, force: true }));
	writeModule(listRoot, 'list_hidden_tag', [
		{
			source: `module(name = "list_hidden_tag", version = "1.0.0")
${ASPECT_BAZEL_DEP}
rules_ts = use_extension("@aspect_rules_ts//ts:extensions.bzl", "ext")
rules_ts.deps(ts_version = "5.9.3")
proxies = [rules_ts]
proxies[0].deps(ts_version = "6.0.3")
`,
			version: '1.0.0',
		},
	]);

	assert.throws(
		() => validate(listRoot),
		/list_hidden_tag@1\.0\.0\/MODULE\.bazel:5:\d+: unsupported aspect_rules_ts extension proxy use; use a direct proxy\.deps\(\.\.\.\) call/,
	);

	for (const [moduleName, carriage] of [
		['tuple_hidden_tag', 'proxies = (rules_ts,)'],
		['dict_hidden_tag', 'proxies = {"typescript": rules_ts}'],
	]) {
		const carriageRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), `aspect-rules-ts-${moduleName}-`),
		);
		t.after(() => fs.rmSync(carriageRoot, { recursive: true, force: true }));
		writeModule(carriageRoot, moduleName, [
			{
				source: `module(name = "${moduleName}", version = "1.0.0")
${ASPECT_BAZEL_DEP}
rules_ts = use_extension("@aspect_rules_ts//ts:extensions.bzl", "ext")
rules_ts.deps(ts_version = "5.9.3")
${carriage}
`,
				version: '1.0.0',
			},
		]);
		assert.throws(
			() => validate(carriageRoot),
			new RegExp(`${moduleName}@1\\.0\\.0/MODULE\\.bazel:5:\\d+: unsupported aspect_rules_ts extension proxy use`),
		);
	}
});

test('simple proxy aliases and repository-management builtins remain supported', (t) => {
	const root = fixture(t);
	writeModule(root, 'canonical_proxy_uses', [
		{
			source: `module(name = "canonical_proxy_uses", version = "1.0.0")
${ASPECT_BAZEL_DEP}
rules_ts = use_extension("@aspect_rules_ts//ts:extensions.bzl", "ext")
alias = (rules_ts)
alias.deps(name = "used", ts_version = "5.9.3")
use_repo(alias, "used")
alias.deps(name = "injected", ts_version = "5.9.3")
inject_repo(alias, injected = "existing_typescript")
alias.deps(name = "overridden", ts_version = "5.9.3")
override_repo(alias, overridden = "existing_typescript")
`,
			version: '1.0.0',
		},
	]);

	const result = validate(root);
	assert.deepEqual(result.tagNames, ['injected', 'overridden', 'used']);
	assert.equal(result.requests.length, 3);
});

test('dev-first composite calls cannot conceal a shared extension tag', (t) => {
	const root = fixture(t);
	writeModule(root, 'dev_first_composite', [
		{
			source: `module(name = "dev_first_composite", version = "1.0.0")
${ASPECT_BAZEL_DEP}
dev_rules_ts = use_extension(
    "@aspect_rules_ts//ts:extensions.bzl",
    "ext",
    dev_dependency = True,
)
shared_rules_ts = use_extension("@aspect_rules_ts//ts:extensions.bzl", "ext")
[
    dev_rules_ts.deps(ts_version = "6.0.3"),
    shared_rules_ts.deps(ts_version = "7.0.0"),
]
shared_rules_ts.deps(ts_version = "5.9.3")
`,
			version: '1.0.0',
		},
	]);

	assert.throws(
		() => validate(root),
		/dev_first_composite@1\.0\.0\/MODULE\.bazel:\d+:\d+: unsupported aspect_rules_ts extension proxy use; use a direct proxy\.deps\(\.\.\.\) call/,
	);
});

test('included MODULE fragments fail closed because the guard cannot inspect them', (t) => {
	const root = fixture(t);
	writeModule(root, 'included_hidden_tag', [
		{
			source: `module(name = "included_hidden_tag", version = "1.0.0")
${ASPECT_BAZEL_DEP}
rules_ts = use_extension("@aspect_rules_ts//ts:extensions.bzl", "ext")
rules_ts.deps(ts_version = "5.9.3")
include("//:hidden.MODULE.bazel")
`,
			version: '1.0.0',
		},
	]);

	assert.throws(
		() => validate(root),
		/included_hidden_tag@1\.0\.0\/MODULE\.bazel:5:\d+: include\(\) fragments are unsupported because they may conceal extension tags/,
	);
});

test('same ts_version with different ts_integrity conflicts for the same tag name', (t) => {
	const root = fixture(t);
	writeModule(root, 'integrity_a', [
		{
			source: `module(name = "integrity_a", version = "1.0.0")
${ASPECT_BAZEL_DEP}
rules_ts = use_extension("@aspect_rules_ts//ts:extensions.bzl", "ext")
rules_ts.deps(
    name = "npm_typescript",
    ts_version = "5.9.3",
    ts_integrity = "sha512-aaaa",
)
`,
			version: '1.0.0',
		},
	]);
	writeModule(root, 'integrity_b', [
		{
			source: `module(name = "integrity_b", version = "1.0.0")
${ASPECT_BAZEL_DEP}
rules_ts = use_extension("@aspect_rules_ts//ts:extensions.bzl", "ext")
rules_ts.deps(
    name = "npm_typescript",
    ts_version = "5.9.3",
    ts_integrity = "sha512-bbbb",
)
`,
			version: '1.0.0',
		},
	]);

	assert.throws(
		() => validate(root),
		(error) => {
			assert.match(error.message, /aspect_rules_ts deps tag mismatch/);
			assert.match(error.message, /name "npm_typescript"/);
			assert.match(error.message, /ts_version="5\.9\.3"/);
			assert.match(error.message, /ts_integrity="sha512-aaaa"/);
			assert.match(error.message, /ts_integrity="sha512-bbbb"/);
			assert.match(error.message, /integrity_a@1\.0\.0\/MODULE\.bazel:\d+:\d+/);
			assert.match(error.message, /integrity_b@1\.0\.0\/MODULE\.bazel:\d+:\d+/);
			return true;
		},
	);
});

test('tag name and ts_version_from participate in conflict identity', (t) => {
	const root = fixture(t);
	writeModule(root, 'from_a', [
		{
			source: `module(name = "from_a", version = "1.0.0")
${ASPECT_BAZEL_DEP}
rules_ts = use_extension("@aspect_rules_ts//ts:extensions.bzl", "ext")
rules_ts.deps(name = "from_package", ts_version_from = "//:package.json")
rules_ts.deps(name = "independent", ts_version = "5.9.3")
`,
			version: '1.0.0',
		},
	]);
	writeModule(root, 'from_b', [
		{
			source: `module(name = "from_b", version = "1.0.0")
${ASPECT_BAZEL_DEP}
rules_ts = use_extension("@aspect_rules_ts//ts:extensions.bzl", "ext")
rules_ts.deps(name = "from_package", ts_version_from = "//:package.json")
rules_ts.deps(name = "independent", ts_version = "6.0.3")
`,
			version: '1.0.0',
		},
	]);

	assert.throws(
		() => validate(root),
		(error) => {
			assert.match(error.message, /name "from_package"/);
			assert.match(error.message, /ts_version_from="\/\/:package\.json"/);
			assert.match(error.message, /from_a@1\.0\.0\/MODULE\.bazel:\d+:\d+/);
			assert.match(error.message, /from_b@1\.0\.0\/MODULE\.bazel:\d+:\d+/);
			return true;
		},
	);
});

test('apparent external ts_version_from labels fail closed', (t) => {
	const root = fixture(t);
	writeModule(root, 'apparent_version_source', [
		{
			source: `module(name = "apparent_version_source", version = "1.0.0")
${ASPECT_BAZEL_DEP}
bazel_dep(name = "version_source", version = "1.0.0")
rules_ts = use_extension("@aspect_rules_ts//ts:extensions.bzl", "ext")
rules_ts.deps(ts_version_from = "@version_source//:package.json")
`,
			version: '1.0.0',
		},
	]);

	assert.throws(
		() => validate(root),
		/apparent_version_source@1\.0\.0\/MODULE\.bazel:\d+:\d+: ts_version_from apparent repository @version_source is ambiguous under Bzlmod version selection/,
	);
});

test('root-apparent ts_version_from labels fail closed', (t) => {
	const root = fixture(t);
	writeModule(root, 'root_apparent_version_source', [
		{
			source: `module(name = "root_apparent_version_source", version = "1.0.0")
${ASPECT_BAZEL_DEP}
rules_ts = use_extension("@aspect_rules_ts//ts:extensions.bzl", "ext")
rules_ts.deps(ts_version_from = "@//:package.json")
`,
			version: '1.0.0',
		},
	]);

	assert.throws(
		() => validate(root),
		/root_apparent_version_source@1\.0\.0\/MODULE\.bazel:\d+:\d+: ts_version_from @\/\/ labels are ambiguous outside the root module/,
	);
});

test('different tag names may request different TypeScript identities', (t) => {
	const root = fixture(t);
	writeModule(root, 'named_tags', [
		{
			source: `module(name = "named_tags", version = "1.0.0")
${ASPECT_BAZEL_DEP}
rules_ts = use_extension("@aspect_rules_ts//ts:extensions.bzl", "ext")
rules_ts.deps(name = "typescript_5", ts_version = "5.9.3")
rules_ts.deps(name = "typescript_6", ts_version = "6.0.3")
`,
			version: '1.0.0',
		},
	]);

	const result = validate(root);
	assert.equal(result.requests.length, 2);
});

test('omitted and explicit tag defaults have the same identity', (t) => {
	const root = fixture(t);
	writeModule(root, 'defaults_omitted', [
		{
			source: `module(name = "defaults_omitted", version = "1.0.0")
${ASPECT_BAZEL_DEP}
rules_ts = use_extension("@aspect_rules_ts//ts:extensions.bzl", "ext")
rules_ts.deps()
`,
			version: '1.0.0',
		},
	]);
	writeModule(root, 'defaults_explicit', [
		{
			source: `module(name = "defaults_explicit", version = "1.0.0")
${ASPECT_BAZEL_DEP}
rules_ts = use_extension("@aspect_rules_ts//ts:extensions.bzl", "ext")
rules_ts.deps(
    name = "npm_typescript",
    ts_version = "",
    ts_version_from = None,
    ts_integrity = "",
)
`,
			version: '1.0.0',
		},
	]);

	const result = validate(root);
	assert.equal(result.requests.length, 2);
	assert.ok(result.requests.every((request) => request.name === 'npm_typescript'));
	assert.ok(result.requests.every((request) => request.tsVersion === ''));
	assert.ok(result.requests.every((request) => request.tsVersionFrom === undefined));
	assert.ok(result.requests.every((request) => request.tsIntegrity === ''));
});

test('dev-only and isolated extension usages do not join the shared graph', (t) => {
	const root = fixture(t);
	writeModule(root, 'dev_only', [
		{
			source: `module(name = "dev_only", version = "1.0.0")
${ASPECT_BAZEL_DEP}
rules_ts = use_extension(
    "@aspect_rules_ts//ts:extensions.bzl",
    "ext",
    dev_dependency = True,
)
rules_ts.deps(ts_version = "6.0.3")
`,
			version: '1.0.0',
		},
	]);
	writeModule(root, 'isolated', [
		{
			source: `module(name = "isolated", version = "1.0.0")
${ASPECT_BAZEL_DEP}
rules_ts = use_extension("@aspect_rules_ts//ts:extensions.bzl", "ext", isolate = True)
rules_ts.deps(ts_version = "7.0.0")
`,
			version: '1.0.0',
		},
	]);
	writeModule(root, 'explicit_shared', [
		{
			source: `module(name = "explicit_shared", version = "1.0.0")
${ASPECT_BAZEL_DEP}
rules_ts = use_extension(
    "@aspect_rules_ts//ts:extensions.bzl",
    "ext",
    dev_dependency = False,
    isolate = False,
)
rules_ts.deps(ts_version = "5.9.3")
`,
			version: '1.0.0',
		},
	]);
	writeModule(root, 'active', [{ version: '1.0.0', tsVersion: '5.9.3' }]);

	const result = validate(root);

	assert.deepEqual(summarizedRequests(result), [
		{ moduleName: 'active', tsVersion: '5.9.3', version: '1.0.0' },
		{ moduleName: 'explicit_shared', tsVersion: '5.9.3', version: '1.0.0' },
	]);
});

test('multiline calls and comments parse while commented-out calls are ignored', (t) => {
	const root = fixture(t);
	writeModule(root, 'multiline', [
		{
			source: `module(name = "multiline", version = "1.0.0")
${ASPECT_BAZEL_DEP}
# fake = use_extension("@aspect_rules_ts//ts:extensions.bzl", "ext")
# fake.deps(ts_version = "99.0.0")
rules_ts = use_extension(
    # extension label
    "@aspect_rules_ts//ts:extensions.bzl",
    # extension name
    "ext",
)
rules_ts.deps(
    # coordinated version
    ts_version = "5.9.3",
)
`,
			version: '1.0.0',
		},
	]);
	writeModule(root, 'literal', [{ version: '1.0.0', tsVersion: '5.9.3' }]);

	const result = validate(root);

	assert.equal(result.requests.length, 2);
});

test('dynamic extension label fails closed with module and source location', (t) => {
	const root = fixture(t);
	writeModule(root, 'dynamic_label', [
		{
			source: `module(name = "dynamic_label", version = "1.0.0")
${ASPECT_BAZEL_DEP}
suffix = "extensions.bzl"
aspect_extension = "@aspect_rules_ts//ts:" + suffix
rules_ts = use_extension(aspect_extension, "ext")
rules_ts.deps(ts_version = "6.0.3")
`,
			version: '1.0.0',
		},
	]);

	assert.throws(
		() => validate(root),
		/dynamic_label@1\.0\.0\/MODULE\.bazel:\d+:\d+: use_extension\(\) label must be a canonical string literal or simple string constant/,
	);
});

test('dynamic ts_version and ambiguous booleans fail with contextual diagnostics', (t) => {
	const root = fixture(t);
	writeModule(root, 'dynamic_version', [
		{
			source: `module(name = "dynamic_version", version = "1.0.0")
${ASPECT_BAZEL_DEP}
major = "6"
typescript_version = major + ".0.3"
rules_ts = use_extension("@aspect_rules_ts//ts:extensions.bzl", "ext")
rules_ts.deps(ts_version = typescript_version)
`,
			version: '1.0.0',
		},
	]);

	assert.throws(
		() => validate(root),
		/dynamic_version@1\.0\.0\/MODULE\.bazel:\d+:\d+: ts_version must be a canonical string literal or simple string constant/,
	);

	const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aspect-rules-ts-guard-bool-'));
	t.after(() => fs.rmSync(secondRoot, { recursive: true, force: true }));
	writeModule(secondRoot, 'dynamic_boolean', [
		{
			source: `module(name = "dynamic_boolean", version = "1.0.0")
${ASPECT_BAZEL_DEP}
is_development = False
rules_ts = use_extension(
    "@aspect_rules_ts//ts:extensions.bzl",
    "ext",
    dev_dependency = is_development,
)
rules_ts.deps(ts_version = "5.9.3")
`,
			version: '1.0.0',
		},
	]);

	assert.throws(
		() => validate(secondRoot),
		/dynamic_boolean@1\.0\.0\/MODULE\.bazel:\d+:\d+: dev_dependency must be the literal True or False/,
	);
});

test('augmented and destructuring assignments fail closed before bindings become stale', (t) => {
	for (const [moduleName, mutation] of [
		['augmented_binding', 'typescript_version += ".3"'],
		['destructured_binding', 'typescript_version, other = ["5.9.3", "ignored"]'],
	]) {
		const root = fixture(t);
		writeModule(root, moduleName, [
			{
				source: `module(name = "${moduleName}", version = "1.0.0")
${ASPECT_BAZEL_DEP}
typescript_version = "5.9"
${mutation}
rules_ts = use_extension("@aspect_rules_ts//ts:extensions.bzl", "ext")
rules_ts.deps(ts_version = typescript_version)
`,
				version: '1.0.0',
			},
		]);

		assert.throws(
			() => validate(root),
			new RegExp(`${moduleName}@1\\.0\\.0/MODULE\\.bazel:4:\\d+: unsupported top-level assignment form`),
		);
	}
});

test('unterminated canonical calls report module and delimiter location', (t) => {
	const root = fixture(t);
	writeModule(root, 'broken_call', [
		{
			source: `module(name = "broken_call", version = "1.0.0")
${ASPECT_BAZEL_DEP}
rules_ts = use_extension("@aspect_rules_ts//ts:extensions.bzl", "ext")
rules_ts.deps(
    ts_version = "5.9.3",
`,
			version: '1.0.0',
		},
	]);

	assert.throws(
		() => validate(root),
		/broken_call@1\.0\.0\/MODULE\.bazel:\d+:\d+: unterminated \(; expected \)/,
	);
});
