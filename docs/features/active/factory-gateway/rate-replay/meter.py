"""Count the GitHub requests and GraphQL points each gateway read makes, through the real
adapter and service, with the owner's token standing in for the App's (costs are the same)."""
import json, os, re, sys, tempfile, time
from pathlib import Path
import httpx
from botcore_factory.gateway.config import GatewayConfig
from botcore_factory.gateway.github_app import GitHubApp
from botcore_factory.gateway.service import Gateway
from botcore_factory.gateway.state import GatewayState

LOG = []
class Meter(httpx.BaseTransport):
    def __init__(self):
        self.inner = httpx.HTTPTransport()
    def handle_request(self, request):
        cost = None
        if request.url.path == '/graphql':
            body = json.loads(request.content)
            body['query'] = re.sub(r'\{', '{ rateLimit { cost } ', body['query'], count=1)
            request = httpx.Request(request.method, request.url, headers={k: v for k, v in request.headers.items() if k.lower() != 'content-length'}, json=body)
        response = self.inner.handle_request(request)
        response.read()
        if request.url.path == '/graphql':
            try:
                cost = (json.loads(response.content).get('data') or {}).get('rateLimit', {}).get('cost')
            except ValueError:
                pass
        LOG.append(('graphql' if request.url.path == '/graphql' else 'rest', request.method, request.url.path, cost))
        return response

class OwnerToken(GitHubApp):
    def token(self):
        return os.environ['OWNER_GH_TOKEN']

def gateway():
    config = GatewayConfig.model_validate({
        'bot': 'lushly-factory-gateway[bot]', 'owner': os.environ['OWNER_LOGIN'], 'ownerEmails': ['owner@example.invalid'],
        'repositories': ['lushly-dev/afd', 'lushly-dev/lushly']})
    github = OwnerToken(app_id=1, installation_id=1, private_key='unused', bot=config.bot,
                        data_dir=Path(tempfile.mkdtemp()), transport=Meter())
    return Gateway(github, config, GatewayState(Path(tempfile.mkdtemp())), 'owner')

if __name__ == '__main__':
    g = gateway()
    out = []
    for cmd, args in json.loads(sys.argv[1]):
        LOG.clear(); t = time.time()
        try:
            r = getattr(g, cmd.replace('-', '_'))(**args)
            ok = getattr(r, 'success', None)
        except Exception as exc:
            ok = f'{type(exc).__name__}: {str(exc)[:120]}'
        rest = sum(1 for k, *_ in LOG if k == 'rest'); gq = [c for k, _, _, c in LOG if k == 'graphql']
        row = {'cmd': cmd, 'args': args, 'ok': ok, 'rest': rest, 'graphqlQueries': len(gq), 'graphqlPoints': sum(c or 0 for c in gq), 'secs': round(time.time() - t, 2),
               'paths': sorted({p for k, _, p, _ in LOG if k == 'rest'})}
        out.append(row); print(json.dumps(row))
