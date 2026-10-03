// vim:set expandtab shiftwidth=4 filetype=javascript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/sync-header-metadata.git
// ::: :/src/action_log.js
//
//

"use strict";

function escapeData(value) {
    return String(value)
        .replace(/%/g, "%25")
        .replace(/\r/g, "%0D")
        .replace(/\n/g, "%0A");
}

function escapeProperty(value) {
    return escapeData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

// Plain log lines are scanned by the runner for `::command::` prefixes too,
// so an embedded CR/LF in a value (a tracked filename, a CLI argument) could
// otherwise start a new line and smuggle in a workflow command.
function oneLine(value) {
    return String(value).replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}

function output(level, message) {
    const output = typeof message === "string" ? message : message.join("\n");
    console.log(`[${level.toUpperCase()}] ${output}`);
}

// GitHub's workflow-command annotation properties are named file/line/endLine/
// col/endColumn/title; startLine/endLine here mirror @actions/core's
// AnnotationProperties naming, translated to the wire names GitHub expects.
function annotate(command, opts) {
    const commandProps = {
        title: opts.title,
        file: opts.file,
        line: opts.startLine,
        endLine: opts.endLine || opts.startLine,
    };
    const props = Object.entries(commandProps)
        .filter(
            ([, value]) =>
                value !== undefined && value !== null && value !== "",
        )
        .map(([key, value]) => `${key}=${escapeProperty(value)}`)
        .join(",");
    console.log(
        `::${command === "warn" ? "warning" : command}${props ? " " + props : ""}::${escapeData(opts.message)}`,
    );
}

function wrap(command, opts, annotation_enabled) {
    // A multi-line message (e.g. the run summary) starts on its own line.
    const sep = opts.message.includes("\n") ? "\n" : " ";
    const message = opts.message ? `${sep}${opts.message}` : "";
    const file = opts.file ? ` ${oneLine(opts.file)}` : "";
    output(command, `${oneLine(opts.title)}:${message}${file}`);
    if (annotation_enabled) annotate(command, opts);
}

class ActionLog {
    constructor(verbose, annotation) {
        this.verbose = verbose === true;
        this.annotation = annotation === true;
    }

    info(message) {
        if (!this.verbose) return;
        output("info", oneLine(message));
    }
    notice(opts) {
        wrap("notice", opts, this.annotation);
    }
    warn(opts) {
        wrap("warn", opts, this.annotation);
    }
    error(opts) {
        wrap("error", opts, this.annotation);
    }
    fatal(message, code = 1) {
        output("fatal", oneLine(message));
        if (this.annotation)
            annotate("error", {
                title: `[FATAL] ${message}`,
                message: `[FATAL] ${message}`,
            });
        process.exit(typeof code === "number" ? code : 1);
    }
}

module.exports = ActionLog;
