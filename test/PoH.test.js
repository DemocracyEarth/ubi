const { expect } = require("chai");

const deploymentParams = {
  INITIAL_SUPPLY: '10000000000000000000000000',
  TOKEN_NAME: "Universal Basic Income",
  TOKEN_SYMBOL: "EARTH",
  ACCRUED_PER_SECOND: '100000000'  
}

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
 @function deploy
 @summary creates a mock proof of humanity contract and then deploys the UBI coin.
*/
const deploy = async () => {
  accounts = await ethers.getSigners();
  
  const [_addresses, mockProofOfHumanity] = await Promise.all([
    Promise.all(accounts.map((account) => account.getAddress())),
    waffle.deployMockContract(
      accounts[0],
      require("../artifacts/contracts/UBI.sol/IProofOfHumanity.json").abi
    ),
  ]);
  addresses = _addresses;
  setSubmissionIsRegistered = (submissionID, isRegistered) =>
    mockProofOfHumanity.mock.getSubmissionInfo
      .withArgs(submissionID)
      .returns(0, 0, 0, 0, isRegistered, false, 0);

  UBICoin = await (
    await ethers.getContractFactory("UBI")
  ).deploy(deploymentParams.INITIAL_SUPPLY, deploymentParams.TOKEN_NAME, deploymentParams.TOKEN_SYMBOL, deploymentParams.ACCRUED_PER_SECOND, mockProofOfHumanity.address);

  await UBICoin.deployed();

  return [UBICoin, mockProofOfHumanity];
};

