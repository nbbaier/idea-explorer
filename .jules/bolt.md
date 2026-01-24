# Bolt's Journal

## 2024-05-23 - [KV List N+1 Optimization]
**Learning:** Cloudflare KV `list()` returns metadata which can be used to avoid fetching the full object value.
**Action:** When designing KV data models, always store filterable/sortable fields in metadata to enable efficient listing without N+1 `get()` calls. "Lazy migration" (fetching body if metadata missing) allows non-breaking adoption.
