import { Privkey } from 'hdwallet-babyjub';
import { numberToHex, padLeft } from 'web3-utils';

import { NetworkType } from './network-type';

export function deriveSpendingKey(mnemonic: string, networkType: NetworkType): Uint8Array {
  const path = NetworkType.privateDerivationPath(networkType);
  const sk = bigintToArrayLe(Privkey(mnemonic, path).k);

  return sk;
}

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

export function bigintToArrayLe(num: bigint): Uint8Array {
  let result = new Uint8Array(32);

  for (let i = 0; num > BigInt(0); ++i) {
    result[i] = Number(num % BigInt(256));
    num = num / BigInt(256);
  }

  return result;
}

export function truncateHexPrefix(data: string): string {
  if (data.startsWith('0x')) {
    data = data.slice(2);
  }

  return data;
}

export function hexToBuf(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex string');
  }

  if (hex.startsWith('0x')) {
    hex = hex.slice(2);
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
}

export function toTwosComplementHex(num: bigint, numBytes: number): string {
  let hex;
  if (num < 0) {
    let val = BigInt(2) ** BigInt(numBytes * 8) + num;
    hex = val.toString(16);
  } else {
    hex = num.toString(16);
  }

  return padLeft(hex, numBytes * 2);
}

export function toCompactSignature(signature: string) {
  let v = signature.substr(130, 2);
  if (v == "1c") {
    return `${signature.slice(0, 66)}${(parseInt(signature[66], 16) | 8).toString(16)}${signature.slice(67, 130)}`;
  } else if (v != "1b") {
    throw ("invalid signature: v should be 27 or 28");
  }

  return signature;
}

export function toCanonicalSignature(signature: string) {
  let v = "1c";
  if (parseInt(signature[66], 16) > 7) {
    v = "1e";
  }
  return signature + v;
}
