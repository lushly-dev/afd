"""Every gh read agents ran on chosen days, as the gateway read it maps to, with loops
expanded by how long the call ran over its sleep."""
import json, os, re, sys, glob, collections
from datetime import datetime, timezone, timedelta
PT = timezone(timedelta(hours=-8))
DAYS = set(sys.argv[2].split(','))
GH = re.compile(r'(?:^|[\s;&|(`$])gh\s+(api|pr|issue|run|search)\s+(\S+)([^;&|\n]*)')
REPO_FLAG = re.compile(r'(?:-R|--repo)[ =]([\w.-]+/[\w.-]+)')
# Flags whose next word is their value; an on/off flag (--watch, --comments) takes none.
VALUE_FLAG = r'(?:-L|--limit|--interval|-i|-R|--repo|--json|-q|--jq|-t|--template|-w|-b|--body|--state|-s|--search|-S|--label|-l|--author|-A|--base|-B|--head|-H)[ =]\S+'
WRITES = {'create', 'edit', 'comment', 'merge', 'close', 'reopen', 'ready', 'rerun', 'cancel', 'review', 'lock', 'delete', 'develop', 'transfer', 'pin'}
def gateway_cmd(group, verb, rest):
    text = verb + rest
    if group == 'api':
        if re.search(r'-X\s*(POST|PATCH|PUT|DELETE)|--method\s+(POST|PATCH|PUT|DELETE)', rest) or (re.search(r'(^|\s)-f\s|-F\s|--field|--raw-field', rest) and 'graphql' not in verb):
            return 'write'
        if 'graphql' in verb: return 'unmapped'
        if re.search(r'/pulls/\d+/(files|comments|reviews)', text): return 'unmapped'
        if re.search(r'/issues/\d+/comments|issues/comments', text): return 'comment-list'
        if re.search(r'/pulls/\d+|/actions/runs|/check-runs|/commits/\S+/(status|check)', text): return 'pr-status'
        if re.search(r'/issues/\d+', text): return 'issue-get'
        if re.search(r'/issues(\?|\s|$)|/pulls(\?|\s|$)|search/', text): return 'claim-list'
        return 'unmapped'
    if verb in WRITES: return 'write'
    if group == 'pr' and verb in ('view', 'checks', 'status'): return 'pr-status'
    if group == 'run' and verb in ('view', 'list', 'watch'): return 'pr-status'
    if group == 'issue' and verb == 'view': return 'comment-list' if '--comments' in rest or 'comments' in rest else 'issue-get'
    if group in ('issue', 'pr') and verb == 'list': return 'claim-list'
    if group == 'search': return 'claim-list'
    return 'unmapped'
def repo_of(cmd, cwd, chunk):
    m = REPO_FLAG.search(chunk) or REPO_FLAG.search(cmd) or re.search(r'repos/([\w.-]+/[\w.-]+)', chunk)
    if m: return m.group(1)
    m = re.search(r'cd\s+(\S+)', cmd)
    path = (m.group(1) if m else '') or cwd or ''
    for name in ('lushly', 'afd'):
        if f'/{name}' in path or f'/lush-' in path and name == 'afd': return f'lushly-dev/{name}'
    return None
def iterations(cmd, elapsed):
    if not re.search(r'\b(for|while|until)\b[\s\S]*\bdo\b', cmd): return 1
    seq = re.search(r'seq\s+(?:\d+\s+)?(\d+)', cmd) or re.search(r'\{1\.\.(\d+)\}', cmd)
    cap = int(seq.group(1)) if seq else 10_000
    sl = [float(x) for x in re.findall(r'sleep\s+(\d+(?:\.\d+)?)', cmd)]
    if 'run watch' in cmd: return max(1, int((elapsed or 0) / 3))
    if not sl: return min(cap, 3)
    if elapsed is None: return min(cap, 1)
    return max(1, min(cap, int(elapsed / (sum(sl) + 2))))
