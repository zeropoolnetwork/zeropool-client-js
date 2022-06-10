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
const comlink_1 = require("comlink");
const libzeropool_rs_wasm_web_mt_1 = __importStar(require("libzeropool-rs-wasm-web-mt"));
const file_cache_1 = require("./file-cache");
let txParams;
let treeParams;
const obj = {
    async initWasm(url, paramUrls) {
        console.info('Initializing web worker...');
        await (0, libzeropool_rs_wasm_web_mt_1.default)(url);
        await (0, libzeropool_rs_wasm_web_mt_1.initThreadPool)(navigator.hardwareConcurrency);
        const cache = await file_cache_1.FileCache.init();
        const txParamsData = await cache.getOrCache(paramUrls.txParams);
        txParams = libzeropool_rs_wasm_web_mt_1.Params.fromBinary(new Uint8Array(txParamsData));
        const treeParamsData = await cache.getOrCache(paramUrls.treeParams);
        treeParams = libzeropool_rs_wasm_web_mt_1.Params.fromBinary(new Uint8Array(treeParamsData));
        console.info('Web worker init complete.');
    },
    async proveTx(pub, sec) {
        return new Promise(async (resolve) => {
            console.debug('Web worker: proveTx');
            const result = libzeropool_rs_wasm_web_mt_1.Proof.tx(txParams, pub, sec);
            resolve(result);
        });
    },
    async proveTree(pub, sec) {
        return new Promise(async (resolve) => {
            console.debug('Web worker: proveTree');
            const result = libzeropool_rs_wasm_web_mt_1.Proof.tree(treeParams, pub, sec);
            resolve(result);
        });
    },
};
(0, comlink_1.expose)(obj);
//# sourceMappingURL=workerMt.js.map