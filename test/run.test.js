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
