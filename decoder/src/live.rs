use crate::archive::decode_messages_with_vcp;
use crate::error::{RadarError, RadarErrorCode};
use crate::model::{ChangedElevationV1, LiveDeltaV1};
use crate::source::DecodedSource;
use nexrad::model::data::Radial;
use nexrad_data::volume::{File, Record};
use std::collections::BTreeSet;

fn radial_implies_complete(radial: &Radial) -> bool {
    let status = format!("{:?}", radial.radial_status());
    status.contains("End") || status.contains("Last")
}

fn decoded_or_empty<T, E>(result: Result<Vec<T>, E>) -> Vec<T> {
    result.unwrap_or_default()
}

fn merge_radials(source: &mut DecodedSource, radials: Vec<Radial>) -> BTreeSet<u8> {
    let mut changed = BTreeSet::new();
    for radial in radials {
        changed.insert(radial.elevation_number());
        if radial_implies_complete(&radial)
            && format!("{:?}", radial.radial_status()).contains("Scan")
        {
            source.complete = true;
        }
        source.push_radial(radial);
    }
    changed
}

fn delta(source: &DecodedSource, changed: BTreeSet<u8>) -> LiveDeltaV1 {
    let manifest = source.manifest();
    let changed = manifest
        .elevations
        .iter()
        .filter(|e| changed.contains(&e.number))
        .map(|e| ChangedElevationV1 {
            elevation_number: e.number,
            elevation_angle: e.angle,
            radial_count: e.radial_count,
            complete: e.complete
                || source
                    .elevations
                    .get(&e.number)
                    .and_then(|rs| rs.last())
                    .map(radial_implies_complete)
                    .unwrap_or(false),
            products: e.products.clone(),
        })
        .collect();
    LiveDeltaV1 {
        version: 1,
        source_id: source.source_id.clone(),
        site: source.site.clone(),
        scan_start_ms: manifest.scan_start_ms,
        vcp: source.vcp,
        volume_complete: source.complete,
        changed,
    }
}

pub fn start_live_core(
    source_id: String,
    site: String,
    bytes: Vec<u8>,
) -> Result<(DecodedSource, LiveDeltaV1), RadarError> {
    let mut source = DecodedSource::new(source_id.clone(), site);
    let file = File::new(bytes);
    let records = file.records().map_err(|e| {
        RadarError::new(
            RadarErrorCode::LiveStart,
            "live",
            &source_id,
            "could not split live start chunk",
        )
        .with_detail(e.to_string())
    })?;
    let mut changed = BTreeSet::new();

    // Match NEXRAD Workbench's live behavior: a damaged/non-radial record does
    // not kill the entire stream. It contributes zero radials and the next
    // realtime record is still allowed to advance the scan.
    for record in records.iter() {
        let radials = if record.compressed() {
            match record.decompress() {
                Ok(decompressed) => {
                    if source.vcp.is_none() {
                        match decompressed.messages() {
                            Ok(messages) => decode_messages_with_vcp(messages, &mut source),
                            Err(_) => decoded_or_empty(decompressed.radials()),
                        }
                    } else {
                        decoded_or_empty(decompressed.radials())
                    }
                }
                Err(_) => Vec::new(),
            }
        } else {
            decoded_or_empty(record.radials())
        };
        changed.extend(merge_radials(&mut source, radials));
    }

    if source.elevations.is_empty() {
        return Err(RadarError::new(
            RadarErrorCode::NoRadials,
            "live",
            &source_id,
            "live start chunk contained no decodable radial data",
        ));
    }
    let d = delta(&source, changed);
    Ok((source, d))
}

pub fn ingest_live_record_core(
    source: &mut DecodedSource,
    bytes: &[u8],
) -> Result<LiveDeltaV1, RadarError> {
    let record = Record::from_slice(bytes);
    let radials = if record.compressed() {
        match record.decompress() {
            Ok(decompressed) => {
                if source.vcp.is_none() {
                    match decompressed.messages() {
                        Ok(messages) => decode_messages_with_vcp(messages, source),
                        Err(_) => decoded_or_empty(decompressed.radials()),
                    }
                } else {
                    decoded_or_empty(decompressed.radials())
                }
            }
            Err(_) => Vec::new(),
        }
    } else {
        decoded_or_empty(record.radials())
    };
    let changed = merge_radials(source, radials);
    Ok(delta(source, changed))
}

#[cfg(test)]
mod regression_tests {
    use super::decoded_or_empty;

    #[test]
    fn one_live_record_parser_miss_is_not_stream_fatal() {
        let result: Result<Vec<u8>, &str> = Err("bad record");
        assert!(decoded_or_empty(result).is_empty());
    }
}
