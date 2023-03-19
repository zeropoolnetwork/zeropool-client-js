import Web3 from 'web3';
import { AbiItem, numberToHex, padLeft, toBN } from 'web3-utils';
import { Contract } from 'web3-eth-contract'
import { NetworkBackend, RelayerTx, TxData } from './network';
import { ShieldedTx, TxType } from '../tx';
import { ethAddrToBuf, toCanonicalSignature, toCompactSignature, truncateHexPrefix, BinaryReader } from '../utils';
import PromiseThrottle from 'promise-throttle';
import BN from 'bn.js';

const THROTTLE_RPS = 10;
const SELECTOR = 'af989083';

export class EvmNetwork implements NetworkBackend {
  approveChangesBalance: boolean = false;
  pool: Contract;
  token: Contract;
  rpcUrl: string;
  web3: Web3;
  throttle: PromiseThrottle;

  constructor(rpcUrl: string, requestsPerSecond: number = THROTTLE_RPS) {
    this.rpcUrl = rpcUrl;
    this.web3 = new Web3(rpcUrl);

    const abi: AbiItem[] = [
      {
        constant: true,
        inputs: [],
        name: 'denominator',
        outputs: [
          {
            name: '',
            type: 'uint256',
          }
        ],
        payable: false,
        type: 'function',
      },
    ];
    this.pool = new this.web3.eth.Contract(abi) as Contract;

    // just the Transfer() event definition is sufficient in this case
    const abiTokenJson: AbiItem[] = [
      {
        anonymous: false,
        inputs: [
          {
            indexed: true,
            name: 'from',
            type: 'address'
          },
          {
            indexed: true,
            name: 'to',
            type: 'address'
          },
          {
            indexed: false,
            name: 'value',
            type: 'uint256'
          }
        ],
        name: 'Transfer',
        type: 'event'
      }
    ];
    this.token = new this.web3.eth.Contract(abiTokenJson) as Contract;

    this.throttle = new PromiseThrottle({
      requestsPerSecond,
      promiseImplementation: Promise,
    });
  }

  public async getChainId(): Promise<number> {
    return await this.web3.eth.getChainId();
  }

  public async getDenominator(contractAddress: string): Promise<BN> {
    this.pool.options.address = contractAddress;
    return new BN(await this.pool.methods.denominator().call());
  }

  async signNullifier(signFn: (data: string) => Promise<string>, nullifier: BN, _fromAddress: string, _depositId: number | null): Promise<string> {
    const data = '0x' + padLeft(numberToHex(nullifier.toString()).slice(2), 64);
    const signature = truncateHexPrefix(await signFn(data));
    return toCompactSignature(signature);
  }

  defaultNetworkName(): string {
    return 'ethereum';
  }

  getRpcUrl(): string {
    return this.rpcUrl;
  }

  async getTransaction(hash: string): Promise<TxData | null> {
    const txData = await this.throttle.add(() => this.web3.eth.getTransaction(hash));
    if (!txData || !txData.blockNumber || !txData.input) {
      return null;
    }

    const block = await this.throttle.add(() => this.web3.eth.getBlock(txData.blockNumber!));
    if (!block) {
      throw new Error(`Unable to get timestamp for block ${txData.blockNumber}`);
    }

    const tx = decodeCalldata(txData.input);

    let depositAddress: string | null = null;
    let withdrawAddress: string | null = null;
    if (tx.txType == TxType.Deposit) {
      // here is a deposit transaction (approvable method)
      // source address is recovered from the signature
      if (!tx.extra || tx.extra.length < 64) {
        throw new Error(`no signature for approvable deposit`);
      }

      const fullSig = toCanonicalSignature(tx.extra.subarray(0, 64).toString('hex'));
      const nullifier = '0x' + tx.nullifier.toString(16).padStart(64, '0');
      depositAddress = this.web3.eth.accounts.recover(nullifier, fullSig);
    } else if (tx.txType == TxType.Withdraw) {
      withdrawAddress = '0x' + tx.memo.subarray(16, 36).toString('hex');
    }

    return {
      timestamp: Number(block.timestamp),
      txType: tx.txType,
      fee: new BN(tx.memo.subarray(0, 8)),
      depositAddress,
      withdrawAddress,
      tokenAmount: tx.tokenAmount,
    }
  }

  disassembleRelayerTx(tx: string): RelayerTx {
    const mined = tx.slice(0, 1) == '1';
    const hash = '0x' + tx.slice(1, 65);
    const commitment = tx.slice(65, 129);
    const memo = tx.slice(129);

    return {
      mined,
      hash,
      commitment,
      memo,
    }
  }

  addressToBuffer(address: string): Uint8Array {
    return ethAddrToBuf(address);
  }
}

function decodeCalldata(data: string): ShieldedTx {
  let tx = new ShieldedTx();
  let reader = new BinaryReader(Buffer.from(truncateHexPrefix(data), 'hex'), 'be');

  const selector = reader.readBuffer(4);

  if (selector.toString('hex') !== SELECTOR) {
    throw new Error(`Invalid selector ${selector}`);
  }

  tx.nullifier = reader.readU256();
  tx.outCommit = reader.readU256();
  tx.transferIndex = reader.readUint(6);
  tx.energyAmount = reader.readInt(14);
  tx.tokenAmount = reader.readInt(8);
  tx.transactProof = reader.readFixedArray(8, () => reader.readU256());
  tx.rootAfter = reader.readU256();
  tx.treeProof = reader.readFixedArray(8, () => reader.readU256());
  tx.txType = reader.readBuffer(2).toString('hex') as TxType;
  const memoSize = reader.readU16();
  tx.memo = reader.readBuffer(memoSize);

  // Extra data
  // It contains deposit holder signature for deposit transactions
  tx.extra = reader.readBufferUntilEnd();

  return tx;
}

