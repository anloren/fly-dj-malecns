/** Official MaleCNS meshes are in nanometres; somas are 8 nm voxels. */
export const CNS = {
  cx: 385000,
  cy: 298000,
  cz: 540000,
  scale: 1 / 15500,
}

export function toScene(xNm: number, yNm: number, zNm: number): [number, number, number] {
  return [
    (xNm - CNS.cx) * CNS.scale,
    -(zNm - CNS.cz) * CNS.scale,
    (yNm - CNS.cy) * CNS.scale,
  ]
}

export const POOL_COLOR: Record<string, number> = {
  visual: 0x3ee0ff,
  olfactory: 0xff7ad9,
  grn: 0xffc14a,
  mechano: 0x7dffb0,
  hygro: 0x9ad8ff,
  thermo: 0xff6b4a,
  chemo: 0xe2ff6a,
  sensory_other: 0xb8c0ff,
  kenyon: 0xff8ad8,
  cx: 0xc9a6ff,
  alpn: 0xff9f6e,
  alln: 0x86f0c8,
  dan: 0xff5d8f,
  mbon: 0x6ad6ff,
  alin: 0xd0ff8a,
  alon: 0xffd27a,
  sezpn: 0x8ab6ff,
  motor: 0xff4d6d,
  ascending: 0x5cffc8,
  vnc: 0x4ad4ff,
  central: 0xa78bfa,
  other: 0x8b93a7,
}
