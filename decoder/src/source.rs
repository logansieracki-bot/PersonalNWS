use std::collections::BTreeMap;
use nexrad::model::data::Radial;
use crate::model::{ElevationManifestV1, ManifestV1, ProductId};

#[derive(Debug)]
pub struct DecodedSource {
    pub source_id: String,
    pub site: String,
    pub vcp: Option<u16>,
    pub complete: bool,
    pub elevations: BTreeMap<u8, Vec<Radial>>,
}

impl DecodedSource {
    pub fn new(source_id: String, site: String) -> Self {
        Self { source_id, site, vcp: None, complete: false, elevations: BTreeMap::new() }
    }

    pub fn push_radial(&mut self, radial: Radial) {
        self.elevations.entry(radial.elevation_number()).or_default().push(radial);
    }

    pub fn product_available(product: ProductId, radial: &Radial) -> bool {
        let p = product.to_nexrad();
        p.moment_data(radial).is_some() || p.cfp_moment_data(radial).is_some()
    }

    pub fn manifest(&self) -> ManifestV1 {
        let mut scan_start = f64::INFINITY;
        let mut scan_end = f64::NEG_INFINITY;
        let mut elevations = Vec::with_capacity(self.elevations.len());

        for (&number, radials) in &self.elevations {
            if radials.is_empty() { continue; }
            let mut start = f64::INFINITY;
            let mut end = f64::NEG_INFINITY;
            let mut angle_sum = 0.0f64;
            for r in radials {
                let t = r.collection_timestamp() as f64;
                start = start.min(t);
                end = end.max(t);
                angle_sum += r.elevation_angle_degrees() as f64;
            }
            scan_start = scan_start.min(start);
            scan_end = scan_end.max(end);
            let mut products = Vec::new();
            for id in 1u16..=6u16 {
                let p = ProductId::try_from(id).unwrap();
                if radials.iter().any(|r| Self::product_available(p, r)) { products.push(id); }
            }
            elevations.push(ElevationManifestV1 {
                number,
                angle: (angle_sum / radials.len() as f64) as f32,
                start_ms: start,
                end_ms: end,
                radial_count: radials.len() as u32,
                products,
                complete: self.complete,
            });
        }

        if !scan_start.is_finite() { scan_start = 0.0; }
        if !scan_end.is_finite() { scan_end = scan_start; }

        ManifestV1 {
            version: 1,
            source_id: self.source_id.clone(),
            site: self.site.clone(),
            scan_start_ms: scan_start,
            scan_end_ms: scan_end,
            vcp: self.vcp,
            complete: self.complete,
            elevations,
        }
    }
}
