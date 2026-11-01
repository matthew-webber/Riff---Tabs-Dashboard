//! Guitar tuning normalization.
//!
//! Users (and tab sites) describe the same tuning in many ways: "Drop D",
//! "drop-d", "DADGBE", "D A D G B E", "Eb Ab Db Gb Bb Eb", "Half step down"…
//! `normalize` maps all of those onto one canonical display name so the
//! library can group tabs reliably. Anything we can't recognise is kept as a
//! cleaned-up custom tuning rather than discarded.

use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize)]
pub struct Preset {
    pub name: &'static str,
    /// Notes from lowest to highest string.
    pub notes: &'static str,
    /// Common tunings are listed first in pickers; the rest follow alphabetically.
    pub common: bool,
    #[serde(skip)]
    pub aliases: &'static [&'static str],
}

const fn common(name: &'static str, notes: &'static str, aliases: &'static [&'static str]) -> Preset {
    Preset { name, notes, common: true, aliases }
}

const fn more(name: &'static str, notes: &'static str, aliases: &'static [&'static str]) -> Preset {
    Preset { name, notes, common: false, aliases }
}

/// Common tunings first, ordered roughly by popularity (the sidebar follows
/// this order), then less common ones in alphabetical order.
pub const PRESETS: &[Preset] = &[
    common("Standard", "E A D G B E", &["e standard", "std", "e std", "standard e", "normal", "eadgbe"]),
    common("Drop D", "D A D G B E", &["dropd"]),
    common(
        "Eb Standard",
        "Eb Ab Db Gb Bb Eb",
        &[
            "e flat standard", "e flat", "eb", "d# standard", "d#", "half step down", "half-step down",
            "1/2 step down", "half step down standard", "standard half step down", "down half step",
        ],
    ),
    common("D Standard", "D G C F A D", &["whole step down", "full step down", "one step down", "1 step down", "d std"]),
    common(
        "Drop C#",
        "C# G# C# F# A# D#",
        &[
            "drop db", "drop c sharp", "drop d flat", "drop c# standard", "drop d half step down",
            "half step down drop d", "eb drop db", "eb drop c#", "d# drop c#",
        ],
    ),
    common("Drop C", "C G C F A D", &["dropc", "d standard drop c", "drop d whole step down"]),
    common("C# Standard", "C# F# B E G# C#", &["db standard", "c sharp standard", "d flat standard"]),
    common("C Standard", "C F Bb Eb G C", &["c std", "two steps down"]),
    common("Drop B", "B F# B E G# C#", &["dropb"]),
    common("B Standard", "B E A D F# B", &["b std"]),
    common("Drop A", "A E A D F# B", &["dropa"]),
    common("Open G", "D G D G B D", &["dgdgbd"]),
    common("Open D", "D A D F# A D", &[]),
    common("Open E", "E B E G# B E", &[]),
    common("Open C", "C G C G C E", &[]),
    common("DADGAD", "D A D G A D", &["d modal", "celtic"]),
    common("7-String Standard", "B E A D G B E", &["7 string standard", "7-string", "7 string", "seven string standard"]),
    common("Bass Standard", "E A D G", &["bass", "4 string standard", "bass e standard"]),
    // Less common, alphabetical.
    more("5-String Bass", "B E A D G", &["5 string bass", "5 string bass standard", "bass 5 string"]),
    more("7-String Drop A", "A E A D G B E", &["7 string drop a", "drop a 7 string", "drop a 7 string standard"]),
    more("A Standard", "A D G C E A", &["a std"]),
    more("Bass Drop D", "D A D G", &["drop d bass", "bass drop d"]),
    more("Bb Standard", "Bb Eb Ab Db F Bb", &["a# standard", "b flat standard", "bb std"]),
    more("Double Drop D", "D A D G B D", &["double dropped d", "dadgbd"]),
    more("Drop Bb", "Bb F Bb Eb G C", &["drop a#", "drop b flat", "drop a sharp"]),
    more("Drop G", "G D G C E A", &["dropg"]),
    more("Open A", "E A E A C# E", &[]),
    more("Open D Minor", "D A D F A D", &["open dm", "open d min", "d minor open"]),
    more("Open G Minor", "D G D G Bb D", &["open gm", "open g min", "g minor open"]),
];

pub fn preset_rank(name: &str) -> Option<usize> {
    PRESETS.iter().position(|p| p.name == name)
}

