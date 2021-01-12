<p align="center">
<img src="docs/logo/ubi_token.png" width="150" title="Democracy Earth Dapp Screenshot 2020">
</p>

<p align="center">
Universal Basic Income.
</p>

# UBI Coin

A standard for Universal Basic Income tokens. 

Built in collaboration with [Kleros](https://github.com/kleros) and the [Proof of Humanity](https://github.com/Proof-Of-Humanity) project.

[![Build Status](https://travis-ci.com/DemocracyEarth/ubi.svg?branch=master)](https://travis-ci.com/DemocracyEarth/ubi)

## Features

- ERC20 token that can `mint` new supply for verified humans over time at a given rate. 
- Interfaces with `ProofOfHumanity` to get curated list of verified humans.
- Issuance rate —a. k. a. inflation— is subject to governance.
- Token has `burn` function —a. k. a. deflation— that can be triggered by users or a DAO.
- `Snapshot` event emitted to ease use of token for governance purposes.
- `ProofOfHumanity` registry can be updated with governance mechanism.
- Implements `ERC20Upgradeable` contracts with [OpenZeppelin](https://github.com/openzeppelin) proxy libraries.

Built with [Hardhat](https://github.com/nomiclabs/hardhat). 

Latest release is [`version 0.1.5`](https://github.com/DemocracyEarth/ubi/releases)

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

## Tasks

After following those instructions, you can run `npx hardhat` to get a list with all the tasks:

```
$ npx hardhat
AVAILABLE TASKS:

  clean                         Clears the cache and deletes all artifacts
  compile                       Compiles the entire project, building all artifacts
  console                       Opens a hardhat console
  flatten                       Flattens and prints all contracts and their dependencies
  help                          Prints this message
  deploy                        Test deploy of a new instance of the UBI Coin
  run                           Runs a user-defined script after compiling the project
  test                          Runs mocha tests
```

You can run `npx hardhat help <task>` to get help about each tasks and their parameters. 

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
     const ubi = await UBI.attach('0xa12f1a7b4d88AC6dc6067B9eA4b81930bd934847') // Replace with your token address
    ```

## Contribute

These contracts are free, open source and censorship resistant. Support us via [Open Collective](https://opencollective.com/democracyearth).

### About

Democracy Earth Foundation is a _501 (c) 3 not for profit corporation_ in San Francisco, California with no political affiliations.

<p align="center">
<img src="docs/democracy-earth.png" width="400" title="Democracy Earth Foundation">
</p>

## License

This software is under an [MIT License](LICENSE.md).
This is a free software built by [Democracy Earth Foundation](https://democracy.earth) between 2020 and 2021.
