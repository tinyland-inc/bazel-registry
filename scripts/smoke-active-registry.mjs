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
		.flatMap((moduleEntry) => {
			const moduleName = moduleEntry.name;
			const moduleDir = path.join(modulesDir, moduleName);
			return fs
				.readdirSync(moduleDir, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((versionEntry) => ({ moduleName, version: versionEntry.name }));
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

const smokeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyland-registry-smoke-'));
try {
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
