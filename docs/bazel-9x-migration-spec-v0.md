# Bazel 9.x migration spec v0 (Step B) — TIN-3897

Status: specification only. **No version is bumped by this change**, in this
repo or any other. Step B is the second half of the Bazel SSOT convergence:
Step A (TIN-3857) converges the estate on one proven 8.x value and pins this
registry by exact SHA; Step B says how the estate moves that value onto the
Bazel 9 latest line, in what order, and what breaks if the order is wrong.

## Reading order and merge order

This document assumes `docs/bazel-adoption-v0.md` (Step A, TIN-3857) is
already present and already read. Step A owns the *mechanism* — one
`.bazelversion` per repo, the two-registry chain, the exact-SHA registry pin,
endpoint-free `.bazelrc.flywheel`, and the `scaffold-doctor` conformance gate.
Step B owns the *move*, and does not restate any of it.

Merge order is **Step A, then Step B**. Step A introduces both `README.md` and
`docs/bazel-adoption-v0.md` on its branch; neither exists on `main` yet, so
this branch deliberately touches no file that Step A also touches, to keep the
two branches conflict-free. Once Step A has landed, add this one bullet under
the README's "Docs" section as a trivial follow-up:

```markdown
- [`docs/bazel-9x-migration-spec-v0.md`](./docs/bazel-9x-migration-spec-v0.md) —
  the Bazel 9.x migration spec (Step B). Follows Step A; specifies the
  readiness matrix, the 8→9 breaking changes that bind here, the shared-cache
  blast radius, and the migration/rollback order. Bumps nothing by itself.
```

## Naming and redaction

This registry is a **public** repo. Estate repos are named here only where the
name is already public:

- `greatfallstoolbus.org` — public spoke, named directly.
- `tinyland-inc/bazel-registry` — this repo, public.
- `tinyland-inc/site.scaffold` — the template spoke; already named in the
  public spoke's `AGENTS.md`, and as "a site.scaffold spoke" in Step A §5.
- `GloriousFlywheel` — the shared cache substrate; already named in the public
  spoke's `.bazelrc.flywheel`, `Justfile`, and
  `scripts/gloriousflywheel-bazel.sh`.

Two estate repos are **not** named, because their names are not public:

- **the private sibling spoke** — the spoke Step A §3 credits with the
  exact-SHA pin convention.
- **the private tooling repo** — a Nix-first tooling/dotfiles repo that also
  carries a Bzlmod workspace and a `.bazelrc.flywheel`.

Use these designators verbatim in any downstream public document. No cache or
executor endpoint, runner class, credential, or cluster hostname appears in
this file, per the same contract Step A §4 states for `.bazelrc.flywheel`.

## Scope

1. Establish the target: the Bazel 9 latest line, and what "latest stable"
   currently resolves to.
2. Record a per-repo readiness matrix — Bazel version, module system, lockfile
   version, and every `rules_*` dependency with its verified 9.x-tested floor.
3. Enumerate the 8→9 breaking changes that actually bind on estate
   configuration as it exists today, with upstream citations.
4. Explain the shared-remote-cache key-invalidation blast radius and derive a
   migration order from it.
5. Give per-repo verification commands and a rollback for each step.
6. Design a `scaffold-doctor` conformance extension that detects drift between
   a repo's `.bazelversion` and the `.bazelversion` at the registry commit that
   repo actually pins.

## Non-goals

- **No version bumps in this ticket.** Not `.bazelversion`, not any
  `bazel_dep` version, not `MODULE.bazel.lock`, not the registry SHA pin in any
  consumer's `.bazelrc`, not `package.json`'s `bazelEstate.version`. This
  branch adds one document.
- **No new in-house module versions are published here.** §2.4 identifies
  which ones will eventually need republishing; minting them is separate work
  under the immutability rule (`scripts/check-immutable-versions.sh`).
- **GloriousFlywheel does not move under this ticket.** Its bump proceeds under
  its own contract, and the CI gate work (**TIN-2915**) lands first. Step B
  may describe GF's ordering constraints; it does not authorize GF's bump.
- **The private tooling repo does not move under this ticket** either; it
  proceeds under its own contract.
- **Ownership is unchanged.** Per the **TIN-2299** boundary and Step A's
  "Deferred: Step B" paragraph, spokes *track* the estate Bazel value but do
  not *own* it; ownership sits with the cache/apply-plane authority. This spec
  is written from the registry (the SSOT for the recorded value), not from a
  spoke, and it does not move the boundary.
- No change to the two-registry chain, the exact-SHA pin convention, or the
  endpoint-free rc contract. Those are Step A's and stay as written.

## 1. Target version

Latest stable Bazel, verified at authoring time against
`gh api repos/bazelbuild/bazel/releases/latest`:

| | |
| --- | --- |
| Latest stable | **9.2.0**, published 2026-07-13 |
| 9.x line to date | 9.0.0 (2026-01-20, LTS), 9.0.1, 9.0.2, 9.1.0, 9.1.1, 9.2.0 |
| 8.x line to date | …8.5.0, 8.5.1, 8.6.0, 8.7.0 |
| Estate value after Step A | 8.2.1 |

