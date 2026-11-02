use crate::{model::*, store::Store};
use serde_json::{json, Value};

fn field(
    store: &Store,
    project: &str,
    name: &str,
    kind: FieldType,
    options: &[&str],
) -> ProjectField {
    store
        .save_field(ProjectField {
            id: id(),
            project_id: project.into(),
            name: name.into(),
            kind,
            options: options.iter().map(|s| s.to_string()).collect(),
        })
        .unwrap()
}
fn query(project: &str, key: &str, direction: &str) -> OverviewQuery {
    OverviewQuery {
        project_id: project.into(),
        sort: PropertySort {
            key: key.into(),
            direction: direction.into(),
        },
        ..Default::default()
    }
}

#[test]
fn additive_upgrade_preserves_v1_answers_and_makes_new_fields_optional() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let project = store.create_project("Test").unwrap();
    let group = store.questionnaires(&project.id).unwrap().remove(0);
    let mut session = store
        .create_session(&project.id, Some(&group.id), "2026-11-02")
        .unwrap();
    session.questions[0].answer = "Keep this original answer".into();
    session.notes = "Old notes".into();
    store.save_session(session.clone()).unwrap();
    store
        .conn
        .execute_batch(
            "DROP TABLE session_properties; DROP TABLE project_fields; PRAGMA user_version=1;",
        )
        .unwrap();
    drop(store);
    let upgraded = Store::open(dir.path()).unwrap();
    assert_eq!(
        upgraded.session(&session.id).unwrap().questions[0].answer,
        "Keep this original answer"
    );
    assert!(upgraded.fields(&project.id).unwrap().is_empty());
    let email = field(&upgraded, &project.id, "Email", FieldType::Email, &[]);
    assert!(upgraded.property_values(&session.id).unwrap().is_empty());
    let fresh = upgraded
        .create_session(&project.id, None, "2026-11-02")
        .unwrap();
    assert!(upgraded.property_values(&fresh.id).unwrap().is_empty());
    upgraded
        .set_property(
            &project.id,
            &session.id,
            &email.id,
            json!("person@example.test"),
        )
        .unwrap();
    upgraded.save_session(session.clone()).unwrap();
    assert_eq!(
        upgraded.property_values(&session.id).unwrap()[&email.id],
        json!("person@example.test")
    );
    let mut renamed = email.clone();
    renamed.name = "Contact email".into();
    upgraded.save_field(renamed).unwrap();
    assert_eq!(
        upgraded.property_values(&session.id).unwrap()[&email.id],
        json!("person@example.test")
    );
    drop(upgraded);
    let reopened = Store::open(dir.path()).unwrap();
    assert_eq!(
        reopened.fields(&project.id).unwrap()[0].name,
        "Contact email"
    );
    assert_eq!(reopened.session(&session.id).unwrap().notes, "Old notes");
}

#[test]
fn numeric_select_and_date_sorting_are_typed_with_empty_last_in_both_directions() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let p = store.create_project("Test").unwrap();
    let number = field(&store, &p.id, "Score", FieldType::Number, &[]);
    let select = field(
        &store,
        &p.id,
        "Excitement",
        FieldType::Select,
        &["Low", "Medium", "High"],
    );
    let date = field(&store, &p.id, "Follow-up", FieldType::Date, &[]);
    let sessions = (0..4)
        .map(|_| store.create_session(&p.id, None, "2026-11-02").unwrap())
        .collect::<Vec<_>>();
    for (i, n) in [10, 2, 0].iter().enumerate() {
        store
            .set_property(&p.id, &sessions[i].id, &number.id, json!(n))
            .unwrap();
    }
    for (i, s) in ["Medium", "Low", "High"].iter().enumerate() {
        store
            .set_property(&p.id, &sessions[i].id, &select.id, json!(s))
            .unwrap();
    }
    for (i, s) in ["2026-12-01", "2026-01-01", "2026-02-01"]
        .iter()
        .enumerate()
    {
        store
            .set_property(&p.id, &sessions[i].id, &date.id, json!(s))
            .unwrap();
    }
    let ids = |key: &str, dir: &str| store.overview_ids(&query(&p.id, key, dir)).unwrap();
    assert_eq!(
        ids(&number.id, "asc"),
        [2, 1, 0, 3].map(|i| sessions[i].id.clone())
    );
    assert_eq!(ids(&number.id, "desc").last(), Some(&sessions[3].id));
    assert_eq!(
        ids(&select.id, "asc"),
        [1, 0, 2, 3].map(|i| sessions[i].id.clone())
    );
    assert_eq!(
        ids(&select.id, "desc"),
        [2, 0, 1, 3].map(|i| sessions[i].id.clone())
    );
    assert_eq!(
        ids(&date.id, "asc"),
        [1, 2, 0, 3].map(|i| sessions[i].id.clone())
    );
    assert_eq!(
        store
            .overview(&query(&p.id, &number.id, "asc"))
            .unwrap()
            .sessions[0]
            .values[&number.id],
        json!(0)
    );
}

