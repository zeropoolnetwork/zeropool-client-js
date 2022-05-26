import { validateAddress, Output, Proof, DecryptedMemo } from 'libzkbob-rs-wasm-web';

import { SnarkParams, Tokens } from './config';
import { hexToBuf, toCompactSignature, truncateHexPrefix } from './utils';
import { ZeroPoolState } from './state';
import { TxType } from './tx';
import { NetworkBackend } from './networks/network';
import { CONSTANTS } from './constants';
import { HistoryRecord } from './history'
import { IndexedTx } from 'libzkbob-rs-wasm-web';

export interface RelayerInfo {
  root: string;
  deltaIndex: string;
}

async function fetchTransactions(relayerUrl: string, offset: BigInt, limit: number = 100): Promise<string[]> {
  const url = new URL(`/transactions`, relayerUrl);
  url.searchParams.set('limit', limit.toString());
  url.searchParams.set('offset', offset.toString());
  const res = await (await fetch(url.toString())).json();

  return res;
}

// returns transaction job ID
async function sendTransaction(relayerUrl: string, proof: Proof, memo: string, txType: TxType, depositSignature?: string): Promise<string> {
  const url = new URL('/transaction', relayerUrl);
  const res = await fetch(url.toString(), { method: 'POST', body: JSON.stringify({ proof, memo, txType, depositSignature }) });

  if (!res.ok) {
    const body = await res.json();
    throw new Error(`Error ${res.status}: ${JSON.stringify(body)}`)
  }

  const json = await res.json();
  return json.jobId;
}

async function getJob(relayerUrl: string, id: string): Promise<{ state: string, txHash: string } | null> {
  const url = new URL(`/job/${id}`, relayerUrl);
  const res = await (await fetch(url.toString())).json();

  if (typeof res === 'string') {
    return null;
  } else {
    return res;
  }
}

async function info(relayerUrl: string): Promise<RelayerInfo> {
  const url = new URL('/info', relayerUrl);
  const res = await fetch(url.toString());

  return await res.json();
}

export interface ClientConfig {
  /** Spending key. */
  sk: Uint8Array;
  /** A map of supported tokens (token address => token params). */
  tokens: Tokens;
  /** Loaded zkSNARK paramaterers. */
  snarkParams: SnarkParams;
  /** A worker instance acquired through init() function of this package. */
  worker: any;
  /** The name of the network is only used for storage. */
  networkName: string | undefined;
  network: NetworkBackend;
}

export class ZeropoolClient {
  private zpStates: { [tokenAddress: string]: ZeroPoolState };
  private worker: any;
  private snarkParams: SnarkParams;
  private tokens: Tokens;
  private config: ClientConfig;
  private updateStatePromise: Promise<void> | undefined;

  public static async create(config: ClientConfig): Promise<ZeropoolClient> {
    const client = new ZeropoolClient();
    client.zpStates = {};
    client.worker = config.worker;
    client.snarkParams = config.snarkParams;
    client.tokens = config.tokens;
    client.config = config;

    let networkName = config.networkName;
    if (!networkName) {
      networkName = config.network.defaultNetworkName();
    }

    for (const [address, token] of Object.entries(config.tokens)) {
      const denominator = await config.network.getDenominator(token.poolAddress);
      client.zpStates[address] = await ZeroPoolState.create(config.sk, networkName, config.network.getRpcUrl(), BigInt(denominator));
    }

    return client;
  }

  public generateAddress(tokenAddress: string): string {
    const state = this.zpStates[tokenAddress];
    return state.account.generateAddress();
  }

