use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub answer: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Questionnaire {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub questions: Vec<Question>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub person: String,
    pub date: String,
    pub questionnaire_id: Option<String>,
    pub questionnaire_name: String,
    pub questions: Vec<Question>,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub person: String,
    pub date: String,
    pub questionnaire_name: String,
    pub audio_count: i64,
    #[serde(default)]
    pub values: PropertyValues,
}

pub type PropertyValues = std::collections::BTreeMap<String, serde_json::Value>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FieldType {
    Text,
    Email,
    Number,
    Select,
    Date,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectField {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub kind: FieldType,
    #[serde(default)]
    pub options: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropertySort {
    pub key: String,
    pub direction: String,
}
impl Default for PropertySort {
    fn default() -> Self {
        Self {
            key: "date".into(),
            direction: "desc".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropertyFilter {
    pub field: String,
    pub op: String,
    #[serde(default)]
    pub value: serde_json::Value,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverviewQuery {
    pub project_id: String,
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub sort: PropertySort,
    #[serde(default)]
    pub filters: Vec<PropertyFilter>,
    #[serde(default)]
    pub offset: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Audio {
    pub id: String,
    pub session_id: String,
    pub name: String,
    pub relative_path: String,
    pub byte_length: u64,
    pub duration_secs: Option<f64>,
    pub status: String,
}

pub fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn validate_questions(questions: &[Question]) -> Result<(), String> {
    if questions.len() > 200 {
        return Err("A questionnaire can have at most 200 questions.".into());
    }
    let mut ids = std::collections::HashSet::new();
    for q in questions {
        if q.id.is_empty() || !ids.insert(&q.id) || q.text.trim().is_empty() {
            return Err("Each question needs a unique ID and some text.".into());
        }
        if q.text.len() > 10_000 || q.answer.len() > 2_000_000 {
            return Err("A question or answer is too large to save.".into());
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub session_id: String,
    pub name: String,
    pub relative_path: String,
    pub byte_length: u64,
    pub caption: String,
}
