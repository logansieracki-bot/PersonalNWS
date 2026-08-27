use nexrad_data::volume::{File, Record};
use nexrad::model::data::Radial;

#[test]
fn archive_file_constructor_is_available() {
    let _file = File::new(Vec::new());
}

#[test]
fn live_record_constructor_is_available() {
    let bytes = [0u8; 16];
    let _record = Record::from_slice(&bytes);
}

fn _radial_contract(radial: &Radial) {
    let _ = radial.elevation_number();
    let _ = radial.azimuth_angle_degrees();
    let _ = radial.elevation_angle_degrees();
    let _ = radial.collection_timestamp();
    let _ = radial.radial_status();
}
