import BN from 'bn.js';
import bs58 from 'bs58';
import { address } from '@waves/ts-lib-crypto';
import PromiseThrottle from 'promise-throttle';

import { NetworkBackend, RelayerTx, TxData } from './network';
import { TxType } from '../tx';
import { BinaryWriter, bufToHex, toCompactSignature, truncateHexPrefix } from '../utils';
import { BinaryReader } from '../utils';
import { zp } from '../zp';

const THROTTLE_RPS = 4;

export class WavesNetwork implements NetworkBackend {
  approveChangesBalance: boolean = true;

  private readonly nodeUrl: string;
  private readonly contractAddress: string;
  private readonly throttle: PromiseThrottle;

  constructor(nodeUrl: string, contractAddress: string, requestsPerSecond = THROTTLE_RPS) {
    this.nodeUrl = nodeUrl;
    this.contractAddress = contractAddress;
    this.throttle = new PromiseThrottle({
      requestsPerSecond,
      promiseImplementation: Promise,
    });
  }

  async signNullifier(signFn: (data: string) => Promise<string>, nullifier: BN, fromAddress: string, _depositId: number | null): Promise<string> {
    const dataWriter = new BinaryWriter('be');
    dataWriter.writeU256(nullifier);
    dataWriter.writeString(fromAddress);

    const dataToSign = Buffer.from(dataWriter.toArray()).toString('hex');
    const signature = Buffer.from(truncateHexPrefix(await signFn(dataToSign)), 'hex');
    const finalDataWriter = new BinaryWriter();
    finalDataWriter.writeFixedArray(signature);
    finalDataWriter.writeString(fromAddress);

    return Buffer.from(finalDataWriter.toArray()).toString('hex');
  }

  async getChainId(): Promise<number> {
    return 0;
  }

  async getDenominator(contractAddress: string): Promise<BN> {
    return new BN('100000000'); // FIXME: get from the contract
  }

  defaultNetworkName(): string {
    return 'waves';
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
    let tx;
    try {
      tx = await this.fetchBlockchainTx(hash);
    } catch (e) {
      console.debug(e);
      return null;
    }

    const calldata = deserializePoolData(Buffer.from(tx.calldata, 'base64'));
    const fee = new BN(calldata.memo.subarray(0, 8));
    let withdrawAddress: string | null = null;
    if (calldata.txType == TxType.Withdraw) {
      withdrawAddress = '0x' + calldata.memo.subarray(16, 36).toString('hex');
    }
    let depositAddress: string | null = null;
    if (calldata.txType == TxType.Deposit) {
      depositAddress = calldata.depositAddress;
    }

    return {
      timestamp: Number(tx.timestamp),
      txType: calldata.txType,
      fee,
      depositAddress,
      withdrawAddress,
      tokenAmount: calldata.tokenAmount,
    };
  }

  async fetchBlockchainTx(hash: string): Promise<{ timestamp: number, calldata: string }> {
    const url = new URL(`/transactions/info/${hash}`, this.nodeUrl);
    const headers = { 'content-type': 'application/json;charset=UTF-8' };
    const res = await this.throttle.add(() => fetch(url.toString(), { headers }));
    if (!res.ok) {
      throw new Error(`Failed to fetch tx ${hash}: ${res.statusText}`);
    }

    const json = await res.json();

    if (json.call.function != 'transact') {
      throw new Error(`Non-pool transaction: ${json}`);
    }

    return {
      timestamp: json.timestamp,
      calldata: json.call.args[0],
    }
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
  txType!: TxType;
  memo!: Buffer;
  extraData?: Buffer;

  get tokenAmount(): BN {
    return new BN(zp.parseDelta(this.delta.toString()).v);
  }

  get depositAddress(): string {
    if (!this.extraData) {
      throw new Error('extraData is not set');
    }

    const pk = Buffer.from(this.extraData);
    return address({ publicKey: pk });
  }
}

function deserializePoolData(data: Buffer): PoolCalldata {
  const reader = new BinaryReader(data, 'be')

  // # nullifier          32 bytes
  // # outCommit         32 bytes
  // # assetId           32 bytes
  // # delta             32 bytes
  // #     nativeAmount   8 bytes
  // #     nativeEnergy  14 bytes
  // #     txIndex        6 bytes
  // #     poolId         3 bytes
  // # txProof          256 bytes
  // # treeProof        256 bytes
  // # rootAfter         32 bytes
  // # txType             2 bytes
  // # memo               dynamic bytes
  // # depositPk          optional 32 bytes
  // # depositSignature   optional 64 bytes

  const nullifier = reader.readU256();
  const outCommit = reader.readU256();
  const assetId = reader.readBuffer(32);
  const delta = reader.readU256();
  const transactProof = reader.readFixedArray(8, () => reader.readU256());
  const treeProof = reader.readFixedArray(8, () => reader.readU256());
  const rootAfter = reader.readU256();
  const txTypeNum = reader.readU16();
  let txType;
  switch (txTypeNum) {
    case 0: txType = TxType.Deposit; break;
    case 1: txType = TxType.Transfer; break;
    case 2: txType = TxType.Withdraw; break;
    default: throw new Error(`Unknown tx type ${txTypeNum}`);
  }


  const memoData = reader.readBufferUntilEnd();
  if (!memoData || memoData.length < 64 + 32) {
    throw new Error(`Memo is too short`);
  }

  const memo = memoData.subarray(0, -(64 + 32));
  const extraData = memoData.subarray(-(64 + 32));

  const tokenId = bs58.encode(assetId)

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
  })
}
