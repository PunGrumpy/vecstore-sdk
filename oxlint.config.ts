import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import { jsPluginSettings, selectJsPlugins } from "ultracite/oxlint/js-plugins";
import next from "ultracite/oxlint/next";
import nextJsPlugins from "ultracite/oxlint/next/js-plugins";
import react from "ultracite/oxlint/react";

const jsPlugins = selectJsPlugins(["github", "sonarjs", "react-doctor"]);

export default defineConfig({
  extends: [core, react, next, nextJsPlugins, antiSlop, jsPlugins],
  ignorePatterns: core.ignorePatterns,
  jsPlugins: jsPlugins.jsPlugins,
  rules: {
    // React effects bail out early with a bare `return;` and otherwise return
    // a cleanup. unicorn/no-useless-undefined forbids the explicit
    // `return undefined;` that this rule would need instead.
    "sonarjs/no-inconsistent-returns": "off",
  },
  settings: jsPluginSettings,
});
