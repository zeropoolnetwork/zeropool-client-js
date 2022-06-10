import { hash } from 'tweetnacl';
import { UserAccount, UserState } from 'libzeropool-rs-wasm-web';
import { bufToHex } from './utils';
import { HistoryStorage } from './history';
export class ZeroPoolState {
    static async create(sk, networkName, rpcUrl, denominator) {
        const zpState = new ZeroPoolState();
        zpState.denominator = denominator;
        const userId = bufToHex(hash(sk));
        const state = await UserState.init(`zp.${networkName}.${userId}`);
        zpState.history = await HistoryStorage.init(`zp.${networkName}.${userId}`, rpcUrl);
        try {
            const acc = new UserAccount(sk, state);
            zpState.account = acc;
        }
        catch (e) {
            console.error(e);
        }
        return zpState;
    }
    getTotalBalance() {
        return (BigInt(this.account.totalBalance()) * this.denominator).toString();
    }
    getBalances() {
        const total = BigInt(this.account.totalBalance()) * this.denominator;
        const acc = BigInt(this.account.accountBalance()) * this.denominator;
        const note = BigInt(this.account.noteBalance()) * this.denominator;
        return [total.toString(), acc.toString(), note.toString()];
    }
    rawState() {
        return this.account.getWholeState();
    }
    free() {
        this.account.free();
    }
}
//# sourceMappingURL=state.js.map