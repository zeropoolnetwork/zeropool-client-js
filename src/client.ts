import { Note, Output, Proof } from 'libzeropool-rs-wasm-web';

import { SnarkParams, Tokens } from './config';
import { hexToBuf, toCompactSignature, truncateHexPrefix } from './utils';
import { ZeroPoolState } from './state';
import { parseHashes, TxType } from './tx';
import { NetworkBackend } from './networks/network';
import { CONSTANTS } from './constants';
import { HistoryTransactionType, HistoryRecord, HistoryRecordIdx, HistoryStorage, DecryptedMemo } from './history'
import { zp } from './zp';

export interface RelayerInfo {
  /** The current merkle tree root */
  root: string;
  /** Current transaction index in the pool */
  deltaIndex: string;
}

async function fetchTransactions(relayerUrl: string, offset: BigInt, limit: number = 100): Promise<string[]> {
  const url = new URL(`/transactions`, relayerUrl);
  url.searchParams.set('limit', limit.toString());
  url.searchParams.set('offset', offset.toString());
  const res = await (await fetch(url.toString())).json();

  return res;
}


async function fetchTransactionsOptimistic(relayerUrl: string, offset: BigInt, limit: number = 100): Promise<string[]> {
  const url = new URL(`/transactions/v2`, relayerUrl);
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

  /**
   * Create and send a deposit transaction to the relayer.
   * @param tokenAddress address of the token smart contract
   * @param amountWei non-denominated amount
   * @param sign general signature function
   * @param fromAddress address of the sender
   * @param fee relayer fee
   * @param isBridge 
   * @returns transaction hash
   */
  public async deposit(
    tokenAddress: string,
    amountWei: string,
    sign: (data: string) => Promise<string>,
    fromAddress: string | null = null,
    fee: string = '0',
    isBridge: boolean = false,
    outsWei: Output[] = [],
  ): Promise<string> {
    const token = this.tokens[tokenAddress];
    const state = this.zpStates[tokenAddress];

    if (BigInt(amountWei) < state.denominator) {
      throw new Error('Value is too small');
    }

    await this.updateState(tokenAddress);

    const outGwei = outsWei.map(({ to, amount }) => {
      if (!zp.validateAddress(to)) {
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

    const txType = isBridge ? TxType.BridgeDeposit : TxType.Deposit;
    const amountGwei = (BigInt(amountWei) / state.denominator).toString();
    const txData = state.account.createDeposit({ amount: amountGwei, fee, outputs: outGwei });

    const startProofDate = Date.now();
    const txProof = await this.worker.proveTx(txData.public, txData.secret);
    const proofTime = (Date.now() - startProofDate) / 1000;
    console.log(`Proof calculation took ${proofTime.toFixed(1)} sec`);

    const txValid = zp.Proof.verify(this.snarkParams.transferVk!, txProof.inputs, txProof.proof);
    if (!txValid) {
      throw new Error('invalid tx proof');
    }

    const nullifier = '0x' + BigInt(txData.public.nullifier).toString(16).padStart(64, '0');

    // TODO: Sign fromAddress as well?
    const signature = truncateHexPrefix(await sign(nullifier));
    let fullSignature = signature;
    if (fromAddress) {
      const addr = truncateHexPrefix(fromAddress);
      fullSignature = addr + signature;
    }

    if (this.config.network.isSignatureCompact()) {
      fullSignature = toCompactSignature(fullSignature);
    }

    return await sendTransaction(token.relayerUrl, txProof, txData.memo, txType, fullSignature);
  }

  /**
   * Create and send a transfer transaction to the relayer.
   * @param tokenAddress address of the token smart contract
   * @param outsWei one or multiple outputs of the transaction
   * @param fee relayer fee
   * @returns transaction hash
   */
  public async transfer(tokenAddress: string, outsWei: Output[], fee: string = '0'): Promise<string> {
    await this.updateState(tokenAddress);

    const token = this.tokens[tokenAddress];
    const state = this.zpStates[tokenAddress];

    const txType = TxType.Transfer;
    const outGwei = outsWei.map(({ to, amount }) => {
      if (!zp.validateAddress(to)) {
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

    const txData = state.account.createTransfer({ outputs: outGwei, fee });

    const startProofDate = Date.now();
    const txProof = await this.worker.proveTx(txData.public, txData.secret);
    const proofTime = (Date.now() - startProofDate) / 1000;
    console.log(`Proof calculation took ${proofTime.toFixed(1)} sec`);

    const txValid = zp.Proof.verify(this.snarkParams.transferVk!, txProof.inputs, txProof.proof);
    if (!txValid) {
      throw new Error('invalid tx proof');
    }

    return await sendTransaction(token.relayerUrl, txProof, txData.memo, txType);
  }

  /**
   * Create and send a withdraw transaction to the relayer.
   * @param tokenAddress address of the token smart contract
   * @param address withdraw recipient address
   * @param amountWei non-denominated amount
   * @param fee relayer fee
   * @returns transaction hash
   */
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
    const txData = state.account.createWithdraw({ amount: amountGwei, to: addressBin, fee, native_amount: '0', energy_amount: '0' });

    const startProofDate = Date.now();
    const txProof = await this.worker.proveTx(txData.public, txData.secret);
    const proofTime = (Date.now() - startProofDate) / 1000;
    console.log(`Proof calculation took ${proofTime.toFixed(1)} sec`);
    
    const txValid = zp.Proof.verify(this.snarkParams.transferVk!, txProof.inputs, txProof.proof);
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


  /**
   * Get the user's total pool balance (account + notes).
   * @param tokenAddress 
   * @returns non-denominated balance
   */
  public async getTotalBalance(tokenAddress: string): Promise<string> {
    await this.updateState(tokenAddress);

    return this.zpStates[tokenAddress].getTotalBalance();
  }

  /**
   * Get the user's account balances.
   * @returns [total, account, note]
   */
  public async getBalances(tokenAddress: string): Promise<[string, string, string]> {
    await this.updateState(tokenAddress);

    return this.zpStates[tokenAddress].getBalances();
  }

  /** Returns an object representation of the inner state for debug purposes.  */
  public async rawState(tokenAddress: string): Promise<any> {
    return await this.zpStates[tokenAddress].rawState();
  }
  
  public async getAllHistory(tokenAddress: string): Promise<HistoryRecord[]> {
    await this.updateState(tokenAddress);

    return await this.zpStates[tokenAddress].history.getAllHistory();
  }

  /** Synchronize the inner state with the relayer */
  public async updateState(tokenAddress: string) {
    await this.updateStateNewWorker(tokenAddress);
  }

  private getLatestMinedIndex(tokenAddress: string): number {
    return Number(localStorage.getItem(`zp.${tokenAddress}.latestMinedIndex`) || '0');
  }

  private setLatestMinedIndex(tokenAddress: string, index: number): void {
    console.log(`New mined index: ${index}`);
    localStorage.setItem(`zp.${tokenAddress}.latestMinedIndex`, index.toString());
  }

  private async updateStateNewWorker(tokenAddress: string): Promise<void> {
    const OUTPLUSONE = CONSTANTS.OUT + 1;
    const BATCH_SIZE = 1000;

    const zpState = this.zpStates[tokenAddress];
    const token = this.tokens[tokenAddress];

    const startIndex = this.getLatestMinedIndex(tokenAddress);
    const nextIndex = Number((await info(token.relayerUrl)).deltaIndex) + 1;
    const optimisticLocalIndex = Number(zpState.account.nextTreeIndex()) - OUTPLUSONE;

    // if (optimisticLocalIndex > startIndex) {
    //   console.log(`Performing maintance rollback from ${optimisticLocalIndex} to ${startIndex}...`);
    //   // Remove locally unconfirmed transactions and retrieve them all other again.
    //   // This is a temporary and the least error-prone solution.
    //   zpState.account.rollback(BigInt(startIndex + OUTPLUSONE));
    // }

    if (nextIndex > startIndex) {
      const startTime = Date.now();
      
      console.log(`⬇ Fetching transactions between ${startIndex} and ${nextIndex}...`);

      let batches: Promise<number>[] = [];

      let latestMinedIndex = this.getLatestMinedIndex(tokenAddress);
      for (let i = startIndex; i <= nextIndex; i = i + BATCH_SIZE * OUTPLUSONE) {
        let oneBatch = fetchTransactionsOptimistic(token.relayerUrl, BigInt(i), BATCH_SIZE).then(txs => {
          console.log(`Getting ${txs.length} transactions from index ${i}`);
          for (let txIdx = 0; txIdx < txs.length; ++txIdx) {
            const tx = txs[txIdx];
            // Get the first leaf index in the tree
            const memo_idx = i + txIdx * OUTPLUSONE;
            
            // tx structure from relayer: commitment(32 bytes) + txHash(32 bytes) + memo
            // 1. Extract memo block
            const memo = tx.slice(129); // Skip mined flag, txHash and commitment

            // 2. Get all hashes from the memo
            const hashes = parseHashes(memo);

            // 3. Save necessary parameters and extract memo (only if it corresponds to current account)
            let myMemo = this.cacheShieldedTx(tokenAddress, memo, hashes, memo_idx);
            const mined = tx.slice(0, 1) == '1';

            if (mined && memo_idx > latestMinedIndex) {
              latestMinedIndex = memo_idx;
            }

            if (myMemo) {
              // if memo block corresponds to the our account - save it to restore history
              myMemo.txHash = '0x' + tx.substr(64, 64);
              zpState.history.saveDecryptedMemo(myMemo);
            }
          }

          return txs.length;
        });
        batches.push(oneBatch);
      };

      let txCount = (await Promise.all(batches)).reduce((acc, cur) => acc + cur);

      if (latestMinedIndex > this.getLatestMinedIndex(tokenAddress)) {
        this.setLatestMinedIndex(tokenAddress, latestMinedIndex);
      }

      const msElapsed = Date.now() - startTime;
      const avgSpeed = msElapsed / txCount

      console.log(`Sync finished in ${msElapsed / 1000} sec | ${txCount} tx, avg speed ${avgSpeed.toFixed(1)} ms/tx`);

    } else {
      console.log(`Local state is up to date @${startIndex}`);
    }
  }

  /**
   * Attempt to extract and save usable account/notes from transaction data.
   * Return decrypted account and notes to proceed history restoring
   * @param raw hex-encoded transaction data
   */
  private cacheShieldedTx(tokenAddress: string, ciphertext: string, hashes: string[], index: number): DecryptedMemo | undefined {
    const state = this.zpStates[tokenAddress];

    const data = hexToBuf(ciphertext);

    // First try do decrypt account and outcoming notes
    const pair = state.account.decryptPair(data);

    if (pair) {
      let in_notes: { note: Note, index: number }[] = [];
      let out_notes: { note: Note, index: number }[] = [];
      for (let i = 0; i < pair.notes.length; ++i) {
        const note = pair.notes[i];
        const address = zp.assembleAddress(note.d, note.p_d);
        if (state.account.isOwnAddress(address)) {
          out_notes.push({ note, index: index + 1 + i });
          in_notes.push({ note, index: index + 1 + i });
        } else {
          out_notes.push({ note, index: index + 1 + i });
        }
      }


      console.info(`📝 Adding account, notes, and hashes to state (at index ${index})`);
      state.account.addAccount(BigInt(index), hashes, pair.account, in_notes);


      return { index: index, acc: pair.account, inNotes: in_notes, outNotes: out_notes, txHash: undefined };

    } else {
      // Second try do decrypt incoming notes
      const onlyNotes = state.account.decryptNotes(data);

      if (onlyNotes.length > 0) {
        // There is definitely incoming notes (but transaction isn't our)

        // Get only our notes and update the indexes to the absolute values
        const notes = onlyNotes.reduce<{ note: Note, index: number }[]>((acc, idxNote) => {
          const address = zp.assembleAddress(idxNote.note.d, idxNote.note.p_d);
          if (state.account.isOwnAddress(address)) {
            acc.push({ note: idxNote.note, index: index + 1 + idxNote.index });
          }
          return acc;
        }, []);

        console.info(`📝 Adding notes and hashes to state (at index ${index})`);
        state.account.addNotes(BigInt(index), hashes, notes);

        return { index: index, acc: undefined, inNotes: notes, outNotes: [], txHash: undefined };

      } else {
        // This transaction isn't belongs to our account
        console.info(`📝 Adding hashes to state (at index ${index})`);
        state.account.addHashes(BigInt(index), hashes);
      }
    }

    // console.debug('New balance:', state.account.totalBalance());

    return undefined;
  }

  public free(): void {
    for (let state of Object.values(this.zpStates)) {
      state.free();
    }
  }
}
