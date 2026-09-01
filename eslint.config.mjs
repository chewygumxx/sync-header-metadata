// vim:set expandtab shiftwidth=4 filetype=javascript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/sync-header-metadata.git
// ::: :/eslint.config.mjs
//
//

import js               from "@eslint/js";
import globals          from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
    {
        files:   ["**/*.{js,mjs,cjs}"],
        plugins: { js },
        extends: ["js/recommended"],
        languageOptions: { globals:    globals.node }
    },
    {
        files:   ["**/*.js"],
        languageOptions: { sourceType: "commonjs"   }
    },
]);
