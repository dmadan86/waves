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
| `list_expenses`     | read  | `expenses` + the version in force (RLS)                                            |
| `create_group`      | write | `rpc('waves_create_group')`                                                        |
| `add_expense`       | write | `functions.invoke('expense-write')` → recomputes split, then `waves_apply_expense` |
| `edit_expense`      | write | the same, with `baseVersionNo` — appends a version, never overwrites               |
| `delete_expense`    | write | `rpc('waves_delete_expense')` — soft delete                                        |
| `record_settlement` | write | `rpc('waves_record_settlement')` — records only                                    |
| `add_people`        | write | `rpc('waves_add_ghost_member')` — names in, member ids out                         |
| `invite_link`       | write | `rpc('waves_ensure_group_join_token')` — the group's reusable join link            |
| `payment_link`      | pure  | builds a `upi://` or `paypal.me` link — a read, so read-only mode keeps it         |

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

The pure parts are unit-tested and now run in CI (`agent MCP tests`), and the
server has been probed over real stdio — but nothing here has been run
end-to-end against a live account. Verify against a throwaway group before
pointing it at anything real.

## Connecting somebody else's agent (remote)

The stdio server above is one machine and one account. For anybody else there
is `POST /api/mcp` on the web app, where each request carries its own bearer
token and the server keeps nothing between them.

The URL to give a connector is `https://app.wavs.co.in/api/mcp`. Nobody
exchanges an API key: a client with no token is refused with a
`WWW-Authenticate` header naming
`/.well-known/oauth-protected-resource/api/mcp` (RFC 9728), fetches that,
learns Supabase Auth is the authorization server, registers itself and runs an
authorization-code flow with PKCE. The person approves it once, in a browser,
as themselves.

The token that comes back is an ordinary Supabase JWT, so **every RLS policy in
this repo applies to the agent unchanged** — which is the reason this is a
small amount of code rather than a second permission system. It also carries a
`client_id` claim the app's own tokens do not, and that claim is what
`waves_assert_agent_cap` and `agent_writes` key off: a ceiling on how much an
assistant may write, and a record of what it did that the person can read and
act on.

Two things are owed before this is usable by strangers:

1. **Turn on the OAuth 2.1 server** in the Supabase dashboard (Auth → OAuth
   server) so `/.well-known/oauth-authorization-server` answers on the project.
   Until it does, a client discovers this endpoint and then has nowhere to get
   a token.
2. **Apply the migration** `20260907140000_agent_writes_and_caps` to prod. The
   ceiling and the audit trail are inert without it — and inert here means
   absent, not permissive.

`WAVES_MCP_READONLY=1` on the web deployment offers reads only; the write tools
are not registered at all, so they never appear in `tools/list`.

## Where this is going

This is Stage 0 of the agent story: stdio, one machine, one account. It is not a
thing to hand to somebody else — the session on disk is yours, and giving away
the server gives away your ledger.

Stage 1 is built — see the section above. What is left is the part only a
person can do: switching the OAuth server on in the Supabase dashboard, and
deploying the migration that gives the ceiling something to read.

After that, `login.ts` and `store.ts` can go: nothing should keep a refresh
token on disk once there is a flow that does not need one. They stay for now
because the stdio server is still how this gets tested.
