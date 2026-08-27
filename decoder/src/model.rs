use serde::Serialize;

#[repr(u16)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub enum ProductId {
    Reflectivity = 1,
    Velocity = 2,
    SpectrumWidth = 3,
    DifferentialReflectivity = 4,
    CorrelationCoefficient = 5,
    DifferentialPhase = 6,
}

impl TryFrom<u16> for ProductId {
    type Error = ();
    fn try_from(value: u16) -> Result<Self, Self::Error> {
        Ok(match value {
            1 => Self::Reflectivity,
            2 => Self::Velocity,
            3 => Self::SpectrumWidth,
            4 => Self::DifferentialReflectivity,
            5 => Self::CorrelationCoefficient,
            6 => Self::DifferentialPhase,
            _ => return Err(()),
        })
    }
}

impl ProductId {
    pub fn to_nexrad(self) -> nexrad_render::Product {
        match self {
            Self::Reflectivity => nexrad_render::Product::Reflectivity,
            Self::Velocity => nexrad_render::Product::Velocity,
            Self::SpectrumWidth => nexrad_render::Product::SpectrumWidth,
            Self::DifferentialReflectivity => nexrad_render::Product::DifferentialReflectivity,
            Self::CorrelationCoefficient => nexrad_render::Product::CorrelationCoefficient,
            Self::DifferentialPhase => nexrad_render::Product::DifferentialPhase,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ElevationManifestV1 {
    pub number: u8,
    pub angle: f32,
    pub start_ms: f64,
    pub end_ms: f64,
    pub radial_count: u32,
    pub products: Vec<u16>,
    pub complete: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestV1 {
    pub version: u16,
    pub source_id: String,
    pub site: String,
    pub scan_start_ms: f64,
    pub scan_end_ms: f64,
    pub vcp: Option<u16>,
    pub complete: bool,
    pub elevations: Vec<ElevationManifestV1>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedElevationV1 {
    pub elevation_number: u8,
    pub elevation_angle: f32,
    pub radial_count: u32,
    pub complete: bool,
    pub products: Vec<u16>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveDeltaV1 {
    pub version: u16,
    pub source_id: String,
    pub site: String,
    pub scan_start_ms: f64,
    pub vcp: Option<u16>,
    pub volume_complete: bool,
    pub changed: Vec<ChangedElevationV1>,
}