/// Canonicalise a free-form tuning description. Returns `None` for blank input.
pub fn normalize(raw: &str) -> Option<String> {
    let cleaned = collapse_ws(raw);
    if cleaned.is_empty() {
        return None;
    }

    // "Drop D (D A D G B E)" → try the name part first, then the notes inside.
    let (outside, inside) = split_parenthetical(&cleaned);
    for candidate in [cleaned.as_str(), outside.as_str(), inside.as_deref().unwrap_or("")] {
        if let Some(p) = match_alias(candidate) {
            return Some(p.name.to_string());
        }
    }
    for candidate in [inside.as_deref().unwrap_or(""), outside.as_str(), cleaned.as_str()] {
        if let Some(notes) = parse_notes(candidate) {
            return Some(match match_notes(&notes) {
                Some(p) => p.name.to_string(),
                None => format_notes(&notes),
            });
        }
    }

    // Unknown name (e.g. "Nashville"). Keep the user's wording, tidied up.
    Some(cleaned)
}

fn collapse_ws(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn split_parenthetical(s: &str) -> (String, Option<String>) {
    match (s.find('('), s.rfind(')')) {
        (Some(a), Some(b)) if b > a => {
            let outside = format!("{} {}", &s[..a], &s[b + 1..]);
            (collapse_ws(&outside), Some(s[a + 1..b].trim().to_string()))
        }
        _ => (s.to_string(), None),
    }
}

/// Lowercase, unify accidental glyphs and strip filler words so that
/// "Drop-D Tuning" and "drop d" compare equal.
fn alias_key(s: &str) -> String {
    let s = s.to_lowercase().replace('♭', "b").replace('♯', "#").replace(['-', '_', ':', '.', '(', ')', ','], " ");
    let words: Vec<&str> = s
        .split_whitespace()
        .filter(|w| !matches!(*w, "tuning" | "tuned" | "guitar"))
        .collect();
    words.join(" ")
}

fn match_alias(s: &str) -> Option<&'static Preset> {
    let key = alias_key(s);
    if key.is_empty() {
        return None;
    }
    let squashed = key.replace(' ', "");
    PRESETS.iter().find(|p| {
        let name = alias_key(p.name);
        name == key
            || name.replace(' ', "") == squashed
            || p.aliases.iter().any(|a| *a == key || a.replace(' ', "") == squashed)
    })
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct Note {
    letter: char, // uppercase A–G
    accidental: i8, // -1 flat, 0 natural, +1 sharp
}

impl Note {
    fn pitch_class(self) -> i8 {
        let base = match self.letter {
            'C' => 0,
            'D' => 2,
            'E' => 4,
            'F' => 5,
            'G' => 7,
            'A' => 9,
            _ => 11, // B
        };
        (base + self.accidental).rem_euclid(12)
    }
}

/// Parse a note sequence such as "EADGBE", "D-A-D-G-B-E", "Eb Ab Db Gb Bb Eb",
/// "C#G#C#F#A#D#" or "E2 A2 D3 G3 B3 E4". Returns `None` unless the whole
/// string is made of 4–8 notes.
fn parse_notes(s: &str) -> Option<Vec<Note>> {
    let s = s.replace('♭', "b").replace('♯', "#");
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    let separated = s.contains(|c: char| c.is_whitespace() || matches!(c, ',' | '-' | '/' | '|'));
    let notes = if separated {
        let mut out = Vec::new();
        for tok in s.split(|c: char| c.is_whitespace() || matches!(c, ',' | '-' | '/' | '|')).filter(|t| !t.is_empty()) {
            let chars: Vec<char> = tok.chars().collect();
            let (note, used) = read_note(&chars, 0, true)?;
            // Allow a trailing octave number ("E2").
            if chars[used..].iter().any(|c| !c.is_ascii_digit()) {
                return None;
            }
            out.push(note);
        }
        out
    } else {
        // Without separators "b" is ambiguous (B string vs. flat). Treat a
        // lowercase "b" as a flat only when the input mixes case ("EbAbDb…").
        let mixed_case = s.chars().any(|c| c.is_ascii_uppercase()) && s.chars().any(|c| c.is_ascii_lowercase());
        let chars: Vec<char> = s.chars().collect();
        let mut out = Vec::new();
        let mut i = 0;
        while i < chars.len() {
            let (note, used) = read_note(&chars, i, mixed_case)?;
            i = used;
            while i < chars.len() && chars[i].is_ascii_digit() {
                i += 1;
            }
            out.push(note);
        }
        out
    };
    (4..=8).contains(&notes.len()).then_some(notes)
}

/// Read one note starting at `i`; returns the note and the index after it.
fn read_note(chars: &[char], i: usize, lowercase_b_is_flat: bool) -> Option<(Note, usize)> {
    let letter = chars.get(i)?.to_ascii_uppercase();
    if !('A'..='G').contains(&letter) {
        return None;
    }
    match chars.get(i + 1) {
        Some('#') => Some((Note { letter, accidental: 1 }, i + 2)),
        Some('b') if lowercase_b_is_flat => Some((Note { letter, accidental: -1 }, i + 2)),
        _ => Some((Note { letter, accidental: 0 }, i + 1)),
    }
}

fn match_notes(notes: &[Note]) -> Option<&'static Preset> {
    let pcs: Vec<i8> = notes.iter().map(|n| n.pitch_class()).collect();
    PRESETS.iter().find(|p| {
        parse_notes(p.notes).is_some_and(|pn| pn.iter().map(|n| n.pitch_class()).collect::<Vec<_>>() == pcs)
    })
}

