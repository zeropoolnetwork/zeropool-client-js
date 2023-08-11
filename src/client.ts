import type { Output, Proof, DecryptedMemo, ParseTxsResult, StateUpdate, IndexedTx } from 'libzeropool-rs-wasm-web';
import BN from 'bn.js';

import { SnarkParams, Tokens } from './config';
import { ZeroPoolState } from './state';
import { TxType } from './tx';
import { NetworkBackend } from './networks/network';
import { CONSTANTS } from './constants';
import { HistoryRecord, HistoryTransactionType } from './history';
import { zp } from './zp';
import { RelayerAPI, TxToRelayer } from './relayer';

const MIN_TX_AMOUNT = new BN(10000000);
const BATCH_SIZE = 100;

export type Amount = string | number | BN | bigint;

export interface BatchResult {
  txCount: number;
  maxMinedIndex: number;
  maxPendingIndex: number;
  state: Map<number, StateUpdate>;  // key: first tx index,
  // value: StateUpdate object (notes, accounts, leafs and commitments)
}

export interface TxAmount { // all values are in Gwei
  amount: BN;  // tx amount (without fee)
  fee: BN;  // fee 
  accountLimit: BN;  // minimum account remainder after transaction
  // (used for complex multi-tx transfers, default: 0)
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
  private relayerFee: BN | undefined; // in wei, do not use directly, use getRelayerFee method instead
  private updateStatePromise: Promise<boolean> | undefined;
  private relayer: RelayerAPI;

  public static async create(config: ClientConfig): Promise<ZeropoolClient> {
    const client = new ZeropoolClient();
    client.zpStates = {};
    client.worker = config.worker;
    client.snarkParams = config.snarkParams;
    client.tokens = config.tokens;
    client.config = config;
    client.relayer = new RelayerAPI(config.tokens);
    client.relayerFee = undefined;

    let networkName = config.networkName;
    if (!networkName) {
      networkName = config.network.defaultNetworkName();
    }

    for (const [address, token] of Object.entries(config.tokens)) {
      const denominator = await config.network.getDenominator(token.poolAddress);
      client.zpStates[address] = await ZeroPoolState.create(config.sk, networkName, config.network, denominator);
    }

    return client;
  }

  public free(): void {
    for (let state of Object.values(this.zpStates)) {
      state.free();
    }
  }

  // ------------------=========< Balances and History >=========-------------------
  // | Quering shielded balance and history records                                |
  // -------------------------------------------------------------------------------

  // Pool contract using default denominator 10^9
  // i.e. values less than 1 Gwei are supposed equals zero
  // But this is deployable parameter so this method are using to retrieve it
  public getDenominator(tokenAddress: string): BN {
    return this.zpStates[tokenAddress].denominator;
  }

  // Convert native pool amount to the base units
  public shieldedAmountToWei(tokenAddress, amountShielded: Amount): BN {
    const amountShieldedBn = new BN(amountShielded.toString());
    return amountShieldedBn.mul(this.zpStates[tokenAddress].denominator);
  }

  // Convert base units to the native pool amount
  public weiToShieldedAmount(tokenAddress, amountWei: Amount): BN {
    const amountWeiBn = new BN(amountWei.toString());
    return amountWeiBn.div(this.zpStates[tokenAddress].denominator)
  }

  // Get account + notes balance in wei
  // [with optional state update]
  public async getTotalBalance(tokenAddress: string, updateState: boolean = true): Promise<BN> {
    if (updateState) {
      await this.updateState(tokenAddress);
    }

    return this.zpStates[tokenAddress].getTotalBalance();
  }

  // Get total balance with components: account and notes
  // [with optional state update]
  // Returns [total, account, note] in wei
  public async getBalances(tokenAddress: string, updateState: boolean = true): Promise<[BN, BN, BN]> {
    if (updateState) {
      await this.updateState(tokenAddress);
    }

    return this.zpStates[tokenAddress].getBalances();
  }

