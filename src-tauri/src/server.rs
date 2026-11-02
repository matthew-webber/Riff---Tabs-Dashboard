//! A tiny loopback HTTP API used by the browser extension.
//!
//! The extension prefers this over the `riff:` URI scheme while Riff is
//! running, because it is silent (no "Open Riff?" prompt, no focus change)
//! and two-way (duplicate lookups, tag/tuning suggestions).
//!
//! Only browser-extension origins are accepted. Every request must carry an
//! `X-Riff-Client` header, which ordinary web pages cannot send cross-origin
//! without a CORS preflight — and preflights from web origins are refused.

use std::io::Read;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tiny_http::{Header, Method, Request, Response, Server};

use crate::db::{Library, TabInput};
use crate::{tuning, ExternalChange};

pub const PORT: u16 = 47813;
const MAX_BODY: u64 = 64 * 1024;

pub fn spawn(lib: Arc<Mutex<Library>>, on_change: impl Fn(ExternalChange) + Send + 'static) {
    std::thread::Builder::new()
        .name("riff-api".into())
        .spawn(move || {
            let server = match Server::http(("127.0.0.1", PORT)) {
                Ok(s) => s,
                Err(e) => {
                    log::error!("Riff API could not listen on 127.0.0.1:{PORT}: {e}. The extension will fall back to riff:// links.");
                    return;
                }
            };
            log::info!("Riff API listening on 127.0.0.1:{PORT}");
            for request in server.incoming_requests() {
                handle(request, &lib, &on_change);
            }
        })
        .expect("spawn API thread");
}

fn header<'a>(req: &'a Request, name: &'static str) -> Option<&'a str> {
    req.headers().iter().find(|h| h.field.equiv(name)).map(|h| h.value.as_str())
}

fn is_extension_origin(origin: &str) -> bool {
    ["chrome-extension://", "moz-extension://", "safari-web-extension://"].iter().any(|p| origin.starts_with(p))
}

fn h(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("valid header")
}

fn respond(req: Request, status: u16, body: Value, origin: Option<&str>) {
    let mut res = Response::from_string(body.to_string()).with_status_code(status).with_header(h("Content-Type", "application/json"));
    if let Some(o) = origin {
        res = res.with_header(h("Access-Control-Allow-Origin", o)).with_header(h("Vary", "Origin"));
    }
    let _ = req.respond(res);
}

