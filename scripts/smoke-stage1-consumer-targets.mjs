import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const root = process.cwd();

function compareVersions(left, right) {
    const leftParts = left.split('.').map(Number);
    const rightParts = right.split('.').map(Number);
    for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
        const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
        if (delta !== 0) {
            return delta;
        }
    }
    return 0;
}

function latestPublishedVersion(moduleName) {
    const metadataPath = path.join(root, 'modules', moduleName, 'metadata.json');
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    const yankedVersions = new Set(Object.keys(metadata.yanked_versions ?? {}));
    const versions = (metadata.versions ?? [])
        .filter((version) => !yankedVersions.has(version))
        .sort(compareVersions);
    const version = versions.at(-1);
    if (!version) {
        throw new Error(`${moduleName} has no active published version`);
    }
    return version;
}

function declaredDependencyVersion(moduleName, version, dependencyName) {
    const modulePath = path.join(root, 'modules', moduleName, version, 'MODULE.bazel');
    const moduleText = fs.readFileSync(modulePath, 'utf8');
    const escapedName = dependencyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const dependency = moduleText.match(
        new RegExp(
            `bazel_dep\\(\\s*name\\s*=\\s*"${escapedName}"\\s*,\\s*version\\s*=\\s*"([^"]+)"\\s*\\)`,
        ),
    );
    if (!dependency) {
        throw new Error(`${moduleName}@${version} does not declare ${dependencyName}`);
    }
    return dependency[1];
}

function schedulingKitScenario() {
    const version = latestPublishedVersion('tummycrypt_scheduling_kit');
    return {
        key: 'scheduling-kit-only',
        workspaceName: 'tinyland_registry_scheduling_kit_only_smoke',
        modules: [{ moduleName: 'tummycrypt_scheduling_kit', version }],
        targets: ['@tummycrypt_scheduling_kit//:pkg'],
        graphExpectation: { moduleName: 'tummycrypt_scheduling_kit', version },
        requiresPrivateArchiveAuth: false,
        successLabel: 'Built isolated scheduling-kit consumer target',
    };
}

function schedulingBridgeScenario() {
    const version = latestPublishedVersion('tummycrypt_scheduling_bridge');
    const kitVersion = declaredDependencyVersion(
        'tummycrypt_scheduling_bridge',
        version,
        'tummycrypt_scheduling_kit',
    );
    return {
        key: 'scheduling-bridge-only',
        workspaceName: 'tinyland_registry_scheduling_bridge_only_smoke',
        modules: [{ moduleName: 'tummycrypt_scheduling_bridge', version }],
        targets: ['@tummycrypt_scheduling_bridge//:pkg'],
        graphExpectation: { moduleName: 'tummycrypt_scheduling_kit', version: kitVersion },
        requiresPrivateArchiveAuth: true,
        successLabel: `Built isolated scheduling-bridge consumer target (${version} -> scheduling-kit ${kitVersion})`,
    };
}

const scenarioFactories = {
    stage1: () => ({
        key: 'stage1',
        workspaceName: 'tinyland_registry_stage1_consumer_smoke',
        modules: [
            { moduleName: 'tummycrypt_tinyland_auth', version: '0.3.0' },
            { moduleName: 'tummycrypt_tinyland_auth_pg', version: '0.2.4' },
            { moduleName: 'tummycrypt_tinyland_auth_redis', version: '0.1.3' },
            { moduleName: 'tummycrypt_tinyland_security', version: '0.3.2' },
            { moduleName: 'tummycrypt_tinyland_rate_limit', version: '0.3.0' },
        ],
        targets: [
            '@tummycrypt_tinyland_auth//:pkg',
            '@tummycrypt_tinyland_auth_pg//:pkg',
            '@tummycrypt_tinyland_auth_redis//:pkg',
            '@tummycrypt_tinyland_security//:pkg',
            '@tummycrypt_tinyland_rate_limit//:pkg',
        ],
        requiresPrivateArchiveAuth: true,
        successLabel: 'Built Stage 1 consumer targets',
    }),
    'scheduling-kit-only': schedulingKitScenario,
    'scheduling-bridge-only': schedulingBridgeScenario,
};

const scenarioArgument = process.argv.find((argument) => argument.startsWith('--scenario='));
const scenarioName = scenarioArgument?.slice('--scenario='.length) || 'stage1';
const scenarioFactory = scenarioFactories[scenarioName];
if (!scenarioFactory) {
    console.error(`Unknown consumer smoke scenario: ${scenarioName}`);
    process.exit(2);
}
const scenario = scenarioFactory();