Bazel 9.0 is a major LTS release. Release notes:
<https://github.com/bazelbuild/bazel/releases/tag/9.0.0>,
<https://github.com/bazelbuild/bazel/releases/tag/9.1.0>,
<https://github.com/bazelbuild/bazel/releases/tag/9.2.0>.

Target the 9.x **latest line** (currently 9.2.0), not 9.0.0. The 9.0.x patch
releases exist because 9.0.0 shipped with rough edges; there is no reason to
adopt the oldest 9.x when the estate is moving in one deliberate step. The
estate value moves 8.2.1 → 9.2.0 as a single recorded decision, exactly as
Step A §1 requires.

## 2. Per-repo readiness matrix

### 2.1 Version, module system, lockfile

All rows read directly from each repo's working tree at authoring time.

| Repo | `.bazelversion` | Module system | `lockFileVersion` | Registry pin |
| --- | --- | --- | --- | --- |
| `greatfallstoolbus.org` (public spoke) | 8.2.1 | Bzlmod only; no `WORKSPACE*` file | 18 | mutable `main` ref (Step A converges it to exact SHA) |
| `tinyland-inc/site.scaffold` (template spoke) | 8.2.1 | Bzlmod only; no `WORKSPACE*` file | 18 | exact 40-char SHA |
| the private sibling spoke | 8.2.1 (per Step A §1) | Bzlmod | not read here | exact 40-char SHA (origin of the convention, Step A §3) |
| the private tooling repo | 7.6.0 | Bzlmod only; no `WORKSPACE*` file | 13 | BCR only — the in-house registry lane was removed 2026-08-06 (TIN-3537) |
| `GloriousFlywheel` (cache substrate) | 7.4.0 | Bzlmod **plus** a vestigial 7-line `WORKSPACE.bazel` | 11 | BCR only |
| `tinyland-inc/bazel-registry` (this repo) | 8.1.1 on `main`; 8.2.1 after Step A | **not a Bazel workspace** — no `MODULE.bazel`, `WORKSPACE`, `BUILD`, or `.bazelrc` | n/a | n/a |

Two things this table settles:

- **GloriousFlywheel is the furthest behind and the most exposed.** It is two
  major versions back (7.4.0), it is the only estate repo still carrying a
  `WORKSPACE.bazel`, and it is the shared cache substrate. Its 7.4.0 pin is
  also load-bearing in its own `.bazelrc`, which documents a 7.4.0-specific
  `disk_cache` GC defect (bazelbuild/bazel#24098) as the reason a du-triggered
  prune backstop exists. That comment must be re-evaluated, not blindly
  carried, when GF moves.
- **The registry's own `.bazelversion` is inert for direct invocation** (Step A
  §1). It binds only by copy — into the throwaway smoke workspaces built by
  `scripts/smoke-active-registry.mjs` and
  `scripts/smoke-stage1-consumer-targets.mjs`, and into spokes by hand at
  re-pin time. That makes this repo the cheapest possible place to prove a new
  Bazel version: flipping the value here exercises 9.x through a real
  `bazel mod graph` / `bazel build` against real in-house module metadata,
  with **zero remote-cache attachment and zero consumer blast radius**. §5
  makes that step 1.

### 2.2 Lockfile format

The `MODULE.bazel.lock` schema version is not called out in the 9.0.0 release
notes, so it was measured directly rather than assumed. A throwaway Bzlmod
workspace (one `bazel_dep`, BCR only, no cache attachment) was resolved under
each version:

| Bazel | `lockFileVersion` written |
| --- | --- |
| 7.4.0 | 11 (observed in `GloriousFlywheel`) |
| 7.6.0 | 13 (observed in the private tooling repo) |
| 8.2.1 | 18 (observed in both 8.x spokes) |
| **9.2.0** | **28** (measured: `bazelisk mod graph` in a scratch workspace) |

Consequence: **every repo's lockfile is rewritten wholesale on the bump.** The
lockfile diff is not reviewable line-by-line and should not be treated as if
it were; review the `.bazelversion` line and the resolved module versions in
`bazelisk mod graph` output instead. The lockfile must move in the *same*
commit as `.bazelversion` — a repo whose two files disagree is a repo whose
CI lane fails in a way that looks like a dependency problem and is not.

This matters most for GloriousFlywheel, whose CI lanes set
`common:ci --lockfile_mode=error` (its documented W3.1 / TIN-1467 lockfile
authority). A stale lock under `--lockfile_mode=error` is a hard CI failure,
by design; GF's bump therefore has no "land the version now, refresh the lock
later" option. It also has a `just bazel-lockfile-check` recipe that has to be
re-proved against the v28 format.

### 2.3 `rules_*` dependency floors for Bazel 9

