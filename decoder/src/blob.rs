use nexrad::model::data::{DataMoment, Radial};
use crate::error::{RadarError, RadarErrorCode};
use crate::model::ProductId;
use crate::source::DecodedSource;
use std::collections::HashMap;

const HEADER_SIZE: usize = 96;
const FLAG_COMPLETE: u32 = 1 << 0;
const FLAG_LIVE_PARTIAL: u32 = 1 << 1;
const FLAG_RADIAL_TIMES: u32 = 1 << 2;
const FLAG_RADIAL_ELEVATIONS: u32 = 1 << 3;
const FLAG_SORTED_AZIMUTH: u32 = 1 << 4;
const FLAG_ZERO_FILLED: u32 = 1 << 5;

fn align8(n: usize) -> usize { (n + 7) & !7 }
fn put_u16(b: &mut [u8], o: usize, v: u16) { b[o..o+2].copy_from_slice(&v.to_le_bytes()); }
fn put_u32(b: &mut [u8], o: usize, v: u32) { b[o..o+4].copy_from_slice(&v.to_le_bytes()); }
fn put_f32(b: &mut [u8], o: usize, v: f32) { b[o..o+4].copy_from_slice(&v.to_le_bytes()); }
fn put_f64(b: &mut [u8], o: usize, v: f64) { b[o..o+8].copy_from_slice(&v.to_le_bytes()); }

fn has_moment(product: ProductId, radial: &Radial) -> bool {
    let product = product.to_nexrad();
    product.moment_data(radial).is_some() || product.cfp_moment_data(radial).is_some()
}

fn moment_params(
    product: ProductId,
    radial: &Radial,
) -> Option<(f64, f64, usize, f32, f32, u8)> {
    let product = product.to_nexrad();
    if let Some(moment) = product.moment_data(radial) {
        Some((
            moment.first_gate_range_km(),
            moment.gate_interval_km(),
            moment.gate_count() as usize,
            moment.scale(),
            moment.offset(),
            moment.data_word_size(),
        ))
    } else {
        product.cfp_moment_data(radial).map(|moment| {
            (
                moment.first_gate_range_km(),
                moment.gate_interval_km(),
                moment.gate_count() as usize,
                moment.scale(),
                moment.offset(),
                moment.data_word_size(),
            )
        })
    }
}

fn moment_raw_values(product: ProductId, radial: &Radial) -> Option<&[u8]> {
    let product = product.to_nexrad();
    if let Some(moment) = product.moment_data(radial) {
        Some(moment.raw_values())
    } else if let Some(moment) = product.cfp_moment_data(radial) {
        Some(moment.raw_values())
    } else {
        None
    }
}

