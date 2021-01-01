<p align="center">
<img src="docs/democracy-earth.png" width="400" title="Democracy Earth Foundation">
</p>

# UBI Coin

A standard for Universal Basic Income tokens. 

## Features

- ERC20 token that can `mint` new supply for verified humans over time at a fixed rate. 
- Interfaces with `ProofOfHumanity` to get curated list of verified humans.
- Issuance rate (inflation) is subject to governance.
- Tokens can be `burn` (deflation) either by users or a DAO.
- `Snapshot` event emitted to ease use of token for governance purposes.

## Setup

1. Clone Repository

    ```sh
    $ git clone https://github.com/DemocracyEarth/ubi.git
    $ cd dapp
    ```

2. Install Dependencies

    ```sh
    $ npm install
    ```

3. Run Tests

    ```sh
    $ npx hardhat test
    ```

    You can also interact with the token with `npx hardhat console`.

## Contribute

These contracts are free, open source and censorship resistant. Support us via [Open Collective](https://opencollective.com/democracyearth).

### About

Democracy Earth Foundation is a _501 (c) 3 not for profit corporation_ in San Francisco, California with no political affiliations. Our institutional backers include:

<p align="center">
<a href="https://ycombinator.com"><img src="docs/yc.png" width="200" style="margin-right:20px;" title="Y Combinator"></a>
<a href="https://ffwd.org"><img src="docs/ffwd.png" width="200" style="margin-right:20px;" title="Fast Forward"></a>
<a href="https://www.templetonworldcharity.org/"><img src="docs/templeton.png" width="200" style="margin-right:20px;" title="Templeton World Charity"></a>
</p>

## License

This software is under an [MIT License](LICENSE.md).
This is a free software built by [Democracy Earth Foundation](https://democracy.earth) between 2015 and 2021.
