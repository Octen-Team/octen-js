---
name: octen-search-guide
description: >-
  Choose the right Octen tool for live web information. Use when a task needs
  current facts, sources for a claim, news, company or people data, a
  real-world place, images, design references, or the content of a known URL.
---

# Octen search guide

The Octen tools come from Octen's hosted MCP server. The server decides which
tools exist and what each one takes, so read a tool's own description and schema
for its parameters. This guide is about choosing between the tools and chaining
them well. It does not list every tool, and a tool it does not mention is still
fine to use.

In Devin the tools are on the `octen` MCP server: list them with
`mcp_list_tools` and call them with `mcp_call_tool`. This guide uses the tool
names, such as `search` and `extract`.

## Choose the tool

| The task needs… | Tool | Keep in mind |
| --- | --- | --- |
| One fact, one page, one document: a single focused lookup | `search` | The default. Fast and fresh. |
| The exact page when `search` came back thin or off-target, or a niche report or filing | `premier_search` | Deeper retrieval and reranking. Slower, and billed at its own rate. |
| What is being reported now: events, announcements, coverage of the last days or weeks | `news_search` | Also returns `subjects`: the coverage grouped into storylines with summaries. |
| A company or a person: what they do, key people, revenue, funding, share price, two of them compared | `business_search` | Returns structured cards that already hold the figures. Two companies in one query give a card each. |
| A real-world place: nearby shops, an address, opening hours, a phone number | `place_search` | Returns place cards. Pass the user's location when the question is relative to them. |
| The address of a site or docs page you could almost name | `pulse_search` | Predicts likely URLs very quickly. No freshness, no filters. |
| A question with three or more independent parts: surveys, landscape scans, comparisons across many sources | `broad_search` | Fans out into several searches, so it costs several times one `search`. |
| The content of a page whose URL you already have | `extract` | Takes several URLs in one call and returns clean markdown or text. |
| Pictures, photos, diagrams, visual references | `image_search` | Exactly one input: a text `query`, an `image_url`, or `image_data`. |
| Real designs to build from: web pages, page sections, app screens, slides | `design_search` | Returns screenshots with their colours, fonts and, for page sections, HTML. |

## Workflow

1. Turn the request into one short, self-contained question. Resolve pronouns
   and references from the conversation first.
2. Start with the most specific tool in the table. Use `search` when none of the
   specialised tools fits.
3. Read the titles and snippets before fetching more. Pass
   `highlight: {"enable": true}` when a ranked snippet per result is enough, and
   `full_content: {"enable": true}` only when the page body is needed, because it
   is heavier and costs more context. `pulse_search` ignores both in its default
   mode; `design_search` and `place_search` take them inside `web_search`.
   `place_search` returns no pages unless `web_search.enable` is true.
4. To read a result in full, call `extract` with its URL. Leave `query` unset to
   get the whole page; with `query` set it returns highlights instead.
5. Cite the URLs the answer relies on.

## Choosing between similar tools

- `search` or `broad_search`: prefer `search`. For a straight comparison of two
  known things, make two `search` calls; two companies go in one
  `business_search` query instead. Call `broad_search` once: for broader coverage
  raise `max_queries`, and follow up on gaps with `search` or `extract` rather
  than calling it again.
- `news_search` or `broad_search`: one news topic is `news_search`. A question
  that spans several recent events or angles is one `broad_search`, not repeated
  `news_search` calls.
- `search` or `premier_search`: use `search` for ordinary lookups. Move to
  `premier_search` when ranking quality is what is missing.
- `search` or `pulse_search`: use `pulse_search` only to find an address. It has
  no time window or domain filters and sees no fresh content.
- `news_search` or `business_search`: coverage of an event is `news_search`; a
  company or person profile and its numbers is `business_search`.
- `image_search` or `design_search`: general pictures are `image_search`;
  interface and slide references to build from are `design_search`.

## Tool-specific notes

- `place_search`: send `latitude` and `longitude` together, with `radius` to cap
  the distance, or `user_location` when only the city is known. A query that
  names its own area needs none of them.
- `extract`: if a page fails or comes back nearly empty, retry only those URLs
  with `mode` set to `advanced`. Advanced costs more than the standard mode, so
  do not use it by default.
- `design_search`: a page section or slide carries a `group_id`. To get the rest
  of that page or deck, call again with `images.group_id` set to that id and
  `images.count` set to the group's total, at most 100; the default returns
  only the first few, and a longer group returns its first 100. That call needs
  no `query`. The image links are signed and expire, so use
  them straight away. The response is large; set `web_search.enable` or
  `images.enable` to false when only the other is needed.
- `news_search`: domain filters narrow the articles only. When the user restricts
  the sources, answer from the articles, not from `subjects`.

## When a call fails

- In a Devin Cloud session, Octen's connection is set up in the Devin web app.
  If the `octen` server is missing, ask the user to check there that Octen is
  installed and enabled, then start a new session; plugins load when a session
  starts. If it asks for authentication or answers with a 401, including
  `code=401 msg=Invalid API Key`, ask them to connect it again there with an
  active key. Stop and ask; do not retry until they have.
- On the user's machine, if the `octen` server is missing, ask them to run
  `devin plugins list`. If octen is not listed, they install the plugin; if it
  is marked blocked, an organization policy blocks it and only its owner can
  allow it; if the server is disabled in `devin mcp list`, they run
  `devin mcp enable octen`. Then they start a new session.
- On the user's machine, if the server asks for authentication or answers with
  a 401, including `code=401 msg=Invalid API Key`, it is not signed in, its
  sign-in was revoked, or the key chosen at sign-in is no longer active. They
  run `devin mcp logout octen` and `devin mcp login octen` and choose an active
  key. Stop and ask; do not retry until they have.
- Any other error: report the message as returned, including its `request_id`,
  and continue with what the other results support.
