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
        .replace(/%/g,  '%25')
        .replace(/\r/g, '%0D')
        .replace(/\n/g, '%0A');
}

function escapeProperty(value) {
    return escapeData(value)
        .replace(/:/g, '%3A')
        .replace(/,/g, '%2C');
}

function output(level, message) {
    const output = typeof message === "string" ? message : message.join('\n');
    console.log(`[${level.toUpperCase()}] ${output}`);
}

function annotate(command, opts) {
    const message = typeof opts.message === "string" ? opts.message : '' + typeof opts.file === "string" ? ` (${opts.file})` : '';
    const props = Object.entries(opts)
        .filter(([key,])    => key   !== "message")
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${key}=${escapeProperty(value)}`)
        .join(',');
    console.log(`::${command === 'warn' ? 'warning' : command}${props ? ' ' + props : ''}::${escapeData(message)} `);
}

function wrap(command, opts, annotation_enabled) {
    output(command, `${opts.title}: ${opts.message} (${opts.file})`);
    if (annotation_enabled) annotate(command, opts);
}

class ActionLog {
    constructor(verbose, annotation) {
        this.verbose    = verbose    === true;
        this.annotation = annotation === true;
    }

    info(message) {
        if (!this.verbose) return;
        output('info', message);
    }
    notice(opts) {
        wrap('notice', opts, this.annotation)
    }
    warn(opts) {
        wrap('warn',   opts, this.annotation)
    }
    error(opts) {
        wrap('error',  opts, this.annotation)
    }
    fatal(message, code = 1) {
        output('fatal', message);
        annotate('error', { title: `[FATAL] ${message}`, message: `[FATAL] ${message}` });
        process.exit(typeof code === 'number' ? code : 1);
    }
}

module.exports = ActionLog;