  // TODO: generalize wei/gwei
  public async deposit(
    tokenAddress: string,
    amountWei: string,
    sign: (data: string) => Promise<string>,
    fromAddress: string | null = null,
    fee: string = '0',
  ): Promise<string> {
    const token = this.tokens[tokenAddress];
    const state = this.zpStates[tokenAddress];

    if (BigInt(amountWei) < state.denominator) {
      throw new Error('Value is too small');
    }

    await this.updateState(tokenAddress);

    const amountGwei = (BigInt(amountWei) / state.denominator).toString();
    let txData = await state.account.createDeposit({ amount: amountGwei, fee });

    const startProofDate = Date.now();
    const txProof = await this.worker.proveTx(txData.public, txData.secret);
    const proofTime = (Date.now() - startProofDate) / 1000;
    console.log(`Proof calculation took ${proofTime.toFixed(1)} sec`);

    const txValid = Proof.verify(this.snarkParams.transferVk!, txProof.inputs, txProof.proof);
    if (!txValid) {
      throw new Error('invalid tx proof');
    }

    // regular deposit through approve allowance: sign transaction nullifier
    let dataToSign = '0x' + BigInt(txData.public.nullifier).toString(16).padStart(64, '0');

    // TODO: Sign fromAddress as well?
    const signature = truncateHexPrefix(await sign(dataToSign));
    let fullSignature = signature;
    if (fromAddress) {
      const addr = truncateHexPrefix(fromAddress);
      fullSignature = addr + signature;
    }

    if (this.config.network.isSignatureCompact()) {
      fullSignature = toCompactSignature(fullSignature);
    }

    return await sendTransaction(token.relayerUrl, txProof, txData.memo, TxType.Deposit, fullSignature);
  }

  public async depositPermittable(
    tokenAddress: string,
    amountWei: string,
    signTypedData: (deadline: bigint, value: bigint) => Promise<string>,
    fromAddress: string | null = null,
    fee: string = '0',
  ): Promise<string> {
    const token = this.tokens[tokenAddress];
    const state = this.zpStates[tokenAddress];

    if (BigInt(amountWei) < state.denominator) {
      throw new Error('Value is too small');
    }

    await this.updateState(tokenAddress);

    const amountGwei = (BigInt(amountWei) / state.denominator).toString();
    let txData;
    if (fromAddress) {
      const deadline:bigint = BigInt(Math.floor(Date.now() / 1000) + 900)
      const holder = hexToBuf(fromAddress);
      txData = await state.account.createDepositPermittable({ amount: amountGwei, fee, deadline: String(deadline), holder});

      const startProofDate = Date.now();
      const txProof = await this.worker.proveTx(txData.public, txData.secret);
      const proofTime = (Date.now() - startProofDate) / 1000;
      console.log(`Proof calculation took ${proofTime.toFixed(1)} sec`);

      const txValid = Proof.verify(this.snarkParams.transferVk!, txProof.inputs, txProof.proof);
      if (!txValid) {
        throw new Error('invalid tx proof');
      }

      // permittable deposit signature should be calculated for the typed data
      const value = BigInt(amountWei) + BigInt(fee);
      let signature = truncateHexPrefix(await signTypedData(deadline, value));

      if (this.config.network.isSignatureCompact()) {
        signature = toCompactSignature(signature);
      }

      return await sendTransaction(token.relayerUrl, txProof, txData.memo, TxType.BridgeDeposit, signature);

    } else {
      throw new Error('You must provide fromAddress for bridge deposit transaction ');
    }
  }


  public async transfer(tokenAddress: string, outsWei: Output[], fee: string = '0'): Promise<string> {
    await this.updateState(tokenAddress);

    const token = this.tokens[tokenAddress];
    const state = this.zpStates[tokenAddress];

    const txType = TxType.Transfer;
    const outGwei = outsWei.map(({ to, amount }) => {
      if (!validateAddress(to)) {
        throw new Error('Invalid address. Expected a shielded address.');
      }

      const bnAmount = BigInt(amount);
      if (bnAmount < state.denominator) {
        throw new Error('One of the values is too small');
      }

      return {
        to,
        amount: (bnAmount / state.denominator).toString(),
      }
    });

    const txData = await state.account.createTransfer({ outputs: outGwei, fee });

    const startProofDate = Date.now();
    const txProof = await this.worker.proveTx(txData.public, txData.secret);
    const proofTime = (Date.now() - startProofDate) / 1000;
    console.log(`Proof calculation took ${proofTime.toFixed(1)} sec`);

    const txValid = Proof.verify(this.snarkParams.transferVk!, txProof.inputs, txProof.proof);
    if (!txValid) {
      throw new Error('invalid tx proof');
    }

    return await sendTransaction(token.relayerUrl, txProof, txData.memo, txType);
  }

