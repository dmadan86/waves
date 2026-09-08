---
id: authentication
title: Authentication
description: How a request identifies itself, and what a token is allowed to reach.
sidebar_position: 2
---

:::warning Provisional

The token model below is the shape the API is expected to take. It is not
settled, and the issuance flow in particular is still being designed. Treat this
page as a sketch until the real OpenAPI document replaces the provisional one.

:::

## Bearer token

Every request carries an access token in the `Authorization` header.

```bash
curl {{apiBaseUrl}}/v1/groups \
  -H "Authorization: Bearer $WAVES_TOKEN"
```

A missing, expired or malformed token answers `401`:

```json
{
  "error": {
    "code": "unauthorized",
    "message": "Sign in again to continue."
  }
}
```

## What a token can reach

A token acts as one person, and it reaches exactly what that person reaches in
the app — no more. This is not a filter the API applies on the way out; the rows
themselves are behind row-level security in the database, so a query for
somebody else's group returns nothing at any layer.

The practical consequences:

- You can read and write in the groups you are a member of.
- Actions restricted to a group admin in the app are restricted to one here.
- A group you are not in answers `404`, not `403`. See
  [Reading a group you are not in](./overview.md#reading-a-group-you-are-not-in).

## Keep the token out of the URL

Put it in the header, never in a query string. A URL is recorded almost
everywhere by default — access logs, browser history, `Referer` headers,
bookmarks, proxy caches — so a token in one leaks without anybody deciding it
should.

A header is not automatically safe, only less automatically unsafe: servers,
reverse proxies, APM agents and debug middleware can all be configured to
capture request headers. If you run any of those, redact `Authorization`
explicitly at each hop rather than assuming it was never written down.

## Self-hosted deployments

If you run your own Waves, tokens are issued by **your** identity provider
against **your** database, and `{{apiBaseUrl}}` is your own host. Nothing about
authentication routes through wavs.co.in. See
[MIGRATION.md]({{repoUrl}}/blob/main/MIGRATION.md).

## Next

[Reference →](./reference-intro.md)
