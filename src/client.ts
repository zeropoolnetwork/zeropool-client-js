import { validateAddress, Output, Proof, DecryptedMemo, ITransferData } from 'libzkbob-rs-wasm-web';

import { SnarkParams, Tokens } from './config';
import { hexToBuf, toCompactSignature, truncateHexPrefix } from './utils';
import { ZkBobState } from './state';
import { TxType } from './tx';
import { NetworkBackend } from './networks/network';
import { CONSTANTS } from './constants';
import { HistoryRecord, HistoryTransactionType } from './history'
import { IndexedTx } from 'libzkbob-rs-wasm-web';

const MIN_TX_AMOUNT = BigInt(1);

export interface RelayerInfo {
  root: string;
  deltaIndex: string;
}

export interface BatchResult {
  txCount: number;
  maxMinedIndex: number;
  maxPendingIndex: number;
}

export interface TxAmount { // all values are in wei
  amount: bigint;  // tx amount (without fee)
  fee: bigint;  // fee 
  accountLimit: bigint;  // minimum account remainder after transaction
                         // (used for complex multi-tx transfers, default: 0)
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

export class ZkBobClient {
  private zpStates: { [tokenAddress: string]: ZkBobState };
  private worker: any;
  private snarkParams: SnarkParams;
  private tokens: Tokens;
  private config: ClientConfig;
  private updateStatePromise: Promise<boolean> | undefined;

  public static async create(config: ClientConfig): Promise<ZkBobClient> {
    const client = new ZkBobClient();
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
      client.zpStates[address] = await ZkBobState.create(config.sk, networkName, config.network.getRpcUrl(), BigInt(denominator));
    }

    return client;
  }

  public generateAddress(tokenAddress: string): string {
    const state = this.zpStates[tokenAddress];
    return state.account.generateAddress();
  }

  public async deposit(
    tokenAddress: string,
    amountGwei: string,
    sign: (data: string) => Promise<string>,
    fromAddress: string | null = null,
    feeGwei: string = '0',
  ): Promise<string> {
    const token = this.tokens[tokenAddress];
    const state = this.zpStates[tokenAddress];

    const bnAmountGwei = BigInt(amountGwei);
    const bnFeeGwei = BigInt(feeGwei);

    if (bnAmountGwei < MIN_TX_AMOUNT) {
      throw new Error(`Deposit is too small (less than ${MIN_TX_AMOUNT.toString()})`);
    }

    await this.updateState(tokenAddress);

    //const amountGwei = (BigInt(amountWei) / state.denominator).toString();
    let txData = await state.account.createDeposit({
      amount: (bnAmountGwei + bnFeeGwei).toString(),
      fee: feeGwei
    });

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
    amountGwei: string,
    signTypedData: (deadline: bigint, value: bigint) => Promise<string>,
    fromAddress: string | null = null,
    feeGwei: string = '0',
  ): Promise<string> {
    const token = this.tokens[tokenAddress];
    const state = this.zpStates[tokenAddress];

    const bnAmountGwei = BigInt(amountGwei);
    const bnFeeGwei = BigInt(feeGwei);

    if (bnAmountGwei < MIN_TX_AMOUNT) {
      throw new Error(`Deposit is too small (less than ${MIN_TX_AMOUNT.toString()})`);
    }

    await this.updateState(tokenAddress);

    let txData;
    if (fromAddress) {
      const deadline:bigint = BigInt(Math.floor(Date.now() / 1000) + 900)
      const holder = hexToBuf(fromAddress);
      txData = await state.account.createDepositPermittable({ 
        amount: (bnAmountGwei + bnFeeGwei).toString(),
        fee: feeGwei,
        deadline: String(deadline),
        holder
      });

      const startProofDate = Date.now();
      const txProof = await this.worker.proveTx(txData.public, txData.secret);
      const proofTime = (Date.now() - startProofDate) / 1000;
      console.log(`Proof calculation took ${proofTime.toFixed(1)} sec`);

      const txValid = Proof.verify(this.snarkParams.transferVk!, txProof.inputs, txProof.proof);
      if (!txValid) {
        throw new Error('invalid tx proof');
      }

      // permittable deposit signature should be calculated for the typed data
      const value = (bnAmountGwei + bnFeeGwei) * state.denominator;
      let signature = truncateHexPrefix(await signTypedData(deadline, value));

      if (this.config.network.isSignatureCompact()) {
        signature = toCompactSignature(signature);
      }

      return await sendTransaction(token.relayerUrl, txProof, txData.memo, TxType.BridgeDeposit, signature);

    } else {
      throw new Error('You must provide fromAddress for bridge deposit transaction ');
    }
  }

