# Supabase Test Suite

<p align="center" width="100%">
  <img height="250" src="https://raw.githubusercontent.com/constructive-io/supabase-test-suite/refs/heads/main/docs/img/logos.svg" />
</p>

<p align="center" width="100%">
  <a href="https://github.com/constructive-io/supabase-test-suite/actions/workflows/ci.yml">
    <img height="20" src="https://github.com/constructive-io/supabase-test-suite/actions/workflows/ci.yml/badge.svg" />
  </a>
   <a href="https://github.com/constructive-io/supabase-test-suite/blob/main/LICENSE"><img height="20" src="https://img.shields.io/badge/license-MIT-blue.svg"/></a>
</p>

A friendly playground for building and validating Supabase Row-Level Security (RLS). It includes real-world examples, migrations, and a comprehensive test suite you can run locally.

Built with [`supabase-test`](https://www.npmjs.com/package/supabase-test) — a Supabase-optimized version of [`pgsql-test`](https://www.npmjs.com/package/pgsql-test) for instant, isolated Postgres test databases with automatic rollbacks and Supabase defaults.

## Features

- 🔐 **RLS Policy Testing** - Real-world examples with users and products tables
- 🧪 **Comprehensive Test Suite** - End-to-end tests against native Supabase schemas
- 🐘 **Zero-Setup Postgres** - Supabase CLI local stack for instant development
- ⚡ **Jest Integration** - Fast, isolated tests with automatic rollbacks
- 🚀 **CI/CD Ready** - GitHub Actions workflows for automated testing
- 🧩 **Modular Architecture** - Reusable schema packages you can extend

## Quick Start

```bash
# Initialize and start local Supabase stack
npx supabase init
npx supabase start

# Install dependencies
pnpm install

# Run tests in watch mode
cd packages/hello-world
pnpm test:watch
```

## Repository Structure

This is a pgpm workspace combining `pnpm` and `pgpm` for modular Postgres packages:

- **`packages/supabase`** - Supabase-focused SQL, tests, and helpers
- **`packages/hello-world`** - Demo extension showcasing RLS with users/products

## Testing

Run tests in different modes:

```bash
# Run all tests from root
pnpm test

# Watch mode for specific package
cd packages/hello-world
pnpm test:watch

# Run Supabase package tests
cd packages/supabase
pnpm test:watch
```

## Requirements

- Node.js 20+
- pnpm 10+
- Supabase CLI 2+

## Troubleshooting

If you encounter connection issues, set your environment variables:

```bash
export PGPORT=54322
export PGHOST=localhost
export PGUSER=postgres
export PGPASSWORD=postgres
```

Common issues:
- Ensure Supabase services are running (`npx supabase status`)
- Check that ports match those shown by `npx supabase start`
- Use Node.js 20+ to avoid compatibility issues

## Education and Tutorials

 1. 🚀 [Quickstart: Getting Up and Running](https://constructive.io/learn/quickstart)
Get started with modular databases in minutes. Install prerequisites and deploy your first module.

 2. 📦 [Modular PostgreSQL Development with Database Packages](https://constructive.io/learn/modular-postgres)
Learn to organize PostgreSQL projects with pgpm workspaces and reusable database modules.

 3. ✏️ [Authoring Database Changes](https://constructive.io/learn/authoring-database-changes)
Master the workflow for adding, organizing, and managing database changes with pgpm.

 4. 🧪 [End-to-End PostgreSQL Testing with TypeScript](https://constructive.io/learn/e2e-postgres-testing)
Master end-to-end PostgreSQL testing with ephemeral databases, RLS testing, and CI/CD automation.

 5. ⚡ [Supabase Testing](https://constructive.io/learn/supabase)
Use TypeScript-first tools to test Supabase projects with realistic RLS, policies, and auth contexts.

 6. 💧 [Drizzle ORM Testing](https://constructive.io/learn/drizzle-testing)
Run full-stack tests with Drizzle ORM, including database setup, teardown, and RLS enforcement.

 7. 🔧 [Troubleshooting](https://constructive.io/learn/troubleshooting)
Common issues and solutions for pgpm, PostgreSQL, and testing.

## Credits

**🛠 Built by the [Constructive](https://constructive.io) team — creators of modular Postgres tooling for secure, composable backends. If you like our work, contribute on [GitHub](https://github.com/constructive-io).**

## Disclaimer

AS DESCRIBED IN THE LICENSES, THE SOFTWARE IS PROVIDED “AS IS”, AT YOUR OWN RISK, AND WITHOUT WARRANTIES OF ANY KIND.

No developer or entity involved in creating this software will be liable for any claims or damages whatsoever associated with your use, inability to use, or your interaction with other users of the code, including any direct, indirect, incidental, special, exemplary, punitive or consequential damages, or loss of profits, cryptocurrencies, tokens, or anything else of value.