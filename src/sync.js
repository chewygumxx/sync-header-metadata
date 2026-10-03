// vim:set expandtab shiftwidth=4 filetype=javascript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/sync-header-metadata.git
// ::: :/src/sync.js
//
//

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// A file opts out of header syncing by explicitly unsetting the
// 'sync-header-metadata' boolean attribute in .gitattributes, e.g.:
//   /LICENSE -sync-header-metadata
//
// default.gitattributes ships a baseline exclusion list (LICENSE, lockfiles,
// *.json, etc.), consulted only for paths that no other attributes source
// (the repo's .gitattributes/info/attributes, or the user's own
// `core.attributesFile`) sets or unsets.
const ATTR = "sync-header-metadata";
const DEFAULT_ATTRIBUTES_FILE = path.join(
    __dirname,
    "..",
    "default.gitattributes",
);

// execFileSync buffers all of stdout and throws ENOBUFS past `maxBuffer`
// (1 MiB by default); `ls-files`/`check-attr` output grows with the number
// of tracked files, so a large monorepo would otherwise crash outright.
const GIT_MAX_BUFFER = Infinity;

// `readFileSync(..., "utf8")` never throws on malformed input: it silently
// substitutes U+FFFD, which update mode would then write back to disk. A
// fatal decoder rejects such files instead. `ignoreBOM` keeps a leading BOM
// in the decoded text, so it survives a rewrite.
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// Same heuristic as git's own binary detection: a NUL byte near the start.
const BINARY_SNIFF_BYTES = 8000;

// ------------------------------
// Helpers: Resolve Header Lines
// ------------------------------

function findRepoMarker(lines) {
    for (let i = 0; i < lines.length; i++) {
        const m = REPO_MARKER_RE.exec(lines[i]);
        if (m)
            return {
                index: i,
                splitAt: m.index,
                current: m[1],
            };
    }
    return null;
}

const REPO_MARKER_RE = /~(\S+\/\S+?)\.git\s*$/;
const PATH_MARKER_RE = / ::: :(\/\S*)\s*$/;
function findPathMarker(lines) {
    for (let i = 0; i < lines.length; i++) {
        const m = PATH_MARKER_RE.exec(lines[i]);
        if (m)
            return {
                index: i,
                splitAt: m.index + m[0].indexOf(m[1]),
                current: m[1],
            };
    }
    return null;
}

