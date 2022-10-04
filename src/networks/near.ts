import BN from 'bn.js';
import borsh from 'borsh'

import { NetworkBackend, TxData } from './network';
import { TxType } from '../tx';
import { bufToHex, toCompactSignature, truncateHexPrefix } from '../utils';

export class NearNetwork implements NetworkBackend {
  private readonly relayerUrl: string;

  constructor(relayerUrl: string) {
    this.relayerUrl = relayerUrl;
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
    return BigInt(1);
  }

  isSignatureCompact(): boolean {
    return true;
  }

  defaultNetworkName(): string {
    return 'near';
  }

  getRpcUrl(): string {
    return '';
  }

  async getTransaction(hash: string): Promise<TxData | null> {
    const tx = await this.fetchBlockchainTx(hash);
    if (tx === null) {
      return null;
    }

    if (!tx.args || !tx.args.args_parsed || !tx.args.args_parsed.encoded_tx) {
      throw new Error(`Unable to parse encoded_tx from tx ${hash}`);
    }

    const calldata = borsh.deserialize(BORSH_SCHEMA, PoolCalldata, Buffer.from(tx.args.args_parsed.encoded_tx, 'base64'));
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

  async fetchBlockchainTx(hash: string): Promise<NearTxData | null> {
    const url = new URL(`/blockchain/tx/${hash}`, this.relayerUrl);
    const headers = { 'content-type': 'application/json;charset=UTF-8' };
    return await (await fetch(url.toString(), { headers })).json();
  }
}

type NearTxData = {
  block_timestamp: number,
  args: {
    args_parsed: {
      encoded_tx: string,
    },
  }
}

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


const BORSH_SCHEMA = new Map([[
  PoolCalldata,
  {
    kind: 'struct',
    fields: [
      ['nullifier', 'u256'],
      ['outCommit', 'u256'],
      ['transferIndex', 'u256'],
      ['energyAmount', 'u256'],
      ['tokenId', 'string'],
      ['tokenAmount', 'u256'],
      ['delta', 'u256'],

      ['transactProof', ['u256', 8]],
      ['rootAfter', 'u256'],
      ['treeProof', ['u256', 8]],

      ['txType', 'u16'],

      ['memo', []],
      ['depositAddress', 'string'],
      ['depositId', 'u64'],
    ]
  }
]])