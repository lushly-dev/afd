# Frontend Data Caching

SWR, TanStack Query, service workers, browser storage APIs, and optimistic update patterns.

## SWR (Stale-While-Revalidate)

SWR is a lightweight (5.3KB gzipped) React Hooks library for data fetching with built-in caching, revalidation, and focus tracking.

### Basic Usage

```typescript
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(r => r.json());

function UserProfile({ userId }: { userId: string }) {
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    `/api/users/${userId}`,
    fetcher,
    {
      revalidateOnFocus: true,       // Revalidate when tab regains focus
      revalidateOnReconnect: true,   // Revalidate on network reconnect
      refreshInterval: 30000,        // Poll every 30 seconds
      dedupingInterval: 2000,        // Deduplicate requests within 2s
      errorRetryCount: 3,            // Retry failed requests 3 times
    }
  );

  if (isLoading) return <Skeleton />;
  if (error) return <ErrorMessage error={error} />;

  return <div>{data.name}</div>;
}
```

### Cache Mutation (Optimistic Updates)

```typescript
import useSWR, { mutate } from 'swr';

async function updateUser(userId: string, updates: Partial<User>) {
  // Optimistic update: immediately update cache
  mutate(
    `/api/users/${userId}`,
    async (currentData: User) => {
      // Send update to server
      const updated = await fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      }).then(r => r.json());

      return updated;
    },
    {
      optimisticData: (currentData: User) => ({ ...currentData, ...updates }),
      rollbackOnError: true,  // Revert cache if request fails
      revalidate: false,      // Skip revalidation (server response is fresh)
    }
  );
}
```

### Global Configuration

```typescript
import { SWRConfig } from 'swr';

function App({ children }) {
  return (
    <SWRConfig
      value={{
        fetcher: (url) => fetch(url).then(r => r.json()),
        revalidateOnFocus: true,
        shouldRetryOnError: true,
        errorRetryInterval: 5000,
        dedupingInterval: 2000,
        provider: () => new Map(), // Custom cache provider
      }}
    >
      {children}
    </SWRConfig>
  );
}
```

---

## TanStack Query (React Query)

TanStack Query (16.2KB gzipped) provides a full-featured data synchronization library with built-in cache management, devtools, and more granular cache control.

### Basic Usage

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

function UserProfile({ userId }: { userId: string }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['user', userId],        // Cache key (hierarchical)
    queryFn: () => fetchUser(userId),  // Fetch function
    staleTime: 5 * 60 * 1000,         // Data is fresh for 5 minutes
    gcTime: 10 * 60 * 1000,           // Garbage collect after 10 min unused
    retry: 3,                          // Retry failed requests
    refetchOnWindowFocus: true,        // Refetch when tab focused
    enabled: !!userId,                 // Conditional fetching
  });

  if (isLoading) return <Skeleton />;
  if (isError) return <ErrorMessage error={error} />;

  return <div>{data.name}</div>;
}
```

### Cache Invalidation and Mutations

```typescript
function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { userId: string; updates: Partial<User> }) =>
      fetch(`/api/users/${data.userId}`, {
        method: 'PATCH',
        body: JSON.stringify(data.updates),
      }).then(r => r.json()),

    // Optimistic update
    onMutate: async ({ userId, updates }) => {
      // Cancel in-flight queries
      await queryClient.cancelQueries({ queryKey: ['user', userId] });

      // Snapshot current value
      const previous = queryClient.getQueryData(['user', userId]);

      // Optimistically update cache
      queryClient.setQueryData(['user', userId], (old: User) => ({
        ...old,
        ...updates,
      }));

      return { previous };
    },

    // Rollback on error
    onError: (err, { userId }, context) => {
      queryClient.setQueryData(['user', userId], context?.previous);
    },

    // Refetch after success or error
    onSettled: (data, error, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['user', userId] });
    },
  });
}
```

### Query Key Hierarchy and Invalidation

```typescript
// Hierarchical query keys enable granular invalidation
useQuery({ queryKey: ['users', 'list', { page: 1, filter: 'active' }] });
useQuery({ queryKey: ['users', 'detail', userId] });
useQuery({ queryKey: ['users', 'detail', userId, 'orders'] });

// Invalidate all user queries
queryClient.invalidateQueries({ queryKey: ['users'] });

// Invalidate only user lists
queryClient.invalidateQueries({ queryKey: ['users', 'list'] });

