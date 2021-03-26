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
          require("../artifacts/contracts/UBI.sol/IProofOfHumanity.json").abi
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

      altProofOfHumanity = await waffle.deployMockContract(accounts[0], require("../artifacts/contracts/UBI.sol/IProofOfHumanity.json").abi);
    });

    it("happy path - return a value previously initialized.", async () => {
      // Check that the value passed to the constructor is set.
      expect((await ubi.accruedPerSecond()).toString()).to.equal(deploymentParams.ACCRUED_PER_SECOND.toString());
    });

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
      await expect(ubi.connect(owner).burn('199999999966000'))
        .to.emit(ubi, "Transfer")
      await setSubmissionIsRegistered(owner.address, false);
      await expect(ubi.connect(owner).burn('100000000000000'))
        .to.emit(ubi, "Transfer")
      expect(await ubi.balanceOf(owner.address)).to.be.at.least(3000);
    });
  
    it("require fail - The submission is still registered in Proof Of Humanity.", async () => {
      // Make sure it reverts if the submission is still registered.
      await setSubmissionIsRegistered(addresses[6], true);
      await ubi.startAccruing(addresses[6]);
      expect((await ubi.activated(addresses[6]))).to.be.true;
      await expect(
        ubi.reportRemoval(addresses[6],[])
      ).to.be.revertedWith(
        "The submission is still registered in Proof Of Humanity."
      );
    });

    it("happy path - allows anyone to report a removed submission for their accrued UBI.", async () => {
      // Report submission and verify that `accruingSinceBlock` was reset.
      // Also verify that the accrued UBI was sent correctly.
      expect((await ubi.activated(addresses[1]))).to.be.true;
      await ubi.reportRemoval(addresses[1], []);
      expect((await ubi.activated(addresses[1]))).to.be.false;
    });

    it("happy path - returns 0 for submissions that are not accruing UBI.", async () => {
      expect((await ubi.getAccruedValue(addresses[5])).toString()).to.equal('0');
    });

    it("happy path - check accruing rate for primary stream.", async () => {
      // Make sure secondary stream is accruing correctly.
      expect((await ubi.getAccruedValue(addresses[12])).toString()).to.equal('0');
      expect((await ubi.balanceOf(addresses[12])).toString()).to.equal('0');
      await setSubmissionIsRegistered(addresses[12], true);
      await ubi.startAccruing(addresses[12]);
      await network.provider.send("evm_increaseTime", [1]); // increase 1 second
      await network.provider.send("evm_mine");
      expect((await ubi.getAccruedValue(addresses[12]))).to.equal(deploymentParams.ACCRUED_PER_SECOND);
      expect((await ubi.balanceOf(addresses[12]))).to.equal(deploymentParams.ACCRUED_PER_SECOND);
    });

    it("require fail - Stream: limit Max 10%, Min 1%.", async () => {
      // Make sure secondary stream is >1% & <10% of current accruedPerSecond.
      await expect(
        ubi.connect(accounts[12]).startStream(addresses[13], deploymentParams.ACCRUED_PER_SECOND/5) // >10%
      ).to.be.revertedWith(
        "Stream: limit Max 10%, Min 1%"
      );
      await expect(
        ubi.connect(accounts[12]).startStream(addresses[13], 1234) // < 1%
      ).to.be.revertedWith(
        "Stream: limit Max 10%, Min 1%"
      );
    });

    it("happy path - check accruing rate for secondary stream", async () => {
      // Make sure secondary stream is increased per second.
      expect((await ubi.balanceOf(addresses[19])).toString()).to.equal('0');
      const rate = deploymentParams.ACCRUED_PER_SECOND / 100;
      await ubi.connect(accounts[12]).startStream(addresses[19], rate);
      await network.provider.send("evm_increaseTime", [123]); // +123 second
      await network.provider.send("evm_mine")
      expect((await ubi.balanceOf(addresses[19]))).to.equal(123 * rate);
      expect((await ubi.getAccruedValue(addresses[19]))).to.equal(123 * rate);
    });

    it("require fail - Stream: Already active/Use update.", async () => {
      // Make sure creating a secondary stream again to same address fails.
      await expect(
        ubi.connect(accounts[12]).startStream(addresses[19], deploymentParams.ACCRUED_PER_SECOND/10)
      ).to.be.revertedWith(
        "Stream: Already active/Use update"
      );
    });

    it("happy path - check stopping secondary stream", async () => {
      // Make sure secondary stream is set to zero after update
      expect((await ubi.balanceOf(addresses[19]))).to.not.equal(0);
      await ubi.connect(accounts[12]).stopStream(addresses[19]);
      expect((await ubi.balanceOf(addresses[19]))).to.not.equal(0);
      expect((await ubi.getAccruedValue(addresses[19]))).to.equal(0);
    });

    it("happy path - check multiple secondary streams at once", async () => {
      // Make sure secondary stream is increased per second.
      const rate = deploymentParams.ACCRUED_PER_SECOND / 100;
      expect((await ubi.balanceOf(addresses[13])).toString()).to.equal('0');
      await ubi.connect(accounts[12]).startStream(addresses[13], rate);
      expect((await ubi.balanceOf(addresses[14])).toString()).to.equal('0');
      await ubi.connect(accounts[12]).startStream(addresses[14], rate);
      expect((await ubi.balanceOf(addresses[15])).toString()).to.equal('0');
      await ubi.connect(accounts[12]).startStream(addresses[15], rate);
      expect((await ubi.balanceOf(addresses[16])).toString()).to.equal('0');
      await ubi.connect(accounts[12]).startStream(addresses[16], rate);
      expect((await ubi.balanceOf(addresses[17])).toString()).to.equal('0');
      await ubi.connect(accounts[12]).startStream(addresses[17], rate);
      expect((await ubi.balanceOf(addresses[13]))).to.equal(rate * 4);
      expect((await ubi.getAccruedValue(addresses[13]))).to.equal(rate * 4);
      expect((await ubi.balanceOf(addresses[14]))).to.equal(rate * 3);
      expect((await ubi.getAccruedValue(addresses[14]))).to.equal(rate * 3);
      expect((await ubi.getAccruedValue(addresses[15]))).to.equal(rate * 2);
      expect((await ubi.getAccruedValue(addresses[16]))).to.equal(rate * 1);
      await network.provider.send("evm_increaseTime", [123]); // +123 second
      await network.provider.send("evm_mine")

      expect((await ubi.balanceOf(addresses[17]))).to.equal(rate * 123);
      expect((await ubi.getAccruedValue(addresses[17]))).to.equal(rate * 123);
    });

    it("require fail - Stream: Max 5 outgoing streams", async () => {
      // Make sure creating a secondary stream again to same address fails.
      await expect(
        ubi.connect(accounts[12]).startStream(addresses[18], deploymentParams.ACCRUED_PER_SECOND/10)
      ).to.be.revertedWith(
        " Stream: Max 5 outgoing streams"
      );
    });
    
    it("happy path - allows anyone to report a removed submission with all 5 outgoing streams", async () => {
      // Report submission and verify that all outgoing streams were revoked.
      // Also verify that all remaining accrued UBI is rewarded to `msg.sender`
      expect((await ubi.activated(addresses[12]))).to.be.true
      await setSubmissionIsRegistered(addresses[12], false);;
      await ubi.reportRemoval(addresses[12], [addresses[15],addresses[16],addresses[13],addresses[14],addresses[17]]);
      expect((await ubi.activated(addresses[12]))).to.be.false;
      expect((await ubi.balanceOf(addresses[15]))).to.equal(0);
      expect((await ubi.balanceOf(addresses[14]))).to.equal(0);
      expect((await ubi.balanceOf(addresses[13]))).to.equal(0);
      expect((await ubi.balanceOf(addresses[17]))).to.equal(0);
      expect((await ubi.balanceOf(addresses[16]))).to.equal(0);
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