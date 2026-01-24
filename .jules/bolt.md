## 2025-05-06 - KV N+1 Bottleneck
**Learning:** Cloudflare KV `list()` returns keys, but fetching values individually is slow (N+1). Storing metadata (status, date) in `kv.put(key, value, { metadata })` allows filtering and sorting directly from the list result, avoiding expensive body fetches for non-matching or non-page items.
**Action:** Always store sortable/filterable fields in KV metadata. When listing, use metadata to filter/sort candidates first, then fetch only the bodies needed for the response page.