fn format_notes(notes: &[Note]) -> String {
    notes
        .iter()
        .map(|n| match n.accidental {
            1 => format!("{}#", n.letter),
            -1 => format!("{}b", n.letter),
            _ => n.letter.to_string(),
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::normalize;

    fn n(s: &str) -> String {
        normalize(s).unwrap()
    }

    #[test]
    fn names_and_aliases() {
        assert_eq!(n("standard"), "Standard");
        assert_eq!(n("E Standard"), "Standard");
        assert_eq!(n("Standard tuning"), "Standard");
        assert_eq!(n("drop-d"), "Drop D");
        assert_eq!(n("DROP D TUNING"), "Drop D");
        assert_eq!(n("Half Step Down"), "Eb Standard");
        assert_eq!(n("E♭ standard"), "Eb Standard");
        assert_eq!(n("D# Standard"), "Eb Standard");
        assert_eq!(n("drop db"), "Drop C#");
        assert_eq!(n("dadgad"), "DADGAD");
        assert_eq!(n("Drop D (Half Step Down)"), "Drop C#");
        assert_eq!(n("Drop A (7-String)"), "7-String Drop A");
        assert_eq!(n("Drop D (bass)"), "Bass Drop D");
        assert_eq!(n("Drop A#"), "Drop Bb");
        assert_eq!(n("Open Dm"), "Open D Minor");
    }

    #[test]
    fn preset_order() {
        use super::PRESETS;
        let first_more = PRESETS.iter().position(|p| !p.common).unwrap();
        assert!(PRESETS[first_more..].iter().all(|p| !p.common), "common presets come first");
        let names: Vec<_> = PRESETS[first_more..].iter().map(|p| p.name.to_lowercase()).collect();
        assert!(names.windows(2).all(|w| w[0] < w[1]), "less common presets are alphabetical: {names:?}");
        for p in PRESETS {
            assert_eq!(super::normalize(p.notes).as_deref(), Some(p.name), "notes map back to their preset");
            assert_eq!(super::normalize(p.name).as_deref(), Some(p.name), "names are stable");
        }
    }

    #[test]
    fn note_sequences() {
        assert_eq!(n("EADGBE"), "Standard");
        assert_eq!(n("eadgbe"), "Standard");
        assert_eq!(n("EADGBe"), "Standard");
        assert_eq!(n("E A D G B E"), "Standard");
        assert_eq!(n("E2 A2 D3 G3 B3 E4"), "Standard");
        assert_eq!(n("D-A-D-G-B-E"), "Drop D");
        assert_eq!(n("DADGBE"), "Drop D");
        assert_eq!(n("Eb Ab Db Gb Bb Eb"), "Eb Standard");
        assert_eq!(n("D# G# C# F# A# D#"), "Eb Standard");
        assert_eq!(n("EbAbDbGbBbEb"), "Eb Standard");
        assert_eq!(n("C#G#C#F#A#D#"), "Drop C#");
        assert_eq!(n("C G C F A D"), "Drop C");
        assert_eq!(n("B E A D G B E"), "7-String Standard");
        assert_eq!(n("Db Ab Db Gb Bb Eb"), "Drop C#");
        assert_eq!(n("DADGBD"), "Double Drop D");
        assert_eq!(n("A E A D G B E"), "7-String Drop A");
        assert_eq!(n("D A D G"), "Bass Drop D");
    }

    #[test]
    fn parentheticals() {
        assert_eq!(n("Drop D (D A D G B E)"), "Drop D");
        assert_eq!(n("Something (D A D G B E)"), "Drop D");
    }

    #[test]
    fn custom_tunings() {
        assert_eq!(n("c g c g g c"), "C G C G G C");
        assert_eq!(n("  Nashville   tuning "), "Nashville tuning");
        assert!(normalize("   ").is_none());
    }
}
