use schemars::JsonSchema;
use serde::Serialize;
use serde_json::Value;
use thiserror::Error;

/// Uniform response shape every collector returns.
///
/// The MCP client (Claude) can read `summary` for a quick understanding or drill into
/// the structured `data` field. `warnings` capture per-item permission gaps and missing
/// optional tools without failing the whole call.
#[derive(Debug, Serialize, JsonSchema)]
pub struct CollectorOutput {
    pub summary: String,
    pub data: Value,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub truncated: bool,
}

impl CollectorOutput {
    pub fn new(summary: impl Into<String>, data: Value) -> Self {
        Self { summary: summary.into(), data, warnings: Vec::new(), truncated: false }
    }

    pub fn with_warning(mut self, w: impl Into<String>) -> Self {
        self.warnings.push(w.into());
        self
    }

    pub fn with_truncated(mut self, truncated: bool) -> Self {
        self.truncated = truncated;
        self
    }
}

#[derive(Debug, Error)]
pub enum TrishulError {
    #[error("permission denied reading {path}")]
    Permission { path: String },
    #[error("this tool requires capability `{0}` — run with `setcap {0}=eip trishul-mcp` or via sudo")]
    RequiresCapability(&'static str),
    #[error("optional dependency missing: {name} ({hint})")]
    MissingDep { name: &'static str, hint: &'static str },
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("procfs: {0}")]
    Procfs(String),
    #[error("invalid args: {0}")]
    BadArgs(String),
}

#[cfg(target_os = "linux")]
impl From<procfs::ProcError> for TrishulError {
    fn from(e: procfs::ProcError) -> Self {
        TrishulError::Procfs(e.to_string())
    }
}