  public async withdraw(tokenAddress: string, address: string, amountWei: string, fee: string = '0'): Promise<string> {
    const token = this.tokens[tokenAddress];
    const state = this.zpStates[tokenAddress];

    if (BigInt(amountWei) < state.denominator) {
      throw new Error('Value is too small');
    }

    await this.updateState(tokenAddress);

    const txType = TxType.Withdraw;
    const addressBin = hexToBuf(address);

    const amountGwei = (BigInt(amountWei) / state.denominator).toString();
    const txData = await state.account.createWithdraw({ amount: amountGwei, to: addressBin, fee, native_amount: '0', energy_amount: '0' });

    const startProofDate = Date.now();
    const txProof = await this.worker.proveTx(txData.public, txData.secret);
    const proofTime = (Date.now() - startProofDate) / 1000;
    console.log(`Proof calculation took ${proofTime.toFixed(1)} sec`);
    
    const txValid = Proof.verify(this.snarkParams.transferVk!, txProof.inputs, txProof.proof);
    if (!txValid) {
      throw new Error('invalid tx proof');
    }

    return await sendTransaction(token.relayerUrl, txProof, txData.memo, txType);
  }

  // return transaction hash on success or throw an error
  public async waitJobCompleted(tokenAddress: string, jobId: string): Promise<string> {
    const token = this.tokens[tokenAddress];

    const INTERVAL_MS = 1000;
    let hash;
    while (true) {
      const job = await getJob(token.relayerUrl, jobId);

      if (job === null) {
        console.error(`Job ${jobId} not found.`);
        throw new Error('Job ${jobId} not found');
      } else if (job.state === 'failed') {
        throw new Error('Transaction [job ${jobId}] failed');
      } else if (job.state === 'completed') {
        hash = job.txHash;
        break;
      }

      await new Promise(resolve => setTimeout(resolve, INTERVAL_MS));
    }

    console.info(`Transaction [job ${jobId}] successful: ${hash}`);

    return hash;
  }

  // TODO: Transaction list


  public async getTotalBalance(tokenAddress: string): Promise<string> {
    await this.updateState(tokenAddress);

    return this.zpStates[tokenAddress].getTotalBalance();
  }

  /**
   * @returns [total, account, note]
   */
  public async getBalances(tokenAddress: string): Promise<[string, string, string]> {
    await this.updateState(tokenAddress);

    return this.zpStates[tokenAddress].getBalances();
  }

  public async rawState(tokenAddress: string): Promise<any> {
    return await this.zpStates[tokenAddress].rawState();
  }
  
  public async getAllHistory(tokenAddress: string): Promise<HistoryRecord[]> {
    await this.updateState(tokenAddress);

    return await this.zpStates[tokenAddress].history.getAllHistory();
  }

  public async cleanState(tokenAddress: string): Promise<void> {
    await this.zpStates[tokenAddress].clean();
  }

  public async updateState(tokenAddress: string) {
    if (this.updateStatePromise == undefined) {
      this.updateStatePromise = this.updateStateNewWorker(tokenAddress).finally(() => {
        this.updateStatePromise = undefined;
      });
    } else {
      console.info(`The state currently updating, waiting for finish...`);
    }

    await this.updateStatePromise;
  }