pub fn build_sweep_blob_core(source: &DecodedSource, elevation: u8, product: ProductId) -> Result<Vec<u8>, RadarError> {
    let source_id = &source.source_id;
    let radials = source.elevations.get(&elevation).ok_or_else(|| {
        RadarError::new(RadarErrorCode::ElevationNotFound, "blob", source_id, format!("elevation {elevation} not found"))
    })?;

    let mut target: Vec<&Radial> = radials.iter().filter(|r| has_moment(product, r)).collect();
    if target.is_empty() {
        return Err(RadarError::new(RadarErrorCode::ProductNotAvailable, "blob", source_id, format!("product {} unavailable on elevation {elevation}", product as u16)));
    }
    target.sort_by(|a,b| a.azimuth_angle_degrees().total_cmp(&b.azimuth_angle_degrees()));

    // Public Level II occasionally contains one or two anomalous radials with a
    // different gate layout. Choose the dominant geometry and discard only the
    // incompatible rows rather than rejecting the entire sweep.
    let mut geometry_counts: HashMap<(u64, u64, u32, u32, u8), usize> = HashMap::new();
    for radial in &target {
        if let Some((fg, gi, _, scale, offset, word_bits)) = moment_params(product, radial) {
            *geometry_counts.entry((fg.to_bits(), gi.to_bits(), scale.to_bits(), offset.to_bits(), word_bits)).or_default() += 1;
        }
    }
    let dominant = geometry_counts.into_iter().max_by_key(|(_, count)| *count).map(|(key, _)| key).ok_or_else(|| {
        RadarError::new(RadarErrorCode::GeometryMismatch, "blob", source_id, "no usable moment geometry in sweep")
    })?;
    target.retain(|radial| {
        moment_params(product, radial).map(|(fg, gi, _, scale, offset, word_bits)| {
            (fg.to_bits(), gi.to_bits(), scale.to_bits(), offset.to_bits(), word_bits) == dominant
        }).unwrap_or(false)
    });
    if target.is_empty() {
        return Err(RadarError::new(RadarErrorCode::GeometryMismatch, "blob", source_id, "all selected radials had incompatible moment geometry"));
    }

    let (first_gate, gate_interval, _, scale, offset, word_bits) =
        moment_params(product, target[0]).ok_or_else(|| {
            RadarError::new(
                RadarErrorCode::ProductNotAvailable,
                "blob",
                source_id,
                "first radial has no selected moment",
            )
        })?;
    if word_bits != 8 && word_bits != 16 {
        return Err(RadarError::new(RadarErrorCode::BlobBuild, "blob", source_id, format!("unsupported data word size {word_bits}")));
    }

    let mut gate_count = 0usize;
    for radial in &target {
        let (_, _, radial_gate_count, _, _, _) =
            moment_params(product, radial).expect("target radials were filtered for dominant geometry");
        gate_count = gate_count.max(radial_gate_count);
    }

    let radial_count = target.len();
    let azimuth_offset = HEADER_SIZE;
    let radial_time_offset = align8(azimuth_offset + radial_count * 4);
    let radial_elevation_offset = radial_time_offset + radial_count * 8;
    let gate_data_offset = align8(radial_elevation_offset + radial_count * 4);
    let bytes_per_gate = if word_bits == 16 { 2 } else { 1 };
    let gate_bytes = radial_count.checked_mul(gate_count).and_then(|v| v.checked_mul(bytes_per_gate)).ok_or_else(|| RadarError::new(RadarErrorCode::BlobBuild, "blob", source_id, "sweep size overflow"))?;
    let total = gate_data_offset + gate_bytes;
    let mut out = vec![0u8; total];

    out[0..4].copy_from_slice(b"PSWP");
    put_u16(&mut out, 4, 1);
    put_u16(&mut out, 6, HEADER_SIZE as u16);
    put_u16(&mut out, 8, product as u16);
    out[10] = elevation;
    out[11] = bytes_per_gate as u8;
    let mut flags = FLAG_RADIAL_TIMES | FLAG_RADIAL_ELEVATIONS | FLAG_SORTED_AZIMUTH | FLAG_ZERO_FILLED;
    if source.complete { flags |= FLAG_COMPLETE; } else { flags |= FLAG_LIVE_PARTIAL; }
    put_u32(&mut out, 12, flags);
    put_u32(&mut out, 16, radial_count as u32);
    put_u32(&mut out, 20, gate_count as u32);
    put_f64(&mut out, 24, first_gate);
    put_f64(&mut out, 32, gate_interval);
    put_f64(&mut out, 40, first_gate + gate_count as f64 * gate_interval);
    put_f32(&mut out, 48, scale);
    put_f32(&mut out, 52, offset);

    let mut elev_sum = 0.0f64;
    let mut start = f64::INFINITY;
    let mut end = f64::NEG_INFINITY;
    for (row, radial) in target.iter().enumerate() {
        let az = radial.azimuth_angle_degrees();
        let elev = radial.elevation_angle_degrees();
        let ts = radial.collection_timestamp() as f64;
        put_f32(&mut out, azimuth_offset + row*4, az);
        put_f64(&mut out, radial_time_offset + row*8, ts);
        put_f32(&mut out, radial_elevation_offset + row*4, elev);
        elev_sum += elev as f64;
        start = start.min(ts); end = end.max(ts);

        let raw = moment_raw_values(product, radial)
            .expect("target radials were filtered for product availability");
        if word_bits == 16 {
            let n = (raw.len()/2).min(gate_count);
            for i in 0..n {
                let v = u16::from_be_bytes([raw[i*2], raw[i*2+1]]);
                let pos = gate_data_offset + (row*gate_count+i)*2;
                out[pos..pos+2].copy_from_slice(&v.to_le_bytes());
            }
        } else {
            let n = raw.len().min(gate_count);
            let dest = gate_data_offset + row*gate_count;
            out[dest..dest+n].copy_from_slice(&raw[..n]);
        }
    }
    put_f32(&mut out, 56, (elev_sum/radial_count as f64) as f32);
    let nominal = if radial_count > 1 { 360.0 / radial_count as f32 } else { 0.0 };
    put_f32(&mut out, 60, nominal);
    put_f64(&mut out, 64, start);
    put_f64(&mut out, 72, end);
    put_u32(&mut out, 80, azimuth_offset as u32);
    put_u32(&mut out, 84, radial_time_offset as u32);
    put_u32(&mut out, 88, radial_elevation_offset as u32);
    put_u32(&mut out, 92, gate_data_offset as u32);
    Ok(out)
}


