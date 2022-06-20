export interface NetworkBackend {
    /** Pool currency denominator */
    getDenominator(contractAddress: string): Promise<string>;
    /** Signature format (compact is ecrecover compatible) */
    isSignatureCompact(): boolean;
    /** E.g.: 'ethereum' for all evm based networks */
    defaultNetworkName(): string;
    /** Node RPC url (if applicable) */
    getRpcUrl(): string;
}
