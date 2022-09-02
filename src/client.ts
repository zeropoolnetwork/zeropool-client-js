import { validateAddress, Output, Proof, DecryptedMemo, ITransferData, IWithdrawData, ParseTxsResult, StateUpdate } from 'libzkbob-rs-wasm-web';

import { SnarkParams, Tokens } from './config';
import { ethAddrToBuf, toCompactSignature, truncateHexPrefix, toTwosComplementHex } from './utils';
import { ZkBobState } from './state';
import { TxType } from './tx';
import { NetworkBackend } from './networks/network';
import { CONSTANTS } from './constants';
import { HistoryRecord, HistoryTransactionType } from './history'
import { IndexedTx } from 'libzkbob-rs-wasm-web';

const MIN_TX_AMOUNT = BigInt(100000000);
const DEFAULT_TX_FEE = BigInt(100000000);
const BATCH_SIZE = 100;

export interface RelayerInfo {
  root: string;
  optimisticRoot: string;
  deltaIndex: string;
  optimisticDeltaIndex: string;
}

export interface BatchResult {
  txCount: number;
  maxMinedIndex: number;
  maxPendingIndex: number;
  state: Map<number, StateUpdate>;  // key: first tx index, 
                                    // value: StateUpdate object (notes, accounts, leafs and comminments)
}

export interface TxAmount { // all values are in Gwei
  amount: bigint;  // tx amount (without fee)
  fee: bigint;  // fee 
  accountLimit: bigint;  // minimum account remainder after transaction
                         // (used for complex multi-tx transfers, default: 0)
}

export interface TxToRelayer {
  txType: TxType;
  memo: string;
  proof: Proof;
  depositSignature?: string
}

export interface JobInfo {
  state: string;
  txHash: string[];
  createdOn: BigInt;
  finishedOn?: BigInt;
  failedReason?: string;
}

export interface FeeAmount { // all values are in Gwei
  total: bigint;    // total fee
  totalPerTx: bigint; // multitransfer case (== total for regular tx)
  txCnt: number;      // multitransfer case (== 1 for regular tx)
  relayer: bigint;  // relayer fee component
  l1: bigint;       // L1 fee component
}

export interface Limit { // all values are in Gwei
  total: bigint;
  available: bigint;
}

export interface PoolLimits { // all values are in Gwei
  deposit: {
    total: bigint;
    components: {
      singleOperation: bigint;
      daylyForAddress: Limit;
      daylyForAll: Limit;
      poolLimit: Limit;
    };
  };
  withdraw: {
    total: bigint;
    components: {
      daylyForAll: Limit;
    };
  }
}

export interface DepositLimitsFetch {
  singleOperation: bigint;
  daylyForAddress: bigint;
  daylyForAll: Limit;
  poolLimit: Limit;
}

export interface WithdrawLimitsFetch {
  daylyForAll: Limit;
}

export interface LimitsFetch { 
  deposit: {
    singleOperation: bigint;
    daylyForAddress: Limit;
    daylyForAll: Limit;
    poolLimit: Limit;
  }
  withdraw: {
    daylyForAll: Limit;
  }
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
  private relayerFee: bigint | undefined; // in Gwei, do not use directly, use getRelayerFee method instead
  private updateStatePromise: Promise<boolean> | undefined;

