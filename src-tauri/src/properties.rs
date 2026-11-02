use crate::{
    model::*,
    store::{Result, SessionPage, Store},
};
use rusqlite::{params, params_from_iter, types::Value as SqlValue, OptionalExtension};
use serde_json::Value;
use std::collections::HashSet;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn kind_name(kind: &FieldType) -> String {
    serde_json::to_value(kind).unwrap().as_str().unwrap().into()
}

pub fn valid_date(value: &str) -> bool {
    let parts = value.split('-').collect::<Vec<_>>();
    if parts.len() != 3 || parts[0].len() != 4 || parts[1].len() != 2 || parts[2].len() != 2 {
        return false;
    }
    let Ok(y) = parts[0].parse::<u32>() else {
        return false;
    };
    let Ok(m) = parts[1].parse::<usize>() else {
        return false;
    };
    let Ok(d) = parts[2].parse::<u32>() else {
        return false;
    };
    if y == 0 || !(1..=12).contains(&m) {
        return false;
    }
    let days = [
        31,
        if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) {
            29
        } else {
            28
        },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    d > 0 && d <= days[m - 1]
}

fn normalize(field: &ProjectField, value: Value) -> Result<Value> {
    if value.is_null() || value.as_str().is_some_and(|s| s.trim().is_empty()) {
        return Ok(Value::Null);
    }
    match field.kind {
        FieldType::Number => {
            if value.as_f64().is_some_and(f64::is_finite) {
                Ok(value)
            } else {
                Err("Enter a finite number or leave the field empty.".into())
            }
        }
        _ => {
            let raw = value
                .as_str()
                .ok_or("This field needs a text value or an empty value.")?;
            if raw.chars().count() > 10_000 {
                return Err("Keep project field values under 10,000 characters.".into());
            }
            match field.kind {
                FieldType::Email => {
                    let v = raw.trim();
                    let mut parts = v.split('@');
                    let local = parts.next().unwrap_or("");
                    let domain = parts.next().unwrap_or("");
                    if local.is_empty()
                        || domain.is_empty()
                        || parts.next().is_some()
                        || v.chars().any(char::is_whitespace)
                        || v.len() > 320
                    {
                        return Err("Enter a valid email address or leave it empty.".into());
                    }
                    Ok(Value::String(v.into()))
                }
                FieldType::Date => {
                    if valid_date(raw) {
                        Ok(value)
                    } else {
                        Err("Enter a valid date or leave it empty.".into())
                    }
                }
                FieldType::Select => {
                    if field.options.iter().any(|o| o == raw) {
                        Ok(value)
                    } else {
                        Err("Choose one of this column's options or leave it empty.".into())
                    }
                }
                _ => Ok(value),
            }
        }
    }
}

