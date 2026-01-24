## 2024-05-22 - KV List Metadata Optimization
**Learning:** Cloudflare KV `list()` returns metadata, which allows filtering and sorting without fetching full object bodies. This transforms an O(N) fetch operation into an O(N) list + O(1) fetch (per page) operation.
**Action:** When storing objects in KV that need filtering, always store the filterable fields in the `metadata` property during `put()`. Update `list()` logic to use this metadata for filtering/sorting before fetching the full values. Maintain backward compatibility by fetching full objects if metadata is missing.
