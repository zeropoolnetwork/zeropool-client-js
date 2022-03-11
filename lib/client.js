"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZeropoolClient = void 0;
const libzeropool_rs_wasm_web_1 = require("libzeropool-rs-wasm-web");
const utils_1 = require("./utils");
const state_1 = require("./state");
const tx_1 = require("./tx");
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
    static async create(config) {
        const client = new ZeropoolClient();
        client.zpStates = {};
        client.worker = config.worker;
        client.snarkParams = config.snarkParams;
        client.tokens = config.tokens;
        client.config = config;
        let networkName = config.networkName;
        if (!networkName) {
            networkName = config.network.defaultNetworkName();
        }
        for (const [address, token] of Object.entries(config.tokens)) {
            const denominator = await config.network.getDenominator(token.poolAddress);
            client.zpStates[address] = await state_1.ZeroPoolState.create(config.sk, networkName, BigInt(denominator));
        }
        return client;
    }
    generateAddress(tokenAddress) {
        const state = this.zpStates[tokenAddress];
        return state.account.generateAddress();
    }
    // TODO: generalize wei/gwei
    async deposit(tokenAddress, amountWei, sign, fromAddress = null, fee = '0') {
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
        // TODO: Sign fromAddress as well?
        const signature = await sign(nullifier);
        let fullSignature = signature;
        if (fromAddress) {
            fullSignature = fromAddress + signature;
        }
        if (this.config.network.isSignatureCompact()) {
            fullSignature = (0, utils_1.toCompactSignature)(fullSignature);
        }
        await sendTransaction(token.relayerUrl, txProof, txData.memo, txType, fullSignature);
    }
    async transfer(tokenAddress, outsWei, fee = '0') {
        await this.updateState(tokenAddress);
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
        await this.updateState(tokenAddress);
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
    async getTotalBalance(tokenAddress) {
        await this.updateState(tokenAddress);
        return this.zpStates[tokenAddress].getTotalBalance();
    }
    /**
     * @returns [total, account, note]
     */
    async getBalances(tokenAddress) {
        await this.updateState(tokenAddress);
        return this.zpStates[tokenAddress].getBalances();
    }
    async updateState(tokenAddress) {
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
    // TODO: Make updateState implementation configurable through DI.
    // public async updateStateFromNode(tokenAddress: string) {
    //   const STORAGE_PREFIX = `${STATE_STORAGE_PREFIX}.latestCheckedBlock`;
    //   // TODO: Fetch txs from relayer
    //   // await this.fetchTransactionsFromRelayer(tokenAddress);
    //   const token = this.tokens[tokenAddress];
    //   const state = this.zpStates[tokenAddress];
    //   const curBlockNumber = await this.web3.eth.getBlockNumber();
    //   const latestCheckedBlock = Number(localStorage.getItem(STORAGE_PREFIX)) || 0;
    //   // moslty useful for local testing, since getPastLogs always returns at least one latest event
    //   if (curBlockNumber === latestCheckedBlock) {
    //     return;
    //   }
    //   console.info(`Processing contract events since block ${latestCheckedBlock} to ${curBlockNumber}`);
    //   const logs = await this.web3.eth.getPastLogs({
    //     fromBlock: latestCheckedBlock,
    //     toBlock: curBlockNumber,
    //     address: token.poolAddress,
    //     topics: [
    //       keccak256(MESSAGE_EVENT_SIGNATURE)
    //     ]
    //   });
    //   const STEP: number = (CONSTANTS.OUT + 1);
    //   let index = Number(state.account.nextTreeIndex());
    //   for (const log of logs) {
    //     // TODO: Batch getTransaction
    //     const tx = await this.web3.eth.getTransaction(log.transactionHash);
    //     const message = tx.input;
    //     const txData = EvmShieldedTx.decode(message);
    //     let hashes;
    //     try {
    //       hashes = txData.hashes;
    //     } catch (err) {
    //       console.info(`❌ Skipping invalid transaction: invalid number of outputs ${err.numOutputs}`);
    //       continue;
    //     }
    //     let res = this.cacheShieldedTx(tokenAddress, txData.ciphertext, hashes, index);
    //     if (res) {
    //       index += STEP;
    //     }
    //   }
    //   localStorage.setItem(STORAGE_PREFIX, curBlockNumber.toString());
    // }
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