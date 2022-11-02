import { padLeft } from 'web3-utils';
import util from 'ethereumjs-util';
import { addHexPrefix, bufToHex, hexToBuf, truncateHexPrefix } from './hex';
import { NetworkType } from '../network-type';
import { zp } from '../zp';
import { bigintToArrayLe } from '../utils';
import { Privkey } from 'hdwallet-babyjub';

/**
 * Use deriveSpendingKeyV2 instead. This one is for compatibility with existing wallets.
 * @deprecated
 */
export function deriveSpendingKey(mnemonic: string, networkType: NetworkType): Uint8Array {
  const path = NetworkType.privateDerivationPath(networkType);
  return bigintToArrayLe(Privkey(mnemonic, path).k);
}

export function deriveSpendingKeyV2(mnemonic: string, networkType: NetworkType): Uint8Array {
  const path = NetworkType.spendingKeyDerivationPath(networkType);
  return bigintToArrayLe(Privkey(mnemonic, path).k);
}

export function verifyShieldedAddress(address: string): boolean {
  return zp.validateAddress(address);
}

export function ethAddrToBuf(address: string): Uint8Array {
  return hexToBuf(address, 20);
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

export function toCompactSignature(signature: string): string {
  signature = truncateHexPrefix(signature);

  if (signature.length > 128) {
    // it seems it's an extended signature, let's compact it!
    let v = signature.substr(128, 2);
    if (v == "1c") {
      return `${signature.slice(0, 64)}${(parseInt(signature[64], 16) | 8).toString(16)}${signature.slice(65, 128)}`;
    } else if (v != "1b") {
      throw ("invalid signature: v should be 27 or 28");
    }

    return signature.slice(0, 128);
  } else if (signature.length < 128) {
    throw ("invalid signature: it should consist at least 64 bytes (128 chars)");
  }

  // it seems the signature already compact
  return signature;
}

export function parseCompactSignature(signature: string): {v: string, r: string, s: string} {
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

    return {v, r, s};

  }else {
    throw ("invalid signature length");
  }

}

export function toCanonicalSignature(signature: string): string {
  let sig = truncateHexPrefix(signature);

  let v = "1b";
  if (parseInt(sig[64], 16) > 7) {
    v = "1c";
    sig = sig.substr(0, 64) + `${(parseInt(sig[64], 16) & 7).toString(16)}` + sig.slice(65);
  }
  return `0x` + sig + v;
}

export function addressFromSignature(signature: string, signedData: string): string {
  let sigFields = util.fromRpcSig(addHexPrefix(signature));

  const dataBuf = hexToBuf(signedData);
  const prefix = Buffer.from("\x19Ethereum Signed Message:\n");
  const prefixedSignedData = util.keccak(
    Buffer.concat([prefix, Buffer.from(String(dataBuf.length)), dataBuf])
  );

  let pub = util.ecrecover(prefixedSignedData, sigFields.v, sigFields.r, sigFields.s);
  let addrBuf = util.pubToAddress(pub);

  return addHexPrefix(bufToHex(addrBuf));
}