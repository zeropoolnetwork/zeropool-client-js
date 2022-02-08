"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RelayerBackend = void 0;
const web3_utils_1 = require("web3-utils");
const libzeropool_rs_wasm_web_1 = require("libzeropool-rs-wasm-web");
const utils_1 = require("../utils");
const tx_1 = require("./tx");
const token_abi_json_1 = __importDefault(require("./token-abi.json"));
const constants_1 = require("../constants");
const utils_2 = require("./utils");
const STATE_STORAGE_PREFIX = 'zp.eth.state';
const MESSAGE_EVENT_SIGNATURE = 'Message(uint256,bytes32,bytes)';
async function fetchTransactions(relayerUrl, offset, limit = 100) {
    const url = new URL('/transactions', relayerUrl);
    url.searchParams.set('offset', offset.toString());
    url.searchParams.set('limit', limit.toString());
    const res = await (await fetch(url.toString())).json();
    return res;
}
async function sendTransaction(relayerUrl, proof, memo, txType, depositSignature) {
    const url = new URL('/transaction', relayerUrl);
    const res = await fetch(url.toString(), { method: 'POST', body: JSON.stringify({ proof, memo, txType, depositSignature }) });
    if (!res.ok) {
        const body = await res.json();
        throw new Error(`Error ${res.status}: ${JSON.stringify(body)}`);
    }
    const json = await res.json();
    const INTERVAL_MS = 1000;
    let hash;
    while (true) {
        const job = await getJob(relayerUrl, json.jobId);
        if (job === null) {
            console.error(`Job ${json.jobId} not found.`);
            throw new Error('Job not found');
        }
        else if (job.state === 'failed') {
            throw new Error('Transaction failed');
        }
        else if (job.state = 'completed') {
            hash = job.txHash;
            break;
        }
        await new Promise(resolve => setTimeout(resolve, INTERVAL_MS));
    }
    if (!hash) {
        throw new Error('Transaction failed');
    }
    console.info(`Transaction successful: ${hash}`);
    return hash;
}
async function getJob(relayerUrl, id) {
    const url = new URL(`/job/${id}`, relayerUrl);
    const res = await (await fetch(url.toString())).json();
    if (typeof res === 'string') {
        return null;
    }
    else {
        return res;
    }
}
async function info(relayerUrl) {
    const url = new URL('/info', relayerUrl);
    const res = await fetch(url.toString());
    return await res.json();
}
class RelayerBackend {
    constructor(tokens, web3, state, snarkParams, worker) {
        this.zpState = state;
        this.worker = worker;
        this.web3 = web3;
        this.tokenContract = new this.web3.eth.Contract(token_abi_json_1.default);
        this.snarkParams = snarkParams;
        this.tokens = tokens;
    }
    async getTokenBalance(address, tokenAddress) {
        this.tokenContract.options.address = tokenAddress; // TODO: Is it possible to pass the contract address to the `call` method?
        return this.tokenContract.methods.balanceOf(address).call();
    }
    // TODO: generalize wei/gwei
    async deposit(tokenAddress, address, amountWei, fee = '0') {
        const token = this.tokens[tokenAddress];
        const tokenBalance = await this.getTokenBalance(address, tokenAddress);
        if (BigInt(amountWei) > BigInt(tokenBalance)) {
            throw new Error(`Insufficient balance for deposit. Current balance: ${tokenBalance}`);
        }
        const txType = tx_1.TxType.Deposit;
        const amountGwei = (BigInt(amountWei) / token.denominator).toString();
        const txData = await this.zpState.account.createDeposit({ amount: amountGwei, fee });
        const txProof = await this.worker.proveTx(txData.public, txData.secret);
        const txValid = libzeropool_rs_wasm_web_1.Proof.verify(this.snarkParams.transferVk, txProof.inputs, txProof.proof);
        if (!txValid) {
            throw new Error('invalid tx proof');
        }
        const nullifier = '0x' + BigInt(txData.public.nullifier).toString(16).padStart(64, '0');
        const signature = await this.web3.eth.sign(nullifier, address);
        const compactSignature = (0, utils_2.toCompactSignature)(signature).slice(2);
        await sendTransaction(token.relayerUrl, txProof, txData.memo, txType, compactSignature);
    }
    async transfer(tokenAddress, outsWei, fee = '0') {
        const token = this.tokens[tokenAddress];
        const txType = tx_1.TxType.Transfer;
        const outGwei = outsWei.map(({ to, amount }) => {
            if (!(0, libzeropool_rs_wasm_web_1.validateAddress)(to)) {
                throw new Error('Invalid address. Expected a shielded address.');
            }
            return {
                to,
                amount: (BigInt(amount) / token.denominator).toString(),
            };
        });
        const txData = await this.zpState.account.createTransfer({ outputs: outGwei, fee });
        const txProof = await this.worker.proveTx(txData.public, txData.secret);
        const txValid = libzeropool_rs_wasm_web_1.Proof.verify(this.snarkParams.transferVk, txProof.inputs, txProof.proof);
        if (!txValid) {
            throw new Error('invalid tx proof');
        }
        await sendTransaction(token.relayerUrl, txProof, txData.memo, txType);
    }
    async withdraw(tokenAddress, address, amountWei, fee = '0') {
        const token = this.tokens[tokenAddress];
        const txType = tx_1.TxType.Withdraw;
        const addressBin = (0, utils_1.hexToBuf)(address);
        const amountGwei = (BigInt(amountWei) / token.denominator).toString();
        const txData = await this.zpState.account.createWithdraw({ amount: amountGwei, to: addressBin, fee, native_amount: '0', energy_amount: '0' });
        const txProof = await this.worker.proveTx(txData.public, txData.secret);
        const txValid = libzeropool_rs_wasm_web_1.Proof.verify(this.snarkParams.transferVk, txProof.inputs, txProof.proof);
        if (!txValid) {
            throw new Error('invalid tx proof');
        }
        await sendTransaction(token.relayerUrl, txProof, txData.memo, txType);
    }
    getTotalBalance() {
        return this.zpState.getTotalBalance();
    }
    /**
     * @returns [total, account, note]
     */
    getBalances() {
        return this.zpState.getBalances();
    }
    async fetchTransactionsFromRelayer(tokenAddress) {
        const OUT = 128;
        const token = this.tokens[tokenAddress];
        let totalNumTx = 100;
        for (let i = 0; i < totalNumTx; i += OUT) { // FIXME: step
            const data = await fetchTransactions(token.relayerUrl, BigInt(i), 100);
            for (let tx of data) {
                let hashes = (0, tx_1.parseHashes)(tx);
                this.cacheShieldedTx(tx, hashes, i);
            }
        }
    }
    async updateState(tokenAddress) {
        const STORAGE_PREFIX = `${STATE_STORAGE_PREFIX}.latestCheckedBlock`;
        // TODO: Fetch txs from relayer
        // await this.fetchTransactionsFromRelayer(tokenAddress);
        const token = this.tokens[tokenAddress];
        const curBlockNumber = await this.web3.eth.getBlockNumber();
        const latestCheckedBlock = Number(localStorage.getItem(STORAGE_PREFIX)) || 0;
        // moslty useful for local testing, since getPastLogs always returns at least one latest event
        if (curBlockNumber === latestCheckedBlock) {
            return;
        }
        console.info(`Processing contract events since block ${latestCheckedBlock} to ${curBlockNumber}`);
        const logs = await this.web3.eth.getPastLogs({
            fromBlock: latestCheckedBlock,
            toBlock: curBlockNumber,
            address: token.poolAddress,
            topics: [
                (0, web3_utils_1.keccak256)(MESSAGE_EVENT_SIGNATURE) // FIXME: is this correct?
            ]
        });
        const STEP = (constants_1.CONSTANTS.OUT + 1);
        let index = Number(this.zpState.account.nextTreeIndex());
        for (const log of logs) {
            // TODO: Batch getTransaction
            const tx = await this.web3.eth.getTransaction(log.transactionHash);
            const message = tx.input;
            const txData = tx_1.EvmShieldedTx.decode(message);
            let hashes;
            try {
                hashes = txData.hashes;
            }
            catch (err) {
                console.info(`❌ Skipping invalid transaction: invalid number of outputs ${err.numOutputs}`);
                continue;
            }
            let res = this.cacheShieldedTx(txData.ciphertext, hashes, index);
            if (res) {
                index += STEP;
            }
        }
        localStorage.setItem(STORAGE_PREFIX, curBlockNumber.toString());
    }
    /**
     * Attempt to extract and save usable account/notes from transaction data.
     * @param raw hex-encoded transaction data
     */
    cacheShieldedTx(ciphertext, hashes, index) {
        const data = (0, utils_1.hexToBuf)(ciphertext);
        const pair = this.zpState.account.decryptPair(data);
        const onlyNotes = this.zpState.account.decryptNotes(data);
        // Can't rely on txData.transferIndex here since it can be anything as long as index <= pool index
        if (pair) {
            const notes = pair.notes.reduce((acc, note, noteIndex) => {
                const address = (0, libzeropool_rs_wasm_web_1.assembleAddress)(note.d, note.p_d);
                if (this.zpState.account.isOwnAddress(address)) {
                    acc.push({ note, index: index + 1 + noteIndex });
                }
                return acc;
            }, []);
            console.info(`📝 Adding account, notes, and hashes to state (at index ${index})`);
            this.zpState.account.addAccount(BigInt(index), hashes, pair.account, notes);
        }
        else if (onlyNotes.length > 0) {
            console.info(`📝 Adding notes and hashes to state (at index ${index})`);
            this.zpState.account.addNotes(BigInt(index), hashes, onlyNotes);
        }
        else {
            console.info(`📝 Adding hashes to state (at index ${index})`);
            this.zpState.account.addHashes(BigInt(index), hashes);
        }
        console.debug('New balance:', this.zpState.account.totalBalance());
        console.debug('New state:', this.zpState.account.getWholeState());
        return true;
    }
    free() {
        this.zpState.free();
    }
}
exports.RelayerBackend = RelayerBackend;
//# sourceMappingURL=relayer.js.map