  // This method will fail when insufficent input notes (constants::IN) for transfer
  public async transferSingle(tokenAddress: string, outsGwei: Output[], feeGwei: string = '0'): Promise<string> {
    await this.updateState(tokenAddress);

    const token = this.tokens[tokenAddress];
    const state = this.zpStates[tokenAddress];

    const bnFeeGwei = BigInt(feeGwei);

    const txType = TxType.Transfer;
    const outGwei = outsGwei.map(({ to, amount }) => {
      if (!validateAddress(to)) {
        throw new Error('Invalid address. Expected a shielded address.');
      }

      const bnAmountGwei = BigInt(amount);

      if (bnAmountGwei < MIN_TX_AMOUNT) {
        throw new Error(`One of the values is too small (less than ${MIN_TX_AMOUNT.toString()})`);
      }

      return {
        to,
        amount: (bnAmountGwei + bnFeeGwei).toString(),
      }
    });

    const txData = await state.account.createTransfer({ outputs: outGwei, fee: feeGwei });

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

  // This method can produce several transactions in case of insufficient input notes (constants::IN per tx)
  public async transferMulti(tokenAddress: string, to: string, amountGwei: string, feeGwei: string = '0'): Promise<string[]> {
    const state = this.zpStates[tokenAddress];
    const token = this.tokens[tokenAddress];

    if (!validateAddress(to)) {
      throw new Error('Invalid address. Expected a shielded address.');
    }

    const bnAmountGwei = BigInt(amountGwei);

    if (bnAmountGwei < MIN_TX_AMOUNT) {
      throw new Error(`Transfer amount is too small (less than ${MIN_TX_AMOUNT.toString()})`);
    }

    const txParts = await this.getTransactionParts(tokenAddress, amountGwei, feeGwei);

    if (txParts.length == 0) {
      throw new Error('Cannot find appropriate multitransfer configuration (insufficient funds?)');
    }

    const transfers = txParts.map(({amount, fee, accountLimit}) => {
      const oneTransfer: ITransferData = {
        outputs: [{to, amount: (amount + fee).toString()}],
        fee: fee.toString(),
      };

      return oneTransfer;
    });

    const txsData = await state.account.createMultiTransfer(transfers);


    const txProofPromises = txsData.map(async (transfer) => {
      const startProofDate = Date.now();
      const txProof: Proof = await this.worker.proveTx(transfer.public, transfer.secret);
      const proofTime = (Date.now() - startProofDate) / 1000;
      console.log(`Proof calculation took ${proofTime.toFixed(1)} sec`);

      const txValid = Proof.verify(this.snarkParams.transferVk!, txProof.inputs, txProof.proof);
      if (!txValid) {
        throw new Error('invalid tx proof');
      }

      return {memo: transfer.memo, proof: txProof};
      //return sendTransaction(token.relayerUrl, txProof, transfer.memo, TxType.Transfer);
    });

    const proofs = await Promise.all(txProofPromises);

    let jobIds: string[] = [];
    for (let i = 0; i<proofs.length; i++) {
      let {memo, proof} = proofs[i];
      jobIds.push(await sendTransaction(token.relayerUrl, proof, memo, TxType.Transfer));
      if (i != proofs.length - 1) {
        // TODO: HARD workaround for multisending (relayer doesn't update optimistic index immediately)
        // remove this delay after adding multi-tx support to relayer
        await new Promise(function(resolve){ setTimeout(resolve, 60000);});
      }
    }
    
    return jobIds;
  }

  public async withdraw(tokenAddress: string, address: string, amountGwei: string, feeGwei: string = '0'): Promise<string> {
    const token = this.tokens[tokenAddress];
    const state = this.zpStates[tokenAddress];

    const bnAmountGwei = BigInt(amountGwei);
    const bnFeeGwei = BigInt(feeGwei);

    if (bnAmountGwei < MIN_TX_AMOUNT) {
      throw new Error(`Withdraw amount is too small (less than ${MIN_TX_AMOUNT.toString()})`);
    }

    await this.updateState(tokenAddress);

    const txType = TxType.Withdraw;
    const addressBin = hexToBuf(address);

    const txData = await state.account.createWithdraw({
      amount: (bnAmountGwei + bnFeeGwei).toString(),
      to: addressBin,
      fee: feeGwei,
      native_amount: '0',
      energy_amount: '0'
    });

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

  public async getTransactionParts(tokenAddress: string, amountGwei: string, feeGwei: string): Promise<Array<TxAmount>> {
    const state = this.zpStates[tokenAddress];
    await this.updateState(tokenAddress);

    let result: Array<TxAmount> = [];

    const usableNotes = state.usableNotes();
    const accountBalance = BigInt(state.accountBalance());

    let bnFeeGwei = BigInt(feeGwei);
    let remainAmount = BigInt(amountGwei);

    if (accountBalance >= remainAmount + bnFeeGwei) {
      result.push({amount: remainAmount, fee: bnFeeGwei, accountLimit: BigInt(0)});
    } else {
      let notesParts: Array<bigint> = [];
      let curPart = BigInt(0);
      for(let i = 0; i < usableNotes.length; i++) {
        const curNote = usableNotes[i][1];

        if (i > 0 && i%3 == 0) {
          notesParts.push(curPart);
          curPart = BigInt(0);
        }

        curPart += BigInt(curNote.b);

        if (i == usableNotes.length - 1) {
          notesParts.push(curPart);
        }
      }

      let oneTxPart = accountBalance;

      for(let i = 0; i < notesParts.length && remainAmount > 0; i++) {
        oneTxPart += notesParts[i];
        if (oneTxPart - bnFeeGwei > remainAmount) {
          oneTxPart = remainAmount + bnFeeGwei;
        }

        if(oneTxPart < bnFeeGwei) {
          break;
        }

        result.push({amount: oneTxPart - bnFeeGwei, fee: bnFeeGwei, accountLimit: BigInt(0)});

        remainAmount -= (oneTxPart - bnFeeGwei);
        oneTxPart = BigInt(0);
      }

      if(remainAmount > 0){
        result = [];
      }
    }

    return result;
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

  public async getOptimisticTotalBalance(tokenAddress: string): Promise<string> {
    const state = this.zpStates[tokenAddress];

    const confirmedBalance = await this.getTotalBalance(tokenAddress);
    const historyRecords = await this.getAllHistory(tokenAddress);

    let pendingDelta = BigInt(0);
    for (const oneRecord of historyRecords) {
      if (oneRecord.pending) {
        switch (oneRecord.type) {
          case HistoryTransactionType.Deposit:
          case HistoryTransactionType.TransferIn: {
            pendingDelta += oneRecord.amount;
            break;
          }
          case HistoryTransactionType.Withdrawal:
          case HistoryTransactionType.TransferOut: {
            pendingDelta -= oneRecord.amount;
            break;
          }

          default: break;
        }

        pendingDelta -= oneRecord.fee;
      }
    }

    return (BigInt(confirmedBalance) + (pendingDelta * state.denominator)).toString();
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

  public async isReadyToTransact(tokenAddress: string): Promise<boolean> {
    return await this.updateState(tokenAddress);
  }

  public async waitReadyToTransact(tokenAddress: string): Promise<boolean> {
    const token = this.tokens[tokenAddress];

    const INTERVAL_MS = 1000;
    const MAX_ATTEMPTS = 300;
    let attepts = 0;
    while (true) {
      let ready = await this.updateState(tokenAddress);

      if (ready) {
        break;
      }

      attepts++;
      if (attepts > MAX_ATTEMPTS) {
        return false;
      }

      await new Promise(resolve => setTimeout(resolve, INTERVAL_MS));
    }

    return true;
  }

  public async cleanState(tokenAddress: string): Promise<void> {
    await this.zpStates[tokenAddress].clean();
  }

  public async updateState(tokenAddress: string): Promise<boolean> {
    if (this.updateStatePromise == undefined) {
      this.updateStatePromise = this.updateStateOptimisticWorker(tokenAddress).finally(() => {
        this.updateStatePromise = undefined;
      });
    } else {
      console.info(`The state currently updating, waiting for finish...`);
    }

    return this.updateStatePromise;
  }

  // Deprecated method. Please use updateStateOptimisticWorker instead
  private async updateStateWorker(tokenAddress: string): Promise<boolean> {
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
            zpState.history.saveDecryptedMemo(myMemo, false);
            
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

    // Unoptimistic method: it's assumes we always ready to transact
    // (but transaction could fail due to doublespend reason)
    return true;
  }

  // ---===< TODO >===---
  // The optimistic state currently processed only in the client library
  // Wasm package holds only the mined transactions
  // Currently it's juat a workaround
  private async updateStateOptimisticWorker(tokenAddress: string): Promise<boolean> {
    const OUTPLUSONE = CONSTANTS.OUT + 1;
    const BATCH_SIZE = 10000;

    const zpState = this.zpStates[tokenAddress];
    const token = this.tokens[tokenAddress];
    const state = this.zpStates[tokenAddress];

    const startIndex = Number(zpState.account.nextTreeIndex());
    const nextIndex = Number((await info(token.relayerUrl)).deltaIndex);
    // TODO: it's just a workaroud while relayer doesn't return optimistic index!
    const optimisticIndex = nextIndex + 1;

    if (optimisticIndex > startIndex) {
      const startTime = Date.now();
      
      console.log(`⬇ Fetching transactions between ${startIndex} and ${nextIndex}...`);

      
      let batches: Promise<BatchResult>[] = [];

      let readyToTransact = true;

      for (let i = startIndex; i <= nextIndex; i = i + BATCH_SIZE * OUTPLUSONE) {
        let oneBatch = fetchTransactionsOptimistic(token.relayerUrl, BigInt(i), BATCH_SIZE).then( txs => {
          console.log(`Getting ${txs.length} transactions from index ${i}`);
          
          let txHashes: Record<number, string> = {};
          let indexedTxs: IndexedTx[] = [];

          let txHashesPending: Record<number, string> = {};
          let indexedTxsPending: IndexedTx[] = [];

          let maxMinedIndex = -1;
          let maxPendingIndex = -1;

          for (let txIdx = 0; txIdx < txs.length; ++txIdx) {
            const tx = txs[txIdx];
            // Get the first leaf index in the tree
            const memo_idx = i + txIdx * OUTPLUSONE;
            
            // tx structure from relayer: mined flag + txHash(32 bytes, 64 chars) + commitment(32 bytes, 64 chars) + memo
            // 1. Extract memo block
            const memo = tx.slice(129); // Skip mined flag, txHash and commitment

            // 2. Get transaction commitment
            const commitment = tx.substr(65, 64)
            
            const indexedTx: IndexedTx = {
              index: memo_idx,
              memo: hexToBuf(memo),
              commitment: hexToBuf(commitment),
            }

            // 3. Get txHash
            const txHash = tx.substr(1, 64);

            // 4. Get mined flag
            if (tx.substr(0, 1) === '1') {
              indexedTxs.push(indexedTx);
              txHashes[memo_idx] = '0x' + txHash;
              maxMinedIndex = Math.max(maxMinedIndex, memo_idx);
            } else {
              indexedTxsPending.push(indexedTx);
              txHashesPending[memo_idx] = '0x' + txHash;
              maxPendingIndex = Math.max(maxPendingIndex, memo_idx);
            }
          }

          const decryptedMemos = state.account.cacheTxs(indexedTxs);
          this.logStateSync(i, i + txs.length * OUTPLUSONE, decryptedMemos);
          for (let decryptedMemoIndex = 0; decryptedMemoIndex < decryptedMemos.length; ++decryptedMemoIndex) {
            // save memos corresponding to the our account to restore history
            const myMemo = decryptedMemos[decryptedMemoIndex];
            myMemo.txHash = txHashes[myMemo.index];
            zpState.history.saveDecryptedMemo(myMemo, false);
          }

          const decryptedPendingMemos = state.account.decodeTxs(indexedTxsPending);
          for (let idx = 0; idx < decryptedPendingMemos.length; ++idx) {
            // save memos corresponding to the our account to restore history
            const myMemo = decryptedPendingMemos[idx];
            myMemo.txHash = txHashesPending[myMemo.index];
            zpState.history.saveDecryptedMemo(myMemo, true);

            if (myMemo.acc != undefined) {
              // There is a pending transaction initiated by ourselfs
              // So we cannot create new transactions in that case
              readyToTransact = false;
            }
          }

          return {txCount: txs.length, maxMinedIndex, maxPendingIndex} ;
        });
        batches.push(oneBatch);
      };

      let initRes: BatchResult = {txCount: 0, maxMinedIndex: -1, maxPendingIndex: -1}
      let totalRes = (await Promise.all(batches)).reduce((acc, cur) => {
        return {
          txCount: acc.txCount + cur.txCount,
          maxMinedIndex: Math.max(acc.maxMinedIndex, cur.maxMinedIndex),
          maxPendingIndex: Math.max(acc.maxPendingIndex, cur.maxPendingIndex),
        }
      }, initRes);

      // remove unneeded pending records
      zpState.history.setLastMinedTxIndex(totalRes.maxMinedIndex);
      zpState.history.setLastPendingTxIndex(totalRes.maxPendingIndex);


      const msElapsed = Date.now() - startTime;
      const avgSpeed = msElapsed / totalRes.txCount

      console.log(`Sync finished in ${msElapsed / 1000} sec | ${totalRes.txCount} tx, avg speed ${avgSpeed.toFixed(1)} ms/tx`);

      return readyToTransact;
    } else {
      console.log(`Local state is up to date @${startIndex}`);

      return true;
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
