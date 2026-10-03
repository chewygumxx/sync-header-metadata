// vim:set expandtab shiftwidth=4 filetype=javascript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/sync-header-metadata.git
// ::: :/test/run.test.js
//
//

"use strict";

const { onTestFinished, test } = require("bun:test");
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const RUN_JS = path.join(__dirname, "..", "run.js");

// ---------
// Helpers
// ---------

// run.js reads the current repository via `git rev-parse`/`git ls-files`,
// so each test gets its own throwaway repo rather than mutating this one.
function makeRepo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-header-metadata-"));
    execFileSync("git", ["init", "-q"], { cwd: dir });
    return dir;
}

function writeFile(dir, relpath, content) {
    const full = path.join(dir, relpath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
}

function readFile(dir, relpath) {
    return fs.readFileSync(path.join(dir, relpath), "utf8");
}

// run.js resolves files via `git ls-files`, which reads the index, not the
// working tree, so every fixture file must be staged before invoking it.
function gitAdd(dir) {
    execFileSync("git", ["add", "-A"], { cwd: dir });
}

// Builds a minimal header banner. `repo` and `filepath` are the values
// baked into the two marker lines; they're deliberately independent of
// each other and of the file's real location, so callers can construct
// "drifted" headers on purpose.
function header({ repo, filepath, eol = "\n", pathTrailingSpace = "" }) {
    const lines = [
        "// vim:set expandtab:",
        "//",
        `// ~${repo}.git`,
        `// ::: :${filepath}${pathTrailingSpace}`,
        "//",
        'console.log("hi");',
        "",
    ];
    return lines.join(eol);
}

function runAction(dir, env = {}) {
    return spawnSync(process.execPath, [RUN_JS], {
        cwd: dir,
        encoding: "utf8",
        env: {
            ...process.env,
            GITHUB_REPOSITORY: "owner/repo",
            INPUT_MODE: "verify",
            INPUT_VERBOSE: "false",
            ...env,
        },
    });
}

function cleanup(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
}

// -------
// Tests
// -------

test("verify mode passes when both header lines are correct", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    writeFile(
        dir,
        "foo.js",
        header({ repo: "owner/repo", filepath: "/foo.js" }),
    );
    gitAdd(dir);

    const result = runAction(dir, { INPUT_MODE: "verify" });
    assert.equal(result.status, 0);
});

test("verify mode fails, and writes nothing, when the repo line has drifted", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    const original = header({ repo: "wrong/repo", filepath: "/foo.js" });
    writeFile(dir, "foo.js", original);
    gitAdd(dir);

    const result = runAction(dir, { INPUT_MODE: "verify" });
    assert.equal(result.status, 1);
    assert.equal(readFile(dir, "foo.js"), original);
});

test("verify mode fails when the path line has drifted", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    writeFile(
        dir,
        "foo.js",
        header({ repo: "owner/repo", filepath: "/stale/path.js" }),
    );
    gitAdd(dir);

    const result = runAction(dir, { INPUT_MODE: "verify" });
    assert.equal(result.status, 1);
});

test("verify mode passes when the path line has trailing whitespace but is otherwise correct", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    writeFile(
        dir,
        "foo.js",
        header({
            repo: "owner/repo",
            filepath: "/foo.js",
            pathTrailingSpace: "   ",
        }),
    );
    gitAdd(dir);

    const result = runAction(dir, { INPUT_MODE: "verify" });
    assert.equal(result.status, 0);
});

test("update mode rewrites a drifted repo line and leaves an already-correct path line as-is", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    writeFile(
        dir,
        "foo.js",
        header({ repo: "wrong/repo", filepath: "/foo.js" }),
    );
    gitAdd(dir);

    const result = runAction(dir, { INPUT_MODE: "update" });
    assert.equal(result.status, 0);

    const content = readFile(dir, "foo.js");
    assert.match(content, /~owner\/repo\.git/);
    assert.match(content, /::: :\/foo\.js/);
});

test("update mode rewrites a drifted path line and leaves an already-correct repo line as-is", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    writeFile(
        dir,
        "foo.js",
        header({ repo: "owner/repo", filepath: "/stale/path.js" }),
    );
    gitAdd(dir);

    const result = runAction(dir, { INPUT_MODE: "update" });
    assert.equal(result.status, 0);

    const content = readFile(dir, "foo.js");
    assert.match(content, /~owner\/repo\.git/);
    assert.match(content, /::: :\/foo\.js/);
});

