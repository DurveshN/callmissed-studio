/**
 * Hand-encodes a minimal valid ONNX model (protobuf) with a single Identity node: y = x, float[1].
 * Lets tests exercise real ONNX Runtime loading without downloading anything.
 */

function varint(value: number): number[] {
  const out: number[] = []
  let v = value
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80)
    v = Math.floor(v / 128)
  }
  out.push(v)
  return out
}

const key = (field: number, wireType: 0 | 2) => varint((field << 3) | wireType)
const int = (field: number, value: number) => [...key(field, 0), ...varint(value)]
const bytes = (field: number, data: number[]) => [...key(field, 2), ...varint(data.length), ...data]
const str = (field: number, text: string) => bytes(field, [...Buffer.from(text, 'utf8')])

function valueInfo(name: string): number[] {
  const dim = int(1, 1) // Dimension.dim_value = 1
  const shape = bytes(1, dim) // TensorShapeProto.dim
  const tensor = [...int(1, 1), ...bytes(2, shape)] // elem_type FLOAT, shape
  const type = bytes(1, tensor) // TypeProto.tensor_type
  return [...str(1, name), ...bytes(2, type)]
}

export function identityOnnx(): Buffer {
  const node = [...str(1, 'x'), ...str(2, 'y'), ...str(4, 'Identity')]
  const graph = [
    ...bytes(1, node),
    ...str(2, 'identity'),
    ...bytes(11, valueInfo('x')),
    ...bytes(12, valueInfo('y'))
  ]
  const opset = [...str(1, ''), ...int(2, 13)]
  const model = [...int(1, 8), ...str(2, 'callmissed-studio-tests'), ...bytes(7, graph), ...bytes(8, opset)]
  return Buffer.from(model)
}
