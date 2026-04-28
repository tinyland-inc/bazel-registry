import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const root = process.cwd();

const modules = [
	{ moduleName: 'tummycrypt_tinyland_auth', version: '0.3.0' },
	{ moduleName: 'tummycrypt_tinyland_auth_pg', version: '0.2.3' },
	{ moduleName: 'tummycrypt_tinyland_security', version: '0.3.1' },
	{ moduleName: 'tummycrypt_tinyland_rate_limit', version: '0.3.0' },
];

const targets = [
	'@tummycrypt_tinyland_auth//:pkg',
	'@tummycrypt_tinyland_auth_pg//:pkg',
	'@tummycrypt_tinyland_security//:pkg',
	'@tummycrypt_tinyland_rate_limit//:pkg',
];

const githubToken =
	process.env.TINYLAND_REGISTRY_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!githubToken && process.env.CI) {
	console.log(
		'Skipping Stage 1 consumer target smoke: TINYLAND_REGISTRY_GITHUB_TOKEN is not configured for private module tarballs.',
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

const smokeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyland-registry-stage1-consumer-smoke-'));
let exitCode = 0;
try {
	const credentialHelperArgs = writeGitHubCredentialHelper(smokeDir);
	const moduleBazel = [
		'module(name = "tinyland_registry_stage1_consumer_smoke", version = "0.0.0")',
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
			'--ignore_all_rc_files',
			'build',
			...targets,
			...credentialHelperArgs,
			'--enable_bzlmod',
			'--lockfile_mode=off',
			`--registry=file://${root}`,
			'--registry=https://bcr.bazel.build',
		],
		{
			cwd: smokeDir,
			encoding: 'utf8',
			stdio: 'inherit',
		},
	);

	if (result.error) {
		console.error('Failed to spawn bazel:', result.error.message);
		exitCode = 1;
	} else if (result.status !== 0) {
		exitCode = result.status ?? 1;
	}

	if (exitCode === 0) {
		console.log(`Built Stage 1 consumer targets: ${targets.join(', ')}`);
	}
} finally {
	fs.rmSync(smokeDir, { recursive: true, force: true });
}

process.exit(exitCode);
