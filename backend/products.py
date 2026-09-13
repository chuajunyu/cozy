"""Catalog normalization and data-only generated furniture validation."""

import json
import re
import struct
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

ROOT = Path(__file__).resolve().parents[1]
CATEGORIES = {
    "Desk": "desk", "Office chair": "chair", "Armchair": "chair",
    "Dining chair": "chair", "Bed": "bed", "Sofa": "sofa", "Bookcase": "shelf",
    "Bedside table": "side_table", "Dining table": "dining_table",
    "Wardrobe": "wardrobe", "Chest of drawers": "dresser", "Lighting": "lamp",
    "Floor lamp": "lamp",
}


class DataModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Part(DataModel):
    shape: Literal["box", "cylinder"]
    size: tuple[float, float, float]
    position: tuple[float, float, float]
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")


class Lighting(DataModel):
    mount: Literal["floor", "surface", "ceiling"]
    colorMode: Literal["fixed", "white-spectrum", "rgb", "bulb-dependent"]
    dimmable: bool
    evidence: str = Field(max_length=1000)
    emitter: tuple[float, float, float] | None = None


class GeneratedProduct(DataModel):
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,60}$")
    name: str = Field(min_length=1, max_length=100)
    category: str = Field(min_length=1, max_length=40)
    price: float = Field(ge=0, le=1_000_000)
    dimensions: tuple[float, float, float]
    parts: list[Part] = Field(min_length=1, max_length=150)
    lighting: Lighting | None = None

    @model_validator(mode="after")
    def geometry(self):
        if not self.id.startswith(('custom-', 'sample-')) and len(self.id) > 53:
            raise ValueError("Use a shorter product ID to allow its catalog prefix.")
        if any(n <= 0 or n > 10 for n in self.dimensions):
            raise ValueError("Dimensions must be positive meters, at most 10 m.")
        for part in self.parts:
            if any(n <= 0 or n > 10 for n in part.size):
                raise ValueError("Invalid part size.")
            for axis in range(3):
                low = 0 if axis == 1 else -self.dimensions[axis] / 2
                high = self.dimensions[axis] if axis == 1 else self.dimensions[axis] / 2
                if part.position[axis] - part.size[axis] / 2 < low - .03 or part.position[axis] + part.size[axis] / 2 > high + .03:
                    raise ValueError("Parts must fit declared bounds, with their base on the floor.")
        if self.lighting and self.lighting.emitter:
            x, y, z = self.lighting.emitter
            if abs(x) > self.dimensions[0] / 2 or not 0 <= y <= self.dimensions[1] or abs(z) > self.dimensions[2] / 2:
                raise ValueError("Light emitter must fit the product.")
        return self


def generated(raw: dict, prefix: str = "custom-") -> dict:
    p = GeneratedProduct.model_validate(raw).model_dump(exclude_none=True)
    p["id"] = p["id"] if p["id"].startswith(prefix) else prefix + p["id"]
    if len(p["id"]) > 60:
        raise ValueError("Use a shorter product ID.")
    w, h, d = p.pop("dimensions")
    group = p["category"]
    sample_categories = {"desk": "desk", "bed": "bed", "sofa": "sofa", "shelf": "shelf", "chair": "chair", "coffee": "coffee_table", "nightstand": "side_table", "rug": "rug"}
    category = "lamp" if p.get("lighting") else sample_categories.get(p["id"].removeprefix(prefix), p["category"])
    if category not in {*CATEGORIES.values(), "rug", "coffee_table", "plant", "side_table", "custom"}:
        category = "custom"
    return {**p, "category": category, "collection": group, "width": w, "height": h, "depth": d,
            "modelId": "parts", "color": p["parts"][0]["color"], "material": "", "style": "",
            "currency": "SGD", "illustrative": True, "floorLayer": category == "rug",
            "readyForPreview": True, "canRecommend": True}


def validate_glb(path: Path) -> dict:
    blob = path.read_bytes()
    if len(blob) < 20 or blob[:4] != b"glTF" or struct.unpack_from("<I", blob, 4)[0] != 2 or struct.unpack_from("<I", blob, 8)[0] != len(blob):
        raise ValueError("Invalid GLB header")
    length, kind = struct.unpack_from("<II", blob, 12)
    if kind != 0x4E4F534A or 20 + length > len(blob):
        raise ValueError("Invalid GLB JSON chunk")
    doc = json.loads(blob[20:20 + length])
    if any(v.get("uri") and not v["uri"].startswith("data:") for v in doc.get("buffers", []) + doc.get("images", [])):
        raise ValueError("GLB must be self-contained")
    supported = {"KHR_draco_mesh_compression", "EXT_texture_webp", "KHR_texture_transform"}
    if set(doc.get("extensionsRequired", [])) - supported:
        raise ValueError("Unsupported required GLB extension")
    return doc


def load_ikea(root: Path = ROOT) -> list[dict]:
    source = root / "data/ikea-ready.json"
    if not source.exists():
        return []
    overrides = json.loads((root / "data/ikea-categories.json").read_text())
    products = []
    for raw in json.loads(source.read_text(encoding="utf-8"))["products"]:
        p = dict(raw)
        category = overrides.get(p["id"], CATEGORIES.get(p.get("productType")))
        if not category:
            continue
        dims = p["dimensionsMeters"]
        path = p.get("modelUrl", "")
        available = False
        if re.fullmatch(r"/models/ikea/[0-9]{8}\.glb", path):
            try:
                validate_glb(root / "frontend/public" / path.lstrip("/"))
                available = True
            except (OSError, ValueError, KeyError, struct.error):
                pass
        products.append({**p, "collection": p["category"], "category": category,
                         "width": dims["width"], "height": dims["height"], "depth": dims["depth"],
                         "modelId": "glb", "parts": [], "material": ", ".join(p.get("materialsMentioned", [])),
                         "style": "", "illustrative": False, "floorLayer": False,
                         "readyForPreview": available, "canRecommend": available and p.get("canRecommend", False),
                         "assetIssue": "" if available else "Run the asset preparation command, then restart the backend."})
    return products
