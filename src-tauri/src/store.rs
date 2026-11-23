use crate::model::*;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::{
    fs,
    path::{Component, Path, PathBuf},
    time::Duration,
};

pub type Result<T> = std::result::Result<T, String>;

pub struct Store {
    pub conn: Connection,
    pub root: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPage {
    pub sessions: Vec<SessionSummary>,
    pub total: i64,
    pub matching: i64,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

impl Store {
    pub fn open(root: &Path) -> Result<Self> {
        fs::create_dir_all(root.join("audio")).map_err(err)?;
        fs::create_dir_all(root.join("attachments")).map_err(err)?;
        let conn = Connection::open(root.join("research.sqlite")).map_err(err)?;
        conn.busy_timeout(Duration::from_secs(5)).map_err(err)?;
        let version: u32 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(err)?;
        if version > 3 {
            return Err("This workspace requires a newer version of Fieldnote.".into());
        }
        conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
            BEGIN IMMEDIATE;
            CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS project_setup (project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS questionnaires (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL, person TEXT NOT NULL, date TEXT NOT NULL, questionnaire_name TEXT NOT NULL, search_text TEXT NOT NULL, data TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS sessions_project_date ON sessions(project_id,date DESC,id);
            CREATE INDEX IF NOT EXISTS questionnaires_project ON questionnaires(project_id);
            CREATE TABLE IF NOT EXISTS audio (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), data TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS audio_session ON audio(session_id);
            CREATE TABLE IF NOT EXISTS project_fields (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL, kind TEXT NOT NULL, options TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS fields_project ON project_fields(project_id);
            CREATE TABLE IF NOT EXISTS session_properties (session_id TEXT NOT NULL REFERENCES sessions(id), field_id TEXT NOT NULL REFERENCES project_fields(id), value TEXT NOT NULL, text_value TEXT NOT NULL, number_value REAL, PRIMARY KEY(session_id,field_id));
            CREATE INDEX IF NOT EXISTS properties_field_text ON session_properties(field_id,text_value,session_id);
            CREATE INDEX IF NOT EXISTS properties_field_number ON session_properties(field_id,number_value,session_id);
            PRAGMA user_version=3;
            COMMIT;").map_err(err)?;
        Ok(Self {
            conn,
            root: root.to_owned(),
        })
    }

    fn save_starter_questionnaires(&self, project_id: &str) -> Result<()> {
        for (name, questions) in [
            (
                "General conversation",
                vec![
                    "What would you like to talk about today?",
                    "What is going well?",
                    "What has been difficult?",
                    "Is there anything else you would like to add?",
                ],
            ),
            (
                "Feedback",
                vec![
                    "What did you like?",
                    "What did not work for you?",
                    "What would you change?",
                ],
            ),
            (
                "Follow-up",
                vec![
                    "What has changed since we last spoke?",
                    "What is going well?",
                    "What is still a challenge?",
                ],
            ),
        ] {
            self.save_questionnaire(Questionnaire {
                id: id(),
                project_id: project_id.into(),
                name: name.into(),
                questions: questions
                    .into_iter()
                    .map(|text| Question {
                        id: id(),
                        text: text.into(),
                        answer: String::new(),
                    })
                    .collect(),
            })?;
        }
        Ok(())
    }

    pub fn projects(&self) -> Result<Vec<Project>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id,name FROM projects ORDER BY rowid")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Project {
                    id: r.get(0)?,
                    name: r.get(1)?,
                })
            })
            .map_err(err)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)
    }

    pub fn project(&self, project_id: &str) -> Result<Project> {
        self.conn
            .query_row(
                "SELECT id,name FROM projects WHERE id=?1",
                [project_id],
                |r| {
                    Ok(Project {
                        id: r.get(0)?,
                        name: r.get(1)?,
                    })
                },
            )
            .map_err(|_| "Project not found.".into())
    }

    pub fn rename_project(&self, project_id: &str, name: &str) -> Result<Project> {
        let name = name.trim();
        if name.is_empty() || name.len() > 200 {
            return Err("Enter a project name up to 200 characters.".into());
        }
        let changed = self
            .conn
            .execute(
                "UPDATE projects SET name=?2 WHERE id=?1",
                params![project_id, name],
            )
            .map_err(err)?;
        if changed == 0 {
            return Err("Project not found.".into());
        }
        self.project(project_id)
    }

    pub fn create_project(&self, name: &str) -> Result<Project> {
        let name = name.trim();
        if name.is_empty() || name.len() > 200 {
            return Err("Enter a project name up to 200 characters.".into());
        }
        let first = self.projects()?.is_empty();
        let p = Project {
            id: id(),
            name: name.into(),
        };
        self.conn
            .execute(
                "INSERT INTO projects(id,name) VALUES(?1,?2)",
                params![p.id, p.name],
            )
            .map_err(err)?;
        if first {
            self.save_starter_questionnaires(&p.id)?;
        }
        Ok(p)
    }

    pub fn move_sessions(
        &self,
        project_id: &str,
        session_ids: &[String],
        destination: &str,
    ) -> Result<()> {
        self.project(project_id)?;
        self.project(destination)?;
        if project_id == destination || session_ids.is_empty() {
            return Err("Choose sessions and a different destination project.".into());
        }
        let sessions = session_ids
            .iter()
            .map(|id| {
                let session = self.session(id)?;
                if session.project_id != project_id {
                    return Err("Session belongs to another project.".into());
                }
                Ok(session)
            })
            .collect::<Result<Vec<_>>>()?;
        let tx = self.conn.unchecked_transaction().map_err(err)?;
        let mut fields: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();
        for mut session in sessions {
            let values = self.property_values(&session.id)?;
            for source in self.fields(project_id)? {
                if !values.contains_key(&source.id) && !session.required_field_ids.contains(&source.id) {
                    continue;
                }
                let target = if let Some(target) = fields.get(&source.id) {
                    target.clone()
                } else {
                    let existing = self.fields(destination)?;
                    let mut target = source.clone();
                    target.id = id();
                    target.project_id = destination.into();
                    let mut suffix = 1;
                    let target_id = loop {
                        match existing
                            .iter()
                            .find(|f| f.name.to_lowercase() == target.name.to_lowercase())
                        {
                            Some(field)
                                if field.kind == source.kind && field.options == source.options =>
                            {
                                break field.id.clone()
                            }
                            Some(_) => {
                                target.name = format!(
                                    "{} (moved {})",
                                    source.name.chars().take(60).collect::<String>(),
                                    suffix
                                );
                                suffix += 1;
                            }
                            None => break self.save_field(target)?.id,
                        }
                    };
                    fields.insert(source.id.clone(), target_id.clone());
                    target_id
                };
                tx.execute(
                    "UPDATE session_properties SET field_id=?1 WHERE session_id=?2 AND field_id=?3",
                    params![target, session.id, source.id],
                )
                .map_err(err)?;
            }
            for field_id in &mut session.required_field_ids {
                if let Some(target_id) = fields.get(field_id) {
                    *field_id = target_id.clone();
                }
            }
            session.project_id = destination.into();
            session.questionnaire_id = None;
            tx.execute(
                "UPDATE sessions SET project_id=?1,data=?2 WHERE id=?3",
                params![
                    destination,
                    serde_json::to_string(&session).map_err(err)?,
                    session.id
                ],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)
    }

    pub fn delete_sessions(
        &self,
        project_id: &str,
        session_ids: &[String],
    ) -> Result<Option<String>> {
        self.project(project_id)?;
        let tx = self.conn.unchecked_transaction().map_err(err)?;
        let paths = self.delete_session_rows(project_id, session_ids)?;
        tx.commit().map_err(err)?;
        Ok(Self::remove_media(paths))
    }

    pub fn delete_project(&self, project_id: &str) -> Result<Option<String>> {
        self.project(project_id)?;
        let tx = self.conn.unchecked_transaction().map_err(err)?;
        let paths = self.delete_session_rows(project_id, &self.session_ids(project_id)?)?;
        tx.execute(
            "DELETE FROM questionnaires WHERE project_id=?1",
            [project_id],
        )
        .map_err(err)?;
        tx.execute(
            "DELETE FROM project_fields WHERE project_id=?1",
            [project_id],
        )
        .map_err(err)?;
        tx.execute("DELETE FROM projects WHERE id=?1", [project_id])
            .map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(Self::remove_media(paths))
    }

    fn delete_session_rows(
        &self,
        project_id: &str,
        session_ids: &[String],
    ) -> Result<Vec<PathBuf>> {
        let mut paths = Vec::new();
        for session_id in session_ids {
            if self.session(session_id)?.project_id != project_id {
                return Err("Session belongs to another project.".into());
            }
            for audio in self.audio(session_id)? {
                paths.push(self.managed_path(&audio.relative_path)?);
            }
            for attachment in self.attachments(session_id)? {
                paths.push(self.managed_path(&attachment.relative_path)?);
            }
            for table in ["session_properties", "audio", "attachments"] {
                self.conn
                    .execute(
                        &format!("DELETE FROM {table} WHERE session_id=?1"),
                        [session_id],
                    )
                    .map_err(err)?;
            }
            self.conn
                .execute("DELETE FROM sessions WHERE id=?1", [session_id])
                .map_err(err)?;
        }
        Ok(paths)
    }

    fn remove_media(paths: Vec<PathBuf>) -> Option<String> {
        let mut errors = Vec::new();
        for path in paths {
            if let Err(error) = fs::remove_file(path) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    errors.push(error.to_string());
                }
            }
        }
        if errors.is_empty() {
            None
        } else {
            Some(format!(
                "Data removed, but some media files could not be cleaned up: {}",
                errors.join("; ")
            ))
        }
    }

    pub fn questionnaires(&self, project_id: &str) -> Result<Vec<Questionnaire>> {
        self.project(project_id)?;
        let mut stmt = self
            .conn
            .prepare("SELECT data FROM questionnaires WHERE project_id=?1 ORDER BY rowid")
            .map_err(err)?;
        let strings = stmt
            .query_map([project_id], |r| r.get::<_, String>(0))
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        strings
            .into_iter()
            .map(|s| serde_json::from_str(&s).map_err(err))
            .collect()
    }

    pub fn save_questionnaire(&self, mut group: Questionnaire) -> Result<Questionnaire> {
        self.project(&group.project_id)?;
        group.name = group.name.trim().into();
        if group.name.is_empty() || group.name.len() > 200 {
            return Err("Enter a questionnaire name up to 200 characters.".into());
        }
        validate_questions(&group.questions)?;
        let previous: Option<String> = self
            .conn
            .query_row(
                "SELECT project_id FROM questionnaires WHERE id=?1",
                [&group.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        if previous.is_some_and(|p| p != group.project_id) {
            return Err("That questionnaire belongs to another project.".into());
        }
        if let Some(setup) = self.project_setup(&group.project_id)? {
            let defaults = setup.questionnaires;
            if defaults.iter().any(|item| item.id == group.id) {
                let unchanged_count: usize = self.questionnaires(&group.project_id)?.iter()
                    .filter(|other| other.id != group.id && defaults.iter().any(|item| item.id == other.id))
                    .map(|other| other.questions.len())
                    .sum();
                if unchanged_count + group.questions.len() > 200 {
                    return Err("Default questionnaires can have up to 200 questions in total.".into());
                }
            }
        }
        for q in &mut group.questions {
            q.answer.clear();
        }
        self.conn.execute("INSERT INTO questionnaires(id,project_id,data) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![group.id,group.project_id,serde_json::to_string(&group).map_err(err)?]).map_err(err)?;
        Ok(group)
    }

    pub fn project_setup(&self, project_id: &str) -> Result<Option<ProjectSetup>> {
        self.project(project_id)?;
        let raw: Option<String> = self.conn
            .query_row("SELECT data FROM project_setup WHERE project_id=?1", [project_id], |r| r.get(0))
            .optional().map_err(err)?;
        raw.map(|data| serde_json::from_str(&data).map_err(err)).transpose()
    }

    pub fn save_project_setup(&self, project_id: &str, setup: ProjectSetup) -> Result<ProjectSetup> {
        self.project(project_id)?;
        let groups = self.questionnaires(project_id)?;
        let fields = self.fields(project_id)?;
        let mut ids = std::collections::HashSet::new();
        let mut question_count = 0;
        for default in &setup.questionnaires {
            let group = groups.iter().find(|group| group.id == default.id)
                .filter(|group| ids.insert(&group.id))
                .ok_or("Choose each default questionnaire once from this project.")?;
            question_count += group.questions.len();
        }
        if question_count > 200 {
            return Err("Default questionnaires can have up to 200 questions in total.".into());
        }
        if setup.required_field_ids.iter().any(|id| !fields.iter().any(|field| field.id == *id)) {
            return Err("Choose required fields from this project.".into());
        }
        let mut consent_ids = std::collections::HashSet::new();
        for template in &setup.consent_templates {
            let valid_id = template["id"].as_str().is_some_and(|id| !id.is_empty() && consent_ids.insert(id));
            let valid_title = template["title"].as_str().is_some_and(|title| !title.trim().is_empty());
            let valid_format = matches!(template["format"].as_str(), Some("text" | "pdf" | "docx"));
            if !valid_id || !valid_title || !valid_format || !template["required"].is_boolean() {
                return Err("Each consent form needs a unique ID, a title, and a supported format.".into());
            }
        }
        let raw = serde_json::to_string(&setup).map_err(err)?;
        if raw.len() > 2_000_000 {
            return Err("This project setup is too large.".into());
        }
        self.conn.execute(
            "INSERT INTO project_setup(project_id,data) VALUES(?1,?2) ON CONFLICT(project_id) DO UPDATE SET data=excluded.data",
            params![project_id, raw],
        ).map_err(err)?;
        Ok(setup)
    }

    pub fn create_session(
        &self,
        project_id: &str,
        group_id: Option<&str>,
        date: &str,
    ) -> Result<Session> {
        let setup = self.project_setup(project_id)?.unwrap_or_default();
        let defaults = match group_id {
            Some(wanted) => vec![QuestionnaireDefault { id: wanted.into(), required: false }],
            None => setup.questionnaires,
        };
        let groups = self.questionnaires(project_id)?;
        let grouped = group_id.is_none() && !defaults.is_empty();
        let mut questionnaire_sections = Vec::new();
        let mut questions = Vec::new();
        let mut names = Vec::new();
        for default in defaults {
            let group = groups.iter().find(|g| g.id == default.id)
                .ok_or("Questionnaire not found in this project.")?;
            names.push(group.name.clone());
            let items: Vec<Question> = group.questions.iter().map(|question| Question {
                id: if grouped { id() } else { question.id.clone() },
                text: question.text.clone(),
                answer: String::new(),
            }).collect();
            if grouped {
                questionnaire_sections.push(QuestionnaireSection {
                    group_id: group.id.clone(),
                    name: group.name.clone(),
                    required: default.required,
                    question_ids: items.iter().map(|question| question.id.clone()).collect(),
                });
            }
            questions.extend(items);
        }
        let s = Session {
            id: id(),
            project_id: project_id.into(),
            title: "Untitled session".into(),
            person: String::new(),
            date: date.into(),
            questionnaire_id: group_id.map(str::to_owned),
            questionnaire_name: if names.is_empty() { "Blank form".into() } else { names.join(" · ") },
            questions,
            notes: String::new(),
            markers: Vec::new(),
            questionnaire_sections,
            required_field_ids: setup.required_field_ids,
            consent_templates: setup.consent_templates,
            consent_responses: Default::default(),
        };
        self.write_session(&s)?;
        Ok(s)
    }

    pub fn session(&self, session_id: &str) -> Result<Session> {
        let raw: String = self
            .conn
            .query_row("SELECT data FROM sessions WHERE id=?1", [session_id], |r| {
                r.get(0)
            })
            .map_err(|_| "Session not found.".to_string())?;
        serde_json::from_str(&raw).map_err(err)
    }

    pub fn save_session(&self, mut s: Session) -> Result<Session> {
        let old = self.session(&s.id)?;
        if old.project_id != s.project_id {
            return Err("A session cannot move between projects.".into());
        }
        if old.questions.iter().any(|q| !q.answer.trim().is_empty())
            && old.questionnaire_id != s.questionnaire_id
        {
            return Err("Changing the questionnaire would discard answers. Edit this session's questions instead.".into());
        }
        if old
            .questions
            .iter()
            .any(|q| !q.answer.trim().is_empty() && !s.questions.iter().any(|new| new.id == q.id))
        {
            return Err("Keep questions that already have answers.".into());
        }
        if s.title.trim().is_empty() {
            s.title = "Untitled session".into();
        }
        self.write_session(&s)?;
        Ok(s)
    }

    fn write_session(&self, s: &Session) -> Result<()> {
        validate_questions(&s.questions)?;
        validate_markers(&s.markers)?;
        if s.title.len() > 1000
            || s.person.len() > 1000
            || s.notes.len() > 2_000_000
            || s.date.len() != 10
            || !s.date.bytes().enumerate().all(|(i, b)| {
                if i == 4 || i == 7 {
                    b == b'-'
                } else {
                    b.is_ascii_digit()
                }
            })
        {
            return Err("Check the session title, date, and note length.".into());
        }
        let raw = serde_json::to_string(s).map_err(err)?;
        if raw.len() > 8_000_000 {
            return Err("This session is too large to save.".into());
        }
        let search = format!(
            "{} {} {} {} {} {}",
            s.title,
            s.person,
            s.questionnaire_name,
            s.notes,
            s.markers
                .iter()
                .map(|m| m.text.as_str())
                .collect::<Vec<_>>()
                .join(" "),
            s.questions
                .iter()
                .map(|q| format!("{} {}", q.text, q.answer))
                .collect::<Vec<_>>()
                .join(" ")
        )
        .to_lowercase();
        self.conn.execute("INSERT INTO sessions(id,project_id,title,person,date,questionnaire_name,search_text,data) VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(id) DO UPDATE SET title=excluded.title,person=excluded.person,date=excluded.date,questionnaire_name=excluded.questionnaire_name,search_text=excluded.search_text,data=excluded.data", params![s.id,s.project_id,s.title,s.person,s.date,s.questionnaire_name,search,raw]).map_err(err)?;
        Ok(())
    }

    pub fn list(&self, project_id: &str, query: &str, offset: u32) -> Result<SessionPage> {
        self.overview(&OverviewQuery {
            project_id: project_id.into(),
            search: query.into(),
            offset,
            ..Default::default()
        })
    }

    pub fn session_ids(&self, project_id: &str) -> Result<Vec<String>> {
        self.project(project_id)?;
        let mut stmt = self
            .conn
            .prepare("SELECT id FROM sessions WHERE project_id=?1 ORDER BY date DESC,rowid DESC")
            .map_err(err)?;
        let rows = stmt.query_map([project_id], |r| r.get(0)).map_err(err)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)
    }

    pub fn audio(&self, session_id: &str) -> Result<Vec<Audio>> {
        self.session(session_id)?;
        let mut stmt = self
            .conn
            .prepare("SELECT data FROM audio WHERE session_id=?1 ORDER BY rowid")
            .map_err(err)?;
        let raw = stmt
            .query_map([session_id], |r| r.get::<_, String>(0))
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        raw.into_iter()
            .map(|s| serde_json::from_str(&s).map_err(err))
            .collect()
    }

    pub fn save_audio(&self, a: &Audio) -> Result<()> {
        self.session(&a.session_id)?;
        self.managed_path(&a.relative_path)?;
        self.conn.execute("INSERT INTO audio(id,session_id,data) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![a.id,a.session_id,serde_json::to_string(a).map_err(err)?]).map_err(err)?;
        Ok(())
    }

    pub fn managed_path(&self, relative: &str) -> Result<PathBuf> {
        let path = Path::new(relative);
        if path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
            || !(path.starts_with("audio") || path.starts_with("attachments"))
        {
            return Err("Invalid managed audio path.".into());
        }
        Ok(self.root.join(path))
    }

    pub fn unfinished_audio(&self) -> Result<Vec<Audio>> {
        let mut stmt = self.conn.prepare("SELECT data FROM audio").map_err(err)?;
        let raw = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        raw.into_iter()
            .map(|s| serde_json::from_str::<Audio>(&s).map_err(err))
            .collect::<Result<Vec<_>>>()
            .map(|items| {
                items
                    .into_iter()
                    .filter(|a| a.status == "recording")
                    .collect()
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_the_first_project_a_person_names_gets_starter_questionnaires() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        assert!(store.projects().unwrap().is_empty());
        let first = store.create_project("Onboarding").unwrap();
        let second = store.create_project("Pricing").unwrap();
        let starters = store.questionnaires(&first.id).unwrap();
        let names: Vec<_> = starters.iter().map(|q| q.name.as_str()).collect();
        assert_eq!(names, ["General conversation", "Feedback", "Follow-up"]);
        assert!(store.questionnaires(&second.id).unwrap().is_empty());
        drop(store);
        assert_eq!(
            Store::open(dir.path()).unwrap().projects().unwrap().len(),
            2
        );
    }
    #[test]
    fn project_requirements_are_snapshotted_for_each_new_session() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let p = store.create_project("Research").unwrap();
        let groups = store.questionnaires(&p.id).unwrap();
        let email = store.save_field(ProjectField {
            id: id(),
            project_id: p.id.clone(),
            name: "Email".into(),
            kind: FieldType::Email,
            options: vec![],
        }).unwrap();
        store.save_project_setup(&p.id, ProjectSetup {
            questionnaires: vec![
                QuestionnaireDefault { id: groups[0].id.clone(), required: true },
                QuestionnaireDefault { id: groups[1].id.clone(), required: false },
            ],
            required_field_ids: vec![email.id.clone()],
            consent_templates: vec![serde_json::json!({
                "id": "consent", "title": "Research consent", "format": "text",
                "required": true, "text": "Can we record?", "fields": []
            })],
        }).unwrap();
        let session = store.create_session(&p.id, None, "2026-11-23").unwrap();
        assert_eq!(session.questionnaire_sections.len(), 2);
        assert!(session.questionnaire_sections[0].required);
        assert!(!session.questionnaire_sections[1].required);
        assert_eq!(session.required_field_ids, [email.id]);
        assert_eq!(session.consent_templates[0]["title"], "Research consent");
        assert_eq!(session.questions.len(), groups[0].questions.len() + groups[1].questions.len());
        store.save_project_setup(&p.id, ProjectSetup::default()).unwrap();
        drop(store);
        let store = Store::open(dir.path()).unwrap();
        assert_eq!(store.session(&session.id).unwrap().questionnaire_sections.len(), 2);
        assert!(store.create_session(&p.id, None, "2026-11-23").unwrap().consent_templates.is_empty());
    }

    #[test]
    fn snapshots_persist_and_search_is_literal() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let p = store.create_project("Test").unwrap();
        let mut g = store.questionnaires(&p.id).unwrap().remove(0);
        let mut s = store
            .create_session(&p.id, Some(&g.id), "2026-11-02")
            .unwrap();
        s.questions[0].answer = "100% useful _answer_".into();
        store.save_session(s.clone()).unwrap();
        g.questions[0].text = "Updated template".into();
        store.save_questionnaire(g).unwrap();
        assert_ne!(
            store.session(&s.id).unwrap().questions[0].text,
            "Updated template"
        );
        assert_eq!(store.list(&p.id, "100%", 0).unwrap().sessions.len(), 1);
        s.questions.remove(0);
        assert!(store.save_session(s).is_err());
        drop(store);
        let reopened = Store::open(dir.path()).unwrap();
        assert_eq!(
            reopened.list(&p.id, "_answer_", 0).unwrap().sessions.len(),
            1
        );
        assert!(reopened
            .managed_path("audio/../../research.sqlite")
            .is_err());
    }
    #[test]
    fn marked_moments_are_saved_searchable_and_validated() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let p = store.create_project("Test").unwrap();
        let mut s = store.create_session(&p.id, None, "2026-11-02").unwrap();
        assert!(s.markers.is_empty());
        s.markers.push(Marker {
            id: id(),
            audio_id: "take".into(),
            at_secs: 754.2,
            text: "Confused by the checkout button".into(),
        });
        store.save_session(s.clone()).unwrap();
        let saved = store.session(&s.id).unwrap();
        assert_eq!(saved.markers.len(), 1);
        assert_eq!(saved.markers[0].at_secs, 754.2);
        assert_eq!(store.list(&p.id, "checkout button", 0).unwrap().sessions.len(), 1);
        let mut bad = saved.clone();
        bad.markers[0].at_secs = -1.0;
        assert!(store.save_session(bad).is_err());
        let mut duplicate = saved;
        duplicate.markers.push(duplicate.markers[0].clone());
        assert!(store.save_session(duplicate).is_err());
    }
    #[test]
    fn sessions_saved_before_marked_moments_still_open() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let p = store.create_project("Test").unwrap();
        let s = store.create_session(&p.id, None, "2026-11-02").unwrap();
        let mut old = serde_json::to_value(&s).unwrap();
        old.as_object_mut().unwrap().remove("markers");
        store
            .conn
            .execute(
                "UPDATE sessions SET data=?2 WHERE id=?1",
                params![s.id, old.to_string()],
            )
            .unwrap();
        assert!(store.session(&s.id).unwrap().markers.is_empty());
    }
    #[test]
    fn projects_can_be_renamed() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let p = store.create_project("Old name").unwrap();
        assert_eq!(store.rename_project(&p.id, "  New name ").unwrap().name, "New name");
        assert_eq!(store.project(&p.id).unwrap().name, "New name");
        assert!(store.rename_project(&p.id, "   ").is_err());
        assert!(store.rename_project("missing", "Name").is_err());
    }
}
