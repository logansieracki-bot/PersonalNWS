mod archive;
mod blob;
pub mod error;
mod live;
pub mod model;
mod source;

use std::collections::HashMap;
use js_sys::Uint8Array;
use wasm_bindgen::prelude::*;
use archive::ingest_archive_core;
use blob::build_sweep_blob_core;
use error::{RadarError, RadarErrorCode};
use live::{ingest_live_record_core, start_live_core};
use model::ProductId;
use source::DecodedSource;

#[derive(Default)]
pub struct RadarEngineCore {
    sources: HashMap<String, DecodedSource>,
}

impl RadarEngineCore {
    pub fn ingest_archive(&mut self, source_id: String, site: String, bytes: Vec<u8>) -> Result<model::ManifestV1, RadarError> {
        let source = ingest_archive_core(source_id.clone(), site, bytes)?;
        let manifest = source.manifest();
        self.sources.insert(source_id, source);
        Ok(manifest)
    }

    pub fn start_live(&mut self, source_id: String, site: String, bytes: Vec<u8>) -> Result<model::LiveDeltaV1, RadarError> {
        let (source, delta) = start_live_core(source_id.clone(), site, bytes)?;
        self.sources.insert(source_id, source);
        Ok(delta)
    }

    pub fn ingest_live_record(&mut self, source_id: &str, bytes: &[u8]) -> Result<model::LiveDeltaV1, RadarError> {
        let source = self.sources.get_mut(source_id).ok_or_else(|| RadarError::new(RadarErrorCode::SourceNotFound, "live", source_id, "live source not found"))?;
        ingest_live_record_core(source, bytes)
    }

    pub fn build_sweep_blob(&self, source_id: &str, elevation: u8, product_id: u16) -> Result<Vec<u8>, RadarError> {
        let source = self.sources.get(source_id).ok_or_else(|| RadarError::new(RadarErrorCode::SourceNotFound, "blob", source_id, "radar source not found"))?;
        let product = ProductId::try_from(product_id).map_err(|_| RadarError::new(RadarErrorCode::ProductNotAvailable, "blob", source_id, format!("unknown product id {product_id}")))?;
        build_sweep_blob_core(source, elevation, product)
    }

    pub fn release_source(&mut self, source_id: &str) -> Result<(), RadarError> {
        if self.sources.remove(source_id).is_none() {
            return Err(RadarError::new(RadarErrorCode::SourceNotFound, "release", source_id, "radar source not found"));
        }
        Ok(())
    }
}

#[wasm_bindgen]
pub struct RadarEngine {
    core: RadarEngineCore,
}

#[wasm_bindgen]
impl RadarEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self { Self { core: RadarEngineCore::default() } }

    pub fn ingest_archive(&mut self, source_id: String, site: String, bytes: Uint8Array) -> Result<JsValue, JsValue> {
        let manifest = self.core.ingest_archive(source_id, site, bytes.to_vec()).map_err(RadarError::into_js)?;
        serde_wasm_bindgen::to_value(&manifest).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    pub fn start_live(&mut self, source_id: String, site: String, bytes: Uint8Array) -> Result<JsValue, JsValue> {
        let delta = self.core.start_live(source_id, site, bytes.to_vec()).map_err(RadarError::into_js)?;
        serde_wasm_bindgen::to_value(&delta).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    pub fn ingest_live_record(&mut self, source_id: String, bytes: Uint8Array) -> Result<JsValue, JsValue> {
        let data = bytes.to_vec();
        let delta = self.core.ingest_live_record(&source_id, &data).map_err(RadarError::into_js)?;
        serde_wasm_bindgen::to_value(&delta).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    pub fn build_sweep_blob(&self, source_id: String, elevation_number: u8, product_id: u16) -> Result<Uint8Array, JsValue> {
        let blob = self.core.build_sweep_blob(&source_id, elevation_number, product_id).map_err(RadarError::into_js)?;
        Ok(Uint8Array::from(blob.as_slice()))
    }

    pub fn release_source(&mut self, source_id: String) -> Result<(), JsValue> {
        self.core.release_source(&source_id).map_err(RadarError::into_js)
    }
}