// Invalidate specific user
queryClient.invalidateQueries({ queryKey: ['users', 'detail', userId] });
```

### Prefetching

```typescript
// Prefetch on hover (before navigation)
function UserLink({ userId }: { userId: string }) {
  const queryClient = useQueryClient();

  const prefetch = () => {
    queryClient.prefetchQuery({
      queryKey: ['user', userId],
      queryFn: () => fetchUser(userId),
      staleTime: 5 * 60 * 1000,
    });
  };

  return (
    <Link to={`/users/${userId}`} onMouseEnter={prefetch}>
      View User
    </Link>
  );
}
```

### Key Configuration Options

| Option | Default | Purpose |
|--------|---------|---------|
| `staleTime` | 0 | Duration (ms) data is considered fresh |
| `gcTime` | 5 min | Duration (ms) unused data stays in cache |
| `refetchOnWindowFocus` | true | Refetch when window regains focus |
| `refetchOnReconnect` | true | Refetch on network reconnect |
| `refetchInterval` | false | Polling interval (ms) |
| `retry` | 3 | Number of retries on failure |
| `retryDelay` | exponential | Delay function between retries |
| `enabled` | true | Whether query runs automatically |
| `placeholderData` | undefined | Placeholder while loading |

---

## SWR vs. TanStack Query Decision Guide

| Factor | SWR | TanStack Query |
|--------|-----|----------------|
| Bundle size | 5.3KB | 16.2KB |
| Cache control granularity | Basic | Fine-grained (staleTime, gcTime) |
| Devtools | Community | Official (React Query Devtools) |
| Optimistic updates | Manual mutate | Built-in mutation hooks |
| Prefetching | Supported | Built-in with prefetchQuery |
| Offline support | Limited | Built-in offline mutation queue |
| Infinite scroll | useSWRInfinite | useInfiniteQuery |
| Framework support | React only | React, Vue, Solid, Svelte, Angular |
| Best for | Simple apps, minimal overhead | Complex apps, advanced cache needs |

**Recommendation:** Use SWR for simple apps where minimal bundle size matters. Use TanStack Query for complex apps needing granular cache control, devtools, and multi-framework support.

---

## Service Worker Caching

### Cache-First Strategy (Static Assets)

```typescript
// service-worker.ts
const CACHE_NAME = 'static-v1';
const STATIC_ASSETS = ['/app.js', '/styles.css', '/logo.png'];

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener('fetch', (event: FetchEvent) => {
  if (isStaticAsset(event.request.url)) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
  }
});
```

### Network-First Strategy (API Data)

```typescript
self.addEventListener('fetch', (event: FetchEvent) => {
  if (isApiRequest(event.request.url)) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Clone response (can only be consumed once)
          const clone = response.clone();
          caches.open('api-cache').then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request)) // Offline fallback
    );
  }
});
```

### Stale-While-Revalidate Strategy

```typescript
self.addEventListener('fetch', (event: FetchEvent) => {
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request).then(response => {
        const clone = response.clone();
        caches.open('swr-cache').then(cache => cache.put(event.request, clone));
        return response;
      });

      // Return cached immediately; update cache in background
      return cached || fetchPromise;
    })
  );
});
```

---

## Browser Storage APIs for Caching

| API | Capacity | Persistence | Async | Best for |
|-----|----------|-------------|-------|----------|
| `localStorage` | ~5MB | Until cleared | No | Small config, preferences |
| `sessionStorage` | ~5MB | Tab lifetime | No | Per-session state |
| `IndexedDB` | Hundreds of MB | Until cleared | Yes | Large datasets, offline data |
| `Cache API` | Hundreds of MB | Until cleared | Yes | HTTP request/response pairs |
| Memory (variables) | Process RAM | Page lifetime | No | Hot, transient data |

### IndexedDB for Large Dataset Caching

```typescript
// Using idb package for cleaner IndexedDB API
import { openDB } from 'idb';

const db = await openDB('app-cache', 1, {
  upgrade(db) {
    const store = db.createObjectStore('api-responses', { keyPath: 'key' });
    store.createIndex('expiresAt', 'expiresAt');
  },
});

async function getCachedResponse<T>(key: string): Promise<T | null> {
  const entry = await db.get('api-responses', key);
  if (!entry || Date.now() > entry.expiresAt) {
    if (entry) await db.delete('api-responses', key);
    return null;
  }
  return entry.data as T;
}

async function setCachedResponse<T>(key: string, data: T, ttlMs: number): Promise<void> {
  await db.put('api-responses', {
    key,
    data,
    expiresAt: Date.now() + ttlMs,
  });
}
```

---

## Offline-First Patterns

```typescript
// Sync queue for offline mutations
class OfflineSyncQueue {
  private queue: Array<{ url: string; method: string; body: string }> = [];

  async enqueue(request: { url: string; method: string; body: string }) {
    this.queue.push(request);
    await this.persist();
  }

  async flush() {
    while (this.queue.length > 0) {
      const request = this.queue[0];
      try {
        await fetch(request.url, { method: request.method, body: request.body });
        this.queue.shift();
        await this.persist();
      } catch {
        break; // Still offline; stop flushing
      }
    }
  }

  private async persist() {
    localStorage.setItem('sync-queue', JSON.stringify(this.queue));
  }

  static restore(): OfflineSyncQueue {
    const instance = new OfflineSyncQueue();
    const saved = localStorage.getItem('sync-queue');
    if (saved) instance.queue = JSON.parse(saved);
    return instance;
  }
}

// Listen for connectivity changes
window.addEventListener('online', () => syncQueue.flush());
```
