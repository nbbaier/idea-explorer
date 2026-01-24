## 2024-05-22 - KV List Optimization using Metadata

**Learning:** Cloudflare KV `list()` returns keys and metadata, which is much faster than fetching the full value for every key. Storing sort/filter fields (status, mode, created_at) in metadata enables O(1) page fetching (after listing keys) vs O(N) full fetches.
**Action:** When designing KV schemas for lists, always store sort/filter criteria in metadata. Use a lazy migration strategy (fallback to full fetch) to support existing data without downtime.
