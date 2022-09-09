export class PolkadotNetwork {
    async getChainId() {
        return 0; // FIXME
    }
    async getDenominator(contractAddress) {
        return BigInt(1000); // FIXME
    }
    async poolLimits(contractAddress, address) {
        return undefined; // FIXME
    }
    isSignatureCompact() {
        return false;
    }
    defaultNetworkName() {
        return 'polkadot';
    }
    getRpcUrl() {
        return '';
    }
}
//# sourceMappingURL=polkadot.js.map