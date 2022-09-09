export class NearNetwork {
    getChainId() {
        throw new Error('Method not implemented.');
    }
    poolLimits(contractAddress, address) {
        throw new Error('Method not implemented.');
    }
    async getDenominator(contractAddress) {
        return BigInt(1);
    }
    isSignatureCompact() {
        return true;
    }
    defaultNetworkName() {
        return 'near';
    }
    getRpcUrl() {
        return '';
    }
}
//# sourceMappingURL=near.js.map