  // Get total balance including transactions in optimistic state [in wei]
  // There is no option to prevent state update here,
  // because we should always monitor optimistic state
  public async getOptimisticTotalBalance(tokenAddress: string, updateState: boolean = true): Promise<BN> {
    const confirmedBalance = await this.getTotalBalance(tokenAddress, updateState);
    const historyRecords = await this.getAllHistory(tokenAddress, updateState);
    const denominator = this.getDenominator(tokenAddress);

    let pendingDelta = new BN(0);
    for (const oneRecord of historyRecords) {
      if (oneRecord.pending) {
        const amount = new BN(oneRecord.amount);
        const fee = new BN(oneRecord.fee);
        switch (oneRecord.type) {
          case HistoryTransactionType.Deposit:
          case HistoryTransactionType.TransferIn: {
            // we don't spend fee from the shielded balance in case of deposit or input transfer
            pendingDelta.iadd(amount.mul(denominator));
            break;
          }
          case HistoryTransactionType.Withdrawal:
          case HistoryTransactionType.TransferOut: {
            pendingDelta.isub(amount.add(fee).mul(denominator));
            break;
          }

          default: break;
        }
      }
    }

    return confirmedBalance.add(pendingDelta);
  }

  public async getOptimisticTokenBalanceDelta(tokenAddress: string, address: string, updateState: boolean = true): Promise<BN> {
    const history = await this.getAllHistory(tokenAddress, updateState);
    const pending = history.filter((h) => h.pending);

    let pendingDeltaDenominated = new BN(0);

    for (const h of pending) {
      const amount = new BN(h.amount);
      switch (h.type) {
        case HistoryTransactionType.Deposit: {
          if (!this.config.network.approveChangesBalance) {
            pendingDeltaDenominated.isub(amount);
          }

          break;
        }
        case HistoryTransactionType.Withdrawal: {
          if (h.to.toLowerCase() === address.toLowerCase()) {
            pendingDeltaDenominated.iadd(amount);
          }
          break;
        }

        default: break;
      }
    }

    return pendingDeltaDenominated.mul(this.getDenominator(tokenAddress));
  }

  public getState(tokenAddress: string): ZeroPoolState {
    return this.zpStates[tokenAddress];
  }

  // Get history records
  public async getAllHistory(tokenAddress: string, updateState: boolean = true): Promise<HistoryRecord[]> {
    if (updateState) {
      await this.updateState(tokenAddress);
    }

    return await this.zpStates[tokenAddress].history.getAllHistory();
  }

  // ------------------=========< Service Routines >=========-------------------
  // | Methods for creating and sending transactions in different modes        |
  // ---------------------------------------------------------------------------

  // Generate shielded address to receive funds
  public generateAddress(tokenAddress: string): string {
    const state = this.zpStates[tokenAddress];
    return state.account.generateAddress();
  }

  // Waiting while relayer process the jobs set
  public async waitJobsCompleted(tokenAddress: string, jobIds: string[]): Promise<{ jobId: string, txHash: string }[]> {
    let promises = jobIds.map(async (jobId) => {
      const txHashes: string[] = await this.waitJobCompleted(tokenAddress, jobId);
      return { jobId, txHash: txHashes[0] };
    });

    return Promise.all(promises);
  }

  // Waiting while relayer process the job
  // return transaction(s) hash(es) on success or throw an error
  public async waitJobCompleted(tokenAddress: string, jobId: string): Promise<string[]> {
    const state = this.zpStates[tokenAddress];

    const INTERVAL_MS = 1000;
    let hashes: string[] = [];
    while (true) {
      const job = await this.relayer.getJob(tokenAddress, jobId);

      if (job === null) {
        console.error(`Job ${jobId} not found.`);
        throw new Error(`Job ${jobId} not found`);
      } else if (job.state === 'failed') {
        throw new Error(`Transaction [job ${jobId}] failed with reason: '${job.failedReason}'`);
      } else if (job.state === 'completed') {
        if (Array.isArray(job.txHash)) {
          hashes = job.txHash;
        } else {
          hashes.push(job.txHash);
        }

        break;
      }

      await new Promise(resolve => setTimeout(resolve, INTERVAL_MS));
    }

    state.history.setTxHashesForQueuedTransactions(jobId, hashes);


    console.info(`Transaction [job ${jobId}] successful: ${hashes.join(", ")}`);

    return hashes;
  }

