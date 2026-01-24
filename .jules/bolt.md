## 2025-01-23 - [KV N+1 Bottleneck]
**Learning:** Storing `status`, `mode`, and `created_at` in Cloudflare KV metadata allows `listJobs` to filter and sort without fetching full object bodies, resolving an O(N) fetch bottleneck.
**Action:** Always verify if KV `list` operations are followed by N `get` calls and refactor to use metadata if possible.
