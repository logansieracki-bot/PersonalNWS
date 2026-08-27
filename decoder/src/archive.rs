use crate::error::{RadarError, RadarErrorCode};
use crate::source::DecodedSource;
use nexrad::model::data::Radial;
use nexrad_data::volume::File;
use nexrad_decode::messages::{Message, MessageContents};

pub(crate) fn decode_messages_with_vcp<'a>(
    messages: impl IntoIterator<Item = Message<'a>>,
    source: &mut DecodedSource,
) -> Vec<Radial> {
    let mut radials = Vec::new();
    for msg in messages {
        if source.vcp.is_none() {
            match msg.contents() {
                MessageContents::VolumeCoveragePattern(vcp) => {
                    source.vcp = Some(vcp.header().pattern_number());
                }
                MessageContents::DigitalRadarData(m) => {
                    if let Some(block) = m.volume_data_block() {
                        let n = block.volume_coverage_pattern_number();
                        if n > 0 {
                            source.vcp = Some(n);
                        }
                    }
                }
                _ => {}
            }
        }

        match msg.into_contents() {
            MessageContents::DigitalRadarData(m) => {
                if let Ok(radial) = m.into_radial() {
                    radials.push(radial);
                }
            }
            MessageContents::DigitalRadarDataLegacy(m) => {
                if let Ok(radial) = m.into_radial() {
                    radials.push(radial);
                }
            }
            _ => {}
        }
    }
    radials
}

fn needs_full_message_decode(source: &DecodedSource) -> bool {
    source.vcp.is_none()
}

pub fn ingest_archive_core(
    source_id: String,
    site: String,
    bytes: Vec<u8>,
) -> Result<DecodedSource, RadarError> {
    let mut source = DecodedSource::new(source_id.clone(), site);
    let file = File::new(bytes);
    let records = file.records().map_err(|e| {
        RadarError::new(
            RadarErrorCode::ArchiveHeader,
            "archive",
            &source_id,
            "could not split Archive II records",
        )
        .with_detail(e.to_string())
    })?;

    let mut skipped_decode_records = 0usize;
    let mut skipped_decompress_records = 0usize;

    for record in records.iter() {
        let radials = if record.compressed() {
            match record.decompress() {
                Ok(decompressed) => {
                    // Full message parsing is only needed long enough to extract VCP metadata.
                    // If that broader parser rejects a record, immediately retry with the
                    // narrower radial parser instead of throwing away usable radar data.
                    if needs_full_message_decode(&source) {
                        match decompressed.messages() {
                            Ok(messages) => decode_messages_with_vcp(messages, &mut source),
                            Err(_) => match decompressed.radials() {
                                Ok(radials) => radials,
                                Err(_) => {
                                    skipped_decode_records += 1;
                                    Vec::new()
                                }
                            },
                        }
                    } else {
                        match decompressed.radials() {
                            Ok(radials) => radials,
                            Err(_) => {
                                skipped_decode_records += 1;
                                Vec::new()
                            }
                        }
                    }
                }
                Err(_) => {
                    // Real public Level II objects occasionally contain a damaged record.
                    // Preserve the rest of the volume rather than failing the entire scan.
                    skipped_decompress_records += 1;
                    Vec::new()
                }
            }
        } else {
            match record.radials() {
                Ok(radials) => radials,
                Err(_) => {
                    skipped_decode_records += 1;
                    Vec::new()
                }
            }
        };

        for radial in radials {
            source.push_radial(radial);
        }
    }

    let radial_count = source.elevations.values().map(Vec::len).sum::<usize>();
    if radial_count == 0 {
        return Err(RadarError::new(
            RadarErrorCode::NoRadials,
            "archive",
            &source_id,
            "archive contained no decodable radar radials",
        )
        .with_detail(format!(
            "Archive II contained {} records. {} decompression failures and {} message/radial parse misses were skipped; no valid radial remained.",
            records.len(), skipped_decompress_records, skipped_decode_records
        )));
    }

    source.complete = true;
    Ok(source)
}

#[cfg(test)]
mod regression_tests {
    use super::needs_full_message_decode;
    use crate::source::DecodedSource;

    #[test]
    fn full_message_decode_is_only_used_until_vcp_is_known() {
        let mut source = DecodedSource::new("source".into(), "KTLX".into());
        assert!(needs_full_message_decode(&source));
        source.vcp = Some(212);
        assert!(!needs_full_message_decode(&source));
    }
}
