import fs from 'node:fs';
import path from 'node:path';

const ASPECT_RULES_TS_EXTENSION = '@aspect_rules_ts//ts:extensions.bzl';
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
		return canonical[1].startsWith('aspect_rules_ts+');
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

function parseAspectDeps(statement, extension, bindings, source, context) {
	const call = parseDirectCall(statement, 2, source, context);
	if (!call || call.closeIndex !== statement.length - 1) {
		throw diagnostic(
			context,
			source,
			statement[0].start,
			'aspect_rules_ts deps() must be a direct canonical call',
		);
	}

	let tsVersion;
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
		if (arg.name !== 'ts_version') {
			continue;
		}
		if (tsVersion) {
			throw diagnostic(context, source, rawArg[0].start, 'duplicate ts_version argument');
		}
		tsVersion = resolveStringExpression(arg.expression, bindings, source, context);
		if (!tsVersion) {
			throw diagnostic(
				context,
				source,
				arg.expression[0]?.start ?? rawArg[0].start,
				'ts_version must be a canonical string literal or simple string constant',
			);
		}
	}

	if (!tsVersion) {
		throw diagnostic(context, source, statement[0].start, 'aspect_rules_ts deps() must declare ts_version');
	}
	const location = sourceLocation(source, tsVersion.token.start);
	extension.requests.push({
		column: location.column,
		line: location.line,
		tsVersion: tsVersion.value,
	});
}

function findAspectDepsReference(statement, bindings) {
	for (let index = 0; index + 2 < statement.length; index += 1) {
		const extension = bindings.get(statement[index].value);
		if (
			extension?.kind === 'extension' &&
			extension.target &&
			statement[index + 1]?.value === '.' &&
			statement[index + 2]?.value === 'deps'
		) {
			return { extension, index };
		}
	}
	return undefined;
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
		if (statement[0]?.value === 'bazel_dep' && statement[1]?.value === '(') {
			parseBazelDep(statement, bindings, repositoryMappings, moduleBazel, context);
			continue;
		}

		const assignment = statement[0]?.type === 'identifier' && statement[1]?.value === '=';
		const depsReference = findAspectDepsReference(statement, bindings);
		if (depsReference) {
			const directCall =
				!assignment &&
				depsReference.index === 0 &&
				statement[3]?.value === '(';
			if (depsReference.extension.devDependency || depsReference.extension.isolate) {
				continue;
			}
			if (directCall) {
				parseAspectDeps(
					statement,
					depsReference.extension,
					bindings,
					moduleBazel,
					context,
				);
				continue;
			}
			throw diagnostic(
				context,
				moduleBazel,
				statement[depsReference.index].start,
				'aspect_rules_ts deps() must be a direct canonical call',
			);
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
				'aspect_rules_ts extension usage must declare deps(ts_version = "...")',
			);
		}
	}

	return aspectUsages.flatMap((usage) => usage.requests);
}

function formatConflict(requests) {
	const grouped = new Map();
	for (const request of requests) {
		const modules = grouped.get(request.tsVersion) ?? [];
		modules.push(
			`${request.moduleName}@${request.version}/MODULE.bazel:${request.line}:${request.column}`,
		);
		grouped.set(request.tsVersion, modules);
	}

	const lines = [
		'aspect_rules_ts extension ts_version mismatch across greatest non-yanked module versions:',
	];
	for (const [tsVersion, modules] of [...grouped].sort(([left], [right]) =>
		left.localeCompare(right, undefined, { numeric: true }),
	)) {
		lines.push(`  ts_version ${tsVersion}:`);
		for (const moduleVersion of modules.sort()) {
			lines.push(`    - ${moduleVersion}`);
		}
	}
	lines.push(`All modules sharing ${ASPECT_RULES_TS_EXTENSION} must request one ts_version.`);

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

	const tsVersions = new Set(requests.map((request) => request.tsVersion));
	if (tsVersions.size > 1) {
		throw new Error(formatConflict(requests));
	}

	return {
		requests,
		tsVersion: requests[0]?.tsVersion,
	};
}
