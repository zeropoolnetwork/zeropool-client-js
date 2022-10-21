import BN from 'bn.js';

import { NetworkBackend, RelayerTx, TxData } from './network';
import { TxType } from '../tx';
import { bufToHex, toCompactSignature, truncateHexPrefix } from '../utils';
import PromiseThrottle from 'promise-throttle';
import { BinaryReader } from '../utils';

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

  async signNullifier(signFn: (data: string) => Promise<string>, nullifier: BigInt, _address: string): Promise<string> {
    const dataToSign = '0x' + nullifier.toString(16).padStart(64, '0');
    const signature = truncateHexPrefix(await signFn(dataToSign));
    return toCompactSignature(signature);
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
    const mined = tx.slice(0, 1) == '1';
    const commitment = tx.slice(1, 65);
    const hash = tx.slice(65, 109); // hash = 44 chars
    const memo = tx.slice(109);

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
      console.debug('Failed to fetch tx', hash, e);
      return null;
    }

    if (!tx.args || !tx.args.args_base64) {
      throw new Error(`Unable to parse calldata from tx ${hash}`);
    }

    const calldata = deserializePoolData(Buffer.from(tx.args.args_base64, 'base64'));
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
      timestamp: Number(tx.block_timestamp),
      txType,
      fee,
      depositAddress: calldata.depositAddress,
      withdrawAddress,
      tokenAmount: BigInt(calldata.tokenAmount.toString()),
    };
  }

  async fetchBlockchainTx(hash: string): Promise<NearTxData> {
    const url = new URL(`/blockchain/tx/${hash}`, this.relayerUrl);
    const headers = { 'content-type': 'application/json;charset=UTF-8' };
    const res = await this.throttle.add(() => fetch(url.toString(), { headers }));
    return await res.json();
  }
}

type NearTxData = {
  block_timestamp: number,
  args: {
    args_base64: string,
  }
}

// TODO: Try using borsh-ts
class PoolCalldata {
  constructor(data: Object) {
    Object.assign(this, data)
  }

  nullifier!: BN
  outCommit!: BN
  transferIndex!: BN
  energyAmount!: BN
  tokenId!: string
  tokenAmount!: BN
  delta!: BN
  transactProof!: BN[]
  rootAfter!: BN
  treeProof!: BN[]
  txType!: number
  memo!: Uint8Array
  depositAddress!: string
  depositId!: number
}

function deserializePoolData(data: Buffer): PoolCalldata {
  const reader = new BinaryReader(data)

  return new PoolCalldata({
    nullifier: reader.readU256(),
    outCommit: reader.readU256(),
    transferIndex: reader.readU256(),
    energyAmount: reader.readU256(),
    tokenId: reader.readString(),
    tokenAmount: reader.readU256(),
    delta: reader.readU256(),
    transactProof: reader.readFixedArray(8, () => reader.readU256()),
    rootAfter: reader.readU256(),
    treeProof: reader.readFixedArray(8, () => reader.readU256()),
    txType: reader.readU8(),
    memo: reader.readDynamicBuffer(),
    depositAddress: reader.readString(),
    depositId: reader.readU64(),
  })
}
