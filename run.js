#!/usr/bin/env node
// vim:set expandtab shiftwidth=4 filetype=javascript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/sync-header-metadata.git
// ::: :/run.js
//
//

"use strict";

const ActionLog = require("./src/action_log.js");
const { sync } = require("./src/sync.js");

// ------------------
// Parse Environment
// ------------------

const log = new ActionLog(
    (process.env.INPUT_VERBOSE || "").toLowerCase() === "true",
    (process.env.INPUT_ANNOTATION || "").toLowerCase() === "true",
);

const rawMode = (process.env.INPUT_MODE || "").toLowerCase() || "verify";
if (rawMode !== "verify" && rawMode !== "update")
    log.fatal(
        `Invalid mode: Must be 'verify' or 'update', received: ${rawMode}`,
    );

const githubRepository = process.env.GITHUB_REPOSITORY;
if (!githubRepository)
    log.fatal("Environment variable not set: GITHUB_REPOSITORY");

// ----
// Run
// ----

process.exit(sync({ mode: rawMode, repository: githubRepository, log }));
