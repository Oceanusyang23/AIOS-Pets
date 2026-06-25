import fs from 'node:fs'
import path from 'node:path'

const file = process.argv[2] ?? 'public/models/atlas-rigged-parts-v3.glb'
const glbPath = path.resolve(process.cwd(), file)
const problemBones = new Set(['LeftEye', 'RightEye', 'Jaw', 'LeftEye_end', 'RightEye_end', 'Jaw_end'])
const requiredBones = [
  'Hips', 'Spine', 'Chest', 'UpperChest', 'Neck', 'Head',
  'LeftEye', 'RightEye', 'Jaw',
  'LeftUpperArm', 'LeftLowerArm', 'LeftHand',
  'RightUpperArm', 'RightLowerArm', 'RightHand',
  'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot',
  'RightUpperLeg', 'RightLowerLeg', 'RightFoot',
]
const requiredMeshes = [
  'Ata_Body_Skinned',
  'Ata_EyePatch_L',
  'Ata_EyePatch_R',
  'Ata_MuzzlePatch',
  'Ata_CheekPatch',
]

const componentSize = new Map([
  [5120, 1], // BYTE
  [5121, 1], // UNSIGNED_BYTE
  [5122, 2], // SHORT
  [5123, 2], // UNSIGNED_SHORT
  [5125, 4], // UNSIGNED_INT
  [5126, 4], // FLOAT
])

const typeSize = new Map([
  ['SCALAR', 1],
  ['VEC2', 2],
  ['VEC3', 3],
  ['VEC4', 4],
  ['MAT2', 4],
  ['MAT3', 9],
  ['MAT4', 16],
])

function fail(message) {
  console.error(`ata-rig-qa failed: ${message}`)
  process.exit(1)
}

