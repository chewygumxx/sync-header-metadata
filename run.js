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

const { execFileSync } = require('node:child_process');
const fs               = require('node:fs');
const YAML             = require('yaml');


// ------------------
// Parse Environment
// ------------------

const verbose = process.env.INPUT_VERBOSE === 'true';

function log(level, message) {
    if (level === 'INFO' && !verbose) return;
    process.stderr.write(`[${level}] ${message}\n`);
}

function fatal(message) {
    log('FATAL', message);
    process.exit(1);
}

const rawMode = process.env.INPUT_MODE || 'verify';
if (rawMode !== 'verify' && rawMode !== 'update')
    fatal(`mode must be 'verify' or 'update', received: ${rawMode}`);
const verify = rawMode === 'verify';

const githubRepository = process.env.GITHUB_REPOSITORY;
if (!githubRepository)
    fatal("Environment variable not set: GITHUB_REPOSITORY");

const ignoreConfigPath = process.env.INPUT_IGNORE_CONFIG || ".github/header_ignore.yaml";


// ----------------------
// Resolve Tracked Files
// ----------------------

try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
} catch {
    fatal('Dependency not found in PATH: git');
}

let repoRoot;
try {
    repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
} catch {
    fatal('Not inside a git repository');
}

let ignorePatterns = [];
try {
    const raw = fs.readFileSync(`${repoRoot}/${ignoreConfigPath}`, 'utf8');
    const doc = YAML.parse(raw) ?? {};
    ignorePatterns = doc.ignore ?? [];
    if (!Array.isArray(ignorePatterns) || !ignorePatterns.every(p => typeof p === 'string'))
        fatal(`${ignoreConfigPath}: 'ignore' must be a list of strings`);
} catch (err) {
    if (err.code !== 'ENOENT')
        fatal(`${ignoreConfigPath}: ${err.message}`);
}

for (const p of ignorePatterns) {
    if (p.startsWith('!'))
        fatal(`${ignoreConfigPath}: negation patterns are not supported: ${p}`);
}

// A leading '/' anchors to the repo root, strip it since pathspecs are already
// root-relative.
//
// A pattern with no remaining '/' would otherwise only match at the top level
// under pathspec glob matching, so such patterns are prefixed with '**/' to
// restore that behavior.
const pathspecs = ignorePatterns.map(p => {
    const anchored = p.startsWith('/') ? p.slice(1) : p;
    const pattern  = anchored.includes('/') ? anchored : `**/${anchored}`;
    return `:(exclude,glob)${pattern}`;
});

let fileListRaw;
try {
    fileListRaw = execFileSync(
        'git',
        ['-C', repoRoot, 'ls-files', '--', ...pathspecs],
        { encoding: 'utf8' }
    );
} catch (err) {
    fatal(`${ignoreConfigPath}: invalid ignore pattern(s): ${err.message}`);
}
const files = fileListRaw.split('\n').filter(Boolean);
if (files.length === 0) {
    log('WARN', 'No tracked files found in repository');
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
const PATH_MARKER = ' ::: :/';
function findPathMarker(lines) {
    for (let i = 0; i < lines.length; i++) {
        const char_idx = lines[i].indexOf(PATH_MARKER);
        if (char_idx !== -1) {
            const splitAt  = char_idx + PATH_MARKER.length - 1;
            return {
                index:   i,
                splitAt: splitAt,
                current: lines[i].slice(splitAt)
            };
        }
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
        log('INFO',   `Failed to read file as utf8 encoded: ${repoPath}`);
        unreadable++;
        continue;
    }
    const eol   = content.includes('\r\n') ? '\r\n' : '\n';
    const lines = content.split(/\r\n|\n/);

    // Repository
    let changed = false;
    const repoMarker = findRepoMarker(lines);
    if (!repoMarker) {
        log('INFO',   `Repo line not found: ${repoPath}`);
        repoNotFound++;
    } else if (repoMarker.current === githubRepository) {
        log('INFO',   `Repo line correct: ${repoPath}`);
        repoCorrect++;
    } else if (verify) {
        log('ERROR',  `Repo line out-of-sync: (${repoMarker.current} =/= ${githubRepository}) ${repoPath}`);
        repoUpdated++;
    } else {
        const leader = lines[repoMarker.index].slice(0, repoMarker.splitAt);
        lines[repoMarker.index] = `${leader}~${githubRepository}.git`;
        changed = true;
        log('NOTICE', `Repo line updated: (${repoMarker.current} -> ${githubRepository}) ${repoPath}`);
        repoUpdated++;
    }

    // Filepath
    const pathMarker = findPathMarker(lines);
    if (!pathMarker) {
        log('INFO',   `Path line not found: ${repoPath}`);
        pathNotFound++;
    } else if (pathMarker.current === repoPath) {
        log('INFO',   `Path line already correct: ${repoPath}`);
        pathCorrect++;
    } else if (verify) {
        log('ERROR',  `Path line out-of-sync: ${pathMarker.current} =/= ${repoPath}`);
        pathUpdated++;
    } else {
        const leader = lines[pathMarker.index].slice(0, pathMarker.splitAt);
        lines[pathMarker.index] = `${leader}${repoPath}`;
        changed = true;
        log('NOTICE', `Path line updated: ${pathMarker.current} -> ${repoPath}`);
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
        log('NOTICE', `Verification Failed: ${summary}`);
        process.exit(1);
    }
    log('NOTICE', `Verification Passed: ${summary}`);
} else {
    log('NOTICE', `Update Complete: ${summary}`);
}