  // Waiting while relayer includes the job transaction in the optimistic state
  // return transaction(s) hash(es) on success or throw an error
  // TODO: change job state logic after relayer upgrade! <look for a `queued` state>
  public async waitJobQueued(tokenAddress: string, jobId: string): Promise<boolean> {
    const INTERVAL_MS = 1000;
    while (true) {
      const job = await this.relayer.getJob(tokenAddress, jobId);

      if (job === null) {
        console.error(`Job ${jobId} not found.`);
        throw new Error(`Job ${jobId} not found`);
      } else if (job.state === 'failed') {
        throw new Error(`Transaction [job ${jobId}] failed with reason: '${job.failedReason}'`);
      } else if (job.state === 'completed') {
        break;
      }

      await new Promise(resolve => setTimeout(resolve, INTERVAL_MS));
    }

    console.info(`Transaction [job ${jobId}] in optimistic state now`);

    return true;
  }

  // Deposit through approval allowance
  // User should approve allowance for contract address at least 
  // (amountGwei + feeGwei) tokens before calling this method
  // Returns jobId
  public async deposit(
    tokenAddress: string,
    amountWei: Amount,
    sign: (data: string) => Promise<string>,
    fromAddress: string,
    // it should be null for EVM
    feeWei: Amount = new BN(0),
    outsWei: Output[] = [],
    depositId: number | null = null,
  ): Promise<string> {
    const amountWeiBn = new BN(amountWei.toString());
    const feeWeiBn = new BN(feeWei.toString());
    const state = this.zpStates[tokenAddress];
    const denominator = this.getDenominator(tokenAddress);
    const amountGwei = amountWeiBn.div(denominator);
    const feeGwei = feeWeiBn.div(denominator);

    if (amountWeiBn.lt(MIN_TX_AMOUNT)) {
      throw new Error(`Deposit is too small (less than ${MIN_TX_AMOUNT.toString()})`);
    }

    await this.updateState(tokenAddress);

    const outsGwei = outsWei.map(({ to, amount }) => {
      if (!zp.validateAddress(to)) {
        throw new Error('Invalid address. Expected a shielded address.');
      }

      const amountBn = new BN(amount);

      if (amountBn.lt(MIN_TX_AMOUNT)) {
        throw new Error(`One of the values is too small (less than ${MIN_TX_AMOUNT.toString()})`);
      }

      return { to, amount: (amountBn.div(denominator)).toString() };
    });

    const optimisticState = await this.getNewState(tokenAddress)
    let txData = state.account.createDepositOptimistic({
      amount: (amountGwei.add(feeGwei)).toString(),
      fee: feeGwei.toString(),
      outputs: outsGwei,
    }, optimisticState);

    const extraData = await this.config.network.signNullifier(sign, new BN(txData.public.nullifier), fromAddress, depositId);

    const startProofDate = Date.now();
    console.log('Starting proof calculation...');
    const txProof = await this.worker.proveTx(txData.public, txData.secret);
    const proofTime = (Date.now() - startProofDate) / 1000;
    console.log(`Proof calculation took ${proofTime.toFixed(1)} sec`);

    const txValid = zp.Proof.verify(this.snarkParams.transferVk!, txProof.inputs, txProof.proof);
    if (!txValid) {
      throw new Error('invalid tx proof');
    }

    let tx: TxToRelayer = { txType: TxType.Deposit, memo: txData.memo, proof: txProof, extraData };
    const jobId = await this.relayer.sendTransactions(tokenAddress, [tx]);

    // Temporary save transaction in the history module (to prevent history delays)
    let totalTokenAmount = amountGwei.clone();
    for (let o of outsGwei) {
      totalTokenAmount.isub(new BN(o.amount));
    }
    const ts = Math.floor(Date.now() / 1000);
    let rec = HistoryRecord.deposit(fromAddress, totalTokenAmount, feeGwei, ts, "0", true);
    state.history.keepQueuedTransactions([rec], jobId);

    return jobId;
  }