fn handle(mut req: Request, lib: &Arc<Mutex<Library>>, on_change: &impl Fn(ExternalChange)) {
    // Defend against DNS rebinding: the Host must be the loopback address.
    let host_ok = header(&req, "Host").is_some_and(|h| h == format!("127.0.0.1:{PORT}") || h == format!("localhost:{PORT}"));
    let origin = header(&req, "Origin").map(str::to_owned);
    let origin_ok = origin.as_deref().is_none_or(is_extension_origin);
    let cors_origin = origin.as_deref().filter(|o| is_extension_origin(o)).map(str::to_owned);
    let cors = cors_origin.as_deref();

    if !host_ok || !origin_ok {
        return respond(req, 403, json!({ "error": "forbidden" }), None);
    }

    if *req.method() == Method::Options {
        let res = Response::empty(204)
            .with_header(h("Access-Control-Allow-Origin", cors.unwrap_or("null")))
            .with_header(h("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS"))
            .with_header(h("Access-Control-Allow-Headers", "Content-Type, X-Riff-Client"))
            .with_header(h("Access-Control-Max-Age", "600"));
        let _ = req.respond(res);
        return;
    }

    if header(&req, "X-Riff-Client").is_none() {
        return respond(req, 403, json!({ "error": "missing X-Riff-Client header" }), cors);
    }

    let full = req.url().to_string();
    let (path, query) = full.split_once('?').unwrap_or((full.as_str(), ""));
    let param = |name: &str| {
        url::form_urlencoded::parse(query.as_bytes()).find(|(k, _)| k == name).map(|(_, v)| v.into_owned())
    };

    match (req.method().clone(), path) {
        (Method::Get, "/api/ping") => respond(req, 200, json!({ "ok": true, "app": "Riff", "version": env!("CARGO_PKG_VERSION") }), cors),

        (Method::Get, "/api/meta") => {
            let lib = lib.lock().unwrap();
            let body = json!({
                "presets": tuning::PRESETS,
                "tuningsInUse": lib.tunings_in_use().unwrap_or_default(),
                "tags": lib.tags().unwrap_or_default(),
            });
            drop(lib);
            respond(req, 200, body, cors)
        }

        // The canonical name for a tuning as found on a page ("EADGBe" → "Standard").
        (Method::Get, "/api/normalize") => {
            let tuning = param("tuning").as_deref().and_then(tuning::normalize);
            respond(req, 200, json!({ "tuning": tuning }), cors)
        }

        // Used by Tab Transposer when a page loads: how far to shift this
        // saved tab so it plays in the tuning the player has set in Riff.
        // `frets` is null when there's nothing to do (no tuning set, tab not
        // saved or has no tuning) or the tunings can't be matched by a shift.
        (Method::Get, "/api/transpose") => {
            let url = param("url").unwrap_or_default();
            let result = {
                let lib = lib.lock().unwrap();
                lib.play_tuning().and_then(|play| Ok((play, lib.find_by_url(&url)?)))
            };
            match result {
                Ok((play, tab)) => {
                    let tab_tuning = tab.as_ref().and_then(|t| t.tuning.clone());
                    let frets = play.as_deref().zip(tab_tuning.as_deref()).and_then(|(p, t)| tuning::fret_shift(t, p));
                    let body = json!({
                        "playTuning": play,
                        "tab": tab.map(|t| json!({ "title": t.title, "artist": t.artist, "tuning": t.tuning })),
                        "frets": frets,
                    });
                    respond(req, 200, body, cors)
                }
                Err(e) => respond(req, 500, json!({ "error": e }), cors),
            }
        }

        (Method::Get, "/api/lookup") => {
            let url = param("url").unwrap_or_default();
            let found = lib.lock().unwrap().find_by_url(&url);
            match found {
                Ok(tab) => respond(req, 200, json!({ "tab": tab }), cors),
                Err(e) => respond(req, 500, json!({ "error": e }), cors),
            }
        }

        (Method::Post, "/api/tabs") => {
            let mut body = String::new();
            if req.as_reader().take(MAX_BODY).read_to_string(&mut body).is_err() {
                return respond(req, 400, json!({ "error": "unreadable body" }), cors);
            }
            let mut input: TabInput = match serde_json::from_str(&body) {
                Ok(i) => i,
                Err(e) => return respond(req, 400, json!({ "error": format!("invalid JSON: {e}") }), cors),
            };
            // The extension always identifies tabs by URL, never by row id.
            input.id = None;
            let result = lib.lock().unwrap().save(input);
            match result {
                Ok(saved) => {
                    let body = json!(saved);
                    on_change(ExternalChange { kind: "saved", tab: saved.tab, created: saved.created, source: "extension" });
                    respond(req, 200, body, cors)
                }
                Err(e) => respond(req, 422, json!({ "error": e }), cors),
            }
        }

        // Remove the tab saved for a URL. Returns the removed tab (or null).
        (Method::Delete, "/api/tabs") => {
            let url = param("url").unwrap_or_default();
            let result = {
                let mut lib = lib.lock().unwrap();
                match lib.find_by_url(&url) {
                    Ok(Some(tab)) => lib.delete(tab.id).map(|_| Some(tab)),
                    other => other,
                }
            };
            match result {
                Ok(Some(tab)) => {
                    on_change(ExternalChange { kind: "removed", tab: tab.clone(), created: false, source: "extension" });
                    respond(req, 200, json!({ "removed": tab }), cors)
                }
                Ok(None) => respond(req, 200, json!({ "removed": null }), cors),
                Err(e) => respond(req, 500, json!({ "error": e }), cors),
            }
        }

        _ => respond(req, 404, json!({ "error": "not found" }), cors),
    }
}