**Method.** Ruleset GitHub release notes are boilerplate ("Add to your
MODULE.bazel…") and state nothing about Bazel compatibility; they were checked
and are not a usable source. `bazel_compatibility` in each module's published
`MODULE.bazel` is present on only two of the modules in use and carries no
upper bound, so it cannot prove 9.x support either. The floors below come from
the authoritative machine-readable source: **the `bazel:` test matrix in
`modules/<name>/<version>/presubmit.yml` in
`bazelbuild/bazel-central-registry`** — i.e. the Bazel versions BCR actually
runs that exact module version against. A floor is the earliest version whose
matrix includes a 9.x entry, found by bisecting adjacent published versions.

| Module | In use | 9.x-tested floor | Evidence (BCR presubmit `bazel:` matrix) |
| --- | --- | --- | --- |
| `aspect_rules_js` | 2.9.1 (public spoke, template spoke, **all in-house modules**), 2.9.2 (GF) | **3.0.0** | 2.9.1 `['8.x','7.x','6.x']`; 2.9.2 `['rolling','8.x','7.x','6.x']`; **3.0.0 `['7.x','8.x','9.x']`**. Major-version bump. |
| `aspect_rules_ts` | 3.8.4 (public spoke, template spoke, 3 of 4 in-house modules), 3.8.3 (GF) | **3.8.7** | 3.8.6 `['8.x','7.x']`; **3.8.7 `['9.x','8.x','7.x']`**. Patch-level; cheap. |
| `aspect_rules_swc` | 2.6.1 (both 8.x spokes) | **2.7.1** | 2.7.0 `["8.x","7.x"]`; **2.7.1 `["9.x","8.x","7.x"]`**. Minor; cheap. |
| `rules_nodejs` | 6.7.3 (all four JS consumers + all in-house modules) | **already met at 6.7.3** | 6.7.3 `["7.x","8.x","9.*"]` |
| `rules_python` | 1.4.1 (GF), 2.2.0 (tooling repo) | **2.0.0** | 1.4.1 / 1.5.0 / 1.6.0 all `[7.x, last_rc]`; **2.0.0 `[7.x, 8.x, 9.x]`**. Major bump **for GF only**; the tooling repo is already past it. |
| `rules_rust` | 0.70.0 (GF) | **already met** | `["7.x","8.x","9.x"]` |
| `rules_go` | 0.60.0 (GF), 0.62.0 (tooling repo) | **already met** | both `[7.*, 8.*, 9.*]` |
| `gazelle` | 0.52.2 (tooling repo) | **already met** | `[7.*, 8.*, 9.*]` |
| `rules_img` | 0.3.4 (GF) | **already met** | `[7.x, 8.x, 9.*]` |
| `aspect_bazel_lib` | 2.22.5 (both 8.x spokes, GF, **all in-house modules**) | **UNVERIFIED — and renamed** | BCR tops out at **2.22.5** under the name `aspect_bazel_lib`. The 3.x line is published under a **different module name, `bazel_lib`** (`bazel_lib@3.7.1`, `bazel_compatibility = [">=6.0.0"]`). Its presubmit carries no per-module `bazel:` pin, so BCR's default matrix applies and no 9.x claim can be read off it. **Moving to the 3.x line is a `bazel_dep` *rename*, not a version bump** — a real MODULE.bazel edit in every consumer and every in-house module. |
| `rules_shell` | 0.6.0 (GF), 0.8.0 (tooling repo) | **UNVERIFIED** | Latest published 0.8.0 matrix is `[6.x, 7.x, 8.x]` — **no 9.x entry at any published version**. |
| `rules_oci` | 2.3.0 (tooling repo) | **UNVERIFIED** | Latest published 2.3.0 matrix is `["7.x"]` only. |
| `rules_cc` | 0.2.18 (GF), 0.2.22 (tooling repo) | **UNVERIFIED by this method** | presubmit delegates to BCR's default matrix (`bazel: ${{ bazel }}`), so no per-version claim is readable. Load-bearing under 9 regardless — see §3.3. |
| `bazel_skylib` | 1.8.2 (spokes, GF, in-house), 1.9.2 (tooling repo) | **UNVERIFIED by this method** | no per-module `bazel:` pin |
| `platforms` | 0.0.10 (GF), 1.0.0 (spokes, in-house), 1.1.0 (tooling repo) | **UNVERIFIED by this method** | no per-module `bazel:` pin |
| `rules_pkg` | 1.1.0 (spokes), 1.2.0 (GF), 1.3.0 (tooling repo) | **UNVERIFIED by this method** | no per-module `bazel:` pin |
| `rules_nixpkgs_core` | 0.13.0 (GF **and** tooling repo) | **UNVERIFIED — highest residual risk** | no per-module `bazel:` pin. WORKSPACE-era heritage, heavy repository-rule surface, and both Nix-integrated repos depend on it. §3.6. |

**How to close an UNVERIFIED row.** Do not guess and do not read it off a
changelog. Resolve the repo's real graph under 9.2.0 in a scratch checkout —
`USE_BAZEL_VERSION=9.2.0 bazelisk mod graph` then a bounded
`USE_BAZEL_VERSION=9.2.0 bazelisk build` of one representative target — with
**no remote cache attached** (§4 explains why that matters). A green resolve
plus a green bounded build is the evidence; record it against the row.

### 2.4 The in-house modules in this registry are themselves below the floor

This is the finding that puts Step B in *this* repo rather than in a spoke.

The four modules both 8.x spokes depend on — `tummycrypt_tinyland_color_utils`,
`tummycrypt_vite_plugin_a11y`, `tummycrypt_vite_plugin_skeleton_colors`,
`tummycrypt_tinyvectors` — every published version pins, in its own
`MODULE.bazel`:

```
bazel_dep(name = "aspect_bazel_lib", version = "2.22.5")   # renamed at 3.x; UNVERIFIED for 9
bazel_dep(name = "aspect_rules_js",  version = "2.9.1")    # below the 3.0.0 floor
bazel_dep(name = "aspect_rules_ts",  version = "3.8.4")    # below the 3.8.7 floor
bazel_dep(name = "bazel_skylib",     version = "1.8.2")
bazel_dep(name = "platforms",        version = "1.0.0")
bazel_dep(name = "rules_nodejs",     version = "6.7.3")    # already 9.x-tested
```

Bzlmod's minimal-version-selection means a consumer that raises its own
`aspect_rules_js` to 3.0.0 raises it for the whole graph, so a spoke *can*
reach the floor without the registry moving — the in-house pins are lower
bounds, not ceilings. But two things still bind:

1. **A module whose own targets were only ever built against `aspect_rules_js`
   2.9.x is not thereby proven against 3.x.** The template spoke already
   graph-links these modules' `pkg` targets directly (its `MODULE.bazel`
   records that `tummycrypt_tinyvectors` 0.3.0's producer target could not
   build under the sandbox at all, which is why 0.3.4 is pinned). Those
   producer targets are exactly what a rules_js major bump is most likely to
   break, and they are built from *this* registry's metadata.
