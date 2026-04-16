# tinyland Bazel Registry

Private Bazel Central Registry for `@tummycrypt/*` packages.

## Usage

Add to your `.bazelrc`:

```
common --registry=https://raw.githubusercontent.com/tinyland-inc/bazel-registry/main/
common --registry=https://bcr.bazel.build/
```

Then in your `MODULE.bazel`:

```starlark
bazel_dep(name = "tummycrypt_tinyland_auth", version = "0.1.0")
```

## Structure

```
bazel_registry.json    # Registry manifest
modules/
  tummycrypt_*/        # One directory per module
    metadata.json      # Homepage, maintainers, versions
    0.1.0/
      MODULE.bazel     # Module definition + deps
      source.json      # Archive URL + integrity hash
```

## Source

Originally generated from the [tinyland.dev](https://github.com/tinyland-inc/tinyland.dev) monorepo `bcr/` directory.

As packages are extracted into standalone repos, individual module entries may be manually recanonicalized to point at the standalone package source instead of the old monorepo archive. The `tummycrypt_tinyvectors` entry is one of those cases.
