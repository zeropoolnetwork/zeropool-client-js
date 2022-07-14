import { hash } from 'tweetnacl';

import { UserAccount, UserState } from 'libzkbob-rs-wasm-web';
import { bufToHex } from './utils';
import { HistoryStorage } from './history'

export class ZkBobState {
  public denominator: bigint;
  public account: UserAccount;
  public history: HistoryStorage;

  public static async create(sk: Uint8Array, networkName: string, rpcUrl: string, denominator: bigint): Promise<ZkBobState> {
    const zpState = new ZkBobState();
    zpState.denominator = denominator;
    const userId = bufToHex(hash(sk));
    const state = await UserState.init(`zp.${networkName}.${userId}`);
    zpState.history = await HistoryStorage.init(`zp.${networkName}.${userId}`, rpcUrl);

    try {
      const acc = new UserAccount(sk, state);
      zpState.account = acc;
    } catch (e) {
      console.error(e);
    }

    return zpState;
  }

  public getTotalBalance(): string {
    return (BigInt(this.account.totalBalance()) * this.denominator).toString();
  }

  public getBalances(): [string, string, string] {
    const total = BigInt(this.account.totalBalance()) * this.denominator;
    const acc = BigInt(this.account.accountBalance()) * this.denominator;
    const note = BigInt(this.account.noteBalance()) * this.denominator;

    return [total.toString(), acc.toString(), note.toString()];
  }

  public accountBalance(): string {
    return this.account.accountBalance();
  }

  public usableNotes(): any {
    return this.account.getUsableNotes();
  }

  public rawState(): any {
    return this.account.getWholeState();
  }

  public async clean(): Promise<void> {
    //await this.account.cleanState();
    await this.history.cleanHistory();
  }

  public free(): void {
    this.account.free();
  }
}
