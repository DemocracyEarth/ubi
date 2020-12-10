const UBI = artifacts.require("UBI");

module.exports = function (deployer) {
  const _initialSupply = 10000;
  deployer.deploy(UBI, _initialSupply);
};