2. **Fixing one cannot be done in place.** `scripts/check-immutable-versions.sh`
   and `.github/workflows/immutability-gate.yml` freeze every shipped
   `modules/<name>/<version>/` directory, for the stated reason that editing a
   shipped version makes the registry serve two integrity variants of one URL.
   A 9.x-compatible in-house module is therefore a **new published version**,
   which means new consumer `bazel_dep` pins, which means a registry re-pin in
   every consumer's `.bazelrc` (Step A §3), which means a `MODULE.bazel.lock`
   refresh in the same commit.

That chain — republish, re-pin, relock — is the long pole of the whole
migration, and it runs through this repo. It is **not** started by this ticket
(§ Non-goals); §5 places it, and it should be tracked as its own issue before
any spoke flips `.bazelversion`.

## 3. Breaking changes 8 → 9 that actually bind here

Filtered to changes that touch estate configuration as it exists today. Source
unless otherwise noted: <https://github.com/bazelbuild/bazel/releases/tag/9.0.0>.

### 3.1 WORKSPACE is gone; Bzlmod is unconditional

> "Bzlmod is now always enabled, and all `WORKSPACE` logic has been removed
> from Bazel" — <https://github.com/bazelbuild/bazel/issues/26131>. "The
> `--enable_bzlmod` and `--enable_workspace` flags are now no-ops."

Bindings:

- **`GloriousFlywheel` carries a `WORKSPACE.bazel`.** It is a 7-line stub whose
  own comment says it exists "for compatibility with tools that expect a
  WORKSPACE file", containing only `workspace(name = "glorious-flywheel")`.
  Under 9 this file is inert; it should be deleted as part of GF's bump, and
  any tool that genuinely required its presence identified first. This is the
  cheapest breaking change in the estate — GF is "WORKSPACE-era" by file
  inventory, not by dependency style: its actual dependency graph is already
  fully Bzlmod.
