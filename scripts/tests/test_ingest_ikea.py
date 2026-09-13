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


def test_plant_pot_diameter_is_not_foliage_width():
    p = record('FEJKA Artificial potted plant')
    p.update(productType='Plant', dimensionsMeters={'width':None,'height':None,'depth':None},
             measurements={'Diameter of plant pot':'21 cm','Height of plant':'180 cm'})
    p = enrich(p)
    assert p['dimensionsMeters'] == {'width':None,'height':1.8,'depth':None}
    assert not p['readyForPreview']
    assert p['placement']['mode'] == 'floor'
    p.update(productType='Plant pot', measurements={'Outside diameter':'28 cm','Inside diameter':'24 cm'})
    assert enrich(p)['dimensionsMeters']['width'] == .28


def test_desk_accessories_are_surface_objects_after_repeated_enrichment():
    p = record('Desk organiser')
    p.update(productType='Desk accessory', dimensionsMeters={'width':.2,'height':.15,'depth':.1})
    for _ in range(2):
        p = enrich(p)
        assert p['productType'] == 'Desk accessory'
        assert p['placement'] == {'mode':'surface','canSupport':False}


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


def test_wall_lamps_need_review_and_fixed_white_is_not_rgb():
    p = record('LED wall lamp')
    p['description'] = 'You never have to change a light bulb. Light colour: warm white (2700 Kelvin).'
    result = enrich(p)
    assert result['lighting']['colorMode'] == 'fixed'
    assert result['placement'] == {'mode': 'wall', 'canSupport': False}
    assert 'Wall mounting geometry needs review' in result['missingFields']
    assert enrich(record('LED wall up/downlighter'))['lighting']['mount'] == 'wall'
    assert enrich(record('LED table/wall lamp'))['lighting']['mount'] == 'surface'


def test_decoration_review_survives_repeated_enrichment():
    p = record('Wall shelving unit')
    p['productType'] = 'Wall shelf'
    p['dimensionsMeters']['height'] = .5
    for _ in range(2):
        p = enrich(p)
        assert not p['readyForPreview']
        assert 'Decoration geometry and mounting need review' in p['missingFields']


def test_reviewed_wall_mount_restores_orientation_and_published_output():
    p = record('VARMBLIXT LED wall lamp - white metal/circle')
    p['id'] = 'ikea-10531485'
    p['measurements'] = {'Luminous flux': '330 lm'}
    p = enrich(p)
    assert p['readyForPreview']
    assert p['wallMountReview']
    assert p['modelRotation'] == [0, 0, 0]
    assert p['lighting']['output']['lumens'] == 330
    assert p['dimensionsMeters']['width'] == .5