  // Simple transfer to the shielded address. Supports several output addresses
  // This method will fail when insufficent input notes (constants::IN) for transfer
  public async transfer(tokenAddress: string, outsWei: Output[], feeWei: Amount = new BN(0)): Promise<string> {
    const feeWeiBn = new BN(feeWei.toString());

    await this.updateState(tokenAddress);

    const state = this.zpStates[tokenAddress];
    const denominator = this.getDenominator(tokenAddress);
    const feeGwei = feeWeiBn.div(denominator);

    const outGwei = outsWei.map(({ to, amount }) => {
      if (!zp.validateAddress(to)) {
        throw new Error('Invalid address. Expected a shielded address.');
      }

      const amountBn = new BN(amount);

      if (amountBn.lt(MIN_TX_AMOUNT)) {
        throw new Error(`One of the values is too small (less than ${MIN_TX_AMOUNT.toString()})`);
      }

      return { to, amount: (amountBn.div(denominator)).toString() };
    });

    const optimisticState = await this.getNewState(tokenAddress)
    const txData = state.account.createTransferOptimistic({ outputs: outGwei, fee: feeGwei.toString() }, optimisticState);

    const startProofDate = Date.now();
    const txProof = await this.worker.proveTx(txData.public, txData.secret);
    const proofTime = (Date.now() - startProofDate) / 1000;
    console.log(`Proof calculation took ${proofTime.toFixed(1)} sec`);

    const txValid = zp.Proof.verify(this.snarkParams.transferVk!, txProof.inputs, txProof.proof);
    if (!txValid) {
      throw new Error('invalid tx proof');
    }

    let tx = { txType: TxType.Transfer, memo: txData.memo, proof: txProof };
    const jobId = await this.relayer.sendTransactions(tokenAddress, [tx]);

    // Temporary save transactions in the history module (to prevent history delays)
    const feePerOut = feeGwei.div(new BN(outGwei.length));
    let recs = outGwei.map(({ to, amount }) => {
      const ts = Math.floor(Date.now() / 1000);
      if (state.isOwnAddress(to)) {
        return HistoryRecord.transferLoopback(to, new BN(amount), feePerOut, ts, "0", true);
      } else {
        return HistoryRecord.transferOut(to, new BN(amount), feePerOut, ts, "0", true);
      }
    });
    state.history.keepQueuedTransactions(recs, jobId);

    return jobId;
  }

  // Simple withdraw to the native address
  // This method will fail when insufficient input notes (constants::IN) for withdrawal
  public async withdraw(tokenAddress: string, address: string, amountWei: Amount, feeWei: Amount = new BN(0)): Promise<string> {
    const amountWeiBn = new BN(amountWei.toString());
    const feeWeiBn = new BN(feeWei.toString());
    const state = this.zpStates[tokenAddress];
    const denominator = this.getDenominator(tokenAddress);
    const amountGwei = amountWeiBn.div(denominator);
    const feeGwei = feeWeiBn.div(denominator);

    if (amountWeiBn.lt(MIN_TX_AMOUNT)) {
      throw new Error(`Withdraw amount is too small (less than ${MIN_TX_AMOUNT.toString()})`);
    }

    await this.updateState(tokenAddress);

    const optimisticState = await this.getNewState(tokenAddress)
    const addressBin = this.config.network.addressToBuffer(address);
    const txData = state.account.createWithdrawalOptimistic({
      amount: (amountGwei.add(feeGwei)).toString(),
      to: addressBin,
      fee: feeGwei.toString(),
      native_amount: '0',
      energy_amount: '0'
    }, optimisticState);

    let delta = zp.parseDelta(txData.public.delta);
    console.log(delta);

    const startProofDate = Date.now();
    const txProof = await this.worker.proveTx(txData.public, txData.secret);
    const proofTime = (Date.now() - startProofDate) / 1000;
    console.log(`Proof calculation took ${proofTime.toFixed(1)} sec`);

    const txValid = zp.Proof.verify(this.snarkParams.transferVk!, txProof.inputs, txProof.proof);
    if (!txValid) {
      throw new Error('invalid tx proof');
    }

    let tx = { txType: TxType.Withdraw, memo: txData.memo, proof: txProof };
    const jobId = await this.relayer.sendTransactions(tokenAddress, [tx]);

    // Temporary save transaction in the history module (to prevent history delays)
    const ts = Math.floor(Date.now() / 1000);
    let rec = HistoryRecord.withdraw(address, amountGwei, feeGwei, ts, "0", true);
    state.history.keepQueuedTransactions([rec], jobId);

    return jobId;
  }

  // ------------------=========< Transaction configuration >=========-------------------
  // | These methods includes fee estimation, multitransfer estimation and other inform |
  // | functions.                                                                       |
  // ------------------------------------------------------------------------------------

