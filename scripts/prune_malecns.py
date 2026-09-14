#!/usr/bin/env python3
"""Prune official MaleCNS v1.0 weights to typed↔typed, weight≥3 CSR.

Never invents edges. Nodes = all neurons with a non-empty type annotation.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import struct
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.feather as feather

FEATHER_MD5 = "f30e9dcca25cfd021bf1e7b3d975599e"
MAGIC = b"FLYDJCSR"
VERSION = 1

# Sensory / motor pools used by the encoder (class first, then superclass).
CLASS_POOL = {
    "visual": "visual",
    "olfactory": "olfactory",
    "gustatory": "grn",
    "mechanosensory": "mechano",
    "mechanosensory_tactile": "mechano",
    "mechanosensory_proprioceptive": "mechano",
    "mechanosensory_tbc": "mechano",
    "hygrosensory": "hygro",
    "thermosensory": "thermo",
    "chemosensory": "chemo",
    "unknown_sensory": "sensory_other",
    "Kenyon_Cell": "kenyon",
    "CX": "cx",
    "ALPN": "alpn",
    "ALLN": "alln",
    "DAN": "dan",
    "MBON": "mbon",
    "ALIN": "alin",
    "ALON": "alon",
    "SEZPN": "sezpn",
    "ol_bilateral": "visual",
}

SUPER_POOL = {
    "ol_sensory": "visual",
    "ol_intrinsic": "visual",
    "visual_projection": "visual",
    "visual_centrifugal": "visual",
    "cb_sensory": "sensory_other",
    "vnc_sensory": "mechano",
    "sensory_ascending": "mechano",
    "vnc_motor": "motor",
    "cb_motor": "motor",
    "descending_neuron": "motor",
    "ascending_neuron": "ascending",
    "vnc_intrinsic": "vnc",
    "cb_intrinsic": "central",
}


def md5_file(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def parse_xyz(val) -> tuple[float, float, float] | None:
    if val is None:
        return None
    if isinstance(val, float) and np.isnan(val):
        return None
    try:
        if hasattr(val, "tolist"):
            val = val.tolist()
        if isinstance(val, (list, tuple)) and len(val) >= 3:
            x, y, z = float(val[0]), float(val[1]), float(val[2])
            if any(np.isnan(v) for v in (x, y, z)):
                return None
            return x, y, z
    except (TypeError, ValueError):
        return None
    return None


def assign_pool(cls: str | None, superclass: str | None) -> str:
    if cls and cls in CLASS_POOL:
        return CLASS_POOL[cls]
    if superclass and superclass in SUPER_POOL:
        return SUPER_POOL[superclass]
    return "other"


def main() -> None:
    src_dir = Path("/tmp/malecns")
    out_dir = Path("/workspace/public/data")
    out_dir.mkdir(parents=True, exist_ok=True)

    weights_path = src_dir / "connectome-weights-male-cns-v1.0-minconf-0.5.feather"
    ann_path = src_dir / "body-annotations-male-cns-v1.0-minconf-0.5.feather"

    digest = md5_file(weights_path)
    print(f"feather md5={digest}")
    if digest != FEATHER_MD5:
        raise SystemExit(f"MD5 mismatch: expected {FEATHER_MD5}, got {digest}")

    print("loading annotations…")
    ann = feather.read_table(ann_path)
    body = ann.column("bodyId").to_numpy()
    types = ann.column("type").to_pandas()
    typed_mask = types.notna() & types.astype(str).str.strip().ne("") & types.astype(str).ne("nan")
    typed_idx = np.flatnonzero(typed_mask.to_numpy())
    typed_bodies = body[typed_idx].astype(np.int64)
    n_nodes = int(typed_bodies.size)
    print(f"typed nodes={n_nodes}")

    body_to_idx = {int(b): i for i, b in enumerate(typed_bodies)}
    typed_set = pa.array(typed_bodies)

    print("loading + filtering weights (typed↔typed, weight≥3)…")
    wtab = feather.read_table(weights_path, memory_map=True)
    mask = pc.and_(
        pc.greater_equal(wtab["weight"], 3),
        pc.and_(
            pc.is_in(wtab["body_pre"], value_set=typed_set),
            pc.is_in(wtab["body_post"], value_set=typed_set),
        ),
    )
    filt = wtab.filter(mask)
    print(f"kept edges={filt.num_rows}")

    pre = filt.column("body_pre").to_numpy().astype(np.int64, copy=False)
    post = filt.column("body_post").to_numpy().astype(np.int64, copy=False)
    wt = filt.column("weight").to_numpy().astype(np.float32, copy=False)
    n_edges = int(pre.size)

    # Map body IDs → contiguous node indices without a Python loop.
    order_ids = np.argsort(typed_bodies, kind="mergesort")
    sorted_bodies = typed_bodies[order_ids]
    pre_i = order_ids[np.searchsorted(sorted_bodies, pre)].astype(np.uint32)
    post_i = order_ids[np.searchsorted(sorted_bodies, post)].astype(np.uint32)
    del pre, post, filt, wtab, mask, body_to_idx

    # Outgoing CSR: row = pre, col = post (spike broadcast).
    order = np.argsort(pre_i, kind="stable")
    pre_i = pre_i[order]
    post_i = post_i[order]
    wt = wt[order]

    row_ptr = np.zeros(n_nodes + 1, dtype=np.uint32)
    counts = np.bincount(pre_i, minlength=n_nodes).astype(np.uint32)
    np.cumsum(counts, out=row_ptr[1:])

    csr_path = out_dir / "weights.csr.bin.gz"
    print(f"writing {csr_path}")
    raw = bytearray()
    raw += MAGIC
    raw += struct.pack("<II", VERSION, n_nodes)
    raw += struct.pack("<Q", n_edges)
    raw += row_ptr.tobytes()
    raw += post_i.tobytes()
    raw += wt.tobytes()
    uncompressed = len(raw)
    with gzip.open(csr_path, "wb", compresslevel=6) as f:
        f.write(raw)
    gz_size = csr_path.stat().st_size
    print(f"csr uncompressed={uncompressed} gzip={gz_size}")

    # Node sidecar: positions, type, pool, superclass.
    classes = ann.column("class").to_pandas().to_numpy()
    supers = ann.column("superclass").to_pandas().to_numpy()
    sides = ann.column("somaSide").to_pandas().to_numpy()
    somas = ann.column("somaLocation").to_pandas().to_numpy()
    type_vals = types.to_numpy()

    type_names: list[str] = []
    type_index: dict[str, int] = {}
    pool_names = [
        "visual",
        "olfactory",
        "grn",
        "mechano",
        "hygro",
        "thermo",
        "chemo",
        "sensory_other",
        "kenyon",
        "cx",
        "alpn",
        "alln",
        "dan",
        "mbon",
        "alin",
        "alon",
        "sezpn",
        "motor",
        "ascending",
        "vnc",
        "central",
        "other",
    ]
    pool_index = {n: i for i, n in enumerate(pool_names)}

    pos = np.zeros((n_nodes, 3), dtype=np.float32)
    type_ids = np.zeros(n_nodes, dtype=np.uint16)
    pool_ids = np.zeros(n_nodes, dtype=np.uint8)
    has_soma = np.zeros(n_nodes, dtype=np.uint8)
    side_ids = np.zeros(n_nodes, dtype=np.uint8)  # 0 unk, 1 L, 2 R, 3 M

    side_map = {"L": 1, "R": 2, "M": 3}

    for i, src in enumerate(typed_idx):
        tname = str(type_vals[src])
        if tname not in type_index:
            type_index[tname] = len(type_names)
            type_names.append(tname)
        type_ids[i] = type_index[tname]
        cls = classes[src]
        sup = supers[src]
        cls_s = None if cls is None or (isinstance(cls, float) and np.isnan(cls)) else str(cls)
        sup_s = None if sup is None or (isinstance(sup, float) and np.isnan(sup)) else str(sup)
        pool_ids[i] = pool_index[assign_pool(cls_s, sup_s)]
        xyz = parse_xyz(somas[src])
        if xyz:
            pos[i] = xyz
            has_soma[i] = 1
        side = sides[src]
        if isinstance(side, str):
            side_ids[i] = side_map.get(side, 0)

    # Fill missing somas with type-centroid jitter so every node can be drawn.
    rng = np.random.default_rng(20260608)
    for tid in range(len(type_names)):
        sel = type_ids == tid
        known = sel & (has_soma == 1)
        missing = sel & (has_soma == 0)
        if not missing.any():
            continue
        if known.any():
            center = pos[known].mean(axis=0)
        else:
            # fallback: place by pool in a coarse CNS layout (voxel space)
            center = np.array([38000.0, 22000.0, 28000.0], dtype=np.float32)
        nmiss = int(missing.sum())
        pos[missing] = center + rng.normal(0, 400, size=(nmiss, 3)).astype(np.float32)

    nodes_path = out_dir / "nodes.bin.gz"
    with gzip.open(nodes_path, "wb", compresslevel=6) as f:
        f.write(struct.pack("<I", n_nodes))
        f.write(pos.tobytes())
        f.write(type_ids.tobytes())
        f.write(pool_ids.tobytes())
        f.write(has_soma.tobytes())
        f.write(side_ids.tobytes())
        f.write(typed_bodies.astype(np.uint64).tobytes())

    types_path = out_dir / "types.json.gz"
    with gzip.open(types_path, "wt", encoding="utf-8") as f:
        json.dump({"types": type_names, "pools": pool_names}, f)

    # Compact type centroids for pathway tubes / HUD.
    centroids = []
    for tid, name in enumerate(type_names):
        sel = type_ids == tid
        c = pos[sel].mean(axis=0)
        centroids.append(
            {
                "id": tid,
                "name": name,
                "n": int(sel.sum()),
                "pool": pool_names[int(np.bincount(pool_ids[sel]).argmax())],
                "xyz": [float(c[0]), float(c[1]), float(c[2])],
            }
        )

    # Top type→type outgoing mass among larger types (real edges only).
    type_of = type_ids
    pair_w: dict[tuple[int, int], float] = {}
    # subsample edges for type graph: every edge still real, just aggregate
    # vectorized-ish in chunks
    chunk = 1_000_000
    for s in range(0, n_edges, chunk):
        e = min(n_edges, s + chunk)
        ta = type_of[pre_i[s:e]]
        tb = type_of[post_i[s:e]]
        ww = wt[s:e]
        # skip self-type for cleaner tubes? keep them, filter later
        keys = np.stack([ta, tb], axis=1)
        # python loop on unique pairs in chunk
        uniq, inv = np.unique(keys, axis=0, return_inverse=True)
        sums = np.bincount(inv, weights=ww)
        for (a, b), sm in zip(uniq, sums):
            pair_w[(int(a), int(b))] = pair_w.get((int(a), int(b)), 0.0) + float(sm)

    top_pairs = sorted(pair_w.items(), key=lambda kv: kv[1], reverse=True)[:80]
    pathways = [
        {
            "pre": a,
            "post": b,
            "preName": type_names[a],
            "postName": type_names[b],
            "weight": w,
        }
        for (a, b), w in top_pairs
        if a != b
    ][:48]

    manifest = {
        "dataset": "MaleCNS",
        "release": "v1.0",
        "source": {
            "weights": "gs://flyem-male-cns/v1.0/connectome-data/flat-connectome/connectome-weights-male-cns-v1.0-minconf-0.5.feather",
            "annotations": "gs://flyem-male-cns/v1.0/connectome-data/flat-connectome/body-annotations-male-cns-v1.0-minconf-0.5.feather",
            "shells": [
                "gs://flyem-male-cns/rois/fullbrain-major-shells/mesh/CB.ngmesh",
                "gs://flyem-male-cns/rois/fullbrain-major-shells/mesh/OL(L).ngmesh",
                "gs://flyem-male-cns/rois/fullbrain-major-shells/mesh/OL(R).ngmesh",
                "gs://flyem-male-cns/rois/vnc-neuropil-shell-v2/mesh/vnc-neuropil-shell.ngmesh",
            ],
            "featherMd5": digest,
        },
        "prune": {
            "rule": "weight>=3 and both endpoints have a non-empty type; no invented edges",
            "minWeight": 3,
            "typedOnly": True,
        },
        "nNodes": n_nodes,
        "nEdges": n_edges,
        "nTypes": len(type_names),
        "pools": pool_names,
        "csr": {
            "file": "weights.csr.bin.gz",
            "format": "FLYDJCSR v1 outgoing CSR (row=pre)",
            "uncompressedBytes": uncompressed,
            "gzipBytes": gz_size,
        },
        "nodes": "nodes.bin.gz",
        "types": "types.json.gz",
        "pathways": pathways,
        "typeCentroids": [c for c in centroids if c["n"] >= 20][:400],
        "honesty": "CSR synapses are frozen MaleCNS v1.0 counts. Only the sensory encoder, optional pathway gains, and DJ policy head are trained. This is not biological spike data.",
    }
    man_path = out_dir / "manifest.json"
    man_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"nNodes": n_nodes, "nEdges": n_edges, "nTypes": len(type_names), "gzMB": round(gz_size / 1e6, 2)}))


if __name__ == "__main__":
    main()
