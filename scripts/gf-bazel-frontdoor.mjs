import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const custodyFile = '/etc/tinyland/ci-bazelisk-bin';

function fail(message) {
	throw new Error(`GF Bazel front door: ${message}`);
}

export function resolveGfBazel() {
	if (!fs.existsSync(custodyFile)) {
		fail(`missing custody file ${custodyFile}`);
	}
	const custodiedBinary = fs.readFileSync(custodyFile, 'utf8').trim();
	const configuredBinary = process.env.TINYLAND_CI_BAZELISK_BIN?.trim();

	if (!configuredBinary) {
		fail('TINYLAND_CI_BAZELISK_BIN is not set');
	}
	if (configuredBinary !== custodiedBinary) {
		fail('configured Bazelisk does not match runner custody');
	}
	if (
		!path.isAbsolute(configuredBinary) ||
		!/^\/nix\/store\/[0-9a-z]{32}-bazelisk-1\.25\.0\/bin\/bazelisk$/.test(configuredBinary)
	) {
		fail(`invalid immutable Bazelisk path: ${configuredBinary}`);
	}
	const binaryStat = fs.lstatSync(configuredBinary);
	if (
		!binaryStat.isFile() ||
		binaryStat.isSymbolicLink() ||
		binaryStat.uid !== 0 ||
		binaryStat.gid !== 0 ||
		(binaryStat.mode & 0o022) !== 0
	) {
		fail('custodied Bazelisk is not a root-owned, non-writable regular file');
	}
	fs.accessSync(configuredBinary, fs.constants.X_OK);

	const remoteCache = process.env.BAZEL_REMOTE_CACHE?.trim();
	if (!remoteCache) {
		fail('BAZEL_REMOTE_CACHE is not set');
	}
	if (
		remoteCache.includes('${') ||
		!/^(?:grpc|grpcs|http|https):\/\//.test(remoteCache) ||
		/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)/.test(remoteCache)
	) {
		fail('BAZEL_REMOTE_CACHE is not an approved runtime endpoint');
	}

	return {
		command: configuredBinary,
		remoteArgs: [
			`--remote_cache=${remoteCache}`,
			'--remote_upload_local_results=false',
			'--remote_max_connections=1',
		],
	};
}