test("update mode rewrites both lines when both have drifted", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    writeFile(
        dir,
        "foo.js",
        header({ repo: "wrong/repo", filepath: "/stale/path.js" }),
    );
    gitAdd(dir);

    runAction(dir, { INPUT_MODE: "update" });

    const content = readFile(dir, "foo.js");
    assert.match(content, /~owner\/repo\.git/);
    assert.match(content, /::: :\/foo\.js/);
});

test("files with no header banner are left alone and do not fail verification", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    writeFile(dir, "plain.txt", "just some text\nwith no markers at all\n");
    gitAdd(dir);

    const result = runAction(dir, { INPUT_MODE: "verify" });
    assert.equal(result.status, 0);
});

test("CRLF line endings are preserved after an update rewrite", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    writeFile(
        dir,
        "foo.js",
        header({ repo: "wrong/repo", filepath: "/foo.js", eol: "\r\n" }),
    );
    gitAdd(dir);

    runAction(dir, { INPUT_MODE: "update" });

    const content = readFile(dir, "foo.js");
    assert.match(content, /~owner\/repo\.git\r\n/);
    assert.ok(
        !/[^\r]\n/.test(content),
        "expected no bare LF to have been introduced",
    );
});

test("a file excluded via .gitattributes is ignored even when its header has drifted", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    writeFile(dir, ".gitattributes", "foo.js -sync-header-metadata\n");
    writeFile(
        dir,
        "foo.js",
        header({ repo: "wrong/repo", filepath: "/wrong/path.js" }),
    );
    gitAdd(dir);

    const result = runAction(dir, { INPUT_MODE: "verify" });
    assert.equal(result.status, 0);
});

test("bundled default exclusions apply with no .gitattributes present in the repo at all", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    writeFile(
        dir,
        "LICENSE",
        header({ repo: "wrong/repo", filepath: "/wrong/path" }),
    );
    writeFile(
        dir,
        "vendor/.keep",
        header({ repo: "wrong/repo", filepath: "/wrong/path" }),
    );
    writeFile(
        dir,
        "data.json",
        header({ repo: "wrong/repo", filepath: "/wrong/path" }),
    );
    writeFile(
        dir,
        "go.sum",
        header({ repo: "wrong/repo", filepath: "/wrong/path" }),
    );
    gitAdd(dir);

    const result = runAction(dir, { INPUT_MODE: "verify" });
    assert.equal(result.status, 0);
});

test("a repo .gitattributes can re-enable syncing for a file matched by a bundled default", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    writeFile(dir, ".gitattributes", "data.json sync-header-metadata\n");
    writeFile(
        dir,
        "data.json",
        header({ repo: "wrong/repo", filepath: "/wrong/path.json" }),
    );
    writeFile(
        dir,
        "other.json",
        header({ repo: "wrong/repo", filepath: "/wrong/path.json" }),
    );
    gitAdd(dir);

    const result = runAction(dir, { INPUT_MODE: "verify" });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /Repo line out-of-sync/);

    const update = runAction(dir, { INPUT_MODE: "update" });
    assert.equal(update.status, 0);
    assert.match(readFile(dir, "data.json"), /~owner\/repo\.git/);
    assert.match(
        readFile(dir, "other.json"),
        /~wrong\/repo\.git/,
        "other.json should remain untouched by the default exclusion",
    );
});

test("a nested .gitattributes can re-enable syncing for a subtree excluded by its parent", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    writeFile(dir, ".gitattributes", "vendor/** -sync-header-metadata\n");
    writeFile(
        dir,
        "vendor/.gitattributes",
        "important/** sync-header-metadata\n",
    );
    writeFile(
        dir,
        "vendor/skip.js",
        header({ repo: "wrong/repo", filepath: "/vendor/skip.js" }),
    );
    writeFile(
        dir,
        "vendor/important/keep.js",
        header({ repo: "wrong/repo", filepath: "/vendor/important/keep.js" }),
    );
    gitAdd(dir);

    runAction(dir, { INPUT_MODE: "update" });

    assert.match(
        readFile(dir, "vendor/skip.js"),
        /~wrong\/repo\.git/,
        "excluded file should be left untouched",
    );
    assert.match(
        readFile(dir, "vendor/important/keep.js"),
        /~owner\/repo\.git/,
        "nested override should have re-enabled syncing",
    );
});

