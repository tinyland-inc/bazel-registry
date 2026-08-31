import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const registryPath = path.join(root, 'bazel_registry.json');

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function listFiles(dir, fileName) {
	if (!fs.existsSync(dir)) {
		return [];
	}

	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const entryPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...listFiles(entryPath, fileName));
		} else if (entry.name === fileName) {
			out.push(entryPath);
		}
	}
	return out;
}

function fail(message) {
	console.error(message);
	process.exitCode = 1;
}

// Every module source must resolve to a GitHub release archive, never a
// package-registry host. This is a deliberate refusal, not an oversight: an
// npm-hosted tarball is mutable at the registry's discretion
// (unpublish/republish can change bytes behind the same URL/version), and a
// GitHub tag archive is the only distribution path this registry's publish
// convention has ever used (see README "Validation" and the immutability
// gate). Only two URL shapes are allowed, both already in production use
// across modules/:
//   1. https://github.com/<owner>/<repo>/archive/refs/tags/<tag>.tar.gz
//      -- public/private repos published as GitHub release tag archives.
//   2. https://api.github.com/repos/<owner>/<repo>/tarball/<ref>
//      -- private repos pulled through GitHub's authenticated API tarball
//         endpoint (see .github/workflows/validate.yml's token-scope check).
// Scope note: this rule constrains the HOST and the URL SHAPE only. It
// deliberately does not pin <owner>, so any GitHub account's tag archive
// satisfies it -- the bytes behind an accepted URL are pinned by the sha256
// SRI `integrity` check below, not by this rule. Add an owner allowlist here
// if provenance, rather than host, ever needs to be enforced too.
const ALLOWED_SOURCE_URL_PATTERNS = [
	/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/archive\/refs\/tags\/[^/]+\.tar\.gz$/,
	/^https:\/\/api\.github\.com\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/tarball\/[A-Za-z0-9._-]+$/,
];

// Named explicitly so a refusal reads as "this host is banned", not just
// "this host isn't on the allowlist" -- npm-registry hosts are the concrete
// threat this rule exists to catch.
const EXPLICITLY_REFUSED_SOURCE_HOSTS = new Set(['registry.npmjs.org', 'npm.pkg.github.com']);

function validateSourceUrlHost(url, relativePath) {
	if (!url) {
		fail(`${relativePath} is missing url`);
		return;
	}

	let hostname;
	try {
		hostname = new URL(url).hostname;
	} catch {
		fail(`${relativePath} url is not a valid absolute URL: ${url}`);
		return;
	}

	if (EXPLICITLY_REFUSED_SOURCE_HOSTS.has(hostname)) {
		fail(
			`${relativePath} url uses a refused package-registry host (${hostname}): ${url}. Module sources must be Tinyland-controlled GitHub archives, not npm registries.`,
		);
		return;
	}

	if (!ALLOWED_SOURCE_URL_PATTERNS.some((pattern) => pattern.test(url))) {
		fail(
			`${relativePath} url does not match an allowed source host/shape: ${url}. Expected a github.com release-tag archive or an api.github.com repos tarball URL.`,
		);
	}
}

const registry = readJson(registryPath);
const status = registry.status ?? 'active';
const moduleBasePath = registry.module_base_path ?? 'modules';
const modulesDir = path.join(root, moduleBasePath);

if (!fs.existsSync(modulesDir)) {
	fail(`module_base_path does not exist: ${moduleBasePath}`);
}