  // Min transaction fee in Gwei (e.g. deposit or single transfer)
  // To estimate fee in the common case please use feeEstimate instead
  public async atomicTxFee(tokenAddress: string): Promise<BN> {
    const fee = await this.getRelayerFee(tokenAddress);
    const l1 = new BN(0);

    return fee.add(l1);
  }

  // Relayer fee component. Do not use it directly
  private async getRelayerFee(tokenAddress: string): Promise<BN> {
    if (this.relayerFee === undefined) {
      // fetch actual fee from the relayer
      this.relayerFee = await this.relayer.fee(tokenAddress);
    }

    return this.relayerFee!.mul(this.getDenominator(tokenAddress));
  }

  // Account + notes balance excluding fee needed to transfer or withdraw it
  public async calcMaxAvailableTransfer(tokenAddress: string, updateState: boolean = true): Promise<BN> {
    const state = this.zpStates[tokenAddress];
    if (updateState) {
      await this.updateState(tokenAddress);
    }

    const txFee = await this.atomicTxFee(tokenAddress);
    const usableNotes = state.usableNotes();
    const accountBalance = state.accountBalance();
    let notesBalance = new BN(0);

    let txCnt = 1;
    if (usableNotes.length > CONSTANTS.IN) {
      txCnt += Math.ceil((usableNotes.length - CONSTANTS.IN) / CONSTANTS.IN);
    }

    for (let i = 0; i < usableNotes.length; i++) {
      const curNote = usableNotes[i][1];
      notesBalance.iadd(new BN(curNote.b));
    }

    let sum = accountBalance.add(notesBalance).sub(txFee.mul(new BN(txCnt)));
    if (sum.lt(new BN(0))) {
      sum = new BN(0);
    }

    return sum;
  }

  // Calculate multitransfer configuration for specified token amount and fee per transaction
  // Applicable for transfer and withdrawal transactions. You can prevent state updating with updateState flag
  public async getTransactionParts(tokenAddress: string, amountWei: Amount, feeWei: Amount, updateState: boolean = true): Promise<Array<TxAmount>> {
    const amountWeiBn = new BN(amountWei.toString());
    const feeWeiBn = new BN(feeWei.toString());
    const state = this.zpStates[tokenAddress];
    if (updateState) {
      await this.updateState(tokenAddress);
    }

    let result: Array<TxAmount> = [];

    const usableNotes = state.usableNotes();
    const accountBalance = state.accountBalance();

    let remainAmount = amountWeiBn.clone();

    if (accountBalance.gte(remainAmount.add(feeWeiBn))) {
      result.push({ amount: remainAmount, fee: feeWeiBn, accountLimit: new BN(0) });
    } else {
      let notesParts: Array<BN> = [];
      let curPart = new BN(0);
      for (let i = 0; i < usableNotes.length; i++) {
        const curNote = usableNotes[i][1];

        if (i > 0 && i % CONSTANTS.IN == 0) {
          notesParts.push(curPart);
          curPart = new BN(0);
        }

        curPart.iadd(new BN(curNote.b));

        if (i == usableNotes.length - 1) {
          notesParts.push(curPart);
        }
      }

      let oneTxPart = accountBalance.clone();

      for (let i = 0; i < notesParts.length && remainAmount.gt(new BN(0)); i++) {
        oneTxPart.iadd(notesParts[i]);
        if (oneTxPart.sub(feeWeiBn).gt(remainAmount)) {
          oneTxPart = remainAmount.add(feeWeiBn);
        }

        if (oneTxPart.lt(feeWeiBn) || oneTxPart.lt(MIN_TX_AMOUNT)) {
          break;
        }

        result.push({ amount: oneTxPart.sub(feeWeiBn), fee: feeWeiBn, accountLimit: new BN(0) });

        remainAmount.isub(oneTxPart.sub(feeWeiBn));
        oneTxPart = new BN(0);
      }

      if (remainAmount.gt(new BN(0))) {
        result = [];
      }
    }

    return result;
  }

  // ------------------=========< State Processing >=========-------------------
  // | Updating and monitoring state                                            |
  // ----------------------------------------------------------------------------

  // Getting array of accounts and notes for the current account
  public async rawState(tokenAddress: string): Promise<any> {
    return await this.zpStates[tokenAddress].rawState();
  }