// -------------
// Annotations
// -------------

test("annotation input off (the default) prints no workflow-command lines at all", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    writeFile(
        dir,
        "foo.js",
        header({ repo: "wrong/repo", filepath: "/foo.js" }),
    );
    gitAdd(dir);

    const result = runAction(dir, { INPUT_MODE: "verify" });
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout, /::(error|warning|notice)\b/);
});

test("annotation mode emits a well-formed ::error:: with file and line for a drifted repo line", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    writeFile(
        dir,
        "foo.js",
        header({ repo: "wrong/repo", filepath: "/foo.js" }),
    );
    gitAdd(dir);

    const result = runAction(dir, {
        INPUT_MODE: "verify",
        INPUT_ANNOTATION: "true",
    });
    assert.equal(result.status, 1);
    assert.match(
        result.stdout,
        /::error title=Repo line out-of-sync,file=foo\.js,line=3,endLine=3::wrong\/repo =\/= owner\/repo/,
    );
});

test("annotation mode emits a well-formed ::error:: with file and line for a drifted path line", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    writeFile(
        dir,
        "foo.js",
        header({ repo: "owner/repo", filepath: "/stale/path.js" }),
    );
    gitAdd(dir);

    const result = runAction(dir, {
        INPUT_MODE: "verify",
        INPUT_ANNOTATION: "true",
    });
    assert.equal(result.status, 1);
    assert.match(
        result.stdout,
        /::error title=Path line out-of-sync,file=foo\.js,line=4,endLine=4::\/stale\/path\.js =\/= \/foo\.js/,
    );
});

test("annotation mode emits a well-formed ::notice:: with file and line when update mode rewrites a line", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    writeFile(
        dir,
        "foo.js",
        header({ repo: "wrong/repo", filepath: "/foo.js" }),
    );
    gitAdd(dir);

    const result = runAction(dir, {
        INPUT_MODE: "update",
        INPUT_ANNOTATION: "true",
    });
    assert.equal(result.status, 0);
    assert.match(
        result.stdout,
        /::notice title=Repo line updated,file=foo\.js,line=3,endLine=3::wrong\/repo -> owner\/repo/,
    );
});

test("a missing header emits ::warning:: (not ::error::) and does not fail verification", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    writeFile(dir, "plain.txt", "just some text\nwith no markers at all\n");
    gitAdd(dir);

    const result = runAction(dir, {
        INPUT_MODE: "verify",
        INPUT_ANNOTATION: "true",
    });
    assert.equal(result.status, 0);
    assert.match(
        result.stdout,
        /::warning title=Repo line not found,file=plain\.txt::/,
    );
    assert.match(
        result.stdout,
        /::warning title=Path line not found,file=plain\.txt::/,
    );
    assert.doesNotMatch(result.stdout, /::error/);
});

for (const annotation of ["false", "true"]) {
    test(`a newline in a tracked filename cannot inject a workflow command (annotation=${annotation})`, () => {
        const dir = makeRepo();
        onTestFinished(() => cleanup(dir));

        // Only the repo line is present, so the file logs both an INFO line
        // (with its path) and a "Path line not found" warning.
        writeFile(dir, "evil\n::error::injected.txt", "// ~owner/repo.git\n");
        gitAdd(dir);

        const result = runAction(dir, {
            INPUT_VERBOSE: "true",
            INPUT_ANNOTATION: annotation,
        });
        assert.equal(result.status, 0);
        assert.match(result.stdout, /evil\\n::error::injected\.txt/);
        assert.doesNotMatch(result.stdout, /^::error::injected/m);
    });
}

// -----
// CLI
// -----

const CLI_JS = path.join(__dirname, "..", "bin", "sync-header-metadata.js");

// GITHUB_REPOSITORY is stripped so the CLI's own repository resolution
// (--repo, then the origin remote) is what's under test.
function runCli(dir, args = [], env = {}) {
    const cliEnv = { ...process.env, ...env };
    delete cliEnv.GITHUB_REPOSITORY;
    return spawnSync(process.execPath, [CLI_JS, ...args], {
        cwd: dir,
        encoding: "utf8",
        env: cliEnv,
    });
}