  public static async create(config: ClientConfig): Promise<ZkBobClient> {
    const client = new ZkBobClient();
    client.zpStates = {};
    client.worker = config.worker;
    client.snarkParams = config.snarkParams;
    client.tokens = config.tokens;
    client.config = config;

    client.relayerFee = undefined;

    let networkName = config.networkName;
    if (!networkName) {
      networkName = config.network.defaultNetworkName();
    }

    for (const [address, token] of Object.entries(config.tokens)) {
      const denominator = await config.network.getDenominator(token.poolAddress);
      client.zpStates[address] = await ZkBobState.create(config.sk, networkName, config.network.getRpcUrl(), denominator);
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
  public getDenominator(tokenAddress: string): bigint {
    return this.zpStates[tokenAddress].denominator;
  }

  // Convert native pool amount to the base units
  public shieldedAmountToWei(tokenAddress, amountGwei: bigint): bigint {
    return amountGwei * this.zpStates[tokenAddress].denominator
  }
  
  // Convert base units to the native pool amount
  public weiToShieldedAmount(tokenAddress, amountWei: bigint): bigint {
    return amountWei / this.zpStates[tokenAddress].denominator
  }

  // Get account + notes balance in Gwei
  // [with optional state update]
  public async getTotalBalance(tokenAddress: string, updateState: boolean = true): Promise<bigint> {
    if (updateState) {
      await this.updateState(tokenAddress);
    }

    return this.zpStates[tokenAddress].getTotalBalance();
  }

  // Get total balance with components: account and notes
  // [with optional state update]
  // Returns [total, account, note] in Gwei
  public async getBalances(tokenAddress: string, updateState: boolean = true): Promise<[bigint, bigint, bigint]> {
    if (updateState) {
      await this.updateState(tokenAddress);
    }

    return this.zpStates[tokenAddress].getBalances();
  }

  // Get total balance including transactions in optimistic state [in Gwei]
  // There is no option to prevent state update here,
  // because we should always monitor optimistic state
  public async getOptimisticTotalBalance(tokenAddress: string, updateState: boolean = true): Promise<bigint> {
    const state = this.zpStates[tokenAddress];

    const confirmedBalance = await this.getTotalBalance(tokenAddress, updateState);
    const historyRecords = await this.getAllHistory(tokenAddress, updateState);

    let pendingDelta = BigInt(0);
    for (const oneRecord of historyRecords) {
      if (oneRecord.pending) {
        switch (oneRecord.type) {
          case HistoryTransactionType.Deposit:
          case HistoryTransactionType.TransferIn: {
            // we don't spend fee from the shielded balance in case of deposit or input transfer
            pendingDelta += oneRecord.amount;
            break;
          }
          case HistoryTransactionType.Withdrawal:
          case HistoryTransactionType.TransferOut: {
            pendingDelta -= (oneRecord.amount + oneRecord.fee);
            break;
          }

          default: break;
        }
      }
    }

    return confirmedBalance + pendingDelta;
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
  public async waitJobsCompleted(tokenAddress: string, jobIds: string[]): Promise<{jobId: string, txHash: string}[]> {
    const token = this.tokens[tokenAddress];
    let promises = jobIds.map(async (jobId) => {
      const txHashes: string[] = await this.waitJobCompleted(tokenAddress, jobId);
      return { jobId, txHash: txHashes[0] };
    });
    
    return Promise.all(promises);
  }

  // Waiting while relayer process the job
  // return transaction(s) hash(es) on success or throw an error
  public async waitJobCompleted(tokenAddress: string, jobId: string): Promise<string[]> {
    const token = this.tokens[tokenAddress];
    const state = this.zpStates[tokenAddress];

    const INTERVAL_MS = 1000;
    let hashes: string[];
    while (true) {
      const job = await this.getJob(token.relayerUrl, jobId);

      if (job === null) {
        console.error(`Job ${jobId} not found.`);
        throw new Error(`Job ${jobId} not found`);
      } else if (job.state === 'failed') {
        throw new Error(`Transaction [job ${jobId}] failed with reason: '${job.failedReason}'`);
      } else if (job.state === 'completed') {
        hashes = job.txHash;
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
    const token = this.tokens[tokenAddress];
    const state = this.zpStates[tokenAddress];

    const INTERVAL_MS = 1000;
    let hashes: string[];
    while (true) {
      const job = await this.getJob(token.relayerUrl, jobId);

      if (job === null) {
        console.error(`Job ${jobId} not found.`);
        throw new Error(`Job ${jobId} not found`);
      } else if (job.state === 'failed') {
        throw new Error(`Transaction [job ${jobId}] failed with reason: '${job.failedReason}'`);
      } else if (job.state === 'completed') {
        hashes = job.txHash;
        break;
      }

      await new Promise(resolve => setTimeout(resolve, INTERVAL_MS));
    }

    console.info(`Transaction [job ${jobId}] in optimistic state now`);

    return true;
  }

  // ------------------=========< Making Transactions >=========-------------------
  // | Methods for creating and sending transactions in different modes           |
  // ------------------------------------------------------------------------------

  // Deposit based on permittable token scheme. User should sign typed data to allow
  // contract receive his tokens
  // Returns jobId from the relayer or throw an Error
  public async depositPermittableV2(
    tokenAddress: string,
    amountGwei: bigint,
    signTypedData: (deadline: bigint, value: bigint, salt: string) => Promise<string>,
    fromAddress: string | null = null,
    feeGwei: bigint = BigInt(0),
  ): Promise<string> {
    const token = this.tokens[tokenAddress];
    const state = this.zpStates[tokenAddress];

    if (amountGwei < MIN_TX_AMOUNT) {
      throw new Error(`Deposit is too small (less than ${MIN_TX_AMOUNT.toString()})`);
    }

    await this.updateState(tokenAddress);

    let txData;
    if (fromAddress) {
      const deadline:bigint = BigInt(Math.floor(Date.now() / 1000) + 900)
      const holder = ethAddrToBuf(fromAddress);
      txData = await state.account.createDepositPermittable({ 
        amount: (amountGwei + feeGwei).toString(),
        fee: feeGwei.toString(),
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
      const value = (amountGwei + feeGwei) * state.denominator;
      const salt = '0x' + toTwosComplementHex(BigInt(txData.public.nullifier), 32);
      let signature = truncateHexPrefix(await signTypedData(deadline, value, salt));

      if (this.config.network.isSignatureCompact()) {
        signature = toCompactSignature(signature);
      }

      let tx = { txType: TxType.BridgeDeposit, memo: txData.memo, proof: txProof, depositSignature: signature };
      const jobId = await this.sendTransactions(token.relayerUrl, [tx]);

      // Temporary save transaction in the history module (to prevent history delays)
      const ts = Math.floor(Date.now() / 1000);
      let rec = HistoryRecord.deposit(fromAddress, amountGwei, feeGwei, ts, "0", true);
      state.history.keepQueuedTransactions([rec], jobId);

      return jobId;

    } else {
      throw new Error('You must provide fromAddress for bridge deposit transaction ');
    }
  }

  // Transfer shielded funds to the shielded address
  // This method can produce several transactions in case of insufficient input notes (constants::IN per tx)
  // // Returns jobId from the relayer or throw an Error
  public async transferMulti(tokenAddress: string, to: string, amountGwei: bigint, feeGwei: bigint = BigInt(0)): Promise<string[]> {
    const state = this.zpStates[tokenAddress];
    const token = this.tokens[tokenAddress];

    if (!validateAddress(to)) {
      throw new Error('Invalid address. Expected a shielded address.');
    }

    if (amountGwei < MIN_TX_AMOUNT) {
      throw new Error(`Transfer amount is too small (less than ${MIN_TX_AMOUNT.toString()})`);
    }

    const txParts = await this.getTransactionParts(tokenAddress, amountGwei, feeGwei);

    if (txParts.length == 0) {
      throw new Error('Cannot find appropriate multitransfer configuration (insufficient funds?)');
    }

    var jobsIds: string[] = [];
    var optimisticState: StateUpdate = {
      newLeafs: [],
      newCommitments: [],
      newAccounts: [],
      newNotes: [],
    }
    for (let index = 0; index < txParts.length; index++) {
      const onePart = txParts[index];
      const oneTx: ITransferData = {
        outputs: [{to, amount: onePart.amount.toString()}],
        fee: onePart.fee.toString(),
      };
      const oneTxData = await state.account.createTransferOptimistic(oneTx, optimisticState);

      console.log(`Transaction created: delta_index = ${oneTxData.parsed_delta.index}, root = ${oneTxData.public.root}`);

      const startProofDate = Date.now();
      const txProof: Proof = await this.worker.proveTx(oneTxData.public, oneTxData.secret);
      const proofTime = (Date.now() - startProofDate) / 1000;
      console.log(`Proof calculation took ${proofTime.toFixed(1)} sec`);

      const txValid = Proof.verify(this.snarkParams.transferVk!, txProof.inputs, txProof.proof);
      if (!txValid) {
        throw new Error('invalid tx proof');
      }

      const transaction = {memo: oneTxData.memo, proof: txProof, txType: TxType.Transfer};

      const jobId = await this.sendTransactions(token.relayerUrl, [transaction]);
      jobsIds.push(jobId);

      // Temporary save transaction part in the history module (to prevent history delays)
      const ts = Math.floor(Date.now() / 1000);
      var record;
      if (state.isOwnAddress(to)) {
        record = HistoryRecord.transferLoopback(to, onePart.amount, onePart.fee, ts, `${index}`, true);
      } else {
        record = HistoryRecord.transferOut(to, onePart.amount, onePart.fee, ts, `${index}`, true);
      }
      state.history.keepQueuedTransactions([record], jobId);

      if (index < (txParts.length - 1)) {
        console.log(`Waiting while job ${jobId} queued by relayer`);
        // if there are few additional tx, we should collect the optimistic state before processing them
        await this.waitJobQueued(tokenAddress, jobId);

        optimisticState = await this.getNewState(tokenAddress);
      }
    }

    return jobsIds;
  }

  // Withdraw shielded funds to the specified native chain address
  // This method can produce several transactions in case of insufficient input notes (constants::IN per tx)
  // feeGwei - fee per single transaction (request it with atomicTxFee method)
  // Returns jobId from the relayer or throw an Error
  public async withdrawMulti(tokenAddress: string, address: string, amountGwei: bigint, feeGwei: bigint = BigInt(0)): Promise<string[]> {
    const token = this.tokens[tokenAddress];
    const state = this.zpStates[tokenAddress];

    if (amountGwei < MIN_TX_AMOUNT) {
      throw new Error(`Withdraw amount is too small (less than ${MIN_TX_AMOUNT.toString()})`);
    }

    const txParts = await this.getTransactionParts(tokenAddress, amountGwei, feeGwei);

    if (txParts.length == 0) {
      throw new Error('Cannot find appropriate multitransfer configuration (insufficient funds?)');
    }

    const addressBin = ethAddrToBuf(address);

    const transfers = txParts.map(({amount, fee, accountLimit}) => {
      const oneTransfer: IWithdrawData = {
        amount: amount.toString(),
        fee: fee.toString(),
        to: addressBin,
        native_amount: '0',
        energy_amount: '0',
      };

      return oneTransfer;
    });

    ///////
    var jobsIds: string[] = [];
    var optimisticState: StateUpdate = {
      newLeafs: [],
      newCommitments: [],
      newAccounts: [],
      newNotes: [],
    }
    for (let index = 0; index < txParts.length; index++) {
      const onePart = txParts[index];
      const oneTx: IWithdrawData = {
        amount: onePart.amount.toString(),
        fee: onePart.fee.toString(),
        to: addressBin,
        native_amount: '0',
        energy_amount: '0',
      };
      const oneTxData = await state.account.createWithdrawalOptimistic(oneTx, optimisticState);

      const startProofDate = Date.now();
      const txProof: Proof = await this.worker.proveTx(oneTxData.public, oneTxData.secret);
      const proofTime = (Date.now() - startProofDate) / 1000;
      console.log(`Proof calculation took ${proofTime.toFixed(1)} sec`);

      const txValid = Proof.verify(this.snarkParams.transferVk!, txProof.inputs, txProof.proof);
      if (!txValid) {
        throw new Error('invalid tx proof');
      }

      const transaction = {memo: oneTxData.memo, proof: txProof, txType: TxType.Withdraw};

      const jobId = await this.sendTransactions(token.relayerUrl, [transaction]);
      jobsIds.push(jobId);

      // Temporary save transaction part in the history module (to prevent history delays)
      const ts = Math.floor(Date.now() / 1000);
      var record = HistoryRecord.withdraw(address, onePart.amount, onePart.fee, ts, `${index}`, true);
      state.history.keepQueuedTransactions([record], jobId);

      if (index < (txParts.length - 1)) {
        console.log(`Waiting while job ${jobId} queued by relayer`);
        // if there are few additional tx, we should collect the optimistic state before processing them
        await this.waitJobQueued(tokenAddress, jobId);

        optimisticState = await this.getNewState(tokenAddress);
      }
    }

    return jobsIds;
  }

  // DEPRECATED. Please use depositPermittableV2 method instead
  // This method doesn't cover nullifier by signature, so user funds can be stealed
  // Deposit based on permittable token scheme. User should sign typed data to allow
  // contract receive his tokens
  // Returns jobId from the relayer or throw an Error
  public async depositPermittable(
    tokenAddress: string,
    amountGwei: bigint,
    signTypedData: (deadline: bigint, value: bigint) => Promise<string>,
    fromAddress: string | null = null,
    feeGwei: bigint = BigInt(0),
  ): Promise<string> {
    const token = this.tokens[tokenAddress];
    const state = this.zpStates[tokenAddress];

    if (amountGwei < MIN_TX_AMOUNT) {
      throw new Error(`Deposit is too small (less than ${MIN_TX_AMOUNT.toString()})`);
    }

    await this.updateState(tokenAddress);

    let txData;
    if (fromAddress) {
      const deadline:bigint = BigInt(Math.floor(Date.now() / 1000) + 900)
      const holder = ethAddrToBuf(fromAddress);
      txData = await state.account.createDepositPermittable({ 
        amount: (amountGwei + feeGwei).toString(),
        fee: feeGwei.toString(),
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
      const value = (amountGwei + feeGwei) * state.denominator;
      let signature = truncateHexPrefix(await signTypedData(deadline, value));

      if (this.config.network.isSignatureCompact()) {
        signature = toCompactSignature(signature);
      }

      let tx = { txType: TxType.BridgeDeposit, memo: txData.memo, proof: txProof, depositSignature: signature };
      const jobId = await this.sendTransactions(token.relayerUrl, [tx]);

      // Temporary save transaction in the history module (to prevent history delays)
      const ts = Math.floor(Date.now() / 1000);
      let rec = HistoryRecord.deposit(fromAddress, amountGwei, feeGwei, ts, "0", true);
      state.history.keepQueuedTransactions([rec], jobId);

      return jobId;

    } else {
      throw new Error('You must provide fromAddress for bridge deposit transaction ');
    }
  }

  // DEPRECATED. Please use depositPermittableV2 method instead
  // Deposit throught approval allowance
  // User should approve allowance for contract address at least 
  // (amountGwei + feeGwei) tokens before calling this method
  // Returns jobId
  public async deposit(
    tokenAddress: string,
    amountGwei: bigint,
    sign: (data: string) => Promise<string>,
    fromAddress: string | null = null,
    feeGwei: bigint = BigInt(0),
  ): Promise<string> {
    const token = this.tokens[tokenAddress];
    const state = this.zpStates[tokenAddress];

    if (amountGwei < MIN_TX_AMOUNT) {
      throw new Error(`Deposit is too small (less than ${MIN_TX_AMOUNT.toString()})`);
    }

    await this.updateState(tokenAddress);

    let txData = await state.account.createDeposit({
      amount: (amountGwei + feeGwei).toString(),
      fee: feeGwei.toString(),
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

    let tx = { txType: TxType.Deposit, memo: txData.memo, proof: txProof, depositSignature: fullSignature };
    const jobId = await this.sendTransactions(token.relayerUrl, [tx]);

    if (fromAddress) {
      // Temporary save transaction in the history module (to prevent history delays)
      const ts = Math.floor(Date.now() / 1000);
      let rec = HistoryRecord.deposit(fromAddress, amountGwei, feeGwei, ts, "0", true);
      state.history.keepQueuedTransactions([rec], jobId);
    }

    return jobId;
  }

  // DEPRECATED. Please use transferMulti method instead
  // Simple transfer to the shielded address. Supports several output addresses
  // This method will fail when insufficent input notes (constants::IN) for transfer
  public async transferSingle(tokenAddress: string, outsGwei: Output[], feeGwei: bigint = BigInt(0)): Promise<string> {
    await this.updateState(tokenAddress);

    const token = this.tokens[tokenAddress];
    const state = this.zpStates[tokenAddress];

    const outGwei = outsGwei.map(({ to, amount }) => {
      if (!validateAddress(to)) {
        throw new Error('Invalid address. Expected a shielded address.');
      }

      if (BigInt(amount) < MIN_TX_AMOUNT) {
        throw new Error(`One of the values is too small (less than ${MIN_TX_AMOUNT.toString()})`);
      }

      return { to, amount };
    });

    const txData = await state.account.createTransfer({ outputs: outGwei, fee: feeGwei.toString() });

    const startProofDate = Date.now();
    const txProof = await this.worker.proveTx(txData.public, txData.secret);
    const proofTime = (Date.now() - startProofDate) / 1000;
    console.log(`Proof calculation took ${proofTime.toFixed(1)} sec`);

    const txValid = Proof.verify(this.snarkParams.transferVk!, txProof.inputs, txProof.proof);
    if (!txValid) {
      throw new Error('invalid tx proof');
    }

    let tx = { txType: TxType.Transfer, memo: txData.memo, proof: txProof };
    const jobId = await this.sendTransactions(token.relayerUrl, [tx]);

    // Temporary save transactions in the history module (to prevent history delays)
    const feePerOut = feeGwei / BigInt(outGwei.length);
    let recs = outGwei.map(({to, amount}) => {
      const ts = Math.floor(Date.now() / 1000);
      if (state.isOwnAddress(to)) {
        return HistoryRecord.transferLoopback(to, BigInt(amount), feePerOut, ts, "0", true);
      } else {
        return HistoryRecord.transferOut(to, BigInt(amount), feePerOut, ts, "0", true);
      }
    });
    state.history.keepQueuedTransactions(recs, jobId);

    return jobId;
  }

  // DEPRECATED. Please use withdrawMulti methos instead
  // Simple withdraw to the native address
  // This method will fail when insufficent input notes (constants::IN) for withdrawal
  public async withdrawSingle(tokenAddress: string, address: string, amountGwei: bigint, feeGwei: bigint = BigInt(0)): Promise<string> {
    const token = this.tokens[tokenAddress];
    const state = this.zpStates[tokenAddress];

    if (amountGwei < MIN_TX_AMOUNT) {
      throw new Error(`Withdraw amount is too small (less than ${MIN_TX_AMOUNT.toString()})`);
    }

    await this.updateState(tokenAddress);

    const txType = TxType.Withdraw;
    const addressBin = ethAddrToBuf(address);

    const txData = await state.account.createWithdraw({
      amount: (amountGwei + feeGwei).toString(),
      to: addressBin,
      fee: feeGwei.toString(),
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

    let tx = { txType: TxType.Withdraw, memo: txData.memo, proof: txProof };
    const jobId = await this.sendTransactions(token.relayerUrl, [tx]);

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

  // Min trensaction fee in Gwei (e.g. deposit or single transfer)
  // To estimate fee in the common case please use feeEstimate instead
  public async atomicTxFee(tokenAddress: string): Promise<bigint> {
    const relayer = await this.getRelayerFee(tokenAddress);
    const l1 = BigInt(0);

    return relayer + l1;
  }

  // Fee can depends on tx amount for multitransfer transactions,
  // that's why you should specify it here for general case
  // This method also supposed that in some cases fee can depends on tx amount in future
  // Currently deposit isn't depends of amount
  public async feeEstimate(tokenAddress: string, amountGwei: bigint, txType: TxType, updateState: boolean = true): Promise<FeeAmount> {
    const relayer = await this.getRelayerFee(tokenAddress);
    const l1 = BigInt(0);
    let txCnt = 1;
    let totalPerTx = relayer + l1;
    let total = totalPerTx;
    if (txType === TxType.Transfer || txType === TxType.Withdraw) {
      const parts = await this.getTransactionParts(tokenAddress, amountGwei, totalPerTx, updateState);
      if (parts.length == 0) {
        throw new Error(`insufficient funds`);
      }

      txCnt = parts.length;
      total = totalPerTx * BigInt(txCnt);
    }
    return {total, totalPerTx, txCnt, relayer, l1};
  }

  // Relayer fee component. Do not use it directly
  private async getRelayerFee(tokenAddress: string): Promise<bigint> {
    if (this.relayerFee === undefined) {
      // fetch actual fee from the relayer
      const token = this.tokens[tokenAddress];
      this.relayerFee = await this.fee(token.relayerUrl);
    }

    return this.relayerFee;
  }

  public async minTxAmount(tokenAddress: string, amountGwei: bigint, txType: TxType, updateState: boolean = true): Promise<bigint> {
    return MIN_TX_AMOUNT;
  }

  // Account + notes balance excluding fee needed to transfer or withdraw it
  public async calcMaxAvailableTransfer(tokenAddress: string, updateState: boolean = true): Promise<bigint> {
    const state = this.zpStates[tokenAddress];
    if (updateState) {
      await this.updateState(tokenAddress);
    }

    let result: bigint;

    const txFee = await this.atomicTxFee(tokenAddress);
    const usableNotes = state.usableNotes();
    const accountBalance = BigInt(state.accountBalance());
    let notesBalance = BigInt(0);

    let txCnt = 1;
    if (usableNotes.length > CONSTANTS.IN) {
      txCnt += Math.ceil((usableNotes.length - CONSTANTS.IN) / CONSTANTS.IN);
    }

    for(let i = 0; i < usableNotes.length; i++) {
      const curNote = usableNotes[i][1];
      notesBalance += BigInt(curNote.b)
    }

    let summ = accountBalance + notesBalance - txFee * BigInt(txCnt);
    if (summ < 0) {
      summ = BigInt(0);
    }

    return summ;
  }

  // Calculate multitransfer configuration for specified token amount and fee per transaction
  // Applicable for transfer and withdrawal transactions. You can prevent state updating with updateState flag
  public async getTransactionParts(tokenAddress: string, amountGwei: bigint, feeGwei: bigint, updateState: boolean = true): Promise<Array<TxAmount>> {
    const state = this.zpStates[tokenAddress];
    if (updateState) {
      await this.updateState(tokenAddress);
    }

    let result: Array<TxAmount> = [];

    const usableNotes = state.usableNotes();
    const accountBalance = BigInt(state.accountBalance());

    let remainAmount = amountGwei;

    if (accountBalance >= remainAmount + feeGwei) {
      result.push({amount: remainAmount, fee: feeGwei, accountLimit: BigInt(0)});
    } else {
      let notesParts: Array<bigint> = [];
      let curPart = BigInt(0);
      for(let i = 0; i < usableNotes.length; i++) {
        const curNote = usableNotes[i][1];

        if (i > 0 && i % CONSTANTS.IN == 0) {
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
        if (oneTxPart - feeGwei > remainAmount) {
          oneTxPart = remainAmount + feeGwei;
        }

        if(oneTxPart < feeGwei || oneTxPart < MIN_TX_AMOUNT) {
          break;
        }

        result.push({amount: oneTxPart - feeGwei, fee: feeGwei, accountLimit: BigInt(0)});

        remainAmount -= (oneTxPart - feeGwei);
        oneTxPart = BigInt(0);
      }

      if(remainAmount > 0){
        result = [];
      }
    }

    return result;
  }

  // The deposit and withdraw amount is limited by few factors:
  // https://docs.zkbob.com/bob-protocol/deposit-and-withdrawal-limits
  // Global limits are fetched from the relayer (except personal deposit limit from the specified address)
  public async getLimits(tokenAddress: string, address: string | undefined = undefined): Promise<PoolLimits> {
    const token = this.tokens[tokenAddress];

    let currentLimits: LimitsFetch;
    try {
      currentLimits = await this.limits(token.relayerUrl, address)
    } catch (e) {
      console.error(`Cannot fetch deposit limits from the relayer (${e}). Try to get them from contract directly`);
      try {
        const poolLimits = await this.config.network.poolLimits(token.poolAddress, address);
        currentLimits = {
          deposit: {
            singleOperation: BigInt(poolLimits.depositCap),
            daylyForAddress: {
              total: BigInt(poolLimits.dailyUserDepositCap),
              available: BigInt(poolLimits.dailyUserDepositCap) - BigInt(poolLimits.dailyUserDepositCapUsage),
            },
            daylyForAll: {
              total:      BigInt(poolLimits.dailyDepositCap),
              available:  BigInt(poolLimits.dailyDepositCap) - BigInt(poolLimits.dailyDepositCapUsage),
            },
            poolLimit: {
              total:      BigInt(poolLimits.tvlCap),
              available:  BigInt(poolLimits.tvlCap) - BigInt(poolLimits.tvl),
            },
          },
          withdraw: {
            daylyForAll: {
              total:      BigInt(poolLimits.dailyWithdrawalCap),
              available:  BigInt(poolLimits.dailyWithdrawalCap) - BigInt(poolLimits.dailyWithdrawalCapUsage),
            },
          }
        };
      } catch (err) {
        console.error(`Cannot fetch deposit limits from contract (${err}). Getting hardcoded values. Please note your transactions can be reverted with incorrect limits!`);
        // hardcoded values
        currentLimits = {
          deposit: {
            singleOperation: BigInt(10000000000000),  // 10k tokens
            daylyForAddress: {
              total: BigInt(10000000000000),  // 10k tokens
              available: BigInt(10000000000000),  // 10k tokens
            },
            daylyForAll: {
              total:      BigInt(100000000000000),  // 100k tokens
              available:  BigInt(100000000000000),  // 100k tokens
            },
            poolLimit: {
              total:      BigInt(1000000000000000), // 1kk tokens
              available:  BigInt(1000000000000000), // 1kk tokens
            },
          },
          withdraw: {
            daylyForAll: {
              total:      BigInt(100000000000000),  // 100k tokens
              available:  BigInt(100000000000000),  // 100k tokens
            },
          }
        };
      }
    }

    // helper
    const bigIntMin = (...args: bigint[]) => args.reduce((m, e) => e < m ? e : m);

    // Calculate deposit limits
    const allDepositLimits = [
      currentLimits.deposit.singleOperation,
      currentLimits.deposit.daylyForAddress.available,
      currentLimits.deposit.daylyForAll.available,
      currentLimits.deposit.poolLimit.available,
    ];
    let totalDepositLimit = bigIntMin(...allDepositLimits);

    // Calculate withdraw limits
    const allWithdrawLimits = [ currentLimits.withdraw.daylyForAll.available ];
    let totalWithdrawLimit = bigIntMin(...allWithdrawLimits);

    return {
      deposit: {
        total: totalDepositLimit >= 0 ? totalDepositLimit : BigInt(0),
        components: currentLimits.deposit,
      },
      withdraw: {
        total: totalWithdrawLimit >= 0 ? totalWithdrawLimit : BigInt(0),
        components: currentLimits.withdraw,
      }
    }
  }

  // ------------------=========< State Processing >=========-------------------
  // | Updating and monitoring state                                            |
  // ----------------------------------------------------------------------------

  // The library can't make any transfers when there are outcoming
  // transactions in the optimistic state
  public async isReadyToTransact(tokenAddress: string): Promise<boolean> {
    return await this.updateState(tokenAddress);
  }

  // Wait while state becomes ready to make new transactions
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
    if (this.updateStatePromise == undefined) {
      this.updateStatePromise = this.updateStateOptimisticWorker(tokenAddress).finally(() => {
        this.updateStatePromise = undefined;
      });
    } else {
      console.info(`The state currently updating, waiting for finish...`);
    }

    return this.updateStatePromise;
  }

  // ---===< TODO >===---
  // The optimistic state currently processed only in the client library
  // Wasm package holds only the mined transactions
  // Currently it's just a workaround
  private async updateStateOptimisticWorker(tokenAddress: string): Promise<boolean> {
    const OUTPLUSONE = CONSTANTS.OUT + 1;

    const zpState = this.zpStates[tokenAddress];
    const token = this.tokens[tokenAddress];
    const state = this.zpStates[tokenAddress];

    const startIndex = Number(zpState.account.nextTreeIndex());

    const stateInfo = await this.info(token.relayerUrl);
    const nextIndex = Number(stateInfo.deltaIndex);
    const optimisticIndex = Number(stateInfo.optimisticDeltaIndex);

    if (optimisticIndex > startIndex) {
      const startTime = Date.now();
      
      console.log(`⬇ Fetching transactions between ${startIndex} and ${optimisticIndex}...`);

      
      let batches: Promise<BatchResult>[] = [];

      let readyToTransact = true;

      for (let i = startIndex; i <= optimisticIndex; i = i + BATCH_SIZE * OUTPLUSONE) {
        let oneBatch = this.fetchTransactionsOptimistic(token.relayerUrl, BigInt(i), BATCH_SIZE).then( async txs => {
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
            const memo_idx = i + txIdx * OUTPLUSONE;
            
            // tx structure from relayer: mined flag + txHash(32 bytes, 64 chars) + commitment(32 bytes, 64 chars) + memo
            // 1. Extract memo block
            const memo = tx.slice(129); // Skip mined flag, txHash and commitment

            // 2. Get transaction commitment
            const commitment = tx.substr(65, 64)
            
            const indexedTx: IndexedTx = {
              index: memo_idx,
              memo: memo,
              commitment: commitment,
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

          if (indexedTxs.length > 0) {
            const parseResult: ParseTxsResult = await this.worker.parseTxs(this.config.sk, indexedTxs);
            const decryptedMemos = parseResult.decryptedMemos;
            batchState.set(i, parseResult.stateUpdate);
            //state.account.updateState(parseResult.stateUpdate);
            this.logStateSync(i, i + txs.length * OUTPLUSONE, decryptedMemos);
            for (let decryptedMemoIndex = 0; decryptedMemoIndex < decryptedMemos.length; ++decryptedMemoIndex) {
              // save memos corresponding to the our account to restore history
              const myMemo = decryptedMemos[decryptedMemoIndex];
              myMemo.txHash = txHashes[myMemo.index];
              zpState.history.saveDecryptedMemo(myMemo, false);
            }
          }

          if (indexedTxsPending.length > 0) {
            const parseResult: ParseTxsResult = await this.worker.parseTxs(this.config.sk, indexedTxsPending);
            const decryptedPendingMemos = parseResult.decryptedMemos;
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
          }

          return {txCount: txs.length, maxMinedIndex, maxPendingIndex, state: batchState} ;
        });
        batches.push(oneBatch);
      };

      let totalState = new Map<number, StateUpdate>();
      let initRes: BatchResult = {txCount: 0, maxMinedIndex: -1, maxPendingIndex: -1, state: totalState};
      let totalRes = (await Promise.all(batches)).reduce((acc, cur) => {
        return {
          txCount: acc.txCount + cur.txCount,
          maxMinedIndex: Math.max(acc.maxMinedIndex, cur.maxMinedIndex),
          maxPendingIndex: Math.max(acc.maxPendingIndex, cur.maxPendingIndex),
          state: new Map([...Array.from(acc.state.entries()), ...Array.from(cur.state.entries())]),
        }
      }, initRes);

      let idxs = [...totalRes.state.keys()].sort((i1, i2) => i1 - i2);
      for (let idx of idxs) {
        let oneStateUpdate = totalRes.state.get(idx);
        if (oneStateUpdate !== undefined) {
          state.account.updateState(oneStateUpdate);
        } else {
          throw Error(`Cannot find state batch at index ${idx}`);
        }
      }

      // remove unneeded pending records
      zpState.history.setLastMinedTxIndex(totalRes.maxMinedIndex);
      zpState.history.setLastPendingTxIndex(totalRes.maxPendingIndex);


      const msElapsed = Date.now() - startTime;
      const avgSpeed = msElapsed / totalRes.txCount

      console.log(`Sync finished in ${msElapsed / 1000} sec | ${totalRes.txCount} tx, avg speed ${avgSpeed.toFixed(1)} ms/tx`);

      return readyToTransact;
    } else {
      zpState.history.setLastMinedTxIndex(nextIndex - OUTPLUSONE);
      zpState.history.setLastPendingTxIndex(-1);

      console.log(`Local state is up to date @${startIndex}`);

      return true;
    }
  }

  // Just fetch and process the new state without local state updating
  // Return StateUpdate object
  // This method used for multi-tx
  public async getNewState(tokenAddress: string): Promise<StateUpdate> {
    const OUTPLUSONE = CONSTANTS.OUT + 1;

    const zpState = this.zpStates[tokenAddress];
    const token = this.tokens[tokenAddress];
    const state = this.zpStates[tokenAddress];

    const startIndex = zpState.account.nextTreeIndex();

    const stateInfo = await this.info(token.relayerUrl);
    const optimisticIndex = BigInt(stateInfo.optimisticDeltaIndex);

    if (optimisticIndex > startIndex) {
      const startTime = Date.now();
      
      console.log(`⬇ Fetching transactions between ${startIndex} and ${optimisticIndex}...`);

      const numOfTx = Number((optimisticIndex - startIndex) / BigInt(OUTPLUSONE));
      let stateUpdate = this.fetchTransactionsOptimistic(token.relayerUrl, startIndex, numOfTx).then( async txs => {
        console.log(`Getting ${txs.length} transactions from index ${startIndex}`);
        
        let indexedTxs: IndexedTx[] = [];

        for (let txIdx = 0; txIdx < txs.length; ++txIdx) {
          const tx = txs[txIdx];
          // Get the first leaf index in the tree
          const memo_idx = Number(startIndex) + txIdx * OUTPLUSONE;
          
          // tx structure from relayer: mined flag + txHash(32 bytes, 64 chars) + commitment(32 bytes, 64 chars) + memo
          // 1. Extract memo block
          const memo = tx.slice(129); // Skip mined flag, txHash and commitment

          // 2. Get transaction commitment
          const commitment = tx.substr(65, 64)
          
          const indexedTx: IndexedTx = {
            index: memo_idx,
            memo: memo,
            commitment: commitment,
          }

          // 3. add indexed tx
          indexedTxs.push(indexedTx);
        }

        const parseResult: ParseTxsResult = await this.worker.parseTxs(this.config.sk, indexedTxs);

        return parseResult.stateUpdate;
      });

      const msElapsed = Date.now() - startTime;
      const avgSpeed = msElapsed / numOfTx;

      console.log(`Fetch finished in ${msElapsed / 1000} sec | ${numOfTx} tx, avg speed ${avgSpeed.toFixed(1)} ms/tx`);

      return stateUpdate;
    } else {
      console.log(`Do not need to fetch @${startIndex}`);

      return {newLeafs: [], newCommitments: [], newAccounts: [], newNotes: []};
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

  // ------------------=========< Relayer interactions >=========-------------------
  // | Methods to interact with the relayer                                        |
  // -------------------------------------------------------------------------------
  
  private async fetchTransactionsOptimistic(relayerUrl: string, offset: BigInt, limit: number = 100): Promise<string[]> {
    const url = new URL(`/transactions/v2`, relayerUrl);
    url.searchParams.set('limit', limit.toString());
    url.searchParams.set('offset', offset.toString());
    const headers = {'content-type': 'application/json;charset=UTF-8'};
    const res = await (await fetch(url.toString(), {headers})).json();  
  
    return res;
  }
  
  // returns transaction job ID
  private async sendTransactions(relayerUrl: string, txs: TxToRelayer[]): Promise<string> {
    const url = new URL('/sendTransactions', relayerUrl);
    const headers = {'content-type': 'application/json;charset=UTF-8'};
    const res = await fetch(url.toString(), { method: 'POST', headers, body: JSON.stringify(txs) });
  
    if (!res.ok) {
      const body = await res.json();
      throw new Error(`Error ${res.status}: ${JSON.stringify(body)}`)
    }
  
    const json = await res.json();
    return json.jobId;
  }
  
  private async getJob(relayerUrl: string, id: string): Promise<JobInfo | null> {
    const url = new URL(`/job/${id}`, relayerUrl);
    const headers = {'content-type': 'application/json;charset=UTF-8'};
    const res = await (await fetch(url.toString(), {headers})).json();
  
    if (typeof res === 'string') {
      return null;
    } else {
      return res;
    }
  }
  
  private async info(relayerUrl: string): Promise<RelayerInfo> {
    const url = new URL('/info', relayerUrl);
    const headers = {'content-type': 'application/json;charset=UTF-8'};
    const res = await fetch(url.toString(), {headers});
  
    return await res.json();
  }
  
  private async fee(relayerUrl: string): Promise<bigint> {
    try {
      const url = new URL('/fee', relayerUrl);
      const headers = {'content-type': 'application/json;charset=UTF-8'};
      const res = await (await fetch(url.toString(), {headers})).json();
      return BigInt(res.fee);
    } catch {
      return DEFAULT_TX_FEE;
    }
  }
  
  private async limits(relayerUrl: string, address: string | undefined): Promise<LimitsFetch> {
    const url = new URL('/limits', relayerUrl);
    if (address !== undefined) {
      url.searchParams.set('address', address);
    }
    const headers = {'content-type': 'application/json;charset=UTF-8'};
    const res = await (await fetch(url.toString(), {headers})).json();
    return res;
  }
  
  private async depositLimits(relayerUrl: string): Promise<DepositLimitsFetch> {
    try {
      const url = new URL('/limits/deposit', relayerUrl);
      const headers = {'content-type': 'application/json;charset=UTF-8'};
      const res = await (await fetch(url.toString(), {headers})).json();
      return res;
    } catch (e) {
      console.error(`Cannot fetch deposit limits from the relayer (${e}). The hardcoded values will be used. The transactions may be reverted`);
      // hardcoded values
      return {
        singleOperation: BigInt(10000000000000),  // 10k tokens
        daylyForAddress: BigInt(10000000000000),  // 10k tokens
        daylyForAll: {
          total:      BigInt(100000000000000),  // 100k tokens
          available:  BigInt(100000000000000),  // 100k tokens
        },
        poolLimit: {
          total:      BigInt(1000000000000000), // 1kk tokens
          available:  BigInt(1000000000000000), // 1kk tokens
        },
      };
    }
  }

  // DEPRECATED: use fetchTransactionsOptimistic to get actual state including optimistic state
  private async fetchTransactions(relayerUrl: string, offset: BigInt, limit: number = 100): Promise<string[]> {
    const url = new URL(`/transactions`, relayerUrl);
    url.searchParams.set('limit', limit.toString());
    url.searchParams.set('offset', offset.toString());
    const headers = {'content-type': 'application/json;charset=UTF-8'};
    const res = await (await fetch(url.toString(), {headers})).json();
  
    return res;
  }
}