  // TODO: implement correct state cleaning
  public async cleanState(tokenAddress: string): Promise<void> {
    await this.zpStates[tokenAddress].clean();
  }

  // Request the latest state from the relayer
  // Returns isReadyToTransact flag
  public async updateState(tokenAddress: string): Promise<boolean> {
    if (!this.updateStatePromise) {
      this.updateStatePromise = this.updateStateOptimisticWorker(tokenAddress).finally(() => {
        this.updateStatePromise = undefined;
      });
    } else {
      console.info(`The state currently updating, waiting for finish...`);
    }

    return this.updateStatePromise;
  }

  private async updateStateOptimisticWorker(tokenAddress: string): Promise<boolean> {
    const OUTPLUSONE = CONSTANTS.OUT + 1;

    const zpState = this.zpStates[tokenAddress];
    const state = this.zpStates[tokenAddress];

    const startIndex = Number(zpState.account.nextTreeIndex());
    const stateInfo = await this.relayer.info(tokenAddress);
    const nextIndex = Number(stateInfo.deltaIndex);
    const optimisticIndex = Number(stateInfo.optimisticDeltaIndex);

    if (optimisticIndex <= startIndex) {
      await zpState.history.setLastMinedTxIndex(nextIndex - OUTPLUSONE);
      await zpState.history.setLastPendingTxIndex(-1);

      console.log(`Local state is up to date @${startIndex}`);

      return true;
    }

    const startTime = Date.now();

    console.log(`⬇ Fetching transactions between ${startIndex} and ${optimisticIndex}...`);

    let batches: Promise<BatchResult>[] = [];
    let readyToTransact = true;

    for (let i = startIndex; i <= optimisticIndex; i = i + BATCH_SIZE * OUTPLUSONE) {
      let oneBatch = this.relayer.fetchTransactionsOptimistic(tokenAddress, new BN(i), BATCH_SIZE).then(async txs => {
        console.log(`Getting ${txs.length} transactions from index ${i}`);

        let batchState = new Map<number, StateUpdate>();

        let txHashes: Record<number, string> = {};
        let indexedTxs: IndexedTx[] = [];

        let txHashesPending: Record<number, string> = {};
        let indexedTxsPending: IndexedTx[] = [];

        let maxMinedIndex = -1;
        let maxPendingIndex = -1;

        for (let txIdx = 0; txIdx < txs.length; ++txIdx) {
          const tx = txs[txIdx];
          // Get the first leaf index in the tree
          const memoIdx = i + txIdx * OUTPLUSONE;

          const { mined, hash, commitment, memo } = this.config.network.disassembleRelayerTx(tx);

          const indexedTx: IndexedTx = {
            index: memoIdx,
            memo: memo,
            commitment: commitment,
          }

          // 4. Get mined flag
          if (mined) {
            indexedTxs.push(indexedTx);
            txHashes[memoIdx] = hash;
            maxMinedIndex = Math.max(maxMinedIndex, memoIdx);
          } else {
            indexedTxsPending.push(indexedTx);
            txHashesPending[memoIdx] = hash;
            maxPendingIndex = Math.max(maxPendingIndex, memoIdx);
          }
        }

        if (indexedTxs.length > 0) {
          const parseResult: ParseTxsResult = await this.worker.parseTxs(this.config.sk, indexedTxs);
          const decryptedMemos = parseResult.decryptedMemos;
          batchState.set(i, parseResult.stateUpdate);
          //state.account.updateState(parseResult.stateUpdate);
          this.logStateSync(i, i + txs.length * OUTPLUSONE, decryptedMemos);
          for (let decryptedMemoIndex = 0; decryptedMemoIndex < decryptedMemos.length; ++decryptedMemoIndex) {
            // save memos corresponding to the account to restore history
            const myMemo = decryptedMemos[decryptedMemoIndex];
            myMemo.txHash = txHashes[myMemo.index];
            await zpState.history.saveDecryptedMemo(myMemo, false);
          }
        }

        if (indexedTxsPending.length > 0) {
          const parseResult: ParseTxsResult = await this.worker.parseTxs(this.config.sk, indexedTxsPending);
          const decryptedPendingMemos = parseResult.decryptedMemos;
          for (let idx = 0; idx < decryptedPendingMemos.length; ++idx) {
            // save memos corresponding to our account to restore history
            const myMemo = decryptedPendingMemos[idx];
            myMemo.txHash = txHashesPending[myMemo.index];
            await zpState.history.saveDecryptedMemo(myMemo, true);
          }
        }

        return { txCount: txs.length, maxMinedIndex, maxPendingIndex, state: batchState };
      });

      batches.push(oneBatch);
    }

    let totalState = new Map<number, StateUpdate>();
    let initRes: BatchResult = { txCount: 0, maxMinedIndex: -1, maxPendingIndex: -1, state: totalState };
    let totalRes = (await Promise.all(batches)).reduce((acc, cur) => {
      return {
        txCount: acc.txCount + cur.txCount,
        maxMinedIndex: Math.max(acc.maxMinedIndex, cur.maxMinedIndex),
        maxPendingIndex: Math.max(acc.maxPendingIndex, cur.maxPendingIndex),
        state: new Map([...Array.from(acc.state.entries()), ...Array.from(cur.state.entries())]),
      }
    }, initRes);

    let indices = [...totalRes.state.keys()].sort((i1, i2) => i1 - i2);
    for (let idx of indices) {
      let oneStateUpdate = totalRes.state.get(idx);
      if (oneStateUpdate !== undefined) {
        state.account.updateState(oneStateUpdate);
      } else {
        throw Error(`Cannot find state batch at index ${idx}`);
      }
    }

    // remove unneeded pending records
    await zpState.history.setLastMinedTxIndex(totalRes.maxMinedIndex);
    await zpState.history.setLastPendingTxIndex(totalRes.maxPendingIndex);

    const msElapsed = Date.now() - startTime;
    const avgSpeed = msElapsed / totalRes.txCount

    console.log(`Sync finished in ${msElapsed / 1000} sec | ${totalRes.txCount} tx, avg speed ${avgSpeed.toFixed(1)} ms/tx`);

    return readyToTransact;
  }

