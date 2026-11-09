//! The memory tokenizer against FTS5 itself (phase 5 section 9.2): for every fixture text and a
//! seeded sweep of random ones, `tokens` must give the terms SQLite's own
//! `porter unicode61 remove_diacritics 2` indexes (read back through `fts5vocab`), in order and at
//! offsets 0, 1, 2 and on with no gaps, and as many of them as FTS5 records as the column's size.

// Integration-test helpers fail by panicking; clippy exempts only `#[test]` bodies themselves.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::collections::BTreeMap;
use std::fmt::Write as _;

use rusqlite::Connection;
use rusqlite::types::ValueRef;
use umbel_store::memory::tokenizer::tokens;

/// What FTS5 indexed for one row: its terms by offset, and the column size it recorded.
struct Indexed {
    terms: BTreeMap<i64, Vec<u8>>,
    size: u64,
}

/// FTS5's term bytes as `tokens` writes them: valid UTF-8 as it is, each other byte as U+FFFD and
/// two lower-case hex digits.
fn as_token(bytes: &[u8]) -> String {
    let mut out = String::new();
    for chunk in bytes.utf8_chunks() {
        out.push_str(chunk.valid());
        for byte in chunk.invalid() {
            write!(out, "\u{FFFD}{byte:02x}").unwrap();
        }
    }
    out
}

/// A SQLite varint (the encoding of `%_docsize.sz`): the value and the bytes it took.
fn varint(bytes: &[u8]) -> u64 {
    let mut value = 0u64;
    for (i, &b) in bytes.iter().enumerate() {
        if i == 8 {
            return (value << 8) | u64::from(b);
        }
        value = (value << 7) | u64::from(b & 0x7F);
        if b & 0x80 == 0 {
            return value;
        }
    }
    panic!("truncated varint {bytes:?}");
}

/// Indexes every text as its own row (rowid = position + 1) and reads back what FTS5 stored.
fn index(texts: &[String]) -> Vec<Indexed> {
    let mut db = Connection::open_in_memory().unwrap();
    db.execute_batch(
        "CREATE VIRTUAL TABLE t USING fts5(a, tokenize = 'porter unicode61 remove_diacritics 2');
         CREATE VIRTUAL TABLE v USING fts5vocab(t, 'instance');",
    )
    .unwrap();
    let tx = db.transaction().unwrap();
    {
        let mut insert = tx
            .prepare("INSERT INTO t (rowid, a) VALUES (?1, ?2)")
            .unwrap();
        for (i, text) in texts.iter().enumerate() {
            insert.execute((i as i64 + 1, text)).unwrap();
        }
    }
    tx.commit().unwrap();

    let mut rows: Vec<Indexed> = texts
        .iter()
        .map(|_| Indexed {
            terms: BTreeMap::new(),
            size: 0,
        })
        .collect();
    let mut select = db
        .prepare("SELECT term, doc, col, \"offset\" FROM v ORDER BY doc, \"offset\"")
        .unwrap();
    let mut cursor = select.query(()).unwrap();
    while let Some(row) = cursor.next().unwrap() {
        let term = match row.get_ref(0).unwrap() {
            ValueRef::Text(bytes) | ValueRef::Blob(bytes) => bytes.to_vec(),
            other => panic!("term {other:?}"),
        };
        let doc: i64 = row.get(1).unwrap();
        let col: String = row.get(2).unwrap();
        let offset: i64 = row.get(3).unwrap();
        assert_eq!(col, "a");
        let previous = rows[(doc - 1) as usize].terms.insert(offset, term);
        assert!(
            previous.is_none(),
            "doc {doc} has two terms at offset {offset}"
        );
    }
    let mut select = db.prepare("SELECT id, sz FROM t_docsize").unwrap();
    let mut cursor = select.query(()).unwrap();
    while let Some(row) = cursor.next().unwrap() {
        let id: i64 = row.get(0).unwrap();
        let sz: Vec<u8> = row.get(1).unwrap();
        rows[(id - 1) as usize].size = varint(&sz);
    }
    rows
}

