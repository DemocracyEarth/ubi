const { default: BigNumber } = require("bignumber.js");
const { expect } = require("chai");
const deploymentParams = require('../deployment-params');
const { signERC2612Permit } = require("eth-permit");

/**
 @summary Tests for UBI.sol
*/
contract('UBI.sol', accounts => {
  describe('UBI Coin and Proof of Humanity', () => {
    before(async () => {
      accounts = await ethers.getSigners();

      const [_addresses, mockProofOfHumanity, mockPoster] = await Promise.all([
        Promise.all(accounts.map((account) => account.getAddress())),
        waffle.deployMockContract(
          accounts[0],
          require("../artifacts/contracts/UBI.sol/IProofOfHumanity.json").abi
        ),
        waffle.deployMockContract(
          accounts[9],
          require("../artifacts/contracts/UBI.sol/IPoster.json").abi
        ),
      ]);
      setSubmissionIsRegistered = (submissionID, isRegistered) =>
        mockProofOfHumanity.mock.isRegistered
          .withArgs(submissionID)
          .returns(isRegistered);
      setPost = (content) => 
        mockPoster.mock.post
          .withArgs(content)
          .returns();

      addresses = _addresses;

      UBICoin = await ethers.getContractFactory("UBI");

      ubi = await upgrades.deployProxy(UBICoin,
        [deploymentParams.INITIAL_SUPPLY, deploymentParams.TOKEN_NAME, deploymentParams.TOKEN_SYMBOL, deploymentParams.ACCRUED_PER_SECOND, mockProofOfHumanity.address],
        { initializer: 'initialize', unsafeAllowCustomTypes: true }
      );

      const mockAddress = mockPoster.address;
      await ubi.deployed();

      altProofOfHumanity = await waffle.deployMockContract(accounts[0], require("../artifacts/contracts/UBI.sol/IProofOfHumanity.json").abi);
      altPoster = mockAddress;

      permitDomain = {
        name: await ubi.name(),
        version: "2",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: ubi.address
      };
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
      await ubi.reportRemoval(addresses[1]);
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

    it("happy path - allow to burn and post.", async () => {
      await setPost('hello world');
      const previousBalance = new BigNumber((await ubi.balanceOf(addresses[0])).toString()).toNumber();
      await ubi.burnAndPost('10000000000000', altPoster, 'hello world');
      const newBalance = new BigNumber((await ubi.balanceOf(addresses[0])).toString()).toNumber();
      expect(newBalance).to.lessThan(previousBalance);
    });

    it("require fail - permit signature expired", async () => {
      const owner = accounts[0];
      const spender = accounts[1];
      const deadline = 0;
      const value = ethers.utils.parseEther('2').toString();
  
      expect((await ubi.allowance(owner.address, spender.address))).to.be.equal('0');
  
      const signature = await signERC2612Permit(
        owner.provider,
        permitDomain,
        owner.address,
        spender.address,
        value,
        deadline
      );
  
      await expect(
        ubi.permit(owner.address, spender.address, value, deadline, signature.v, signature.r, signature.s)
      ).to.be.revertedWith("ERC20Permit: expired deadline");
  
      expect((await ubi.allowance(owner.address, spender.address))).to.be.equal('0');
    });

    it("happy path - permit increases allowance to expected value", async () => {
      const owner = accounts[0];
      const spender = accounts[1];
      const value = ethers.utils.parseEther('2').toString();
  
      expect((await ubi.allowance(owner.address, spender.address))).to.be.equal('0');
  
      const signature = await signERC2612Permit(
        owner.provider,
        permitDomain,
        owner.address,
        spender.address,
        value
      );

      await ubi.permit(
        owner.address, spender.address, value, signature.deadline, signature.v, signature.r, signature.s
      );
  
      expect((await ubi.allowance(owner.address, spender.address))).to.be.equal(value);
    });

    it("require fail - permit signature already used", async () => {
      const owner = accounts[0];
      const spender = accounts[1];
      const expectedAllowanceBeforePermit = ethers.utils.parseEther('2').toString();
      const value = ethers.utils.parseEther('3').toString();
  
      expect((await ubi.allowance(owner.address, spender.address))).to.be.equal(expectedAllowanceBeforePermit);
  
      const signature = await signERC2612Permit(
        owner.provider,
        permitDomain,
        owner.address,
        spender.address,
        value
      );

      await ubi.permit(
        owner.address, spender.address, value, signature.deadline, signature.v, signature.r, signature.s
      );
  
      expect((await ubi.allowance(owner.address, spender.address))).to.be.equal(value);

      await expect(
        ubi.permit(owner.address, spender.address, value, signature.deadline, signature.v, signature.r, signature.s)
      ).to.be.revertedWith("ERC20Permit: invalid signature");

      expect((await ubi.allowance(owner.address, spender.address))).to.be.equal(value);
    });

    it("happy path - permit setting allowance to zero", async () => {
      const owner = accounts[0];
      const spender = accounts[1];
      const expectedAllowanceBeforePermit = ethers.utils.parseEther('3').toString();

      expect((await ubi.allowance(owner.address, spender.address))).to.be.equal(expectedAllowanceBeforePermit);
  
      const signature = await signERC2612Permit(
        owner.provider,
        permitDomain,
        owner.address,
        spender.address,
        '0'
      );

      await ubi.permit(
        owner.address, spender.address, 0, signature.deadline, signature.v, signature.r, signature.s
      );
  
      expect((await ubi.allowance(owner.address, spender.address))).to.be.equal('0');
    });

    it("require fail - permit signature built with invalid nonce", async () => {
      const owner = accounts[0];
      const spender = accounts[1];
      const value = ethers.utils.parseEther('3').toString();
      const currentNonce = await ubi.nonces(owner.address);
      const invalidNonce = currentNonce + 1;
  
      expect((await ubi.allowance(owner.address, spender.address))).to.be.equal('0');

      const signature = await signERC2612Permit(
        owner.provider,
        permitDomain,
        owner.address,
        spender.address,
        value,
        null,
        invalidNonce
      );

      await expect(
        ubi.permit(owner.address, spender.address, value, signature.deadline, signature.v, signature.r, signature.s)
      ).to.be.revertedWith("ERC20Permit: invalid signature");

      expect((await ubi.allowance(owner.address, spender.address))).to.be.equal('0');
    });

    it("require fail - permit with owner as zero address", async () => {
      const owner = accounts[0];
      const spender = accounts[1];
      const value = ethers.utils.parseEther('3').toString();
      const invalidOwner = ethers.constants.AddressZero;
  
      expect((await ubi.allowance(owner.address, spender.address))).to.be.equal('0');

      const signature = await signERC2612Permit(
        owner.provider,
        permitDomain,
        owner.address,
        spender.address,
        value
      );

      await expect(
        ubi.permit(invalidOwner, spender.address, value, signature.deadline, signature.v, signature.r, signature.s)
      ).to.be.revertedWith("ERC20Permit: invalid owner");

      expect((await ubi.allowance(owner.address, spender.address))).to.be.equal('0');
    });

    it("happy path - permit called by a third party increases allowance to expected value", async () => {
      const owner = accounts[0];
      const spender = accounts[1];
      const thirdParty = accounts[2];
      const value = ethers.utils.parseEther('2').toString();
  
      expect((await ubi.allowance(owner.address, spender.address))).to.be.equal('0');
  
      const signature = await signERC2612Permit(
        owner.provider,
        permitDomain,
        owner.address,
        spender.address,
        value
      );

      await ubi.connect(thirdParty).permit(
        owner.address, spender.address, value, signature.deadline, signature.v, signature.r, signature.s
      );
  
      expect((await ubi.allowance(owner.address, spender.address))).to.be.equal(value);
    });
  });
});