function setOrigin(dir, url) {
    execFileSync("git", ["remote", "add", "origin", url], { cwd: dir });
}

for (const url of [
    "git@github.com:owner/repo.git",
    "https://github.com/owner/repo.git",
    "https://github.com/owner/repo",
    "ssh://git@github.com/owner/repo.git",
]) {
    test(`cli derives the repository from an origin remote of ${url}`, () => {
        const dir = makeRepo();
        onTestFinished(() => cleanup(dir));

        setOrigin(dir, url);
        writeFile(
            dir,
            "foo.js",
            header({ repo: "owner/repo", filepath: "/foo.js" }),
        );
        gitAdd(dir);

        const result = runCli(dir);
        assert.equal(result.status, 0, result.stdout);
    });
}

test("cli --repo overrides the origin remote", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    setOrigin(dir, "git@github.com:someone/else.git");
    writeFile(
        dir,
        "foo.js",
        header({ repo: "owner/repo", filepath: "/foo.js" }),
    );
    gitAdd(dir);

    assert.equal(runCli(dir).status, 1);
    assert.equal(runCli(dir, ["--repo", "owner/repo"]).status, 0);
});

test("cli --mode update rewrites drifted header lines", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    writeFile(
        dir,
        "foo.js",
        header({ repo: "wrong/repo", filepath: "/stale/path.js" }),
    );
    gitAdd(dir);

    const result = runCli(dir, ["--repo", "owner/repo", "--mode", "update"]);
    assert.equal(result.status, 0);

    const content = readFile(dir, "foo.js");
    assert.match(content, /~owner\/repo\.git/);
    assert.match(content, /::: :\/foo\.js/);
});

for (const flag of ["--update", "-u"]) {
    test(`cli ${flag} is shorthand for --mode update`, () => {
        const dir = makeRepo();
        onTestFinished(() => cleanup(dir));

        writeFile(
            dir,
            "foo.js",
            header({ repo: "wrong/repo", filepath: "/stale/path.js" }),
        );
        gitAdd(dir);

        const result = runCli(dir, ["--repo", "owner/repo", flag]);
        assert.equal(result.status, 0);

        const content = readFile(dir, "foo.js");
        assert.match(content, /~owner\/repo\.git/);
        assert.match(content, /::: :\/foo\.js/);
    });
}

test("cli --update agrees with an explicit --mode update", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    const result = runCli(dir, [
        "--repo",
        "owner/repo",
        "--mode",
        "update",
        "--update",
    ]);
    assert.equal(result.status, 0);
});

test("cli rejects --update combined with --mode verify, and writes nothing", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    const original = header({ repo: "wrong/repo", filepath: "/foo.js" });
    writeFile(dir, "foo.js", original);
    gitAdd(dir);

    const result = runCli(dir, [
        "--repo",
        "owner/repo",
        "--mode",
        "verify",
        "--update",
    ]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /--update/);
    assert.equal(readFile(dir, "foo.js"), original);
});

test("cli verify fails on drift and prints no workflow-command lines", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    writeFile(
        dir,
        "foo.js",
        header({ repo: "wrong/repo", filepath: "/foo.js" }),
    );
    gitAdd(dir);

    const result = runCli(dir, ["--repo", "owner/repo"]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /Repo line out-of-sync/);
    assert.doesNotMatch(result.stdout, /::(error|warning|notice)\b/);
});

test("cli fails clearly, without workflow commands, when no repository can be resolved", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    writeFile(
        dir,
        "foo.js",
        header({ repo: "owner/repo", filepath: "/foo.js" }),
    );
    gitAdd(dir);

    const result = runCli(dir);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /\[FATAL\].*--repo/);
    assert.doesNotMatch(result.stdout, /::error/);
});

test("cli rejects an invalid --mode", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    const result = runCli(dir, ["--repo", "owner/repo", "--mode", "bogus"]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /Invalid mode/);
});

