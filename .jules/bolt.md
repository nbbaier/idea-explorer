## 2024-01-01 - KV List Filtering
**Learning:** Cloudflare KV `list()` returns metadata which is critical for performance. Filtering by fetching all values (`Promise.all(keys.map(get))`) is a major bottleneck as data grows.
**Action:** Always store filterable/sortable fields in KV metadata to enable O(1) filtering before fetching bodies.
