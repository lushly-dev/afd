//! The test certificate authority: a self-signed CA made in memory with `rcgen`, issuing server
//! certificates (TLS) and client certificates (mTLS, RFC 8705 `x5t#S256`).

use std::fmt;

use rcgen::{
    BasicConstraints, CertificateParams, DistinguishedName, DnType, ExtendedKeyUsagePurpose, IsCa,
    Issuer, KeyPair, KeyUsagePurpose, SerialNumber,
};
use time::{Duration, OffsetDateTime};

use crate::{Error, b64, now, random_bytes, sha256};

/// A certificate the [`TestCa`] issued, with its private key (an ECDSA P-256 key, PKCS #8).
#[derive(Clone)]
pub struct IssuedCertificate {
    der: Vec<u8>,
    pem: String,
    key_der: Vec<u8>,
    key_pem: String,
}

impl fmt::Debug for IssuedCertificate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("IssuedCertificate")
            .field("x5t#S256", &self.x5t_s256())
            .finish_non_exhaustive()
    }
}

impl IssuedCertificate {
    /// The certificate, DER.
    pub fn certificate_der(&self) -> &[u8] {
        &self.der
    }

    /// The certificate, PEM.
    pub fn certificate_pem(&self) -> &str {
        &self.pem
    }

    /// The private key, PKCS #8 DER.
    pub fn private_key_der(&self) -> &[u8] {
        &self.key_der
    }

    /// The private key, PKCS #8 PEM.
    pub fn private_key_pem(&self) -> &str {
        &self.key_pem
    }

    /// The certificate then the key, PEM: what an HTTP client takes as its identity.
    pub fn identity_pem(&self) -> String {
        format!("{}{}", self.pem, self.key_pem)
    }

    /// The RFC 8705 thumbprint, `x5t#S256`: unpadded base64url of the DER's SHA-256.
    pub fn x5t_s256(&self) -> String {
        b64(sha256(&self.der))
    }

    /// The DER's SHA-256 in lowercase hex, as a pin (`client_cert_sha256`).
    pub fn sha256_hex(&self) -> String {
        sha256(&self.der)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }
}

/// A certificate authority made in memory. Its certificates are valid from an hour ago for seven
/// days, with random serial numbers.
pub struct TestCa {
    params: CertificateParams,
    key: KeyPair,
    der: Vec<u8>,
    pem: String,
}

impl fmt::Debug for TestCa {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TestCa").finish_non_exhaustive()
    }
}

fn certificate_error(error: rcgen::Error) -> Error {
    Error::new(format!("cannot make a certificate: {error}"))
}

fn validity(params: &mut CertificateParams) -> Result<(), Error> {
    let now = OffsetDateTime::from_unix_timestamp(now())
        .map_err(|_| Error::new("the clock is out of range"))?;
    params.not_before = now - Duration::hours(1);
    params.not_after = now + Duration::days(7);
    let mut serial = random_bytes(16);
    // A positive INTEGER of at most 20 octets (RFC 5280, section 4.1.2.2).
    serial[0] &= 0x7f;
    serial[0] |= 0x01;
    params.serial_number = Some(SerialNumber::from_slice(&serial));
    Ok(())
}

impl TestCa {
    /// A new CA named `umbel-testkit-idp test CA <random>`, so two CAs never share a name.
    ///
    /// # Errors
    /// The key or certificate cannot be made.
    pub fn new() -> Result<Self, Error> {
        let key = KeyPair::generate().map_err(certificate_error)?;
        let mut params = CertificateParams::default();
        let mut name = DistinguishedName::new();
        name.push(
            DnType::CommonName,
            format!("umbel-testkit-idp test CA {}", crate::random_token(6)),
        );
        params.distinguished_name = name;
        params.is_ca = IsCa::Ca(BasicConstraints::Constrained(0));
        params.key_usages = vec![
            KeyUsagePurpose::KeyCertSign,
            KeyUsagePurpose::CrlSign,
            KeyUsagePurpose::DigitalSignature,
        ];
        validity(&mut params)?;
        let certificate = params.self_signed(&key).map_err(certificate_error)?;
        Ok(Self {
            der: certificate.der().to_vec(),
            pem: certificate.pem(),
            params,
            key,
        })
    }

    /// The CA certificate, DER: the trust anchor for the kit's listener and every certificate the
    /// CA issues.
    pub fn certificate_der(&self) -> &[u8] {
        &self.der
    }

    /// The CA certificate, PEM.
    pub fn certificate_pem(&self) -> &str {
        &self.pem
    }

    /// A server certificate (`serverAuth`) for `names`: each an IP address or a DNS name.
    ///
    /// # Errors
    /// A name is neither, or the certificate cannot be made.
    pub fn server_certificate(&self, names: &[&str]) -> Result<IssuedCertificate, Error> {
        let names: Vec<String> = names.iter().map(|name| (*name).to_owned()).collect();
        let common_name = names.first().cloned().unwrap_or_default();
        let mut params = CertificateParams::new(names).map_err(certificate_error)?;
        self.issue(
            &mut params,
            &common_name,
            ExtendedKeyUsagePurpose::ServerAuth,
        )
    }

    /// A client certificate (`clientAuth`) whose subject is `common_name`.
    ///
    /// # Errors
    /// The certificate cannot be made.
    pub fn client_certificate(&self, common_name: &str) -> Result<IssuedCertificate, Error> {
        let mut params = CertificateParams::default();
        self.issue(
            &mut params,
            common_name,
            ExtendedKeyUsagePurpose::ClientAuth,
        )
    }

    fn issue(
        &self,
        params: &mut CertificateParams,
        common_name: &str,
        usage: ExtendedKeyUsagePurpose,
    ) -> Result<IssuedCertificate, Error> {
        let key = KeyPair::generate().map_err(certificate_error)?;
        let mut name = DistinguishedName::new();
        name.push(DnType::CommonName, common_name);
        params.distinguished_name = name;
        params.is_ca = IsCa::ExplicitNoCa;
        params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
        params.extended_key_usages = vec![usage];
        params.use_authority_key_identifier_extension = true;
        validity(params)?;
        let issuer = Issuer::from_params(&self.params, &self.key);
        let certificate = params.signed_by(&key, &issuer).map_err(certificate_error)?;
        Ok(IssuedCertificate {
            der: certificate.der().to_vec(),
            pem: certificate.pem(),
            key_der: key.serialize_der(),
            key_pem: key.serialize_pem(),
        })
    }
}
