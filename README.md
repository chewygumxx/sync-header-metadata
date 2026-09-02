<!-- vim:set expandtab shiftwidth=4 filetype=markdown foldlevel=3: -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

<!--
   -
   - ~chewygumxx/sync-header-metadata.git
   - ::: :/README.md
   -
   -->

<!--
   - [GitHub Action] Checks/rewrites the "~owner/repo.git" and
   - "::: :/<path>" lines in tracked files' header banners against each
   - file's actual repository and path.
   -->

# sync-header-metadata

A GitHub Action that keeps a file-header convention honest.

Checks/rewrites the `~owner/repo.git` and `::: :/<path>` lines in tracked files'
header banners against each file's actual repository and path.

## Purpose

Consider the following textfile header, compliant in accordance with the
formalised format standard of a given repository:

```js
#!/usr/bin/env node
// vim:set expandtab shiftwidth=4 filetype=javascript:

//
//
// ~owner/repo.git
// ::: :/path/to/this/file
//
//
```

Were a file with this header to be renamed, moved, forked, or otherwise
displaced, those two lines quietly go stale. This action finds every tracked
file whose banner has drifted from its current repository and/or path and either
loudly fails (`verify` mode), or rewrites it (`update` mode). The logic is
commentstring invariant and will perform irrespective of surrounding language
syntax eg. `-- %s`, `// %s`, `# %s`, `; %s`, et cetera.

Both markers must be the last non-whitespace content on their line, so this
matches the multi-line comment-block style shown above (marker on its own
line, closer on a separate line), but not a single-line closed comment like
`<!-- ~owner/repo.git -->` or `/* ~owner/repo.git */`.

## Usage

To verify without rewrite, failing on drift.

```yaml
- uses: actions/checkout@v7

- name: Verify header repository and path
  uses: chewygumxx/sync-header-metadata@v2
```

To rewrite and update files instead of failing on desync:

```yaml
- uses: actions/checkout@v7
  with:
      ref: ${{ github.head_ref || github.ref_name }}
      persist-credentials: true

- name: Update tracked files
  uses: chewygumxx/sync-header-metadata@v2
  with:
      mode: update

- name: Commit changes
  uses: stefanzweifel/git-auto-commit-action@v7
  with:
      commit_message: "chore: Sync header metadata"
```

See [`.github/workflows/sync-header-metadata.yaml`](.github/workflows/sync-header-metadata.yaml)
for a complete, worked example.

### Inputs

| Input        | Required | Default   | Description                                                        |
|--------------|----------|-----------|---------------------------------------------------------------------|
| `mode`       | No       | `verify`  | `verify` exits non-zero on drift; `update` rewrites in place.     |
| `verbose`    | No       | `false`   | Enable INFO-level logging.                                         |
| `annotation` | No       | `false`   | Emit `::notice::`/`::warning::`/`::error::` workflow annotations. |

### Ignoring files

To exclude a path, explicitly unset the `sync-header-metadata` boolean
attribute for it in `.gitattributes`:

```gitattributes
vendor/**  -sync-header-metadata
*.min.js   -sync-header-metadata
/config.js -sync-header-metadata
```

Standard `.gitattributes` matching applies:

- A bare pattern with no leading `/` matches at any depth.
- A leading `/` anchors it to that `.gitattributes` file's own directory.
- Nested `.gitattributes` files can re-enable syncing for a subtree per greater
  specificity by setting the attribute back, e.g.
  `important/** sync-header-metadata`.


## Limitations

### Workflow files

`update` mode rewrites `.github/workflows/*.yaml` headers the same as any
other tracked file. By default, `GITHUB_TOKEN` cannot push a commit that
touches `.github/workflows/` without the `workflows: write` permission
explicitly granted in the calling workflow. Without it, the commit/push step
following this action (`git-auto-commit-action` or otherwise) fails the
entire commit, and all update writes per this action are lost.

If you haven't granted `workflows: write`, elide workflow files in the same
manner as any other ignored path or learn this security restriction at push.

```gitattributes
.github/workflows/** -sync-header-metadata
```

*(It's a very inconsequential failure. Handling involves either providing the
permission, excluding as shown, or manually updating the out-of-sync workflow
header.)*

### Annotation limits

GitHub caps workflow annotations at 10 errors, 10 warnings, and 10 notices
per step, regardless of the `annotation` input. This action runs as a single
step and can emit up to two `error` annotations per drifted file (one for
the repo line, one for the path line), so a repo with more than a handful of
drifted files will exceed the cap: only the first 10 of each level render in
the PR's Checks/Files-changed UI, the rest are silently dropped by GitHub.

This doesn't affect correctness, the exit code and the plain `[ERROR]` log
lines printed to the job's raw log aren't subject to the cap, only the
`::error::`/`::warning::`/`::notice::` UI annotations are. Treat annotations
as a convenience for small drifts and rely on the job log or `mode: update`'s
diff for anything larger.

## Development

A native `node24` action: GitHub Actions runs `run.js` directly with the
`node` runtime it provides, no install step, no runtime dependencies.
Sanity-check changes locally, from inside a git checkout:

```sh
INPUT_MODE=verify GITHUB_REPOSITORY=owner/repo node run.js
```

## License

[GNU General Public License v3.0 only](LICENSE)
