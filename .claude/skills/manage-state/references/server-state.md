# Server State Management

Reference for managing server-owned data with TanStack Query, SWR, and cache synchronization patterns.

## Server State vs Client State

Server state is fundamentally different from client state:

| Characteristic | Client state | Server state |
|---|---|---|
| Ownership | Application owns it | Remote server owns it |
| Source of truth | In-memory | Database / API |
| Staleness | Never stale (it IS the truth) | Can become stale immediately |
| Persistence | Lives in browser memory | Persists across sessions on server |
| Shared | Single user sees it | Multiple users may modify it |
| Operations | Synchronous mutations | Async fetch, cache, invalidate |

**Core principle**: Do not store server data in Zustand, Redux, Pinia, or any client store. Use a purpose-built server state library that handles caching, staleness, background refetching, deduplication, and error retries.

## TanStack Query (React Query v5)

### Setup

```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,       // 5 minutes before data is stale
      gcTime: 1000 * 60 * 30,          // 30 minutes before garbage collection
      retry: 3,                         // Retry failed requests 3 times
      refetchOnWindowFocus: true,       // Refetch when tab regains focus
      refetchOnReconnect: true,         // Refetch on network reconnect
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MyApp />
    </QueryClientProvider>
  );
}
```

### Queries (Reading Data)

```typescript
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';

// Basic query
function UserProfile({ userId }: { userId: string }) {
  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['users', userId],
    queryFn: () => fetchUser(userId),
    staleTime: 1000 * 60 * 5,
    enabled: !!userId,  // Only fetch when userId exists
  });

  if (isLoading) return <Skeleton />;
  if (isError) return <ErrorMessage error={error} />;
  return <Profile user={data} />;
}

// Suspense query (works with React Suspense boundaries)
function UserProfile({ userId }: { userId: string }) {
  const { data } = useSuspenseQuery({
    queryKey: ['users', userId],
    queryFn: () => fetchUser(userId),
  });
  // data is guaranteed to exist here
  return <Profile user={data} />;
}
```

### Query Key Design

Query keys are the foundation of cache identity. Design them hierarchically:

```typescript
// Hierarchical key structure
['users']                           // All users list
['users', { role: 'admin' }]       // Filtered users
['users', userId]                   // Specific user
['users', userId, 'posts']         // User's posts
['users', userId, 'posts', postId] // Specific post

// Factory pattern for query keys
const userKeys = {
  all:      ['users'] as const,
  lists:    () => [...userKeys.all, 'list'] as const,
  list:     (filters: Filters) => [...userKeys.lists(), filters] as const,
  details:  () => [...userKeys.all, 'detail'] as const,
  detail:   (id: string) => [...userKeys.details(), id] as const,
};

// Usage
useQuery({ queryKey: userKeys.detail(userId), queryFn: ... });
queryClient.invalidateQueries({ queryKey: userKeys.lists() }); // Invalidate all lists
```

### Mutations (Writing Data)

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';

function CreateUser() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (newUser: CreateUserInput) => api.createUser(newUser),
    onSuccess: (data) => {
      // Invalidate and refetch user lists
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      mutation.mutate({ name: 'Alice', email: 'alice@example.com' });
    }}>
      <button disabled={mutation.isPending}>
        {mutation.isPending ? 'Creating...' : 'Create User'}
      </button>
      {mutation.isError && <p>Error: {mutation.error.message}</p>}
    </form>
  );
}
```

### Optimistic Updates

```typescript
const mutation = useMutation({
  mutationFn: updateTodo,
  onMutate: async (newTodo) => {
    // Cancel in-flight queries
    await queryClient.cancelQueries({ queryKey: ['todos', newTodo.id] });

    // Snapshot previous value
    const previousTodo = queryClient.getQueryData(['todos', newTodo.id]);

    // Optimistically update cache
    queryClient.setQueryData(['todos', newTodo.id], newTodo);

    // Return snapshot for rollback
    return { previousTodo };
  },
  onError: (err, newTodo, context) => {
    // Rollback on error
    queryClient.setQueryData(['todos', newTodo.id], context.previousTodo);
  },
  onSettled: () => {
    // Always refetch to ensure consistency
    queryClient.invalidateQueries({ queryKey: ['todos'] });
  },
});
```

### Cache Invalidation Strategies

| Strategy | When to use | Example |
|---|---|---|
| **Invalidate on mutation** | After create/update/delete | `queryClient.invalidateQueries({ queryKey: ['users'] })` |
| **Broad invalidation** | Parent key invalidates children | Invalidate `['users']` refreshes `['users', id]` too |
| **Targeted invalidation** | Only specific queries | `queryClient.invalidateQueries({ queryKey: ['users', userId] })` |
| **Optimistic + invalidate** | Instant UI + eventual consistency | Set cache immediately, invalidate on settled |
| **Manual cache update** | Skip refetch, trust mutation response | `queryClient.setQueryData(['users', id], updatedUser)` |
| **Polling** | Near-real-time data | `refetchInterval: 5000` |
| **WebSocket invalidation** | Real-time updates from server | Listen to WS events, call `invalidateQueries` |

### Prefetching

```typescript
// Prefetch on hover
function UserLink({ userId }) {
  const queryClient = useQueryClient();

  return (
    <Link
      to={`/users/${userId}`}
      onMouseEnter={() => {
        queryClient.prefetchQuery({
          queryKey: ['users', userId],
          queryFn: () => fetchUser(userId),
          staleTime: 1000 * 60 * 5,
        });
      }}
    >
      View User
    </Link>
  );
}

