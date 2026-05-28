use schemars::JsonSchema;
use serde::Serialize;
use serde_json::{Value, json};
use thiserror::Error;

/// Hard byte cap on a tool response's serialised JSON. Roughly ~5000 tokens at
/// 4 chars/token; large enough for a full process tree on a typical host but
/// small enough to keep Claude's context tight. Exceeding it replaces `data`
/// with a stub and flips `truncated = true`.
pub const TOOL_RESPONSE_BUDGET_BYTES: usize = 20_000;

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

    #[allow(dead_code)]
    pub fn with_warning(mut self, w: impl Into<String>) -> Self {
        self.warnings.push(w.into());
        self
    }

    pub fn with_truncated(mut self, truncated: bool) -> Self {
        self.truncated = truncated;
        self
    }

    /// Optionally strip `data` (for `summary_only` mode) and enforce a hard
    /// byte budget on the serialized payload. If the encoded JSON exceeds the
    /// budget, `data` is replaced with a stub describing the size and
    /// `truncated` is set.
    pub fn finalize(mut self, summary_only: bool, budget: usize) -> Self {
        if summary_only {
            self.data = json!(null);
            return self;
        }
        // Cheap pre-check: estimate the size of just the data field.
        if let Ok(encoded) = serde_json::to_vec(&self.data)
            && encoded.len() > budget
        {
            self.data = json!({
                "_truncated": true,
                "_reason": format!(
                    "data exceeded {} byte budget (was {} bytes); call again with narrower args (limit, pid, top_per_pid).",
                    budget,
                    encoded.len(),
                ),
                "_byte_count": encoded.len(),
            });
            self.truncated = true;
        }
        self
    }
}

#[derive(Debug, Error)]
#[allow(dead_code)] // Permission / MissingDep variants are surfaced by collectors that don't exist yet.
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
