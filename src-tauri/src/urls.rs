//! URL cleanup and duplicate keys.

use url::Url;

fn is_tracking_param(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    k.starts_with("utm_")
        || k.starts_with("app_utm")
        || matches!(
            k.as_str(),
            "fbclid" | "gclid" | "dclid" | "msclkid" | "mc_cid" | "mc_eid" | "igshid" | "ref" | "ref_src" | "si" | "_ga"
        )
}

/// A cleaned URL suitable for storing: http(s) only, no fragment, no tracking params.
pub fn clean(raw: &str) -> Result<Url, String> {
    let raw = raw.trim();
    let mut url = Url::parse(raw)
        .or_else(|_| Url::parse(&format!("https://{raw}")))
        .map_err(|_| "That doesn't look like a valid URL".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Only http and https links can be saved".into());
    }
    if url.host_str().is_none_or(|h| !h.contains('.') && h != "localhost") {
        return Err("That doesn't look like a valid URL".into());
    }
    url.set_fragment(None);
    let kept: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(k, _)| !is_tracking_param(k))
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    if kept.is_empty() {
        url.set_query(None);
    } else {
        url.query_pairs_mut().clear().extend_pairs(kept);
    }
    Ok(url)
}

/// Key used to detect duplicates: ignores scheme, `www.`, trailing slashes,
/// query-parameter order and tracking params.
pub fn key(url: &Url) -> String {
    let host = url.host_str().unwrap_or("").trim_start_matches("www.");
    let path = url.path().trim_end_matches('/');
    let mut pairs: Vec<(String, String)> = url.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
    pairs.sort();
    let mut key = format!("{host}{path}");
    if !pairs.is_empty() {
        key.push('?');
        key.push_str(&pairs.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("&"));
    }
    key
}

#[cfg(test)]
mod tests {
    use super::*;

    fn k(s: &str) -> String {
        key(&clean(s).unwrap())
    }

    #[test]
    fn equivalent_urls_share_a_key() {
        let a = k("https://tabs.ultimate-guitar.com/tab/oasis/wonderwall-chords-39144");
        assert_eq!(a, k("http://tabs.ultimate-guitar.com/tab/oasis/wonderwall-chords-39144/"));
        assert_eq!(a, k("https://tabs.ultimate-guitar.com/tab/oasis/wonderwall-chords-39144?utm_source=x#top"));
        assert_eq!(k("https://www.songsterr.com/a/b"), k("https://songsterr.com/a/b"));
        assert_eq!(k("https://x.com/t?b=2&a=1"), k("https://x.com/t?a=1&b=2"));
        assert_ne!(k("https://x.com/t?id=1"), k("https://x.com/t?id=2"));
    }

    #[test]
    fn cleaning() {
        assert_eq!(clean("example.com/tab").unwrap().as_str(), "https://example.com/tab");
        assert_eq!(clean("https://x.com/a?id=3&utm_medium=y#f").unwrap().as_str(), "https://x.com/a?id=3");
        assert!(clean("file:///etc/passwd").is_err());
        assert!(clean("not a url").is_err());
    }
}
