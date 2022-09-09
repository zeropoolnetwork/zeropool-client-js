import { Output, Proof, DecryptedMemo, StateUpdate } from 'libzeropool-rs-wasm-web';
import { SnarkParams, Tokens } from './config';
import { TxType } from './tx';
import { NetworkBackend } from './networks/network';
import { HistoryRecord } from './history';
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
    state: Map<number, StateUpdate>;
}
export interface TxAmount {
    amount: bigint;
    fee: bigint;
    accountLimit: bigint;
}
export interface TxToRelayer {
    txType: TxType;
    memo: string;
    proof: Proof;
    depositSignature?: string;
}
export interface JobInfo {
    state: string;
    txHash: string[];
    createdOn: BigInt;
    finishedOn?: BigInt;
    failedReason?: string;
}
export interface FeeAmount {
    total: bigint;
    totalPerTx: bigint;
    txCnt: number;
    relayer: bigint;
    l1: bigint;
}
export interface Limit {
    total: bigint;
    available: bigint;
}
export interface PoolLimits {
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
    };
}
export interface LimitsFetch {
    deposit: {
        singleOperation: bigint;
        daylyForAddress: Limit;
        daylyForAll: Limit;
        poolLimit: Limit;
    };
    withdraw: {
        daylyForAll: Limit;
    };
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
export declare class ZeropoolClient {
    private zpStates;
    private worker;
    private snarkParams;
    private tokens;
    private config;
    private relayerFee;
    private updateStatePromise;
    static create(config: ClientConfig): Promise<ZeropoolClient>;
    free(): void;
    getDenominator(tokenAddress: string): bigint;
    shieldedAmountToWei(tokenAddress: any, amountShielded: bigint): bigint;
    weiToShieldedAmount(tokenAddress: any, amountWei: bigint): bigint;
    getTotalBalance(tokenAddress: string, updateState?: boolean): Promise<bigint>;
    getBalances(tokenAddress: string, updateState?: boolean): Promise<[bigint, bigint, bigint]>;
    getOptimisticTotalBalance(tokenAddress: string, updateState?: boolean): Promise<bigint>;
    getAllHistory(tokenAddress: string, updateState?: boolean): Promise<HistoryRecord[]>;
    generateAddress(tokenAddress: string): string;
    waitJobsCompleted(tokenAddress: string, jobIds: string[]): Promise<{
        jobId: string;
        txHash: string;
    }[]>;
    waitJobCompleted(tokenAddress: string, jobId: string): Promise<string[]>;
    waitJobQueued(tokenAddress: string, jobId: string): Promise<boolean>;
    depositPermittableV2(tokenAddress: string, amountWei: bigint, signTypedData: (deadline: bigint, value: bigint, salt: string) => Promise<string>, fromAddress?: string | null, feeWei?: bigint, outputs?: Output[]): Promise<string>;
    transferMulti(tokenAddress: string, to: string, amountWei: bigint, feeWei?: bigint): Promise<string[]>;
    withdrawMulti(tokenAddress: string, address: string, amountWei: bigint, feeWei?: bigint): Promise<string[]>;
    deposit(tokenAddress: string, amountWei: bigint, sign: (data: string) => Promise<string>, fromAddress: string, feeWei?: bigint, outputs?: Output[]): Promise<string>;
    transferSingle(tokenAddress: string, outsWei: Output[], feeWei?: bigint): Promise<string>;
    transfer: (tokenAddress: string, outsWei: Output[], feeWei?: bigint) => Promise<string>;
    withdrawSingle(tokenAddress: string, address: string, amountWei: bigint, feeWei?: bigint): Promise<string>;
    withdraw: (tokenAddress: string, address: string, amountWei: bigint, feeWei?: bigint) => Promise<string>;
    atomicTxFee(tokenAddress: string): Promise<bigint>;
    feeEstimate(tokenAddress: string, amountWei: bigint, txType: TxType, updateState?: boolean): Promise<FeeAmount>;
    private getRelayerFee;
    minTxAmount(tokenAddress: string): Promise<bigint>;
    calcMaxAvailableTransfer(tokenAddress: string, updateState?: boolean): Promise<bigint>;
    getTransactionParts(tokenAddress: string, amountWei: bigint, feeWei: bigint, updateState?: boolean): Promise<Array<TxAmount>>;
    getLimits(tokenAddress: string, address?: string | undefined, directRequest?: boolean): Promise<PoolLimits>;
    isReadyToTransact(tokenAddress: string): Promise<boolean>;
    waitReadyToTransact(tokenAddress: string): Promise<boolean>;
    rawState(tokenAddress: string): Promise<any>;
    cleanState(tokenAddress: string): Promise<void>;
    updateState(tokenAddress: string): Promise<boolean>;
    private updateStateOptimisticWorker;
    getNewState(tokenAddress: string): Promise<StateUpdate>;
    logStateSync(startIndex: number, endIndex: number, decryptedMemos: DecryptedMemo[]): Promise<void>;
    private fetchTransactionsOptimistic;
    private sendTransactions;
    private getJob;
    private info;
    private fee;
    private limits;
    private fetchTransactions;
}
