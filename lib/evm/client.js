"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZeropoolClient = void 0;
const web3_1 = __importDefault(require("web3"));
const web3_utils_1 = require("web3-utils");
const web3_eth_contract_1 = require("web3-eth-contract");
const libzeropool_rs_wasm_web_1 = require("libzeropool-rs-wasm-web");
const utils_1 = require("../utils");
const state_1 = require("../state");
const tx_1 = require("./tx");
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
    // if (!hash) {
    //     throw new Error('Transaction failed');
    // }
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
class ZeropoolClient {
    static async create(sk, tokens, rpcUrl, snarkParams, worker, networkName = 'ethereum') {
        const client = new ZeropoolClient();
        client.zpStates = {};
        client.worker = worker;
        client.web3 = new web3_1.default(rpcUrl);
        client.snarkParams = snarkParams;
        client.tokens = tokens;
        const abi = [
            {
                constant: true,
                inputs: [],
                name: 'denominator',
                outputs: [
                    {
                        name: '',
                        type: 'uint256',
                    }
                ],
                payable: false,
                type: 'function',
            }
        ];
        for (const [address, token] of Object.entries(tokens)) {
            const contract = new web3_eth_contract_1.Contract(abi, address);
            const denominator = await contract.methods.denominator().call();
            client.zpStates[address] = await state_1.ZeroPoolState.create(sk, networkName, denominator);
        }
        return client;
    }
    // TODO: generalize wei/gwei
    async deposit(tokenAddress, amountWei, sign, fee = '0') {
        await this.updateState(tokenAddress);
        const token = this.tokens[tokenAddress];
        const state = this.zpStates[tokenAddress];
        const txType = tx_1.TxType.Deposit;
        const amountGwei = (BigInt(amountWei) / state.denominator).toString();
        const txData = await state.account.createDeposit({ amount: amountGwei, fee });
        const txProof = await this.worker.proveTx(txData.public, txData.secret);
        const txValid = libzeropool_rs_wasm_web_1.Proof.verify(this.snarkParams.transferVk, txProof.inputs, txProof.proof);
        if (!txValid) {
            throw new Error('invalid tx proof');
        }
        const nullifier = '0x' + BigInt(txData.public.nullifier).toString(16).padStart(64, '0');
        const signature = await sign(nullifier);
        const compactSignature = (0, utils_2.toCompactSignature)(signature).slice(2);
        await sendTransaction(token.relayerUrl, txProof, txData.memo, txType, compactSignature);
    }
    async transfer(tokenAddress, outsWei, fee = '0') {
        const token = this.tokens[tokenAddress];
        const state = this.zpStates[tokenAddress];
        const txType = tx_1.TxType.Transfer;
        const outGwei = outsWei.map(({ to, amount }) => {
            if (!(0, libzeropool_rs_wasm_web_1.validateAddress)(to)) {
                throw new Error('Invalid address. Expected a shielded address.');
            }
            return {
                to,
                amount: (BigInt(amount) / state.denominator).toString(),
            };
        });
        const txData = await state.account.createTransfer({ outputs: outGwei, fee });
        const txProof = await this.worker.proveTx(txData.public, txData.secret);
        const txValid = libzeropool_rs_wasm_web_1.Proof.verify(this.snarkParams.transferVk, txProof.inputs, txProof.proof);
        if (!txValid) {
            throw new Error('invalid tx proof');
        }
        await sendTransaction(token.relayerUrl, txProof, txData.memo, txType);
    }
    async withdraw(tokenAddress, address, amountWei, fee = '0') {
        const token = this.tokens[tokenAddress];
        const state = this.zpStates[tokenAddress];
        const txType = tx_1.TxType.Withdraw;
        const addressBin = (0, utils_1.hexToBuf)(address);
        const amountGwei = (BigInt(amountWei) / state.denominator).toString();
        const txData = await state.account.createWithdraw({ amount: amountGwei, to: addressBin, fee, native_amount: '0', energy_amount: '0' });
        const txProof = await this.worker.proveTx(txData.public, txData.secret);
        const txValid = libzeropool_rs_wasm_web_1.Proof.verify(this.snarkParams.transferVk, txProof.inputs, txProof.proof);
        if (!txValid) {
            throw new Error('invalid tx proof');
        }
        await sendTransaction(token.relayerUrl, txProof, txData.memo, txType);
    }
    // TODO: Transaction list
    getTotalBalance(tokenAddress) {
        return this.zpStates[tokenAddress].getTotalBalance();
    }
    /**
     * @returns [total, account, note]
     */
    getBalances(tokenAddress) {
        return this.zpStates[tokenAddress].getBalances();
    }
    async updateState(tokenAddress) {
        return this.updateStateFromNode(tokenAddress);
    }
    async updateStateFromRelayer(tokenAddress) {
        const OUT = 128;
        const token = this.tokens[tokenAddress];
        let totalNumTx = 100;
        for (let i = 0; i < totalNumTx; i += OUT) { // FIXME: step
            const data = await fetchTransactions(token.relayerUrl, BigInt(i), 100);
            for (let tx of data) {
                let hashes = (0, tx_1.parseHashes)(tx);
                this.cacheShieldedTx(tokenAddress, tx, hashes, i);
            }
        }
    }
    async updateStateFromNode(tokenAddress) {
        const STORAGE_PREFIX = `${STATE_STORAGE_PREFIX}.latestCheckedBlock`;
        // TODO: Fetch txs from relayer
        // await this.fetchTransactionsFromRelayer(tokenAddress);
        const token = this.tokens[tokenAddress];
        const state = this.zpStates[tokenAddress];
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
                (0, web3_utils_1.keccak256)(MESSAGE_EVENT_SIGNATURE)
            ]
        });
        const STEP = (constants_1.CONSTANTS.OUT + 1);
        let index = Number(state.account.nextTreeIndex());
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
            let res = this.cacheShieldedTx(tokenAddress, txData.ciphertext, hashes, index);
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
    cacheShieldedTx(tokenAddress, ciphertext, hashes, index) {
        const state = this.zpStates[tokenAddress];
        const data = (0, utils_1.hexToBuf)(ciphertext);
        const pair = state.account.decryptPair(data);
        const onlyNotes = state.account.decryptNotes(data);
        // Can't rely on txData.transferIndex here since it can be anything as long as index <= pool index
        if (pair) {
            const notes = pair.notes.reduce((acc, note, noteIndex) => {
                const address = (0, libzeropool_rs_wasm_web_1.assembleAddress)(note.d, note.p_d);
                if (state.account.isOwnAddress(address)) {
                    acc.push({ note, index: index + 1 + noteIndex });
                }
                return acc;
            }, []);
            console.info(`📝 Adding account, notes, and hashes to state (at index ${index})`);
            state.account.addAccount(BigInt(index), hashes, pair.account, notes);
        }
        else if (onlyNotes.length > 0) {
            console.info(`📝 Adding notes and hashes to state (at index ${index})`);
            state.account.addNotes(BigInt(index), hashes, onlyNotes);
        }
        else {
            console.info(`📝 Adding hashes to state (at index ${index})`);
            state.account.addHashes(BigInt(index), hashes);
        }
        console.debug('New balance:', state.account.totalBalance());
        console.debug('New state:', state.account.getWholeState());
        return true;
    }
    free() {
        for (let state of Object.values(this.zpStates)) {
            state.free();
        }
    }
}
exports.ZeropoolClient = ZeropoolClient;
//# sourceMappingURL=client.js.map