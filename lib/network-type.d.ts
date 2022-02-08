export declare const ZEROPOOL_PURPOSE = 2448;
export declare enum NetworkType {
    ethereum = "ethereum",
    xdai = "xdai",
    aurora = "aurora",
    near = "near",
    waves = "waves"
}
export declare namespace NetworkType {
    function derivationPath(network: NetworkType, account: number): string;
    function chainPath(network: NetworkType): string;
    function privateDerivationPath(network: NetworkType): string;
    function accountPath(network: NetworkType, account: number): string;
    function coinNumber(network: NetworkType): number;
}