rows = []
def handle(cmd, ts, cwd, elapsed, sess):
    if not cmd or not ts: return
    t = datetime.fromisoformat(ts.replace('Z', '+00:00')).astimezone(PT)
    if t.strftime('%Y-%m-%d') not in DAYS: return
    n = iterations(cmd, elapsed)
    if 'gh run watch' in cmd or 'gh pr checks' in cmd and '--watch' in cmd:
        n = max(n, int((elapsed or 0) / 10))  # watch polls every few seconds
    for m in GH.finditer(cmd):
        group, verb, rest = m.groups()
        # A flag's value (--limit 30, -L 10, --interval 30) is not a number to read. The replay of
        # 2026-11-23 ran before this was dropped and read 13 such values as pull requests.
        target = re.sub(VALUE_FLAG, ' ', verb + rest)
        num = re.search(r'(?:^|\s|/)#?(\d{2,5})\b', target)
        rows.append({'ts': t.isoformat(), 'sess': sess[-50:], 'repo': repo_of(cmd, cwd, m.group(0)), 'gh': f'{group} {verb}' if group != 'api' else 'api',
                     'gateway': gateway_cmd(group, verb, rest), 'num': int(num.group(1)) if num else None, 'times': n})
def ptime(ts): return datetime.fromisoformat(ts.replace('Z', '+00:00'))
for f in glob.glob(os.path.expanduser('~/.claude/projects/*/*.jsonl')) + glob.glob(os.path.expanduser('~/.claude/projects/*/*/subagents/*.jsonl')):
    pending = {}
    with open(f, encoding='utf-8', errors='replace') as fh:
        for line in fh:
            if 'gh ' not in line and 'tool_result' not in line: continue
            try: o = json.loads(line)
            except Exception: continue
            c = (o.get('message') or {}).get('content')
            for x in c if isinstance(c, list) else []:
                if not isinstance(x, dict): continue
                if x.get('type') == 'tool_use' and x.get('name') == 'Bash' and 'gh ' in json.dumps(x.get('input')):
                    pending[x.get('id')] = ((x.get('input') or {}).get('command', ''), o.get('timestamp'), o.get('cwd'))
                elif x.get('type') == 'tool_result' and x.get('tool_use_id') in pending:
                    cmd, ts, cwd = pending.pop(x['tool_use_id'])
                    el = (ptime(o['timestamp']) - ptime(ts)).total_seconds() if o.get('timestamp') and ts else None
                    handle(cmd, ts, cwd, el, f)
    for cmd, ts, cwd in pending.values(): handle(cmd, ts, cwd, None, f)
for f in glob.glob(os.path.expanduser('~/.codex/sessions/**/*.jsonl'), recursive=True):
    cwd = None; pending = {}
    with open(f, encoding='utf-8', errors='replace') as fh:
        for line in fh:
            if cwd is None and '"cwd"' in line:
                m = re.search(r'"cwd":"([^"]+)"', line); cwd = m.group(1) if m else None
            if 'gh ' not in line and 'call_id' not in line: continue
            try: o = json.loads(line)
            except Exception: continue
            p = o.get('payload') or {}
            if p.get('type') in ('function_call', 'custom_tool_call', 'local_shell_call'):
                a = p.get('arguments') or p.get('input') or ''
                try:
                    aj = json.loads(a) if isinstance(a, str) else a
                    cc = aj.get('command') or aj.get('cmd') or ''
                    cmd = ' '.join(cc) if isinstance(cc, list) else str(cc); w = aj.get('workdir') or cwd
                except Exception: cmd, w = str(a), cwd
                if 'gh ' in cmd: pending[p.get('call_id')] = (cmd, o.get('timestamp'), w)
            elif p.get('type') in ('function_call_output', 'custom_tool_call_output') and p.get('call_id') in pending:
                cmd, ts, w = pending.pop(p['call_id'])
                el = (ptime(o['timestamp']) - ptime(ts)).total_seconds() if o.get('timestamp') and ts else None
                handle(cmd, ts, w, el, f)
    for cmd, ts, w in pending.values(): handle(cmd, ts, w, None, f)
rows.sort(key=lambda r: r['ts'])
json.dump(rows, open(sys.argv[1], 'w'))
for day in sorted(DAYS):
    r = [x for x in rows if x['ts'].startswith(day)]
    calls = collections.Counter(); hours = collections.defaultdict(collections.Counter)
    for x in r:
        calls[x['gateway']] += x['times']; hours[x['ts'][11:13]][x['gateway']] += x['times']
    peak = max(hours, key=lambda h: sum(v for k, v in hours[h].items() if k not in ('write', 'unmapped')))
    print(day, 'invocations', len(r), 'expanded', dict(calls))
    print('   peak hour', peak, dict(hours[peak]))
