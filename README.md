# tinyland-inc/bazel-registry

An [in-house Bazel module registry](https://bazel.build/external/registry) for
Tinyland-authored Bzlmod modules (`tummycrypt_*`, `rules_tectonic`,
`spear_resumes`, `dsa_study_packet`, ...). It is a static, content-addressed
directory of `MODULE.bazel` + `source.json` + `metadata.json` triples under
`modules/<name>/<version>/`, served to consumers over raw GitHub URLs — not a
Bazel workspace itself (no `MODULE.bazel`, `WORKSPACE`, `BUILD`, or `.bazelrc`
at this root; see "`.bazelversion` here" below).

## Estate Bazel version SSOT

The estate-wide proven Bazel version is recorded once, in this repo's root
[`.bazelversion`](./.bazelversion). Every Tinyland repo that runs Bazel
converges its own root `.bazelversion` to that same value. Bumping it is a
deliberate, cross-repo decision tracked by a Linear issue (the current value,
convention, and full rationale are in
[`docs/bazel-adoption-v0.md`](./docs/bazel-adoption-v0.md)), not a per-repo
drift.

### `.bazelversion` here is inert for direct invocation

This repo is not a Bazel workspace, so running `bazelisk` at this root does
not read this file. It is consumed exactly two ways, both by copy:

1. `npm run smoke:resolve` / `npm run smoke:stage1-consumer`
   (`scripts/smoke-active-registry.mjs`,
   `scripts/smoke-stage1-consumer-targets.mjs`) each copy it verbatim into a
   generated temp smoke workspace before invoking `bazel mod graph` /
   `bazel build` there.
2. Spoke repos carry their own root `.bazelversion`. They converge it to this
   value by hand when they re-pin this registry, and record the value they
   converged on next to that pin; each spoke's `scaffold-doctor` then holds
   them to their recorded value. That check is offline — it catches spoke-side
   drift, it does not read this file over the network. See
   [`docs/bazel-adoption-v0.md` §5](./docs/bazel-adoption-v0.md#5-conformance-gate-scaffold-doctor-ssot-check)
   for the exact limits.

`npm run validate` cross-checks `.bazelversion` here against the pin recorded
in `package.json`'s `bazelEstate.version`, so a drift between the two
is caught even without running the network/token-dependent smoke scripts.

## The two-registry chain

Consumers resolve Bzlmod modules through a fixed two-registry chain, in
order: this registry first (in-house modules resolve before anything else),
then `bcr.bazel.build` (Bazel Central Registry) as fallback. See
[`docs/bazel-adoption-v0.md` §2](./docs/bazel-adoption-v0.md#2-two-registry-chain).

## How spokes pin this registry

Spokes pin this registry to an immutable commit SHA in their own `.bazelrc`
(`common --registry=https://raw.githubusercontent.com/tinyland-inc/bazel-registry/<40-char-sha>`),
not the mutable `main` ref, so module metadata cannot change silently
underneath them. A sibling spoke's documented refresh one-liner (quoted verbatim
in [`docs/bazel-adoption-v0.md` §3](./docs/bazel-adoption-v0.md#3-exact-sha-registry-pin-convention))
is the canonical way to re-pin after this registry advances:

```
sed -i '' "s|bazel-registry/[0-9a-f]\{40\}|bazel-registry/$(gh api repos/tinyland-inc/bazel-registry/commits/main --jq .sha)|" .bazelrc
```

A SHA bump must land alongside a `MODULE.bazel.lock` refresh in the same
commit — see `docs/bazel-adoption-v0.md` §3 for the full convention.

## Validation

- `npm run validate` (`scripts/validate-registry.mjs`) — pure static checks:
  every `source.json` has SRI integrity, no `tinyland.dev` tarball
  references, its `url` resolves to an allowed GitHub source host (a
  `github.com/<owner>/<repo>/archive/refs/tags/<tag>.tar.gz` release archive,
  or an `api.github.com/repos/<owner>/<repo>/tarball/<ref>` authenticated
  tarball for private repos -- package-registry hosts such as
  `registry.npmjs.org` and `npm.pkg.github.com` are explicitly refused),
  `metadata.json` and `MODULE.bazel` agree on name/version, and
  `.bazelversion` matches the recorded estate pin. No network.
- `npm run test:validate-source-hosts`
  (`scripts/test-validate-registry-source-hosts.mjs`): fixture-driven
  negative control for the source-host allowlist above. Builds throwaway
  one-module registry fixtures in a temp dir and runs `validate-registry.mjs`
  against each, proving both that allowed URL shapes still pass and that
  `registry.npmjs.org`, `npm.pkg.github.com`, and any other unlisted host are
  rejected. `npm run validate` alone can't prove the refusal path: this
  repo's real `modules/` tree has no disallowed-host entries to exercise it.
- `scripts/check-immutable-versions.sh` — rejects edits to already-shipped
  module version directories (immutability gate).
- `npm run smoke:resolve` / `npm run smoke:stage1-consumer` — network and
  GitHub-token dependent; exercise `.bazelversion` and this registry's module
  metadata through real `bazel mod graph` / `bazel build` runs in throwaway
  workspaces.
- `npm run smoke:scheduling-kit-only` / `npm run
  smoke:scheduling-bridge-only` / `npm run smoke:tempo-store-only` — isolated
  one-direct-dependency consumers.
  Each resolves the selected graph and builds only that module's `//:pkg`, so
  an aggregate root dependency cannot raise and mask scheduling-bridge's
  declared scheduling-kit edge. The bridge proof reads the latest active
  published bridge version and its declared kit version directly from registry
  metadata; it does not invent an unpublished successor.

The three isolated package smokes are required GF/self-hosted CI steps in
`.github/workflows/validate.yml`. Bridge and Tempo consume commit-pinned private
archives through GitHub's authenticated API tarball endpoint and fail closed
when `TINYLAND_REGISTRY_GITHUB_TOKEN` is absent. The aggregate and Stage 1
legacy-compatibility audits still run and report their failures, but they do not
mask or block current package successors while immutable older private entries
retain browser-archive URLs that GitHub App tokens cannot read.

## Docs

- [`docs/bazel-adoption-v0.md`](./docs/bazel-adoption-v0.md) — the full
  estate-wide Bazel adoption spec (Step A): single-version convergence,
  the two-registry chain, the exact-SHA pin convention, endpoint-free
  `.bazelrc.flywheel`, and the scaffold-doctor conformance gate. Step B
  (Bazel 9.x migration) is specified separately in
  `docs/bazel-9x-migration-spec-v0.md` (TIN-3897).
