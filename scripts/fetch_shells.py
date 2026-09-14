#!/usr/bin/env python3
"""Download official MaleCNS neuropil shells and decimate to web GLB."""

from __future__ import annotations

import struct
import urllib.request
from pathlib import Path

import numpy as np

URLS = {
    "cb": "https://storage.googleapis.com/flyem-male-cns/rois/fullbrain-major-shells/mesh/CB.ngmesh",
    "ol_l": "https://storage.googleapis.com/flyem-male-cns/rois/fullbrain-major-shells/mesh/OL(L).ngmesh",
    "ol_r": "https://storage.googleapis.com/flyem-male-cns/rois/fullbrain-major-shells/mesh/OL(R).ngmesh",
    "vnc": "https://storage.googleapis.com/flyem-male-cns/rois/vnc-neuropil-shell-v2/mesh/vnc-neuropil-shell.ngmesh",
}

MANIFESTS = {
    "cb": "https://storage.googleapis.com/flyem-male-cns/rois/fullbrain-major-shells/mesh/1:0",
    "ol_l": "https://storage.googleapis.com/flyem-male-cns/rois/fullbrain-major-shells/mesh/2:0",
    "ol_r": "https://storage.googleapis.com/flyem-male-cns/rois/fullbrain-major-shells/mesh/3:0",
    "vnc": "https://storage.googleapis.com/flyem-male-cns/rois/vnc-neuropil-shell-v2/mesh/1:0",
}


def read_legacy_mesh(data: bytes) -> tuple[np.ndarray, np.ndarray]:
    """Neuroglancer legacy mesh: [uint32 nv][float32 xyz * nv][uint32 tri * 3]."""
    if len(data) < 8:
        raise ValueError("mesh too small")
    nv = struct.unpack_from("<I", data, 0)[0]
    vbytes = 4 + nv * 12
    if vbytes > len(data):
        raise ValueError(f"nv={nv} overruns file ({len(data)} bytes)")
    verts = np.frombuffer(data, dtype="<f4", count=nv * 3, offset=4).reshape(nv, 3).copy()
    rest = data[vbytes:]
    if len(rest) % 12 != 0:
        raise ValueError(f"triangle payload not multiple of 12 ({len(rest)})")
    faces = np.frombuffer(rest, dtype="<u4").reshape(-1, 3).copy()
    return verts, faces


def try_concat_legacy(data: bytes) -> tuple[np.ndarray, np.ndarray]:
    """Some .ngmesh files concatenate several legacy fragments."""
    off = 0
    vs = []
    fs = []
    vbase = 0
    while off + 4 <= len(data):
        nv = struct.unpack_from("<I", data, off)[0]
        vbytes = 4 + nv * 12
        if nv == 0 or vbytes + off > len(data):
            break
        rest_avail = len(data) - (off + vbytes)
        # Guess triangle count: remaining of this fragment unknown; try single-fragment first.
        vs.append(np.frombuffer(data, dtype="<f4", count=nv * 3, offset=off + 4).reshape(nv, 3).copy())
        # If this is the only fragment, rest is faces.
        faces = np.frombuffer(data, dtype="<u4", offset=off + vbytes).reshape(-1, 3).copy()
        fs.append(faces + vbase)
        vbase += nv
        off = len(data)
    if not vs:
        raise ValueError("could not parse mesh")
    return np.vstack(vs), np.vstack(fs)


def decimate(verts: np.ndarray, faces: np.ndarray, voxel_div: int) -> tuple[np.ndarray, np.ndarray]:
    """Grid-cluster vertices of the official shell (keeps topology of real triangles)."""
    mn = verts.min(0)
    extent = verts.max(0) - mn
    voxel = float(extent.max()) / float(voxel_div)
    q = np.floor((verts - mn) / voxel).astype(np.int64)
    keys = q[:, 0] * 1_000_003 + q[:, 1] * 1_009 + q[:, 2]
    _, inv, counts = np.unique(keys, return_inverse=True, return_counts=True)
    new_v = np.zeros((counts.size, 3), dtype=np.float32)
    np.add.at(new_v, inv, verts)
    new_v /= counts[:, None].astype(np.float32)
    new_f = inv[faces]
    ok = (new_f[:, 0] != new_f[:, 1]) & (new_f[:, 1] != new_f[:, 2]) & (new_f[:, 0] != new_f[:, 2])
    new_f = new_f[ok]
    # unique undirected faces
    tri = np.sort(new_f, axis=1)
    tri = np.unique(tri, axis=0)
    used = np.unique(tri)
    remap = np.full(len(new_v), -1, dtype=np.int64)
    remap[used] = np.arange(used.size)
    return new_v[used], remap[tri].astype(np.uint32)


