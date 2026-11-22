# Recorded production responses

JSON responses recorded on 2026-11-18 from the production API with `@octen.ai/sdk@0.1.0`.

Long free-text values (highlights, content, summaries) were replaced with placeholders; structure, field names, and other values are as recorded, except that one place address was shortened, an e-mail address was removed from an author field, and query strings were stripped from signed or tokenized image URLs.

- `search.json`: `POST /search` with `{"query":"solid-state battery breakthroughs","count":3,"time_range":"month","highlight":{"enable":true,"max_tokens":300}}`, recorded 2026-11-18.
- `broad-search.json`: `POST /broad-search` with `{"query":"compare cloud GPU pricing across providers","max_queries":3}`, recorded 2026-11-18.
- `news-search.json`: `POST /news-search` with `{"query":"EU AI Act enforcement","count":3,"time_range":"week"}`, recorded 2026-11-18.
- `business-search.json`: `POST /business-search` with `{"query":"compare Stripe and Adyen","entities":{"count":2}}`, recorded 2026-11-18.
- `place-search.json`: `POST /place-search` with `{"query":"coffee shops","latitude":35.6812,"longitude":139.7671,"radius":1000,"places":{"count":3}}`, recorded 2026-11-18.
- `pulse-search.json`: `POST /pulse-search` with `{"query":"github docs","count":3}`, recorded 2026-11-18.
- `search-premier.json`: `POST /search-premier` with `{"query":"solid-state battery breakthroughs","count":3,"time_range":"month","highlight":{"enable":true,"max_tokens":300}}`, recorded 2026-11-21 with `@octen.ai/sdk@0.2.0`; only the highlights were replaced with placeholders.
- `extract.json`: `POST /extract` with `{"urls":["https://octen.ai/","https://octen-tools-live-check.invalid/"],"include_images":true,"include_links":{"max_links":3}}`, recorded 2026-11-22 with `@octen.ai/sdk@0.3.0`; only the page content was replaced with a placeholder.
- `image-search.json`: `POST /image-search` with `{"inputs":[{"type":"text","data":"golden gate bridge at sunset"}],"count":3}`, recorded 2026-11-22 with `@octen.ai/sdk@0.3.0`; only the query strings of the signed thumbnail URLs were stripped.
- `design-search.json`: `POST /design-search` with `{"query":"pricing section for a SaaS landing page","images":{"count":3,"snippet":{"enable":true,"max_tokens":200}},"web_search":{"count":2}}`, recorded 2026-11-22 with `@octen.ai/sdk@0.3.0`; the highlights and the snippet code were replaced with placeholders, query strings were stripped from the signed image and thumbnail URLs, and two values not described in the API reference were removed (an empty `data.specs` list and a rendering hint inside one `design_facts` entry).