function readGlb(targetPath) {
  if (!fs.existsSync(targetPath)) fail(`file not found: ${targetPath}`)
  const buffer = fs.readFileSync(targetPath)
  if (buffer.toString('utf8', 0, 4) !== 'glTF') fail('not a GLB file')
  const version = buffer.readUInt32LE(4)
  if (version !== 2) fail(`unsupported GLB version: ${version}`)
  const length = buffer.readUInt32LE(8)
  let offset = 12
  let json = null
  let bin = null
  while (offset < length) {
    const chunkLength = buffer.readUInt32LE(offset)
    const chunkType = buffer.readUInt32LE(offset + 4)
    const chunk = buffer.subarray(offset + 8, offset + 8 + chunkLength)
    if (chunkType === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'))
    if (chunkType === 0x004e4942) bin = chunk
    offset += 8 + chunkLength
  }
  if (!json || !bin) fail('missing JSON or BIN chunk')
  return { json, bin }
}

function readComponent(buffer, byteOffset, componentType) {
  switch (componentType) {
    case 5120: return buffer.readInt8(byteOffset)
    case 5121: return buffer.readUInt8(byteOffset)
    case 5122: return buffer.readInt16LE(byteOffset)
    case 5123: return buffer.readUInt16LE(byteOffset)
    case 5125: return buffer.readUInt32LE(byteOffset)
    case 5126: return buffer.readFloatLE(byteOffset)
    default: fail(`unsupported accessor component type: ${componentType}`)
  }
}

function accessorReader(json, bin, accessorIndex) {
  const accessor = json.accessors?.[accessorIndex]
  if (!accessor) fail(`missing accessor ${accessorIndex}`)
  const bufferView = json.bufferViews?.[accessor.bufferView]
  if (!bufferView) fail(`missing bufferView ${accessor.bufferView}`)
  const components = typeSize.get(accessor.type)
  const bytes = componentSize.get(accessor.componentType)
  if (!components || !bytes) fail(`unsupported accessor format: ${accessor.type}/${accessor.componentType}`)
  const baseOffset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  const stride = bufferView.byteStride ?? components * bytes
  return {
    accessor,
    components,
    read(vertexIndex, componentIndex) {
      return readComponent(bin, baseOffset + vertexIndex * stride + componentIndex * bytes, accessor.componentType)
    },
  }
}

function main() {
  const { json, bin } = readGlb(glbPath)
  const meshes = json.meshes ?? []
  const skins = json.skins ?? []
  const nodes = json.nodes ?? []
  if (meshes.length < requiredMeshes.length) fail(`expected at least ${requiredMeshes.length} runtime meshes, got ${meshes.length}`)
  if (skins.length !== 1) fail(`expected exactly 1 skin, got ${skins.length}`)
  const meshNodeNames = nodes.filter(node => node.mesh !== undefined).map(node => node.name)
  const missingMeshes = requiredMeshes.filter(name => !meshNodeNames.includes(name))
  if (missingMeshes.length) fail(`missing facial part meshes: ${missingMeshes.join(', ')}`)

  const boneNames = new Set(nodes.map(node => node.name).filter(Boolean))
  const missingBones = requiredBones.filter(name => !boneNames.has(name))
  if (missingBones.length) fail(`missing required bones: ${missingBones.join(', ')}`)

  const skin = skins[0]
  const jointNames = skin.joints.map(nodeIndex => nodes[nodeIndex]?.name ?? `node_${nodeIndex}`)
  const aggregateDominant = new Map(jointNames.map(name => [name, 0]))
  let totalVertices = 0
  let totalZeroWeightVertices = 0
  const meshReports = []

  for (const node of nodes.filter(item => item.mesh !== undefined)) {
    const mesh = meshes[node.mesh]
    const primitive = mesh?.primitives?.[0]
    if (!primitive) fail(`missing primitive for mesh node ${node.name}`)
    const jointsAccessorIndex = primitive.attributes?.JOINTS_0
    const weightsAccessorIndex = primitive.attributes?.WEIGHTS_0
    if (jointsAccessorIndex === undefined || weightsAccessorIndex === undefined) {
      fail(`missing JOINTS_0 / WEIGHTS_0 on ${node.name}`)
    }
    const joints = accessorReader(json, bin, jointsAccessorIndex)
    const weights = accessorReader(json, bin, weightsAccessorIndex)
    if (joints.accessor.count !== weights.accessor.count) fail(`joint/weight vertex counts differ on ${node.name}`)

    const dominant = new Map(jointNames.map(name => [name, 0]))
    let zeroWeightVertices = 0
    for (let vertex = 0; vertex < joints.accessor.count; vertex += 1) {
      let bestJoint = -1
      let bestWeight = 0
      let total = 0
      for (let component = 0; component < 4; component += 1) {
        const joint = joints.read(vertex, component)
        const weight = weights.read(vertex, component)
        total += weight
        if (weight > bestWeight) {
          bestWeight = weight
          bestJoint = joint
        }
      }
      if (total <= 1e-5 || bestJoint < 0) {
        zeroWeightVertices += 1
        continue
      }
      const name = jointNames[bestJoint] ?? `joint_${bestJoint}`
      dominant.set(name, (dominant.get(name) ?? 0) + 1)
      aggregateDominant.set(name, (aggregateDominant.get(name) ?? 0) + 1)
    }

    const morphTargetCount = primitive.targets?.length ?? 0
    if (morphTargetCount < 7) fail(`expected at least 7 facial morph channels on ${node.name}, got ${morphTargetCount}`)
    if (zeroWeightVertices > 0) fail(`${node.name} has ${zeroWeightVertices} zero-weight vertices`)
    totalVertices += joints.accessor.count
    totalZeroWeightVertices += zeroWeightVertices
    meshReports.push({
      name: node.name,
      vertexCount: joints.accessor.count,
      morphTargetCount,
      zeroWeightVertices,
      problemDominant: Object.fromEntries([...problemBones].map(name => [name, dominant.get(name) ?? 0])),
    })
  }

  const problemDominant = [...problemBones]
    .map(name => [name, aggregateDominant.get(name) ?? 0])
    .filter(([, count]) => count > 0)
  if (problemDominant.length) {
    fail(`facial control bones still dominate vertices: ${problemDominant.map(([name, count]) => `${name}=${count}`).join(', ')}`)
  }

  const topDominant = [...aggregateDominant.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)

  console.log(JSON.stringify({
    file,
    meshCount: meshes.length,
    requiredMeshes,
    skinCount: skins.length,
    vertexCount: totalVertices,
    zeroWeightVertices: totalZeroWeightVertices,
    topDominant,
    problemDominant: Object.fromEntries([...problemBones].map(name => [name, aggregateDominant.get(name) ?? 0])),
    meshes: meshReports,
  }, null, 2))
}

main()
