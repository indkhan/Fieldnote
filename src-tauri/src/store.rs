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
        if version > 2 {
            return Err("This workspace requires a newer version of Fieldnote.".into());
        }
        conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
            BEGIN IMMEDIATE;
            CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL);
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
            PRAGMA user_version=2;
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
                if !values.contains_key(&source.id) {
                    continue;
                }
                let target = if let Some(target) = fields.get(&source.id) {
                    target.clone()
                } else {
                    let mut target = source.clone();
                    target.id = id();
                    target.project_id = destination.into();
                    self.save_field(target.clone())?;
                    fields.insert(source.id.clone(), target.id.clone());
                    target.id
                };
                tx.execute(
                    "UPDATE session_properties SET field_id=?1 WHERE session_id=?2 AND field_id=?3",
                    params![target, session.id, source.id],
                )
                .map_err(err)?;
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
        for q in &mut group.questions {
            q.answer.clear();
        }
        self.conn.execute("INSERT INTO questionnaires(id,project_id,data) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![group.id,group.project_id,serde_json::to_string(&group).map_err(err)?]).map_err(err)?;
        Ok(group)
    }

    pub fn create_session(
        &self,
        project_id: &str,
        group_id: Option<&str>,
        date: &str,
    ) -> Result<Session> {
        self.project(project_id)?;
        let group = match group_id {
            Some(wanted) => Some(
                self.questionnaires(project_id)?
                    .into_iter()
                    .find(|g| g.id == wanted)
                    .ok_or("Questionnaire not found in this project.")?,
            ),
            None => None,
        };
        let s = Session {
            id: id(),
            project_id: project_id.into(),
            title: "Untitled session".into(),
            person: String::new(),
            date: date.into(),
            questionnaire_id: group.as_ref().map(|g| g.id.clone()),
            questionnaire_name: group
                .as_ref()
                .map_or("Blank form".into(), |g| g.name.clone()),
            questions: group.map_or(Vec::new(), |g| g.questions),
            notes: String::new(),
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
            "{} {} {} {} {}",
            s.title,
            s.person,
            s.questionnaire_name,
            s.notes,
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
}