def write_glb(path: Path, verts: np.ndarray, faces: np.ndarray) -> None:
    """Minimal GLB (positions + indices, no extras)."""
    import json

    verts = np.ascontiguousarray(verts.astype(np.float32))
    faces = np.ascontiguousarray(faces.astype(np.uint32))
    vbin = verts.tobytes()
    ibin = faces.tobytes()
    # pad each to 4
    def pad4(b: bytes) -> bytes:
        return b + b"\x00" * ((4 - (len(b) % 4)) % 4)

    vbin_p = pad4(vbin)
    ibin_p = pad4(ibin)
    bin_chunk = vbin_p + ibin_p
    mn = verts.min(0).tolist()
    mx = verts.max(0).tolist()
    gltf = {
        "asset": {"version": "2.0", "generator": "fly-dj-shells"},
        "buffers": [{"byteLength": len(bin_chunk)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(vbin), "target": 34962},
            {"buffer": 0, "byteOffset": len(vbin_p), "byteLength": len(ibin), "target": 34963},
        ],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,
                "count": len(verts),
                "type": "VEC3",
                "min": mn,
                "max": mx,
            },
            {
                "bufferView": 1,
                "componentType": 5125,
                "count": int(faces.size),
                "type": "SCALAR",
            },
        ],
        "meshes": [
            {
                "primitives": [
                    {"attributes": {"POSITION": 0}, "indices": 1, "mode": 4}
                ]
            }
        ],
        "nodes": [{"mesh": 0, "name": path.stem}],
        "scenes": [{"nodes": [0]}],
        "scene": 0,
    }
    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    json_bytes = json_bytes + b" " * ((4 - (len(json_bytes) % 4)) % 4)
    total = 12 + 8 + len(json_bytes) + 8 + len(bin_chunk)
    header = struct.pack("<4sII", b"glTF", 2, total)
    jchunk = struct.pack("<I4s", len(json_bytes), b"JSON") + json_bytes
    bchunk = struct.pack("<I4s", len(bin_chunk), b"BIN\x00") + bin_chunk
    path.write_bytes(header + jchunk + bchunk)


def main() -> None:
    raw_dir = Path("/tmp/malecns/shells")
    out_dir = Path("/workspace/public/data/shells")
    raw_dir.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)

    for key, url in MANIFESTS.items():
        dest = raw_dir / f"{key}.manifest"
        print("GET", url)
        urllib.request.urlretrieve(url, dest)
        print(" ", dest, dest.stat().st_size, dest.read_bytes()[:80])

    voxel_div = {"cb": 96, "ol_l": 72, "ol_r": 72, "vnc": 96}
    for key, url in URLS.items():
        dest = raw_dir / f"{key}.ngmesh"
        if not dest.exists() or dest.stat().st_size < 1000:
            print("GET", url)
            urllib.request.urlretrieve(url, dest)
        data = dest.read_bytes()
        print(key, "bytes", len(data), "head", data[:16].hex())
        try:
            verts, faces = read_legacy_mesh(data)
        except Exception as e:
            print("  single-fragment fail", e)
            verts, faces = try_concat_legacy(data)
        print(f"  verts={len(verts)} faces={len(faces)} bbox={verts.min(0)} {verts.max(0)}")
        dv, df = decimate(verts, faces, voxel_div[key])
        print(f"  decimated verts={len(dv)} faces={len(df)}")
        write_glb(out_dir / f"{key}.glb", dv, df)
        print("  wrote", out_dir / f"{key}.glb", (out_dir / f"{key}.glb").stat().st_size)


if __name__ == "__main__":
    main()
