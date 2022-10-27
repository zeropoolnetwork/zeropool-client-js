import BN from 'bn.js';

import { NetworkBackend, RelayerTx, TxData } from './network';
import { TxType } from '../tx';
import { BinaryWriter, bufToHex, toCompactSignature, truncateHexPrefix } from '../utils';
import PromiseThrottle from 'promise-throttle';
import { BinaryReader } from '../utils';
import { zp } from '../zp';

const THROTTLE_RPS = 4;

export class NearNetwork implements NetworkBackend {
  private readonly relayerUrl: string;
  private readonly throttle: PromiseThrottle;

  constructor(relayerUrl: string, requestsPerSecond = THROTTLE_RPS) {
    this.relayerUrl = relayerUrl;
    this.throttle = new PromiseThrottle({
      requestsPerSecond,
      promiseImplementation: Promise,
    });
  }

  async signNullifier(signFn: (data: string) => Promise<string>, nullifier: Uint8Array): Promise<string> {
    const dataToSign = Buffer.from(nullifier).toString('hex');
    return await signFn(dataToSign);
  }

  async getChainId(): Promise<number> {
    return 0;
  }

  async getDenominator(contractAddress: string): Promise<bigint> {
    return BigInt('1000000000000000'); // FIXME: get from the contract
  }

  defaultNetworkName(): string {
    return 'near';
  }

  getRpcUrl(): string {
    return '';
  }

  disassembleRelayerTx(tx: string): RelayerTx {
    const HASH_OFFSET = 65;

    // FIXME: Proper hash parsing/serialization.
    const memoOffset = tx.search(/0\d000000/);
    if (memoOffset == -1) {
      throw new Error('Invalid tx');
    }

    const mined = tx.slice(0, 1) == '1';
    const commitment = tx.slice(1, HASH_OFFSET);
    const hash = tx.slice(HASH_OFFSET, memoOffset); // hash = 44 or 43 chars
    const memo = tx.slice(memoOffset);

    return {
      mined,
      hash,
      commitment,
      memo,
    }
  }

  async getTransaction(hash: string): Promise<TxData | null> {
    let tx: IndexerTx;
    try {
      tx = await this.fetchBlockchainTx(hash);
    } catch (e) {
      console.debug(e);
      return null;
    }

    const calldata = deserializePoolData(Buffer.from(tx.calldata, 'base64'));
    let txType
    switch (calldata.txType) {
      case 0: txType = TxType.Deposit; break;
      case 1: txType = TxType.Transfer; break;
      case 2: txType = TxType.Withdraw; break;
      default: throw new Error(`Unknown tx type ${calldata.txType}`);
    }

    const memoHex = bufToHex(calldata.memo);
    const fee = BigInt('0x' + memoHex.substr(0, 16));
    let withdrawAddress: string | null = null;
    if (txType == TxType.Withdraw) {
      withdrawAddress = '0x' + memoHex.substr(32, 40);
    }

    return {
      timestamp: Number(tx.timestamp),
      txType,
      fee,
      depositAddress: calldata.depositAddress,
      withdrawAddress,
      tokenAmount: BigInt(calldata.tokenAmount.toString()),
    };
  }

  async fetchBlockchainTx(hash: string): Promise<IndexerTx> {
    const url = new URL(`/blockchain/tx/${hash}`, this.relayerUrl);
    const headers = { 'content-type': 'application/json;charset=UTF-8' };
    const res = await this.throttle.add(() => fetch(url.toString(), { headers }));
    if (!res.ok) {
      throw new Error(`Failed to fetch tx ${hash}: ${res.statusText}`);
    }

    return await res.json();
  }

  addressToBuffer(address: string): Uint8Array {
    const writer = new BinaryWriter();
    writer.writeString(address);
    return writer.toArray();
  }

  transactionVersion(): number {
    return 2;
  }
}

type IndexerTx = {
  hash: string,
  block_hash: string,
  block_height: number,
  timestamp: number,
  sender_address: string,
  receiver_address: string,
  signature: string,
  calldata: string,
}

// TODO: Try using borsh-ts
class PoolCalldata {
  constructor(data: Object) {
    Object.assign(this, data)
  }

  nullifier!: BN
  outCommit!: BN
  tokenId!: string
  delta!: BN
  transactProof!: BN[]
  rootAfter!: BN
  treeProof!: BN[]
  txType!: number
  memo!: Uint8Array

  get tokenAmount(): BN {
    return new BN(zp.parseDelta(this.delta.toString()).v);
  }

  get depositAddress(): string {
    const reader = new BinaryReader(Buffer.from(this.memo));
    reader.skip(8);
    const bufLen = reader.readU32();
    reader.skip(bufLen);
    return reader.readString();
  }
}

function deserializePoolData(data: Buffer): PoolCalldata {
  const reader = new BinaryReader(data)

  return new PoolCalldata({
    nullifier: reader.readU256(),
    outCommit: reader.readU256(),
    tokenId: reader.readString(),
    delta: reader.readU256(),
    transactProof: reader.readFixedArray(8, () => reader.readU256()),
    rootAfter: reader.readU256(),
    treeProof: reader.readFixedArray(8, () => reader.readU256()),
    txType: reader.readU8(),
    memo: reader.readDynamicBuffer(),
  })
}