#[test]
fn and_filters_search_and_exports_work_across_pages_without_crossing_projects() {
    let dir = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let p = store.create_project("Test").unwrap();
    let excitement = field(
        &store,
        &p.id,
        "Excitement",
        FieldType::Select,
        &["Low", "Medium", "High"],
    );
    let email = field(&store, &p.id, "Email", FieldType::Email, &[]);
    let mut expected = Vec::new();
    for i in 0..115 {
        let session = store.create_session(&p.id, None, "2026-11-02").unwrap();
        store
            .set_property(&p.id, &session.id, &excitement.id, json!("High"))
            .unwrap();
        if i % 2 == 0 {
            store
                .set_property(&p.id, &session.id, &email.id, json!("test@example.test"))
                .unwrap();
            expected.push(session.id);
        }
    }
    let mut q = query(&p.id, "date", "desc");
    assert_eq!(store.overview(&q).unwrap().sessions.len(), 100);
    q.offset = 100;
    assert_eq!(store.overview(&q).unwrap().sessions.len(), 15);
    q.filters = vec![
        PropertyFilter {
            field: excitement.id.clone(),
            op: "is".into(),
            value: json!("High"),
        },
        PropertyFilter {
            field: email.id.clone(),
            op: "filled".into(),
            value: Value::Null,
        },
    ];
    let ids = store.overview_ids(&q).unwrap();
    assert_eq!(ids.len(), expected.len());
    assert!(ids.iter().all(|id| expected.contains(id)));
    q.offset = 0;
    assert_eq!(store.overview(&q).unwrap().matching, 58);
    q.search = "@example.test".into();
    assert_eq!(store.overview_ids(&q).unwrap().len(), 58);
    let other = store.create_project("Other").unwrap();
    let outsider = store.create_session(&other.id, None, "2026-11-02").unwrap();
    assert!(store
        .set_property(&p.id, &outsider.id, &email.id, json!("x@example.test"))
        .is_err());
    let foreign = field(&store, &other.id, "Email", FieldType::Email, &[]);
    assert!(store
        .set_property(&p.id, &ids[0], &foreign.id, json!("x@example.test"))
        .is_err());
    let dest = out.path().join("selected.json");
    crate::export::export(&store, &p.id, &ids[..1], "json", &dest).unwrap();
    let export: Value = serde_json::from_slice(&std::fs::read(&dest).unwrap()).unwrap();
    assert_eq!(export["schemaVersion"], 2);
    assert_eq!(export["fieldDefinitions"].as_array().unwrap().len(), 2);
    assert_eq!(export["sessions"].as_array().unwrap().len(), 1);
    assert_eq!(
        export["sessions"][0]["values"][&email.id],
        "test@example.test"
    );
}

#[test]
fn invalid_values_and_untrusted_query_fragments_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let p = store.create_project("Test").unwrap();
    let s = store.create_session(&p.id, None, "2026-11-02").unwrap();
    for (kind, bad) in [
        (FieldType::Email, json!("not an email")),
        (FieldType::Number, json!("10")),
        (FieldType::Date, json!("2026-02-30")),
    ] {
        let f = field(&store, &p.id, &format!("{:?}", kind), kind, &[]);
        assert!(store.set_property(&p.id, &s.id, &f.id, bad).is_err());
        assert!(store.set_property(&p.id, &s.id, &f.id, Value::Null).is_ok());
    }
    assert!(store
        .overview(&query(&p.id, "date; DROP TABLE sessions", "asc"))
        .is_err());
    assert!(store
        .overview(&query(&p.id, "date", "desc; DROP TABLE sessions"))
        .is_err());
    assert_eq!(store.session(&s.id).unwrap().id, s.id);
}
