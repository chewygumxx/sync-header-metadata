// vim:set expandtab shiftwidth=4 filetype=javascript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/sync-header-metadata.git
// ::: :/test/run.test.js
//
//

'use strict';

const test                        = require('node:test');
const assert                      = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs                          = require('node:fs');
const os                          = require('node:os');
const path                        = require('node:path');

const RUN_JS = path.join(__dirname, '..', 'run.js');


// ---------
// Helpers
// ---------

// run.js reads the current repository via `git rev-parse`/`git ls-files`,
// so each test gets its own throwaway repo rather than mutating this one.
function makeRepo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-header-metadata-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    return dir;
}

function writeFile(dir, relpath, content) {
    const full = path.join(dir, relpath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
}

function readFile(dir, relpath) {
    return fs.readFileSync(path.join(dir, relpath), 'utf8');
}

// run.js resolves files via `git ls-files`, which reads the index, not the
// working tree, so every fixture file must be staged before invoking it.
function gitAdd(dir) {
    execFileSync('git', ['add', '-A'], { cwd: dir });
}

// Builds a minimal header banner. `repo` and `filepath` are the values
// baked into the two marker lines; they're deliberately independent of
// each other and of the file's real location, so callers can construct
// "drifted" headers on purpose.
function header({ repo, filepath, eol = '\n' }) {
    const lines = [
        '// vim:set expandtab:',
        '//',
        `// ~${repo}.git`,
        `// ::: :${filepath}`,
        '//',
        'console.log("hi");',
        '',
    ];
    return lines.join(eol);
}

function runAction(dir, env = {}) {
    return spawnSync(process.execPath, [RUN_JS], {
        cwd:      dir,
        encoding: 'utf8',
        env: {
            ...process.env,
            GITHUB_REPOSITORY: 'owner/repo',
            INPUT_MODE:        'verify',
            INPUT_VERBOSE:     'false',
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

test('verify mode passes when both header lines are correct', (t) => {
    const dir = makeRepo();
    t.after(() => cleanup(dir));

    writeFile(dir, 'foo.js', header({ repo: 'owner/repo', filepath: '/foo.js' }));
    gitAdd(dir);

    const result = runAction(dir, { INPUT_MODE: 'verify' });
    assert.equal(result.status, 0);
});

test('verify mode fails, and writes nothing, when the repo line has drifted', (t) => {
    const dir = makeRepo();
    t.after(() => cleanup(dir));

    const original = header({ repo: 'wrong/repo', filepath: '/foo.js' });
    writeFile(dir, 'foo.js', original);
    gitAdd(dir);

    const result = runAction(dir, { INPUT_MODE: 'verify' });
    assert.equal(result.status, 1);
    assert.equal(readFile(dir, 'foo.js'), original);
});

test('verify mode fails when the path line has drifted', (t) => {
    const dir = makeRepo();
    t.after(() => cleanup(dir));

    writeFile(dir, 'foo.js', header({ repo: 'owner/repo', filepath: '/stale/path.js' }));
    gitAdd(dir);

    const result = runAction(dir, { INPUT_MODE: 'verify' });
    assert.equal(result.status, 1);
});

test('update mode rewrites a drifted repo line and leaves an already-correct path line as-is', (t) => {
    const dir = makeRepo();
    t.after(() => cleanup(dir));

    writeFile(dir, 'foo.js', header({ repo: 'wrong/repo', filepath: '/foo.js' }));
    gitAdd(dir);

    const result = runAction(dir, { INPUT_MODE: 'update' });
    assert.equal(result.status, 0);

    const content = readFile(dir, 'foo.js');
    assert.match(content, /~owner\/repo\.git/);
    assert.match(content, /::: :\/foo\.js/);
});

test('update mode rewrites a drifted path line and leaves an already-correct repo line as-is', (t) => {
    const dir = makeRepo();
    t.after(() => cleanup(dir));

    writeFile(dir, 'foo.js', header({ repo: 'owner/repo', filepath: '/stale/path.js' }));
    gitAdd(dir);

    const result = runAction(dir, { INPUT_MODE: 'update' });
    assert.equal(result.status, 0);

    const content = readFile(dir, 'foo.js');
    assert.match(content, /~owner\/repo\.git/);
    assert.match(content, /::: :\/foo\.js/);
});

test('update mode rewrites both lines when both have drifted', (t) => {
    const dir = makeRepo();
    t.after(() => cleanup(dir));

    writeFile(dir, 'foo.js', header({ repo: 'wrong/repo', filepath: '/stale/path.js' }));
    gitAdd(dir);

    runAction(dir, { INPUT_MODE: 'update' });

    const content = readFile(dir, 'foo.js');
    assert.match(content, /~owner\/repo\.git/);
    assert.match(content, /::: :\/foo\.js/);
});

test('files with no header banner are left alone and do not fail verification', (t) => {
    const dir = makeRepo();
    t.after(() => cleanup(dir));

    writeFile(dir, 'plain.txt', 'just some text\nwith no markers at all\n');
    gitAdd(dir);

    const result = runAction(dir, { INPUT_MODE: 'verify' });
    assert.equal(result.status, 0);
});

test('CRLF line endings are preserved after an update rewrite', (t) => {
    const dir = makeRepo();
    t.after(() => cleanup(dir));

    writeFile(dir, 'foo.js', header({ repo: 'wrong/repo', filepath: '/foo.js', eol: '\r\n' }));
    gitAdd(dir);

    runAction(dir, { INPUT_MODE: 'update' });

    const content = readFile(dir, 'foo.js');
    assert.match(content, /~owner\/repo\.git\r\n/);
    assert.ok(!/[^\r]\n/.test(content), 'expected no bare LF to have been introduced');
});

test('a file excluded via .gitattributes is ignored even when its header has drifted', (t) => {
    const dir = makeRepo();
    t.after(() => cleanup(dir));

    writeFile(dir, '.gitattributes', 'foo.js -sync-header-metadata\n');
    writeFile(dir, 'foo.js', header({ repo: 'wrong/repo', filepath: '/wrong/path.js' }));
    gitAdd(dir);

    const result = runAction(dir, { INPUT_MODE: 'verify' });
    assert.equal(result.status, 0);
});

test('a nested .gitattributes can re-enable syncing for a subtree excluded by its parent', (t) => {
    const dir = makeRepo();
    t.after(() => cleanup(dir));

    writeFile(dir, '.gitattributes', 'vendor/** -sync-header-metadata\n');
    writeFile(dir, 'vendor/.gitattributes', 'important/** sync-header-metadata\n');
    writeFile(dir, 'vendor/skip.js', header({ repo: 'wrong/repo', filepath: '/vendor/skip.js' }));
    writeFile(dir, 'vendor/important/keep.js', header({ repo: 'wrong/repo', filepath: '/vendor/important/keep.js' }));
    gitAdd(dir);

    runAction(dir, { INPUT_MODE: 'update' });

    assert.match(
        readFile(dir, 'vendor/skip.js'),
        /~wrong\/repo\.git/,
        'excluded file should be left untouched'
    );
    assert.match(
        readFile(dir, 'vendor/important/keep.js'),
        /~owner\/repo\.git/,
        'nested override should have re-enabled syncing'
    );
});
