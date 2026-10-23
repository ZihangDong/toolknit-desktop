use serde::{Deserialize, Serialize};

pub const MAX_TEXT: usize = 2 * 1024 * 1024;
pub const MAX_IMAGE: usize = 20 * 1024 * 1024;
pub const MAX_PIXELS: u64 = 32_000_000;
pub const MAX_FILES: usize = 1000;

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Settings {
    pub text: bool,
    pub images: bool,
    pub files: bool,
    pub resume_on_launch: bool,
    pub retention_days: u32,
    pub max_records: u32,
    pub max_megabytes: u32,
    pub excluded_apps: Vec<String>,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            text: true,
            images: true,
            files: true,
            resume_on_launch: false,
            retention_days: 7,
            max_records: 2000,
            max_megabytes: 256,
            excluded_apps: vec![],
        }
    }
}
impl Settings {
    pub fn validate(&self) -> Result<(), String> {
        if !(1..=365).contains(&self.retention_days)
            || !(100..=10000).contains(&self.max_records)
            || !(32..=2048).contains(&self.max_megabytes)
            || self.excluded_apps.len() > 100
            || self.excluded_apps.iter().any(|s| {
                s.len() > 128 || s.contains(['/', '\\']) || s.chars().any(char::is_control)
            })
        {
            return Err("clipboard:invalid-settings".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Content {
    Text {
        text: String,
        rich: bool,
    },
    Image {
        #[serde(with = "base64_bytes")]
        png: Vec<u8>,
        width: u32,
        height: u32,
    },
    Files {
        paths: Vec<String>,
    },
}
impl Content {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Text { .. } => "text",
            Self::Image { .. } => "image",
            Self::Files { .. } => "files",
        }
    }
    pub fn searchable(&self) -> String {
        match self {
            Self::Text { text, .. } => text.clone(),
            Self::Files { paths } => paths.join("\n"),
            Self::Image { .. } => String::new(),
        }
    }
    pub fn bytes(&self) -> usize {
        match self {
            Self::Text { text, .. } => text.len(),
            Self::Files { paths } => paths.iter().map(String::len).sum(),
            Self::Image { png, .. } => png.len(),
        }
    }
    pub fn validate(&self) -> Result<(), String> {
        let ok = match self {
            Self::Text { text, .. } => {
                !text.is_empty() && text.len() <= MAX_TEXT && !text.contains('\0')
            }
            Self::Image { png, width, height } => {
                !png.is_empty()
                    && png.len() <= MAX_IMAGE
                    && *width > 0
                    && *height > 0
                    && u64::from(*width) * u64::from(*height) <= MAX_PIXELS
            }
            Self::Files { paths } => {
                !paths.is_empty()
                    && paths.len() <= MAX_FILES
                    && self.bytes() <= MAX_TEXT
                    && paths.iter().all(|p| {
                        !p.contains('\0')
                            && p.len() <= 32768
                            && std::path::Path::new(p).is_absolute()
                    })
            }
        };
        if ok {
            Ok(())
        } else {
            Err("clipboard:too-large".into())
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Provenance {
    pub source: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub enabled: bool,
    pub started_at: Option<i64>,
    pub captured: u64,
    pub skipped: u64,
    pub failed: u64,
    pub last_error: Option<String>,
    pub total: u64,
    pub today: u64,
    pub bytes: u64,
    pub revision: u64,
    pub latest_id: i64,
    pub settings: Settings,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Query {
    pub search: String,
    pub kind: String,
    pub favorites: bool,
    pub from: Option<i64>,
    pub to: Option<i64>,
    pub before: Option<i64>,
    pub snapshot: Option<i64>,
    pub limit: Option<usize>,
    pub ordered: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: i64,
    pub note: String,
    pub captured_at: i64,
    pub offset_minutes: i32,
    pub kind: String,
    pub favorite: bool,
    pub source: Option<String>,
    pub preview: String,
    pub bytes: usize,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub count: usize,
    pub rich: bool,
    pub thumbnail: Option<String>,
    pub used_at: Option<i64>,
}

mod base64_bytes {
    use base64::Engine;
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(bytes: &[u8], serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&base64::engine::general_purpose::STANDARD.encode(bytes))
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<u8>, D::Error> {
        base64::engine::general_purpose::STANDARD
            .decode(String::deserialize(deserializer)?)
            .map_err(serde::de::Error::custom)
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detail {
    #[serde(flatten)]
    pub entry: Entry,
    pub text: Option<String>,
    pub image: Option<String>,
    pub paths: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub items: Vec<Entry>,
    pub next: Option<i64>,
    pub snapshot: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Phrase {
    pub id: i64,
    pub title: String,
    pub text: String,
    pub note: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct PhraseQuery {
    pub search: String,
    pub before: Option<i64>,
}

#[derive(Serialize)]
pub struct PhrasePage {
    pub items: Vec<Phrase>,
    pub next: Option<i64>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Collection {
    History,
    Phrases,
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub enum Request {
    Status,
    Restart,
    Start,
    Stop,
    Settings {
        settings: Settings,
    },
    List {
        query: Query,
    },
    Detail {
        id: i64,
    },
    Entry {
        id: i64,
    },
    Note {
        id: i64,
        note: String,
    },
    PhraseList {
        query: PhraseQuery,
    },
    PhraseDetail {
        id: i64,
    },
    PhraseSave {
        id: Option<i64>,
        title: String,
        text: String,
        #[serde(default)]
        note: Option<String>,
    },
    PhraseFromHistory {
        id: i64,
    },
    PhraseDelete {
        id: i64,
    },
    PhraseCopy {
        id: i64,
    },
    Reorder {
        collection: Collection,
        id: i64,
        #[serde(rename = "targetId")]
        target_id: i64,
        after: bool,
    },
    Drag {
        collection: Collection,
        id: i64,
    },
    Pin {
        id: i64,
    },
    Favorite {
        id: i64,
        favorite: bool,
    },
    Delete {
        ids: Vec<i64>,
    },
    Clear {
        #[serde(rename = "includeFavorites")]
        include_favorites: bool,
    },
    Copy {
        id: i64,
        #[serde(default)]
        paths: bool,
    },
}

#[cfg(test)]
mod tests {
    use super::Request;
    #[test]
    fn drag_and_order_requests_accept_ids_not_arbitrary_external_payloads() {
        assert!(serde_json::from_str::<Request>(
            r#"{"action":"drag","collection":"history","id":42}"#
        )
        .is_ok());
        assert!(serde_json::from_str::<Request>(
            r#"{"action":"reorder","collection":"phrases","id":42,"targetId":2,"after":true}"#
        )
        .is_ok());
        for input in [
            r#"{"action":"drag","collection":"history","id":42,"path":"C:/private.txt"}"#,
            r#"{"action":"drag","collection":"history","id":42,"text":"injected"}"#,
            r#"{"action":"drag","collection":"anything","id":42}"#,
            r#"{"action":"reorder","collection":"history","ids":[1,2]}"#,
        ] {
            assert!(serde_json::from_str::<Request>(input).is_err());
        }
        assert!(serde_json::from_str::<Request>(
            r#"{"action":"phraseSave","id":null,"title":"Email","text":"fixture@example.test"}"#
        )
        .is_ok());
    }

    #[test]
    fn pin_accepts_only_an_existing_record_id() {
        assert!(matches!(
            serde_json::from_str::<Request>(r#"{"action":"pin","id":42}"#).unwrap(),
            Request::Pin { id: 42 }
        ));
        for input in [
            r#"{"action":"pin"}"#,
            r#"{"action":"pin","id":1.5}"#,
            r#"{"action":"pin","id":42,"path":"C:/untrusted.png"}"#,
            r#"{"action":"pin","id":42,"image":"untrusted"}"#,
        ] {
            assert!(serde_json::from_str::<Request>(input).is_err());
        }
        assert!(matches!(
            serde_json::from_str::<Request>(r#"{"action":"copy","id":42}"#).unwrap(),
            Request::Copy {
                id: 42,
                paths: false
            }
        ));
    }
}
