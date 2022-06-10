"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
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
exports.init = exports.ZeroPoolLibState = exports.zp = void 0;
const zpSt = __importStar(require("libzeropool-rs-wasm-web"));
const zpMt = __importStar(require("libzeropool-rs-wasm-web-mt"));
const comlink_1 = require("comlink");
const wasm_feature_detect_1 = require("wasm-feature-detect");
const file_cache_1 = require("./file-cache");
exports.zp = zpSt;
class ZeroPoolLibState {
}
exports.ZeroPoolLibState = ZeroPoolLibState;
async function init(wasmPath, workerPath, snarkParams) {
    const isMt = await (0, wasm_feature_detect_1.threads)();
    if (isMt) {
        exports.zp = zpMt;
    }
    const fileCache = await file_cache_1.FileCache.init();
    const worker = (0, comlink_1.wrap)(new Worker(workerPath));
    await worker.initWasm(wasmPath, {
        txParams: snarkParams.transferParamsUrl,
        treeParams: snarkParams.treeParamsUrl,
    });
    await exports.zp.default(wasmPath);
    const txParamsData = await fileCache.getOrCache(snarkParams.transferParamsUrl);
    const transferParams = exports.zp.Params.fromBinary(new Uint8Array(txParamsData));
    const treeParamsData = await fileCache.getOrCache(snarkParams.treeParamsUrl);
    const treeParams = exports.zp.Params.fromBinary(new Uint8Array(treeParamsData));
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
//# sourceMappingURL=zp.js.map