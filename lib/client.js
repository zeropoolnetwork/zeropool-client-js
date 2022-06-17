"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZeropoolClient = void 0;
const libzkbob_rs_wasm_web_1 = require("libzkbob-rs-wasm-web");
const utils_1 = require("./utils");
const state_1 = require("./state");
const tx_1 = require("./tx");
const constants_1 = require("./constants");
const history_1 = require("./history");
async function fetchTransactions(relayerUrl, offset, limit = 100) {
    const url = new URL(`/transactions`, relayerUrl);
    url.searchParams.set('limit', limit.toString());
    url.searchParams.set('offset', offset.toString());
    const res = await (await fetch(url.toString())).json();
    return res;
}
async function fetchTransactionsOptimistic(relayerUrl, offset, limit = 100) {
    const url = new URL(`/transactions/v2`, relayerUrl);
    url.searchParams.set('limit', limit.toString());
    url.searchParams.set('offset', offset.toString());
    const res = await (await fetch(url.toString())).json();
    return res;
}
// returns transaction job ID
async function sendTransaction(relayerUrl, proof, memo, txType, depositSignature) {
    const url = new URL('/transaction', relayerUrl);
    const res = await fetch(url.toString(), { method: 'POST', body: JSON.stringify({ proof, memo, txType, depositSignature }) });
    if (!res.ok) {
        const body = await res.json();
        throw new Error(`Error ${res.status}: ${JSON.stringify(body)}`);
    }
    const json = await res.json();
    return json.jobId;
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
            client.zpStates[address] = await state_1.ZeroPoolState.create(config.sk, networkName, config.network.getRpcUrl(), BigInt(denominator));
        }
        return client;
    }
    generateAddress(tokenAddress) {
        const state = this.zpStates[tokenAddress];
        return state.account.generateAddress();
    }
    // TODO: generalize wei/gwei
    async deposit(tokenAddress, amountWei, sign, fromAddress = null, fee = '0') {
        const token = this.tokens[tokenAddress];
        const state = this.zpStates[tokenAddress];
        if (BigInt(amountWei) < state.denominator) {
            throw new Error('Value is too small');
        }
        await this.updateState(tokenAddress);
        const amountGwei = (BigInt(amountWei) / state.denominator).toString();
        let txData = await state.account.createDeposit({ amount: amountGwei, fee });
        const startProofDate = Date.now();
        const txProof = await this.worker.proveTx(txData.public, txData.secret);
        const proofTime = (Date.now() - startProofDate) / 1000;
        console.log(`Proof calculation took ${proofTime.toFixed(1)} sec`);
        const txValid = libzkbob_rs_wasm_web_1.Proof.verify(this.snarkParams.transferVk, txProof.inputs, txProof.proof);
        if (!txValid) {
            throw new Error('invalid tx proof');
        }
        // regular deposit through approve allowance: sign transaction nullifier
        let dataToSign = '0x' + BigInt(txData.public.nullifier).toString(16).padStart(64, '0');
        // TODO: Sign fromAddress as well?
        const signature = (0, utils_1.truncateHexPrefix)(await sign(dataToSign));
        let fullSignature = signature;
        if (fromAddress) {
            const addr = (0, utils_1.truncateHexPrefix)(fromAddress);
            fullSignature = addr + signature;
        }
        if (this.config.network.isSignatureCompact()) {
            fullSignature = (0, utils_1.toCompactSignature)(fullSignature);
        }
        return await sendTransaction(token.relayerUrl, txProof, txData.memo, tx_1.TxType.Deposit, fullSignature);
    }
    async depositPermittable(tokenAddress, amountWei, signTypedData, fromAddress = null, fee = '0') {
        const token = this.tokens[tokenAddress];
        const state = this.zpStates[tokenAddress];
        if (BigInt(amountWei) < state.denominator) {
            throw new Error('Value is too small');
        }
        await this.updateState(tokenAddress);
        const amountGwei = (BigInt(amountWei) / state.denominator).toString();
        let txData;
        if (fromAddress) {
            const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
            const holder = (0, utils_1.hexToBuf)(fromAddress);
            txData = await state.account.createDepositPermittable({ amount: amountGwei, fee, deadline: String(deadline), holder });
            const startProofDate = Date.now();
            const txProof = await this.worker.proveTx(txData.public, txData.secret);
            const proofTime = (Date.now() - startProofDate) / 1000;
            console.log(`Proof calculation took ${proofTime.toFixed(1)} sec`);
            const txValid = libzkbob_rs_wasm_web_1.Proof.verify(this.snarkParams.transferVk, txProof.inputs, txProof.proof);
            if (!txValid) {
                throw new Error('invalid tx proof');
            }
            // permittable deposit signature should be calculated for the typed data
            const value = BigInt(amountWei) + BigInt(fee);
            let signature = (0, utils_1.truncateHexPrefix)(await signTypedData(deadline, value));
            if (this.config.network.isSignatureCompact()) {
                signature = (0, utils_1.toCompactSignature)(signature);
            }
            return await sendTransaction(token.relayerUrl, txProof, txData.memo, tx_1.TxType.BridgeDeposit, signature);
        }
        else {
            throw new Error('You must provide fromAddress for bridge deposit transaction ');
        }
    }
    async transfer(tokenAddress, outsWei, fee = '0') {
        await this.updateState(tokenAddress);
        const token = this.tokens[tokenAddress];
        const state = this.zpStates[tokenAddress];
        const txType = tx_1.TxType.Transfer;
        const outGwei = outsWei.map(({ to, amount }) => {
            if (!(0, libzkbob_rs_wasm_web_1.validateAddress)(to)) {
                throw new Error('Invalid address. Expected a shielded address.');
            }
            const bnAmount = BigInt(amount);
            if (bnAmount < state.denominator) {
                throw new Error('One of the values is too small');
            }
            return {
                to,
                amount: (bnAmount / state.denominator).toString(),
            };
        });
        const txData = await state.account.createTransfer({ outputs: outGwei, fee });
        const startProofDate = Date.now();
        const txProof = await this.worker.proveTx(txData.public, txData.secret);
        const proofTime = (Date.now() - startProofDate) / 1000;
        console.log(`Proof calculation took ${proofTime.toFixed(1)} sec`);
        const txValid = libzkbob_rs_wasm_web_1.Proof.verify(this.snarkParams.transferVk, txProof.inputs, txProof.proof);
        if (!txValid) {
            throw new Error('invalid tx proof');
        }
        return await sendTransaction(token.relayerUrl, txProof, txData.memo, txType);
    }
    async withdraw(tokenAddress, address, amountWei, fee = '0') {
        const token = this.tokens[tokenAddress];
        const state = this.zpStates[tokenAddress];
        if (BigInt(amountWei) < state.denominator) {
            throw new Error('Value is too small');
        }
        await this.updateState(tokenAddress);
        const txType = tx_1.TxType.Withdraw;
        const addressBin = (0, utils_1.hexToBuf)(address);
        const amountGwei = (BigInt(amountWei) / state.denominator).toString();
        const txData = await state.account.createWithdraw({ amount: amountGwei, to: addressBin, fee, native_amount: '0', energy_amount: '0' });
        const startProofDate = Date.now();
        const txProof = await this.worker.proveTx(txData.public, txData.secret);
        const proofTime = (Date.now() - startProofDate) / 1000;
        console.log(`Proof calculation took ${proofTime.toFixed(1)} sec`);
        const txValid = libzkbob_rs_wasm_web_1.Proof.verify(this.snarkParams.transferVk, txProof.inputs, txProof.proof);
        if (!txValid) {
            throw new Error('invalid tx proof');
        }
        return await sendTransaction(token.relayerUrl, txProof, txData.memo, txType);
    }
    // return transaction hash on success or throw an error
    async waitJobCompleted(tokenAddress, jobId) {
        const token = this.tokens[tokenAddress];
        const INTERVAL_MS = 1000;
        let hash;
        while (true) {
            const job = await getJob(token.relayerUrl, jobId);
            if (job === null) {
                console.error(`Job ${jobId} not found.`);
                throw new Error('Job ${jobId} not found');
            }
            else if (job.state === 'failed') {
                throw new Error('Transaction [job ${jobId}] failed');
            }
            else if (job.state === 'completed') {
                hash = job.txHash;
                break;
            }
            await new Promise(resolve => setTimeout(resolve, INTERVAL_MS));
        }
        console.info(`Transaction [job ${jobId}] successful: ${hash}`);
        return hash;
    }
    // TODO: Transaction list
    async getTotalBalance(tokenAddress) {
        await this.updateState(tokenAddress);
        return this.zpStates[tokenAddress].getTotalBalance();
    }
    async getOptimisticTotalBalance(tokenAddress) {
        const state = this.zpStates[tokenAddress];
        const confirmedBalance = await this.getTotalBalance(tokenAddress);
        const historyRecords = await this.getAllHistory(tokenAddress);
        let pendingDelta = BigInt(0);
        for (const oneRecord of historyRecords) {
            if (oneRecord.pending) {
                switch (oneRecord.type) {
                    case history_1.HistoryTransactionType.Deposit:
                    case history_1.HistoryTransactionType.TransferIn: {
                        pendingDelta += oneRecord.amount;
                        break;
                    }
                    case history_1.HistoryTransactionType.Withdrawal:
                    case history_1.HistoryTransactionType.TransferOut: {
                        pendingDelta -= oneRecord.amount;
                        break;
                    }
                    default: break;
                }
                pendingDelta -= oneRecord.fee;
            }
        }
        return (BigInt(confirmedBalance) + (pendingDelta * state.denominator)).toString();
    }
    /**
     * @returns [total, account, note]
     */
    async getBalances(tokenAddress) {
        await this.updateState(tokenAddress);
        return this.zpStates[tokenAddress].getBalances();
    }
    async rawState(tokenAddress) {
        return await this.zpStates[tokenAddress].rawState();
    }
    async getAllHistory(tokenAddress) {
        await this.updateState(tokenAddress);
        return await this.zpStates[tokenAddress].history.getAllHistory();
    }
    async isReadyToTransact(tokenAddress) {
        return await this.updateState(tokenAddress);
    }
    async waitReadyToTransact(tokenAddress) {
        const token = this.tokens[tokenAddress];
        const INTERVAL_MS = 1000;
        const MAX_ATTEMPTS = 300;
        let attepts = 0;
        while (true) {
            let ready = await this.updateState(tokenAddress);
            if (ready) {
                break;
            }
            attepts++;
            if (attepts > MAX_ATTEMPTS) {
                return false;
            }
            await new Promise(resolve => setTimeout(resolve, INTERVAL_MS));
        }
        return true;
    }
    async cleanState(tokenAddress) {
        await this.zpStates[tokenAddress].clean();
    }
    async updateState(tokenAddress) {
        if (this.updateStatePromise == undefined) {
            this.updateStatePromise = this.updateStateOptimisticWorker(tokenAddress).finally(() => {
                this.updateStatePromise = undefined;
            });
        }
        else {
            console.info(`The state currently updating, waiting for finish...`);
        }
        return this.updateStatePromise;
    }
    // Deprecated method. Please use updateStateOptimisticWorker instead
    async updateStateWorker(tokenAddress) {
        const OUTPLUSONE = constants_1.CONSTANTS.OUT + 1;
        const BATCH_SIZE = 100;
        const zpState = this.zpStates[tokenAddress];
        const token = this.tokens[tokenAddress];
        const state = this.zpStates[tokenAddress];
        const startIndex = Number(zpState.account.nextTreeIndex());
        const nextIndex = Number((await info(token.relayerUrl)).deltaIndex);
        if (nextIndex > startIndex) {
            const startTime = Date.now();
            console.log(`⬇ Fetching transactions between ${startIndex} and ${nextIndex}...`);
            let batches = [];
            for (let i = startIndex; i <= nextIndex; i = i + BATCH_SIZE * OUTPLUSONE) {
                let oneBatch = fetchTransactions(token.relayerUrl, BigInt(i), BATCH_SIZE).then(txs => {
                    console.log(`Getting ${txs.length} transactions from index ${i}`);
                    let txHashes = {};
                    let indexedTxs = [];
                    for (let txIdx = 0; txIdx < txs.length; ++txIdx) {
                        const tx = txs[txIdx];
                        // Get the first leaf index in the tree
                        const memo_idx = i + txIdx * OUTPLUSONE;
                        // tx structure from relayer: commitment(32 bytes) + txHash(32 bytes) + memo
                        // 1. Extract memo block
                        const memo = tx.slice(128); // Skip commitment and txHash
                        // 2. Get transaction commitment
                        const commitment = tx.slice(0, 64);
                        const indexedTx = {
                            index: memo_idx,
                            memo: (0, utils_1.hexToBuf)(memo),
                            commitment: (0, utils_1.hexToBuf)(commitment),
                        };
                        indexedTxs.push(indexedTx);
                        txHashes[memo_idx] = '0x' + tx.substr(64, 64);
                    }
                    const decryptedMemos = state.account.cacheTxs(indexedTxs);
                    this.logStateSync(i, i + txs.length * OUTPLUSONE, decryptedMemos);
                    for (let decryptedMemoIndex = 0; decryptedMemoIndex < decryptedMemos.length; ++decryptedMemoIndex) {
                        // save memos corresponding to the our account to restore history
                        const myMemo = decryptedMemos[decryptedMemoIndex];
                        myMemo.txHash = txHashes[myMemo.index];
                        zpState.history.saveDecryptedMemo(myMemo, false);
                        // try to convert history on the fly
                        // let hist = convertToHistory(myMemo, txHash);
                        // historyPromises.push(hist);
                    }
                    return txs.length;
                });
                batches.push(oneBatch);
            }
            ;
            let txCount = (await Promise.all(batches)).reduce((acc, cur) => acc + cur);
            ;
            const msElapsed = Date.now() - startTime;
            const avgSpeed = msElapsed / txCount;
            console.log(`Sync finished in ${msElapsed / 1000} sec | ${txCount} tx, avg speed ${avgSpeed.toFixed(1)} ms/tx`);
        }
        else {
            console.log(`Local state is up to date @${startIndex}`);
        }
        // Unoptimistic method: it's assumes we always ready to transact
        // (but transaction could fail due to doublespend reason)
        return true;
    }
    // ---===< TODO >===---
    // The optimistic state currently processed only in the client library
    // Wasm package holds only the mined transactions
    // Currently it's juat a workaround
    async updateStateOptimisticWorker(tokenAddress) {
        const OUTPLUSONE = constants_1.CONSTANTS.OUT + 1;
        const BATCH_SIZE = 10000;
        const zpState = this.zpStates[tokenAddress];
        const token = this.tokens[tokenAddress];
        const state = this.zpStates[tokenAddress];
        const startIndex = Number(zpState.account.nextTreeIndex());
        const nextIndex = Number((await info(token.relayerUrl)).deltaIndex);
        // TODO: it's just a workaroud while relayer doesn't return optimistic index!
        const optimisticIndex = nextIndex + 1;
        if (optimisticIndex > startIndex) {
            const startTime = Date.now();
            console.log(`⬇ Fetching transactions between ${startIndex} and ${nextIndex}...`);
            let batches = [];
            let readyToTransact = true;
            for (let i = startIndex; i <= nextIndex; i = i + BATCH_SIZE * OUTPLUSONE) {
                let oneBatch = fetchTransactionsOptimistic(token.relayerUrl, BigInt(i), BATCH_SIZE).then(txs => {
                    console.log(`Getting ${txs.length} transactions from index ${i}`);
                    let txHashes = {};
                    let indexedTxs = [];
                    let txHashesPending = {};
                    let indexedTxsPending = [];
                    let maxMinedIndex = -1;
                    let maxPendingIndex = -1;
                    for (let txIdx = 0; txIdx < txs.length; ++txIdx) {
                        const tx = txs[txIdx];
                        // Get the first leaf index in the tree
                        const memo_idx = i + txIdx * OUTPLUSONE;
                        // tx structure from relayer: mined flag + txHash(32 bytes, 64 chars) + commitment(32 bytes, 64 chars) + memo
                        // 1. Extract memo block
                        const memo = tx.slice(129); // Skip mined flag, txHash and commitment
                        // 2. Get transaction commitment
                        const commitment = tx.substr(65, 64);
                        const indexedTx = {
                            index: memo_idx,
                            memo: (0, utils_1.hexToBuf)(memo),
                            commitment: (0, utils_1.hexToBuf)(commitment),
                        };
                        // 3. Get txHash
                        const txHash = tx.substr(1, 64);
                        // 4. Get mined flag
                        if (tx.substr(0, 1) === '1') {
                            indexedTxs.push(indexedTx);
                            txHashes[memo_idx] = '0x' + txHash;
                            maxMinedIndex = Math.max(maxMinedIndex, memo_idx);
                        }
                        else {
                            indexedTxsPending.push(indexedTx);
                            txHashesPending[memo_idx] = '0x' + txHash;
                            maxPendingIndex = Math.max(maxPendingIndex, memo_idx);
                        }
                    }
                    const decryptedMemos = state.account.cacheTxs(indexedTxs);
                    this.logStateSync(i, i + txs.length * OUTPLUSONE, decryptedMemos);
                    for (let decryptedMemoIndex = 0; decryptedMemoIndex < decryptedMemos.length; ++decryptedMemoIndex) {
                        // save memos corresponding to the our account to restore history
                        const myMemo = decryptedMemos[decryptedMemoIndex];
                        myMemo.txHash = txHashes[myMemo.index];
                        zpState.history.saveDecryptedMemo(myMemo, false);
                    }
                    const decryptedPendingMemos = state.account.decodeTxs(indexedTxsPending);
                    for (let idx = 0; idx < decryptedPendingMemos.length; ++idx) {
                        // save memos corresponding to the our account to restore history
                        const myMemo = decryptedPendingMemos[idx];
                        myMemo.txHash = txHashesPending[myMemo.index];
                        zpState.history.saveDecryptedMemo(myMemo, true);
                        if (myMemo.acc != undefined) {
                            // There is a pending transaction initiated by ourselfs
                            // So we cannot create new transactions in that case
                            readyToTransact = false;
                        }
                    }
                    return { txCount: txs.length, maxMinedIndex, maxPendingIndex };
                });
                batches.push(oneBatch);
            }
            ;
            let initRes = { txCount: 0, maxMinedIndex: -1, maxPendingIndex: -1 };
            let totalRes = (await Promise.all(batches)).reduce((acc, cur) => {
                return {
                    txCount: acc.txCount + cur.txCount,
                    maxMinedIndex: Math.max(acc.maxMinedIndex, cur.maxMinedIndex),
                    maxPendingIndex: Math.max(acc.maxPendingIndex, cur.maxPendingIndex),
                };
            }, initRes);
            // remove unneeded pending records
            zpState.history.setLastMinedTxIndex(totalRes.maxMinedIndex);
            zpState.history.setLastPendingTxIndex(totalRes.maxMinedIndex);
            const msElapsed = Date.now() - startTime;
            const avgSpeed = msElapsed / totalRes.txCount;
            console.log(`Sync finished in ${msElapsed / 1000} sec | ${totalRes.txCount} tx, avg speed ${avgSpeed.toFixed(1)} ms/tx`);
            return readyToTransact;
        }
        else {
            console.log(`Local state is up to date @${startIndex}`);
            return true;
        }
    }
    async logStateSync(startIndex, endIndex, decryptedMemos) {
        const OUTPLUSONE = constants_1.CONSTANTS.OUT + 1;
        for (let decryptedMemo of decryptedMemos) {
            if (decryptedMemo.index > startIndex) {
                console.info(`📝 Adding hashes to state (from index ${startIndex} to index ${decryptedMemo.index - OUTPLUSONE})`);
            }
            startIndex = decryptedMemo.index + OUTPLUSONE;
            if (decryptedMemo.acc) {
                console.info(`📝 Adding account, notes, and hashes to state (at index ${decryptedMemo.index})`);
            }
            else {
                console.info(`📝 Adding notes and hashes to state (at index ${decryptedMemo.index})`);
            }
        }
        if (startIndex < endIndex) {
            console.info(`📝 Adding hashes to state (from index ${startIndex} to index ${endIndex - OUTPLUSONE})`);
        }
    }
    free() {
        for (let state of Object.values(this.zpStates)) {
            state.free();
        }
    }
}
exports.ZeropoolClient = ZeropoolClient;
//# sourceMappingURL=client.js.map