  private async updateStateNewWorker(tokenAddress: string): Promise<void> {
    const OUTPLUSONE = CONSTANTS.OUT + 1;
    const BATCH_SIZE = 100;

    const zpState = this.zpStates[tokenAddress];
    const token = this.tokens[tokenAddress];
    const state = this.zpStates[tokenAddress];

    const startIndex = Number(zpState.account.nextTreeIndex());
    const nextIndex = Number((await info(token.relayerUrl)).deltaIndex);

    if (nextIndex > startIndex) {
      const startTime = Date.now();
      
      console.log(`⬇ Fetching transactions between ${startIndex} and ${nextIndex}...`);

      let batches: Promise<number>[] = [];

      for (let i = startIndex; i <= nextIndex; i = i + BATCH_SIZE * OUTPLUSONE) {
        let oneBatch = fetchTransactions(token.relayerUrl, BigInt(i), BATCH_SIZE).then( txs => {
          console.log(`Getting ${txs.length} transactions from index ${i}`);
          
          let txHashes: Record<number, string> = {};
          let indexedTxs: IndexedTx[] = [];
          for (let txIdx = 0; txIdx < txs.length; ++txIdx) {
            const tx = txs[txIdx];
            // Get the first leaf index in the tree
            const memo_idx = i + txIdx * OUTPLUSONE;
            
            // tx structure from relayer: commitment(32 bytes) + txHash(32 bytes) + memo
            // 1. Extract memo block
            const memo = tx.slice(128); // Skip commitment and txHash

            // 2. Get transaction commitment
            const commitment = tx.slice(0, 64)
            
            const indexedTx: IndexedTx = {
              index: memo_idx,
              memo: hexToBuf(memo),
              commitment: hexToBuf(commitment),
            }

            indexedTxs.push(indexedTx);
            txHashes[memo_idx] = '0x' + tx.substr(64, 64);
          }

          const decryptedMemos = state.account.cacheTxs(indexedTxs);
          this.logStateSync(i, i + txs.length * OUTPLUSONE, decryptedMemos);
          for (let decryptedMemoIndex = 0; decryptedMemoIndex < decryptedMemos.length; ++decryptedMemoIndex) {
            // save memos corresponding to the our account to restore history
            const myMemo = decryptedMemos[decryptedMemoIndex];
            myMemo.txHash = txHashes[myMemo.index];
            zpState.history.saveDecryptedMemo(myMemo);
            
            // try to convert history on the fly
            // let hist = convertToHistory(myMemo, txHash);
            // historyPromises.push(hist);
          }

          return txs.length;
        });
        batches.push(oneBatch);
      };

      let txCount = (await Promise.all(batches)).reduce((acc, cur) => acc + cur);;

      const msElapsed = Date.now() - startTime;
      const avgSpeed = msElapsed / txCount

      console.log(`Sync finished in ${msElapsed / 1000} sec | ${txCount} tx, avg speed ${avgSpeed.toFixed(1)} ms/tx`);

    } else {
      console.log(`Local state is up to date @${startIndex}`);
    }
  }

  public async logStateSync(startIndex: number, endIndex: number, decryptedMemos: DecryptedMemo[]) {
    const OUTPLUSONE = CONSTANTS.OUT + 1;
    for (let decryptedMemo of decryptedMemos) {
      if (decryptedMemo.index > startIndex) {
        console.info(`📝 Adding hashes to state (from index ${startIndex} to index ${decryptedMemo.index - OUTPLUSONE})`);
      }
      startIndex = decryptedMemo.index + OUTPLUSONE; 

      if (decryptedMemo.acc) {
        console.info(`📝 Adding account, notes, and hashes to state (at index ${decryptedMemo.index})`);
      } else {
        console.info(`📝 Adding notes and hashes to state (at index ${decryptedMemo.index})`);
      }
    }

    if (startIndex < endIndex) {
      console.info(`📝 Adding hashes to state (from index ${startIndex} to index ${endIndex - OUTPLUSONE})`);
    }
  }

  public free(): void {
    for (let state of Object.values(this.zpStates)) {
      state.free();
    }
  }
}