// .bazelversion is not read by any direct Bazel invocation at this repo's
// root (there is no MODULE.bazel/WORKSPACE/BUILD/.bazelrc here) -- it is
// only ever consumed by copy, into the smoke-test workspaces built by
// scripts/smoke-active-registry.mjs and scripts/smoke-stage1-consumer-targets.mjs
// (see docs/bazel-adoption-v0.md #1). That copy step makes a silent drift
// between .bazelversion and the estate-wide pin invisible to a bare `git
// diff`, so assert the file's content against the recorded pin in
// package.json's "bazelEstate.version" instead of trusting a smoke
// run (network + GitHub-token dependent, and not always run locally) to
// catch it.
const packageJsonPath = path.join(root, 'package.json');
const packageJson = readJson(packageJsonPath);
const expectedBazelVersion = packageJson.bazelEstate?.version;
const bazelVersionPath = path.join(root, '.bazelversion');
const actualBazelVersion = fs.existsSync(bazelVersionPath)
	? fs.readFileSync(bazelVersionPath, 'utf8').trim()
	: undefined;

if (!expectedBazelVersion) {
	fail('package.json bazelEstate.version is not set');
} else if (actualBazelVersion !== expectedBazelVersion) {
	fail(
		`.bazelversion (${actualBazelVersion ?? '<missing>'}) does not match package.json bazelEstate.version (${expectedBazelVersion}); the smoke-test workspaces copy .bazelversion verbatim, so this drift would be silent`,
	);
}

if (status === 'archived') {
	if (!moduleBasePath.startsWith('archive/')) {
		fail('archived registry status must use an archive/ module_base_path');
	}
} else if (status !== 'active') {
	fail(`unsupported registry status: ${status}`);
}

const sourceJsonFiles = listFiles(modulesDir, 'source.json');
if (sourceJsonFiles.length === 0) {
	fail(`no source.json files found under ${moduleBasePath}`);
}

for (const sourceJsonPath of sourceJsonFiles) {
	const relativePath = path.relative(root, sourceJsonPath);
	const source = readJson(sourceJsonPath);

	if (status !== 'active') {
		continue;
	}

	const versionDir = path.dirname(sourceJsonPath);
	const version = path.basename(versionDir);
	const moduleDir = path.dirname(versionDir);
	const moduleName = path.basename(moduleDir);
	const metadataPath = path.join(moduleDir, 'metadata.json');
	const moduleBazelPath = path.join(versionDir, 'MODULE.bazel');
	const metadata = fs.existsSync(metadataPath) ? readJson(metadataPath) : undefined;
	const moduleBazel = fs.existsSync(moduleBazelPath)
		? fs.readFileSync(moduleBazelPath, 'utf8')
		: undefined;

	if (!source.integrity) {
		fail(`${relativePath} has blank integrity`);
	}
	if (!source.integrity?.startsWith('sha256-')) {
		fail(`${relativePath} integrity must use sha256 SRI format`);
	}
	if (source.url?.includes('tinyland.dev/archive/refs/tags')) {
		fail(`${relativePath} still points at a tinyland.dev tarball`);
	}
	if (source.strip_prefix?.includes('tinyland.dev-')) {
		fail(`${relativePath} strip_prefix still references tinyland.dev`);
	}
	validateSourceUrlHost(source.url, relativePath);
	if (!metadata) {
		fail(`${relativePath} is missing sibling metadata.json`);
		continue;
	}
	if (!metadata.homepage || metadata.homepage.includes('tinyland.dev/tree/main/packages')) {
		fail(`${relativePath} metadata homepage does not point at standalone authority`);
	}
	if (!metadata.versions?.includes(version)) {
		fail(`${relativePath} metadata versions does not include ${version}`);
	}
	if (!moduleBazel) {
		fail(`${relativePath} is missing sibling MODULE.bazel`);
		continue;
	}
	if (
		!new RegExp(`module\\([\\s\\S]*?name = "${moduleName}"[\\s\\S]*?version = "${version}"`).test(
			moduleBazel,
		)
	) {
		fail(`${relativePath} MODULE.bazel does not declare ${moduleName}@${version}`);
	}
}

if (process.exitCode) {
	process.exit();
}

console.log(
	`Validated ${sourceJsonFiles.length} source entries for ${status} registry at ${moduleBasePath}`,
);
