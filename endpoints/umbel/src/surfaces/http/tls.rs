//! In-process TLS (phase 5 section 6.2), layer 1 of section 6.3: rustls through `tokio-rustls`,
//! TLS 1.3 and 1.2 with the cipher suites of rustls' `aws-lc-rs` provider, chosen explicitly
//! rather than read from the process default, which any crate in the process could replace.
//!
//! `[http.tls] client_auth` decides the client certificate:
//!
//! | Value | Asked for | Required | Verified |
//! | --- | --- | --- | --- |
//! | `none` | no | no | - |
//! | `ca` | yes | **yes**: the handshake fails without one | chains to `client_ca`, within its validity, with the `clientAuth` usage |
//! | `any` | yes | no | possession of its key only (RFC 8705 3, self-signed binding); never trusted as an identity |
//!
//! Session resumption is off: every connection makes a full handshake, so a client certificate
//! is verified on the connection that uses it, never carried over from an earlier session.
//! ALPN offers `http/1.1` only, the one protocol the listener speaks.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use rustls_pki_types::pem::{self, PemObject};
use rustls_pki_types::{CertificateDer, PrivateKeyDer, UnixTime};
use tokio_rustls::TlsAcceptor;
use tokio_rustls::rustls::client::danger::HandshakeSignatureValid;
use tokio_rustls::rustls::crypto::{
    CryptoProvider, aws_lc_rs, verify_tls12_signature, verify_tls13_signature,
};
use tokio_rustls::rustls::server::danger::{ClientCertVerified, ClientCertVerifier};
use tokio_rustls::rustls::server::{
    NoServerSessionStorage, ParsedCertificate, WebPkiClientVerifier,
};
use tokio_rustls::rustls::{
    self, DigitallySignedStruct, DistinguishedName, RootCertStore, ServerConfig, SignatureScheme,
};

use crate::host::HostError;
use crate::workspace::{ClientAuth, TlsConfig, Workspace, WorkspaceError};

/// The TLS acceptor `[http.tls]` configures. The files are read now, so a missing or invalid one
/// stops the server before it binds; the key is never logged or echoed.
///
/// # Errors
/// `WORKSPACE_CONFIG_INVALID` naming `http.tls.cert`, `http.tls.key` or `http.tls.client_ca`: a
/// file that cannot be read, holds no PEM item of its kind, or a key that does not match the
/// certificate.
pub(crate) fn acceptor(workspace: &Workspace, tls: &TlsConfig) -> Result<TlsAcceptor, HostError> {
    let provider = Arc::new(aws_lc_rs::default_provider());
    let cert_path = resolve(workspace, &tls.cert);
    let chain = certificates(&cert_path, "http.tls.cert")?;
    let key = private_key(&resolve(workspace, &tls.key))?;
    let builder = ServerConfig::builder_with_provider(Arc::clone(&provider))
        .with_protocol_versions(&[&rustls::version::TLS13, &rustls::version::TLS12])
        .map_err(|error| invalid("http.tls", format!("cannot be used: {error}")))?;
    let builder = match tls.client_auth {
        ClientAuth::None => builder.with_no_client_auth(),
        ClientAuth::Ca => {
            let Some(client_ca) = &tls.client_ca else {
                return Err(invalid(
                    "http.tls.client_ca",
                    "is required with client_auth = \"ca\"",
                ));
            };
            let mut roots = RootCertStore::empty();
            for certificate in certificates(&resolve(workspace, client_ca), "http.tls.client_ca")? {
                roots.add(certificate).map_err(|error| {
                    invalid(
                        "http.tls.client_ca",
                        format!("holds a certificate that cannot be a trust anchor: {error}"),
                    )
                })?;
            }
            let verifier =
                WebPkiClientVerifier::builder_with_provider(Arc::new(roots), Arc::clone(&provider))
                    .build()
                    .map_err(|error| {
                        invalid("http.tls.client_ca", format!("cannot be used: {error}"))
                    })?;
            builder.with_client_cert_verifier(verifier)
        }
        ClientAuth::Any => {
            builder.with_client_cert_verifier(Arc::new(AnyClientCertificate { provider }))
        }
    };
    let mut config = builder.with_single_cert(chain, key).map_err(|error| {
        invalid(
            "http.tls.key",
            format!(
                "cannot serve the certificate in {}: {error}",
                cert_path.display()
            ),
        )
    })?;
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    config.session_storage = Arc::new(NoServerSessionStorage {});
    config.send_tls13_tickets = 0;

    Ok(TlsAcceptor::from(Arc::new(config)))
}

/// A configured path: absolute, or relative to the workspace (section 2.2's rule, from step 1).
fn resolve(workspace: &Workspace, path: &str) -> PathBuf {
    workspace.root().join(path)
}

fn invalid(key: &str, problem: impl std::fmt::Display) -> HostError {
    WorkspaceError::config_invalid(key, problem).into()
}

/// Every certificate of the PEM file at `path`, at least one.
fn certificates(path: &Path, key: &str) -> Result<Vec<CertificateDer<'static>>, HostError> {
    let unreadable = |error: pem::Error| {
        invalid(
            key,
            format!(
                "({}) is not a readable PEM certificate file: {error}",
                path.display()
            ),
        )
    };
    let chain = CertificateDer::pem_file_iter(path)
        .map_err(unreadable)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(unreadable)?;
    if chain.is_empty() {
        return Err(invalid(
            key,
            format!("({}) holds no PEM certificate", path.display()),
        ));
    }
    Ok(chain)
}

/// The private key in the PEM file at `path`. The parser's own message is left out unless the
/// file could not be read at all, so no line of a key file ever reaches a log or an answer.
fn private_key(path: &Path) -> Result<PrivateKeyDer<'static>, HostError> {
    PrivateKeyDer::from_pem_file(path).map_err(|error| {
        let problem = match error {
            pem::Error::Io(error) => format!("({}) cannot be read: {error}", path.display()),
            pem::Error::NoItemsFound => format!(
                "({}) holds no PEM private key (PKCS #8, PKCS #1 or SEC1)",
                path.display()
            ),
            _ => format!("({}) is not a valid PEM private key", path.display()),
        };
        invalid("http.tls.key", problem)
    })
}

/// `client_auth = "any"`: a client certificate is asked for and not required. One that is sent
/// must parse as X.509, and the handshake proves the client holds its key; nothing else about it
/// is trusted. It exists only so that a token bound to it (`cnf.x5t#S256`, RFC 8705) can be
/// checked; it names no one.
#[derive(Debug)]
struct AnyClientCertificate {
    provider: Arc<CryptoProvider>,
}

impl ClientCertVerifier for AnyClientCertificate {
    fn offer_client_auth(&self) -> bool {
        true
    }

    fn client_auth_mandatory(&self) -> bool {
        false
    }

    fn root_hint_subjects(&self) -> &[DistinguishedName] {
        &[]
    }

    fn verify_client_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _now: UnixTime,
    ) -> Result<ClientCertVerified, rustls::Error> {
        ParsedCertificate::try_from(end_entity)?;
        Ok(ClientCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}
