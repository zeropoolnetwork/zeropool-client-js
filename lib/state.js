import { hash } from 'tweetnacl';
import { bufToHex } from './utils';
import { HistoryStorage } from './history';
import { zp } from './zp';
export class ZeroPoolState {
    static async create(sk, networkName, rpcUrl, denominator) {
        const zpState = new ZeroPoolState();
        zpState.denominator = denominator;
        const userId = bufToHex(hash(sk));
        const state = await zp.UserState.init(`zp.${networkName}.${userId}`);
        zpState.history = await HistoryStorage.init(`zp.${networkName}.${userId}`, rpcUrl);
        try {
            const acc = new zp.UserAccount(sk, state);
            zpState.account = acc;
        }
        catch (e) {
            console.error(e);
        }
        return zpState;
    }
    // in wei
    getTotalBalance() {
        return BigInt(this.account.totalBalance()) * this.denominator;
    }
    // in wei
    getBalances() {
        const total = BigInt(this.account.totalBalance()) * this.denominator;
        const acc = BigInt(this.account.accountBalance()) * this.denominator;
        const note = BigInt(this.account.noteBalance()) * this.denominator;
        return [total, acc, note];
    }
    // in Gwei
    accountBalance() {
        return BigInt(this.account.accountBalance());
    }
    usableNotes() {
        return this.account.getUsableNotes();
    }
    isOwnAddress(shieldedAddress) {
        return this.account.isOwnAddress(shieldedAddress);
    }
    rawState() {
        return this.account.getWholeState();
    }
    // TODO: implement thiss method
    async clean() {
        //await this.account.cleanState();
        await this.history.cleanHistory();
    }
    free() {
        this.account.free();
    }
}
//# sourceMappingURL=state.js.map