# HTTP and CDN Caching

Strategies for browser caching, HTTP cache headers, CDN edge caching, and content delivery optimization.

## Cache-Control Header Reference

### Directives

| Directive | Scope | Purpose |
|-----------|-------|---------|
| `public` | Shared caches (CDN, proxy) | Response can be stored by any cache |
| `private` | Browser only | Response is user-specific; CDN must not cache |
| `no-cache` | All | Cache may store but must revalidate before use |
| `no-store` | All | Cache must not store the response at all |
| `max-age=N` | All | Response is fresh for N seconds |
| `s-maxage=N` | Shared caches only | Overrides max-age for CDN/proxy caches |
| `must-revalidate` | All | Stale responses must not be used without revalidation |
| `immutable` | All | Response will not change during its freshness lifetime |
| `stale-while-revalidate=N` | All | Serve stale for N seconds while revalidating in background |
| `stale-if-error=N` | All | Serve stale for N seconds if origin returns 5xx |

---

## Caching Strategies by Content Type

### Static Assets (JS, CSS, Images, Fonts)

Use content-hashed filenames (fingerprinting) and long-lived cache:

```
Cache-Control: public, max-age=31536000, immutable
```

- Filename changes whenever content changes (e.g., `app.a1b2c3.js`)
- `immutable` prevents browsers from revalidating during max-age window
- CDN serves from edge; origin only hit on cache miss with new filename

**Build tool configuration:**

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        // Content hash in filenames
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash].[ext]',
      },
    },
  },
});
```

### HTML Documents

HTML cannot be fingerprinted (URLs are fixed), so use revalidation:

```
Cache-Control: no-cache
ETag: "v1-abc123"
```

- `no-cache` means the browser must revalidate on every request
- ETag allows conditional requests (304 Not Modified if unchanged)
- Alternative: short `max-age` with `stale-while-revalidate`

```
Cache-Control: public, max-age=0, stale-while-revalidate=30
ETag: "v1-abc123"
```

### API Responses (Public, Cacheable)

```
Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=60
ETag: "data-v2-hash"
Vary: Accept, Accept-Encoding, Authorization
```

- `s-maxage=300` lets CDN cache for 5 minutes while browsers cache for 1 minute
- `stale-while-revalidate=60` serves stale for 60s while refreshing in background
- `Vary` header ensures separate cache entries per request variant

### API Responses (Private, User-Specific)

```
Cache-Control: private, max-age=0, must-revalidate
ETag: "user-data-v3"
```

- `private` prevents CDN from caching user-specific data
- `must-revalidate` ensures stale data is never served without checking origin

### Sensitive Data (Auth Tokens, PII)

```
Cache-Control: no-store
Pragma: no-cache
```

- `no-store` prevents any caching whatsoever
- `Pragma: no-cache` provides HTTP/1.0 backward compatibility

---

## ETag and Conditional Requests

### How ETags Work

1. Server generates an ETag (hash of response content or version identifier)
2. Server includes `ETag: "abc123"` in response
3. Browser caches response with ETag
4. On next request, browser sends `If-None-Match: "abc123"`
5. Server compares ETag; if unchanged, returns `304 Not Modified` (no body)
6. Browser uses cached response

### Generating ETags

```typescript
import { createHash } from 'crypto';

function generateETag(content: string): string {
  return `"${createHash('md5').update(content).digest('hex')}"`;
}

// Weak ETag (allows semantically equivalent responses)
function generateWeakETag(version: number, lastModified: Date): string {
  return `W/"v${version}-${lastModified.getTime()}"`;
}
```

### Strong vs. Weak ETags

| Type | Format | Comparison | Use case |
|------|--------|------------|----------|
| Strong | `"abc123"` | Byte-for-byte identical | File downloads, exact content matching |
| Weak | `W/"abc123"` | Semantically equivalent | API responses, dynamic content |

---

## CDN Configuration

### Edge Caching Strategy

```
Origin -> CDN Edge (PoP) -> Browser
```

- Use `s-maxage` to control CDN TTL independently of browser TTL
- Use `Surrogate-Control` for CDN-specific directives (removed before reaching browser)
- Purge CDN cache on content updates via API or deploy hook

### CDN Cache Key Considerations

CDNs cache by URL + Vary headers. Minimize Vary headers to maximize cache hit ratio:

```
# Good: Vary on essential dimensions only
Vary: Accept-Encoding

# Careful: Vary on Accept creates separate entries per content type
Vary: Accept-Encoding, Accept

# Bad: Vary on Authorization fragments the cache per user
# Instead, use Cache-Control: private for user-specific content
```

### Cache Purging Patterns

| Strategy | When to use |
|----------|------------|
| **Purge by URL** | Single resource updated |
| **Purge by tag/surrogate-key** | Group of related resources updated |
| **Purge all** | Major deployment or data migration (use sparingly) |
| **Soft purge** | Mark stale but serve while revalidating |

```bash
# Cloudflare: Purge by URL
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
  -H "Authorization: Bearer {token}" \
  -d '{"files":["https://example.com/api/products"]}'

# Fastly: Purge by surrogate key
curl -X POST "https://api.fastly.com/service/{id}/purge/{key}" \
  -H "Fastly-Key: {token}"
```

### Surrogate Keys (Tag-Based CDN Invalidation)

```typescript
// Tag responses with surrogate keys for granular purging
app.get('/api/products/:id', (req, res) => {
  const product = getProduct(req.params.id);
  res.set('Surrogate-Key', `product-${product.id} products category-${product.categoryId}`);
  res.set('Cache-Control', 'public, s-maxage=3600');
  res.json(product);
});

// On product update, purge by tag
async function onProductUpdate(productId: string) {
  await cdn.purge({ surrogateKey: `product-${productId}` });
}

// On category update, purge all products in category
async function onCategoryUpdate(categoryId: string) {
  await cdn.purge({ surrogateKey: `category-${categoryId}` });
}
```

---

## Stale-While-Revalidate Pattern

The `stale-while-revalidate` directive is powerful for balancing freshness and performance:

```
Cache-Control: public, max-age=60, stale-while-revalidate=300
```

**Timeline:**
- 0-60s: Response is fresh; served directly from cache
- 60-360s: Response is stale; served from cache while background revalidation occurs
- 360s+: Response is stale and past grace period; full blocking request to origin

**When to use:**
- Content that updates periodically but brief staleness is acceptable
- APIs where low latency matters more than perfect freshness
- Pages with frequently changing but non-critical data

**When NOT to use:**
- Financial data requiring real-time accuracy
- Authentication/authorization responses
- Content with legal or compliance freshness requirements

---

## Common Mistakes

| Mistake | Consequence | Fix |
|---------|-------------|-----|
| No `Vary: Accept-Encoding` | Compressed and uncompressed responses mixed | Always include when compression is enabled |
| `Cache-Control: no-cache` misunderstood as "don't cache" | Data is still cached, just revalidated | Use `no-store` to prevent caching entirely |
| Missing `immutable` on fingerprinted assets | Browsers revalidate on refresh even within max-age | Add `immutable` to fingerprinted static assets |
| `Vary: *` | Effectively disables caching | Remove or specify only necessary headers |
| Caching responses with `Set-Cookie` | Cookie leaks to other users via shared cache | Set `Cache-Control: private` or `no-store` |
| No cache busting strategy for HTML | Users see stale HTML referencing old asset URLs | Use short TTL + revalidation for HTML |
