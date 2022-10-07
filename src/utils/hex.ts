import { numberToHex, padLeft } from 'web3-utils';
import { toTwosComplementHex } from './crypto';

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


export class HexStringWriter {
  buf: string;

  constructor() {
    this.buf = '0x';
  }

  toString() {
    return this.buf;
  }

  writeHex(hex: string) {
    this.buf += hex;
  }

  writeBigInt(num: bigint, numBytes: number) {
    this.buf += toTwosComplementHex(num, numBytes);
  }

  writeBigIntArray(nums: bigint[], numBytes: number) {
    for (let num of nums) {
      this.writeBigInt(num, numBytes);
    }
  }

  writeNumber(num: number, numBytes: number) {
    this.buf += padLeft(numberToHex(num).slice(2), numBytes * 2);
  }
}

export class HexStringReader {
  data: string;
  curIndex: number;

  constructor(data: string) {
    if (data.slice(0, 2) == '0x') {
      data = data.slice(2);
    }

    this.data = data;
    this.curIndex = 0;
  }

  readHex(numBytes: number): string | null {
    const sliceEnd = this.curIndex + numBytes * 2;

    if (sliceEnd > this.data.length) {
      return null;
    }

    const res = this.data.slice(this.curIndex, sliceEnd);
    this.curIndex = sliceEnd;
    return res;
  }

  readNumber(numBytes: number, le: boolean = false): number | null {
    let hex = this.readHex(numBytes);
    if (!hex) return null;

    if (le) {
      hex = hex.match(/../g)!.reverse().join('');
    }
    return parseInt(hex, 16);
  }

  readBigInt(numBytes: number, le: boolean = false): bigint | null {
    let hex = this.readHex(numBytes);
    if (!hex) return null;
    if (le) {
      hex = hex.match(/../g)!.reverse().join('')
    }
    return BigInt('0x' + hex);
  }

  readSignedBigInt(numBytes: number, le: boolean = false): bigint | null {
    let unsignedNum = this.readBigInt(numBytes, le);
    const msbMask = (BigInt(1) << BigInt(numBytes * 8 - 1));
    if (unsignedNum && (unsignedNum & msbMask)) {

      unsignedNum -= BigInt(1) << BigInt(numBytes * 8);
    }

    return unsignedNum;
  }


  readBigIntArray(numElements: number, numBytesPerElement: number, le: boolean = false): bigint[] {
    const elements: bigint[] = [];
    for (let i = 0; i < numElements; ++i) {
      const num = this.readBigInt(numBytesPerElement, le);
      if (!num) {
        break;
      }

      elements.push(num);
    }

    return elements;
  }

  readHexToTheEnd(): string | null {
    if (this.curIndex > this.data.length) {
      return null;
    }

    const res = this.data.slice(this.curIndex, this.data.length);
    this.curIndex = this.data.length;
    return res;
  }
}