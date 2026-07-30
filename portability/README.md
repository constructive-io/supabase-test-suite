# Portability

This folder is **not** part of the Supabase testing tutorial in `packages/` — it's a
self-contained demonstration of **cross-shape transpilation**: taking a database
package written against one environment's conventions and mechanically re-shaping it
for another, the way npm lets you import a package under whatever name fits your
project.

It exercises the pgpm apply/transform toolchain (`@pgpmjs/core`, `@pgpmjs/slice`,
`@pgpmjs/transform`) end-to-end, in **both directions**:

| Direction | What happens |
|-----------|--------------|
| source shape → pgpm shape | The package's `auth` subsystem is **excluded** wholesale; every surviving reference (FK targets, RLS accessor calls) is **rebound** onto a tiny generic provider module deployed as an ordinary dependency; `extensions.*` symbols are de-qualified (resolved via `search_path`); grants are translated to local role names. |
| pgpm shape → source shape | The same transforms inverted: provider objects rebound onto the environment's native subsystem, bare extension symbols re-qualified, roles translated back. Deployed against the real stack — no provider needed, its native subsystem satisfies the contract. |

## Layout

```
portability/
├── pgpm.json             # pgpm workspace for the fixture modules
└── packages/
    ├── vendor-app/       # source-shaped module: auth subsystem + consumer app
    ├── auth-provider/    # generic replacement provider (users table + accessor)
    ├── vendor-app-ported/# apply spec: exclude auth, rebind onto the provider
    └── portability-tests/# the test suites
```

## The substitution contract

Subsystem exclusion is **cascade-safe**: `excludeSubsystem` measures the external
surface of the excluded schema from the reference graph and refuses unless every
surviving reference has a substitute. `contract.test.ts` measures the real vendored
fixture (`packages/supabase/deploy/supabase.sql`) and shows the entire external
contract of its auth subsystem is just:

- one `users` table (a uuid PK, referenced by 3 foreign keys), and
- the claim-accessor functions with live call sites.

Everything else in the subsystem is internal implementation detail, and a
provider satisfying that tiny surface is a drop-in substitute.

## Test suites

- `transpile.test.ts` — pure transforms, both directions, plus the refusal path
- `contract.test.ts` — contract measurement on the real vendored fixture
- `deploy-ported.test.ts` — pgpm-shaped output deployed live: FK enforcement and RLS
  through the provider accessor (runs on any plain PostgreSQL)
- `deploy-vendor.test.ts` — vendor-shaped output deployed against the real stack
  (runs when `VENDOR_STACK=1`, i.e. the vendor-image workflow)

## Workflows

`.github/workflows/portability.yml` runs the suite twice:

- **pgpm image** — plain PostgreSQL (`ghcr.io/constructive-io/docker/postgres-plus`),
  the constructive-style workflow: provider installed as a pgpm module,
  substituted package deployed on top.
- **vendor image** — the same Supabase stack as the main CI workflow, additionally
  running the reverse-direction deploy.

The main tutorial workflow (`ci.yml`) is untouched.
