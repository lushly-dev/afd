//! PCG32 (O'Neill's `pcg32` XSH RR 64/32), implemented here so the fixture never changes with a
//! dependency: the generator's output is pinned by a digest, and the `rand` crate makes no promise
//! about the stream it produces across versions.

const MULTIPLIER: u64 = 6_364_136_223_846_793_005;

/// A PCG32 stream.
#[derive(Debug, Clone)]
pub struct Pcg32 {
    state: u64,
    inc: u64,
}

impl Pcg32 {
    /// A generator for `seed` on `stream` (the reference `pcg32_srandom`).
    #[must_use]
    pub fn new(seed: u64, stream: u64) -> Self {
        let mut rng = Self {
            state: 0,
            inc: (stream << 1) | 1,
        };
        rng.next_u32();
        rng.state = rng.state.wrapping_add(seed);
        rng.next_u32();
        rng
    }

    /// The next 32 bits.
    pub fn next_u32(&mut self) -> u32 {
        let old = self.state;
        self.state = old.wrapping_mul(MULTIPLIER).wrapping_add(self.inc);
        let xorshifted = (((old >> 18) ^ old) >> 27) as u32;
        let rotation = (old >> 59) as u32;
        xorshifted.rotate_right(rotation)
    }

    /// A number in `0..bound` with no modulo bias (`bound` of 0 gives 0).
    pub fn below(&mut self, bound: u32) -> u32 {
        if bound == 0 {
            return 0;
        }
        let threshold = bound.wrapping_neg() % bound;
        loop {
            let value = self.next_u32();
            if value >= threshold {
                return value % bound;
            }
        }
    }

    /// A number in `low..=high`.
    pub fn between(&mut self, low: u32, high: u32) -> u32 {
        low + self.below(high - low + 1)
    }

    /// `true` with probability `percent / 100`.
    pub fn percent(&mut self, percent: u32) -> bool {
        self.below(100) < percent
    }

    /// An index into a slice of `len` items.
    pub fn index(&mut self, len: usize) -> usize {
        self.below(u32::try_from(len).unwrap_or(u32::MAX)) as usize
    }

    /// One item of a non-empty slice.
    pub fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.index(items.len())]
    }

    /// Fisher-Yates.
    pub fn shuffle<T>(&mut self, items: &mut [T]) {
        for i in (1..items.len()).rev() {
            let j = self.index(i + 1);
            items.swap(i, j);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Pcg32;

    /// The reference demo's first outputs for `pcg32_srandom(42, 54)`.
    #[test]
    fn matches_the_reference_stream() {
        let mut rng = Pcg32::new(42, 54);
        let got: Vec<u32> = (0..6).map(|_| rng.next_u32()).collect();
        assert_eq!(
            got,
            [
                0xa15c_02b7,
                0x7b47_f409,
                0xba1d_3330,
                0x83d2_f293,
                0xbfa4_784b,
                0xcbed_606e
            ]
        );
    }

    #[test]
    fn bounded_draws_stay_in_range_and_shuffles_keep_every_item() {
        let mut rng = Pcg32::new(7, 1);
        assert!((0..1000).all(|_| rng.below(7) < 7));
        assert_eq!(rng.between(3, 3), 3);
        let mut items: Vec<u32> = (0..50).collect();
        rng.shuffle(&mut items);
        let mut sorted = items.clone();
        sorted.sort_unstable();
        assert_eq!(sorted, (0..50).collect::<Vec<_>>());
        assert_ne!(items, sorted);
    }
}