- **`common --enable_bzlmod` becomes a no-op** in `greatfallstoolbus.org`,
  `site.scaffold`, and `GloriousFlywheel`; `common --enable_bzlmod=true` in the
  private tooling repo likewise. Harmless as a no-op, but leaving it is
  misleading; strip it in the same commit and let the migration tool
  (<https://bazel.build/external/migration_tool>) confirm nothing else depended
  on WORKSPACE semantics.

### 3.2 `bazel sync` removed

Replaced by `bazel fetch --all`. Checked at authoring time across all four
Bazel-carrying estate repos (Justfiles, CI workflows, scripts): **no `bazel sync`
or `bazelisk sync` invocation exists anywhere**. This row is clean; re-check it
at step 0 only because a removed subcommand fails late, typically in the one CI
lane nobody runs locally.

### 3.3 All C++ rules removed from Bazel core

> "All C++-related rules (including `cc_binary`, `cc_library`, etc.) have been
> removed from Bazel and are now located in `rules_cc`."

and

> "`--incompatible_autoload_externally` now defaults to the empty string"
> (<https://github.com/bazelbuild/bazel/issues/23043>), "meaning that all
> language-specific rules will now need to be loaded from their respective
> modules".

Bindings: `GloriousFlywheel` depends on `rules_cc` 0.2.18 and sets
`build --incompatible_enable_cc_toolchain_resolution`, with a `MODULE.bazel`
comment explaining that Bazel auto-detects a system `cc` toolchain under that
flag while `rules_cc` supplies the rule definitions. That split is exactly what
9 formalises, so GF's posture is already correct in shape — but every `.bzl`
load of a C++ rule must now come from `@rules_cc`, autoloading no longer papers
over a missing load, and `rules_cc`'s own 9.x floor is UNVERIFIED (§2.3). The
private tooling repo is on `rules_cc` 0.2.22 with the same exposure.

### 3.4 Remote-execution and cache flag changes

- **`--remote_default_platform_properties` and its
  `--host_platform_remote_properties_override` synonym are removed**; use
  `--remote_default_exec_properties`. **The estate is already on the correct
  flag** — `.bazelrc.flywheel` in both 8.x spokes documents that
  `scripts/gloriousflywheel-bazel.sh` supplies worker platform identity via
  `--remote_default_exec_properties=gf.platform=<class>`. No change needed;
  recorded so nobody "fixes" it into the removed spelling.
- **`--experimental_worker_for_repo_fetching` is removed.**
- **New `--repo_contents_cache`**, defaulting to a `contents` directory under
  `--repository_cache`. GF sets a durable per-machine
  `--repository_cache` for developers (its TIN-2114 rationale) and explicitly
  neutralises it on CI with `build:ci --repository_cache=`. Under 9 that
  neutralisation now also disables the repo-contents cache; the CI lane is
  correspondingly colder on repository fetches. Deliberate, but re-measure.
- **`--experimental_check_external_repository_files` (default on)** now
  refetches a repository when it detects external modification. Anything that
  mutates a fetched external repo in place will now trigger refetches.
- **Canonical repo names created by `use_repo_rule` changed** to be more
  stable, which may require updating `--override_repository`. GF uses
  `use_repo_rule("@rules_img//img:pull.bzl", "pull")` for its base image; the
  private tooling repo documents an `--override_module` developer escape in
  `.bazelrc.user`. Both want a look.
- **HTTP remote caches gained Zstd / Deflate / Snappy encoding**, and the
  Merkle-tree implementation behind remote caching/execution was reworked for
  "up to a 30% wall time and 70% peak heap reduction". Upside, but see §4 —
  a reworked Merkle tree is precisely a cache-key-affecting change.

### 3.5 Migration-ready flags already flipped by default

The 9.0.0 notes list the flags that flipped, and note they can be pre-tested on
8.x via `bazelisk --migrate` with `BAZELISK_INCOMPATIBLE_FLAGS`. **This is the
single highest-value preparation step and it costs no version bump** — it can
be run today, on 8.2.1, in every repo. Of the flipped set, these touch the
estate:

- `--incompatible_strict_action_env` — the private tooling repo already sets it
  explicitly (its `.bazelrc` cites hermeticity, and its `MODULE.bazel` cites it
  in the TIN-3457 rsync note). Becomes redundant, not harmful. The other repos
  inherit a behaviour change they have not opted into; test there.
- `--incompatible_autoload_externally` (§3.3).
- `--incompatible_bazel_test_exec_run_under`, and the new default
  `--@bazel_tools//tools/test:incompatible_use_default_test_toolchain`, which
  makes test actions select an execution platform matching the **target**
  platform's constraints instead of the first registered execution platform
  (<https://github.com/bazelbuild/bazel/issues/25823>). This directly touches
  remote test execution eligibility, which the `flywheel-executor` config gates
  by `--build_tag_filters`/`--test_tag_filters=flywheel-eligible`. Re-prove the
  eligibility manifest's assumptions under 9 before any executor-backed lane
  moves.
- `--incompatible_disable_native_repo_rules`,
  `--incompatible_repo_env_ignores_action_env`,
  `--incompatible_compact_repo_mapping_manifest`,
  `--incompatible_target_cpu_from_platform`.

Also removed outright: the `--watchfs` *startup* option (the command option
survives), `--experimental_split_xml_generation`,
`--incompatible_sandbox_hermetic_tmp` (use `--sandbox_add_mount_pair=/tmp`).
GF already uses `--sandbox_add_mount_pair=/nix`; the private tooling repo uses
`--sandbox_tmpfs_path=/tmp`, which is a different flag and unaffected.

### 3.6 Module-resolution strictness

> "A `single_version_override` that pins a module to a lower version than
> requested in a `bazel_dep` for that module now results in an error instead of
> silently ignoring the `bazel_dep` version requirement."

Verified at authoring time: **no estate `MODULE.bazel` uses
`single_version_override`**, so this is forward-looking — but it is the class of
change that turns a working graph into a hard resolve failure with no code
change, which is why §6's verification leads with `bazelisk mod graph`
everywhere.

The residual unknown is `rules_nixpkgs_core` 0.13.0 (§2.3), on which both
Nix-integrated repos depend and which drives repository rules and toolchain
resolution — the two areas 9 changed most. Treat a green
`mod graph` there as necessary and not sufficient; require a bounded build that
actually materialises a `nix_pkg` repo.

## 4. Cache-key invalidation blast radius

### 4.1 Why a Bazel version change invalidates cache entries

A remote cache entry is addressed by the action's digest, computed over the
action's Merkle tree: the command line, the environment, the digests of every
input file, **and the tool inputs**. A Bazel major version changes all three of
the things that feed it:

1. **Tool inputs.** The binaries and scripts Bazel injects from `@bazel_tools`
   (test setup and runner scripts, launchers, the `.bzl` files backing
   autoloaded rules) ship *with* Bazel. Their digests change with the release.
2. **Command lines.** Flags that flipped by default (§3.5) change the argv of
   the actions they affect.
3. **The Merkle-tree computation itself was reworked in 9.0** (§3.4).

Net effect: a Bazel major bump does not partially warm a cache — it moves the
repo into a **disjoint key space**. Nothing is corrupted; nothing is shared.

### 4.2 Why that is an estate-wide fact, not a per-repo one

The GloriousFlywheel remote cache is a **shared** substrate keyed by action
digest, not partitioned by consumer repo. That has two consequences that pull
in opposite directions:

- **Good:** an 8.2.1 consumer and a 9.2.0 consumer cannot poison each other.
  They write and read different keys. There is no "mixed-version corruption"
  failure mode to design around.
- **Bad:** during a partial migration the estate runs **two cold-to-warm
  namespaces at once**. Storage roughly doubles for the overlapping window, and
  every repo that has moved gets a ~0% hit rate against work the rest of the
  estate is still doing on the old key space. The cost of a partial migration
  is proportional to *how long it lasts*, not to how many repos it touches.

### 4.3 Who can actually write to the shared cache

This determines the ordering, so it is worth stating exactly. The estate's
default posture is read-mostly:

- The public and template spokes: `.bazelrc.flywheel` sets
  `common:flywheel --remote_upload_local_results=false`, and their
  `build:ci-cached` sets the same. Readers.
- `GloriousFlywheel`: `.bazelrc` sets `build --remote_upload_local_results=false`
  globally, with an explicit comment (its TIN-1462 writer-posture note) that
  ordinary clients may read shared entries but must not upload, and that
  production action-cache writes belong to attested RBE workers enforced
  server-side. Reader, by contract.
- **The private tooling repo is the exception.** Its `.bazelrc.flywheel` sets
  `build:ci-cached --remote_upload_local_results=true` and the same for
  `test:ci-cached`. That lane **populates** the shared cache.

So there is effectively one consumer-side lane in the estate that warms the
shared key space. **Whichever version that lane runs is the version the shared
cache is warm for.** That single fact drives §5.

### 4.4 Ordering rule derived from the above

**Move cache *writers* last; move cache *readers* first, cheapest first.**

The instinct is to move the substrate first. It is wrong here. As long as the
one writing lane stays on 8.2.1, the 8.2.1 key space stays warm for the
majority of the estate that has not moved yet, and every already-moved repo
pays only its own cold rebuild. Move the writer first and you invert it: the
warm namespace stops being refreshed while most consumers still depend on it,
so the *unmigrated* majority degrades — which is both the larger population and
the one with no rollback pressure to justify the pain.

Second rule: **no repo straddles a release.** `.bazelversion` and
`MODULE.bazel.lock` move in one commit (§2.2), and a repo is either fully on
8.2.1 or fully on 9.2.0. There is no supported half-state, because the lockfile
format differs (18 vs 28).

Third rule: **compress the window.** Since the cost is proportional to the
duration of the split, the migration should be scheduled as a campaign with a
target completion, not as opportunistic per-repo drift. Step A's `scaffold-doctor`
row and §7's extension exist to make the remaining split visible while it lasts.

## 5. Migration order

Each step lists its gate, its rollback, and why it sits where it does.

| # | Repo | Gate before starting | Rollback |
| --- | --- | --- | --- |
| 0 | *(all repos)* pre-flight only, no bump | — | n/a |
| 1 | `tinyland-inc/bazel-registry` | Step A landed | revert one commit |
| 2 | in-house modules (this registry) | step 1 green | new versions unused until pinned |
| 3 | `tinyland-inc/site.scaffold` | steps 1–2 green | revert `.bazelversion` + lock commit |
| 4 | `greatfallstoolbus.org` | step 3 green | revert `.bazelversion` + lock commit |
| 5 | the private sibling spoke | step 4 green | revert `.bazelversion` + lock commit |
| 6 | the private tooling repo (**cache writer**) | steps 3–5 green | revert; re-warm 8.2.1 namespace |
| 7 | `GloriousFlywheel` (substrate) | **TIN-2915 CI gate first**; TIN-2299 boundary | revert `.bazelversion` + lock + `WORKSPACE.bazel` restore |

**Step 0 — pre-flight, costs nothing, unblocks everything.** In every repo, on
its current version, run the migration-ready flags (§3.5) via
`bazelisk --migrate` with `BAZELISK_INCOMPATIBLE_FLAGS`, and grep for
`bazel sync` (§3.2). Separately, close the UNVERIFIED rows in §2.3 using the
scratch-checkout method described there — in particular `rules_nixpkgs_core`,
`rules_shell`, `rules_oci`, `rules_cc`, and the `aspect_bazel_lib` → `bazel_lib`
rename. **Nothing after this step should begin while §2.3 still has open rows
for the repo in question.**

**Step 1 — this registry.** Cheapest and safest possible proof: the value here
is inert for direct invocation and binds only by copy into throwaway smoke
workspaces (§2.1), which attach to no remote cache. Flipping `.bazelversion`
(and `package.json`'s `bazelEstate.version`, which `npm run validate`
cross-checks per Step A §1) makes `npm run smoke:resolve` and
`npm run smoke:stage1-consumer` exercise 9.2.0 against real in-house module
metadata, through `bazel mod graph` and a real `bazel build`. If in-house
module metadata is 9-hostile, this is where it surfaces — with zero consumers
affected and a one-commit revert.

**Step 2 — republish in-house modules if step 1 fails.** Per §2.4, this cannot
be an in-place edit; it is new versions under the immutability gate. Publishing
a new version is inert until a consumer pins it, so this step carries no blast
radius of its own — it just has a long lead time, which is why it sits before
every spoke. If step 1 is green, this step is empty.

**Step 3 — the template spoke, before the sites it spawns.** It is the
`site.scaffold` template; anything that breaks here breaks every future spawn.
It already carries the exact-SHA registry pin, so it is also the natural place
to prove the re-pin-plus-relock sequence (Step A §3) under a new Bazel version.

**Steps 4–5 — the spokes.** Reader lanes only. Cold rebuild cost is bounded by
one site build each. Order between them is not load-bearing; the public spoke
is listed first because it is publicly observable and therefore the better
canary.

**Step 6 — the private tooling repo, the one cache writer.** Once it moves, the
shared cache begins warming the 9.2.0 key space and stops refreshing 8.2.1
(§4.3). It goes after every reader precisely so that the switchover happens
when the readers are already on the new side of it. Rollback here is more
expensive than elsewhere: reverting also means the 8.2.1 namespace has to
re-warm, so this step should not be attempted with an open question anywhere in
§2.3. Note it is also the repo with the most UNVERIFIED rows (`rules_oci`
2.3.0 at `["7.x"]` only, `rules_shell` 0.8.0 with no 9.x entry).

**Step 7 — GloriousFlywheel, last.** Two independent reasons, and neither is
about difficulty:

1. **Contract.** GF's bump proceeds under its own contract, with the
   **TIN-2915** CI gate landing first, and the **TIN-2299** boundary means this
   spec does not authorize it (§ Non-goals). Step B can only say where it sits.
2. **Blast radius.** It is two majors back (7.4.0 → 9.2.0), the only repo with
   a lockfile at v11, the only one with a `WORKSPACE.bazel` to delete, the one
   with `--lockfile_mode=error` on CI (§2.2), the one needing a `rules_python`
   major bump (1.4.1 → ≥2.0.0, §2.3), and the substrate everything else caches
   against. Its cold rebuild is the estate's largest single bill, and it should
   be paid once, at the end, when nothing else is still moving.

GF's rollback additionally has to restore `WORKSPACE.bazel` and re-check the
7.4.0-specific `disk_cache` GC workaround its `.bazelrc` documents (§2.1) —
that comment either becomes obsolete under 9 or does not, and the answer should
be recorded in the bump, not rediscovered in the revert.

## 6. Verification commands per repo

Run in this order. Each command's failure mode is stated, because "it printed a
graph" is not the same as "it works".

**Every Bzlmod repo — resolution proof (do this first, always):**

```bash
bazelisk mod graph
```

Proves module resolution succeeds under the pinned version and the pinned
registry chain. Catches §3.6 resolve failures and every floor violation in
§2.3. It does **not** prove anything builds.

**`tinyland-inc/bazel-registry` (this repo)** — it has no Justfile; its checks
are npm scripts, matching Step A §5:

```bash
npm run validate              # static; also cross-checks .bazelversion vs bazelEstate.version
sh scripts/check-immutable-versions.sh main
npm run smoke:resolve         # copies .bazelversion into a temp workspace, runs bazel mod graph
npm run smoke:stage1-consumer # same, plus a real bazel build of consumer targets
```

The two smoke scripts need `TINYLAND_REGISTRY_GITHUB_TOKEN` (and
`GITHUB_TOKEN` for stage 1) per `.github/workflows/validate.yml`; they are the
only steps here that touch the network.

**`greatfallstoolbus.org` and `tinyland-inc/site.scaffold`:**

```bash
just bazel-graph          # bazelisk mod graph under an isolated --output_user_root
just bazel-query          # BUILD target shape proof; not a cache/RBE proof
just check                # the repo's own aggregate gate
just scaffold-doctor      # includes Step A §5 rows; §7 extends it
just build                # canonical site build
just flywheel-doctor && just flywheel-verify   # fail-closed enrollment gate
just cache-contract-strict                     # asserts real shared-cache attachment
just flywheel-build       # cache-backed Bazel build through the wrapper
```

Order matters: `flywheel-doctor` / `flywheel-verify` before any
`flywheel-*` build, per the cold-start rule in the `tinyland-flywheel-bazel`
skill. `cache-contract-strict` is what distinguishes a genuine remote-cache
attachment from an incidental local disk-cache hit — which is exactly the
distinction §4 depends on, since a "green" build served entirely from
`--disk_cache` proves nothing about the shared key space.

**`GloriousFlywheel`:**

```bash
bazelisk mod graph
just bazel-lockfile-check          # must be re-proved against lockFileVersion 28
just bazel-lockfile-contract-check
just cache-contract-strict
just bazel-build-cached
```

`--lockfile_mode=error` on its CI lanes means the lockfile check is not
advisory here (§2.2).

**The private tooling repo:** it carries a `.bazelrc.flywheel` and
`.bazelrc.user` but **no `flywheel-*` or `bazel-*` Just recipes**, so
verification is direct invocation:

```bash
bazelisk mod graph
bazelisk build //...
bazelisk test  //...
bazelisk build --config=remote //...     # endpoint supplied by the wrapper, never by rc
```

Its `build:remote` sets `--remote_local_fallback=false` deliberately ("fail
loud: a remote-cache outage must surface as a red build"), so a remote-config
run failing on cache reachability is the configured behaviour, not a migration
regression. Distinguish the two before filing anything.

**Cross-cutting, once more than one repo has moved:** re-run
`cache-contract-strict` in an *unmigrated* repo. §4.2 predicts its hit rate
holds while §4.3's writer lane is still on 8.2.1; if it collapses early, the
ordering assumption is wrong and step 6 should be reconsidered before it runs.

## 7. `scaffold-doctor` conformance extension

### 7.1 The gap Step A leaves open, restated in one sentence

Step A §5 row 2 checks a spoke's root `.bazelversion` against the value that
spoke recorded next to its registry pin (`# estate-bazelversion: <x.y.z>` in
`.bazelrc`), offline; Step A states plainly that this cannot detect that the
estate value moved in the registry *after* the spoke pinned, so a spoke that
never re-pins sits on a stale-but-self-consistent value. Step B closes that
gap without touching row 2 and without giving up the offline property. See
Step A §5 for what row 2 proves; it is not repeated here.

### 7.2 Row 3 — pin freshness (offline, default on)

**Extend the recorded line to carry the SHA it was read from:**

```
# estate-bazelversion: 8.2.1 @ 9f2c1ab...   (40-char registry commit SHA)
```

Row 3 then asserts, with no network:

1. The recorded SHA **equals** the 40-char SHA in the `common --registry=`
   line of the same `.bazelrc`.
2. The recorded value still equals root `.bazelversion` (this is row 2's job;
   row 3 depends on it and does not duplicate it).

This catches the exact failure Step A §5 names: **the spoke bumped its registry
SHA and forgot to re-read `.bazelversion` at the new commit.** Step A §3 already
requires the re-pin to be a deliberate, self-contained commit that also
refreshes `MODULE.bazel.lock`; row 3 makes "…and re-record the estate value"
mechanically enforced rather than a convention. It fails closed when the
recording is absent or malformed, matching row 2's posture.

Cost to a spoke: one extra token on a comment line it already carries.

### 7.3 Row 3-online — value freshness (opt-in, network)

Behind an explicit opt-in (`--online`, or
`SCAFFOLD_DOCTOR_ALLOW_NETWORK=1`) — never the default, so the no-network
invariant Step A §5 states for `scaffold-doctor` is preserved:

1. Fetch `https://raw.githubusercontent.com/tinyland-inc/bazel-registry/<pinned-sha>/.bazelversion`
   and assert it equals the recorded value. A mismatch is a **hard failure**:
   the spoke recorded something the registry never said at that commit.
2. Fetch the same path at `main` and compare. A difference is a **warning, not
   a failure.**

Warning, not failure, is load-bearing. "The estate has moved ahead of this
spoke" is a scheduling fact, and during a Step B campaign it is the *expected*
state for every repo that has not reached its turn in §5. Failing on it would
make one registry commit turn every spoke's CI red simultaneously — the exact
coupling the exact-SHA pin exists to prevent.

### 7.4 Estate-wide reporting without a second implementation

`scaffold-doctor` is per-repo by construction. Rather than build a parallel
estate-wide checker, row 3 emits one machine-readable record alongside its
human row:

```
repo, recorded_value, recorded_sha, pinned_sha, value_at_pin, value_at_main, verdict
```

`value_at_pin` / `value_at_main` are populated only in online mode and empty
otherwise. A fleet job collects one record per repo and renders the §2.1 table
as live state — so the migration's remaining split (§4.2, §4.4) is observable
for as long as it lasts, from data the per-repo gate already computes.

Non-spoke repos are out of scope for `scaffold-doctor` by definition. This
registry is not a `site.scaffold` spoke and has no such recipe; its side of the
contract stays `npm run validate` plus the immutability gate, as Step A §5
states.

### 7.5 Deliberately not proposed here

A registry-side gate asserting that no published in-house module pins a
`rules_*` version below the estate's 9.x floor (§2.4) would be useful — and it
is a **new gate on published, immutable content**, which is a different kind of
decision from extending an existing conformance row. It is noted as a Step C
candidate, not specified here.

## 8. Open items

Carry these into the Step B execution issue; none is resolved by this document.

1. **UNVERIFIED 9.x floors** (§2.3): `rules_nixpkgs_core` 0.13.0 (highest
   risk — both Nix repos), `rules_shell` (no 9.x entry at any published
   version), `rules_oci` (7.x only at latest), `rules_cc`, `bazel_skylib`,
   `platforms`, `rules_pkg`. Close them with the scratch-checkout method in
   §2.3, not from changelogs.
2. **`aspect_bazel_lib` → `bazel_lib` rename** (§2.3). Confirm the 3.x line is
   the only 9.x-viable path, and scope the `bazel_dep` rename across both 8.x
   spokes, GF, and every in-house module.
3. **In-house module republishing** (§2.4). Determine, at step 1, whether the
   shipped modules resolve and build under 9.2.0 as-is. If not, this becomes
   the critical path and needs its own issue before any spoke moves.
4. **GF's 7.4.0 `disk_cache` GC workaround** (§2.1) — obsolete under 9 or not.
5. **Executor eligibility under the new test-toolchain default** (§3.5) —
   re-prove the `flywheel-eligible` manifest's assumptions before any
   executor-backed lane moves.
