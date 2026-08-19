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
  the Bazel 9.x migration spec (Step B, TIN-3897). Follows Step A; specifies
  the readiness matrix, the 8→9 breaking changes that bind here, the
  shared-cache blast radius, and the migration/rollback order. Bumps nothing
  by itself.
```

The same follow-up should correct the tail of Step A's own README bullet, which
currently says Step B is "tracked in its own repos' issues (TIN-3858 /
TIN-3859)". Step B is this document, authored here under **TIN-3897**; suggested
replacement for that sentence:

```markdown
  Step B (Bazel 9.x migration) is specified separately in
  `docs/bazel-9x-migration-spec-v0.md` (TIN-3897).
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
  its own contract, and GF's own merge-gate ticket lands first. Step B
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
| the private tooling repo | 7.6.0 | Bzlmod only; no `WORKSPACE*` file | 13 | BCR only (no in-house registry lane) |
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
- **The registry's own `.bazelversion` is inert for direct invocation and binds
  only by copy** — see Step A §1 for the mechanism. That makes this repo the
  cheapest possible place to prove a new Bazel version: flipping the value here
  exercises 9.x, through the smoke scripts, in a real
  `bazel mod graph` / `bazel build` against real in-house module metadata,
  with **zero remote-cache attachment and zero consumer blast radius**. §5
  makes that step 1.

### 2.2 Lockfile format

The `MODULE.bazel.lock` schema version is not called out in the 9.0.0 release
notes, so it was measured rather than assumed. A throwaway Bzlmod workspace
(one `bazel_dep`, BCR only, no cache attachment) was resolved under 9.2.0; the
other rows are read from the estate repos' committed lockfiles.

| Bazel | `lockFileVersion` | Source |
| --- | --- | --- |
| 7.4.0 | 11 | committed lockfile, `GloriousFlywheel` |
| 7.6.0 | 13 | committed lockfile, the private tooling repo |
| 8.2.1 | 18 | committed lockfiles, both 8.x spokes; also reproduced in a scratch workspace |
| **9.2.0** | **28** | **measured** — `bazelisk mod graph` in a scratch workspace |

Only the 9.2.0 and 8.2.1 rows were produced by running Bazel here; 11 and 13
are observed from committed artifacts and attributed to the version each repo
pins.

Consequence: **every repo's lockfile is rewritten wholesale on the bump.** The
diff is not reviewable line-by-line and should not be treated as if it were;
review the `.bazelversion` line and the resolved versions in
`bazelisk mod graph` output instead.

**The failure mode is silence, not a red build.** This was reproduced: with a
v18 lockfile in place, `bazelisk mod graph` under 9.2.0 exits 0, emits **no
lockfile message whatsoever**, and rewrites the file to v28 in place. So a repo
whose `.bazelversion` and lockfile disagree does not fail — it quietly produces
a 700-line lockfile diff inside whatever commit happened to run Bazel next.
That is worse than a hard failure, and it is the reason `.bazelversion` and
`MODULE.bazel.lock` must move in the *same* commit.

The one exception is `GloriousFlywheel`, the only estate repo that opts into
strictness: its `.bazelrc` sets `common:ci --lockfile_mode=error`, so a stale
lock is a hard CI failure there by design. The private tooling repo sets
`--lockfile_mode=update` explicitly and both spokes leave it unset (Bazel's
default is `update`), so all three are exposed to the silent-rewrite behaviour.
GF also has a `just bazel-lockfile-check` recipe that must be re-proved against
the v28 format.

### 2.3 `rules_*` dependency floors for Bazel 9

