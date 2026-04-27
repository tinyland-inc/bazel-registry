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

const registry = readJson(registryPath);
const status = registry.status ?? 'active';
const moduleBasePath = registry.module_base_path ?? 'modules';
const modulesDir = path.join(root, moduleBasePath);

if (!fs.existsSync(modulesDir)) {
	fail(`module_base_path does not exist: ${moduleBasePath}`);
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