test("tracked-file listings larger than the default 1 MiB maxBuffer are handled", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    // ~4500 x ~240-byte paths puts both `ls-files` and `check-attr` output
    // past execFileSync's default 1 MiB buffer.
    const stem = "a".repeat(230);
    for (let i = 0; i < 4500; i++)
        fs.writeFileSync(path.join(dir, `${stem}${i}.json`), "");
    gitAdd(dir);

    const result = runAction(dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("the user's global core.attributesFile is honoured alongside the bundled defaults", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    const home = fs.mkdtempSync(path.join(os.tmpdir(), "sync-header-home-"));
    onTestFinished(() => cleanup(home));
    const globalAttributes = path.join(home, "attributes");
    fs.writeFileSync(globalAttributes, "foo.js -sync-header-metadata\n");
    const globalConfig = path.join(home, "gitconfig");
    fs.writeFileSync(
        globalConfig,
        `[core]\n\tattributesFile = ${globalAttributes}\n`,
    );

    // Both drifted: foo.js is excluded by the user's global file, LICENSE
    // by the bundled defaults.
    writeFile(
        dir,
        "foo.js",
        header({ repo: "wrong/repo", filepath: "/foo.js" }),
    );
    writeFile(
        dir,
        "LICENSE",
        header({ repo: "wrong/repo", filepath: "/LICENSE" }),
    );
    gitAdd(dir);

    const result = runAction(dir, { GIT_CONFIG_GLOBAL: globalConfig });
    assert.equal(result.status, 0, result.stdout);
});

test("update mode does not follow a tracked symlink into its target", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    const original = header({ repo: "owner/repo", filepath: "/foo.js" });
    writeFile(dir, "foo.js", original);
    fs.symlinkSync("foo.js", path.join(dir, "link.js"));
    gitAdd(dir);

    const result = runAction(dir, { INPUT_MODE: "update" });
    assert.equal(result.status, 0, result.stdout);
    assert.equal(readFile(dir, "foo.js"), original);
    assert.doesNotMatch(result.stdout, /link\.js/);
});

test("update mode does not write through a working-tree symlink to outside the repo", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "sync-outside-"));
    onTestFinished(() => cleanup(outside));

    const victim = header({ repo: "victim/repo", filepath: "/secret.js" });
    fs.writeFileSync(path.join(outside, "secret.js"), victim);
    writeFile(
        dir,
        "foo.js",
        header({ repo: "owner/repo", filepath: "/foo.js" }),
    );
    gitAdd(dir);
    // The index still records a regular file; only the working tree changed.
    fs.rmSync(path.join(dir, "foo.js"));
    fs.symlinkSync(path.join(outside, "secret.js"), path.join(dir, "foo.js"));

    const result = runAction(dir, { INPUT_MODE: "update" });
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /Not a regular file/);
    assert.equal(
        fs.readFileSync(path.join(outside, "secret.js"), "utf8"),
        victim,
    );
});

test("a tracked file deleted from the working tree is reported as missing, not as an encoding problem", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    writeFile(
        dir,
        "gone.js",
        header({ repo: "owner/repo", filepath: "/gone.js" }),
    );
    gitAdd(dir);
    fs.rmSync(path.join(dir, "gone.js"));

    const result = runAction(dir);
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /File missing from working tree/);
    assert.doesNotMatch(result.stdout, /utf8|UTF-8/);
});

test("submodules and skip-worktree paths are skipped without warnings", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    writeFile(
        dir,
        "foo.js",
        header({ repo: "owner/repo", filepath: "/foo.js" }),
    );
    writeFile(
        dir,
        "sparse.js",
        header({ repo: "owner/repo", filepath: "/sparse.js" }),
    );
    gitAdd(dir);
    execFileSync(
        "git",
        [
            "update-index",
            "--add",
            "--cacheinfo",
            `160000,${"1".repeat(40)},sub`,
        ],
        { cwd: dir },
    );
    execFileSync("git", ["update-index", "--skip-worktree", "sparse.js"], {
        cwd: dir,
    });
    fs.rmSync(path.join(dir, "sparse.js"));

    const result = runAction(dir);
    assert.equal(result.status, 0, result.stdout);
    assert.doesNotMatch(result.stdout, /\[WARN\]/);
});

