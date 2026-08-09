# CI local equivalence

- Timestamp: `2026-08-09T19:25:03Z`
- Node: `v24.17.0`
- Checkout: `/tmp/ci-check-aCEb04/repo`
- Commit: `ec1562ce23552454671d82326d86251a82bdf361`

## `npm ci`

```text

added 245 packages, and audited 246 packages in 3s

102 packages are looking for funding
  run `npm fund` for details

1 high severity vulnerability

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.

[exit code: 0]
```

## `npm run typecheck`

```text

> bingo-gui@0.1.0 typecheck
> tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json


[exit code: 0]
```

## `npm test`

```text

> bingo-gui@0.1.0 test
> vitest run


[1m[30m[46m RUN [49m[39m[22m [36mv4.1.10 [39m[90m/private/tmp/ci-check-aCEb04/repo[39m

 [32m✓[39m src/renderer/src/state/chatReducer.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 2[2mms[22m[39m
 [32m✓[39m src/main/visual/capture.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 2[2mms[22m[39m
 [32m✓[39m src/main/runtime/sessionManager.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 3[2mms[22m[39m
 [32m✓[39m src/shared/contracts/cli.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 8[2mms[22m[39m
 [32m✓[39m src/main/runtime/runtimeLocator.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 95[2mms[22m[39m
 [32m✓[39m src/main/runtime/stdioBingoSession.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 153[2mms[22m[39m

[2m Test Files [22m [1m[32m6 passed[39m[22m[90m (6)[39m
[2m      Tests [22m [1m[32m12 passed[39m[22m[90m (12)[39m
[2m   Start at [22m 03:25:09
[2m   Duration [22m 342ms[2m (transform 297ms, setup 0ms, import 427ms, tests 263ms, environment 0ms)[22m


[exit code: 0]
```

## `npm run build`

```text

> bingo-gui@0.1.0 build
> electron-vite build

vite v6.4.3 building SSR bundle for production...
transforming...
✓ 8 modules transformed.
rendering chunks...
out/main/index.js  25.67 kB
✓ built in 69ms
vite v6.4.3 building SSR bundle for production...
transforming...
✓ 81 modules transformed.
rendering chunks...
out/preload/index.js  128.13 kB
✓ built in 191ms
vite v6.4.3 building for production...
transforming...
✓ 190 modules transformed.
rendering chunks...
../../out/renderer/index.html                   0.39 kB
../../out/renderer/assets/index-BiaOLXYV.css    3.13 kB
../../out/renderer/assets/index-CUiLp6NI.js   849.95 kB
✓ built in 522ms

[exit code: 0]
```