#[cfg(test)]
mod regression_tests {
    use super::*;
    use nexrad::model::data::{MomentData, RadialStatus};

    fn reflectivity_radial_with_geometry(raw: Vec<u8>, first_gate_m: u16, gate_interval_m: u16) -> Radial {
        let gate_count = raw.len() as u16;
        let moment = MomentData::from_fixed_point(
            gate_count,
            first_gate_m,
            gate_interval_m,
            8,
            2.0,
            66.0,
            raw,
        );
        Radial::new(
            1_700_000_000_000,
            1,
            10.0,
            0.5,
            RadialStatus::ElevationStart,
            1,
            0.5,
            Some(moment),
            None,
            None,
            None,
            None,
            None,
            None,
        )
    }

    fn reflectivity_radial(raw: Vec<u8>) -> Radial {
        reflectivity_radial_with_geometry(raw, 2000, 250)
    }

    #[test]
    fn regression_reflectivity_blob_preserves_raw_u8_gates() {
        let mut source = DecodedSource::new("KTLX|test".into(), "KTLX".into());
        source.complete = true;
        source.push_radial(reflectivity_radial(vec![0, 1, 10, 100]));

        let blob = build_sweep_blob_core(&source, 1, ProductId::Reflectivity)
            .expect("reflectivity blob should serialize");

        assert_eq!(&blob[0..4], b"PSWP");
        assert_eq!(u16::from_le_bytes([blob[8], blob[9]]), 1);
        assert_eq!(blob[10], 1);
        assert_eq!(blob[11], 1);

        let gate_offset = u32::from_le_bytes(blob[92..96].try_into().unwrap()) as usize;
        assert_eq!(&blob[gate_offset..gate_offset + 4], &[0, 1, 10, 100]);
    }
    #[test]
    fn one_geometry_outlier_does_not_kill_the_entire_sweep() {
        let mut source = DecodedSource::new("KTLX|geometry".into(), "KTLX".into());
        source.complete = true;
        source.push_radial(reflectivity_radial_with_geometry(vec![1, 2, 3], 2000, 250));
        source.push_radial(reflectivity_radial_with_geometry(vec![4, 5, 6], 2000, 250));
        source.push_radial(reflectivity_radial_with_geometry(vec![7, 8, 9], 3000, 1000));

        let blob = build_sweep_blob_core(&source, 1, ProductId::Reflectivity)
            .expect("dominant geometry should survive one outlier");
        let radial_count = u32::from_le_bytes(blob[16..20].try_into().unwrap());
        assert_eq!(radial_count, 2);
    }

}
