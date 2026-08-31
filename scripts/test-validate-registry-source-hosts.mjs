// Fixture-driven negative control for the source-host allowlist rule in
// scripts/validate-registry.mjs.
//
// validate-registry.mjs itself has no fixture data of its own -- CI proves it
// by running `npm run validate` straight against this repo's real modules/
// tree (the "positive control": 180 real source.json entries all pass). That
// leaves the refusal path unproven: nothing in the repo's real data uses a
// disallowed host, so a regression that silently dropped or weakened the
// allowlist check would go green forever.
//
// This script builds tiny throwaway registry fixtures (a valid one, plus one
// per disallowed-host shape) in a temp directory, runs validate-registry.mjs
// against each with `cwd` pointed at the fixture, and asserts the exit code
// and failure message are what the allowlist rule promises. It has no test
// framework dependency, matching this repo's existing scripts/*.mjs
// convention (plain node, run via an `npm run` script, invoked as its own
// step in .github/workflows/validate.yml).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const validatorPath = path.join(__dirname, 'validate-registry.mjs');
const bazelVersion = fs.readFileSync(path.join(repoRoot, '.bazelversion'), 'utf8').trim();

const MODULE_NAME = 'fixture_module';
const MODULE_VERSION = '0.1.0';

function writeJson(filePath, value) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

// Builds a minimal-but-complete one-module active registry fixture under a
// fresh temp directory, with `sourceUrl` as its module's source.json url.
// Every other field is a fixed known-good value so a failure can only ever
// be attributed to the url under test.
function buildFixtureRegistry(sourceUrl) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bazel-registry-fixture-'));

	writeJson(path.join(root, 'bazel_registry.json'), {
		mirrors: [],
		module_base_path: 'modules',
		status: 'active',
	});
	writeJson(path.join(root, 'package.json'), { bazelEstate: { version: bazelVersion } });
	fs.writeFileSync(path.join(root, '.bazelversion'), bazelVersion + '\n');

	const versionDir = path.join(root, 'modules', MODULE_NAME, MODULE_VERSION);
	writeJson(path.join(versionDir, 'source.json'), {
		url: sourceUrl,
		strip_prefix: `${MODULE_NAME}-${MODULE_VERSION}`,
		integrity: 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
	});
	writeJson(path.join(root, 'modules', MODULE_NAME, 'metadata.json'), {
		homepage: 'https://github.com/tinyland-inc/fixture-module',
		versions: [MODULE_VERSION],
		yanked_versions: {},
	});
	fs.writeFileSync(
		versionDir + '/MODULE.bazel',
		`module(\n    name = "${MODULE_NAME}",\n    version = "${MODULE_VERSION}",\n)\n`,
	);

	return root;
}

function runValidator(cwd) {
	const result = spawnSync(process.execPath, [validatorPath], { cwd, encoding: 'utf8' });
	return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

const cases = [
	{
		name: 'accepts a github.com release-tag archive url',
		url: 'https://github.com/tinyland-inc/fixture-module/archive/refs/tags/v0.1.0.tar.gz',
		expectPass: true,
	},
	{
		name: 'accepts an api.github.com repos tarball url',
		url: 'https://api.github.com/repos/tinyland-inc/fixture-module/tarball/abc123def456',
		expectPass: true,
	},
	{
		name: 'refuses registry.npmjs.org',
		url: 'https://registry.npmjs.org/fixture-module/-/fixture-module-0.1.0.tgz',
		expectPass: false,
		expectMessage: /refused package-registry host \(registry\.npmjs\.org\)/,
	},
	{
		name: 'refuses npm.pkg.github.com',
		url: 'https://npm.pkg.github.com/download/tinyland-inc/fixture-module/0.1.0',
		expectPass: false,
		expectMessage: /refused package-registry host \(npm\.pkg\.github\.com\)/,
	},
	{
		name: 'refuses an unlisted host even when it merely resembles an archive url',
		url: 'https://gitlab.com/tinyland-inc/fixture-module/-/archive/refs/tags/v0.1.0.tar.gz',
		expectPass: false,
		expectMessage: /does not match an allowed source host\/shape/,
	},
];

let failures = 0;

for (const testCase of cases) {
	const fixtureRoot = buildFixtureRegistry(testCase.url);
	try {
		const { status, stderr, stdout } = runValidator(fixtureRoot);
		const passed = status === 0;

		try {
			assert.equal(
				passed,
				testCase.expectPass,
				`expected validator ${testCase.expectPass ? 'to pass' : 'to fail'} for url ${testCase.url}, ` +
					`got exit ${status}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
			);
			if (!testCase.expectPass && testCase.expectMessage) {
				assert.match(stderr, testCase.expectMessage);
			}
			console.log(`ok - ${testCase.name}`);
		} catch (error) {
			failures += 1;
			console.error(`not ok - ${testCase.name}`);
			console.error(error.message);
		}
	} finally {
		fs.rmSync(fixtureRoot, { recursive: true, force: true });
	}
}

if (failures > 0) {
	console.error(`\n${failures} of ${cases.length} source-host fixture case(s) failed`);
	process.exit(1);
}

console.log(`\nAll ${cases.length} source-host fixture cases behaved as expected.`);
