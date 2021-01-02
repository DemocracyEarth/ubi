require("@nomiclabs/hardhat-etherscan");
require("@nomiclabs/hardhat-truffle5");
require("@nomiclabs/hardhat-solhint");
require("@nomiclabs/hardhat-waffle");
require("hardhat-gas-reporter");
require("solidity-coverage");

require("./scripts/tasks");

// Go to https://infura.io/ and create a new project
// Replace this with your Infura project ID
const INFURA_API_KEY = "";

// Replace this private key with your Kovan account private key
// To export your private key from Metamask, open Metamask and
// go to Account Details > Export Private Key
// Be aware of NEVER putting real Ether into testing accounts
const KOVAN_PRIVATE_KEY = "";
const ETHERSCAN_API_KEY = "";

module.exports = {
  networks: {
    develop: {
      url: "http://localhost:8545",
    },
    kovan: {
      url: `https://kovan.infura.io/v3/${INFURA_API_KEY}`,
      accounts: [`0x${KOVAN_PRIVATE_KEY}`]
    },
    coverage: {
      url: "http://localhost:8555"
    }
  },
  solidity: {
    version: "0.7.3",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY
  }
};
