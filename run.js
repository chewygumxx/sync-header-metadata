#!/usr/bin/env node
// vim:set expandtab shiftwidth=4 filetype=javascript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/sync-header-metadata.git
// ::: :/run.js
//
//

'use strict';

const fs               = require('node:fs');
const { execFileSync } = require('node:child_process');

const ActionLog = require('./src/action_log.js');



// ------------------
// Parse Environment
// ------------------

const log = new ActionLog(
    (process.env.INPUT_VERBOSE    || '').toLowerCase() === 'true',
    (process.env.INPUT_ANNOTATION || '').toLowerCase() === 'true',
);

const rawMode = (process.env.INPUT_MODE || '').toLowerCase() || 'verify';
if (rawMode !== 'verify' && rawMode !== 'update')
    log.fatal(`Invalid mode: Must be 'verify' or 'update', received: ${rawMode}`);
const verify = rawMode === 'verify';

const githubRepository = process.env.GITHUB_REPOSITORY;
if (!githubRepository)
    log.fatal("Environment variable not set: GITHUB_REPOSITORY");


// ------------------------
// Helper: Resolve Tracked
// ------------------------

try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
} catch {
    log.fatal('Dependency not found in PATH: git', 127);
}

let repoRoot;
try {
    repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
} catch {
    log.fatal('Not inside a git repository');
}

let fileListRaw;
try {
    fileListRaw = execFileSync('git', ['-C', repoRoot, 'ls-files', '-z'], { encoding: 'utf8' });
} catch (err) {
    log.fatal(`Failed to list tracked files: ${err.message}`);
}
const allFiles = fileListRaw.split('\0').filter(Boolean);

// A file opts out of header syncing by explicitly unsetting the
// 'sync-header-metadata' boolean attribute in .gitattributes, e.g.:
//   /LICENSE -sync-header-metadata
const ATTR = 'sync-header-metadata';
let checkAttrRaw = '';
if (allFiles.length > 0) {
    checkAttrRaw = execFileSync(
        'git',
        ['-C', repoRoot, 'check-attr', '-z', '--stdin', ATTR],
        { input: allFiles.join('\0'), encoding: 'utf8' }
    );
}
const attrParts = checkAttrRaw.split('\0');
attrParts.pop();
const ignored = new Set();
for (let i = 0; i < attrParts.length; i += 3) {
    if (attrParts[i + 2] === 'unset') ignored.add(attrParts[i]);
}
const files = allFiles.filter(f => !ignored.has(f));

if (files.length === 0) {
    log.warn('No tracked files found in repository', { title: "Nothing Found" });
    process.exit(0);
}


// ------------------------------
// Helpers: Resolve Header Lines
// ------------------------------

function findRepoMarker(lines) {
    for (let i = 0; i < lines.length; i++) {
        const m = REPO_MARKER_RE.exec(lines[i]);
        if (m) return {
            index: i,
            splitAt: m.index,
            current: m[1]
        };
    }
    return null;
}

const REPO_MARKER_RE = /~(\S+\/\S+?)\.git\s*$/;
const PATH_MARKER_RE = / ::: :(\/\S*)\s*$/;
function findPathMarker(lines) {
    for (let i = 0; i < lines.length; i++) {
        const m = PATH_MARKER_RE.exec(lines[i]);
        if (m) return {
            index:   i,
            splitAt: m.index + m[0].indexOf(m[1]),
            current: m[1]
        };
    }
    return null;
}


// ------------
// Parse Files
// ------------

let      parsed = 0,  unreadable = 0;
let repoUpdated = 0, repoCorrect = 0, repoNotFound = 0;
let pathUpdated = 0, pathCorrect = 0, pathNotFound = 0;

for (const relpath of files) {
    const filePath = `${repoRoot}/${relpath}`;
    const repoPath = `/${relpath}`;

    // Read
    let content;
    try {
        content = fs.readFileSync(filePath, 'utf8');
        parsed++;
    } catch {
        log.warn({
            file: filePath,
            title: "Failed to read file as utf8 encoded",
            message: `Consider ignoring with .gitattributes: \`${repoPath} -${ATTR}\` `
        });
        unreadable++;
        continue;
    }
    const eol   = content.includes('\r\n') ? '\r\n' : '\n';
    const lines = content.split(/\r\n|\n/);

    // Repository
    let changed = false;
    const repoMarker = findRepoMarker(lines);
    if (!repoMarker) {
        log.error({
            file: filePath,
            title: "Repo line not found",
            message: "No line in parsed file conformed to the provided pattern"
        });
        repoNotFound++;
    } else if (repoMarker.current === githubRepository) {
        log.info(`Repo line correct: ${repoPath}`);
        repoCorrect++;
    } else if (verify) {
        log.error({
            file: filePath,
            title: "Repo line out-of-sync",
            message: `${repoMarker.current} =/= ${githubRepository}`
        })
        repoUpdated++;
    } else {
        const leader = lines[repoMarker.index].slice(0, repoMarker.splitAt);
        lines[repoMarker.index] = `${leader}~${githubRepository}.git`;
        changed = true;
        log.notice({
            file: filePath,
            title: "Repo line updated",
            message: `${repoMarker.current} -> ${githubRepository}`
        })
        repoUpdated++;
    }

    // Filepath
    const pathMarker = findPathMarker(lines);
    if (!pathMarker) {
        log.error({
            file: filePath,
            title: "Path line not found",
            message: "No line in parsed file conformed to the provided pattern"
        });
        pathNotFound++;
    } else if (pathMarker.current === repoPath) {
        log.info(`Path line correct: ${repoPath}`);
        pathCorrect++;
    } else if (verify) {
        log.error({
            file: filePath,
            title: "Path line out-of-sync",
            message: `${pathMarker.current} =/= ${repoPath}`
        })
        pathUpdated++;
    } else {
        const leader = lines[pathMarker.index].slice(0, pathMarker.splitAt);
        lines[pathMarker.index] = `${leader}${repoPath}`;
        changed = true;
        log.notice({
            file: filePath,
            title: "Path line updated",
            message: `${pathMarker.current} -> ${repoPath}`
        })
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
    `    Repo line - ${verify ? 'Out-of-Sync' : 'Updated'}: ${repoUpdated}, Correct: ${repoCorrect}, Not found: ${repoNotFound}\n` +
    `    Path line - ${verify ? 'Out-of-Sync' : 'Updated'}: ${pathUpdated}, Correct: ${pathCorrect}, Not found: ${pathNotFound}\n` +
    `    Files unreadable: ${unreadable}`;

if (verify) {
    if (repoUpdated > 0 || pathUpdated > 0) {
        log.error(summary, { title: "Verification Failed" });
        process.exit(1);
    }
    log.notice(summary, { title: "Verification Passed" });
} else {
    log.notice(summary, { title: "Update Complete" });
}
