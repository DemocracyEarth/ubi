<p align="center">
<img src="docs/logo/ubi_token.png" width="150" title="Democracy Earth Dapp Screenshot 2020">
</p>

<p align="center">
Universal Basic Income.
</p>

# UBI Coin

A standard for Universal Basic Income tokens. 

Built in collaboration with [Kleros](https://github.com/kleros) and the [Proof of Humanity](https://github.com/Proof-Of-Humanity) project.

[![Build Status](https://travis-ci.com/DemocracyEarth/ubi.svg?branch=master)](https://travis-ci.com/DemocracyEarth/ubi) [![Coverage Status](https://coveralls.io/repos/github/DemocracyEarth/ubi/badge.svg?branch=master)](https://coveralls.io/github/DemocracyEarth/ubi?branch=master)

## Features

- ERC20 token that can `mint` new supply for verified humans over time at a given rate. 
- Tokens get streamed directly to a users wallet.
- Interfaces with `ProofOfHumanity` to get curated list of verified humans.
- `ProofOfHumanity` registry can be updated with governance mechanism.
- Implements `ERC20Upgradeable` contracts with [OpenZeppelin](https://github.com/openzeppelin) proxy libraries.

Built with [Hardhat](https://github.com/nomiclabs/hardhat). 

Latest release is [`version 0.2.0`](https://github.com/DemocracyEarth/ubi/releases)

## Setup

1. Clone Repository

    ```sh
    $ git clone https://github.com/DemocracyEarth/ubi.git
    $ cd ubi
    ```

2. Install Dependencies

    ```sh
    $ npm install
    ```

3. Run Tests

    ```sh
    $ npx hardhat test
    ```

    To compute their code coverage run `npx hardhat coverage`.

## Deploy

1. On `hardhat.config.js` configure the following constants for the `kovan` testnet:

    ```
    INFURA_API_KEY
    KOVAN_PRIVATE_KEY
    ```

2. Deploy on Ethereum `kovan` testnet: 

    ```sh
    $ npx hardhat run scripts/deploy.js --network kovan
    ```
3. Interact with the console:

    ```sh
    $ npx hardhat console --network kovan
    ```

    Initalize the token with:

    ```js
     const UBI = await ethers.getContractFactory("UBI")
     const ubi = await UBI.attach('0x703960D03533B1D34fF4996DC6604f0Bc74ED198') // Replace with your token address
    ```

### Upgrade

1. Deploy new contract in a fresh address:

    ```sh
    $ npx hardhat run scripts/prepare.js --network kovan
    ```

2. Upgrade the proxy contract with the freshly deployed address: 

    ```sh
    $ npx hardhat run scripts/upgrade.js --network kovan
    ```

### Verify

1. On `hardhat.config.js` configure your [Etherscan](https://kovan.etherscan.io/) API key:

    ```
    ETHERSCAN_API_KEY
    ```

2. Verify the contract by running:

    ```sh
    $ npx hardhat verify --network kovan <ADDRESS>
    ```

## Contribute

These contracts are free, open source and censorship resistant. Support us via [Open Collective](https://opencollective.com/democracyearth).

## License

This software is under an [MIT License](LICENSE.md). This is a free software built by [Democracy Earth Foundation](https://democracy.earth) between 2020 and 2021. Democracy Earth Foundation is a _501 (c) 3 not for profit corporation_ from San Francisco, California with no political affiliations.

<p align="center">
<img src="docs/democracy-earth.png" width="400" title="Democracy Earth Foundation">
</p>
