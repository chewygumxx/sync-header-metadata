#!/usr/bin/env node
// vim:set expandtab shiftwidth=4 filetype=javascript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/sync-header-metadata.git
// ::: :/bin/sync-header-metadata.js
//
//

"use strict";

const { parseArgs } = require("node:util");
const { execFileSync } = require("node:child_process");

const ActionLog = require("../src/action_log.js");
const { sync } = require("../src/sync.js");

const USAGE = `\
Usage: sync-header-metadata [options]

Checks and updates the "~owner/repo.git" and "::: :/<path>" header lines
in the tracked files of the current git repository.

Options:
  -m, --mode <verify|update>  verify: fail if any header line is out-of-sync (default)
                              update: rewrite out-of-sync header lines
  -r, --repo <owner/repo>     Repository to sync against
                              (default: $GITHUB_REPOSITORY, then the origin remote)
  -v, --verbose               Enable INFO-level logging
  -h, --help                  Show this help`;

// ----------------
// Parse Arguments
// ----------------

let args;
try {
    ({ values: args } = parseArgs({
        options: {
            mode: { type: "string", short: "m", default: "verify" },
            repo: { type: "string", short: "r" },
            verbose: { type: "boolean", short: "v", default: false },
            help: { type: "boolean", short: "h", default: false },
        },
    }));
} catch (err) {
    console.error(`${err.message}\n\n${USAGE}`);
    process.exit(2);
}

if (args.help) {
    console.log(USAGE);
    process.exit(0);
}

// Annotations are GitHub workflow commands; they are only noise in a terminal.
const log = new ActionLog(args.verbose, false);

const mode = args.mode.toLowerCase();
if (mode !== "verify" && mode !== "update")
    log.fatal(
        `Invalid mode: Must be 'verify' or 'update', received: ${args.mode}`,
    );

// -------------------
// Resolve Repository
// -------------------

// Accepts the scp-like (git@host:owner/repo.git) and URL
// (https://host/owner/repo, ssh://git@host/owner/repo.git) remote forms.
const REMOTE_RE =
    /^(?:[a-z+]+:\/\/[^/]+\/|[^@/]+@[^:]+:)(\S+?\/[^/\s]+?)(?:\.git)?\/?$/;
function repoFromOrigin() {
    let url;
    try {
        url = execFileSync("git", ["remote", "get-url", "origin"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
    } catch {
        return null;
    }
    const m = REMOTE_RE.exec(url);
    return m ? m[1] : null;
}

const repository =
    args.repo || process.env.GITHUB_REPOSITORY || repoFromOrigin();
if (!repository)
    log.fatal(
        "Could not resolve repository from the origin remote: Pass --repo <owner/repo>",
    );

// ----
// Run
// ----

process.exit(sync({ mode, repository, log }));