  // Just fetch and process the new state without local state updating
  // Return StateUpdate object
  // This method used for multi-tx
  public async getNewState(tokenAddress: string): Promise<StateUpdate> {
    const OUTPLUSONE = CONSTANTS.OUT + 1;

    const zpState = this.zpStates[tokenAddress];
    const startIndex = new BN(zpState.account.nextTreeIndex().toString());
    const stateInfo = await this.relayer.info(tokenAddress);
    const optimisticIndex = new BN(stateInfo.optimisticDeltaIndex);

    if (optimisticIndex.gt(startIndex)) {
      const startTime = Date.now();

      console.log(`⬇ Fetching transactions between ${startIndex} and ${optimisticIndex}...`);

      const numOfTx = Number((optimisticIndex.sub(startIndex)).div(new BN(OUTPLUSONE)));
      const txs = await this.relayer.fetchTransactionsOptimistic(tokenAddress, startIndex, numOfTx);

      console.log(`Getting ${txs.length} transactions from index ${startIndex}`);

      let indexedTxs: IndexedTx[] = [];

      for (let txIdx = 0; txIdx < txs.length; ++txIdx) {
        const tx = txs[txIdx];
        // Get the first leaf index in the tree
        const memoIdx = Number(startIndex) + txIdx * OUTPLUSONE;

        const { commitment, memo } = this.config.network.disassembleRelayerTx(tx);

        const indexedTx: IndexedTx = {
          index: memoIdx,
          memo: memo,
          commitment: commitment,
        }

        // 3. add indexed tx
        indexedTxs.push(indexedTx);
      }

      const parseResult: ParseTxsResult = await this.worker.parseTxs(this.config.sk, indexedTxs);

      const msElapsed = Date.now() - startTime;
      const avgSpeed = msElapsed / numOfTx;

      console.log(`Fetch finished in ${msElapsed / 1000} sec | ${numOfTx} tx, avg speed ${avgSpeed.toFixed(1)} ms/tx`);

      console.log('Optimistic state:', parseResult.stateUpdate);

      return parseResult.stateUpdate;
    } else {
      console.log(`Do not need to fetch @${startIndex}: there is no optimistic state.`);

      return { newLeafs: [], newCommitments: [], newAccounts: [], newNotes: [] };
    }
  }

  public logStateSync(startIndex: number, endIndex: number, decryptedMemos: DecryptedMemo[]) {
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
}
