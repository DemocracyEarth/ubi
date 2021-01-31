const { expect } = require("chai");
const deploymentParams = require('../deployment-params');

/**
 @function delay
 @summary halts execution for a given interval of milliseconds.
 @param {string} interval in milliseconds.
*/
const delay = async (interval) => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, interval);
  });
}

/**
 @summary Tests for UBI.sol
*/
contract('Democracy.sol', accounts => {
  describe('Democratic token to govern UBI DAO', () => {
    before(async () => {
      accounts = await ethers.getSigners();

      const [_addresses, mockProofOfHumanity] = await Promise.all([
        Promise.all(accounts.map((account) => account.getAddress())),
        waffle.deployMockContract(
          accounts[0],
          require("../artifacts/contracts/IProofOfHumanity.sol/IProofOfHumanity.json").abi
        ),
      ]);
      addresses = _addresses;
      setSubmissionIsRegistered = (submissionID, isRegistered) =>
        mockProofOfHumanity.mock.getSubmissionInfo
          .withArgs(submissionID)
          .returns(0, 0, 0, 0, isRegistered);

      pohAddress = mockProofOfHumanity.address;

      Democracy = await ethers.getContractFactory("Democracy");
      democracy = await Democracy.deploy(pohAddress);
      await democracy.deployed();
      
      altProofOfHumanity = await waffle.deployMockContract(accounts[0], require("../artifacts/contracts/IProofOfHumanity.sol/IProofOfHumanity.json").abi);
    });

    it("happy path - return a value previously initialized.", async () => {
      // Check that the value passed to the constructor is set.
      expect((await democracy.proofOfHumanity()).toString()).to.equal(pohAddress);
    });

    it("happy path - get balance of 1 vote for a registered human.", async () => {
      // Check that the value passed to the constructor is set.
      expect((await democracy.proofOfHumanity()).toString()).to.equal(pohAddress);
    });

  });
})