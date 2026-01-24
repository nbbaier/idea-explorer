## 2024-05-23 - KV List Performance
**Learning:** Fetching full objects from KV just to filter/sort them is a major bottleneck (N+1 reads). Storing filterable fields (status, mode, created_at) in KV metadata allows efficient filtering and sorting using `kv.list()` alone, reducing reads to O(PageSize).
**Action:** Always verify if list operations can be optimized using metadata before fetching full bodies. Ensure backward compatibility for items created before metadata was introduced.