// Shared by the Action (run.js) and the CLI (bin/sync-header-metadata.js);
// each entry point resolves its own inputs and exits with the returned code.
function sync({ mode, repository, log, cwd = process.cwd() }) {
    const verify = mode === "verify";

    // ------------------------
    // Helper: Resolve Tracked
    // ------------------------

    try {
        execFileSync("git", ["--version"], { stdio: "ignore" });
    } catch {
        log.fatal("Dependency not found in PATH: git", 127);
    }

    let repoRoot;
    try {
        repoRoot = execFileSync(
            "git",
            ["-C", cwd, "rev-parse", "--show-toplevel"],
            { encoding: "utf8" },
        ).trim();
    } catch {
        log.fatal("Not inside a git repository");
    }

    // `-t --stage` yields "<tag> <mode> <object> <stage>\t<path>" per entry.
    // Only regular files can carry a header: a symlink (120000) would be
    // followed outside the index's view of the tree (or the repo entirely),
    // and a submodule (160000) is a directory. Skip-worktree entries (tag
    // "S", e.g. sparse checkout) are intentionally absent on disk.
    let fileListRaw;
    try {
        fileListRaw = execFileSync(
            "git",
            ["-C", repoRoot, "ls-files", "-z", "-t", "--stage"],
            { encoding: "utf8", maxBuffer: GIT_MAX_BUFFER },
        );
    } catch (err) {
        log.fatal(`Failed to list tracked files: ${err.message}`);
    }
    const allFiles = [];
    const seen = new Set();
    let skipped = 0;
    for (const entry of fileListRaw.split("\0")) {
        const tab = entry.indexOf("\t");
        if (tab === -1) continue;
        const [tag, mode] = entry.slice(0, tab).split(" ");
        const relpath = entry.slice(tab + 1);
        // Unmerged paths are listed once per conflict stage.
        if (seen.has(relpath)) continue;
        seen.add(relpath);
        if (tag === "S") {
            log.info(`Skipped, not checked out: /${relpath}`);
            skipped++;
        } else if (mode !== "100644" && mode !== "100755") {
            log.info(`Skipped, not a regular file: /${relpath}`);
            skipped++;
        } else {
            allFiles.push(relpath);
        }
    }

    // `core.attributesFile` holds a single path, so pointing it at the
    // bundled defaults would silently drop the user's own global attributes
    // file. Instead, resolve with the user's configuration first, and fall
    // back to the defaults only for paths nothing else has an opinion on.
    const checkAttr = (paths, configArgs = []) => {
        const values = new Map();
        if (paths.length === 0) return values;
        let raw;
        try {
            raw = execFileSync(
                "git",
                [
                    ...configArgs,
                    "-C",
                    repoRoot,
                    "check-attr",
                    "-z",
                    "--stdin",
                    ATTR,
                ],
                {
                    input: paths.join("\0"),
                    encoding: "utf8",
                    maxBuffer: GIT_MAX_BUFFER,
                },
            );
        } catch (err) {
            log.fatal(`Failed to resolve attributes: ${err.message}`);
        }
        const parts = raw.split("\0");
        parts.pop();
        for (let i = 0; i < parts.length; i += 3)
            values.set(parts[i], parts[i + 2]);
        return values;
    };
    const attrs = checkAttr(allFiles);
    const unspecified = allFiles.filter((f) => attrs.get(f) === "unspecified");
    const defaults = checkAttr(unspecified, [
        "-c",
        `core.attributesFile=${DEFAULT_ATTRIBUTES_FILE}`,
    ]);
    for (const [f, value] of defaults) attrs.set(f, value);
    const ignored = new Set(allFiles.filter((f) => attrs.get(f) === "unset"));
    const files = allFiles.filter((f) => !ignored.has(f));

    if (files.length === 0) {
        log.warn({
            title: "Nothing Found",
            message: "No tracked files found in repository",
        });
        return 0;
    }

    // ------------
    // Parse Files
    // ------------

    const realRoot = fs.realpathSync(repoRoot);
    let parsed = 0,
        unreadable = 0;
    let repoUpdated = 0,
        repoCorrect = 0,
        repoNotFound = 0;
    let pathUpdated = 0,
        pathCorrect = 0,
        pathNotFound = 0;

    for (const relpath of files) {
        const filePath = `${repoRoot}/${relpath}`;
        const repoPath = `/${relpath}`;

        // Read
        // The index can say "regular file" while the working tree holds a
        // symlink (or sits beneath one), so refuse anything that doesn't
        // resolve to exactly this path inside the repository.
        let bytes;
        try {
            const stat = fs.lstatSync(filePath);
            if (
                !stat.isFile() ||
                fs.realpathSync(filePath) !== path.join(realRoot, relpath)
            ) {
                log.warn({
                    file: relpath,
                    title: "Not a regular file",
                    message: "Replaced on disk by a symlink or directory",
                });
                unreadable++;
                continue;
            }
            bytes = fs.readFileSync(filePath);
        } catch (err) {
            log.warn({
                file: relpath,
                ...(err.code === "ENOENT"
                    ? {
                          title: "File missing from working tree",
                          message: "Tracked in the index but deleted on disk",
                      }
                    : {
                          title: "Failed to read file",
                          message: err.message,
                      }),
            });
            unreadable++;
            continue;
        }
        if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
            log.info(`Skipped, binary: ${repoPath}`);
            skipped++;
            continue;
        }
        let content;
        try {
            content = UTF8.decode(bytes);
        } catch {
            log.warn({
                file: relpath,
                title: "Not valid UTF-8",
                message: `Consider ignoring with .gitattributes: \`${repoPath} -${ATTR}\``,
            });
            unreadable++;
            continue;
        }
        parsed++;
        const eol = content.includes("\r\n") ? "\r\n" : "\n";
        const lines = content.split(/\r\n|\n/);

        // Repository
        let changed = false;
        const repoMarker = findRepoMarker(lines);
        if (!repoMarker) {
            log.warn({
                file: relpath,
                title: "Repo line not found",
                message: "",
            });
            repoNotFound++;
        } else if (repoMarker.current === repository) {
            log.info(`Repo line correct: ${repoPath}`);
            repoCorrect++;
        } else if (verify) {
            log.error({
                file: relpath,
                title: "Repo line out-of-sync",
                message: `${repoMarker.current} =/= ${repository}`,
                startLine: repoMarker.index + 1,
            });
            repoUpdated++;
        } else {
            const leader = lines[repoMarker.index].slice(0, repoMarker.splitAt);
            lines[repoMarker.index] = `${leader}~${repository}.git`;
            changed = true;
            log.notice({
                file: relpath,
                title: "Repo line updated",
                message: `${repoMarker.current} -> ${repository}`,
                startLine: repoMarker.index + 1,
            });
            repoUpdated++;
        }

        // Filepath
        const pathMarker = findPathMarker(lines);
        if (!pathMarker) {
            log.warn({
                file: relpath,
                title: "Path line not found",
                message: "",
            });
            pathNotFound++;
        } else if (pathMarker.current === repoPath) {
            log.info(`Path line correct: ${repoPath}`);
            pathCorrect++;
        } else if (verify) {
            log.error({
                file: relpath,
                title: "Path line out-of-sync",
                message: `${pathMarker.current} =/= ${repoPath}`,
                startLine: pathMarker.index + 1,
            });
            pathUpdated++;
        } else {
            const leader = lines[pathMarker.index].slice(0, pathMarker.splitAt);
            lines[pathMarker.index] = `${leader}${repoPath}`;
            changed = true;
            log.notice({
                file: relpath,
                title: "Path line updated",
                message: `${pathMarker.current} -> ${repoPath}`,
                startLine: pathMarker.index + 1,
            });
            pathUpdated++;
        }

        // Write
        if (changed) {
            fs.writeFileSync(filePath, lines.join(eol));
        }
    }

    // ---------------
    // Post-Execution
    // ---------------

    const summary =
        `    Files parsed: ${parsed}\n` +
        `    Repo line - ${verify ? "Out-of-Sync" : "Updated"}: ${repoUpdated}, Correct: ${repoCorrect}, Not found: ${repoNotFound}\n` +
        `    Path line - ${verify ? "Out-of-Sync" : "Updated"}: ${pathUpdated}, Correct: ${pathCorrect}, Not found: ${pathNotFound}\n` +
        `    Files unreadable: ${unreadable}, Skipped: ${skipped}`;

    let sumTitle;
    if (verify) {
        if (repoUpdated > 0 || pathUpdated > 0) {
            sumTitle = "Verification Failed";
            log.error({ title: sumTitle, message: `${sumTitle}:\n${summary}` });
            return 1;
        }
        sumTitle = "Verification Passed";
    } else {
        sumTitle = "Update Complete";
    }
    log.notice({ title: sumTitle, message: `${sumTitle}:\n${summary}` });
    return 0;
}

module.exports = { sync };
