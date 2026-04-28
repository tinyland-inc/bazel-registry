import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const registry = JSON.parse(fs.readFileSync(path.join(root, 'bazel_registry.json'), 'utf8'));
const status = registry.status ?? 'active';
const moduleBasePath = registry.module_base_path ?? 'modules';
const modulesDir = path.join(root, moduleBasePath);

function listModuleVersions() {
	if (status !== 'active') {
		return [];
	}

	return fs
		.readdirSync(modulesDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((moduleEntry) => {
			const moduleName = moduleEntry.name;
			const moduleDir = path.join(modulesDir, moduleName);
			const versions = fs
				.readdirSync(moduleDir, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name)
				.sort((left, right) => {
					const leftParts = left.split('.').map(Number);
					const rightParts = right.split('.').map(Number);
					for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
						const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
						if (delta !== 0) {
							return delta;
						}
					}
					return 0;
				});
			return { moduleName, version: versions.at(-1) };
		})
		.sort((left, right) =>
			`${left.moduleName}@${left.version}`.localeCompare(`${right.moduleName}@${right.version}`),
		);
}

const modules = listModuleVersions();
if (modules.length === 0) {
	console.log('No active modules to smoke test.');
	process.exit(0);
}

const githubToken =
	process.env.TINYLAND_REGISTRY_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!githubToken && process.env.CI) {
	console.log(
		'Skipping Bazel registry smoke: TINYLAND_REGISTRY_GITHUB_TOKEN is not configured for private module tarballs.',
	);
	process.exit(0);
}

function writeGitHubCredentialHelper(smokeDir) {
	if (!githubToken) {
		return [];
	}

	const helperPath = path.join(smokeDir, 'github-credential-helper.mjs');
	fs.writeFileSync(
		helperPath,
		`#!/usr/bin/env node
const token = process.env.TINYLAND_REGISTRY_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token) process.exit(1);
process.stdout.write(JSON.stringify({
  headers: {
    Authorization: [\`Bearer \${token}\`],
    Accept: ['application/vnd.github+json'],
  },
}));
`,
		{ mode: 0o700 },
	);

	return [`--credential_helper=github.com=${helperPath}`];
}

const smokeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyland-registry-smoke-'));
try {
	const credentialHelperArgs = writeGitHubCredentialHelper(smokeDir);
	const moduleBazel = [
		'module(name = "tinyland_registry_smoke", version = "0.0.0")',
		...modules.map(
			({ moduleName, version }) => `bazel_dep(name = "${moduleName}", version = "${version}")`,
		),
		'',
	].join('\n');
	fs.writeFileSync(path.join(smokeDir, 'MODULE.bazel'), moduleBazel);
	fs.writeFileSync(path.join(smokeDir, '.bazelversion'), fs.readFileSync(path.join(root, '.bazelversion')));

	const result = spawnSync(
		'bazel',
		[
			'mod',
			'graph',
			...credentialHelperArgs,
			`--registry=file://${root}`,
			'--registry=https://bcr.bazel.build',
		],
		{
			cwd: smokeDir,
			encoding: 'utf8',
		},
	);

	if (result.status !== 0) {
		process.stderr.write(result.stdout);
		process.stderr.write(result.stderr);
		process.exit(result.status ?? 1);
	}

	console.log(
		`Resolved active registry modules: ${modules
			.map(({ moduleName, version }) => `${moduleName}@${version}`)
			.join(', ')}`,
	);
} finally {
	fs.rmSync(smokeDir, { recursive: true, force: true });
}
