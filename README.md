<p align="center">
<img src="docs/democracy-earth.png" width="400" title="Democracy Earth Foundation">
</p>

# UBI Coin

A standard for Universal Basic Income tokens. 

Built in collaboration with [Kleros](https://github.com/kleros) and the [Proof of Humanity](https://github.com/Proof-Of-Humanity) project.

## Features

- ERC20 token that can `mint` new supply for verified humans over time at a given rate. 
- Interfaces with `ProofOfHumanity` to get curated list of verified humans.
- Issuance rate —a. k. a. inflation— is subject to governance.
- Token has `burn` function —a. k. a. deflation— that can be triggered by users or a DAO.
- `Snapshot` event emitted to ease use of token for governance purposes.

Built with [Hardhat](https://github.com/nomiclabs/hardhat) and [OpenZeppelin](https://github.com/openzeppelin) contracts. 

**Release:**

* Currently [`version 0.1`](https://github.com/DemocracyEarth/ubi/releases)

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
  ubi-deploy                    Deploys a new instance of the UBI Coin
  run                           Runs a user-defined script after compiling the project
  test                          Runs mocha tests
```

You can run `npx hardhat help <task>` to get help about each tasks and their parameters. 

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
