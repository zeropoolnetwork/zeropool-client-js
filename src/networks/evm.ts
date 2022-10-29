import Web3 from 'web3';
import { AbiItem } from 'web3-utils';
import { Contract } from 'web3-eth-contract'
import { NetworkBackend, RelayerTx, TxData } from './network';
import { ShieldedTx, TxType } from '../tx';
import { ethAddrToBuf, toCanonicalSignature, toCompactSignature, truncateHexPrefix } from '../utils';
import PromiseThrottle from 'promise-throttle';

const THROTTLE_RPS = 10;

export class EvmNetwork implements NetworkBackend {
  contract: Contract;
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
    this.contract = new this.web3.eth.Contract(abi) as Contract;

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

  public async getDenominator(contractAddress: string): Promise<bigint> {
    this.contract.options.address = contractAddress;
    return BigInt(await this.contract.methods.denominator().call());
  }

  async signNullifier(signFn: (data: string) => Promise<string>, nullifier: string, _fromAddress: string, _depositId: number | null): Promise<string> {
    if (nullifier.slice(0, 2) != '0x') {
      nullifier = '0x' + nullifier;
    }

    const signature = truncateHexPrefix(await signFn(nullifier));
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

    const tx = ShieldedTx.decode(txData.input);

    if (tx.selector.toLowerCase() !== 'af989083') {
      throw new Error(`Cannot decode calldata for tx ${hash}: incorrect selector ${tx.selector}`);
    }

    let depositAddress: string | null = null;
    let withdrawAddress: string | null = null;
    if (tx.txType == TxType.Deposit) {
      // here is a deposit transaction (approvable method)
      // source address is recovered from the signature
      if (!tx.extra || tx.extra.length < 128) {
        throw new Error(`no signature for approvable deposit`);
      }

      const fullSig = toCanonicalSignature(tx.extra.substr(0, 128));
      const nullifier = '0x' + tx.nullifier.toString(16).padStart(64, '0');
      depositAddress = this.web3.eth.accounts.recover(nullifier, fullSig);
    } else if (tx.txType == TxType.Withdraw) {
      withdrawAddress = '0x' + tx.memo.substr(32, 40);
    }

    return {
      timestamp: Number(block.timestamp),
      txType: tx.txType,
      fee: BigInt('0x' + tx.memo.substr(0, 16)),
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