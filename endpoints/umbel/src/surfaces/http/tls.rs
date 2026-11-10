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

use rustls_pki_types::pem::PemObject;
use rustls_pki_types::{CertificateDer, UnixTime};
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
use crate::workspace::{ClientAuth, TlsConfig, WorkspaceError};

/// The TLS acceptor `[http.tls]` configures. The files are read now, so a missing or invalid one
/// stops the server before it binds; the key is never logged or echoed.
///
/// # Errors
/// `WORKSPACE_CONFIG_INVALID` naming `http.tls.cert`, `http.tls.key` or `http.tls.client_ca`: a
/// file that cannot be read, holds no PEM item of its kind, or a key that does not match the
/// certificate.
pub(crate) fn acceptor(root: &Path, tls: &TlsConfig) -> Result<TlsAcceptor, HostError> {
    acceptor_at(root, tls, "http.tls")
}

/// [`acceptor`] for the TLS table at `table` (`http.tls`, or `http.person.tls` for the person
/// page's own listener), whose keys its errors name.
///
/// # Errors
/// As [`acceptor`]'s, naming `<table>.cert`, `<table>.key` or `<table>.client_ca`.
pub(crate) fn acceptor_at(
    root: &Path,
    tls: &TlsConfig,
    table: &str,
) -> Result<TlsAcceptor, HostError> {
    let at = |name: &str| format!("{table}.{name}");
    let provider = Arc::new(aws_lc_rs::default_provider());
    let cert_path = resolve(root, &tls.cert);
    let chain = certificates(&cert_path, &at("cert"))?;
    let key = crate::auth::files::private_key(&resolve(root, &tls.key))
        .map_err(|problem| invalid(&at("key"), problem))?;
    let builder = ServerConfig::builder_with_provider(Arc::clone(&provider))
        .with_protocol_versions(&[&rustls::version::TLS13, &rustls::version::TLS12])
        .map_err(|error| invalid(table, format!("cannot be used: {error}")))?;
    let builder = match tls.client_auth {
        ClientAuth::None => builder.with_no_client_auth(),
        ClientAuth::Ca => {
            let Some(client_ca) = &tls.client_ca else {
                return Err(invalid(
                    &at("client_ca"),
                    "is required with client_auth = \"ca\"",
                ));
            };
            let mut roots = RootCertStore::empty();
            for certificate in certificates(&resolve(root, client_ca), &at("client_ca"))? {
                roots.add(certificate).map_err(|error| {
                    invalid(
                        &at("client_ca"),
                        format!("holds a certificate that cannot be a trust anchor: {error}"),
                    )
                })?;
            }
            let verifier =
                WebPkiClientVerifier::builder_with_provider(Arc::new(roots), Arc::clone(&provider))
                    .build()
                    .map_err(|error| {
                        invalid(&at("client_ca"), format!("cannot be used: {error}"))
                    })?;
            builder.with_client_cert_verifier(verifier)
        }
        ClientAuth::Any => {
            builder.with_client_cert_verifier(Arc::new(AnyClientCertificate { provider }))
        }
    };
    let mut config = builder.with_single_cert(chain, key).map_err(|error| {
        invalid(
            &at("key"),
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
pub(crate) fn resolve(root: &Path, path: &str) -> PathBuf {
    root.join(path)
}

fn invalid(key: &str, problem: impl std::fmt::Display) -> HostError {
    WorkspaceError::config_invalid(key, problem).into()
}

/// Every certificate of the PEM file at `path`, at least one, read as a regular file of at most
/// 1 MiB (`crate::auth::files::read_limited`).
fn certificates(path: &Path, key: &str) -> Result<Vec<CertificateDer<'static>>, HostError> {
    let bytes = crate::auth::files::read_limited(path).map_err(|problem| invalid(key, problem))?;
    let chain = CertificateDer::pem_slice_iter(&bytes)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| {
            invalid(
                key,
                format!(
                    "({}) is not a readable PEM certificate file",
                    path.display()
                ),
            )
        })?;
    if chain.is_empty() {
        return Err(invalid(
            key,
            format!("({}) holds no PEM certificate", path.display()),
        ));
    }
    Ok(chain)
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
