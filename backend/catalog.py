"""Curated demo furniture. Prices are illustrative SGD, not live retail quotes."""

from typing import Any


def product(id: str, name: str, category: str, size: tuple[float, float, float],
            price: int, color: str, material: str, style: str) -> dict[str, Any]:
    return {"id": id, "name": name, "category": category, "modelId": category,
            "width": size[0], "depth": size[1], "height": size[2],
            "price": price, "currency": "SGD", "color": color,
            "material": material, "style": style, "illustrative": True,
            "floorLayer": category == "rug"}


CATALOG = [
    product("sofa-sage", "Sage two-seat sofa", "sofa", (1.8, .85, .8), 480, "#879881", "linen", "warm minimal"),
    product("sofa-sand", "Sand compact sofa", "sofa", (1.6, .8, .78), 360, "#c9bca5", "cotton", "Scandinavian"),
    product("sofa-terra", "Terracotta sofa", "sofa", (1.9, .85, .8), 540, "#b6785f", "velvet", "mid-century"),
    product("rug-oat", "Oat woven rug", "rug", (2.2, 1.6, .025), 120, "#d7c8ad", "wool blend", "warm minimal"),
    product("rug-olive", "Olive flatweave rug", "rug", (2, 1.5, .025), 85, "#a1a27f", "cotton", "Scandinavian"),
    product("rug-rust", "Rust geometric rug", "rug", (2.2, 1.6, .025), 140, "#b98468", "wool blend", "mid-century"),
    product("table-oak", "Oak coffee table", "coffee_table", (.9, .5, .4), 95, "#b8976f", "oak", "warm minimal"),
    product("table-walnut", "Walnut coffee table", "coffee_table", (.8, .5, .4), 150, "#79604a", "walnut", "mid-century"),
    product("table-cream", "Cream compact table", "coffee_table", (.65, .45, .4), 65, "#e1d9c7", "painted wood", "Scandinavian"),
    product("bed-oak", "Oak double bed", "bed", (1.4, 2, .65), 390, "#ba9e7c", "oak", "warm minimal"),
    product("bed-sand", "Sand upholstered bed", "bed", (1.5, 2.05, .65), 490, "#d0c4b1", "linen", "Scandinavian"),
    product("bed-single", "Compact single bed", "bed", (.95, 2, .65), 240, "#b4a085", "pine", "warm minimal"),
    product("desk-oak", "Oak workspace desk", "desk", (1.1, .55, .75), 130, "#b79b77", "oak", "warm minimal"),
    product("desk-white", "White compact desk", "desk", (.9, .5, .75), 85, "#dddcd1", "painted wood", "Scandinavian"),
    product("desk-walnut", "Walnut writing desk", "desk", (1.2, .55, .75), 190, "#82644b", "walnut", "mid-century"),
    product("chair-sage", "Sage desk chair", "chair", (.48, .5, .85), 80, "#8b9b80", "fabric", "warm minimal"),
    product("chair-oak", "Oak desk chair", "chair", (.45, .48, .82), 60, "#bea47c", "oak", "Scandinavian"),
    product("chair-rust", "Rust lounge chair", "chair", (.65, .65, .85), 150, "#ad795f", "fabric", "mid-century"),
    product("lamp-cream", "Cream floor lamp", "lamp", (.35, .35, 1.5), 65, "#dfd5ba", "linen and steel", "warm minimal"),
    product("lamp-brass", "Brass floor lamp", "lamp", (.3, .3, 1.55), 95, "#b19763", "brass", "mid-century"),
    product("shelf-oak", "Low oak bookshelf", "shelf", (.8, .3, 1.1), 110, "#bda07b", "oak", "warm minimal"),
    product("shelf-white", "White narrow bookshelf", "shelf", (.6, .3, 1.2), 75, "#dadbd1", "painted wood", "Scandinavian"),
    product("side-oak", "Oak bedside table", "side_table", (.4, .35, .5), 55, "#b99b72", "oak", "warm minimal"),
    product("side-walnut", "Walnut bedside table", "side_table", (.35, .35, .5), 70, "#81654f", "walnut", "mid-century"),
    product("plant-olive", "Olive plant in clay pot", "plant", (.35, .35, .95), 35, "#718260", "terracotta", "natural"),
    product("plant-fern", "Fern in sand pot", "plant", (.3, .3, .7), 25, "#84916a", "ceramic", "natural"),
]
BY_ID = {item["id"]: item for item in CATALOG}


def search(category: str | None = None, max_price: float | None = None,
           max_width: float | None = None, query: str = "") -> list[dict[str, Any]]:
    matches = [p for p in CATALOG if (not category or p["category"] == category)
               and (max_price is None or p["price"] <= max_price)
               and (max_width is None or p["width"] <= max_width)]
    words = query.lower().split()
    return sorted(matches, key=lambda p: -sum(word in str(p).lower() for word in words))
