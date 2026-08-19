# Bazel adoption v0 (Step A) — TIN-3857

Status: Step A only. Step B (Bazel 9.x migration) is explicitly out of scope
here — see "Deferred: Step B" below.

## Scope

This is the estate-wide adoption spec for converging on one proven Bazel
version and pinning `tinyland-inc/bazel-registry` by exact commit SHA rather
than a mutable ref. It codifies conventions already proven green in
`greatfallstoolbus.org` and a sibling spoke; it does not introduce new
mechanism.

## 1. Single `.bazelversion` per repo, pinned to the estate value

Every Tinyland repo that runs Bazel carries exactly one `.bazelversion` file
at its root, pinned to the current estate-wide proven value: **8.2.1**.

- `greatfallstoolbus.org` already runs green on 8.2.1, as does a sibling
  spoke; this registry's `.bazelversion` converges to match in this same
  change (was 8.1.1).
- No repo should carry a second, competing Bazel version pin (nested
  `.bazelversion`, CI-only override, etc.) without an explicit, documented
  exception.
- Bumping the estate value is a deliberate, cross-repo decision, not a
  per-repo drift. Each repo bump references the Linear issue that authorized
  the estate-wide move (this one: TIN-3857).

**This registry's own `.bazelversion` is inert for direct Bazel invocation.**
This repo has no `MODULE.bazel`, `WORKSPACE`, `BUILD`, or `.bazelrc` — it is
not a Bazel workspace itself, so `bazelisk` run at this repo's root does not
locate a workspace and will not read this file (falling through to whatever
version it resolves on its own). `.bazelversion` here is consumed exactly
two ways, both by copy:

1. `scripts/smoke-active-registry.mjs` and
   `scripts/smoke-stage1-consumer-targets.mjs` each copy this file verbatim
   into a generated temp smoke workspace before invoking `bazel`/`bazelisk`
   there — this is the only mechanism that makes the pin here binding.
2. Spoke repos carry their own root `.bazelversion` and converge it to this
   value by hand at the moment they re-pin this registry, recording the value
   they converged on next to that pin. The spoke-side `scaffold-doctor` SSOT
   check in §5 then holds them to it. Nothing reads this file over the
   network at check time — see §5 for exactly what that check does and does
   not prove.

`npm run validate` (`scripts/validate-registry.mjs`) asserts `.bazelversion`
here matches the pin recorded in `package.json`'s `bazelEstate.version`,
so a drift between the two is caught even when the network/GitHub-token
dependent smoke scripts (`npm run smoke:resolve`,
`npm run smoke:stage1-consumer`) are not run.

## 2. Two-registry chain

Bzlmod module resolution walks a fixed two-registry chain, in this order:

1. `tinyland-inc/bazel-registry` (in-house modules resolve first)
2. `bcr.bazel.build` (Bazel Central Registry, fallback)

This mirrors `elders.tinyland.dev` and is already the convention in the
spokes' `.bazelrc` files. Do not reorder —
an in-house module and a same-named BCR module must always resolve to the
in-house one.

## 3. Exact-SHA registry pin convention

The first registry entry pins `tinyland-inc/bazel-registry` to an immutable
commit SHA, not the mutable `main` ref, so module metadata (`MODULE.bazel` +
`source.json`) cannot silently change underneath a consumer. This is already
live in a sibling spoke; `greatfallstoolbus.org/.bazelrc` converges to it
under this same Linear issue (TIN-3857) in a companion change.

The refresh one-liner is already documented in that spoke's `.bazelrc` and
is quoted here verbatim, not re-authored:

```
sed -i '' "s|bazel-registry/[0-9a-f]\{40\}|bazel-registry/$(gh api repos/tinyland-inc/bazel-registry/commits/main --jq .sha)|" .bazelrc
```

Convention for consumers:

- Pin format: `common --registry=https://raw.githubusercontent.com/tinyland-inc/bazel-registry/<40-char-sha>` (no trailing slash after the SHA).
- Bump the SHA deliberately, in its own commit, alongside a `MODULE.bazel.lock`
  refresh — never silently as a side effect of an unrelated change.
- The commit message for a re-pin should name the registry commit(s) that
  motivated the bump.

## 4. Endpoint-free `.bazelrc.flywheel`

`.bazelrc.flywheel` (where a consuming repo has one) never hardcodes a cache
or executor endpoint. Endpoint authority lives exclusively in the wrapper
script (`scripts/gloriousflywheel-bazel.sh` in spoke repos), which supplies
`--remote_cache` / `--remote_executor` from validated environment at
invocation time. This keeps the registry and any `.bazelrc` free of
cluster-shaped state, consistent with the public-repo "zero secrets, zero
cluster endpoints" contract these repos already carry.

## 5. Conformance gate: scaffold-doctor SSOT check

Spoke repos run `just scaffold-doctor`, which chains
`scripts/scaffold-doctor-boundary.sh`. Two rows there are the conformance
gate for this spec:

1. **`.bazelrc.flywheel` shape** — asserts the endpoint-free property of §4.
2. **`.bazelversion` SSOT** — asserts the spoke's root `.bazelversion` equals
   the estate value the spoke recorded next to its exact-SHA registry pin, as
   a `# estate-bazelversion: <x.y.z>` line in its `.bazelrc`. Lands in the
   companion `greatfallstoolbus.org` change (Step A, spoke); other spokes
   adopt the same row as they converge.

**What row 2 proves, and what it does not.** It is an *offline* check by
design — `scaffold-doctor` runs with no network and must stay that way. It
proves the spoke's `.bazelversion` has not drifted from the value that spoke
recorded when it pinned this registry, and it fails closed if the recording
is missing entirely. It does **not** fetch this registry's `.bazelversion`,
so it cannot by itself detect that the estate value moved here after the
spoke pinned. Catching that is the job of the re-pin step in §3: bumping the
pinned SHA means re-reading this file and updating the spoke's recorded
value in the same commit. A spoke that never re-pins can therefore sit on a
stale-but-self-consistent value; that is a known, accepted limit of an
offline gate, not an oversight.

This registry repo has no `just scaffold-doctor` recipe of its own (it is not
a site.scaffold spoke); its own gate is `npm run validate` — which
cross-checks `.bazelversion` against `package.json`'s `bazelEstate.version` —
plus the immutability gate (`scripts/check-immutable-versions.sh`,
`.github/workflows/immutability-gate.yml`).

## Deferred: Step B (Bazel 9.x migration)

Step B — migrating the estate to Bazel 9.x — is **explicitly deferred** and
not addressed by this spec. It needs its own spec, which this registry
carries separately as `docs/bazel-9x-migration-spec-v0.md` (TIN-3897). The
estate's shared build/cache infrastructure sets the floor for what version
any consumer can move to, and moving it has a cache-key invalidation blast
radius across every cache-attached consumer (shared remote cache keys are
sensitive to the Bazel and rules versions that produced them).

The GloriousFlywheel and lab convergence bumps onto the Step A value are
tracked in their own repos' issues (TIN-3858 / TIN-3859) and are not touched
by this change. GFTB-shaped spokes **track** this drift but do not **own**
it — ownership sits with the cache/apply-plane authority per the TIN-2299
boundary.
