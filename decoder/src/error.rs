use serde::Serialize;
use wasm_bindgen::JsValue;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum RadarErrorCode {
    #[serde(rename = "E_ARCHIVE_HEADER")]
    ArchiveHeader,
    #[serde(rename = "E_RECORD_DECOMPRESS")]
    RecordDecompress,
    #[serde(rename = "E_RADAR_DECODE")]
    RadarDecode,
    #[serde(rename = "E_NO_RADIALS")]
    NoRadials,
    #[serde(rename = "E_SOURCE_NOT_FOUND")]
    SourceNotFound,
    #[serde(rename = "E_ELEVATION_NOT_FOUND")]
    ElevationNotFound,
    #[serde(rename = "E_PRODUCT_NOT_AVAILABLE")]
    ProductNotAvailable,
    #[serde(rename = "E_GEOMETRY_MISMATCH")]
    GeometryMismatch,
    #[serde(rename = "E_BLOB_BUILD")]
    BlobBuild,
    #[serde(rename = "E_LIVE_START")]
    LiveStart,
    #[serde(rename = "E_LIVE_RECORD")]
    LiveRecord,
    #[serde(rename = "E_INTERNAL")]
    Internal,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RadarError {
    pub code: RadarErrorCode,
    pub stage: String,
    pub source_id: String,
    pub message: String,
    pub detail: String,
}

impl RadarError {
    pub fn new(
        code: RadarErrorCode,
        stage: impl Into<String>,
        source_id: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        let message = message.into();
        Self {
            code,
            stage: stage.into(),
            source_id: source_id.into(),
            detail: message.clone(),
            message,
        }
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = detail.into();
        self
    }

    pub fn into_js(self) -> JsValue {
        serde_wasm_bindgen::to_value(&self)
            .unwrap_or_else(|_| JsValue::from_str("E_INTERNAL: failed to serialize radar error"))
    }
}
