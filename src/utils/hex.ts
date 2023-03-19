const HEX_TABLE: string[] = [];
for (let n = 0; n <= 0xff; ++n) {
  const octet = n.toString(16).padStart(2, '0');
  HEX_TABLE.push(octet);
}

export function bufToHex(buffer: Uint8Array): string {
  const octets = new Array(buffer.length);

  for (let i = 0; i < buffer.length; ++i)
    octets[i] = (HEX_TABLE[buffer[i]]);

  return octets.join('');
}

export function base64ToHex(data: string): string {
  const bytes = atob(data);
  const octets = new Array(bytes.length);

  for (let i = 0; i < bytes.length; ++i) {
    octets[i] = HEX_TABLE[bytes.charCodeAt(i)];
  }

  return octets.join('');
}

export function truncateHexPrefix(data: string): string {
  if (data.startsWith('0x')) {
    data = data.slice(2);
  }

  return data;
}

export function addHexPrefix(data: string): string {
  if (data.startsWith('0x') == false) {
    data = `0x` + data;
  }

  return data;
}

// Convert input hex number to the bytes array
// extend (leading zero-bytes) or trim (trailing bytes)
// output buffer to the bytesCnt bytes (only when bytesCnt > 0)
export function hexToBuf(hex: string, bytesCnt: number = 0): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex string');
  }

  if (hex.startsWith('0x')) {
    hex = hex.slice(2);
  }

  if (bytesCnt > 0) {
    const digitsNum = bytesCnt * 2;
    hex = hex.slice(-digitsNum).padStart(digitsNum, '0');
  }

  const buffer = new Uint8Array(hex.length / 2);

  for (let i = 0; i < hex.length; i = i + 2) {
    buffer[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }

  return buffer;
}
