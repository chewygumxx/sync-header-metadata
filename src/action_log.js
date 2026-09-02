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

class ActionLog {
    constructor(verbose, annotation) {
        this.verbose    = verbose    === true;
        this.annotation = annotation === true;
    }

    output(level, message) {
        if (level === 'info' && !this.verbose) return;
        console.log(`[${level.toUpperCase()}] ${message}`);
    }

    annotate(command, message, opts) {
        if (!this.annotation) return;
        const props = Object.entries(opts || {})
            .filter(([, value]) => value !== undefined && value !== null && value !== '')
            .map(([key, value]) => `${key}=${escapeProperty(value)}`)
            .join(',');
        console.log(`::${command}${props ? ' ' + props : ''}::${escapeData(message)}`);
    }

    info(message) {
        this.output('info', message);
    }
    notice(message, opts) {
        this.output('notice', message);
        this.annotate('notice', message, opts);
    }
    warn(message, opts) {
        this.output('warn', message);
        this.annotate('warning', message, opts);
    }
    error(message, opts) {
        this.output('error', message);
        this.annotate('error', message, opts);
    }
    fatal(message, code = 1) {
        this.output('fatal', message);
        this.annotate('error', message);
        process.exit(typeof code === 'number' ? code : 1);
    }
}

module.exports = ActionLog;
