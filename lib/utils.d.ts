import { NetworkType } from './network-type';
export declare function deriveSpendingKey(mnemonic: string, networkType: NetworkType): Uint8Array;
export declare function bufToHex(buffer: Uint8Array): string;
export declare function base64ToHex(data: string): string;
export declare function bigintToArrayLe(num: bigint): Uint8Array;
export declare function truncateHexPrefix(data: string): string;
export declare function hexToBuf(hex: string): Uint8Array;
export declare class HexStringWriter {
    buf: string;
    constructor();
    toString(): string;
    writeHex(hex: string): void;
    writeBigInt(num: bigint, numBytes: number): void;
    writeBigIntArray(nums: bigint[], numBytes: number): void;
    writeNumber(num: number, numBytes: number): void;
}
export declare class HexStringReader {
    data: string;
    curIndex: number;
    constructor(data: string);
    readHex(numBytes: number): string | null;
    readNumber(numBytes: number, le?: boolean): number | null;
    readBigInt(numBytes: number, le?: boolean): bigint | null;
    readBigIntArray(numElements: number, numBytesPerElement: number, le?: boolean): bigint[];
}
export declare function toTwosComplementHex(num: bigint, numBytes: number): string;
export declare function toCompactSignature(signature: string): string;
export declare function toCanonicalSignature(signature: string): string;