const registryToken = process.env.TINYLAND_REGISTRY_GITHUB_TOKEN;
const githubToken = registryToken || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (scenario.requiresPrivateArchiveAuth && process.env.CI && !registryToken) {
    console.error(
        `${scenario.key} requires TINYLAND_REGISTRY_GITHUB_TOKEN in CI; private archive proof cannot skip or fall back to the repository-scoped GITHUB_TOKEN.`,
    );
    process.exit(1);
}
if (scenario.requiresPrivateArchiveAuth && !githubToken) {
    console.error(`${scenario.key} requires GitHub credentials for private module archives.`);
    process.exit(1);
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

function resolveBazelCommand() {
	for (const command of ['bazelisk', 'bazel']) {
		const probe = spawnSync(command, ['version'], {
			cwd: root,
			stdio: 'ignore',
		});
		if (!probe.error && probe.status === 0) {
			return { command, prefixArgs: [] };
		}
	}

	return { command: 'npx', prefixArgs: ['--yes', '@bazel/bazelisk'] };
}

const smokeDir = fs.mkdtempSync(path.join(os.tmpdir(), `${scenario.workspaceName}-`));
let exitCode = 0;
try {
	const credentialHelperArgs = writeGitHubCredentialHelper(smokeDir);
	const bazel = resolveBazelCommand();
	const moduleBazel = [
        `module(name = "${scenario.workspaceName}", version = "0.0.0")`,
        ...scenario.modules.map(
            ({ moduleName, version }) => `bazel_dep(name = "${moduleName}", version = "${version}")`,
        ),
		'',
	].join('\n');
	fs.writeFileSync(path.join(smokeDir, 'MODULE.bazel'), moduleBazel);
	fs.writeFileSync(path.join(smokeDir, '.bazelversion'), fs.readFileSync(path.join(root, '.bazelversion')));

    if (scenario.graphExpectation) {
        const graphResult = spawnSync(
            bazel.command,
            [
                ...bazel.prefixArgs,
                '--ignore_all_rc_files',
                'mod',
                'graph',
                '--output=text',
                '--charset=ascii',
                '--verbose=false',
                '--include_unused=false',
                ...credentialHelperArgs,
                '--enable_bzlmod',
                '--lockfile_mode=off',
                `--registry=file://${root}`,
                '--registry=https://bcr.bazel.build',
            ],
            {
                cwd: smokeDir,
                encoding: 'utf8',
            },
        );

        process.stdout.write(graphResult.stdout ?? '');
        process.stderr.write(graphResult.stderr ?? '');
        if (graphResult.error) {
            console.error('Failed to spawn bazel mod graph:', graphResult.error.message);
            exitCode = 1;
        } else if (graphResult.status !== 0) {
            exitCode = graphResult.status ?? 1;
        } else {
            const expected = `${scenario.graphExpectation.moduleName}@${scenario.graphExpectation.version}`;
            const escapedModuleName = scenario.graphExpectation.moduleName.replace(
                /[.*+?^${}()|[\]\\]/g,
                '\\$&',
            );
            const selectedVersions = new Set(
                [...(graphResult.stdout ?? '').matchAll(new RegExp(`${escapedModuleName}@([0-9A-Za-z.+_-]+)`, 'g'))]
                    .map((match) => match[1]),
            );
            if (selectedVersions.size !== 1 || !selectedVersions.has(scenario.graphExpectation.version)) {
                console.error(
                    `Isolated graph selected ${scenario.graphExpectation.moduleName}@${[...selectedVersions].join(',') || '<missing>'}; expected the published edge ${expected}.`,
                );
                exitCode = 1;
            } else {
                console.log(`Isolated graph selected ${expected}.`);
            }
        }
    }

    const result = exitCode === 0 ? spawnSync(
        bazel.command,
        [
            ...bazel.prefixArgs,
            '--ignore_all_rc_files',
            'build',
            ...scenario.targets,
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
    ) : undefined;

    if (result?.error) {
        console.error('Failed to spawn bazel:', result.error.message);
        exitCode = 1;
    } else if (result && result.status !== 0) {
        exitCode = result.status ?? 1;
    }

    if (exitCode === 0) {
        console.log(`${scenario.successLabel}: ${scenario.targets.join(', ')}`);
    }
} finally {
	fs.rmSync(smokeDir, { recursive: true, force: true });
}

process.exit(exitCode);
