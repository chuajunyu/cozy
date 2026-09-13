"""Catalog-first nursery, bathroom and wall décor discovery."""
from scripts import expand_decor

expand_decor.GROUPS = [
    ('cots-cots-mattresses-18755', 'Nursery', 'Cot'),
    ('changing-tables-45783', 'Nursery', 'Changing table'),
    ('baby-chairs-highchairs-45782', 'Nursery', 'Highchair'),
    ('baby-toys-18716', 'Nursery', 'Baby toy'),
    ('bathroom-accessories-10555', 'Bathroom', 'Bathroom accessory'),
    ('bathroom-shelving-units-20804', 'Bathroom', 'Shelving unit'),
    ('bathroom-stools-benches-20859', 'Bathroom', 'Bathroom stool'),
    ('bathroom-vanity-cabinets-20719', 'Bathroom', 'Bathroom vanity'),
    ('mirrors-20489', 'Mirrors', 'Mirror'),
    ('noticeboards-10574', 'Boards', 'Noticeboard'),
    ('frames-10786', 'Wall art', 'Picture frame'),
    ('pictures-posters-10787', 'Wall art', 'Decoration'),
    ('curtains-10700', 'Curtains', 'Curtain'),
]

if __name__ == '__main__':
    expand_decor.main()
