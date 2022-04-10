import { assembleAddress, Account, Note, validateAddress, Output, Proof } from 'libzeropool-rs-wasm-web';

import { SnarkParams, Tokens } from './config';
import { hexToBuf, toCompactSignature, truncateHexPrefix } from './utils';
import { ZeroPoolState } from './state';
import { parseHashes, TxType } from './tx';
import { NetworkBackend } from './networks/network';
import { CONSTANTS } from './constants';
import { HistoryTransactionType, HistoryRecord, HistoryRecordIdx, HistoryStorage, DecryptedMemo, convertToHistory } from './history'

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
      client.zpStates[address] = await ZeroPoolState.create(config.sk, networkName, BigInt(denominator));
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
    isBridge: boolean = false
  ): Promise<string> {
    const token = this.tokens[tokenAddress];
    const state = this.zpStates[tokenAddress];

    if (BigInt(amountWei) < state.denominator) {
      throw new Error('Value is too small');
    }

    await this.updateState(tokenAddress);

    const txType = isBridge ? TxType.BridgeDeposit : TxType.Deposit;
    const amountGwei = (BigInt(amountWei) / state.denominator).toString();
    const txData = await state.account.createDeposit({ amount: amountGwei, fee });

    const startProofDate = Date.now();
    const txProof = await this.worker.proveTx(txData.public, txData.secret);
    const proofTime = (Date.now() - startProofDate) / 1000;
    console.log(`Proof calculation took ${proofTime.toFixed(1)} sec`);

    const txValid = Proof.verify(this.snarkParams.transferVk!, txProof.inputs, txProof.proof);
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

  // TODO: Verify the information sent by the relayer!
  public async updateState(tokenAddress: string): Promise<void> {
    const OUTPLUSONE = CONSTANTS.OUT + 1;
    const BATCH_SIZE = 100;

    const zpState = this.zpStates[tokenAddress];
    const token = this.tokens[tokenAddress];

    const startIndex = Number(zpState.account.nextTreeIndex());
    const nextIndex = Number((await info(token.relayerUrl)).deltaIndex);

    if (nextIndex > startIndex) {
      const startTime = Date.now();
      
      console.log(`⬇ Fetching transactions between ${startIndex} and ${nextIndex}...`);

      let curBatch = 0;
      let isLastBatch = false;
      let historyPromises: Promise<HistoryRecordIdx[]>[] = [];
      do {
        const txs = (await fetchTransactions(token.relayerUrl, BigInt(startIndex + curBatch * BATCH_SIZE * OUTPLUSONE), BATCH_SIZE))
          .filter((val) => !!val);

        // TODO: Error handling 

        if (txs.length < BATCH_SIZE) {
          isLastBatch = true;
        }

        let rpc = this.config.network.getRpcUrl();

        for (let i = 0; i < txs.length; ++i) {
          const tx = txs[i];

          if (!tx || tx.length < 128) {
            continue;
          }


          // tx structure from relayer: commitment(32 bytes) + txHash(32 bytes) + memo
          const memo = tx.slice(128); // Skip commitment

          const memo_idx = startIndex + (curBatch * BATCH_SIZE + i) * OUTPLUSONE;

          // workaround relayer bug: it returns mem
          const hashes = parseHashes(memo);
          let result = this.cacheShieldedTx(tokenAddress, memo, hashes, memo_idx);

          if (result) {
            const txHash = '0x' + tx.substr(64, 64);
            let hist = convertToHistory(result, txHash, rpc);
            historyPromises.push(hist);
            /*convertToHistory(result, txHash, rpc).then( records => {
              for (let oneRec of records) {
                console.log(`History record @${oneRec.index}: ${oneRec.record.toJson()}`);
                zpState.history.put(oneRec.index, oneRec.record);
              };
            }, reason => {
              console.error(reason);
            });*/
          }

          // try history storage
          //let record = new HistoryRecord(HistoryTransactionType.Deposit, 0, "from me", "to you", BigInt(1000), "0xa95524d81e91f6eb92a72de3cbe85c07489587c163ab92ca205d453c53b23f76");
          //state.history.put(index, record);
        }

        ++curBatch;

      } while (!isLastBatch);

      const msElapsed = Date.now() - startTime;
      const txCount = (nextIndex - startIndex) / 128;
      const avgSpeed = msElapsed / txCount

      console.log(`Sync finished in ${msElapsed / 1000} sec | ${txCount} tx, avg speed ${avgSpeed.toFixed(1)} ms/tx`);


      let historyRedords = await Promise.all(historyPromises);
      for (let oneSet of historyRedords) {
        for (let oneRec of oneSet) {
          console.log(`History record @${oneRec.index} has been created`);
          zpState.history.put(oneRec.index, oneRec.record);
        }
      }

      console.log(`History has been synced`);


      // Pass the obtained data to the history resolver
      // Do not wait for finishing (it's not important for making transactions)
      //this.updateHistory(decryptedMemos);

    } else {
      console.log(`Local state is up to date @${startIndex}...`);
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
      // It's definitely our transaction since accound was decrypted
      const in_notes = pair.notes.reduce<{ note: Note, index: number }[]>((acc, note, noteIndex) => {
        const address = assembleAddress(note.d, note.p_d);
        if (state.account.isOwnAddress(address)) {
          acc.push({ note, index: index + 1 + noteIndex });
        }
        return acc;
      }, []);

      const out_notes = pair.notes.reduce<{ note: Note, index: number }[]>((acc, note, noteIndex) => {
        const address = assembleAddress(note.d, note.p_d);
        if (state.account.isOwnAddress(address) == false) {
          acc.push({ note, index: index + 1 + noteIndex });
        }
        return acc;
      }, []);

      console.info(`📝 Adding account, notes, and hashes to state (at index ${index})`);
      state.account.addAccount(BigInt(index), hashes, pair.account, in_notes);


      return { index: index, acc: pair.account, inNotes: in_notes, outNotes: out_notes };

    } else {
      // Second try do decrypt incoming notes
      const onlyNotes = state.account.decryptNotes(data);

      if (onlyNotes.length > 0) {
        // There is definitely incoming notes (but transaction isn't our)

        // Get only our notes and update the indexes to the absolute values
        const notes = onlyNotes.reduce<{ note: Note, index: number }[]>((acc, idxNote) => {
          const address = assembleAddress(idxNote.note.d, idxNote.note.p_d);
          if (state.account.isOwnAddress(address)) {
            acc.push({ note: idxNote.note, index: index + 1 + idxNote.index });
          }
          return acc;
        }, []);

        console.info(`📝 Adding notes and hashes to state (at index ${index})`);
        state.account.addNotes(BigInt(index), hashes, notes);

        return { index: index, acc: undefined, inNotes: notes, outNotes: [] };

      } else {
        // This transaction isn't belongs to our account
        console.info(`📝 Adding hashes to state (at index ${index})`);
        state.account.addHashes(BigInt(index), hashes);
      }
    }

    //console.debug('New balance:', state.account.totalBalance());

    return undefined;
  }

  public free(): void {
    for (let state of Object.values(this.zpStates)) {
      state.free();
    }
  }
}
