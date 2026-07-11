import fs from 'node:fs';
import path from 'node:path';

const ASPECT_RULES_TS_EXTENSION = '@aspect_rules_ts//ts:extensions.bzl';

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function latestNonYankedVersion(metadata) {
	const versions = metadata.versions ?? [];
	const yankedVersions = metadata.yanked_versions ?? {};

	for (let index = versions.length - 1; index >= 0; index -= 1) {
		const version = versions[index];
		if (!Object.hasOwn(yankedVersions, version)) {
			return version;
		}
	}

	return undefined;
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripStarlarkComments(source) {
	let out = '';
	let quote;

	for (let index = 0; index < source.length; index += 1) {
		const character = source[index];

		if (quote) {
			out += character;
			if (character === '\\' && index + 1 < source.length) {
				index += 1;
				out += source[index];
			} else if (character === quote) {
				quote = undefined;
			}
			continue;
		}

		if (character === '"' || character === "'") {
			quote = character;
			out += character;
			continue;
		}
		if (character === '#') {
			while (index < source.length && source[index] !== '\n') {
				out += ' ';
				index += 1;
			}
			if (index < source.length) {
				out += source[index];
			}
			continue;
		}

		out += character;
	}

	return out;
}

function readCallBody(source, openParenthesis) {
	let depth = 1;
	let quote;

	for (let index = openParenthesis + 1; index < source.length; index += 1) {
		const character = source[index];

		if (quote) {
			if (character === '\\') {
				index += 1;
			} else if (character === quote) {
				quote = undefined;
			}
			continue;
		}

		if (character === '"' || character === "'") {
			quote = character;
			continue;
		}
		if (character === '#') {
			const newline = source.indexOf('\n', index + 1);
			if (newline === -1) {
				break;
			}
			index = newline;
			continue;
		}
		if (character === '(') {
			depth += 1;
		} else if (character === ')') {
			depth -= 1;
			if (depth === 0) {
				return {
					body: source.slice(openParenthesis + 1, index),
					end: index + 1,
				};
			}
		}
	}

	throw new Error('unterminated aspect_rules_ts extension deps() call');
}

function findAspectRulesTsRequests(moduleBazel, moduleVersion) {
	const parseableModuleBazel = stripStarlarkComments(moduleBazel);
	const extensionPattern =
		/\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*use_extension\s*\(\s*(["'])@aspect_rules_ts\/\/ts:extensions\.bzl\2\s*,\s*(["'])ext\3/g;
	const aliases = new Set();
	let extensionMatch;

	while ((extensionMatch = extensionPattern.exec(parseableModuleBazel)) !== null) {
		aliases.add(extensionMatch[1]);
	}

	const requests = [];
	for (const alias of aliases) {
		const depsPattern = new RegExp(`\\b${escapeRegExp(alias)}\\s*\\.\\s*deps\\s*\\(`, 'g');
		let depsMatch;

		while ((depsMatch = depsPattern.exec(parseableModuleBazel)) !== null) {
			const openParenthesis = parseableModuleBazel.indexOf('(', depsMatch.index);
			const call = readCallBody(parseableModuleBazel, openParenthesis);
			const assignment = call.body.match(/\bts_version\s*=/);
			const literal = call.body.match(/\bts_version\s*=\s*(["'])([^"'\\\r\n]+)\1/);

			if (!assignment || !literal) {
				throw new Error(
					`${moduleVersion} must declare ts_version as a string literal in ${alias}.deps()`,
				);
			}

			requests.push(literal[2]);
			depsPattern.lastIndex = call.end;
		}
	}

	return requests;
}

function formatConflict(requests) {
	const grouped = new Map();
	for (const request of requests) {
		const modules = grouped.get(request.tsVersion) ?? [];
		modules.push(`${request.moduleName}@${request.version}`);
		grouped.set(request.tsVersion, modules);
	}

	const lines = [
		'aspect_rules_ts extension ts_version mismatch across latest non-yanked module versions:',
	];
	for (const [tsVersion, modules] of [...grouped].sort(([left], [right]) =>
		left.localeCompare(right, undefined, { numeric: true }),
	)) {
		lines.push(`  ts_version ${tsVersion}:`);
		for (const moduleVersion of modules.sort()) {
			lines.push(`    - ${moduleVersion}`);
		}
	}
	lines.push(
		`All modules sharing ${ASPECT_RULES_TS_EXTENSION} must request one ts_version.`,
	);

	return lines.join('\n');
}

export function validateAspectRulesTsVersions({ modulesDir }) {
	const requests = [];
	const moduleEntries = fs
		.readdirSync(modulesDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.sort((left, right) => left.name.localeCompare(right.name));

	for (const moduleEntry of moduleEntries) {
		const moduleName = moduleEntry.name;
		const moduleDir = path.join(modulesDir, moduleName);
		const metadataPath = path.join(moduleDir, 'metadata.json');
		if (!fs.existsSync(metadataPath)) {
			continue;
		}

		const metadata = readJson(metadataPath);
		const version = latestNonYankedVersion(metadata);
		if (!version) {
			continue;
		}

		const moduleVersion = `${moduleName}@${version}`;
		const moduleBazelPath = path.join(moduleDir, version, 'MODULE.bazel');
		if (!fs.existsSync(moduleBazelPath)) {
			throw new Error(`${moduleVersion} is missing MODULE.bazel`);
		}

		const moduleBazel = fs.readFileSync(moduleBazelPath, 'utf8');
		for (const tsVersion of findAspectRulesTsRequests(moduleBazel, moduleVersion)) {
			requests.push({ moduleName, version, tsVersion });
		}
	}

	const tsVersions = new Set(requests.map((request) => request.tsVersion));
	if (tsVersions.size > 1) {
		throw new Error(formatConflict(requests));
	}

	return {
		requests,
		tsVersion: requests[0]?.tsVersion,
	};
}