test("update mode leaves a non-UTF-8 file byte-for-byte intact and warns", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    // Latin-1 "café": 0xE9 alone is not valid UTF-8.
    const original = Buffer.concat([
        Buffer.from(header({ repo: "wrong/repo", filepath: "/foo.txt" })),
        Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]),
    ]);
    fs.writeFileSync(path.join(dir, "foo.txt"), original);
    gitAdd(dir);

    const result = runAction(dir, { INPUT_MODE: "update" });
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /Not valid UTF-8/);
    assert.deepEqual(fs.readFileSync(path.join(dir, "foo.txt")), original);
});

test("binary files are skipped without header warnings", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    fs.writeFileSync(
        path.join(dir, "image.png"),
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
    );
    gitAdd(dir);

    const result = runAction(dir);
    assert.equal(result.status, 0, result.stdout);
    assert.doesNotMatch(result.stdout, /\[WARN\]/);
});

test("a UTF-8 byte order mark survives an update rewrite", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    writeFile(
        dir,
        "foo.js",
        `\uFEFF${header({ repo: "wrong/repo", filepath: "/foo.js" })}`,
    );
    gitAdd(dir);

    runAction(dir, { INPUT_MODE: "update" });
    const content = readFile(dir, "foo.js");
    assert.ok(content.startsWith("\uFEFF"), "expected the BOM to be kept");
    assert.match(content, /~owner\/repo\.git/);
});

test("update mode rewrites only the marker line of a mixed-EOL file", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    const original = `${header({ repo: "wrong/repo", filepath: "/foo.js" })}windows();\r\nunix();\n`;
    writeFile(dir, "foo.js", original);
    gitAdd(dir);

    runAction(dir, { INPUT_MODE: "update" });
    assert.equal(
        readFile(dir, "foo.js"),
        original.replace("~wrong/repo.git", "~owner/repo.git"),
    );
});

test("marker-like text past the header is never treated as a marker", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    const original = `${"filler\n".repeat(40)}see the mirror ~bob/proj.git\n`;
    writeFile(dir, "notes.txt", original);
    gitAdd(dir);

    const result = runAction(dir, { INPUT_MODE: "update" });
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /Repo line not found/);
    assert.equal(readFile(dir, "notes.txt"), original);
});

test("update mode rewrites the header of a large file and copies the rest verbatim", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    // A >64 KiB body, ending in Latin-1 bytes that aren't valid UTF-8:
    // only the header is decoded, so the body must round-trip untouched.
    const body = Buffer.concat([
        Buffer.from("x".repeat(100 * 1024)),
        Buffer.from([0x0a, 0x63, 0x61, 0x66, 0xe9, 0x0a]),
    ]);
    fs.writeFileSync(
        path.join(dir, "big.txt"),
        Buffer.concat([
            Buffer.from(header({ repo: "wrong/repo", filepath: "/big.txt" })),
            body,
        ]),
    );
    gitAdd(dir);

    const result = runAction(dir, { INPUT_MODE: "update" });
    assert.equal(result.status, 0, result.stdout);
    assert.deepEqual(
        fs.readFileSync(path.join(dir, "big.txt")),
        Buffer.concat([
            Buffer.from(header({ repo: "owner/repo", filepath: "/big.txt" })),
            body,
        ]),
    );
});

for (const line of [
    "# clone: https://git.sr.ht/~bob/proj.git",
    "# mirror: git@git.sr.ht:~bob/proj.git",
    "# cd ~/src/foo.git",
]) {
    test(`a header line like '${line}' is not mistaken for the repo marker`, () => {
        const dir = makeRepo();
        onTestFinished(() => cleanup(dir));

        const original = `${line}\n`;
        writeFile(dir, "notes.txt", original);
        gitAdd(dir);

        const result = runAction(dir, { INPUT_MODE: "update" });
        assert.equal(result.status, 0, result.stdout);
        assert.match(result.stdout, /Repo line not found/);
        assert.equal(readFile(dir, "notes.txt"), original);
    });
}

test("a repo marker directly after a comment leader is still recognised", () => {
    const dir = makeRepo();
    onTestFinished(() => cleanup(dir));

    writeFile(dir, "foo.sh", "#~wrong/repo.git\n# ::: :/foo.sh\n");
    gitAdd(dir);

    runAction(dir, { INPUT_MODE: "update" });
    assert.equal(readFile(dir, "foo.sh"), "#~owner/repo.git\n# ::: :/foo.sh\n");
});
