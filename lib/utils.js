import { Privkey } from 'hdwallet-babyjub';
import { numberToHex, padLeft } from 'web3-utils';
import { NetworkType } from './network-type';
export function deriveSpendingKey(mnemonic, networkType) {
    const path = NetworkType.privateDerivationPath(networkType);
    const sk = bigintToArrayLe(Privkey(mnemonic, path).k);
    return sk;
}
const HEX_TABLE = [];
for (let n = 0; n <= 0xff; ++n) {
    const octet = n.toString(16).padStart(2, '0');
    HEX_TABLE.push(octet);
}
export function bufToHex(buffer) {
    const octets = new Array(buffer.length);
    for (let i = 0; i < buffer.length; ++i)
        octets[i] = (HEX_TABLE[buffer[i]]);
    return octets.join('');
}
export function base64ToHex(data) {
    const bytes = atob(data);
    const octets = new Array(bytes.length);
    for (let i = 0; i < bytes.length; ++i) {
        octets[i] = HEX_TABLE[bytes.charCodeAt(i)];
    }
    return octets.join('');
}
export function bigintToArrayLe(num) {
    let result = new Uint8Array(32);
    for (let i = 0; num > BigInt(0); ++i) {
        result[i] = Number(num % BigInt(256));
        num = num / BigInt(256);
    }
    return result;
}
export function truncateHexPrefix(data) {
    if (data.startsWith('0x')) {
        data = data.slice(2);
    }
    return data;
}
export function addHexPrefix(data) {
    if (data.startsWith('0x') == false) {
        data = `0x` + data;
    }
    return data;
}
export function hexToBuf(hex) {
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
    constructor() {
        this.buf = '0x';
    }
    toString() {
        return this.buf;
    }
    writeHex(hex) {
        this.buf += hex;
    }
    writeBigInt(num, numBytes) {
        this.buf += toTwosComplementHex(num, numBytes);
    }
    writeBigIntArray(nums, numBytes) {
        for (let num of nums) {
            this.writeBigInt(num, numBytes);
        }
    }
    writeNumber(num, numBytes) {
        this.buf += padLeft(numberToHex(num).slice(2), numBytes * 2);
    }
}
export class HexStringReader {
    constructor(data) {
        if (data.slice(0, 2) == '0x') {
            data = data.slice(2);
        }
        this.data = data;
        this.curIndex = 0;
    }
    readHex(numBytes) {
        const sliceEnd = this.curIndex + numBytes * 2;
        if (sliceEnd > this.data.length) {
            return null;
        }
        const res = this.data.slice(this.curIndex, sliceEnd);
        this.curIndex = sliceEnd;
        return res;
    }
    readNumber(numBytes, le = false) {
        let hex = this.readHex(numBytes);
        if (!hex)
            return null;
        if (le) {
            hex = hex.match(/../g).reverse().join('');
        }
        return parseInt(hex, 16);
    }
    readBigInt(numBytes, le = false) {
        let hex = this.readHex(numBytes);
        if (!hex)
            return null;
        if (le) {
            hex = hex.match(/../g).reverse().join('');
        }
        return BigInt('0x' + hex);
    }
    readSignedBigInt(numBytes, le = false) {
        let unsignedNum = this.readBigInt(numBytes, le);
        const msbMask = (BigInt(1) << BigInt(numBytes * 8 - 1));
        if (unsignedNum && (unsignedNum & msbMask)) {
            unsignedNum -= BigInt(1) << BigInt(numBytes * 8);
        }
        return unsignedNum;
    }
    readBigIntArray(numElements, numBytesPerElement, le = false) {
        const elements = [];
        for (let i = 0; i < numElements; ++i) {
            const num = this.readBigInt(numBytesPerElement, le);
            if (!num) {
                break;
            }
            elements.push(num);
        }
        return elements;
    }
    readHexToTheEnd() {
        if (this.curIndex > this.data.length) {
            return null;
        }
        const res = this.data.slice(this.curIndex, this.data.length);
        this.curIndex = this.data.length;
        return res;
    }
}
export function toTwosComplementHex(num, numBytes) {
    let hex;
    if (num < 0) {
        let val = BigInt(2) ** BigInt(numBytes * 8) + num;
        hex = val.toString(16);
    }
    else {
        hex = num.toString(16);
    }
    return padLeft(hex, numBytes * 2);
}
export function toCompactSignature(signature) {
    signature = truncateHexPrefix(signature);
    let v = signature.substr(128, 2);
    if (v == "1c") {
        return `${signature.slice(0, 64)}${(parseInt(signature[64], 16) | 8).toString(16)}${signature.slice(65, 128)}`;
    }
    else if (v != "1b") {
        throw ("invalid signature: v should be 27 or 28");
    }
    return signature;
}
export function parseCompactSignature(signature) {
    signature = truncateHexPrefix(signature);
    if (signature.length == 128) {
        const r = `0x${signature.substr(0, 64)}`;
        let s = `0x${signature.slice(64)}`;
        let v = `0x1b`;
        let sHiDigit = parseInt(s[0], 16);
        if (sHiDigit > 7) {
            v = `0x1c`;
            s = `0x${(sHiDigit & 7).toString(16)}${s.slice(1)}`;
        }
        return { v, r, s };
    }
    else {
        throw ("invalid signature length");
    }
}
export function toCanonicalSignature(signature) {
    let sig = truncateHexPrefix(signature);
    let v = "1b";
    if (parseInt(sig[64], 16) > 7) {
        v = "1c";
        sig = sig.substr(0, 64) + `${(parseInt(sig[64], 16) & 7).toString(16)}` + sig.slice(65);
    }
    return `0x` + sig + v;
}
//# sourceMappingURL=utils.js.map