impl Store {
    pub fn fields(&self, project_id: &str) -> Result<Vec<ProjectField>> {
        self.project(project_id)?;
        let mut stmt=self.conn.prepare("SELECT id,name,kind,options FROM project_fields WHERE project_id=?1 ORDER BY rowid").map_err(err)?;
        let rows = stmt
            .query_map([project_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        rows.into_iter()
            .map(|(id, name, kind, options)| {
                Ok(ProjectField {
                    id,
                    project_id: project_id.into(),
                    name,
                    kind: serde_json::from_value(Value::String(kind)).map_err(err)?,
                    options: serde_json::from_str(&options).map_err(err)?,
                })
            })
            .collect()
    }

    pub fn save_field(&self, mut field: ProjectField) -> Result<ProjectField> {
        let fields = self.fields(&field.project_id)?;
        field.name = field.name.trim().into();
        if field.name.is_empty()
            || field.name.chars().count() > 80
            || uuid::Uuid::parse_str(&field.id).is_err()
        {
            return Err("Enter a column name up to 80 characters.".into());
        }
        if fields
            .iter()
            .any(|f| f.id != field.id && f.name.to_lowercase() == field.name.to_lowercase())
        {
            return Err("This project already has a column with that name.".into());
        }
        let owner: Option<String> = self
            .conn
            .query_row(
                "SELECT project_id FROM project_fields WHERE id=?1",
                [&field.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        if owner.as_ref().is_some_and(|p| p != &field.project_id) {
            return Err("This column belongs to another project.".into());
        }
        if let Some(old) = fields.iter().find(|f| f.id == field.id) {
            if old.kind != field.kind || old.options != field.options {
                return Err("Column types and options are fixed after creation. Rename or hide the column instead.".into());
            }
        } else if fields.len() >= 100 {
            return Err("A project can have up to 100 custom columns.".into());
        }
        if field.kind == FieldType::Select {
            if field.options.is_empty() || field.options.len() > 100 {
                return Err("Add between 1 and 100 options.".into());
            }
            let mut seen = HashSet::new();
            for option in &mut field.options {
                *option = option.trim().into();
                if option.is_empty()
                    || option.chars().count() > 100
                    || !seen.insert(option.to_lowercase())
                {
                    return Err(
                        "Options must be nonempty and unique, up to 100 characters each.".into(),
                    );
                }
            }
        } else {
            field.options.clear()
        }
        self.conn.execute("INSERT INTO project_fields(id,project_id,name,kind,options) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET name=excluded.name",params![field.id,field.project_id,field.name,kind_name(&field.kind),serde_json::to_string(&field.options).map_err(err)?]).map_err(err)?;
        Ok(field)
    }

    pub fn property_values(&self, session_id: &str) -> Result<PropertyValues> {
        self.session(session_id)?;
        let mut stmt = self
            .conn
            .prepare("SELECT field_id,value FROM session_properties WHERE session_id=?1")
            .map_err(err)?;
        let rows = stmt
            .query_map([session_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        rows.into_iter()
            .map(|(id, v)| Ok((id, serde_json::from_str(&v).map_err(err)?)))
            .collect()
    }

    pub fn set_property(
        &self,
        project_id: &str,
        session_id: &str,
        field_id: &str,
        value: Value,
    ) -> Result<Value> {
        if self.session(session_id)?.project_id != project_id {
            return Err("That session belongs to another project.".into());
        }
        let field = self
            .fields(project_id)?
            .into_iter()
            .find(|f| f.id == field_id)
            .ok_or("Column not found in this project.")?;
        let value = normalize(&field, value)?;
        if value.is_null() {
            self.conn
                .execute(
                    "DELETE FROM session_properties WHERE session_id=?1 AND field_id=?2",
                    params![session_id, field_id],
                )
                .map_err(err)?;
        } else {
            let text = value
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| value.to_string())
                .to_lowercase();
            self.conn.execute("INSERT INTO session_properties(session_id,field_id,value,text_value,number_value) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(session_id,field_id) DO UPDATE SET value=excluded.value,text_value=excluded.text_value,number_value=excluded.number_value",params![session_id,field_id,serde_json::to_string(&value).map_err(err)?,text,value.as_f64()]).map_err(err)?;
        }
        Ok(value)
    }

    pub fn overview(&self, query: &OverviewQuery) -> Result<SessionPage> {
        let parts = self.overview_sql(query)?;
        let total = self
            .conn
            .query_row(
                "SELECT count(*) FROM sessions WHERE project_id=?1",
                [&query.project_id],
                |r| r.get(0),
            )
            .map_err(err)?;
        let matching = self
            .conn
            .query_row(
                &format!("SELECT count(*) {}", parts.from),
                params_from_iter(&parts.args),
                |r| r.get(0),
            )
            .map_err(err)?;
        let sql=format!("SELECT s.id,s.title,s.person,s.date,s.questionnaire_name,(SELECT count(*) FROM audio a WHERE a.session_id=s.id),COALESCE((SELECT json_group_object(p.field_id,json(p.value)) FROM session_properties p WHERE p.session_id=s.id),'{{}}') {} ORDER BY {} LIMIT 100 OFFSET ?{}",parts.from,parts.order,parts.args.len()+1);
        let mut args = parts.args;
        args.push(SqlValue::Integer(query.offset.into()));
        let mut stmt = self.conn.prepare(&sql).map_err(err)?;
        let raw = stmt
            .query_map(params_from_iter(&args), |r| {
                Ok((
                    SessionSummary {
                        id: r.get(0)?,
                        title: r.get(1)?,
                        person: r.get(2)?,
                        date: r.get(3)?,
                        questionnaire_name: r.get(4)?,
                        audio_count: r.get(5)?,
                        values: PropertyValues::new(),
                    },
                    r.get::<_, String>(6)?,
                ))
            })
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        let sessions = raw
            .into_iter()
            .map(|(mut s, json)| {
                s.values = serde_json::from_str(&json).map_err(err)?;
                Ok(s)
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(SessionPage {
            sessions,
            total,
            matching,
        })
    }

    pub fn overview_ids(&self, query: &OverviewQuery) -> Result<Vec<String>> {
        let parts = self.overview_sql(query)?;
        let mut stmt = self
            .conn
            .prepare(&format!(
                "SELECT s.id {} ORDER BY {}",
                parts.from, parts.order
            ))
            .map_err(err)?;
        let rows = stmt
            .query_map(params_from_iter(&parts.args), |r| r.get(0))
            .map_err(err)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)
    }

    fn overview_sql(&self, query: &OverviewQuery) -> Result<QueryParts> {
        let fields = self.fields(&query.project_id)?;
        if !matches!(query.sort.direction.as_str(), "asc" | "desc")
            || query.filters.len() > 20
            || query.search.chars().count() > 10_000
        {
            return Err("Invalid sort or filter settings.".into());
        }
        let mut args = vec![SqlValue::Text(query.project_id.clone())];
        let mut joins = String::new();
        let (sort_expr, empty_expr) = if let Some(core) = core_column(&query.sort.key) {
            (
                format!("lower({core})"),
                format!("NULLIF({core},'') IS NULL"),
            )
        } else {
            let field = fields
                .iter()
                .find(|f| f.id == query.sort.key)
                .ok_or("The sort column is not in this project.")?;
            let binding = bind(&mut args, SqlValue::Text(field.id.clone()));
            joins.push_str(&format!(
                " LEFT JOIN session_properties sv ON sv.session_id=s.id AND sv.field_id={binding}"
            ));
            let expr = match field.kind {
                FieldType::Number => "sv.number_value".into(),
                FieldType::Select => {
                    let options = bind(
                        &mut args,
                        SqlValue::Text(serde_json::to_string(&field.options).map_err(err)?),
                    );
                    joins.push_str(&format!(
                        " LEFT JOIN json_each({options}) so ON so.value=json_extract(sv.value,'$')"
                    ));
                    "CAST(so.key AS INTEGER)".into()
                }
                _ => "sv.text_value".into(),
            };
            (expr, "sv.value IS NULL".into())
        };
        let mut conditions = vec!["s.project_id=?1".to_string()];
        if !query.search.is_empty() {
            let q = bind(&mut args, SqlValue::Text(query.search.to_lowercase()));
            conditions.push(format!("(instr(s.search_text,{q})>0 OR EXISTS(SELECT 1 FROM session_properties sp WHERE sp.session_id=s.id AND instr(sp.text_value,{q})>0))"));
        }
        for rule in &query.filters {
            let custom = fields.iter().find(|f| f.id == rule.field);
            let kind = custom
                .map(|f| f.kind.clone())
                .or_else(|| {
                    core_column(&rule.field).map(|_| {
                        if rule.field == "date" {
                            FieldType::Date
                        } else {
                            FieldType::Text
                        }
                    })
                })
                .ok_or("A filter column is not in this project.")?;
            let allowed = match kind {
                FieldType::Number | FieldType::Date => {
                    ["is", "gte", "lte", "empty", "filled"].as_slice()
                }
                FieldType::Select => ["is", "not", "empty", "filled"].as_slice(),
                _ => ["contains", "is", "not", "empty", "filled"].as_slice(),
            };
            if !allowed.contains(&rule.op.as_str()) {
                return Err("This filter operator does not match the column type.".into());
            }
            let empty = matches!(rule.op.as_str(), "empty" | "filled");
            let comparison = if empty {
                String::new()
            } else {
                let value = match kind {
                    FieldType::Number => SqlValue::Real(
                        rule.value
                            .as_f64()
                            .filter(|v| v.is_finite())
                            .ok_or("Enter a number for this filter.")?,
                    ),
                    _ => {
                        let s = rule
                            .value
                            .as_str()
                            .filter(|s| !s.is_empty())
                            .ok_or("Choose a filter value or use Is empty.")?;
                        if kind == FieldType::Date && !valid_date(s) {
                            return Err("Enter a valid date for this filter.".into());
                        }
                        if kind == FieldType::Select
                            && !custom.unwrap().options.iter().any(|v| v == s)
                        {
                            return Err("Choose a listed option for this filter.".into());
                        }
                        SqlValue::Text(s.to_lowercase())
                    }
                };
                let value = bind(&mut args, value);
                let expr = if let Some(core) = core_column(&rule.field) {
                    format!("lower(NULLIF({core},''))")
                } else if kind == FieldType::Number {
                    "fp.number_value".into()
                } else {
                    "fp.text_value".into()
                };
                match rule.op.as_str() {
                    "contains" => format!("instr({expr},{value})>0"),
                    "is" => format!("{expr}={value}"),
                    "not" => format!("{expr}<>{value}"),
                    "gte" => format!("{expr}>={value}"),
                    _ => format!("{expr}<={value}"),
                }
            };
            if let Some(field) = custom {
                let field_id = bind(&mut args, SqlValue::Text(field.id.clone()));
                let base=format!("SELECT 1 FROM session_properties fp WHERE fp.session_id=s.id AND fp.field_id={field_id}");
                conditions.push(if empty {
                    format!(
                        "{}EXISTS({base})",
                        if rule.op == "empty" { "NOT " } else { "" }
                    )
                } else {
                    format!("EXISTS({base} AND {comparison})")
                });
            } else {
                let core = core_column(&rule.field).unwrap();
                conditions.push(if empty {
                    format!(
                        "NULLIF({core},'') IS {}NULL",
                        if rule.op == "filled" { "NOT " } else { "" }
                    )
                } else {
                    comparison
                });
            }
        }
        Ok(QueryParts {
            from: format!("FROM sessions s{joins} WHERE {}", conditions.join(" AND ")),
            order: format!(
                "({empty_expr}) ASC,{sort_expr} {},s.rowid DESC",
                query.sort.direction.to_ascii_uppercase()
            ),
            args,
        })
    }
}

struct QueryParts {
    from: String,
    order: String,
    args: Vec<SqlValue>,
}
fn bind(args: &mut Vec<SqlValue>, value: SqlValue) -> String {
    args.push(value);
    format!("?{}", args.len())
}
fn core_column(key: &str) -> Option<&'static str> {
    match key {
        "title" => Some("s.title"),
        "person" => Some("s.person"),
        "date" => Some("s.date"),
        _ => None,
    }
}
