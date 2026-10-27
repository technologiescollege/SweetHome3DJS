// eslint.config.js
import globals from "globals";
import { defineConfig } from "eslint/config";

/**
 * Lint policy for this SweetHome3DJS fork:
 * - Official / JSweet-era view JS keeps `var` and same-scope `let i` redeclares → do not fight with auto-fixes
 *   (upstream SourceForge ports stay easier).
 * - Keep useful signal: undefined names (missing imports/globals) and unused locals (with ignore patterns).
 * - TypeScript is checked by `npm run typecheck`, not ESLint.
 */
export default defineConfig([
  {
    ignores: [
      "public/**/*",
      "dist/**/*",
      "node_modules/**/*",
      ".official-cache/**/*",
      ".official/**/*",
      "**/*.{ts,tsx}",
    ],
  },
  {
    files: ["src/**/*.{js,mjs,cjs}", "scripts/**/*.{js,mjs}", "*.{js,mjs}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        // j4ts / Sweet Home 3D legacy namespaces used as globals in view/loaders
        java: "readonly",
        org: "readonly",
        // gl-matrix often used without local import in loaders
        vec2: "readonly",
        vec3: "readonly",
        vec4: "readonly",
        mat3: "readonly",
        mat4: "readonly",
        quat: "readonly",
      },
    },
    rules: {
      // Legacy upstream style — noise vs sync-friendly ports
      "no-var": "off",
      "prefer-arrow-callback": "off",
      "no-redeclare": "off",

      "no-undef": "warn",
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_|^(ev|ex|error|err|e)$",
          varsIgnorePattern: "^_|^(ev|ex|error|err|e)$",
          caughtErrorsIgnorePattern: "^_|^(ev|ex|error|err|e)$",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
]);
