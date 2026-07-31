# Materialized (ejected) vendor modules

These are the **committed output** of the apply proxies under `../packages`.

An apply proxy (`pgpm.apply.json` + the `supabase` vendor shape) is a *recipe*:
it transforms a source module into a new shape at deploy time. Running
`pgpm materialize` / `materializeApplyModule` on that recipe **ejects** the
result into an ordinary pgpm module — plain `deploy/ revert/ verify/ pgpm.plan /
*.control`, with every transform already baked into the SQL and no
`pgpm.apply.json`. Once ejected, it deploys like any hand-written module.

Both directions are ejected here:

| Module | Direction | What it proves |
|---|---|---|
| `packages/vendor-app-materialized` | Supabase shape → pgpm shape | auth subsystem excluded; FK + RLS rebound onto the generic `app_auth` provider; `extensions.uuid_generate_v4()` de-qualified to a bare `uuid_generate_v4()` from the `uuid-ossp` extension the module installs itself (both provider + extension declared in its control `requires`) |
| `packages/vendor-app-native-materialized` | pgpm shape → Supabase shape | references routed back onto the native `auth.users` / `auth.uid()`; extension calls re-qualified into the `extensions` schema; deploys on top of the `supabase` fixture module |

## Regenerating

The modules are generated (and their `requires` finalized) by the committed
recipe in the test package:

```bash
cd ../packages/portability-tests
pnpm exec ts-node src/materialize-fixtures.ts
```

Materialization is deterministic, so `__tests__/materialized-drift.test.ts` is
the drift gate: it re-materializes into a temp dir and asserts byte-identical
output against what is committed here. If a source module, the vendor shape, or
the transform engine changes the emitted SQL, that test fails until these
artifacts are regenerated and reviewed.

## Testing

- `__tests__/materialized-forward.test.ts` deploys and exercises the forward
  module on **plain PostgreSQL** (the generic provider, no vendor image).
- `__tests__/materialized-reverse.test.ts` deploys and exercises the reverse
  module on the **vendor stack** (`VENDOR_STACK=1`), because the native Supabase
  subsystem it targets needs Supabase-only extensions (`pg_graphql`,
  `supabase_vault`) unavailable on plain PostgreSQL. The determinism and the
  ejected SQL for this direction are still verified on plain PG by the drift
  gate.
