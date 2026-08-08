import { randomUUID } from "node:crypto";

export type MeshPoint3 = [number, number, number];

/** The Source 2 half-edge arrays consumed by CDmePolygonMesh. */
export interface MapMeshData {
  vertices: string[];
  vertexEdgeIndices: number[];
  vertexDataIndices: number[];
  edgeVertexIndices: number[];
  edgeOppositeIndices: number[];
  edgeNextIndices: number[];
  edgeFaceIndices: number[];
  edgeDataIndices: number[];
  edgeVertexDataIndices: number[];
  faceEdgeIndices: number[];
  faceDataIndices: number[];
  normals: string[];
  tangents: string[];
  textureAxisU: string[];
  textureAxisV: string[];
}

export function numberText(value: number): string {
  return String(Math.abs(value) < 1e-9 ? 0 : Number(value.toFixed(6)));
}

export function vectorText(vector: readonly number[]): string {
  return vector.map(numberText).join(" ");
}

function escaped(value: string | number): string {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function arrayValues(values: readonly (string | number)[], indent: string): string {
  return values.map((value) => `${indent}"${escaped(value)}"`).join(",\n");
}

function subtract(a: MeshPoint3, b: MeshPoint3): MeshPoint3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: MeshPoint3, b: MeshPoint3): MeshPoint3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalized(vector: readonly number[], label: string): MeshPoint3 {
  const length = Math.hypot(...vector);
  if (length <= 1e-8) throw new Error(`${label} is degenerate.`);
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function faceNormal(vertices: readonly MeshPoint3[], face: readonly number[], faceIndex: number): MeshPoint3 {
  const origin = vertices[face[0]];
  for (let index = 1; index < face.length - 1; index++) {
    const normal = cross(
      subtract(vertices[face[index]], origin),
      subtract(vertices[face[index + 1]], origin),
    );
    if (Math.hypot(...normal) <= 1e-8) continue;
    const unit = normalized(normal, `face ${faceIndex}`);
    const scale = Math.max(1, ...vertices.map((vertex) => Math.hypot(...vertex)));
    const tolerance = 1e-6 * scale;
    for (const vertexIndex of face) {
      const delta = subtract(vertices[vertexIndex], origin);
      const distance = Math.abs(
        unit[0] * delta[0] + unit[1] * delta[1] + unit[2] * delta[2],
      );
      if (distance > tolerance) throw new Error(`face ${faceIndex} is not planar.`);
    }
    return unit;
  }
  throw new Error(`face ${faceIndex} is degenerate.`);
}

/**
 * Build checked Source 2 half-edge topology from outward-wound, closed faces.
 * Every edge must be used exactly twice in opposite directions. Open, folded,
 * or non-manifold input is rejected before VMAP serialization.
 */
export function buildClosedHalfEdgeMesh(
  vertices: readonly MeshPoint3[],
  faces: readonly (readonly number[])[],
): MapMeshData {
  if (vertices.length < 4) throw new Error("A closed mesh needs at least four vertices.");
  if (!faces.length) throw new Error("A closed mesh needs at least one face.");
  vertices.forEach((vertex, index) => {
    if (vertex.length !== 3 || vertex.some((coordinate) => !Number.isFinite(coordinate))) {
      throw new Error(`vertex ${index} must contain three finite coordinates.`);
    }
    if (vertex.some((coordinate) => Math.abs(coordinate) > 32768)) {
      throw new Error(`vertex ${index} must stay within +/-32768 local world units.`);
    }
  });

  const starts: number[] = [];
  const ends: number[] = [];
  const edgeNextIndices: number[] = [];
  const edgeFaceIndices: number[] = [];
  const faceEdgeIndices: number[] = [];
  const directed = new Map<string, number>();
  const undirected = new Map<string, number[]>();
  const faceNormals: MeshPoint3[] = [];
  const faceTangents: [number, number, number, number][] = [];

  faces.forEach((face, faceIndex) => {
    if (face.length < 3) throw new Error(`face ${faceIndex} must contain at least three vertices.`);
    if (new Set(face).size !== face.length) throw new Error(`face ${faceIndex} repeats a vertex.`);
    face.forEach((vertex) => {
      if (!Number.isInteger(vertex) || vertex < 0 || vertex >= vertices.length) {
        throw new Error(`face ${faceIndex} references invalid vertex ${vertex}.`);
      }
    });
    const normal = faceNormal(vertices, face, faceIndex);
    const tangent = normalized(
      subtract(vertices[face[1]], vertices[face[0]]),
      `face ${faceIndex} first edge`,
    );
    faceNormals.push(normal);
    faceTangents.push([...tangent, -1]);

    const faceEdges: number[] = [];
    for (let index = 0; index < face.length; index++) {
      const start = face[index];
      const end = face[(index + 1) % face.length];
      if (start === end) throw new Error(`face ${faceIndex} contains a zero-length edge.`);
      const key = `${start}:${end}`;
      if (directed.has(key)) throw new Error(`directed edge ${key} is used by more than one face.`);
      const edgeIndex = starts.length;
      starts.push(start);
      ends.push(end);
      edgeFaceIndices.push(faceIndex);
      directed.set(key, edgeIndex);
      const undirectedKey = start < end ? `${start}:${end}` : `${end}:${start}`;
      const uses = undirected.get(undirectedKey) ?? [];
      uses.push(edgeIndex);
      undirected.set(undirectedKey, uses);
      faceEdges.push(edgeIndex);
    }
    faceEdges.forEach((edge, index) => {
      edgeNextIndices[edge] = faceEdges[(index + 1) % faceEdges.length];
    });
    faceEdgeIndices.push(faceEdges[0]);
  });

  const edgeOppositeIndices = new Array(starts.length).fill(-1);
  const edgeDataIndices = new Array(starts.length).fill(-1);
  let undirectedIndex = 0;
  for (const [key, uses] of undirected) {
    if (uses.length !== 2) throw new Error(`edge ${key} is open or non-manifold (${uses.length} uses).`);
    const [first, second] = uses;
    if (starts[first] !== ends[second] || ends[first] !== starts[second]) {
      throw new Error(`edge ${key} is not used in opposite directions.`);
    }
    edgeOppositeIndices[first] = second;
    edgeOppositeIndices[second] = first;
    edgeDataIndices[first] = undirectedIndex;
    edgeDataIndices[second] = undirectedIndex;
    undirectedIndex++;
  }
  const vertexEdgeIndices = vertices.map((_vertex, vertex) => {
    const edge = starts.findIndex((start) => start === vertex);
    if (edge < 0) throw new Error(`vertex ${vertex} is not used by any face.`);
    return edge;
  });
  const normals = edgeFaceIndices.map((face) => vectorText(faceNormals[face]));
  const tangents = edgeFaceIndices.map((face) => vectorText(faceTangents[face]));
  const textureAxisU = faceTangents.map(([x, y, z]) => vectorText([x, y, z, 32]));
  const textureAxisV = faceTangents.map(([tx, ty, tz], face) => {
    const axis = normalized(cross([tx, ty, tz], faceNormals[face]), `face ${face} texture axis`);
    return vectorText([...axis, 32]);
  });
  return {
    vertices: vertices.map(vectorText),
    vertexEdgeIndices,
    vertexDataIndices: vertices.map((_vertex, index) => index),
    edgeVertexIndices: ends,
    edgeOppositeIndices,
    edgeNextIndices,
    edgeFaceIndices,
    edgeDataIndices,
    edgeVertexDataIndices: starts.map((_start, index) => index),
    faceEdgeIndices,
    faceDataIndices: faces.map((_face, index) => index),
    normals,
    tangents,
    textureAxisU,
    textureAxisV,
  };
}

function dataStream(
  name: string,
  standardName: string,
  type: string,
  values: readonly (string | number)[],
  dataStateFlags: number,
): string {
  return `"CDmePolygonMeshDataStream"
{
\t"id" "elementid" "${randomUUID()}"
\t"name" "string" "${name}:0"
\t"standardAttributeName" "string" "${standardName}"
\t"semanticName" "string" "${standardName}"
\t"semanticIndex" "int" "0"
\t"vertexBufferLocation" "int" "0"
\t"dataStateFlags" "int" "${dataStateFlags}"
\t"subdivisionBinding" "element" ""
\t"data" "${type}_array"
\t[
${arrayValues(values, "\t\t")}
\t]
}`;
}

function dataArray(size: number, streams: readonly string[]): string {
  return `"CDmePolygonMeshDataArray"
{
\t"id" "elementid" "${randomUUID()}"
\t"size" "int" "${size}"
\t"streams" "element_array"
\t[
${streams.map((stream) => stream.split("\n").map((line) => `\t\t${line}`).join("\n")).join(",\n")}
\t]
}`;
}

export interface MapMeshNodeOptions {
  nodeId: number;
  origin: [number, number, number];
  yaw?: number;
  material?: string;
  materials?: readonly string[];
  faceMaterialIndices?: readonly number[];
  /** One non-zero U/V projection scale for every face. Negative values mirror the texture. */
  faceTextureScales?: readonly (readonly [number, number])[];
  physicsType?: "default" | "none";
}

/** Serialize checked half-edge data as a Valve-compatible CMapMesh node. */
export function buildMapMeshNode(mesh: MapMeshData, options: MapMeshNodeOptions): string {
  if (options.material !== undefined && options.materials !== undefined) {
    throw new Error("Supply material or materials, not both.");
  }
  const materials = options.materials ?? (options.material !== undefined ? [options.material] : []);
  if (!materials.length || materials.some((material) => !material)) {
    throw new Error("A map mesh needs at least one non-empty material.");
  }
  if (new Set(materials).size !== materials.length) {
    throw new Error("Map mesh materials must be unique.");
  }
  const origin = vectorText(options.origin);
  const yaw = numberText(((options.yaw ?? 0) % 360 + 360) % 360);
  const vertexData = dataArray(mesh.vertices.length, [
    dataStream("position", "position", "vector3", mesh.vertices, 3),
  ]);
  const faceVertexData = dataArray(mesh.edgeVertexIndices.length, [
    dataStream("texcoord", "texcoord", "vector2", Array(mesh.edgeVertexIndices.length).fill("0 0"), 1),
    dataStream("normal", "normal", "vector3", mesh.normals, 1),
    dataStream("tangent", "tangent", "vector4", mesh.tangents, 1),
  ]);
  const edgeCount = new Set(mesh.edgeDataIndices).size;
  const faceCount = mesh.faceEdgeIndices.length;
  const faceMaterialIndices = options.faceMaterialIndices ?? Array(faceCount).fill(0);
  if (
    faceMaterialIndices.length !== faceCount ||
    faceMaterialIndices.some((index) =>
      !Number.isInteger(index) || index < 0 || index >= materials.length)
  ) {
    throw new Error("faceMaterialIndices must contain one valid material index for every mesh face.");
  }
  const faceTextureScales = options.faceTextureScales ?? Array.from(
    { length: faceCount },
    () => [1, 1] as const,
  );
  if (
    faceTextureScales.length !== faceCount ||
    faceTextureScales.some((scale) =>
      scale.length !== 2 || scale.some((value) =>
        !Number.isFinite(value) || Math.abs(value) < 1e-6 || Math.abs(value) > 4096))
  ) {
    throw new Error(
      "faceTextureScales must contain one finite, non-zero U/V pair within +/-4096 for every mesh face.",
    );
  }
  const edgeData = dataArray(edgeCount, [dataStream("flags", "flags", "int", Array(edgeCount).fill(0), 3)]);
  const faceData = dataArray(faceCount, [
    dataStream("textureScale", "textureScale", "vector2", faceTextureScales.map(vectorText), 0),
    dataStream("textureAxisU", "textureAxisU", "vector4", mesh.textureAxisU, 0),
    dataStream("textureAxisV", "textureAxisV", "vector4", mesh.textureAxisV, 0),
    dataStream("materialindex", "materialindex", "int", faceMaterialIndices, 8),
    dataStream("flags", "flags", "int", Array(faceCount).fill(0), 3),
  ]);
  return `"CMapMesh"
{
\t"id" "elementid" "${randomUUID()}"
\t"origin" "vector3" "${origin}"
\t"angles" "qangle" "0 ${yaw} 0"
\t"scales" "vector3" "1 1 1"
\t"nodeID" "int" "${options.nodeId}"
\t"children" "element_array" [ ]
\t"editorOnly" "bool" "0"
\t"force_hidden" "bool" "0"
\t"variableTargetKeys" "string_array" [ ]
\t"variableNames" "string_array" [ ]
\t"cubeMapName" "string" ""
\t"fademindist" "float" "-1"
\t"fademaxdist" "float" "0"
\t"smoothingAngle" "float" "40"
\t"tintColor" "color" "255 255 255 255"
\t"physicsType" "string" "${options.physicsType ?? "default"}"
\t"physicsGroup" "string" ""
\t"physicsInteractsAs" "string" ""
\t"physicsInteractsWith" "string" ""
\t"meshData" "CDmePolygonMesh"
\t{
\t\t"id" "elementid" "${randomUUID()}"
\t\t"name" "string" "meshData"
\t\t"vertexEdgeIndices" "int_array" [ ${arrayValues(mesh.vertexEdgeIndices, "")} ]
\t\t"vertexDataIndices" "int_array" [ ${arrayValues(mesh.vertexDataIndices, "")} ]
\t\t"edgeVertexIndices" "int_array" [ ${arrayValues(mesh.edgeVertexIndices, "")} ]
\t\t"edgeOppositeIndices" "int_array" [ ${arrayValues(mesh.edgeOppositeIndices, "")} ]
\t\t"edgeNextIndices" "int_array" [ ${arrayValues(mesh.edgeNextIndices, "")} ]
\t\t"edgeFaceIndices" "int_array" [ ${arrayValues(mesh.edgeFaceIndices, "")} ]
\t\t"edgeDataIndices" "int_array" [ ${arrayValues(mesh.edgeDataIndices, "")} ]
\t\t"edgeVertexDataIndices" "int_array" [ ${arrayValues(mesh.edgeVertexDataIndices, "")} ]
\t\t"faceEdgeIndices" "int_array" [ ${arrayValues(mesh.faceEdgeIndices, "")} ]
\t\t"faceDataIndices" "int_array" [ ${arrayValues(mesh.faceDataIndices, "")} ]
\t\t"materials" "string_array" [ ${materials.map((material) => `"${escaped(material)}"`).join(", ")} ]
\t\t"vertexData" ${vertexData.split("\n").map((line) => `\t\t${line}`).join("\n").trimStart()}
\t\t"faceVertexData" ${faceVertexData.split("\n").map((line) => `\t\t${line}`).join("\n").trimStart()}
\t\t"edgeData" ${edgeData.split("\n").map((line) => `\t\t${line}`).join("\n").trimStart()}
\t\t"faceData" ${faceData.split("\n").map((line) => `\t\t${line}`).join("\n").trimStart()}
\t\t"subdivisionData" "CDmePolygonMeshSubdivisionData"
\t\t{
\t\t\t"id" "elementid" "${randomUUID()}"
\t\t\t"subdivisionLevels" "int_array" [ ${arrayValues(Array(mesh.edgeVertexIndices.length).fill(0), "")} ]
\t\t\t"streams" "element_array" [ ]
\t\t}
\t}
\t"useAsOccluder" "bool" "0"
}`;
}
