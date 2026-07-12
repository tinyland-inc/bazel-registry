import fs from 'node:fs';
import path from 'node:path';

const ASPECT_RULES_TS_EXTENSION = '@aspect_rules_ts//ts:extensions.bzl';
const DEFAULT_TYPESCRIPT_REPOSITORY = 'npm_typescript';
const MAX_UNSIGNED_LONG = (1n << 64n) - 1n;
const VERSION_PATTERN =
	/^(?<release>[a-zA-Z0-9.]+)(?:-(?<prerelease>[a-zA-Z0-9.-]+))?(?:\+[a-zA-Z0-9.-]+)?$/;
const OPENING_DELIMITERS = new Map([
	['(', ')'],
	['[', ']'],
	['{', '}'],
]);
const CLOSING_DELIMITERS = new Set(OPENING_DELIMITERS.values());

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function compareText(left, right) {
	if (left === right) {
		return 0;
	}
	return left < right ? -1 : 1;
}

// Match Bazel's Version.java ordering, including relaxed release identifiers and ignored build data.
function parseIdentifier(identifier, version) {
	if (!identifier) {
		throw new Error(`invalid Bazel module version ${JSON.stringify(version)}: identifier is empty`);
	}

	if (/^\d+$/.test(identifier)) {
		const number = BigInt(identifier);
		if (number > MAX_UNSIGNED_LONG) {
			throw new Error(
				`invalid Bazel module version ${JSON.stringify(version)}: numeric segment is too large: ${identifier}`,
			);
		}
		return { identifier, isNumeric: true, number };
	}

	return { identifier, isNumeric: false, number: 0n };
}

function parseBazelVersion(version) {
	if (version === '') {
		return { empty: true, normalized: '', prerelease: [], release: [] };
	}
	if (typeof version !== 'string') {
		throw new Error(`invalid Bazel module version: expected string, got ${typeof version}`);
	}

	const match = VERSION_PATTERN.exec(version);
	if (!match?.groups) {
		throw new Error(
			`invalid Bazel module version ${JSON.stringify(version)}: expected RELEASE[-PRERELEASE][+BUILD]`,
		);
	}

	const release = match.groups.release
		.split('.')
		.map((identifier) => parseIdentifier(identifier, version));
	const prerelease = match.groups.prerelease
		? match.groups.prerelease
				.split('.')
				.map((identifier) => parseIdentifier(identifier, version))
		: [];
	const normalized = prerelease.length
		? `${match.groups.release}-${match.groups.prerelease}`
		: match.groups.release;

	return { empty: false, normalized, prerelease, release };
}

function compareIdentifiers(left, right) {
	if (left.isNumeric !== right.isNumeric) {
		return left.isNumeric ? -1 : 1;
	}
	if (left.number !== right.number) {
		return left.number < right.number ? -1 : 1;
	}
	return compareText(left.identifier, right.identifier);
}

function compareIdentifierLists(left, right) {
	const sharedLength = Math.min(left.length, right.length);
	for (let index = 0; index < sharedLength; index += 1) {
		const comparison = compareIdentifiers(left[index], right[index]);
		if (comparison !== 0) {
			return comparison;
		}
	}
	return left.length - right.length;
}

export function compareBazelVersions(leftVersion, rightVersion) {
	const left = parseBazelVersion(leftVersion);
	const right = parseBazelVersion(rightVersion);

	if (left.empty !== right.empty) {
		return left.empty ? 1 : -1;
	}

	const releaseComparison = compareIdentifierLists(left.release, right.release);
	if (releaseComparison !== 0) {
		return releaseComparison;
	}

	const leftIsPrerelease = left.prerelease.length > 0;
	const rightIsPrerelease = right.prerelease.length > 0;
	if (leftIsPrerelease !== rightIsPrerelease) {
		return leftIsPrerelease ? -1 : 1;
	}

	return compareIdentifierLists(left.prerelease, right.prerelease);
}

