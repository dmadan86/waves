# @waves/agent-mcp

An MCP server that lets an AI agent act **inside Waves as a specific signed-in
user** — list groups, add expenses, and record settlements — through the app's
own authorized RPCs and edge functions. It never runs raw SQL and never moves
money.

## Why this instead of a database MCP

A generic Supabase/Postgres MCP talks raw SQL with a management or service
token. That bypasses Row-Level Security **and** the app's RPC boundary
(ADR-013, #274), so it can write malformed ledger rows that skip split maths and
integrity checks. This server does the opposite: it authenticates as a real user
(their Supabase session) and calls the exact operations the mobile app calls, so
RLS and the business rules apply to the agent identically to the human.

## Safety model

- **Acts as one user.** Built with the public anon key + the user's JWT — same
  as `apps/mobile/src/lib/supabase.ts`. No service-role key is read. The agent
  can do what that person can do, nothing more.
- **No raw SQL.** There is no query tool. Every write is one named, validated
  operation.
- **No money movement.** `record_settlement` writes a settlement row (status
  `initiated`); the actual transfer is a UPI/PayPal handoff link (`payment_link`)
  a human opens and confirms in their own bank app.
- **Read-only switch.** `WAVES_MCP_READONLY=1` registers only the read tools.

## Tools

| Tool                | Kind  | Path                                                                               |
| ------------------- | ----- | ---------------------------------------------------------------------------------- |
| `whoami`            | read  | `auth.getUser`                                                                     |
| `list_groups`       | read  | `groups` (RLS)                                                                     |
| `list_members`      | read  | `group_members` (RLS)                                                              |
| `get_balances`      | read  | `group_balances` (RLS)                                                             |
| `create_group`      | write | `rpc('waves_create_group')`                                                        |
| `add_expense`       | write | `functions.invoke('expense-write')` → recomputes split, then `waves_apply_expense` |
| `record_settlement` | write | `rpc('waves_record_settlement')` — records only                                    |
| `add_people`        | write | `rpc('waves_add_ghost_member')` — names in, member ids out                         |
| `invite_link`       | write | `rpc('waves_ensure_group_join_token')` — the group's reusable join link            |
| `payment_link`      | pure  | builds a `upi://` or `paypal.me` link                                              |

All amounts are **integer minor units** (paise/cents) as strings — money is
never a float.

## Signing in

The server acts as one signed-in person, so it needs that person's session.
There are two ways to give it one.

**From this machine, with a code to your inbox** — the way to try it:

```bash
pnpm mcp:login --url=https://<ref>.supabase.co --key=<publishable key>
```

It sends a six-digit code (the same one the app's login door sends), takes it
back on the terminal, and stores the session in `~/.waves-mcp/session.json`,
owner-only. After that the server needs no environment at all, and refreshed
sessions are written back so a machine that signed in once stays signed in.

Sign-in is a command and not a tool on purpose. A stdio server has no channel
on which to ask a human for a code, and an agent that could _start_ a login
could be talked into starting one for somebody else's address.

**From the environment** — the way a deployment does it. Set below; the
environment wins wherever it is set, so a stored session never overrides it.

## Configuration

| Env var                        | Required | Notes                                         |
| ------------------------------ | -------- | --------------------------------------------- |
| `WAVES_SUPABASE_URL`           | yes      | falls back to `EXPO_PUBLIC_SUPABASE_URL`      |
| `WAVES_SUPABASE_ANON_KEY`      | yes      | falls back to `EXPO_PUBLIC_SUPABASE_ANON_KEY` |
| `WAVES_SUPABASE_ACCESS_TOKEN`  | yes      | the user's JWT                                |
| `WAVES_SUPABASE_REFRESH_TOKEN` | no       | supply it so long sessions auto-refresh       |
| `WAVES_MCP_READONLY`           | no       | `1` to expose read tools only                 |

## Run

```bash
pnpm --filter @waves/agent-mcp build
node apps/agent-mcp/dist/index.js
# or, without building:
pnpm --filter @waves/agent-mcp dev
```

MCP host config (stdio):

```json
{
  "mcpServers": {
    "waves-agent": {
      "command": "node",
      "args": ["apps/agent-mcp/dist/index.js"],
      "env": {
        "WAVES_SUPABASE_URL": "https://<ref>.supabase.co",
        "WAVES_SUPABASE_ANON_KEY": "<anon key>",
        "WAVES_SUPABASE_ACCESS_TOKEN": "<user jwt>",
        "WAVES_SUPABASE_REFRESH_TOKEN": "<user refresh token>"
      }
    }
  }
}
```

Inspect it locally:

```bash
npx @modelcontextprotocol/inspector node apps/agent-mcp/dist/index.js
```

## Status

The write tools are type-checked and the server has been probed over real stdio,
but nothing here has been run end-to-end against a live account. Verify against
a throwaway group before pointing it at anything real.

## Where this is going

This is Stage 0 of the agent story: stdio, one machine, one account. It is not a
thing to hand to somebody else — the session on disk is yours, and giving away
the server gives away your ledger.

Stage 1 makes it a product: [Supabase Auth's OAuth 2.1
server](https://supabase.com/docs/guides/auth/oauth-server) as the authorization
server, `/.well-known/oauth-protected-resource` (RFC 9728) published here,
Streamable HTTP instead of stdio, and server-side spend ceilings plus a
`client_id` audit trail so a person can see what their agent did in their name
and revoke it. Access tokens there are ordinary Supabase JWTs carrying `user_id`
and `role`, so every RLS policy in this repo keeps working unchanged for a
stranger's agent — which is what makes the whole idea tractable. At that point
`login.ts` and `store.ts` are deleted, because nothing should keep a refresh
token on disk.
