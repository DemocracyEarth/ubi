const { expect } = require("chai");
const deploymentParams = require('../deployment-params');

/**
 @summary Tests for UBI.sol
*/
contract('UBI.sol', accounts => {
  describe('UBI Coin and Proof of Humanity', () => {
    before(async () => {
      accounts = await ethers.getSigners();

      const [_addresses, mockProofOfHumanity] = await Promise.all([
        Promise.all(accounts.map((account) => account.getAddress())),
        waffle.deployMockContract(
          accounts[0],
          require("../artifacts/contracts/Humanity.sol/IProofOfHumanity.json").abi
        ),
      ]);
      addresses = _addresses;
      setSubmissionIsRegistered = (submissionID, isRegistered) =>
        mockProofOfHumanity.mock.isRegistered
          .withArgs(submissionID)
          .returns(isRegistered);

      UBICoin = await ethers.getContractFactory("UBI");

      ubi = await upgrades.deployProxy(UBICoin,
        [deploymentParams.INITIAL_SUPPLY, deploymentParams.TOKEN_NAME, deploymentParams.TOKEN_SYMBOL, deploymentParams.ACCRUED_PER_SECOND, mockProofOfHumanity.address],
        { initializer: 'initialize', unsafeAllowCustomTypes: true }
      );

      await ubi.deployed();

      altProofOfHumanity = await waffle.deployMockContract(accounts[0], require("../artifacts/contracts/Humanity.sol/IProofOfHumanity.json").abi);
    });

    it("happy path - return a value previously initialized.", async () => {
      // Check that the value passed to the constructor is set.
      expect((await ubi.accruedPerSecond()).toString()).to.equal(deploymentParams.ACCRUED_PER_SECOND.toString());
    });

    /**
     * @summary: Deprecated.
    it("happy path - allow governor to change `accruedPerSecond`.", async () => {
      // Make sure it reverts if we are not the governor.
      await expect(
        ubi.connect(accounts[1]).changeAccruedPerSecond(2)
      ).to.be.revertedWith("The caller is not the governor.");

      // Set the value to 2.
      await ubi.changeAccruedPerSecond(2);
      expect((await ubi.accruedPerSecond()).toString()).to.equal('2');
    });

    it("happy path - allow governor to emit `Snapshot` event.", async () => {
      // Make sure it reverts if we are not the governor.
      await expect(
        ubi.connect(accounts[1]).snapshot()
      ).to.be.revertedWith("The caller is not the governor.");

      // Emit Snapshot from governor address
      await expect(ubi.snapshot())
        .to.emit(ubi, "Snapshot")
    });
    */

    it("happy path - check that the initial `accruedSince` value is 0.", async () => {
      expect((await ubi.accruedSince(addresses[1])).toString()).to.equal('0');
    });

    it("require fail - The submission is not registered in Proof Of Humanity.", async () => {
      // Make sure it reverts if the submission is not registered.
      await setSubmissionIsRegistered(addresses[1], false);
      await expect(
        ubi.startAccruing(addresses[1])
      ).to.be.revertedWith(
        "The submission is not registered in Proof Of Humanity."
      );
    });

    it("happy path - allow registered submissions to start accruing UBI.", async () => {
      // Start accruing UBI and check that the current block number was set.
      await setSubmissionIsRegistered(addresses[1], true);
      await ubi.startAccruing(addresses[1]);
      const accruedSince = await ubi.accruedSince(addresses[1]);
      expect((await ubi.accruedSince(addresses[1])).toString()).to.equal(
        accruedSince.toString()
      );
    });

    it("require fail - The submission is already accruing UBI.", async () => {
      // Make sure it reverts if you try to accrue UBI while already accruing UBI.
      await expect(
        ubi.startAccruing(addresses[1])
      ).to.be.revertedWith("The submission is already accruing UBI.");
    });

    it("happy path - a submission removed from Proof of Humanity no longer accrues value.", async () => {
      await network.provider.send("evm_increaseTime", [7200]);
      await network.provider.send("evm_mine");
      await setSubmissionIsRegistered(addresses[1], false);
      await network.provider.send("evm_increaseTime", [3600]);
      await network.provider.send("evm_mine");
      expect((await ubi.balanceOf(addresses[1])).toString()).to.equal('0');
    });

    it("happy path - a submission with interrupted accruing still keeps withdrawn coins.", async () => {
      await ubi.transfer(addresses[1], 555);
      await setSubmissionIsRegistered(addresses[1], true);
      await network.provider.send("evm_increaseTime", [7200]);
      await network.provider.send("evm_mine");
      await setSubmissionIsRegistered(addresses[1], false);
      await network.provider.send("evm_increaseTime", [7200]);
      await network.provider.send("evm_mine");
      expect((await ubi.balanceOf(addresses[1])).toString()).to.equal('555');
    });

    it("happy path - a submission that natively accrued keeps transfered coins upon interruption.", async () => {
      await setSubmissionIsRegistered(accounts[3].address, true);
      expect((await ubi.balanceOf(accounts[3].address)).toString()).to.equal('0');
      await ubi.startAccruing(accounts[3].address);
      await network.provider.send("evm_increaseTime", [7200]);
      await network.provider.send("evm_mine");
      await ubi.connect(accounts[3]).transfer(addresses[1], 55);
      expect((await ubi.balanceOf(addresses[1])).toString()).to.equal('610');
    });

    /**
     * @summary: Deprecated.
    it("require fail - The submission is not registered in Proof Of Humanity.", async () => {
      // Make sure it reverts if the submission is not registered.
      await setSubmissionIsRegistered(addresses[1], false);
      console.log(`ubi.balanceOf(addresses[1]):`);
      console.log((await ubi.balanceOf(addresses[1])).toString());

      await expect(
        ubi.balanceOf(addresses[1])
      ).to.be.revertedWith(
        "The submission is not registered in Proof Of Humanity."
      );
    });

    it("require fail - The submission is not accruing UBI.", async () => {
      // Make sure it reverts if the submission is not accruing UBI.
      await setSubmissionIsRegistered(addresses[2], true);
      await expect(
        ubi.mintAccrued(addresses[2])
      ).to.be.revertedWith("The submission is not accruing UBI.");
    });
    */
   
    it("happy path - withdrawn tokens get persisted after a transfer.", async () => {
      // Make sure it accrues value with elapsed time
      const owner = accounts[4];
      await setSubmissionIsRegistered(owner.address, true);
      await ubi.startAccruing(owner.address);
      const initialBalance = await ubi.balanceOf(owner.address);
      await network.provider.send("evm_increaseTime", [5000]);
      await network.provider.send("evm_mine");
      const currentBalance = await ubi.balanceOf(owner.address);
      await ubi.connect(owner).transfer(addresses[5], 350);
      const withdrawnAmount = await ubi.withdrawn(owner.address);
      expect(withdrawnAmount).to.be.at.least(currentBalance.sub(initialBalance));
    });

    it("happy path - check that Mint and Transfer events get called when it corresponds.", async () => {
      const owner = accounts[9];
      const initialBalance = await ubi.balanceOf(owner.address);
      await setSubmissionIsRegistered(owner.address, true);
      await ubi.startAccruing(owner.address);
      await network.provider.send("evm_increaseTime", [1]);
      await network.provider.send("evm_mine");
      expect(await ubi.balanceOf(owner.address)).to.be.above(initialBalance);
      await expect(ubi.connect(owner).transfer(addresses[8], 18000))
        .to.emit(ubi, "Transfer")
      await expect(ubi.connect(owner).burn('19999999999966000'))
        .to.emit(ubi, "Transfer")
      await setSubmissionIsRegistered(owner.address, false);
      await expect(ubi.connect(owner).burn('10000000000000000'))
        .to.emit(ubi, "Transfer")
      expect(await ubi.balanceOf(owner.address)).to.be.at.least(3000);
    });

    /**
     * @summary: Deprecated.
    it("happy path - does not allow withdrawing a negative balance", async() => {
      // Make sure it accrues value with elapsed time
      const owner = accounts[10];
      await ubi.changeAccruedPerSecond(200000000000); // An arbitrary fast rate.
      await setSubmissionIsRegistered(owner.address, true);
      await ubi.startAccruing(owner.address);
      await network.provider.send("evm_increaseTime", [3600]);
      await network.provider.send("evm_mine");
      await ubi.connect(owner).burn(0);
      await ubi.changeAccruedPerSecond(2); // An arbitrary slow rate.
      const initialBalance = await ubi.balanceOf(owner.address);
      await ubi.connect(owner).burn(0); // We expect this mint operation to mint 0 tokens because currently user has a negative amount available to withdraw.
      expect(await ubi.balanceOf(owner.address)).to.be.equal(initialBalance);
    })
    */

    it("require fail - The submission is still registered in Proof Of Humanity.", async () => {
      // Make sure it reverts if the submission is still registered.
      await setSubmissionIsRegistered(addresses[6], true);
      await ubi.startAccruing(addresses[6]);
      await expect(
        ubi.reportRemoval(addresses[6])
      ).to.be.revertedWith(
        "The submission is still registered in Proof Of Humanity."
      );
    });

    it("happy path - allows anyone to report a removed submission for their accrued UBI.", async () => {
      // Report submission and verify that `accruingSinceBlock` was reset.
      // Also verify that the accrued UBI was sent correctly.
      await ubi.accruedSince(addresses[1]);
      await expect(ubi.reportRemoval(addresses[1])).to.emit(ubi, "Transfer");
      expect((await ubi.accruedSince(addresses[1])).toString()).to.equal('0');
    });

    it("happy path - returns 0 for submissions that are not accruing UBI.", async () => {
      expect((await ubi.getAccruedValue(addresses[5])).toString()).to.equal('0');
    });

    it("happy path - allow governor to change `proofOfHumanity`.", async () => {
      // Make sure it reverts if we are not the governor.
      await expect(
        ubi.connect(accounts[1]).changeProofOfHumanity(altProofOfHumanity.address)
      ).to.be.revertedWith("The caller is not the governor.");

      // Set the value to an alternative proof of humanity registry
      const originalProofOfHumanity = await ubi.proofOfHumanity();
      await ubi.changeProofOfHumanity(altProofOfHumanity.address);
      expect(await ubi.proofOfHumanity()).to.equal(altProofOfHumanity.address);
      expect(await ubi.proofOfHumanity()).to.not.equal(originalProofOfHumanity);
    });

  });
})