function greatestNonYankedVersion(metadata, metadataContext) {
	const versions = metadata.versions ?? [];
	const yankedVersions = metadata.yanked_versions ?? {};

	if (!Array.isArray(versions) || versions.some((version) => typeof version !== 'string')) {
		throw new Error(`${metadataContext}: versions must be an array of strings`);
	}
	if (
		typeof yankedVersions !== 'object' ||
		yankedVersions === null ||
		Array.isArray(yankedVersions)
	) {
		throw new Error(`${metadataContext}: yanked_versions must be an object`);
	}

	let latest;
	for (const version of versions) {
		let parsed;
		try {
			parsed = parseBazelVersion(version);
		} catch (error) {
			throw new Error(
				`${metadataContext}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		if (Object.hasOwn(yankedVersions, version)) {
			continue;
		}
		if (!latest) {
			latest = { parsed, version };
			continue;
		}

		const comparison = compareBazelVersions(version, latest.version);
		if (comparison > 0) {
			latest = { parsed, version };
		} else if (comparison === 0 && parsed.normalized === latest.parsed.normalized) {
			throw new Error(
				`${metadataContext}: ${JSON.stringify(version)} and ${JSON.stringify(latest.version)} compare equal under Bazel version semantics`,
			);
		}
	}

	return latest?.version;
}

function sourceLocation(source, offset) {
	let line = 1;
	let column = 1;
	for (let index = 0; index < offset; index += 1) {
		if (source[index] === '\n') {
			line += 1;
			column = 1;
		} else {
			column += 1;
		}
	}
	return { column, line };
}

function diagnostic(context, source, offset, message) {
	const { column, line } = sourceLocation(source, offset);
	return new Error(`${context}:${line}:${column}: ${message}`);
}

function readStringToken(source, start, context) {
	const raw = (source[start] === 'r' || source[start] === 'R') && /["']/.test(source[start + 1]);
	const quoteOffset = raw ? start + 1 : start;
	const quote = source[quoteOffset];
	const triple = source.slice(quoteOffset, quoteOffset + 3) === quote.repeat(3);
	const delimiterLength = triple ? 3 : 1;
	const contentStart = quoteOffset + delimiterLength;
	let cursor = contentStart;

	while (cursor < source.length) {
		if (source[cursor] === '\\' && cursor + 1 < source.length) {
			cursor += 2;
			continue;
		}
		if (triple && source.slice(cursor, cursor + 3) === quote.repeat(3)) {
			const content = source.slice(contentStart, cursor);
			return {
				canonicalValue: raw || !content.includes('\\') ? content : undefined,
				end: cursor + 3,
				start,
				type: 'string',
			};
		}
		if (!triple && source[cursor] === quote) {
			const content = source.slice(contentStart, cursor);
			return {
				canonicalValue: raw || !content.includes('\\') ? content : undefined,
				end: cursor + 1,
				start,
				type: 'string',
			};
		}
		if (!triple && source[cursor] === '\n') {
			throw diagnostic(context, source, start, 'unterminated string literal');
		}
		cursor += 1;
	}

	throw diagnostic(context, source, start, 'unterminated string literal');
}

function tokenizeStarlark(source, context) {
	const tokens = [];
	let index = 0;

	while (index < source.length) {
		const character = source[index];
		if (character === ' ' || character === '\t' || character === '\r') {
			index += 1;
			continue;
		}
		if (character === '\n') {
			tokens.push({ end: index + 1, start: index, type: 'newline', value: '\n' });
			index += 1;
			continue;
		}
		if (character === '#') {
			while (index < source.length && source[index] !== '\n') {
				index += 1;
			}
			continue;
		}
		if (
			character === '"' ||
			character === "'" ||
			((character === 'r' || character === 'R') && /["']/.test(source[index + 1]))
		) {
			const token = readStringToken(source, index, context);
			tokens.push(token);
			index = token.end;
			continue;
		}
		if (/[A-Za-z_]/.test(character)) {
			let end = index + 1;
			while (end < source.length && /[A-Za-z0-9_]/.test(source[end])) {
				end += 1;
			}
			tokens.push({ end, start: index, type: 'identifier', value: source.slice(index, end) });
			index = end;
			continue;
		}

		tokens.push({ end: index + 1, start: index, type: 'punctuation', value: character });
		index += 1;
	}

	return tokens;
}

function splitStatements(tokens, source, context) {
	const statements = [];
	let current = [];
	const delimiters = [];

	const flush = () => {
		if (current.length) {
			statements.push(current);
			current = [];
		}
	};

	for (const token of tokens) {
		if (token.type === 'newline' && delimiters.length === 0) {
			flush();
			continue;
		}
		if (token.value === ';' && delimiters.length === 0) {
			flush();
			continue;
		}
		if (token.type === 'newline') {
			continue;
		}
		if (OPENING_DELIMITERS.has(token.value)) {
			delimiters.push(token);
		} else if (CLOSING_DELIMITERS.has(token.value)) {
			const opening = delimiters.pop();
			if (!opening || OPENING_DELIMITERS.get(opening.value) !== token.value) {
				throw diagnostic(context, source, token.start, `unexpected ${token.value}`);
			}
		}
		current.push(token);
	}

	if (delimiters.length) {
		const opening = delimiters.at(-1);
		throw diagnostic(
			context,
			source,
			opening.start,
			`unterminated ${opening.value}; expected ${OPENING_DELIMITERS.get(opening.value)}`,
		);
	}
	flush();
	return statements;
}

function matchingDelimiterIndex(tokens, openIndex, source, context) {
	const opening = tokens[openIndex];
	const expected = OPENING_DELIMITERS.get(opening?.value);
	if (!expected) {
		throw diagnostic(context, source, opening?.start ?? 0, 'expected opening delimiter');
	}

	const stack = [opening];
	for (let index = openIndex + 1; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (OPENING_DELIMITERS.has(token.value)) {
			stack.push(token);
		} else if (CLOSING_DELIMITERS.has(token.value)) {
			const nestedOpening = stack.pop();
			if (OPENING_DELIMITERS.get(nestedOpening.value) !== token.value) {
				throw diagnostic(context, source, token.start, `unexpected ${token.value}`);
			}
			if (stack.length === 0) {
				return index;
			}
		}
	}

	throw diagnostic(context, source, opening.start, `unterminated ${opening.value}; expected ${expected}`);
}

function splitCallArguments(tokens, openIndex, closeIndex, source, context) {
	const args = [];
	let current = [];
	const delimiters = [];

	for (let index = openIndex + 1; index < closeIndex; index += 1) {
		const token = tokens[index];
		if (OPENING_DELIMITERS.has(token.value)) {
			delimiters.push(token);
		} else if (CLOSING_DELIMITERS.has(token.value)) {
			delimiters.pop();
		}
		if (token.value === ',' && delimiters.length === 0) {
			if (!current.length) {
				throw diagnostic(context, source, token.start, 'empty call argument');
			}
			args.push(current);
			current = [];
			continue;
		}
		current.push(token);
	}
	if (current.length) {
		args.push(current);
	}

	return args;
}

function stripWrappingParentheses(tokens, source, context) {
	let expression = tokens;
	while (expression[0]?.value === '(') {
		const closeIndex = matchingDelimiterIndex(expression, 0, source, context);
		if (closeIndex !== expression.length - 1) {
			break;
		}
		expression = expression.slice(1, -1);
	}
	return expression;
}

function topLevelEqualsIndex(tokens) {
	const delimiters = [];
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (OPENING_DELIMITERS.has(token.value)) {
			delimiters.push(token);
		} else if (CLOSING_DELIMITERS.has(token.value)) {
			delimiters.pop();
		} else if (token.value === '=' && delimiters.length === 0) {
			return index;
		}
	}
	return -1;
}

function parseArgument(tokens) {
	const equalsIndex = topLevelEqualsIndex(tokens);
	if (equalsIndex === -1) {
		return { expression: tokens, name: undefined };
	}
	if (equalsIndex !== 1 || tokens[0]?.type !== 'identifier') {
		return { expression: tokens, name: undefined };
	}
	return { expression: tokens.slice(2), name: tokens[0].value };
}

function resolveStringExpression(tokens, bindings, source, context) {
	const expression = stripWrappingParentheses(tokens, source, context);
	if (expression.length !== 1) {
		return undefined;
	}
	const token = expression[0];
	if (token.type === 'string') {
		return token.canonicalValue === undefined
			? undefined
			: { token, value: token.canonicalValue };
	}
	if (token.type === 'identifier') {
		const binding = bindings.get(token.value);
		return binding?.kind === 'string' ? { token, value: binding.value } : undefined;
	}
	return undefined;
}

function resolveBooleanExpression(tokens, source, context) {
	const expression = stripWrappingParentheses(tokens, source, context);
	if (expression.length !== 1 || expression[0].type !== 'identifier') {
		return undefined;
	}
	if (expression[0].value === 'True') {
		return true;
	}
	if (expression[0].value === 'False') {
		return false;
	}
	return undefined;
}

function normalizeLabelPath(label, source, context, token) {
	let repository = '';
	let remainder;

	if (label.startsWith(':')) {
		remainder = label;
	} else {
		const separator = label.indexOf('//');
		if (separator === -1) {
			throw diagnostic(
				context,
				source,
				token.start,
				'ts_version_from must use an absolute or root-relative canonical label',
			);
		}
		repository = label.slice(0, separator);
		remainder = label.slice(separator + 2);
		if (repository && repository !== '@' && !/^@@?[A-Za-z0-9._+~-]+$/.test(repository)) {
			throw diagnostic(context, source, token.start, `unsupported label repository ${repository}`);
		}
	}

	let packagePath = '';
	let target;
	if (remainder.startsWith(':')) {
		target = remainder.slice(1);
	} else {
		const colon = remainder.indexOf(':');
		if (colon === -1) {
			packagePath = remainder;
			target = packagePath.split('/').at(-1);
		} else {
			if (remainder.indexOf(':', colon + 1) !== -1) {
				throw diagnostic(context, source, token.start, 'ts_version_from label has multiple colons');
			}
			packagePath = remainder.slice(0, colon);
			target = remainder.slice(colon + 1);
		}
	}

	if (
		!target ||
		packagePath.startsWith('/') ||
		packagePath.endsWith('/') ||
		packagePath.split('/').some((segment) => segment === '.' || segment === '..')
	) {
		throw diagnostic(context, source, token.start, `unsupported canonical label ${JSON.stringify(label)}`);
	}

	return { normalizedPath: `//${packagePath}:${target}`, repository };
}

function resolveLabelExpression(
	tokens,
	bindings,
	repositoryMappings,
	moduleVersion,
	source,
	context,
) {
	const expression = stripWrappingParentheses(tokens, source, context);
	if (
		expression.length === 1 &&
		expression[0].type === 'identifier' &&
		expression[0].value === 'None'
	) {
		return { display: undefined, identity: undefined, token: expression[0] };
	}

	const resolved = resolveStringExpression(expression, bindings, source, context);
	if (!resolved) {
		return undefined;
	}
	const { normalizedPath, repository } = normalizeLabelPath(
		resolved.value,
		source,
		context,
		resolved.token,
	);

	let repositoryIdentity;
	if (!repository) {
		repositoryIdentity = `module:${moduleVersion}`;
	} else if (repository === '@') {
		throw diagnostic(
			context,
			source,
			resolved.token.start,
			'ts_version_from @// labels are ambiguous outside the root module; use a local // label or exact @@ canonical label',
		);
	} else if (repository.startsWith('@@')) {
		repositoryIdentity = `canonical:${repository.slice(2)}`;
	} else {
		const apparentName = repository.slice(1);
		const mappedModule = repositoryMappings.get(apparentName);
		if (!mappedModule) {
			throw diagnostic(
				context,
				source,
				resolved.token.start,
				`cannot resolve ts_version_from repository @${apparentName}; declare its bazel_dep() before the tag`,
			);
		}
		throw diagnostic(
			context,
			source,
			resolved.token.start,
			`ts_version_from apparent repository @${apparentName} is ambiguous under Bzlmod version selection; use a local // label or exact @@ canonical label`,
		);
	}

	return {
		display: resolved.value,
		identity: `${repositoryIdentity}${normalizedPath}`,
		token: resolved.token,
	};
}

function parseDirectCall(tokens, calleeIndex, source, context) {
	if (tokens[calleeIndex + 1]?.value !== '(') {
		return undefined;
	}
	const closeIndex = matchingDelimiterIndex(tokens, calleeIndex + 1, source, context);
	return {
		args: splitCallArguments(tokens, calleeIndex + 1, closeIndex, source, context),
		closeIndex,
	};
}

function parseBazelDep(statement, bindings, repositoryMappings, source, context) {
	const call = parseDirectCall(statement, 0, source, context);
	if (!call || call.closeIndex !== statement.length - 1) {
		throw diagnostic(context, source, statement[0].start, 'bazel_dep() must be a direct call');
	}

	let moduleName;
	let repoName;
	let repoNameSpecified = false;
	for (const rawArg of call.args) {
		const arg = parseArgument(rawArg);
		if (!arg.name) {
			throw diagnostic(
				context,
				source,
				rawArg[0]?.start ?? statement[0].start,
				'bazel_dep() arguments must be named',
			);
		}
		if (arg.name === 'name') {
			if (moduleName) {
				throw diagnostic(context, source, rawArg[0].start, 'duplicate bazel_dep() name');
			}
			moduleName = resolveStringExpression(arg.expression, bindings, source, context);
			if (!moduleName) {
				throw diagnostic(
					context,
					source,
					arg.expression[0]?.start ?? rawArg[0].start,
					'bazel_dep() name must be a canonical string literal or simple string constant',
				);
			}
		} else if (arg.name === 'repo_name') {
			if (repoNameSpecified) {
				throw diagnostic(context, source, rawArg[0].start, 'duplicate bazel_dep() repo_name');
			}
			repoNameSpecified = true;
			const expression = stripWrappingParentheses(arg.expression, source, context);
			if (
				expression.length === 1 &&
				expression[0].type === 'identifier' &&
				expression[0].value === 'None'
			) {
				repoName = undefined;
			} else {
				repoName = resolveStringExpression(arg.expression, bindings, source, context);
				if (!repoName) {
					throw diagnostic(
						context,
						source,
						arg.expression[0]?.start ?? rawArg[0].start,
						'bazel_dep() repo_name must be None, a canonical string literal, or a simple string constant',
					);
				}
			}
		}
	}

	if (!moduleName) {
		throw diagnostic(context, source, statement[0].start, 'bazel_dep() must declare name');
	}
	if (repoNameSpecified && repoName === undefined) {
		return;
	}

	const apparentName = repoName?.value || moduleName.value;
	const existingModule = repositoryMappings.get(apparentName);
	if (existingModule && existingModule !== moduleName.value) {
		throw diagnostic(
			context,
			source,
			statement[0].start,
			`apparent repository @${apparentName} maps to both ${existingModule} and ${moduleName.value}`,
		);
	}
	repositoryMappings.set(apparentName, moduleName.value);
}

function isAspectRulesTsExtensionLabel(label, repositoryMappings, source, context, token) {
	const canonical = /^@@([^/]+)\/\/ts:extensions\.bzl$/.exec(label);
	if (canonical) {
		const repository = canonical[1];
		if (repository === 'aspect_rules_ts+') {
			return true;
		}
		const legacyVersion = /^aspect_rules_ts~(.+)$/.exec(repository)?.[1];
		if (legacyVersion) {
			try {
				parseBazelVersion(legacyVersion);
				return true;
			} catch {
				// Fall through to the fail-closed diagnostic below.
			}
		}
		if (repository.startsWith('aspect_rules_ts')) {
			throw diagnostic(
				context,
				source,
				token.start,
				`unsupported aspect_rules_ts canonical repository ${repository}; update the guard for this Bazel naming scheme`,
			);
		}
		return false;
	}

	const apparent = /^@([^@/]+)\/\/ts:extensions\.bzl$/.exec(label);
	if (!apparent) {
		return false;
	}
	const moduleName = repositoryMappings.get(apparent[1]);
	if (!moduleName) {
		throw diagnostic(
			context,
			source,
			token.start,
			`cannot resolve apparent repository @${apparent[1]}; declare its canonical bazel_dep() before use_extension()`,
		);
	}
	return moduleName === 'aspect_rules_ts';
}

function parseUseExtension(rhs, bindings, repositoryMappings, source, context) {
	const call = parseDirectCall(rhs, 0, source, context);
	if (!call || call.closeIndex !== rhs.length - 1) {
		throw diagnostic(
			context,
			source,
			rhs[0]?.start ?? 0,
			'use_extension() must be a direct canonical assignment',
		);
	}
	if (call.args.length < 2) {
		throw diagnostic(context, source, rhs[0].start, 'use_extension() requires label and name');
	}

	const labelArg = parseArgument(call.args[0]);
	const nameArg = parseArgument(call.args[1]);
	if (labelArg.name || nameArg.name) {
		throw diagnostic(
			context,
			source,
			rhs[0].start,
			'use_extension() label and name must be positional arguments',
		);
	}
	const label = resolveStringExpression(labelArg.expression, bindings, source, context);
	if (!label) {
		throw diagnostic(
			context,
			source,
			call.args[0][0]?.start ?? rhs[0].start,
			'use_extension() label must be a canonical string literal or simple string constant; dynamic expressions are unsupported',
		);
	}
	const targetLabel = isAspectRulesTsExtensionLabel(
		label.value,
		repositoryMappings,
		source,
		context,
		label.token,
	);
	if (!targetLabel) {
		return {
			devDependency: false,
			extensionName: undefined,
			isolate: false,
			kind: 'extension',
			label: label.value,
			requests: [],
			target: false,
			token: rhs[0],
		};
	}

	const extensionName = resolveStringExpression(nameArg.expression, bindings, source, context);
	if (!extensionName) {
		throw diagnostic(
			context,
			source,
			call.args[1][0]?.start ?? rhs[0].start,
			'use_extension() name must be a canonical string literal or simple string constant',
		);
	}
	if (extensionName.value !== 'ext') {
		return {
			devDependency: false,
			extensionName: extensionName.value,
			isolate: false,
			kind: 'extension',
			label: label.value,
			requests: [],
			target: false,
			token: rhs[0],
		};
	}

	let devDependency = false;
	let isolate = false;
	const seenOptions = new Set();
	for (const rawArg of call.args.slice(2)) {
		const arg = parseArgument(rawArg);
		if (!arg.name) {
			throw diagnostic(
				context,
				source,
				rawArg[0]?.start ?? rhs[0].start,
				'use_extension() optional arguments must be named',
			);
		}
		if (arg.name !== 'dev_dependency' && arg.name !== 'isolate') {
			throw diagnostic(
				context,
				source,
				rawArg[0].start,
				`unsupported use_extension() argument ${arg.name}; update the guard before using new extension semantics`,
			);
		}
		if (seenOptions.has(arg.name)) {
			throw diagnostic(
				context,
				source,
				rawArg[0].start,
				`duplicate use_extension() argument ${arg.name}`,
			);
		}
		seenOptions.add(arg.name);
		const value = resolveBooleanExpression(arg.expression, source, context);
		if (value === undefined) {
			throw diagnostic(
				context,
				source,
				arg.expression[0]?.start ?? rawArg[0].start,
				`${arg.name} must be the literal True or False`,
			);
		}
		if (arg.name === 'dev_dependency') {
			devDependency = value;
		} else {
			isolate = value;
		}
	}

	return {
		devDependency,
		extensionName: extensionName.value,
		isolate,
		kind: 'extension',
		label: label.value,
		requests: [],
		target: true,
		token: rhs[0],
	};
}

function parseAspectDeps(
	statement,
	extension,
	bindings,
	repositoryMappings,
	moduleVersion,
	source,
	context,
) {
	const call = parseDirectCall(statement, 2, source, context);
	if (!call || call.closeIndex !== statement.length - 1) {
		throw diagnostic(
			context,
			source,
			statement[0].start,
			'aspect_rules_ts deps() must be a direct canonical call',
		);
	}

	const values = {
		name: DEFAULT_TYPESCRIPT_REPOSITORY,
		tsIntegrity: '',
		tsVersion: '',
		tsVersionFrom: { display: undefined, identity: undefined },
	};
	const seenArguments = new Set();
	for (const rawArg of call.args) {
		const arg = parseArgument(rawArg);
		if (!arg.name) {
			throw diagnostic(
				context,
				source,
				rawArg[0]?.start ?? statement[0].start,
				'aspect_rules_ts deps() arguments must be named',
			);
		}
		if (!['name', 'ts_integrity', 'ts_version', 'ts_version_from'].includes(arg.name)) {
			throw diagnostic(
				context,
				source,
				rawArg[0].start,
				`unsupported aspect_rules_ts deps() argument ${arg.name}; update the guard for the new tag schema`,
			);
		}
		if (seenArguments.has(arg.name)) {
			throw diagnostic(context, source, rawArg[0].start, `duplicate ${arg.name} argument`);
		}
		seenArguments.add(arg.name);

		if (arg.name === 'ts_version_from') {
			const label = resolveLabelExpression(
				arg.expression,
				bindings,
				repositoryMappings,
				moduleVersion,
				source,
				context,
			);
			if (!label) {
				throw diagnostic(
					context,
					source,
					arg.expression[0]?.start ?? rawArg[0].start,
					'ts_version_from must be None, a canonical label string, or a simple string constant',
				);
			}
			values.tsVersionFrom = label;
			continue;
		}

		const value = resolveStringExpression(arg.expression, bindings, source, context);
		if (!value) {
			throw diagnostic(
				context,
				source,
				arg.expression[0]?.start ?? rawArg[0].start,
				`${arg.name} must be a canonical string literal or simple string constant`,
			);
		}
		if (arg.name === 'name') {
			values.name = value.value;
		} else if (arg.name === 'ts_integrity') {
			values.tsIntegrity = value.value;
		} else {
			values.tsVersion = value.value;
		}
	}

	const location = sourceLocation(source, statement[0].start);
	extension.requests.push({
		column: location.column,
		line: location.line,
		name: values.name,
		tsIntegrity: values.tsIntegrity,
		tsVersion: values.tsVersion,
		tsVersionFrom: values.tsVersionFrom.display,
		tsVersionFromIdentity: values.tsVersionFrom.identity,
	});
}

function findAspectExtensionReferences(statement, bindings) {
	const references = [];
	for (let index = 0; index < statement.length; index += 1) {
		const token = statement[index];
		if (token.type !== 'identifier') {
			continue;
		}
		const extension = bindings.get(token.value);
		if (extension?.kind === 'extension' && extension.target) {
			references.push({ extension, index, token });
		}
	}
	return references;
}

function directAspectDepsReference(statement, references, source, context) {
	if (
		references.length !== 1 ||
		references[0].index !== 0 ||
		statement[1]?.value !== '.' ||
		statement[2]?.value !== 'deps' ||
		statement[3]?.value !== '('
	) {
		return undefined;
	}
	const call = parseDirectCall(statement, 2, source, context);
	return call?.closeIndex === statement.length - 1 ? references[0] : undefined;
}

function isSimpleExtensionAliasAssignment(statement, references, source, context) {
	if (
		references.length !== 1 ||
		statement[0]?.type !== 'identifier' ||
		statement[1]?.value !== '='
	) {
		return false;
	}
	const expression = stripWrappingParentheses(statement.slice(2), source, context);
	return expression.length === 1 && expression[0] === references[0].token;
}

function isDirectRepositoryManagementCall(statement, references, source, context) {
	if (
		references.length !== 1 ||
		!['inject_repo', 'override_repo', 'use_repo'].includes(statement[0]?.value)
	) {
		return false;
	}
	const call = parseDirectCall(statement, 0, source, context);
	if (!call || call.closeIndex !== statement.length - 1 || call.args.length === 0) {
		return false;
	}
	const proxyArgument = parseArgument(call.args[0]);
	const expression = stripWrappingParentheses(proxyArgument.expression, source, context);
	return !proxyArgument.name && expression.length === 1 && expression[0] === references[0].token;
}

function findAspectRulesTsRequests(moduleBazel, moduleVersion) {
	// This deliberately supports canonical MODULE syntax instead of evaluating Starlark.
	// Dynamic extension semantics are rejected with a source location rather than guessed.
	const context = `${moduleVersion}/MODULE.bazel`;
	const tokens = tokenizeStarlark(moduleBazel, context);
	const statements = splitStatements(tokens, moduleBazel, context);
	const bindings = new Map();
	const repositoryMappings = new Map();
	const aspectUsages = [];

	for (const statement of statements) {
		const includeToken = statement.find(
			(token) => token.type === 'identifier' && token.value === 'include',
		);
		if (includeToken) {
			throw diagnostic(
				context,
				moduleBazel,
				includeToken.start,
				'include() fragments are unsupported because they may conceal extension tags',
			);
		}
		if (statement[0]?.value === 'bazel_dep' && statement[1]?.value === '(') {
			parseBazelDep(statement, bindings, repositoryMappings, moduleBazel, context);
			continue;
		}

		const equalsIndex = topLevelEqualsIndex(statement);
		const assignment =
			equalsIndex === 1 &&
			statement[0]?.type === 'identifier' &&
			statement[2]?.value !== '=';
		if (equalsIndex !== -1 && !assignment) {
			throw diagnostic(
				context,
				moduleBazel,
				statement[equalsIndex].start,
				'unsupported top-level assignment form; use one identifier and a direct = assignment',
			);
		}
		const extensionReferences = findAspectExtensionReferences(statement, bindings);
		if (extensionReferences.length) {
			const depsReference = directAspectDepsReference(
				statement,
				extensionReferences,
				moduleBazel,
				context,
			);
			if (depsReference) {
				if (depsReference.extension.devDependency || depsReference.extension.isolate) {
					continue;
				}
				parseAspectDeps(
					statement,
					depsReference.extension,
					bindings,
					repositoryMappings,
					moduleVersion,
					moduleBazel,
					context,
				);
				continue;
			}
			if (
				isSimpleExtensionAliasAssignment(
					statement,
					extensionReferences,
					moduleBazel,
					context,
				)
			) {
				// The generic assignment path below preserves the proxy identity.
			} else if (
				isDirectRepositoryManagementCall(
					statement,
					extensionReferences,
					moduleBazel,
					context,
				)
			) {
				continue;
			} else {
			throw diagnostic(
				context,
				moduleBazel,
				extensionReferences[0].token.start,
				'unsupported aspect_rules_ts extension proxy use; use a direct proxy.deps(...) call',
			);
			}
		}

		if (assignment) {
			const name = statement[0].value;
			const rhs = statement.slice(2);
			if (rhs[0]?.value === 'use_extension') {
				const extension = parseUseExtension(
					rhs,
					bindings,
					repositoryMappings,
					moduleBazel,
					context,
				);
				bindings.set(name, extension);
				if (
					extension.target &&
					!extension.devDependency &&
					!extension.isolate
				) {
					aspectUsages.push(extension);
				}
				continue;
			}

			const nestedUseExtension = rhs.find((token) => token.value === 'use_extension');
			if (nestedUseExtension) {
				throw diagnostic(
					context,
					moduleBazel,
					nestedUseExtension.start,
					'use_extension may not be aliased or embedded in another expression',
				);
			}

			const expression = stripWrappingParentheses(rhs, moduleBazel, context);
			if (expression.length === 1 && expression[0].type === 'string') {
				bindings.set(
					name,
					expression[0].canonicalValue === undefined
						? { kind: 'unknown' }
						: { kind: 'string', value: expression[0].canonicalValue },
				);
			} else if (expression.length === 1 && expression[0].type === 'identifier') {
				bindings.set(name, bindings.get(expression[0].value) ?? { kind: 'unknown' });
			} else {
				bindings.set(name, { kind: 'unknown' });
			}
			continue;
		}

		const useExtension = statement.find((token) => token.value === 'use_extension');
		if (useExtension) {
			throw diagnostic(
				context,
				moduleBazel,
				useExtension.start,
				'use_extension() must be assigned directly to an identifier',
			);
		}

	}

	for (const usage of aspectUsages) {
		if (usage.requests.length === 0) {
			throw diagnostic(
				context,
				moduleBazel,
				usage.token.start,
				'aspect_rules_ts extension usage must declare at least one direct deps(...) tag',
			);
		}
	}

	return aspectUsages.flatMap((usage) => usage.requests);
}

function requestIdentityKey(request) {
	return JSON.stringify([
		request.tsVersion,
		request.tsVersionFromIdentity ?? null,
		request.tsIntegrity,
	]);
}

function findConflictingRequests(requests) {
	const byName = new Map();
	for (const request of requests) {
		const identities = byName.get(request.name) ?? new Map();
		const key = requestIdentityKey(request);
		const matchingRequests = identities.get(key) ?? [];
		matchingRequests.push(request);
		identities.set(key, matchingRequests);
		byName.set(request.name, identities);
	}
	return [...byName]
		.filter(([, identities]) => identities.size > 1)
		.sort(([left], [right]) => left.localeCompare(right));
}

function formatRequestIdentity(request) {
	const versionFrom = request.tsVersionFrom === undefined
		? '(not set)'
		: `${JSON.stringify(request.tsVersionFrom)} [${request.tsVersionFromIdentity}]`;
	return [
		`ts_version=${JSON.stringify(request.tsVersion)}`,
		`ts_version_from=${versionFrom}`,
		`ts_integrity=${JSON.stringify(request.tsIntegrity)}`,
	].join(', ');
}

function formatConflict(conflicts) {
	const lines = [
		'aspect_rules_ts deps tag mismatch across greatest non-yanked module versions:',
	];
	for (const [name, identities] of conflicts) {
		lines.push(`  name ${JSON.stringify(name)}:`);
		for (const matchingRequests of identities.values()) {
			const [representative] = matchingRequests;
			lines.push(`    ${formatRequestIdentity(representative)}:`);
			for (const request of matchingRequests.sort((left, right) =>
				`${left.moduleName}@${left.version}`.localeCompare(`${right.moduleName}@${right.version}`),
			)) {
				lines.push(
					`      - ${request.moduleName}@${request.version}/MODULE.bazel:${request.line}:${request.column}`,
				);
			}
		}
	}
	lines.push(
		`Non-root tags sharing a name in ${ASPECT_RULES_TS_EXTENSION} must match ts_version, ts_version_from, and ts_integrity.`,
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
			throw new Error(`${moduleName}/metadata.json is missing`);
		}

		const metadata = readJson(metadataPath);
		const version = greatestNonYankedVersion(metadata, `${moduleName}/metadata.json`);
		if (!version) {
			continue;
		}

		const moduleVersion = `${moduleName}@${version}`;
		const moduleBazelPath = path.join(moduleDir, version, 'MODULE.bazel');
		if (!fs.existsSync(moduleBazelPath)) {
			throw new Error(`${moduleVersion} is missing MODULE.bazel`);
		}

		const moduleBazel = fs.readFileSync(moduleBazelPath, 'utf8');
		for (const request of findAspectRulesTsRequests(moduleBazel, moduleVersion)) {
			requests.push({ moduleName, version, ...request });
		}
	}

	const conflicts = findConflictingRequests(requests);
	if (conflicts.length) {
		throw new Error(formatConflict(conflicts));
	}
	const tsVersions = new Set(requests.map((request) => request.tsVersion));
	const tagNames = new Set(requests.map((request) => request.name));

	return {
		requests,
		tagNames: [...tagNames].sort(),
		tsVersion: tsVersions.size === 1 ? requests[0]?.tsVersion : undefined,
	};
}
