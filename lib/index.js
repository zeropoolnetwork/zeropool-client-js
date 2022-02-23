"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.init = exports.ZeroPoolLibState = exports.EvmZeropoolClient = void 0;
const comlink_1 = require("comlink");
const libzeropool = __importStar(require("libzeropool-rs-wasm-web"));
const file_cache_1 = require("./file-cache");
var client_1 = require("./evm/client");
Object.defineProperty(exports, "EvmZeropoolClient", { enumerable: true, get: function () { return client_1.ZeropoolClient; } });
class ZeroPoolLibState {
}
exports.ZeroPoolLibState = ZeroPoolLibState;
async function init(wasmPath, workerPath, snarkParams) {
    const fileCache = await file_cache_1.FileCache.init();
    const worker = (0, comlink_1.wrap)(new Worker(workerPath));
    await worker.initWasm(wasmPath, {
        txParams: snarkParams.transferParamsUrl,
        treeParams: snarkParams.treeParamsUrl,
    });
    const txParamsData = await fileCache.getOrCache(snarkParams.transferParamsUrl);
    const transferParams = libzeropool.Params.fromBinary(new Uint8Array(txParamsData));
    const treeParamsData = await fileCache.getOrCache(snarkParams.treeParamsUrl);
    const treeParams = libzeropool.Params.fromBinary(new Uint8Array(treeParamsData));
    const transferVk = await (await fetch(snarkParams.transferVkUrl)).json();
    const treeVk = await (await fetch(snarkParams.treeVkUrl)).json();
    return {
        fileCache,
        worker,
        snarkParams: {
            transferParams,
            treeParams,
            transferVk,
            treeVk,
        }
    };
}
exports.init = init;
//# sourceMappingURL=index.js.map