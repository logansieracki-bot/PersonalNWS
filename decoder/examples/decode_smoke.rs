use personalnws_decoder::RadarEngineCore;
use std::{env, fs, process};

fn main() {
    if let Err(error) = run() {
        eprintln!("PersonalNWS current Level II native smoke FAILED: {error}");
        process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut args = env::args().skip(1);
    let path = args
        .next()
        .ok_or_else(|| "usage: decode_smoke <archive-file> <site>".to_string())?;
    let site = args
        .next()
        .ok_or_else(|| "usage: decode_smoke <archive-file> <site>".to_string())?
        .to_uppercase();

    let bytes = fs::read(&path).map_err(|e| format!("could not read {path}: {e}"))?;
    let source_id = format!("smoke:{site}");
    let mut engine = RadarEngineCore::default();
    let manifest = engine
        .ingest_archive(source_id.clone(), site.clone(), bytes)
        .map_err(|e| format!("{} [{:?} / {}] {}", e.message, e.code, e.stage, e.detail))?;

    let elevation = manifest
        .elevations
        .iter()
        .find(|e| e.products.contains(&(personalnws_decoder::model::ProductId::Reflectivity as u16)))
        .ok_or_else(|| format!("{site} decoded but no reflectivity elevation was available"))?;

    let blob = engine
        .build_sweep_blob(
            &source_id,
            elevation.number,
            personalnws_decoder::model::ProductId::Reflectivity as u16,
        )
        .map_err(|e| format!("{} [{:?} / {}] {}", e.message, e.code, e.stage, e.detail))?;

    if blob.len() < 96 || &blob[0..4] != b"PSWP" {
        return Err(format!("{site} produced an invalid PSWP blob ({} bytes)", blob.len()));
    }

    println!(
        "CURRENT LEVEL II OK site={} elevations={} reflectivity_cut={} radials={} blob_bytes={}",
        site,
        manifest.elevations.len(),
        elevation.number,
        elevation.radial_count,
        blob.len()
    );
    Ok(())
}