/**
 @summary Tests for UBI.sol
*/
contract('UBI', accounts => {
  describe('UBI Coin and Proof of Humanity', () => {
    before(async () => {
      accounts = await ethers.getSigners();
  
      const [_addresses, mockProofOfHumanity] = await Promise.all([
        Promise.all(accounts.map((account) => account.getAddress())),
        waffle.deployMockContract(
          accounts[0],
          require("../artifacts/contracts/UBI.sol/IProofOfHumanity.json").abi
        ),
      ]);
      addresses = _addresses;
      setSubmissionIsRegistered = (submissionID, isRegistered) =>
        mockProofOfHumanity.mock.getSubmissionInfo
          .withArgs(submissionID)
          .returns(0, 0, 0, 0, isRegistered, false, 0);

      UBICoin = await (
        await ethers.getContractFactory("UBI")
      ).deploy(deploymentParams.INITIAL_SUPPLY, deploymentParams.TOKEN_NAME, deploymentParams.TOKEN_SYMBOL, deploymentParams.ACCRUED_PER_SECOND, mockProofOfHumanity.address);

      await UBICoin.deployed();

      altProofOfHumanity = await waffle.deployMockContract(accounts[0], require("../artifacts/contracts/UBI.sol/IProofOfHumanity.json").abi);
    });

    it("Allows the governor to change `accruedPerSecond`.", async () => {
      // Check that the value passed to the constructor is set.
      expect(await UBICoin.accruedPerSecond()).to.equal(deploymentParams.ACCRUED_PER_SECOND);
  
      // Make sure it reverts if we are not the governor.
      await expect(
        UBICoin.connect(accounts[1]).changeAccruedPerSecond(2)
      ).to.be.revertedWith("The caller is not the governor.");
  
      // Set the value to 2.
      await UBICoin.changeAccruedPerSecond(2);
      expect(await UBICoin.accruedPerSecond()).to.equal(2);
    });


    it("Allows registered submissions to start accruing UBI.", async () => {
      // Check that the initial `lastMintedSecond` value is 0.
      expect(await UBICoin.lastMintedSecond(addresses[1])).to.equal(
        0
      );

      // Make sure it reverts if the submission is not registered.
      await setSubmissionIsRegistered(addresses[1], false);
      await expect(
        UBICoin.startAccruing(addresses[1])
      ).to.be.revertedWith(
        "The submission is not registered in Proof Of Humanity."
      );

      // Start accruing UBI and check that the current block number was set.
      await setSubmissionIsRegistered(addresses[1], true);
      await UBICoin.startAccruing(addresses[1]);
      const lastMinted = await UBICoin.lastMintedSecond(addresses[1]);
      expect(await UBICoin.lastMintedSecond(addresses[1])).to.equal(
        lastMinted
      );

      // Make sure it reverts if you try to accrue UBI while already accruing UBI.
      await expect(
        UBICoin.startAccruing(addresses[1])
      ).to.be.revertedWith("The submission is already accruing UBI.");
    });

    it("Allows the minting of accrued UBI.", async () => {
      // Make sure it reverts if the submission is not registered.
      await setSubmissionIsRegistered(addresses[1], false);
      await expect(
        UBICoin.mintAccrued(addresses[1])
      ).to.be.revertedWith(
        "The submission is not registered in Proof Of Humanity."
      );

      // Make sure it reverts if the submission is not accruing UBI.
      await setSubmissionIsRegistered(addresses[2], true);
      await expect(
        UBICoin.mintAccrued(addresses[2])
      ).to.be.revertedWith("The submission is not accruing UBI.");

      // Make sure it accrues value with elapsed time
      const [ owner ] = await ethers.getSigners();
      await setSubmissionIsRegistered(owner.address, true);
      await UBICoin.startAccruing(owner.address);
      const initialBalance = await UBICoin.balanceOf(owner.address);
      const initialMintedSecond = await UBICoin.lastMintedSecond(owner.address);
      await delay(2000);
      await UBICoin.mintAccrued(owner.address);
      const lastMintedSecond = await UBICoin.lastMintedSecond(owner.address);

      expect(lastMintedSecond).to.be.above(initialMintedSecond);
      expect(await UBICoin.balanceOf(owner.address)).to.be.above(initialBalance);

      await expect(UBICoin.mintAccrued(owner.address))
        .to.emit(UBICoin, "Mint")
    });

    it("Allows anyone to report a removed submission for their accrued UBI.", async () => {
      // Make sure it reverts if the submission is still registered.
      await setSubmissionIsRegistered(addresses[6], true);
      await UBICoin.startAccruing(addresses[6]);
      await expect(
        UBICoin.reportRemoval(addresses[6])
      ).to.be.revertedWith(
        "The submission is still registered in Proof Of Humanity."
      );

      // Make sure it reverts if the submission is not accruing UBI.
      await setSubmissionIsRegistered(addresses[5], true);
      await expect(
        UBICoin.reportRemoval(addresses[5])
      ).to.be.revertedWith("The submission is not accruing UBI.");

      // Report submission and verify that `accruingSinceBlock` was reset.
      // Also verify that the accrued UBI was sent correctly.
      await UBICoin.lastMintedSecond(addresses[1]);
      await expect(UBICoin.reportRemoval(addresses[1])).to.emit(UBICoin, "Mint");
      expect(await UBICoin.lastMintedSecond(addresses[1])).to.equal(0);
      
    });

    it("Returns 0 for submissions that are not accruing UBI.", async () => {
      expect(await UBICoin.getAccruedValue(addresses[5])).to.equal(0);
    });

    it("Allows the governor to change `proofOfHumanity`.", async () => {  
      // Make sure it reverts if we are not the governor.
      await expect(
        UBICoin.connect(accounts[1]).changeProofOfHumanity(altProofOfHumanity.address)
      ).to.be.revertedWith("The caller is not the governor.");

      // Set the value to an alternative proof of humanity registry
      const originalProofOfHumanity = await UBICoin.proofOfHumanity();
      await UBICoin.changeProofOfHumanity(altProofOfHumanity.address);
      expect(await UBICoin.proofOfHumanity()).to.equal(altProofOfHumanity.address);
      expect(await UBICoin.proofOfHumanity()).to.not.equal(originalProofOfHumanity);
    });
  });
})