"""Call the deployed gateway's owner route through its CLI, as the runbook's Check it does."""
import json, os, subprocess, sys, time
ROOT = subprocess.run(['git', 'rev-parse', '--show-toplevel'], cwd=os.path.dirname(os.path.abspath(__file__)),
                      capture_output=True, text=True, check=True).stdout.strip()
ENV = dict(os.environ, FACTORY_GATEWAY_URL=os.environ.get('FACTORY_GATEWAY_URL', 'http://100.82.142.64:8787'), FACTORY_GATEWAY_ROUTE='owner',
           FACTORY_GATEWAY_TOKEN_FILE=os.path.expanduser('~/.config/factory-gateway/owner.token'))
BIN = None
def _bin():
    global BIN
    if BIN is None:
        BIN = subprocess.run(['uv', 'run', '--frozen', '--project', 'endpoints/botcore/plugins/botcore-factory', 'which', 'factory-gateway'],
                             cwd=ROOT, env=ENV, capture_output=True, text=True, check=True).stdout.strip()
    return BIN
def call(cmd, args=None):
    argv = [_bin(), 'call', cmd] + (['--args', json.dumps(args)] if args else [])
    p = subprocess.run(argv, cwd=ROOT, env=ENV, capture_output=True, text=True)
    try:
        return json.loads(p.stdout)
    except ValueError:
        return {'success': False, 'error': {'code': 'NOT_JSON', 'message': (p.stdout + p.stderr)[-400:]}}
def remaining():
    d = call('gateway-status')
    return d['data']['rateLimit']['remaining'], d['data']['rateLimit']['resetAt']
if __name__ == '__main__':
    tests = json.loads(sys.argv[1])
    a0 = remaining(); a1 = remaining()
    print('status cost', a0[0] - a1[0], a1)
    for cmd, args in tests:
        a = remaining()[0]; t = time.time(); d = call(cmd, args); dt = time.time() - t; b = remaining()[0]
        print(f"{cmd} {json.dumps(args)} ok={d.get('success')} {(d.get('error') or {}).get('code','')} REST={a-b} {dt:.2f}s {len(json.dumps(d))}B")
