# zeropool-js

## Example
```js
import { init, EvmZeropoolClient } from 'zeropool-js';

const snarkParams = {
  transferParamsUrl: '/path/to/transfer/params',
  treeParamsUrl: '/path/to/tree/params',
  transferVkUrl: '/path/to/transfer/vk',
  treeVkUrl: '/path/to/tree/vk',
};

init('/path/to/wasm', '/path/to/worker', snarkParams)
  .then(async (ctx) => {
      // Spending key
      const sk = new Uint8Array(32);
      const tokens = {
        'token address': {
          poolAddress: '...',
          relayerUrl: '...',
        }
      };

      const client = await EvmZeropoolClient.create(sk, tokens, rpcUrl, ctx.snarkParams, ctx.worker);

      // client.deposit(tokenAddress: string, amountWei: string, sign: (data: string) => Promise<string>, fee: string = '0')
  });
```
