---
id: reference-intro
title: Reference
description: How the endpoint reference is generated, and which document it currently comes from.
sidebar_position: 3
---

The pages under this category are **generated**, not written. Every endpoint,
parameter, schema and example below is read out of an OpenAPI document at build
time, so the reference cannot drift away from the API the way a hand-kept list
does.

:::warning Currently generated from a provisional document

The document behind these pages is
[`apps/docs/openapi/waves.provisional.yaml`]({{repoUrl}}/blob/main/apps/docs/openapi/waves.provisional.yaml)
— a placeholder written so the reference has something to render while the real
API is built in `apps/api`. Nothing in it is a commitment.

You can tell which document you are reading by its version: the provisional one
is `0.0.0-provisional`.

:::

## Where the document comes from

The generator reads whichever file `WAVES_OPENAPI_SPEC` points at, defaulting to
the provisional one. The `servers` entry in it is rewritten from
`WAVES_API_URL` before generation, so a self-hosted copy of these docs documents
its own host rather than ours.

That means switching to the real specification is one environment variable and a
rebuild — there is no generated content committed to this repository to go
stale.

## How to read the pages

Each endpoint gets a page with:

- The method and path, and what it is for.
- Every parameter, with its type and whether it is required.
- The request body schema, expanded.
- Every response, by status code, with the schema and an example.

Money is always the `{ minor, currency }` pair described in the
[overview](./overview.md#money-is-never-a-float). Read that first if you have
not.
