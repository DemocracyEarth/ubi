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

const mockNumbers = {
  SEVEN_BILLION: 7000000000
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

      setRegistrationCounter = () =>
        mockProofOfHumanity.mock.registrationCounter
          .withArgs()
          .returns(mockNumbers.SEVEN_BILLION);

      pohAddress = mockProofOfHumanity.address;

      Democracy = await ethers.getContractFactory("Democracy");
      democracy = await Democracy.deploy(pohAddress);
      await democracy.deployed();
      
      altProofOfHumanity = await waffle.deployMockContract(accounts[0], require("../artifacts/contracts/IProofOfHumanity.sol/IProofOfHumanity.json").abi);
    });

    it("happy path - return a value previously initialized", async () => {
      // Check that the value passed to the constructor is set.
      expect((await democracy.deployer()).toString()).to.equal(addresses[0]);
      expect((await democracy.proofOfHumanity()).toString()).to.equal(pohAddress);
    });

    it("happy path - get balance of 1 vote for a registered human", async () => {
      await setSubmissionIsRegistered(addresses[1], true);
      expect((await democracy.balanceOf(addresses[1]))).to.equal(1);
    });

    it("happy path - get balance of 0 vote for a unregistered address", async () => {
      await setSubmissionIsRegistered(addresses[2], false);
      expect((await democracy.balanceOf(addresses[2]))).to.equal(0);
    });

    it("happy path - verify if an address is human", async () => {
      await setSubmissionIsRegistered(addresses[3], true);
      expect((await democracy.isHuman(addresses[3]))).to.equal(true);
    });

    it("happy path - prevent any kind of transfer", async () => {
      expect((await democracy.transfer(addresses[1], 1))).to.equal(false);
    });

    it("happy path - prevent any kind of approval", async () => {
      expect((await democracy.approve(addresses[2], 1))).to.equal(false);
    });

    it("happy path - prevent any kind of transferFrom", async () => {
      expect((await democracy.transferFrom(addresses[1], addresses[2], 1))).to.equal(false);
    });

    it("happy path - emit snapshot event", async () => {
      expect(democracy.snapshot()).to.emit(democracy, "Snapshot");
    });

    it("happy path - get balance at a given snapshot id", async () => {
      await setSubmissionIsRegistered(addresses[1], true);
      await democracy.snapshot();
      expect(await democracy.balanceOfAt(addresses[1], 2)).to.equal(1);
    });

    it("require fail - ERC20Snapshot: nonexistent id", async () => {
      await expect(democracy.balanceOfAt(addresses[1], 10)).to.be.revertedWith("ERC20Snapshot: nonexistent id");
    });

    it("require fail - ERC20Snapshot: id is 0", async () => {
      await expect(democracy.balanceOfAt(addresses[1], 0)).to.be.revertedWith("ERC20Snapshot: id is 0");
    });

    it("happy path - get total supply", async () => {
      await setRegistrationCounter();
      expect(await democracy.totalSupply()).to.equal(mockNumbers.SEVEN_BILLION);
    });

    it("happy path - get total supply at a given snapshot id", async () => {
      await setRegistrationCounter();
      expect(await democracy.totalSupplyAt(1)).to.equal(mockNumbers.SEVEN_BILLION);
    });

    it("require fail - The caller must be the deployer", async () => {
      await expect(
        democracy.connect(accounts[1]).changeProofOfHumanity(altProofOfHumanity.address)
      ).to.be.revertedWith("The caller must be the deployer");
    });

    it("happy path - change proof of humanity", async () => {
      await democracy.changeProofOfHumanity(altProofOfHumanity.address);
      expect((await democracy.proofOfHumanity()).toString()).to.equal(altProofOfHumanity.address);
    });

  });
})