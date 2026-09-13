"""Restore recorded IKEA assets without refreshing product metadata.

Run from the repository root: python -m scripts.prepare_assets
"""

import concurrent.futures
import json
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlparse

from backend.products import ROOT, validate_glb


def download(product: dict) -> tuple[str, str]:
    dest = ROOT / "frontend/public" / product["modelUrl"].lstrip("/")
    try:
        validate_glb(dest)
        return product["id"], "cached"
    except (OSError, ValueError):
        pass
    url = product["modelSourceUrl"]
    parsed = urlparse(url)
    if parsed.scheme != "https" or not (parsed.hostname or "").endswith(".ikea.com"):
        return product["id"], "invalid source"
    dest.parent.mkdir(parents=True, exist_ok=True)
    temp = dest.with_suffix(".tmp")
    try:
        subprocess.run(["curl.exe" if shutil.which("curl.exe") else "curl", "--fail", "--silent", "--show-error",
                        "--location", "--proto", "=https", "--proto-redir", "=https", "--max-time", "60",
                        "--max-filesize", "25000000", "--output", str(temp), url], check=True, capture_output=True)
        validate_glb(temp)
        temp.replace(dest)
        return product["id"], "downloaded"
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        temp.unlink(missing_ok=True)
        return product["id"], f"unavailable ({type(exc).__name__})"


def main() -> None:
    source = ROOT / "frontend/node_modules/three/examples/jsm/libs/draco/gltf"
    target = ROOT / "frontend/public/draco"
    target.mkdir(parents=True, exist_ok=True)
    for name in ("draco_decoder.js", "draco_decoder.wasm", "draco_wasm_wrapper.js"):
        shutil.copyfile(source / name, target / name)
    products = json.loads((ROOT / "data/ikea-ready.json").read_text(encoding="utf-8"))["products"]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(download, products))
    failed = [(id, status) for id, status in results if status not in {"cached", "downloaded"}]
    print(f"Prepared {len(results) - len(failed)}/{len(results)} IKEA assets and local Draco decoders.", flush=True)
    for id, status in failed:
        print(id, status, flush=True)
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
