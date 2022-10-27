import { hash } from 'tweetnacl';
import type { UserAccount } from 'libzeropool-rs-wasm-web';

import { bufToHex } from './utils';
import { HistoryStorage } from './history'
import { zp } from './zp';
import { NetworkBackend } from './networks/network';

export class ZeroPoolState {
  public denominator: bigint;
  public account: UserAccount;
  public history: HistoryStorage;

  public static async create(sk: Uint8Array, networkName: string, network: NetworkBackend, denominator: bigint): Promise<ZeroPoolState> {
    const zpState = new ZeroPoolState();
    zpState.denominator = denominator;
    const userId = bufToHex(hash(sk));
    const state = await zp.UserState.init(`zp.${networkName}.${userId}`);
    zpState.history = await HistoryStorage.init(`zp.${networkName}.${userId}`, network);

    try {
      const acc = new zp.UserAccount(sk, state);
      zpState.account = acc;
    } catch (e) {
      console.error(e);
    }

    return zpState;
  }

  // in wei
  public getTotalBalance(): bigint {
    return BigInt(this.account.totalBalance()) * this.denominator;
  }

  // in wei
  public getBalances(): [bigint, bigint, bigint] {
    const total = BigInt(this.account.totalBalance()) * this.denominator;
    const acc = BigInt(this.account.accountBalance()) * this.denominator;
    const note = BigInt(this.account.noteBalance()) * this.denominator;

    return [total, acc, note];
  }

  // in Gwei
  public accountBalance(): bigint {
    return BigInt(this.account.accountBalance());
  }

  public usableNotes(): any[] {
    return this.account.getUsableNotes();
  }

  public isOwnAddress(shieldedAddress: string): boolean {
    return this.account.isOwnAddress(shieldedAddress);
  }

  public rawState(): any {
    return this.account.getWholeState();
  }

  // TODO: implement thiss method
  public async clean(): Promise<void> {
    //await this.account.cleanState();
    await this.history.cleanHistory();
  }

  public free(): void {
    this.account.free();
  }
}
