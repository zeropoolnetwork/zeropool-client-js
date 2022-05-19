"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZeropoolClient = void 0;
const libzkbob_rs_wasm_web_1 = require("libzkbob-rs-wasm-web");
const utils_1 = require("./utils");
const state_1 = require("./state");
const tx_1 = require("./tx");
const constants_1 = require("./constants");
async function fetchTransactions(relayerUrl, offset, limit = 100) {
    const url = new URL(`/transactions`, relayerUrl);
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
    async deposit(tokenAddress, amountWei, sign, fromAddress = null, fee = '0', isBridge = false) {
        const token = this.tokens[tokenAddress];
        const state = this.zpStates[tokenAddress];
        if (BigInt(amountWei) < state.denominator) {
            throw new Error('Value is too small');
        }
        await this.updateState(tokenAddress);
        const txType = isBridge ? tx_1.TxType.BridgeDeposit : tx_1.TxType.Deposit;
        const amountGwei = (BigInt(amountWei) / state.denominator).toString();
        let txData;
        if (isBridge) {
            if (fromAddress) {
                const deadline = String(Math.floor(Date.now() / 1000) + 900);
                const holder = (0, utils_1.hexToBuf)(fromAddress);
                txData = await state.account.createDepositPermittable({ amount: amountGwei, fee, deadline, holder });
            }
            else {
                throw new Error('You must provide fromAddress for bridge deposit transaction ');
            }
        }
        else {
            txData = await state.account.createDeposit({ amount: amountGwei, fee });
        }
        const startProofDate = Date.now();
        const txProof = await this.worker.proveTx(txData.public, txData.secret);
        const proofTime = (Date.now() - startProofDate) / 1000;
        console.log(`Proof calculation took ${proofTime.toFixed(1)} sec`);
        const txValid = libzkbob_rs_wasm_web_1.Proof.verify(this.snarkParams.transferVk, txProof.inputs, txProof.proof);
        if (!txValid) {
            throw new Error('invalid tx proof');
        }
        let dataToSign;
        if (isBridge) {
            // permittable deposit signature should be calculated for the typed data
            dataToSign = '0x00';
        }
        else {
            // regular deposit through approve allowance: sign transaction nullifier
            dataToSign = '0x' + BigInt(txData.public.nullifier).toString(16).padStart(64, '0');
        }
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
        return await sendTransaction(token.relayerUrl, txProof, txData.memo, txType, fullSignature);
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
    async cleanState(tokenAddress) {
        await this.zpStates[tokenAddress].clean();
    }
    async updateState(tokenAddress) {
        if (this.updateStatePromise == undefined) {
            this.updateStatePromise = this.updateStateNewWorker(tokenAddress).finally(() => {
                this.updateStatePromise = undefined;
            });
        }
        else {
            console.info(`The state currently updating, waiting for finish...`);
        }
        await this.updateStatePromise;
    }
    // TODO: Verify the information sent by the relayer!
    async updateStateWorker(tokenAddress) {
        const OUTPLUSONE = constants_1.CONSTANTS.OUT + 1;
        const BATCH_SIZE = 100;
        const zpState = this.zpStates[tokenAddress];
        const token = this.tokens[tokenAddress];
        const startIndex = Number(zpState.account.nextTreeIndex());
        const nextIndex = Number((await info(token.relayerUrl)).deltaIndex);
        if (nextIndex > startIndex) {
            const startTime = Date.now();
            console.log(`⬇ Fetching transactions between ${startIndex} and ${nextIndex}...`);
            let curBatch = 0;
            let isLastBatch = false;
            //let historyPromises: Promise<HistoryRecordIdx[]>[] = [];
            do {
                const txs = (await fetchTransactions(token.relayerUrl, BigInt(startIndex + curBatch * BATCH_SIZE * OUTPLUSONE), BATCH_SIZE))
                    .filter((val) => !!val);
                // TODO: Error handling 
                if (txs.length < BATCH_SIZE) {
                    isLastBatch = true;
                }
                for (let i = 0; i < txs.length; ++i) {
                    const tx = txs[i];
                    if (!tx || tx.length < 128) {
                        continue;
                    }
                    // Get the first leaf index in the tree
                    const memo_idx = startIndex + (curBatch * BATCH_SIZE + i) * OUTPLUSONE;
                    // tx structure from relayer: commitment(32 bytes) + txHash(32 bytes) + memo
                    // 1. Extract memo block
                    const memo = tx.slice(128); // Skip commitment and txHash
                    // 2. Get all hashes from the memo
                    const hashes = (0, tx_1.parseHashes)(memo);
                    // 3. Save necessary parameters and extract memo (only if it corresponds to current account)
                    let myMemo = this.cacheShieldedTx(tokenAddress, memo, hashes, memo_idx);
                    if (myMemo) {
                        // if memo block corresponds to the our account - save it to restore history
                        myMemo.txHash = '0x' + tx.substr(64, 64);
                        zpState.history.saveDecryptedMemo(myMemo);
                        // try to convert history on the fly
                        //let hist = convertToHistory(myMemo, txHash);
                        //historyPromises.push(hist);
                    }
                }
                ++curBatch;
            } while (!isLastBatch);
            const msElapsed = Date.now() - startTime;
            const txCount = (nextIndex - startIndex) / 128;
            const avgSpeed = msElapsed / txCount;
            console.log(`Sync finished in ${msElapsed / 1000} sec | ${txCount} tx, avg speed ${avgSpeed.toFixed(1)} ms/tx`);
            /*let historyRedords = await Promise.all(historyPromises);
            for (let oneSet of historyRedords) {
              for (let oneRec of oneSet) {
                console.log(`History record @${oneRec.index} has been created`);
                zpState.history.put(oneRec.index, oneRec.record);
              }
            }
            console.log(`History has been synced`);*/
            // Pass the obtained data to the history resolver
            // Do not wait for finishing (it's not important for making transactions)
            //this.updateHistory(decryptedMemos);
        }
        else {
            console.log(`Local state is up to date @${startIndex}...`);
        }
    }
    async updateStateNewWorker(tokenAddress) {
        const OUTPLUSONE = constants_1.CONSTANTS.OUT + 1;
        const BATCH_SIZE = 100;
        const zpState = this.zpStates[tokenAddress];
        const token = this.tokens[tokenAddress];
        const startIndex = Number(zpState.account.nextTreeIndex());
        const nextIndex = Number((await info(token.relayerUrl)).deltaIndex);
        if (nextIndex > startIndex) {
            const startTime = Date.now();
            console.log(`⬇ Fetching transactions between ${startIndex} and ${nextIndex}...`);
            let curBatch = 0;
            let isLastBatch = false;
            let batches = [];
            for (let i = startIndex; i <= nextIndex; i = i + BATCH_SIZE * OUTPLUSONE) {
                let oneBatch = fetchTransactions(token.relayerUrl, BigInt(i), BATCH_SIZE).then(txs => {
                    console.log(`Getting ${txs.length} transactions from index ${i}`);
                    for (let txIdx = 0; txIdx < txs.length; ++txIdx) {
                        const tx = txs[txIdx];
                        // Get the first leaf index in the tree
                        const memo_idx = i + txIdx * OUTPLUSONE;
                        // tx structure from relayer: commitment(32 bytes) + txHash(32 bytes) + memo
                        // 1. Extract memo block
                        const memo = tx.slice(128); // Skip commitment and txHash
                        // 2. Get all hashes from the memo
                        const hashes = (0, tx_1.parseHashes)(memo);
                        // 3. Save necessary parameters and extract memo (only if it corresponds to current account)
                        let myMemo = this.cacheShieldedTx(tokenAddress, memo, hashes, memo_idx);
                        if (myMemo) {
                            // if memo block corresponds to the our account - save it to restore history
                            myMemo.txHash = '0x' + tx.substr(64, 64);
                            zpState.history.saveDecryptedMemo(myMemo);
                            // try to convert history on the fly
                            //let hist = convertToHistory(myMemo, txHash);
                            //historyPromises.push(hist);
                        }
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
    }
    /**
     * Attempt to extract and save usable account/notes from transaction data.
     * Return decrypted account and notes to proceed history restoring
     * @param raw hex-encoded transaction data
     */
    cacheShieldedTx(tokenAddress, ciphertext, hashes, index) {
        const state = this.zpStates[tokenAddress];
        const data = (0, utils_1.hexToBuf)(ciphertext);
        // First try do decrypt account and outcoming notes
        const pair = state.account.decryptPair(data);
        if (pair) {
            // It's definitely our transaction since accound was decrypted
            /*const in_notes = pair.notes.reduce<{ note: Note, index: number }[]>((acc, note, noteIndex) => {
              const address = assembleAddress(note.d, note.p_d);
              if (state.account.isOwnAddress(address)) {
                acc.push({ note, index: index + 1 + noteIndex });
              }
              return acc;
            }, []);
      
            const out_notes = pair.notes.reduce<{ note: Note, index: number }[]>((acc, note, noteIndex) => {
              const address = assembleAddress(note.d, note.p_d);
              if (state.account.isOwnAddress(address) == false) {
                acc.push({ note, index: index + 1 + noteIndex });
              }
              return acc;
            }, []);*/
            let in_notes = [];
            let out_notes = [];
            for (let i = 0; i < pair.notes.length; ++i) {
                const note = pair.notes[i];
                const address = (0, libzkbob_rs_wasm_web_1.assembleAddress)(note.d, note.p_d);
                if (state.account.isOwnAddress(address)) {
                    out_notes.push({ note, index: index + 1 + i });
                    in_notes.push({ note, index: index + 1 + i });
                }
                else {
                    out_notes.push({ note, index: index + 1 + i });
                }
            }
            console.info(`📝 Adding account, notes, and hashes to state (at index ${index})`);
            state.account.addAccount(BigInt(index), hashes, pair.account, in_notes);
            return { index: index, acc: pair.account, inNotes: in_notes, outNotes: out_notes, txHash: undefined };
        }
        else {
            // Second try do decrypt incoming notes
            const onlyNotes = state.account.decryptNotes(data);
            if (onlyNotes.length > 0) {
                // There is definitely incoming notes (but transaction isn't our)
                // Get only our notes and update the indexes to the absolute values
                const notes = onlyNotes.reduce((acc, idxNote) => {
                    const address = (0, libzkbob_rs_wasm_web_1.assembleAddress)(idxNote.note.d, idxNote.note.p_d);
                    if (state.account.isOwnAddress(address)) {
                        acc.push({ note: idxNote.note, index: index + 1 + idxNote.index });
                    }
                    return acc;
                }, []);
                console.info(`📝 Adding notes and hashes to state (at index ${index})`);
                state.account.addNotes(BigInt(index), hashes, notes);
                return { index: index, acc: undefined, inNotes: notes, outNotes: [], txHash: undefined };
            }
            else {
                // This transaction isn't belongs to our account
                console.info(`📝 Adding hashes to state (at index ${index})`);
                state.account.addHashes(BigInt(index), hashes);
            }
        }
        //console.debug('New balance:', state.account.totalBalance());
        return undefined;
    }
    free() {
        for (let state of Object.values(this.zpStates)) {
            state.free();
        }
    }
}
exports.ZeropoolClient = ZeropoolClient;
//# sourceMappingURL=client.js.map