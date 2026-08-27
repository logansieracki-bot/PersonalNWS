use personalnws_decoder::model::ProductId;

#[test]
fn product_ids_are_stable() {
    assert_eq!(ProductId::Reflectivity as u16, 1);
    assert_eq!(ProductId::Velocity as u16, 2);
    assert_eq!(ProductId::SpectrumWidth as u16, 3);
    assert_eq!(ProductId::DifferentialReflectivity as u16, 4);
    assert_eq!(ProductId::CorrelationCoefficient as u16, 5);
    assert_eq!(ProductId::DifferentialPhase as u16, 6);
}
