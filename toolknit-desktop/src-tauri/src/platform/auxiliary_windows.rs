//! Registered auxiliary domains participate in capture without borrowed labels.
use std::{collections::HashMap, sync::Mutex};
use tauri::Manager;
#[derive(Clone)]
pub(crate) struct Group {
    pub labels: Vec<&'static str>,
    pub suspend: fn(&tauri::AppHandle) -> u64,
    pub restore: fn(&tauri::AppHandle, u64),
}
#[derive(Default)]
pub(crate) struct Registry(Mutex<HashMap<&'static str, Group>>);
pub(crate) fn register(app: &tauri::AppHandle, name: &'static str, group: Group) {
    app.state::<Registry>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(name, group);
}
pub(crate) struct Suspension {
    app: tauri::AppHandle,
    groups: Vec<(Group, u64)>,
}
impl Suspension {
    pub fn begin(app: &tauri::AppHandle) -> Self {
        let registered = app
            .try_state::<Registry>()
            .map(|registry| {
                registry
                    .0
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .values()
                    .cloned()
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let groups = registered
            .into_iter()
            .map(|group| {
                let token = (group.suspend)(app);
                (group, token)
            })
            .collect();
        Self {
            app: app.clone(),
            groups,
        }
    }
    pub fn owns(&self, label: &str) -> bool {
        self.groups.iter().any(|(g, _)| g.labels.contains(&label))
    }
}
impl Drop for Suspension {
    fn drop(&mut self) {
        for (group, token) in &self.groups {
            (group.restore)(&self.app, *token);
        }
    }
}