**Method, and its limits.** Ruleset GitHub release notes are boilerplate ("Add
to your MODULE.bazel…") and state nothing about Bazel compatibility;
`bazel_compatibility` is absent on most of these modules and carries no upper
bound where present. The best machine-readable signal available is the `bazel:`
test matrix in `modules/<name>/<version>/presubmit.yml` in
`bazelbuild/bazel-central-registry` — the Bazel versions BCR actually runs that
module version against. Floors below were found by bisecting adjacent published
versions with a parser that handles **both** YAML flow sequences
(`bazel: [7.x, 8.x]`) and block sequences (items on following lines); the task
line `bazel: ${{ bazel }}` is the matrix *consumer* and is not a declaration.

This signal has a **known false-negative rate, and it is not small**. A
presubmit matrix records what BCR was told to test at publication time; it is
not a compatibility declaration and it goes stale. The clearest proof is in
this very table: `rules_nixpkgs_core` declares `["6.x"]` only, yet both
Nix-integrated estate repos run it on 7.4.0 and 7.6.0 in daily use. `rules_pkg`
is similar in shape — its matrix *narrowed* from `[7.x, 8.x]` at 1.1.0 to
`[8.x]` at 1.2.0/1.3.0. **A missing 9.x entry is a prompt to test, not a
finding of incompatibility.** Rows below are therefore split into two classes,
which have different remedies.

**Class A — below floor.** A newer published version *is* 9.x-tested, so the
remedy is a known version bump.

| Module | In use | 9.x floor | Evidence |
| --- | --- | --- | --- |
| `aspect_rules_js` | 2.9.1 (both 8.x spokes, **all in-house modules**), 2.9.2 (GF) | **3.0.0** | 2.9.1 `['8.x','7.x','6.x']`; 2.9.2 `['rolling','8.x','7.x','6.x']`; 3.0.0 `['7.x','8.x','9.x']`. Major-version bump. |
| `aspect_rules_ts` | 3.8.4 (spokes, in-house), 3.8.3 (GF) | **3.8.7** | 3.8.6 `['8.x','7.x']`; 3.8.7 `['9.x','8.x','7.x']`. Patch-level. |
| `aspect_rules_swc` | 2.6.1 (both 8.x spokes) | **2.7.1** | 2.7.0 `['8.x','7.x']`; 2.7.1 `['9.x','8.x','7.x']`. Minor. |
| `aspect_bazel_lib` → `bazel_lib` | 2.22.5 (both 8.x spokes, GF, **all in-house modules**) | **`bazel_lib` 3.7.1** | 2.22.4 / 2.22.5 `['7.x','8.x']` — below floor. The 3.x line is published under a **different module name**: `bazel_lib` 3.0.0–3.5.0 `['7.x','8.x','rolling']`, 3.6.0 / 3.7.0 `['7.x','8.x','9.0.0','rolling']`, **3.7.1 `['7.x','8.x','9.x','rolling']`**. 3.6.0 is the earliest with any 9 entry, but it pins 9.0.0 exactly; 3.7.1 is the first covering the 9.x line the estate targets. Both modules' `metadata.json` point at the same upstream repo, and `bazel_lib` 3.0.0 declares `name = "bazel_lib"` at `compatibility_level = 1`. **This is a `bazel_dep` rename, not a version bump.** |
| `bazel_skylib` | 1.8.2 (spokes, GF, in-house), 1.9.2 (tooling repo) | **1.9.2** | 1.8.1 / 1.8.2 / 1.9.0 `['8.x','7.x','6.x']`; 1.9.2 `['9.x','8.x','7.x']`. Tooling repo already met. |
| `platforms` | 1.0.0 (spokes, in-house), 0.0.10 (GF), 1.1.0 (tooling repo) | **1.1.0** | 0.0.10 `['7.x','6.x']`; 0.0.11 / 1.0.0 `['8.x','7.x','6.x']`; 1.1.0 `['9.x','8.x','7.x','6.x']`. Tooling repo already met. |
| `rules_python` | 1.4.1 (GF), 2.2.0 (tooling repo) | **1.8.0** | 1.4.1 / 1.6.1 / 1.6.3 `[7.x, last_rc]`; 1.7.0 `['7.x','8.x']`; **1.8.0 `['7.*','8.*','9.*']`**. A minor bump inside the 1.x line — GF does **not** need a major-version move. Tooling repo already past it. |

**Class B — floor already met.** No action.

| Module | In use | Evidence |
| --- | --- | --- |
| `rules_cc` | 0.2.18 (GF), 0.2.22 (tooling repo) | both `['7.x','8.x','9.x']` |
| `rules_nodejs` | 6.7.3 (all JS consumers + all in-house modules) | `['7.x','8.x','9.*']` |
| `rules_rust` | 0.70.0 (GF) | `['7.x','8.x','9.x']` |
| `rules_go` | 0.60.0 (GF), 0.62.0 (tooling repo) | both `['7.*','8.*','9.*']` |
| `gazelle` | 0.52.2 (tooling repo) | `['7.*','8.*','9.*']` |
| `rules_img` | 0.3.4 (GF) | `['7.x','8.x','9.*']` |
| `buildifier_prebuilt` | 8.5.1.2 (in-house `rules_tectonic`, dev-only) | `['7.x','8.x','9.x']` |
| `stardoc` | 0.8.1 (in-house `rules_tectonic`, dev-only) | `['9.x','8.x','7.x']` |

**Class C — no 9.x coverage at any published version.** Nothing to bump to;
these can only be settled empirically, and per the false-negative caveat above
a missing entry is not evidence of breakage.

| Module | In use | Latest published matrix |
| --- | --- | --- |
| `rules_pkg` | 1.1.0 (spokes), 1.2.0 (GF), 1.3.0 (tooling repo) | 1.1.0 `['7.x','8.x']`; 1.2.0 / 1.3.0 `['8.x']` — matrix *narrowed* over time |
| `rules_shell` | 0.6.0 (GF), 0.8.0 (tooling repo, in-house `rules_tectonic` dev-only) | 0.6.0 / 0.8.0 `['6.x','7.x','8.x']` |
| `rules_oci` | 2.3.0 (tooling repo) | `['7.x']` |
| `rules_nixpkgs_core` | 0.13.0 (GF **and** tooling repo) | 0.12.0 / 0.13.0 `['6.x']` — demonstrably stale; in daily use on 7.x |

In-house modules published by this registry carry no BCR presubmit at all
(`rules_tectonic` included), so this method says nothing about them; §2.4 and
§5 step 1 cover them directly.

**How to settle a Class C row.** Resolve the repo's real graph under 9.2.0 in a
scratch checkout — `USE_BAZEL_VERSION=9.2.0 bazelisk mod graph`, then a bounded
`USE_BAZEL_VERSION=9.2.0 bazelisk build` of one representative target — with
**no remote cache attached** (§4 explains why that matters). For
`rules_nixpkgs_core` require a bounded build that actually materialises a
`nix_pkg` repo; a green `mod graph` is necessary and not sufficient.

### 2.4 The in-house modules in this registry are themselves below the floor

This is the finding that puts Step B in *this* repo rather than in a spoke.

The four modules both 8.x spokes depend on — `tummycrypt_tinyland_color_utils`,
`tummycrypt_vite_plugin_a11y`, `tummycrypt_vite_plugin_skeleton_colors`,
`tummycrypt_tinyvectors` — every published version pins, in its own
`MODULE.bazel` (`tummycrypt_tinyvectors` omits `aspect_rules_ts`; the other
five lines hold for it too):

```
bazel_dep(name = "aspect_bazel_lib", version = "2.22.5")   # below floor + renamed at 3.x
bazel_dep(name = "aspect_rules_js",  version = "2.9.1")    # below the 3.0.0 floor
bazel_dep(name = "aspect_rules_ts",  version = "3.8.4")    # below the 3.8.7 floor
bazel_dep(name = "bazel_skylib",     version = "1.8.2")    # below the 1.9.2 floor
bazel_dep(name = "platforms",        version = "1.0.0")    # below the 1.1.0 floor
bazel_dep(name = "rules_nodejs",     version = "6.7.3")    # already 9.x-tested
```

Five of six are below floor. The pattern repeats across other published
in-house modules (for example `tummycrypt_scheduling_kit` 0.11.1 pins
`bazel_skylib` 1.8.2, `platforms` 1.0.0, `aspect_rules_js` 2.9.1,
`aspect_rules_ts` 3.8.4, `aspect_rules_swc` 2.6.1) — this is a registry-wide
convention, not four unlucky modules.

Bzlmod's minimal-version-selection means a consumer that raises its own
`aspect_rules_js` to 3.0.0 raises it for the whole graph, so a spoke *can*
reach the floor without the registry moving — the in-house pins are lower
bounds, not ceilings. But two things still bind:

1. **A module whose targets were only ever built against `aspect_rules_js`
   2.9.x is not thereby proven against 3.x.** The template spoke graph-links
   these modules' `pkg` targets directly, and its `MODULE.bazel` already
   records one in-house version whose producer target could not build under the
   sandbox at all — which is why a later version is pinned. Those producer
   targets are exactly what a rules_js major bump is most likely to break, and
   they are built from *this* registry's metadata.
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
> from Bazel." … "The `--enable_bzlmod` and `--enable_workspace` flags are now
> no-ops."

(9.0.0 release notes,
<https://github.com/bazelbuild/bazel/releases/tag/9.0.0>; background in
<https://github.com/bazelbuild/bazel/issues/26131>.)

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

> "`--incompatible_autoload_externally` now defaults to the empty string […]
> meaning that all language-specific rules will now need to be loaded from
> their respective modules".

(Both quoted from the 9.0.0 release notes,
<https://github.com/bazelbuild/bazel/releases/tag/9.0.0>; background in
<https://github.com/bazelbuild/bazel/issues/23043>.)

Bindings: `GloriousFlywheel` depends on `rules_cc` 0.2.18 and sets
`build --incompatible_enable_cc_toolchain_resolution`, with a `MODULE.bazel`
comment explaining that Bazel auto-detects a system `cc` toolchain under that
flag while `rules_cc` supplies the rule definitions. That split is exactly what
9 formalises, so GF's posture is already correct in shape. **Both `rules_cc`
versions in the estate (0.2.18 and 0.2.22) are already 9.x-tested** (§2.3
Class B), so no dependency bump is required here. What remains is source-level:
every `.bzl` load of a C++ rule must now come from `@rules_cc`, because
autoloading no longer papers over a missing load.

### 3.4 Remote-execution and cache flag changes

- **`--remote_default_platform_properties` and its
  `--host_platform_remote_properties_override` synonym are removed**; use
  `--remote_default_exec_properties`. **The estate is already on the correct
  flag** — `.bazelrc.flywheel` in both 8.x spokes documents that the wrapper
  supplies worker platform identity via `--remote_default_exec_properties`.
  No change needed; recorded so nobody "fixes" it into the removed spelling.
- **`--experimental_remote_cache_compression` is deprecated in favour of
  `--remote_cache_compression`.** Not in the 9.0.0 notes; reproduced directly
  under 9.2.0, which emits
  `WARNING: Option 'experimental_remote_cache_compression' is deprecated: Use
  --remote_cache_compression instead` and accepts the new spelling silently.
  The old spelling is set on the private tooling repo's cache-writing lanes in
  its `.bazelrc.flywheel`. A warning, not a failure — but it is set on exactly
  the lanes §4.3 cares about, so rename it as part of that repo's step.
- **`--experimental_worker_for_repo_fetching` is removed.**
- **New `--repo_contents_cache`**, defaulting to a `contents` directory under
  `--repository_cache`. GF sets a durable per-machine `--repository_cache` for
  developers and neutralises it in its rc with `build:ci --repository_cache=`,
  but its CI lanes override that neutralisation with an explicit
  `--repository_cache` under `RUNNER_TEMP` on the command line. Under 9 the
  repo-contents cache lands there too, with the same lifetime as the
  repository cache has today. No change needed; re-measure only.
- **`--experimental_check_external_repository_files` (default on)** now
  refetches a repository when it detects external modification.
- **Canonical repo names created by `use_repo_rule` changed** to be more
  stable, which may require updating `--override_repository`. GF uses
  `use_repo_rule` for its base image pull; repos carrying local module or
  repository overrides should re-check them.
- **`--incompatible_legacy_local_fallback` is a no-op in 9** (listed among the
  flags whose migration window has closed). Repos that deliberately set
  `--remote_local_fallback=false` to make a cache outage a red build keep that
  behaviour — the *explicit* flag still works; only the legacy compatibility
  toggle is gone.
- **HTTP remote caches gained Zstd / Deflate / Snappy encoding**, and the
  Merkle-tree implementation behind remote caching/execution was reworked for
  "up to a 30% wall time and 70% peak heap reduction". Upside, but see §4 —
  the note describes an implementation rework, and action and input-root
  digests are defined by the REAPI wire encoding, so a performance rework need
  not change keys; treat it as something that *may* affect them.

### 3.5 Python runtime configuration

> "Python rules can no longer set runtimes with `--python_top`
> (`--incompatible_use_python_toolchains=false` no longer works)."

Both Nix-integrated repos carry `rules_python` and configure interpreters
through the `python.toolchain` extension rather than `--python_top`, so the
expected impact is low — but this is the change most likely to surface as a
confusing toolchain-resolution error rather than a clean flag error, and GF is
additionally below the `rules_python` 9.x floor (1.4.1 vs 1.8.0, §2.3). Move
`rules_python` to at least 1.8.0 *before* flipping GF's `.bazelversion`, so a
Python failure after the flip cannot be ambiguous between "9 changed Python" and
"the ruleset predates 9". Upstream guidance:
<https://rules-python.readthedocs.io/en/latest/toolchains.html>.

### 3.6 Migration-ready flags already flipped by default

The 9.0.0 notes list the flags that flipped, and note they can be pre-tested on
8.x via `bazelisk --migrate` with `BAZELISK_INCOMPATIBLE_FLAGS`. **This is the
single highest-value preparation step and it costs no version bump** — it can
be run today, on 8.2.1, in every repo. Of the flipped set, these touch the
estate:

- `--incompatible_autoload_externally` (§3.3).
- `--incompatible_disable_autoloads_in_main_repo`
  (<https://github.com/bazelbuild/bazel/issues/25755>) — the same
  Starlarkification change applied to the main repo specifically. Pairs with
  §3.3: a main-repo `BUILD`/`.bzl` file relying on an autoloaded native rule
  breaks here even if every external repo is clean.
- `--incompatible_strict_action_env` — the private tooling repo already sets it
  explicitly for hermeticity. Becomes redundant, not harmful. The other repos
  inherit a behaviour change they have not opted into; test there.
- `--incompatible_bazel_test_exec_run_under`, and the new default
  `--@bazel_tools//tools/test:incompatible_use_default_test_toolchain`, which
  makes test actions select an execution platform matching the **target**
  platform's constraints instead of the first registered execution platform
  (<https://github.com/bazelbuild/bazel/issues/25823>). This directly touches
  remote test execution eligibility, which the `flywheel-executor` config gates
  by `--build_tag_filters` / `--test_tag_filters`. Re-prove the eligibility
  manifest's assumptions under 9 before any executor-backed lane moves.
- `--incompatible_use_python_toolchains` (§3.5).
- `--incompatible_disable_native_repo_rules`,
  `--incompatible_repo_env_ignores_action_env`,
  `--incompatible_compact_repo_mapping_manifest`,
  `--incompatible_target_cpu_from_platform`.

Also removed outright: the `--watchfs` *startup* option (the command option
survives), `--experimental_split_xml_generation`,
`--incompatible_sandbox_hermetic_tmp` (use `--sandbox_add_mount_pair=/tmp`).
GF already uses `--sandbox_add_mount_pair` for its Nix store mount; the private
tooling repo uses `--sandbox_tmpfs_path=/tmp`, a different flag, unaffected.

### 3.7 Module-resolution strictness

> "A `single_version_override` that pins a module to a lower version than
> requested in a `bazel_dep` for that module now results in an error instead of
> silently ignoring the `bazel_dep` version requirement."

Verified at authoring time: **no estate `MODULE.bazel` uses
`single_version_override`**, so this is forward-looking — but it is the class of
change that turns a working graph into a hard resolve failure with no code
change, which is why §6's verification leads with `bazelisk mod graph`
everywhere.

## 4. Cache-key invalidation blast radius

### 4.1 Why a Bazel version change invalidates cache entries

A remote cache entry is addressed by the action's digest, computed over the
action's Merkle tree: the command line, the environment, the digests of every
input file, **and the tool inputs**. A Bazel major version changes all three of
the things that feed it:

1. **Tool inputs.** The binaries and scripts Bazel injects from `@bazel_tools`
   (test setup and runner scripts, launchers, the `.bzl` files backing
   autoloaded rules) ship *with* Bazel. Their digests change with the release.
2. **Command lines.** Flags that flipped by default (§3.6) change the argv of
   the actions they affect.
3. **The Merkle-tree computation itself was reworked in 9.0** (§3.4) —
   a *may*, not a *does*; items 1–2 alone carry the conclusion.

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
  namespaces at once**, so every repo that has moved gets a low hit rate
  against work the rest of the estate is still doing on the old key space. The
  cost of a partial migration is proportional to *how long it lasts*.

On storage: action-cache entries genuinely double, because the AC is keyed by
action digest and the same logical action yields two digests. The CAS is
content-addressed, so identical output blobs deduplicate across both
namespaces and do **not** double. Expect AC growth plus whatever new blobs the
new toolchain actually produces — not a doubling of the substrate.

### 4.3 Who can write to the shared cache

The estate's *default* posture is read-only: `.bazelrc` / `.bazelrc.flywheel`
defaults across the spokes and GF set
`--remote_upload_local_results=false`, and GF's rc states the general rule that
ordinary clients read shared entries but do not upload.

**That default is not the whole inventory, and reading only the rc files
understates it.** Verified at authoring time, more than one lane can write:

- The shared `gloriousflywheel-bazel.sh` wrapper both spokes carry appends
  `--remote_upload_local_results=true` when its upload environment variable is
  set. Because the wrapper appends after the rc files are read, **it overrides
  the `false` default** — so a spoke is a writer whenever a trusted lane
  enables it, not never.
- At least one release-proof workflow in the substrate repo invokes Bazel with
  upload enabled explicitly.
- The private tooling repo enables upload on more than one lane in its own rc
  files.
- Production action-cache writes from attested remote workers are a separate,
  server-side-enforced path that does not appear in any consumer rc file at
  all.

The precise per-lane inventory — which lane, in which repo, under which
trigger — is deliberately **not** enumerated in this public document; it
belongs in the execution issue. What the migration needs from it is only this:
**writers are plural, they are not confined to one repo, and at least one of
them is a lane the rc files appear to mark read-only.** Any ordering argument
that assumes a single writer is wrong.

### 4.4 Ordering rule derived from the above

**The baseline is not what "converge on 8.2.1 first" suggests.** After Step A
the two spokes *read* on 8.2.1, but no cache-writing lane in the estate runs
8.2.1: the substrate repo is on 7.4.0 and the private tooling repo on 7.6.0.
So the 8.2.1 key space is populated only by whatever spoke lanes have upload
enabled — the spokes are largely reading a namespace that little else fills.
Two consequences:

1. **"Keep the 8.2.1 namespace warm" is not, by itself, a valid reason to
   sequence anything**, because at baseline it is not demonstrably warm. The
   ordering below rests on blast radius and on gate/contract order, not on a
   warmth claim.
2. **The hit rate has to be measured before it can be reasoned about.** No
   cross-repo action overlap has been demonstrated here — different repos
   building different languages may share almost no action digests, in which
   case the "shared warmth" framing is close to vacuous and the migration is
   simply N independent cold rebuilds. Measuring this is a step-0 action
   (§5), not an assumption this spec is entitled to make. It could not be
   measured while authoring: `cache-contract-strict` requires a live cache
   endpoint supplied from the fleet profile, which was not available.

Given that, the ordering rules that *do* hold:

- **Prove on the cheapest surface first.** This registry's smoke workspaces
  attach to no cache at all, so step 1 costs nothing and can invalidate the
  whole plan early.
- **Move cache *writers* after cache *readers*, and move them deliberately.**
  Not because the old namespace is warm, but because a writer flip changes
  which namespace *becomes* warm; doing that while readers are still split
  across both versions maximises the window in which neither namespace serves
  anyone well. Once measurement (rule 2) lands, this rule should be re-derived
  against real numbers.
- **No repo straddles a release.** `.bazelversion` and `MODULE.bazel.lock` move
  in one commit (§2.2) — mandatory, because the mismatch is silent rather than
  loud.
- **Compress the window.** Schedule the migration as a campaign with a target
  completion, not as opportunistic per-repo drift. §7's `scaffold-doctor`
  extension exists to make the remaining split visible while it lasts.

## 5. Migration order

Each step lists its gate, its rollback, and why it sits where it does.

| # | Repo | Gate before starting | Rollback |
| --- | --- | --- | --- |
| 0 | *(all repos)* pre-flight + measurement, no bump | — | n/a |
| 1 | `tinyland-inc/bazel-registry` | step 0 done | revert one commit |
| 2 | in-house modules (this registry) | **step 1 run** (empty if step 1 was green) | new versions inert until pinned |
| 3 | `tinyland-inc/site.scaffold` | steps 1–2 green | revert `.bazelversion` + lock commit |
| 4 | `greatfallstoolbus.org` | step 3 green | revert `.bazelversion` + lock commit |
| 5 | the private sibling spoke | step 4 green | revert `.bazelversion` + lock commit |
| 6 | the private tooling repo (**writes cache**) | steps 3–5 green | revert `.bazelversion` + lock commit |
| 7 | `GloriousFlywheel` (substrate) | **GF's own merge-gate ticket first**; TIN-2299 boundary | revert `.bazelversion` + lock + restore `WORKSPACE.bazel` |
| 8 | remote worker fleet | out of scope here — see below | owned elsewhere |

**Step 0 — pre-flight, costs nothing, unblocks everything.** Four actions, all
on current versions:

1. Run the migration-ready flags (§3.6) via `bazelisk --migrate` with
   `BAZELISK_INCOMPATIBLE_FLAGS` in every repo.
2. Settle every Class C row in §2.3 by the scratch-checkout method — in
   particular `rules_nixpkgs_core`, plus `rules_shell`, `rules_oci`, `rules_pkg`.
3. Scope the Class A bumps, including the `aspect_bazel_lib` → `bazel_lib`
   **rename** across both 8.x spokes, GF, and every in-house module.
4. **Measure the shared-cache hit rate** across at least one pair of repos, per
   §4.4 rule 2. If cross-repo action overlap turns out to be negligible, steps
   6 and 7 lose their ordering constraint and the campaign can parallelise —
   so this measurement can materially shorten the whole plan.

Nothing after this step should begin while §2.3 still has open rows for the
repo in question.

**Step 1 — this registry.** Cheapest and safest possible proof: the value here
is inert for direct invocation and binds only by copy into throwaway smoke
workspaces (§2.1), which attach to no remote cache. Flipping `.bazelversion`
(and `package.json`'s `bazelEstate.version`, which `npm run validate`
cross-checks) makes the two smoke scripts exercise 9.2.0 against real in-house
module metadata through a real `bazel mod graph` and a real `bazel build`. If
in-house module metadata is 9-hostile, this is where it surfaces — with zero
consumers affected and a one-commit revert.

**Step 2 — republish in-house modules as needed.** Per §2.4 this cannot be an
in-place edit; it is new versions under the immutability gate. The gate here is
that step 1 has *run*, not that it passed: if step 1 was green this step is
empty, and if it failed this step is the remedy. Publishing a new version is
inert until a consumer pins it, so this step carries no blast radius of its
own — it just has a long lead time, which is why it sits before every spoke.

**Step 3 — the template spoke, before the sites it spawns.** Anything that
breaks here breaks every future spawn. It already carries the exact-SHA
registry pin, so it is also the natural place to prove the re-pin-plus-relock
sequence (Step A §3) under a new Bazel version.

**Steps 4–5 — the spokes.** Cold rebuild cost is bounded by one site build
each. Order between them is not load-bearing; the public spoke is listed first
because it is publicly observable and therefore the better canary.

**Step 6 — the private tooling repo.** It has cache-writing lanes (§4.3), so
its flip changes which namespace gets warmed. It also carries the most Class C
dependencies (`rules_oci`, `rules_shell`, `rules_pkg`, `rules_nixpkgs_core`),
which is the stronger reason to put it late: it has the most that can only be
settled empirically. Rename its deprecated cache-compression flag (§3.4) in the
same change.

**Step 7 — GloriousFlywheel, last.** Two independent reasons, neither about
difficulty:

1. **Contract.** GF's bump proceeds under its own contract, with GF's own
   merge-gate ticket landing first, and the **TIN-2299** boundary means this
   spec does not authorize it (§ Non-goals). Step B can only say where it sits.
2. **Blast radius.** It is two majors back (7.4.0 → 9.2.0), the only repo with
   a lockfile at v11, the only one with a `WORKSPACE.bazel` to delete, the only
   one that fails closed on a stale lock (§2.2), the one needing the
   `rules_python` bump to ≥1.8.0 (§2.3, §3.5), and the substrate everything
   else caches against.

GF's rollback additionally has to restore `WORKSPACE.bazel` and re-check the
7.4.0-specific `disk_cache` GC workaround its `.bazelrc` documents (§2.1) —
that comment either becomes obsolete under 9 or does not, and the answer should
be recorded in the bump, not rediscovered in the revert.

**Step 8 — the remote worker fleet is out of scope for this spec.** Attested
remote workers are a distinct action-cache writer (§4.3) and their toolchain
version is not carried in any repo's `.bazelversion`, so it cannot be sequenced
by the mechanism Step A defines. It sits with the cache/apply-plane authority
under the TIN-2299 boundary, exactly as Step A's deferral paragraph describes.
**The ordering above survives its exclusion** only in the weak sense that
steps 1–7 are internally consistent without it; if worker-produced entries turn
out to be the dominant source of cache hits for consumer lanes, then step 0's
measurement will show it and the fleet must be sequenced explicitly before
step 6. Flagging that dependency is the most this document can responsibly do.

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

**The private tooling repo:** it carries no `flywheel-*` or `bazel-*` Just
recipes, so verification is direct invocation:

```bash
bazelisk mod graph
bazelisk build //...
bazelisk test  //...
```

Before filing any cache-related migration bug against a repo, read that repo's
own rc first: some estate repos deliberately disable local fallback so that a
remote-cache outage surfaces as a red build. A cache-config run failing on
reachability is then the configured behaviour, not a 9.x regression.

**Cross-cutting, once any writer lane has moved (§4.3):** re-run
`cache-contract-strict` in an *unmigrated* repo. §4.4 predicts the hit rate
there is set by whichever writers still populate the old namespace; if it
collapses earlier than the writer order predicts, the ordering assumption is
wrong and step 6 should be reconsidered before it runs.

## 7. `scaffold-doctor` conformance extension

### 7.1 The gap Step A leaves open, restated in one sentence

Step A §5 states the limit of its own row 2 plainly: being offline, it cannot
detect that the estate value moved in the registry *after* the spoke pinned, so
a spoke that never re-pins sits on a stale-but-self-consistent value. See Step
A §5 for what row 2 proves and does not prove; it is not restated here.

Step B closes that gap while **leaving row 2's implementation untouched** and
without giving up the offline property. §7.2 explains why "untouched" is a
constraint rather than a courtesy.

### 7.2 Row 3 — pin freshness (offline, default on)

**Record the pinned commit on its own line, as a URL**, not appended to the
existing one:

```
# estate-bazelversion: 8.2.1
# estate-bazelversion-source: https://raw.githubusercontent.com/tinyland-inc/bazel-registry/6f4d35d266fdbc66cb0ad98e02680bbd9a296d0c/.bazelversion
```

Two constraints force this shape, and both were verified rather than assumed.

**A separate line is required.** Step A's row 2 extracts the value with a `sed`
expression that anchors end-of-line immediately after the version
(`…\([0-9][0-9.]*\)[[:space:]]*$`). Appending ` @ <sha>` to that line makes the
pattern fail to match, `recorded` comes back empty, and row 2 takes its
"records no `# estate-bazelversion:`" failure branch — so the obvious inline
form would silently break the check it is meant to build on. On a separate key
the existing regex is untouched.

**A bare `key: <40-hex>` line cannot be used either.** The estate's shared
pre-commit hook rejects a 40+ character hex run immediately preceded by `:` or
`=` as a suspected credential. That pattern was tested directly:
`# estate-bazelversion-sha: <40-hex>` is **blocked**, while the URL form above
passes — because the character preceding the hex is `/`, exactly as in the
`--registry=` pin line the spokes already carry, which is why that pin has
never tripped the hook. Recording the full source URL is also strictly more
useful than a bare SHA: it names the exact artifact the value was read from,
and row 3 recovers the SHA from it by pattern.

Row 3 then asserts, with no network:

1. The `.bazelrc` registry pin is a **40-hex commit SHA**, not a mutable ref.
2. `estate-bazelversion-source` is present, and the SHA embedded in it equals
   that pinned SHA.
3. `estate-bazelversion` still equals root `.bazelversion` — row 2's job; row 3
   depends on it and does not repeat it.

Assertion 1 has a live consequence worth stating: `greatfallstoolbus.org` on
its current default branch pins the registry by the mutable `main` ref, and
Step A's row-2 gate regex matches that form, so the repo is in scope for row 2
today while having no SHA for row 3 to check. Row 3 should **fail** on a
mutable ref rather than skip, because Step A §3 already requires an exact-SHA
pin — a mutable pin is a conformance breach that row 3 is the natural place to
catch. Step A's companion change to that spoke converts it to an exact SHA, so
this fails only where the convention has genuinely not landed.

Assertion 2 catches the failure Step A §5 names: **the spoke bumped its
registry SHA and forgot to re-read `.bazelversion` at the new commit.** Step A
§3 already requires the re-pin to be a self-contained commit that also
refreshes `MODULE.bazel.lock`; row 3 makes "…and re-record the estate pin"
mechanically enforced rather than conventional. It fails closed when the
recording is absent or malformed.

### 7.3 Row 3-online — value freshness (opt-in, network)

Behind an explicit opt-in (`--online`, or `SCAFFOLD_DOCTOR_ALLOW_NETWORK=1`) —
never the default, so the no-network invariant Step A §5 states is preserved:

1. Fetch `.bazelversion` from the registry **at the pinned SHA** and compare it
   with the recorded value.
2. Fetch the same path at `main` and compare. A difference is a **warning**.

**Rule 1 cannot be a hard failure, because it fails on the exact state Step A
ships.** Step A's companion spoke change records `estate-bazelversion: 8.2.1`
while pinning a registry commit that still records 8.1.1 — the spoke's own
`.bazelrc` documents this and says the post-merge re-pin is what reconciles
them. A hard failure would therefore red-flag a correctly-executed Step A.

Resolution — pick one and state it in the check, do not leave it implicit:

- **Preferred:** enforce the ordering instead. Rule 1 hard-fails only once the
  registry commit *newer than* the recorded value has been available for longer
  than a stated convergence window; inside that window it warns. This keeps the
  check meaningful without punishing the in-flight state.
- **Simpler fallback:** rule 1 warns unconditionally, and the ordering is
  enforced socially by Step A §3's re-pin rule.

Rule 2 is a warning for a different reason: "the estate has moved ahead of this
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

1. **Class C rows — no 9.x coverage at any published version** (§2.3):
   `rules_nixpkgs_core` (declares 6.x only, demonstrably stale, and drives
   repository rules and toolchain resolution — the two areas 9 changed most),
   `rules_pkg`, `rules_shell`, `rules_oci`. Settle empirically per §2.3; a
   missing matrix entry is not a finding of incompatibility.
2. **Class A bumps** (§2.3): `aspect_rules_js` → 3.0.0, `aspect_rules_ts` →
   3.8.7, `aspect_rules_swc` → 2.7.1, `bazel_skylib` → 1.9.2, `platforms` →
   1.1.0, `rules_python` → 1.8.0 (GF), and the `aspect_bazel_lib` → `bazel_lib`
   3.7.1 **rename**.
3. **In-house module republishing** (§2.4) — determine at step 1 whether the
   shipped modules resolve and build under 9.2.0 as-is. If not, this is the
   critical path and needs its own issue before any spoke moves.
4. **Shared-cache hit-rate measurement** (§4.4, §5 step 0). The single
   measurement most likely to change this plan: if cross-repo action overlap is
   negligible, steps 6–7 lose their ordering constraint.
5. **Worker-fleet sequencing** (§5 step 8) — confirm whether worker-produced
   action-cache entries dominate consumer hit rates. If they do, the fleet must
   be sequenced explicitly.
6. **GF's 7.4.0 `disk_cache` GC workaround** (§2.1) — obsolete under 9 or not.
7. **Executor eligibility under the new test-toolchain default** (§3.6) —
   re-prove the eligibility manifest's assumptions before any executor-backed
   lane moves.
8. **Row 3-online convergence-window policy** (§7.3) — choose the enforced
   ordering or the warn-only fallback.
