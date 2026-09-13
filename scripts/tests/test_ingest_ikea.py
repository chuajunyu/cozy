from scripts.ingest_ikea import enrich


def record(name: str) -> dict:
    return {
        'id': 'test-product', 'name': name, 'category': 'Bedroom',
        'dimensionsMeters': {'width': 1.5, 'height': None, 'depth': 2.0},
        'measurements': {'Thickness': '24 cm'}, 'modelStatus': 'downloaded',
        'price': 399, 'currency': 'SGD', 'brand': 'IKEA', 'color': 'white',
        'productUrl': 'https://www.ikea.com/sg/en/p/test-12345678/',
        'thumbnailUrl': 'https://www.ikea.com/test.jpg',
    }


def test_mattress_thickness_and_placement() -> None:
    product = enrich(record('VALEVÅG Pocket sprung mattress - firm 150x200 cm'))
    assert product['dimensionsMeters']['height'] == .24
    assert product['dimensionSources']['height'] == 'Visible measurements: Thickness'
    assert product['productType'] == 'Mattress'
    assert product['placement']['surfaceKind'] == 'mattress'
    assert product['readyForPreview']


def test_missing_models_stay_in_review() -> None:
    product = record('Mattress')
    product['modelStatus'] = 'unavailable'
    assert not enrich(product)['readyForPreview']


def test_bundles_and_pads_are_not_standalone_mattresses() -> None:
    for name in ['Bed frame with mattress', 'Mattress pad', 'Mattress protector']:
        assert 'placement' not in enrich(record(name))


def test_fixed_led_flux_and_explicit_bulb_assumption() -> None:
    product = record('VARMBLIXT LED table/wall lamp')
    product['measurements'] = {'Luminous flux': '85 lm'}
    output = enrich(product)['lighting']['output']
    assert output == {'lumens': 85, 'evidence': 'IKEA published luminous flux.'}
    assumed = enrich(record('FADO Table lamp'))['lighting']['output']
    assert assumed['lumens'] == 470
    assert assumed['evidence'].startswith('Assumed')


def test_reviewed_bed_deck_survives_metadata_refresh() -> None:
    product = record('MALM Bed frame, high - white 150x200 cm')
    product['id'] = 'ikea-00274924'
    deck = enrich(product)['placement']['support']
    assert (deck['width'], deck['depth'], deck['height']) == (1.5, 2, .265)
    assert deck['evidence'].startswith('Assumed')
