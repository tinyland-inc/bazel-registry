# tinyland Bazel Registry

Active Bazel module registry for standalone `@tummycrypt/*` package
authorities.

## Status

This repository is now an active but deliberately narrow Bzlmod release
authority.

The active `modules/` tree only contains standalone package releases that have
truthful source archives and non-empty source integrity. The old `0.1.0`
monorepo-generated snapshot remains under `archive/modules-legacy-2026-04-20`
for forensic comparison only.

Do not re-add modules by copying the archived snapshot forward. New entries
must be generated from the standalone repository that owns the package release.

Current active modules:

- `tummycrypt_tinyvectors@0.2.3`

Known blocker: packages whose standalone `MODULE.bazel` files create an
Aspect npm extension repo named `npm` cannot yet be composed in one external
Bzlmod graph. Keep those modules out of the active registry until their source
repos stop colliding on the generated `@npm` repository name.

## Active Registry Contract

An active registry entry must:

- point at the standalone module repository or release artifact that owns the
  package;
- include a non-empty `source.json` integrity value;
- avoid `tinyland.dev` monorepo archive URLs and strip prefixes;
- match the module version to the package/build authority surface for that
  module.

## Structure

```
bazel_registry.json    # Registry manifest
modules/
  tummycrypt_*/        # Active standalone module entries
    metadata.json
    <version>/
      MODULE.bazel
      source.json
archive/
  modules-legacy-2026-04-20/
    tummycrypt_*/      # Historical module entries
      metadata.json
      0.1.0/
        MODULE.bazel
        source.json
```

## Validation

Run:

```bash
npm run validate
```

The validator allows the current archived snapshot, but it fails if the registry
is marked active while entries have blank integrity, monorepo archive source
references, or module/version metadata drift.
