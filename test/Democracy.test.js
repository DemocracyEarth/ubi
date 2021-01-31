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
      await setSubmissionIsRegistered(addresses[1], true);
      expect((await democracy.balanceOf(addresses[1]))).to.equal(1);
    });

    it("happy path - get balance of 0 vote for a unregistered address.", async () => {
      await setSubmissionIsRegistered(addresses[2], false);
      expect((await democracy.balanceOf(addresses[2]))).to.equal(0);
    });

    it("happy path - verify if an address is human.", async () => {
      await setSubmissionIsRegistered(addresses[3], true);
      expect((await democracy.isHuman(addresses[3]))).to.equal(true);
    });

    it("happy path - prevent any kind of transfer.", async () => {
      expect((await democracy.transfer(addresses[1], 1))).to.equal(false);
    });

    it("happy path - emit snapshot event.", async () => {
      console.log((await democracy.snapshot()).value.toString());
      console.log((await democracy.snapshot()).value.toString());
      expect(democracy.snapshot()).to.emit(democracy, "Snapshot");
    });

  });
})