export interface NetworkBackend {
    getDenominator(contractAddress: string): Promise<string>;
    isSignatureCompact(): boolean;
    defaultNetworkName(): string;
}