/// Compares `tokens` with FTS5 for every text; returns how many texts it compared.
fn compare(texts: &[String]) -> usize {
    let indexed = index(texts);
    let mut failures = Vec::new();
    for (text, fts5) in texts.iter().zip(&indexed) {
        let ours = tokens(text);
        // Offsets 0 to n-1 with no gaps, and n is the size FTS5 records for the column.
        let offsets: Vec<i64> = fts5.terms.keys().copied().collect();
        let contiguous = offsets.iter().enumerate().all(|(i, &o)| o == i as i64);
        let theirs: Vec<String> = fts5.terms.values().map(|t| as_token(t)).collect();
        if !contiguous || fts5.size != theirs.len() as u64 || ours != theirs {
            failures.push(format!(
                "text \"{}\"\n  ours  {:?}\n  fts5  {:?} (offsets {:?}, size {})",
                text.escape_debug(),
                ours,
                theirs,
                offsets,
                fts5.size
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {} texts differ:\n{}",
        failures.len(),
        texts.len(),
        failures
            .iter()
            .take(20)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
    texts.len()
}

/// Porter's own vocabulary and the cases the C code special-cases.
const PORTER_WORDS: &str = "caresses ponies ties caress cats feed agreed plastered bled motoring \
    sing conflated troubled sized hopping tanned falling hissing fizzed failing filing happy sky \
    relational conditional rational valenci hesitanci digitizer conformabli radicalli differentli \
    vileli analogousli vietnamization predication operator feudalism decisiveness hopefulness \
    callousness formaliti sensitiviti sensibiliti triplicate formative formalize electriciti \
    electrical hopeful goodness revival allowance inference airliner gyroscopic adjustable \
    defensible irritant replacement adjustment dependent adoption homologou communism activate \
    angulariti homologous effective bowdlerize probate rate cease controll roll \
    ational tional ization ies sses ss s es eed ed ing aed aing yed ying eing ated bled ized \
    abling hoped hopping hoping filed filling fizzing missing buzzing hissed boxed snowing \
    trying cried dying yelling played syzygy yyy ayy yay sky skies flies flying spying \
    generalization generalizations oscillators conditionally relativity adoptions \
    rationalities logically sensibilities vileness illogical skating cement agreement \
    element dement ment rent bent sensational traditional fulness lawfulness deceive \
    tiny shy by ay oy py xy ow ox ax ex wax tax wex wow tow cow happiness ";

fn porter_fixtures() -> Vec<String> {
    let mut out: Vec<String> = PORTER_WORDS.split_whitespace().map(str::to_owned).collect();
    out.push(PORTER_WORDS.to_owned());
    out.push(PORTER_WORDS.to_uppercase());
    out
}

fn length_fixtures() -> Vec<String> {
    let mut out = vec![
        "a".to_owned(),
        "ab".to_owned(),
        "abc".to_owned(),
        "is".to_owned(),
        "ies".to_owned(),
        "sss".to_owned(),
        "ing".to_owned(),
        "eed".to_owned(),
        "ed".to_owned(),
        "a".repeat(61) + "ing",
        "a".repeat(62) + "ing",
        "a".repeat(60) + "ness",
        "a".repeat(59) + "ational",
        "a".repeat(197) + "ing",
        "relational".repeat(20),
        // 64 characters, 65 bytes before and after folding: not stemmed.
        "ж".to_owned() + &"a".repeat(60) + "ing",
        // 64 characters, 94 bytes before folding, 64 after: stemmed.
        "é".repeat(30) + &"r".repeat(31) + "ing",
        // 33 characters, 66 bytes, folded to 33: stemmed.
        "É".repeat(30) + "ing",
        // 65 bytes after folding.
        "é".repeat(31) + &"r".repeat(31) + "ing",
        // The 32768-byte cap, at a character boundary and inside one.
        "a".repeat(40_000),
        "a".repeat(32_767) + "жb",
        "a".repeat(32_766) + "丸b",
        "a".repeat(32_768) + " next",
    ];
    // Stems ending in a character whose last two UTF-8 bytes are equal (step 1b's double
    // consonant rule cuts the last byte).
    for word in [
        "a丸ing",
        "foo丸ed",
        "e丸ed",
        "a\u{2082}ing",
        "a😀ing",
        "ab丸ing",
        "a丸ed丸ed",
    ] {
        out.push(word.to_owned());
    }
    out
}

fn character_fixtures() -> Vec<String> {
    let ascii: String = (1u8..0x80).map(char::from).collect();
    [
        ascii.as_str(),
        "0 1 42 3.14 1,000,000 0x1F 2026-11-08 v1.2.3 $5 50% #1 @user a+b=c",
        "MiXeD CaSe camelCase PascalCase snake_case kebab-case SCREAMING_CASE",
        "don't won't o'clock rock'n'roll co-op e-mail well-being",
        "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~ a!b\"c#d$e%f&g'h(i)j*k+l,m-n.o/p:q;r<s=t>u?v@w[x\\y]z",
        "tab\tseparated\nnew\r\nline\x0bvertical\x0cfeed",
        "a\0b nul\0between",
        "Héllo wörld naïve café résumé coöperate façade jalapeño",
        "e\u{301}cole n\u{303}o A\u{30a} o\u{308}\u{301}x",
        "\u{301}\u{302}\u{303} \u{300} x\u{301}\u{330}\u{331}\u{332}y \u{36f}z",
        "α\u{345} \u{345}",
        "Straße STRASSE ẞ ß ss",
        "ﬁnance ﬂow ﬀ ﬃ",
        "İstanbul ıi Iİ i\u{307} DİYARBAKIR",
        "Ελληνικά ΆΈΉΊΌΎΏ ΣΑΣ σας ς ΐΰ ϐϑϕϖϰϱϵ",
        "Русский ЁЛКА ёлка Жук ѢѣѲѳ",
        "Հայերեն Բարեւ ﬓ",
        "ႠႡ ⴀ ქართული",
        "漢字 日本語 ひらがな カタカナ ｶﾀｶﾅ 한국어",
        "ภาษาไทย สวัสดี",
        "العربية مُحَمَّد ١٢٣",
        "עברית שָׁלוֹם",
        "हिन्दी देवनागरी १२३",
        "😀 👍🏽 👨\u{200d}👩\u{200d}👧 🇫🇷 a😀b",
        "\u{e000} \u{f8ff} a\u{e000}b \u{f0000} \u{10fffd} \u{100000}x",
        "\u{fffe} \u{ffff} a\u{fffe}b \u{fdd0} \u{fdef} \u{1fffe} \u{10ffff}",
        "a\u{fffd}b \u{fffd}",
        "zero\u{200d}width\u{200c}non\u{200b}space\u{2060}joiner\u{feff}bom",
        "no\u{a0}break\u{2000}en\u{2001}em\u{2002}a\u{2003}b\u{2009}thin\u{200a}hair",
        "line\u{2028}para\u{2029}ideo\u{3000}narrow\u{202f}math\u{205f}ogham\u{1680}end",
        "soft\u{ad}hyphen non\u{2011}breaking en\u{2013}dash em\u{2014}dash",
        "ＡＢＣ１２３ ｆｕｌｌ",
        "ⅠⅡⅫ ⅰⅱ ↀ ½ ² ₂ ①",
        "Ⓐⓑ ⒜ ㊀",
        "ǄǅǆǇǈǉ Ǳǲǳ",
        "K Ω Å ℃ ℡",
        "𐐀𐐨 𐐧𐑏",
        "𝐀𝐁𝐜 𝟎𝟏",
        "\u{378} \u{30000} \u{e0041}tag \u{e0100}",
        "Ⱥ Ȿ ɐ Ꞁ Ɐ",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect()
}

/// xorshift64*: a small deterministic generator for the sweep.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }

    /// A scalar value in `lo..=hi`, retrying past surrogates.
    fn char_in(&mut self, lo: u32, hi: u32) -> char {
        loop {
            let code = lo + (self.next() % u64::from(hi - lo + 1)) as u32;
            if let Some(c) = char::from_u32(code) {
                return c;
            }
        }
    }
}

/// Pieces the sweep strings are drawn from, alongside random code points.
const PALETTE: &[&str] = &[
    " ",
    " ",
    " ",
    "\t",
    "\n",
    "-",
    "'",
    "_",
    ".",
    ",",
    "!",
    "\0",
    "\u{a0}",
    "\u{3000}",
    "\u{200d}",
    "\u{200c}",
    "\u{fffd}",
    "\u{fffe}",
    "\u{ffff}",
    "\u{e000}",
    "\u{f0000}",
    "\u{301}",
    "\u{308}",
    "\u{330}",
    "\u{345}",
    "e\u{301}",
    "é",
    "É",
    "ß",
    "ẞ",
    "ﬁ",
    "İ",
    "ı",
    "Σ",
    "ς",
    "ж",
    "Ж",
    "Ա",
    "Ⴀ",
    "丸",
    "漢",
    "ไ",
    "\u{e31}",
    "ع",
    "\u{64e}",
    "ש",
    "\u{5bc}",
    "😀",
    "\u{2082}",
    "𐐀",
    "𝐀",
    "Ⅻ",
    "ǅ",
    "K",
    "1",
    "42",
    "x",
    "y",
    "s",
    "e",
    "a",
    "ing",
    "ed",
    "eed",
    "ies",
    "sses",
    "ational",
    "tional",
    "ization",
    "ness",
    "ful",
    "ative",
    "alize",
    "iciti",
    "ement",
    "ion",
    "sion",
    "tion",
    "ous",
    "ive",
    "ize",
    "ll",
    "bl",
    "at",
    "iz",
    "hop",
    "fil",
    "tann",
    "fizz",
    "hiss",
    "Relational",
    "MOTORING",
    "conditionally",
    "sky",
    "happy",
];

/// One sweep string: palette pieces and code points from ASCII, the BMP and planes 1 to 16.
fn random_text(rng: &mut Rng) -> String {
    let mut text = String::new();
    for _ in 0..1 + rng.below(16) {
        match rng.below(10) {
            0..=4 => text.push_str(PALETTE[rng.below(PALETTE.len())]),
            5 => text.push(rng.char_in(0x01, 0x7f)),
            6 => text.push(rng.char_in(0x80, 0x7ff)),
            7 => text.push(rng.char_in(0x800, 0xffff)),
            8 => text.push(rng.char_in(0x1_0000, 0x3_ffff)),
            _ => text.push(rng.char_in(0x4_0000, 0x10_ffff)),
        }
    }
    text
}

#[test]
fn matches_fts5_on_porter_vocabulary() {
    compare(&porter_fixtures());
}

#[test]
fn matches_fts5_on_lengths_and_byte_cuts() {
    let fixtures = length_fixtures();
    compare(&fixtures);
    // FTS5 does give terms that are not valid UTF-8 (the cases above), and `tokens` marks them.
    assert_eq!(tokens("a丸ing"), ["a\u{fffd}e4\u{fffd}b8"]);
    assert_eq!(
        tokens(&("a".repeat(32_767) + "жb")),
        ["a".repeat(32_767) + "\u{fffd}d0"]
    );
    assert_eq!(tokens(&"a".repeat(40_000)), ["a".repeat(32_768)]);
}

#[test]
fn matches_fts5_on_characters() {
    compare(&character_fixtures());
}

#[test]
fn matches_fts5_on_a_seeded_sweep() {
    let mut rng = Rng(0x5EED_0005_0009_0002);
    let texts: Vec<String> = (0..5000).map(|_| random_text(&mut rng)).collect();
    assert_eq!(compare(&texts), 5000);
}

#[test]
fn matches_fts5_on_every_code_point_beside_a_letter() {
    // Each scalar value between two letters and alone, in batches, so every category and fold
    // entry is exercised.
    let all: Vec<char> = (0x80..=0x10_FFFFu32).filter_map(char::from_u32).collect();
    let texts: Vec<String> = all
        .chunks(64)
        .map(|chunk| chunk.iter().map(|c| format!("a{c}b {c} ")).collect())
        .collect();
    compare(&texts);
}
