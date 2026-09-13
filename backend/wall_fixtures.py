"""Reviewed wall lamps use a wall anchor in the shared centered room."""
from backend.design import require


def is_wall_fixture(product):
    return product.get('placement', {}).get('mode') == 'wall' and not product.get('door')


def area(slot, product, room):
    anchor = slot.wallMount
    length = room.width if anchor.wall in {'north', 'south'} else room.depth
    start = .05 + (length - product['width'] - .1) * anchor.offset
    return start, start + product['width'], anchor.height - product['height'] / 2, anchor.height + product['height'] / 2


def normalize(slot, product, room):
    require(slot.wallMount is not None, 'wall_mount', 'Wall objects need a wall anchor.')
    a, b, bottom, _ = area(slot, product, room)
    center, inset, wall = (a+b)/2, product['depth']/2, slot.wallMount.wall
    slot.x = (inset if wall == 'west' else room.width-inset if wall == 'east' else center) - room.width/2
    slot.z = (inset if wall == 'north' else room.depth-inset if wall == 'south' else room.depth-center) - room.depth/2
    slot.rotation = {'north': 0, 'west': 90, 'south': 180, 'east': 270}[wall]
    slot.elevation, slot.supportId = bottom, None


def validate(state, products):
    from backend.placement import opening, pose
    for slot in state.slots.values():
        product = products.get(slot.catalogId)
        if not product:
            continue
        if not is_wall_fixture(product):
            require(slot.wallMount is None, 'wall_mount', 'Only wall objects can use fixture anchors.')
            continue
        require(slot.wallMount is not None and not slot.door and not slot.supportId, 'wall_mount', 'Wall objects need their own wall anchor.')
        normal = slot.model_copy(deep=True)
        normalize(normal, product, state.room)
        require(pose(normal) == pose(slot), 'wall_mount', 'Object position must match its wall anchor.')
        wall = slot.wallMount.wall
        length = state.room.width if wall in {'north', 'south'} else state.room.depth
        a, b, bottom, top = area(slot, product, state.room)
        require(a >= .045 and b <= length-.045 and bottom >= .045 and top <= state.room.height-.045,
                'wall_bounds', 'Keep the whole object within the wall.')
        openings = [opening(state.room, w.wall, w.offset, w.width, w.height, w.sill) for w in state.room.windows if w.wall == wall]
        for other in state.slots.values():
            p = products.get(other.catalogId)
            if p and p.get('door') and other.door and other.door.wall == wall:
                openings.append(opening(state.room, wall, other.door.offset, p['width'], p['height']))
        for c, d, low, high in openings:
            require(a >= d+.05 or b <= c-.05 or bottom >= high+.05 or top <= low-.05,
                    'wall_opening', 'Keep wall objects clear of windows and doors.')
