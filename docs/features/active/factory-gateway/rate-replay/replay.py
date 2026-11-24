"""Replay one hour of agents' GitHub reads through the deployed gateway, as fast as four
callers go, and read the App's REST budget before and after."""
import collections, json, sys, time
from concurrent.futures import ThreadPoolExecutor
import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gw
SERVED = {'lushly-dev/afd', 'lushly-dev/lushly'}
DEFAULT_PR = {'lushly-dev/afd': 2374, 'lushly-dev/lushly': 2908}
hour = sys.argv[1]  # e.g. 2026-11-21T18
rows = [r for f in sys.argv[2:] for r in json.load(open(f)) if r['ts'].startswith(hour)]
calls = []
for r in rows:
    repo = r['repo'] or 'lushly-dev/afd'
    if repo not in SERVED or r['gateway'] not in ('pr-status', 'issue-get', 'comment-list', 'claim-list'): continue
    g = r['gateway']
    if g == 'claim-list': args = {'repo': repo}
    elif g == 'pr-status': args = {'repo': repo, 'number': r['num'] or DEFAULT_PR[repo]}
    else: args = {'repo': repo, 'number': r['num'] or 1809 if repo.endswith('afd') else r['num'] or 2392}
    calls += [(g, args)] * r['times']
print('calls', len(calls), dict(collections.Counter(c for c, _ in calls)), flush=True)
before = gw.remaining(); t0 = time.time()
def one(c):
    t = time.time(); d = gw.call(*c); return c[0], d.get('success'), (d.get('error') or {}).get('code'), time.time() - t
with ThreadPoolExecutor(4) as pool:
    results = list(pool.map(one, calls))
elapsed = time.time() - t0; after = gw.remaining()
out = collections.defaultdict(lambda: {'n': 0, 'ok': 0, 'errors': collections.Counter(), 'secs': []})
for c, ok, code, s in results:
    o = out[c]; o['n'] += 1; o['ok'] += bool(ok); o['secs'].append(s)
    if not ok: o['errors'][code] += 1
print(json.dumps({'hour': hour, 'before': before, 'after': after, 'rest': before[0] - after[0], 'elapsed': round(elapsed),
                  'by': {c: {'n': o['n'], 'ok': o['ok'], 'errors': dict(o['errors']), 'p50': round(sorted(o['secs'])[len(o['secs']) // 2], 2), 'max': round(max(o['secs']), 2)} for c, o in out.items()}}, indent=1))
