## 2024-05-23 - KV List Optimization Pattern
**Learning:** Cloudflare KV `list()` returns metadata which can be used to filter/sort without fetching the full value. This turns O(N) reads into O(1) reads (or O(PageSize)).
**Action:** When designing KV schemas, always store sortable/filterable fields in metadata. Use a fallback "fetch-if-missing" strategy for backward compatibility.
