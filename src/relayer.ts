import BN from 'bn.js';
import { Tokens } from 'config';
import type { Proof } from 'libzeropool-rs-wasm-web';

import { TxType } from './tx';

const DEFAULT_TX_FEE = new BN(0);

export interface RelayerInfoV2 {
  apiVersion?: RelayerApiVersion.V2,
  root: string;
  optimisticRoot: string;
  deltaIndex: string;
  optimisticDeltaIndex: string;
}

export interface RelayerInfoV3 {
  apiVersion: RelayerApiVersion.V3,
  backend: string,
  root: string,
  optimisticRoot: string,
  poolIndex: string,
  optimisticIndex: string,
}

export type RelayerInfo = RelayerInfoV2 | RelayerInfoV3;

export enum RelayerApiVersion {
  V2 = '2',
  V3 = '3',
}

export interface TxToRelayer {
  txType: TxType;
  memo: string;
  proof: Proof;
  extraData?: string,
}

export interface JobInfo {
  state: string;
  txHash: string | string[];
  createdOn: BN;
  finishedOn?: BN;
  failedReason?: string;
}

export class RelayerAPI {
  private version: RelayerApiVersion = RelayerApiVersion.V2;

  constructor(private tokens: Tokens) { }

  public static async create(tokens: Tokens): Promise<RelayerAPI> {
    const self = new RelayerAPI(tokens);
    const info = await self.info(Object.keys(tokens)[0]);

    if (info.apiVersion === RelayerApiVersion.V3) {
      self.version = RelayerApiVersion.V3;
    }

    console.log('Relayer API initialized', info);

    return self;
  }

  public async fetchTransactionsOptimistic(tokenAddress: string, offset: BN, limit: number = 100): Promise<string[]> {
    const url = new URL(`/transactions/v2`, this.tokens[tokenAddress].relayerUrl);
    url.searchParams.set('limit', limit.toString());
    url.searchParams.set('offset', offset.toString());
    const headers = { 'content-type': 'application/json;charset=UTF-8' };
    return await (await fetch(url.toString(), { headers })).json();
  }

  public async sendTransactions(tokenAddress: string, txs: TxToRelayer[]): Promise<string> {
    const url = new URL('/sendTransactions', this.tokens[tokenAddress].relayerUrl);
    const headers = { 'content-type': 'application/json;charset=UTF-8' };
    const res = await fetch(url.toString(), { method: 'POST', headers, body: JSON.stringify(txs) });

    if (!res.ok) {
      const body = await res.json();
      throw new Error(`Error ${res.status}: ${JSON.stringify(body)}`)
    }

    const json = await res.json();
    return json.jobId;
  }

  public async getJob(tokenAddress: string, id: string): Promise<JobInfo | null> {
    const url = new URL(`/job/${id}`, this.tokens[tokenAddress].relayerUrl);
    const headers = { 'content-type': 'application/json;charset=UTF-8' };
    const res = await (await fetch(url.toString(), { headers })).json();

    if (typeof res === 'string') {
      return null;
    } else {
      return res;
    }
  }

  public async info(tokenAddress: string): Promise<RelayerInfo> {
    const url = new URL('/info', this.tokens[tokenAddress].relayerUrl);
    const headers = { 'content-type': 'application/json;charset=UTF-8' };
    const res = await fetch(url.toString(), { headers });

    return await res.json();
  }

  public async fee(tokenAddress: string): Promise<BN> {
    try {
      const url = new URL('/fee', this.tokens[tokenAddress].relayerUrl);
      const headers = { 'content-type': 'application/json;charset=UTF-8' };
      const res = await (await fetch(url.toString(), { headers })).json();
      return new BN(res.fee);
    } catch {
      return DEFAULT_TX_FEE;
    }
  }
}
