//! Optional embedding providers for Umbel record lanes (records host specification, section 9;
//! D166, D168).
//!
//! Three providers sit behind Cargo features, none enabled by default:
//!
//! - `static`: local token-lookup embeddings via `model2vec-rs`, loaded from pinned workspace
//!   bytes with network downloads compiled out.
//! - `onnx`: local transformer embeddings via `fastembed`, loaded from pinned workspace bytes
//!   with `hf-hub` compiled out.
//! - `http`: an OpenAI-compatible embeddings endpoint over `https`, or `http` to a literal
//!   loopback address, never following redirects and capping responses at 16 MiB.
//!
//! No error message returned by any provider holds a record's or query's text.

#[cfg(feature = "http")]
mod http;
#[cfg(feature = "onnx")]
mod onnx;
#[cfg(feature = "static")]
mod static_model;

#[cfg(feature = "http")]
pub use http::{HttpConfig, HttpEmbedder, check_http_url};
#[cfg(feature = "onnx")]
pub use onnx::{OnnxEmbedder, OnnxFiles, OnnxPooling};
#[cfg(feature = "static")]
pub use static_model::StaticEmbedder;

use umbel_store::EmbedError;

/// The fewest dimensions a model may produce (section 9.2).
pub const MIN_DIMENSIONS: usize = 16;
/// The most dimensions a model may produce (section 9.2).
pub const MAX_DIMENSIONS: usize = 4096;
/// The most texts one HTTP embedding request sends (section 9.2).
pub const MAX_HTTP_BATCH: usize = 64;
/// The largest HTTP embedding response body accepted, in bytes (16 MiB, section 9.2).
pub const MAX_HTTP_RESPONSE_BYTES: usize = 16 * 1024 * 1024;

/// Verify that `dimensions` is within `[MIN_DIMENSIONS, MAX_DIMENSIONS]`.
///
/// # Errors
/// [`EmbedError::Invalid`] when out of range.
pub fn check_dimensions(dimensions: usize) -> Result<usize, EmbedError> {
    if (MIN_DIMENSIONS..=MAX_DIMENSIONS).contains(&dimensions) {
        Ok(dimensions)
    } else {
        Err(EmbedError::Invalid(format!(
            "model dimensions must be {MIN_DIMENSIONS} to {MAX_DIMENSIONS}, got {dimensions}"
        )))
    }
}

/// Verify that a provider produced `expected` vectors, each of `dimensions` finite numbers.
///
/// # Errors
/// [`EmbedError::Invalid`] naming the count or dimension mismatch, never any text.
#[cfg(any(feature = "static", feature = "onnx", feature = "http", test))]
pub(crate) fn check_vectors(
    vectors: Vec<Vec<f32>>,
    expected: usize,
    dimensions: usize,
) -> Result<Vec<Vec<f32>>, EmbedError> {
    if vectors.len() != expected {
        return Err(EmbedError::Invalid(format!(
            "expected {expected} vectors, got {}",
            vectors.len()
        )));
    }
    for (index, vector) in vectors.iter().enumerate() {
        if vector.len() != dimensions {
            return Err(EmbedError::Invalid(format!(
                "vector {index} has {} numbers, expected {dimensions}",
                vector.len()
            )));
        }
        if !vector.iter().all(|v| v.is_finite()) {
            return Err(EmbedError::Invalid(format!(
                "vector {index} holds a non-finite number"
            )));
        }
    }
    Ok(vectors)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dimensions_are_bounded_to_16_through_4096() {
        assert!(check_dimensions(15).is_err());
        assert_eq!(check_dimensions(16), Ok(16));
        assert_eq!(check_dimensions(4096), Ok(4096));
        assert!(check_dimensions(4097).is_err());
    }

    #[test]
    fn check_vectors_refuses_wrong_count_length_or_non_finite() {
        let good = vec![vec![0.5; 16], vec![0.25; 16]];
        assert!(check_vectors(good, 2, 16).is_ok());
        assert!(check_vectors(vec![vec![0.5; 16]], 2, 16).is_err());
        assert!(check_vectors(vec![vec![0.5; 15]], 1, 16).is_err());
        let mut bad = vec![0.5; 16];
        bad[3] = f32::NAN;
        assert!(check_vectors(vec![bad], 1, 16).is_err());
        let mut inf = vec![0.5; 16];
        inf[0] = f32::INFINITY;
        assert!(check_vectors(vec![inf], 1, 16).is_err());
    }
}
