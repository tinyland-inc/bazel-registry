# tinyland Bazel Registry

Archived Bazel Central Registry snapshot for historical `@tummycrypt/*`
package experiments.

## Status

This repository is not an active Bzlmod release authority today.

The checked-in module entries are a legacy `0.1.0` snapshot generated from
the `tinyland.dev` monorepo. They still point at non-existent monorepo tag
archives and have blank source integrity fields, so they are preserved for
forensic comparison only.

Do not consume this registry from `.bazelrc` until entries are regenerated from
the active standalone package authorities and the validator reports an active,
integrity-complete registry.

## Future Active Registry Contract

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
is marked active while entries still have blank integrity or monorepo archive
source references.