// Prefetch in route loader (React Router / TanStack Router)
export const loader = (queryClient) => async ({ params }) => {
  await queryClient.ensureQueryData({
    queryKey: ['users', params.userId],
    queryFn: () => fetchUser(params.userId),
  });
};
```

### Infinite Queries (Pagination)

```typescript
import { useInfiniteQuery } from '@tanstack/react-query';

const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
  queryKey: ['posts'],
  queryFn: ({ pageParam }) => fetchPosts(pageParam),
  initialPageParam: 0,
  getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
});

// Flatten pages for rendering
const allPosts = data?.pages.flatMap(page => page.items) ?? [];
```

## SWR

SWR (stale-while-revalidate) from Vercel provides a lighter alternative to TanStack Query.

### Basic Usage

```typescript
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(res => res.json());

function UserProfile({ userId }) {
  const { data, error, isLoading, mutate } = useSWR(`/api/users/${userId}`, fetcher);

  if (isLoading) return <Skeleton />;
  if (error) return <ErrorMessage />;
  return <Profile user={data} />;
}
```

### SWR Mutation

```typescript
import useSWRMutation from 'swr/mutation';

async function updateUser(url: string, { arg }: { arg: UpdateUserInput }) {
  return fetch(url, { method: 'PUT', body: JSON.stringify(arg) }).then(r => r.json());
}

function EditUser({ userId }) {
  const { trigger, isMutating } = useSWRMutation(`/api/users/${userId}`, updateUser);

  const handleSubmit = async (data) => {
    await trigger(data);
    // SWR automatically revalidates the key
  };
}
```

### Global Configuration

```typescript
import { SWRConfig } from 'swr';

<SWRConfig value={{
  fetcher: (url) => fetch(url).then(r => r.json()),
  refreshInterval: 30000,
  revalidateOnFocus: true,
  dedupingInterval: 2000,
  errorRetryCount: 3,
}}>
  <App />
</SWRConfig>
```

## TanStack Query vs SWR Decision Guide

| Criteria | TanStack Query | SWR |
|---|---|---|
| Bundle size | ~16KB (gzip) | ~5KB (gzip) |
| Mutations | First-class `useMutation` hook | `useSWRMutation` (separate import) |
| Devtools | Built-in, feature-rich | Community plugin |
| Infinite queries | Built-in `useInfiniteQuery` | `useSWRInfinite` |
| Optimistic updates | Full rollback pattern | Manual |
| Offline support | Built-in | Manual |
| Framework support | React, Vue, Solid, Angular, Svelte | React only |
| Complexity | More features, more to learn | Simpler API |

**Recommendation**: Use TanStack Query for most projects. Use SWR when bundle size is critical and your needs are simple.

## Framework-Specific Server State

### Vue (TanStack Query)

```typescript
import { useQuery } from '@tanstack/vue-query';

const { data, isLoading } = useQuery({
  queryKey: ['users'],
  queryFn: fetchUsers,
});
// data and isLoading are Vue refs
```

### Svelte (TanStack Query)

```typescript
import { createQuery } from '@tanstack/svelte-query';

const query = createQuery({
  queryKey: ['users'],
  queryFn: fetchUsers,
});
// $query.data, $query.isLoading via Svelte store syntax
```

## Agentic Considerations

- **Never put API data in stores**: If an agent sees `useEffect` + `setState` for fetching data, suggest migrating to TanStack Query or SWR
- **Design query keys carefully**: Use the factory pattern above for predictable cache behavior. Agents should generate key factories when creating new query modules.
- **Include error handling**: Every query should have a loading state and error state in the UI. Never generate queries without handling both.
- **Invalidate, do not refetch manually**: After mutations, use `invalidateQueries` rather than manual refetch calls. Let the cache layer decide when to refetch.
- **Avoid waterfall queries**: If multiple queries are independent, fire them in parallel. Use `useQueries` for parallel fetching.
