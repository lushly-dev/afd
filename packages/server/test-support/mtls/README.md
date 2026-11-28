# Test-only TLS certificates

Self-signed EC P-256 certificates and keys for `src/mcp-auth-mtls.test.ts`, which tests the
certificate binding of MCP authorization (M3 rule 10) over real mutual TLS on loopback. They
protect nothing and are not published (`package.json` ships only `dist` and the package README). They were made, valid
for 100 years, with:

```bash
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 36500 \
  -subj "/CN=afd-test-server" -addext "subjectAltName=IP:127.0.0.1" \
  -keyout server.key.pem -out server.cert.pem
# client-a and client-b: -subj "/CN=afd-test-client-a" -addext "extendedKeyUsage=clientAuth"
```
