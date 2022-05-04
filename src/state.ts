import { hash } from 'tweetnacl';

import { UserAccount, UserState } from 'libzeropool-rs-wasm-web';
import { bufToHex } from './utils';
import { HistoryStorage } from './history';
import { zp } from './zp';

export class ZeroPoolState {
  public denominator: bigint;
  public account: UserAccount;
  public history: HistoryStorage;

  /**
   * Initialize ZeroPoolState for the specified user account (spending key).
   * @param sk spending key
   * @param networkName network name (ethereum, kovan, etc.)
   * @param rpcUrl node RPC url
   * @param denominator pool currency denominator
   * @returns {ZeroPoolState}
   */
  public static async create(sk: Uint8Array, networkName: string, rpcUrl: string, denominator: bigint): Promise<ZeroPoolState> {
    const zpState = new ZeroPoolState();
    zpState.denominator = denominator;
    const userId = bufToHex(hash(sk));
    const state = await zp.UserState.init(`zp.${networkName}.${userId}`);
    zpState.history = await HistoryStorage.init(`zp.${networkName}.${userId}`, rpcUrl);

    try {
      const acc = new zp.UserAccount(sk, state);
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

  public rawState(): any {
    return this.account.getWholeState();
  }

  public async clean(): Promise<void> {
    await this.account.cleanState();
    await this.history.cleanHistory();
  }

  public free(): void {
    this.account.free();
  }
}
