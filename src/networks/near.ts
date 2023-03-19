import BN from 'bn.js';
import bs58 from 'bs58';

import { NetworkBackend, RelayerTx, TxData } from './network';
import { TxType } from '../tx';
import { BinaryWriter, bufToHex, toCompactSignature, truncateHexPrefix } from '../utils';
import PromiseThrottle from 'promise-throttle';
import { BinaryReader } from '../utils';
import { zp } from '../zp';

const THROTTLE_RPS = 4;

export class NearNetwork implements NetworkBackend {
  approveChangesBalance: boolean = true;

  private readonly relayerUrl: string;
  private readonly throttle: PromiseThrottle;

  constructor(relayerUrl: string, requestsPerSecond = THROTTLE_RPS) {
    this.relayerUrl = relayerUrl;
    this.throttle = new PromiseThrottle({
      requestsPerSecond,
      promiseImplementation: Promise,
    });
  }

  async signNullifier(signFn: (data: string) => Promise<string>, nullifier: BN, fromAddress: string, depositId: number | null): Promise<string> {
    if (depositId === null) {
      throw new Error('depositId is null');
    }

    const dataWriter = new BinaryWriter();
    dataWriter.writeU256(nullifier);
    dataWriter.writeString(fromAddress);
    dataWriter.writeU64(depositId);

    const dataToSign = Buffer.from(dataWriter.toArray()).toString('hex');
    const signature = Buffer.from(truncateHexPrefix(await signFn(dataToSign)), 'hex');
    const finalDataWriter = new BinaryWriter();
    finalDataWriter.writeFixedArray(signature);
    finalDataWriter.writeString(fromAddress);
    finalDataWriter.writeU64(depositId);

    return Buffer.from(finalDataWriter.toArray()).toString('hex');
  }

  async getChainId(): Promise<number> {
    return 0;
  }

  async getDenominator(contractAddress: string): Promise<BN> {
    return new BN('1000000000000000'); // FIXME: get from the contract
  }

  defaultNetworkName(): string {
    return 'near';
  }

  getRpcUrl(): string {
    return '';
  }

  disassembleRelayerTx(tx: string): RelayerTx {
    const HASH_OFFSET = 65;
    const MEMO_OFFSET = HASH_OFFSET + 64;

    const mined = tx.slice(0, 1) == '1';
    const commitment = tx.slice(1, HASH_OFFSET);
    const hashHex = tx.slice(HASH_OFFSET, MEMO_OFFSET); // hash = 44 or 43 chars
    const memo = tx.slice(MEMO_OFFSET);

    const hash = bs58.encode(Buffer.from(hashHex, 'hex'));

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

    const fee = new BN(calldata.memo.subarray(0, 8));
    let withdrawAddress: string | null = null;
    if (txType == TxType.Withdraw) {
      withdrawAddress = '0x' + calldata.memo.subarray(16, 36).toString('hex');
    }
    let depositAddress: string | null = null;
    if (txType == TxType.Deposit) {
      depositAddress = calldata.depositAddress;
    }

    return {
      timestamp: Number(tx.timestamp),
      txType,
      fee,
      depositAddress,
      withdrawAddress,
      tokenAmount: calldata.tokenAmount,
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

  nullifier!: BN;
  outCommit!: BN;
  tokenId!: string;
  delta!: BN;
  transactProof!: BN[];
  rootAfter!: BN;
  treeProof!: BN[];
  txType!: number;
  memo!: Buffer;
  extraData?: Buffer;

  get tokenAmount(): BN {
    return new BN(zp.parseDelta(this.delta.toString()).v);
  }

  get depositAddress(): string {
    if (!this.extraData) {
      throw new Error('extraData is not set');
    }

    const reader = new BinaryReader(Buffer.from(this.extraData));
    reader.skip(64); // skip signature
    return reader.readString();
  }
}

function deserializePoolData(data: Buffer): PoolCalldata {
  const reader = new BinaryReader(data);

  const nullifier = reader.readU256();
  const outCommit = reader.readU256();
  const tokenId = reader.readString();
  const delta = reader.readU256();
  const transactProof = reader.readFixedArray(8, () => reader.readU256());
  const rootAfter = reader.readU256();
  const treeProof = reader.readFixedArray(8, () => reader.readU256());
  const txType = reader.readU8();
  const memo = reader.readDynamicBuffer();
  const extraData = reader.readBufferUntilEnd();

  if (!reader.isEmpty()) {
    throw new Error('pool data is not fully consumed');
  }

  return new PoolCalldata({
    nullifier,
    outCommit,
    tokenId,
    delta,
    transactProof,
    rootAfter,
    treeProof,
    txType,
    memo,
    extraData,
  });
}
